package pkcs11

import (
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/miekg/pkcs11"
)

// Signer implements crypto.Signer using PKCS#11
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
	mechanism := []*pkcs11.Mechanism{
		pkcs11.NewMechanism(pkcs11.CKM_SHA256_RSA_PKCS, nil),
	}

	if _, ok := ps.cert.PublicKey.(*rsa.PublicKey); ok {
		mechanism = []*pkcs11.Mechanism{
			pkcs11.NewMechanism(pkcs11.CKM_RSA_PKCS, nil),
		}
	}

	err := ps.p.SignInit(ps.session, mechanism, ps.keyHandle)
	if err != nil {
		return nil, fmt.Errorf("SignInit failed: %w", err)
	}

	signature, err := ps.p.Sign(ps.session, digest)
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
			fmt.Printf("Failed to open session: %v\n", err)
			continue
		}

		// First try without login to find the certificate
		if err := p.FindObjectsInit(session, []*pkcs11.Attribute{
			pkcs11.NewAttribute(pkcs11.CKA_CLASS, pkcs11.CKO_CERTIFICATE),
		}); err != nil {
			fmt.Printf("Failed to init certificate search: %v\n", err)
			p.CloseSession(session)
			continue
		}

		certObjs, _, err := p.FindObjects(session, 100)
		p.FindObjectsFinal(session)
		if err != nil {
			fmt.Printf("Failed to find certificate objects: %v\n", err)
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
				fmt.Printf("  Failed to get attributes: %v\n", err)
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
				fmt.Printf("  No certificate data\n")
				continue
			}

			parsedCert, err := x509.ParseCertificate(certDER)
			if err != nil {
				fmt.Printf("  Failed to parse: %v\n", err)
				continue
			}

			// Calculate fingerprint and compare
			hash := sha256.Sum256(parsedCert.Raw)
			certFingerprint := fmt.Sprintf("%x", hash[:])

			// Clean label
			cleanLabel := strings.TrimRight(string(label), "\x00")

			if certFingerprint == fingerprint {
				x509Cert = parsedCert
				certLabel = cleanLabel
				certID = id
				break
			}
		}

		if x509Cert == nil {
			fmt.Printf("No matching certificate in this slot\n")
			p.CloseSession(session)
			continue
		}

		// Now that we found the certificate, login with PIN for signing
		if pin != "" {
			err := p.Login(session, pkcs11.CKU_USER, pin)
			// Ignore "already logged in" error (happens with NSS)
			if err != nil && err != pkcs11.Error(pkcs11.CKR_USER_ALREADY_LOGGED_IN) {
				fmt.Printf("Failed to login with PIN: %v\n", err)
				fmt.Printf("Note: Your PIN may be locked. You may need to unlock it using your card management tool.\n")
				p.CloseSession(session)
				return nil, fmt.Errorf("failed to login to token: %w (certificate found but PIN authentication failed)", err)
			}
		}

		// Try to find private key by ID first (more reliable), then by label
		var keyObjs []pkcs11.ObjectHandle

		if len(certID) > 0 {
			// Try finding by CKA_ID (most reliable)
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

		// Fallback: try finding by label
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

		// Last resort: find any private key (if there's only one)
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
			} else if len(keyObjs) > 1 {
				fmt.Printf("Warning: Multiple private keys found, cannot determine which to use\n")
			}
		}

		fmt.Printf("Could not find matching private key for certificate\n")
		p.CloseSession(session)
		continue
	}

	p.Finalize()
	p.Destroy()
	return nil, fmt.Errorf("certificate not found in any PKCS#11 token")
}

// GetNSSSignerFromCertificate retrieves a signer from NSS database
func GetNSSSignerFromCertificate(fingerprint, nickname, pin string) (*Signer, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("failed to get home directory: %w", err)
	}

	nssDBPath := homeDir + "/.pki/nssdb"

	// Try NSS modules
	nssModules := []string{
		"/usr/lib/x86_64-linux-gnu/nss/libsoftokn3.so",
		"/usr/lib/x86_64-linux-gnu/p11-kit-proxy.so",
		"/usr/lib64/libsoftokn3.so",
		"/usr/lib/firefox/libsoftokn3.so",
	}

	var lastErr error
	for _, modulePath := range nssModules {
		fmt.Printf("Checking module: %s\n", modulePath)

		if _, err := os.Stat(modulePath); os.IsNotExist(err) {
			fmt.Printf("Module does not exist: %s\n", modulePath)
			continue
		}

		fmt.Printf("Trying NSS module: %s\n", modulePath)

		p := pkcs11.New(modulePath)
		if p == nil {
			lastErr = fmt.Errorf("failed to load module %s", modulePath)
			fmt.Printf("pkcs11.New failed for %s\n", modulePath)
			continue
		}

		// Set NSS config dir as environment variable
		configDir := fmt.Sprintf("configdir='%s' certPrefix='' keyPrefix='' secmod='secmod.db'", nssDBPath)
		fmt.Printf("NSS config: %s\n", configDir)

		if err := p.Initialize(); err != nil {
			fmt.Printf("Initialize failed: %v\n", err)
			p.Destroy()
			lastErr = err
			continue
		}

		slots, err := p.GetSlotList(true)
		if err != nil {
			fmt.Printf("GetSlotList failed: %v\n", err)
			p.Finalize()
			p.Destroy()
			lastErr = err
			continue
		}

		fmt.Printf("Found %d slots\n", len(slots))

		for _, slot := range slots {
			tokenInfo, err := p.GetTokenInfo(slot)
			if err != nil {
				continue
			}
			fmt.Printf("Token: %s\n", strings.TrimSpace(tokenInfo.Label))

			session, err := p.OpenSession(slot, pkcs11.CKF_SERIAL_SESSION|pkcs11.CKF_RW_SESSION)
			if err != nil {
				fmt.Printf("OpenSession failed: %v\n", err)
				continue
			}

			// Try login - NSS DB might need empty PIN or actual PIN
			loginErr := p.Login(session, pkcs11.CKU_USER, pin)
			if loginErr != nil {
				// Try empty PIN
				loginErr = p.Login(session, pkcs11.CKU_USER, "")
			}
			if loginErr != nil {
				fmt.Printf("Login failed (trying without login): %v\n", loginErr)
				// Continue anyway - some operations work without login
			} else {
				fmt.Printf("Login successful\n")
			}

			// Find certificate by fingerprint
			if err := p.FindObjectsInit(session, []*pkcs11.Attribute{
				pkcs11.NewAttribute(pkcs11.CKA_CLASS, pkcs11.CKO_CERTIFICATE),
			}); err != nil {
				p.CloseSession(session)
				continue
			}

			certObjs, _, _ := p.FindObjects(session, 100)
			p.FindObjectsFinal(session)
			fmt.Printf("Found %d certificates\n", len(certObjs))

			for _, obj := range certObjs {
				attrs, err := p.GetAttributeValue(session, obj, []*pkcs11.Attribute{
					pkcs11.NewAttribute(pkcs11.CKA_VALUE, nil),
					pkcs11.NewAttribute(pkcs11.CKA_ID, nil),
				})
				if err != nil {
					continue
				}

				var certDER []byte
				var certID []byte
				for _, attr := range attrs {
					if attr.Type == pkcs11.CKA_VALUE {
						certDER = attr.Value
					} else if attr.Type == pkcs11.CKA_ID {
						certID = attr.Value
					}
				}

				cert, err := x509.ParseCertificate(certDER)
				if err != nil {
					continue
				}

				hash := sha256.Sum256(cert.Raw)
				fp := strings.ToLower(hex.EncodeToString(hash[:]))
				fmt.Printf("Cert FP: %s\n", fp[:16])

				if fp != strings.ToLower(fingerprint) {
					continue
				}

				fmt.Printf("Found matching cert, looking for private key...\n")

				// Found cert, find private key
				if err := p.FindObjectsInit(session, []*pkcs11.Attribute{
					pkcs11.NewAttribute(pkcs11.CKA_CLASS, pkcs11.CKO_PRIVATE_KEY),
					pkcs11.NewAttribute(pkcs11.CKA_ID, certID),
				}); err != nil {
					fmt.Printf("FindObjectsInit for key failed: %v\n", err)
					continue
				}

				keyObjs, _, _ := p.FindObjects(session, 1)
				p.FindObjectsFinal(session)
				fmt.Printf("Found %d private keys\n", len(keyObjs))

				if len(keyObjs) == 1 {
					return &Signer{
						cert:       cert,
						keyHandle:  keyObjs[0],
						session:    session,
						p:          p,
						modulePath: modulePath,
					}, nil
				}
			}

			p.CloseSession(session)
		}

		p.Finalize()
		p.Destroy()
	}

	if lastErr != nil {
		return nil, fmt.Errorf("NSS certificate not found: %w", lastErr)
	}
	return nil, fmt.Errorf("NSS certificate not found or no private key available")
}
