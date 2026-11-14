//go:build linux

package signature

import (
	"fmt"

	"github.com/Matbe34/lankir/internal/signature/nss"
	"github.com/Matbe34/lankir/internal/signature/types"
)

// openNSSSigner unlocks an NSS certificate's key (Linux only).
func openNSSSigner(cert *types.Certificate, password string) (CertificateSigner, func(), error) {
	if cert.NSSNickname == "" {
		return nil, nil, fmt.Errorf("NSS certificate is missing nickname field")
	}

	signer, err := nss.GetNSSSigner(cert.NSSNickname, password)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to access NSS certificate with nickname '%s': %w", cert.NSSNickname, err)
	}
	return signer, signer.Close, nil
}

// openPlatformSigner: on Linux, platform store certificates come from NSS.
func openPlatformSigner(cert *types.Certificate, password string) (CertificateSigner, func(), error) {
	return openNSSSigner(cert, password)
}
