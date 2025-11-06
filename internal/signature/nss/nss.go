package nss

/*
#cgo pkg-config: nss
#include <nss.h>
#include <pk11pub.h>
#include <cert.h>
#include <keyhi.h>
#include <secmod.h>
#include <secitem.h>
#include <seccomon.h>
#include <ssl.h>
#include <string.h>

static SECStatus nss_init(const char *configdir) {
    if (NSS_IsInitialized()) {
        return SECSuccess;
    }
    char initstr[1024];
    snprintf(initstr, sizeof(initstr), "sql:%s", configdir);
    return NSS_InitReadWrite(initstr);
}

static CERTCertificate* find_cert_by_nickname(const char *nickname) {
    return CERT_FindCertByNickname(CERT_GetDefaultCertDB(), nickname);
}

static SECKEYPrivateKey* find_private_key(CERTCertificate *cert) {
    return PK11_FindKeyByAnyCert(cert, NULL);
}

static SECStatus sign_digest(SECKEYPrivateKey *key, unsigned char *digest, int digest_len, unsigned char *sig, int *sig_len) {
    SECItem digest_item;
    SECItem sig_item = {0};
    
    digest_item.type = siBuffer;
    digest_item.data = digest;
    digest_item.len = digest_len;
    
    sig_item.type = siBuffer;
    sig_item.data = NULL;
    sig_item.len = 0;
    
    SECStatus rv = PK11_Sign(key, &sig_item, &digest_item);
    if (rv == SECSuccess && sig_item.data != NULL) {
        if (sig_item.len <= 512) {
            memcpy(sig, sig_item.data, sig_item.len);
            *sig_len = sig_item.len;
        } else {
            rv = SECFailure;
        }
        SECITEM_FreeItem(&sig_item, PR_FALSE);
    }
    return rv;
}
*/
import "C"
import (
	"crypto"
	"crypto/x509"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"unsafe"
)

type NSSSigner struct {
	cert       *x509.Certificate
	certNSS    *C.CERTCertificate
	privateKey *C.SECKEYPrivateKey
}

func (n *NSSSigner) Public() crypto.PublicKey {
	return n.cert.PublicKey
}

func (n *NSSSigner) Sign(rand io.Reader, digest []byte, opts crypto.SignerOpts) ([]byte, error) {
	sig := make([]byte, 512)
	var sigLen C.int

	rv := C.sign_digest(
		n.privateKey,
		(*C.uchar)(unsafe.Pointer(&digest[0])),
		C.int(len(digest)),
		(*C.uchar)(unsafe.Pointer(&sig[0])),
		&sigLen,
	)

	if rv != C.SECSuccess {
		return nil, fmt.Errorf("NSS signing failed")
	}

	return sig[:sigLen], nil
}

func (n *NSSSigner) Certificate() *x509.Certificate {
	return n.cert
}

func (n *NSSSigner) Close() {
	if n.privateKey != nil {
		C.SECKEY_DestroyPrivateKey(n.privateKey)
	}
	if n.certNSS != nil {
		C.CERT_DestroyCertificate(n.certNSS)
	}
}

func GetNSSSigner(nickname, pin string) (*NSSSigner, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}

	nssDBPath := filepath.Join(homeDir, ".pki", "nssdb")
	cPath := C.CString(nssDBPath)
	defer C.free(unsafe.Pointer(cPath))

	if C.nss_init(cPath) != C.SECSuccess {
		return nil, fmt.Errorf("NSS initialization failed")
	}

	cNickname := C.CString(nickname)
	defer C.free(unsafe.Pointer(cNickname))

	cert := C.find_cert_by_nickname(cNickname)
	if cert == nil {
		return nil, fmt.Errorf("certificate not found")
	}

	// Authenticate with PIN if needed
	if pin != "" {
		slot := C.PK11_GetInternalKeySlot()
		if slot != nil {
			cPin := C.CString(pin)
			C.PK11_Authenticate(slot, C.PR_TRUE, unsafe.Pointer(cPin))
			C.free(unsafe.Pointer(cPin))
			C.PK11_FreeSlot(slot)
		}
	}

	privKey := C.find_private_key(cert)
	if privKey == nil {
		C.CERT_DestroyCertificate(cert)
		return nil, fmt.Errorf("private key not found")
	}

	// Convert NSS cert to x509
	certDER := C.GoBytes(unsafe.Pointer(cert.derCert.data), C.int(cert.derCert.len))
	x509Cert, err := x509.ParseCertificate(certDER)
	if err != nil {
		C.SECKEY_DestroyPrivateKey(privKey)
		C.CERT_DestroyCertificate(cert)
		return nil, err
	}

	return &NSSSigner{
		cert:       x509Cert,
		certNSS:    cert,
		privateKey: privKey,
	}, nil
}
