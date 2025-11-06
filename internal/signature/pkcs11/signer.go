package pkcs11

import (
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/asn1"
	"fmt"
	"io"
	"strings"

	"github.com/miekg/pkcs11"
)

type Signer struct {
	cert       *x509.Certificate
	keyHandle  pkcs11.ObjectHandle
	session    pkcs11.SessionHandle
	p          *pkcs11.Ctx
	modulePath string
}

func (ps *Signer) Public() crypto.PublicKey {
	return ps.cert.PublicKey
}

func (ps *Signer) Sign(rand io.Reader, digest []byte, opts crypto.SignerOpts) ([]byte, error) {
	var mechanism []*pkcs11.Mechanism
	var dataToSign []byte

	if _, ok := ps.cert.PublicKey.(*rsa.PublicKey); ok {
		var digestInfo struct {
			AlgorithmIdentifier struct {
				Algorithm  asn1.ObjectIdentifier
				Parameters asn1.RawValue
			}
			Digest []byte
		}

		digestInfo.AlgorithmIdentifier.Algorithm = asn1.ObjectIdentifier{2, 16, 840, 1, 101, 3, 4, 2, 1}
		digestInfo.AlgorithmIdentifier.Parameters = asn1.RawValue{Tag: 5}
		digestInfo.Digest = digest

		var err error
		dataToSign, err = asn1.Marshal(digestInfo)
		if err != nil {
			return nil, fmt.Errorf("failed to create DigestInfo: %w", err)
		}

		mechanism = []*pkcs11.Mechanism{
			pkcs11.NewMechanism(pkcs11.CKM_RSA_PKCS, nil),
		}
	} else {
		dataToSign = digest
		mechanism = []*pkcs11.Mechanism{
			pkcs11.NewMechanism(pkcs11.CKM_SHA256_RSA_PKCS, nil),
		}
	}

	err := ps.p.SignInit(ps.session, mechanism, ps.keyHandle)
	if err != nil {
		return nil, fmt.Errorf("SignInit failed: %w", err)
	}

	signature, err := ps.p.Sign(ps.session, dataToSign)
	if err != nil {
		return nil, fmt.Errorf("Sign failed: %w", err)
	}

	return signature, nil
}

func (ps *Signer) Certificate() *x509.Certificate {
	return ps.cert
}

func (ps *Signer) Close() {
	if ps.p != nil && ps.session != 0 {
		ps.p.CloseSession(ps.session)
		ps.p.Finalize()
		ps.p.Destroy()
	}
}

// GetSignerFromCertificate retrieves a PKCS#11 signer for the given certificate
func GetSignerFromCertificate(modulePath, fingerprint string, pin string) (*Signer, error) {
	p := pkcs11.New(modulePath)
	if p == nil {
		return nil, fmt.Errorf("failed to load PKCS#11 module: %s", modulePath)
	}

	if err := p.Initialize(); err != nil {
		p.Destroy()
		return nil, fmt.Errorf("failed to initialize PKCS#11: %w", err)
	}

	slots, err := p.GetSlotList(true)
	if err != nil {
		p.Finalize()
		p.Destroy()
		return nil, fmt.Errorf("failed to get slot list: %w", err)
	}

	if len(slots) == 0 {
		p.Finalize()
		p.Destroy()
		return nil, fmt.Errorf("no PKCS#11 tokens found")
	}

	for _, slot := range slots {
		session, err := p.OpenSession(slot, pkcs11.CKF_SERIAL_SESSION|pkcs11.CKF_RW_SESSION)
		if err != nil {
			continue
		}

		if err := p.FindObjectsInit(session, []*pkcs11.Attribute{
			pkcs11.NewAttribute(pkcs11.CKA_CLASS, pkcs11.CKO_CERTIFICATE),
		}); err != nil {
			p.CloseSession(session)
			continue
		}

		certObjs, _, err := p.FindObjects(session, 100)
		p.FindObjectsFinal(session)
		if err != nil {
			p.CloseSession(session)
			continue
		}

		var x509Cert *x509.Certificate
		var certLabel string
		var certID []byte

		for _, obj := range certObjs {
			attrs, err := p.GetAttributeValue(session, obj, []*pkcs11.Attribute{
				pkcs11.NewAttribute(pkcs11.CKA_VALUE, nil),
				pkcs11.NewAttribute(pkcs11.CKA_LABEL, nil),
				pkcs11.NewAttribute(pkcs11.CKA_ID, nil),
			})
			if err != nil {
				continue
			}

			var certDER []byte
			var label []byte
			var id []byte

			for _, attr := range attrs {
				if attr.Type == pkcs11.CKA_VALUE {
					certDER = attr.Value
				} else if attr.Type == pkcs11.CKA_LABEL {
					label = attr.Value
				} else if attr.Type == pkcs11.CKA_ID {
					id = attr.Value
				}
			}

			if len(certDER) == 0 {
				continue
			}

			parsedCert, err := x509.ParseCertificate(certDER)
			if err != nil {
				continue
			}

			hash := sha256.Sum256(parsedCert.Raw)
			certFingerprint := fmt.Sprintf("%x", hash[:])

			cleanLabel := strings.TrimRight(string(label), "\x00")

			if certFingerprint == fingerprint {
				x509Cert = parsedCert
				certLabel = cleanLabel
				certID = id
				break
			}
		}

		if x509Cert == nil {
			p.CloseSession(session)
			continue
		}

		if pin != "" {
			err := p.Login(session, pkcs11.CKU_USER, pin)
			if err != nil && err != pkcs11.Error(pkcs11.CKR_USER_ALREADY_LOGGED_IN) {
				p.CloseSession(session)
				return nil, fmt.Errorf("failed to login to token: %w", err)
			}
		}

		var keyObjs []pkcs11.ObjectHandle

		if len(certID) > 0 {
			if err := p.FindObjectsInit(session, []*pkcs11.Attribute{
				pkcs11.NewAttribute(pkcs11.CKA_CLASS, pkcs11.CKO_PRIVATE_KEY),
				pkcs11.NewAttribute(pkcs11.CKA_ID, certID),
			}); err == nil {
				keyObjs, _, err = p.FindObjects(session, 1)
				p.FindObjectsFinal(session)
				if err == nil && len(keyObjs) > 0 {
					return &Signer{
						cert:       x509Cert,
						keyHandle:  keyObjs[0],
						session:    session,
						p:          p,
						modulePath: modulePath,
					}, nil
				}
			}
		}

		if certLabel != "" {
			if err := p.FindObjectsInit(session, []*pkcs11.Attribute{
				pkcs11.NewAttribute(pkcs11.CKA_CLASS, pkcs11.CKO_PRIVATE_KEY),
				pkcs11.NewAttribute(pkcs11.CKA_LABEL, certLabel),
			}); err == nil {
				keyObjs, _, err = p.FindObjects(session, 1)
				p.FindObjectsFinal(session)
				if err == nil && len(keyObjs) > 0 {
					return &Signer{
						cert:       x509Cert,
						keyHandle:  keyObjs[0],
						session:    session,
						p:          p,
						modulePath: modulePath,
					}, nil
				}
			}
		}

		if err := p.FindObjectsInit(session, []*pkcs11.Attribute{
			pkcs11.NewAttribute(pkcs11.CKA_CLASS, pkcs11.CKO_PRIVATE_KEY),
		}); err == nil {
			keyObjs, _, err = p.FindObjects(session, 10)
			p.FindObjectsFinal(session)
			if err == nil && len(keyObjs) == 1 {
				return &Signer{
					cert:       x509Cert,
					keyHandle:  keyObjs[0],
					session:    session,
					p:          p,
					modulePath: modulePath,
				}, nil
			}
		}

		p.CloseSession(session)
		continue
	}

	p.Finalize()
	p.Destroy()
	return nil, fmt.Errorf("certificate not found in any PKCS#11 token")
}
