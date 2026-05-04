//go:build linux

package signature

import (
	"github.com/Matbe34/lankir/internal/signature/certutil"
	"github.com/Matbe34/lankir/internal/signature/nss"
	"github.com/Matbe34/lankir/internal/signature/types"
)

// loadPlatformCertificates loads certificates from platform-specific certificate stores
// On Linux, this loads from NSS database
func loadPlatformCertificates() ([]types.Certificate, error) {
	return LoadNSSCertificates()
}

// LoadNSSCertificates retrieves certificates with private keys from the user's NSS database.
func LoadNSSCertificates() ([]types.Certificate, error) {
	nssCerts, err := nss.ListCertificates()
	if err != nil {
		return nil, err
	}

	var certs []types.Certificate
	for _, nc := range nssCerts {
		if !nc.HasPrivateKey {
			continue
		}

		c := certutil.ConvertX509Certificate(nc.X509Cert, "NSS Database", nc.X509Cert.Subject.CommonName)
		c.NSSNickname = nc.Nickname
		c.RequiresPin = false
		c.PinOptional = true

		certs = append(certs, c)
	}

	return certs, nil
}
