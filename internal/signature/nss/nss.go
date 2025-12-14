package nss

/*
#cgo pkg-config: nss
#include <stdlib.h>
#include <string.h>
#include <nss.h>
#include <pk11pub.h>
#include <cert.h>
#include <keyhi.h>
#include <secmod.h>
#include <secitem.h>
#include <seccomon.h>
#include <ssl.h>
#include <cryptohi.h>

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
    SECItem sigItem;
    sigItem.type = siBuffer;
    sigItem.data = NULL;
    sigItem.len = 0;

    SECItem digestItem;
    digestItem.type = siBuffer;
    digestItem.data = digest;
    digestItem.len = digest_len;

    SECOidTag hashAlg = SEC_OID_SHA256;
    SECStatus rv = SGN_Digest(key, hashAlg, &sigItem, &digestItem);

    if (rv == SECSuccess && sigItem.data != NULL) {
        if (sigItem.len <= 512) {
            memcpy(sig, sigItem.data, sigItem.len);
            *sig_len = sigItem.len;
        } else {
            rv = SECFailure;
        }
        SECITEM_FreeItem(&sigItem, PR_FALSE);
    }

    return rv;
}

static CERTCertList* get_all_certs() {
    return PK11_ListCerts(PK11CertListAll, NULL);
}

static int has_private_key_for_cert(CERTCertificate *cert) {
    SECKEYPrivateKey *key = PK11_FindKeyByAnyCert(cert, NULL);
    if (key != NULL) {
        SECKEY_DestroyPrivateKey(key);
        return 1;
    }
    return 0;
}

// secure_free_string zeros the memory before freeing
static void secure_free_string(char *str) {
    if (str != NULL) {
        size_t len = strlen(str);
        memset(str, 0, len);
        free(str);
    }
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

type Certificate struct {
	Nickname      string
	X509Cert      *x509.Certificate
	HasPrivateKey bool
}

func ListCertificates() ([]Certificate, error) {
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

	certList := C.get_all_certs()
	if certList == nil {
		return []Certificate{}, nil
	}
	defer C.CERT_DestroyCertList(certList)

	var certs []Certificate
	for node := certList.list.next; node != &certList.list; node = node.next {
		certNode := (*C.CERTCertListNode)(unsafe.Pointer(node))
		cert := certNode.cert

		if cert.nickname == nil {
			continue
		}

		nickname := C.GoString(cert.nickname)
		certDER := C.GoBytes(unsafe.Pointer(cert.derCert.data), C.int(cert.derCert.len))

		x509Cert, err := x509.ParseCertificate(certDER)
		if err != nil {
			continue
		}

		hasPrivKey := C.has_private_key_for_cert(cert) == 1

		certs = append(certs, Certificate{
			Nickname:      nickname,
			X509Cert:      x509Cert,
			HasPrivateKey: hasPrivKey,
		})
	}

	return certs, nil
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

	if pin != "" {
		slot := C.PK11_GetInternalKeySlot()
		if slot == nil {
			C.CERT_DestroyCertificate(cert)
			return nil, fmt.Errorf("failed to get internal key slot")
		}
		defer C.PK11_FreeSlot(slot)

		cPin := C.CString(pin)
		// Ensure PIN is securely zeroed before freeing using our C helper
		defer C.secure_free_string(cPin)

		// Authenticate and check result
		result := C.PK11_Authenticate(slot, C.PR_TRUE, unsafe.Pointer(cPin))
		if result != C.SECSuccess {
			C.CERT_DestroyCertificate(cert)
			return nil, fmt.Errorf("NSS authentication failed: incorrect PIN or authentication error")
		}
	}

	privKey := C.find_private_key(cert)
	if privKey == nil {
		C.CERT_DestroyCertificate(cert)
		return nil, fmt.Errorf("private key not found")
	}

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
