package signature

import (
	"crypto"
	"crypto/x509"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"math"
	"math/rand/v2"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/Matbe34/lankir/internal/signature/certutil"
	"github.com/Matbe34/lankir/internal/signature/pkcs11"
	"github.com/Matbe34/lankir/internal/signature/pkcs12"
	"github.com/Matbe34/lankir/internal/signature/types"
	"github.com/digitorus/pdfsign/sign"
)

// SignRequest describes one signing operation.
type SignRequest struct {
	PDFPath string `json:"pdfPath"`
	// OutputPath is where the signed copy is written; empty means the next
	// free <name>_signed.pdf beside the input.
	OutputPath      string `json:"outputPath"`
	CertFingerprint string `json:"certFingerprint"`
	PIN             string `json:"pin"`
	ProfileID       string `json:"profileId"`
	// Position places a visible signature, overriding the profile's box.
	Position *SignaturePosition `json:"position"`
	// TSAURL, when set, adds an RFC 3161 timestamp from that server (PAdES B-T).
	TSAURL string `json:"tsaUrl"`
}

// reserveSignedPDFPath creates an empty <name>_signed.pdf beside pdfPath, or
// <name>_signed_2.pdf, _3, ... when that name is taken, and returns its path.
// Creating it exclusively keeps concurrent signings from picking the same name.
func reserveSignedPDFPath(pdfPath string) (string, error) {
	base := strings.TrimSuffix(pdfPath, filepath.Ext(pdfPath)) + "_signed"
	path := base + ".pdf"
	for i := 2; i <= 1000; i++ {
		f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o666)
		if err == nil {
			return path, f.Close()
		}
		if !errors.Is(err, fs.ErrExist) {
			return "", fmt.Errorf("cannot create the signed copy: %w", err)
		}
		path = fmt.Sprintf("%s_%d.pdf", base, i)
	}
	return "", fmt.Errorf("cannot create the signed copy: too many signed copies of %s", filepath.Base(pdfPath))
}

// SignPDF signs req.PDFPath and returns the path of the signed copy.
func (s *SignatureService) SignPDF(req SignRequest) (_ string, err error) {
	profile, err := s.GetSignatureProfile(req.ProfileID)
	if err != nil {
		return "", fmt.Errorf("failed to get signature profile: %w", err)
	}

	if req.Position != nil && profile.Visibility == VisibilityVisible {
		if err := validatePosition(req.Position); err != nil {
			return "", err
		}
		profile.Position = *req.Position
	}

	if err := s.profileManager.ValidateProfile(profile); err != nil {
		return "", fmt.Errorf("invalid signature profile: %w", err)
	}

	if req.OutputPath != "" && sameFile(req.PDFPath, req.OutputPath) {
		return "", errors.New("the signed copy must be saved to a different file than the document being signed")
	}

	certs, err := s.ListCertificates()
	if err != nil {
		return "", fmt.Errorf("failed to list certificates: %w", err)
	}
	var selected *types.Certificate
	for i := range certs {
		if certs[i].Fingerprint == req.CertFingerprint {
			selected = &certs[i]
			break
		}
	}
	if selected == nil {
		return "", fmt.Errorf("certificate with fingerprint %s not found", req.CertFingerprint)
	}
	// A locked PKCS#12 can't be inspected before its password is known; any
	// other certificate is checked before its token or store is asked for the PIN.
	if !isLockedFile(selected) {
		if err := checkCertificate(selected); err != nil {
			return "", err
		}
	}

	// Without an explicit output, sign into a hidden temp file and claim the
	// <name>_signed.pdf name only once the signed bytes exist.
	target := req.OutputPath
	if target == "" {
		if target, err = createTemp(filepath.Dir(req.PDFPath)); err != nil {
			return "", fmt.Errorf("cannot create the signed copy: %w", err)
		}
		defer os.Remove(target) // gone after a successful rename
	}

	signer, closeSigner, err := s.openSigner(selected, req.PIN)
	if err != nil {
		return "", err
	}
	defer closeSigner()

	if err := checkUnlockedCertificate(selected, signer.Certificate()); err != nil {
		return "", err
	}
	cert := certutil.ConvertX509Certificate(signer.Certificate(), selected.Source, selected.Name)

	if err := s.signPDFWithSigner(req.PDFPath, target, signer, &cert, profile, s.signingLocation(profile), req.TSAURL); err != nil {
		return "", err
	}
	outputPath := target
	if req.OutputPath == "" {
		if outputPath, err = reserveSignedPDFPath(req.PDFPath); err != nil {
			return "", err
		}
		if err = os.Rename(target, outputPath); err != nil {
			os.Remove(outputPath)
			return "", fmt.Errorf("cannot create the signed copy: %w", err)
		}
	}
	if s.configService != nil {
		if err := s.configService.SetLastSigning(selected.Fingerprint, req.ProfileID); err != nil {
			slog.Warn("could not remember the signing certificate and profile", "error", err)
		}
	}
	return outputPath, nil
}

// isLockedFile reports whether cert is a password-protected PKCS#12 listed
// before unlocking, whose fingerprint is its path.
func isLockedFile(cert *types.Certificate) bool {
	return strings.HasPrefix(cert.Fingerprint, "file:")
}

func checkCertificate(cert *types.Certificate) error {
	if !cert.IsValid {
		return fmt.Errorf("certificate %q is not valid now (valid from %s to %s)", cert.Name, cert.ValidFrom, cert.ValidTo)
	}
	if !cert.HasSigningCapability() {
		return fmt.Errorf("certificate %q cannot be used for signing: its key usage allows neither digital signatures nor non-repudiation", cert.Name)
	}
	return nil
}

// checkUnlockedCertificate checks the certificate behind the unlocked key: it
// must be the one selected (NSS nicknames can repeat across renewals) and
// usable for signing.
func checkUnlockedCertificate(selected *types.Certificate, x509Cert *x509.Certificate) error {
	if !isLockedFile(selected) && certutil.GetFingerprint(x509Cert) != selected.Fingerprint {
		return fmt.Errorf("the key unlocked for %q belongs to a different certificate", selected.Name)
	}
	cert := certutil.ConvertX509Certificate(x509Cert, selected.Source, selected.Name)
	return checkCertificate(&cert)
}

func validatePosition(p *SignaturePosition) error {
	for _, v := range []float64{p.X, p.Y, p.Width, p.Height} {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return fmt.Errorf("signature position must be finite numbers")
		}
	}
	if p.Width <= 0 {
		p.Width = DefaultSignatureWidth
	}
	if p.Height <= 0 {
		p.Height = DefaultSignatureHeight
	}
	if p.Page <= 0 {
		p.Page = 1
	}

	const maxSignatureDimension = 2000.0
	const maxCoordinate = 10000.0

	if p.Width > maxSignatureDimension {
		return fmt.Errorf("signature width too large: %.2f points (maximum %.2f)", p.Width, maxSignatureDimension)
	}
	if p.Height > maxSignatureDimension {
		return fmt.Errorf("signature height too large: %.2f points (maximum %.2f)", p.Height, maxSignatureDimension)
	}
	// Page boxes may start below 0, so only the magnitude is bounded.
	if math.Abs(p.X) > maxCoordinate {
		return fmt.Errorf("signature X coordinate out of bounds: %.2f (must be within ±%.2f)", p.X, maxCoordinate)
	}
	if math.Abs(p.Y) > maxCoordinate {
		return fmt.Errorf("signature Y coordinate out of bounds: %.2f (must be within ±%.2f)", p.Y, maxCoordinate)
	}
	return nil
}

func sameFile(a, b string) bool {
	ai, errA := os.Stat(a)
	bi, errB := os.Stat(b)
	if errA == nil && errB == nil {
		return os.SameFile(ai, bi)
	}
	absA, _ := filepath.Abs(a)
	absB, _ := filepath.Abs(b)
	return absA == absB
}

// signingLocation is the profile's free-text location, or the IP-based
// lookup when the user turned it on and the profile shows a location.
func (s *SignatureService) signingLocation(profile *SignatureProfile) string {
	if profile.Appearance.ShowLocation && s.configService != nil && s.configService.Get().SignatureLocationLookup {
		location, err := getLocationString()
		if err == nil && location != "" {
			return location
		}
		slog.Warn("location lookup failed, using the profile's location", "error", err)
	}
	return profile.Location
}

// openSigner unlocks the private key behind cert. The returned func releases it.
func (s *SignatureService) openSigner(cert *types.Certificate, pin string) (CertificateSigner, func(), error) {
	switch cert.Source {
	case "pkcs11":
		if cert.PKCS11Module == "" {
			return nil, nil, errors.New("certificate does not have PKCS#11 module information")
		}
		signer, err := pkcs11.GetSignerFromCertificate(cert.PKCS11Module, cert.Fingerprint, pin)
		if err != nil {
			return nil, nil, fmt.Errorf("failed to access PKCS#11 certificate: %w", err)
		}
		return signer, func() { _ = signer.Close() }, nil
	case "User NSS DB", "NSS Database":
		return openNSSSigner(cert, pin)
	case "Windows Certificate Store":
		return openPlatformSigner(cert, pin)
	case "User File":
		ext := strings.ToLower(filepath.Ext(cert.FilePath))
		if ext != ".p12" && ext != ".pfx" {
			return nil, nil, fmt.Errorf("unsupported certificate file type: %q", ext)
		}
		signer, err := pkcs12.GetSignerFromPKCS12File(cert.FilePath, pin)
		if err != nil {
			return nil, nil, err
		}
		return signer, func() {}, nil
	default:
		return nil, nil, fmt.Errorf("unsupported certificate source: %s", cert.Source)
	}
}

// certificationRefused starts every error pdfsign returns when a document
// can't take a certification signature (already signed or certified); some
// spell it "CertificationSignature", so it is matched in lower case.
const certificationRefused = "cannot add a certification"

// signPDFWithSigner writes the signed copy of inputPath to outputPath. The
// output is written beside the target and renamed into place, so a failure
// never leaves a partial file or destroys a file the user chose to replace.
// A replaced file keeps its permissions; a new one gets the umask's.
func (s *SignatureService) signPDFWithSigner(inputPath, outputPath string, signer CertificateSigner, cert *types.Certificate, profile *SignatureProfile, location, tsaURL string) error {
	signingTime := time.Now().Local()

	signData := sign.SignData{
		Signature: sign.SignDataSignature{
			Info: sign.SignDataSignatureInfo{
				Name:     cert.Name,
				Location: location,
				Date:     signingTime,
			},
			CertType:   sign.ApprovalSignature,
			DocMDPPerm: sign.AllowFillingExistingFormFieldsAndSignaturesPerms,
		},
		Appearance:        *CreateSignatureAppearance(profile, cert, location, signingTime),
		Signer:            signer,
		DigestAlgorithm:   crypto.SHA256,
		Certificate:       signer.Certificate(),
		CertificateChains: [][]*x509.Certificate{certificateChain(signer)},
		TSA:               sign.TSA{URL: tsaURL},
		SubFilter:         sign.SubFilterETSICAdESDetached,
	}

	tmpPath, err := createTemp(filepath.Dir(outputPath))
	if err != nil {
		return fmt.Errorf("cannot write the signed file: %w", err)
	}
	defer os.Remove(tmpPath)

	// An invisible signature certifies the document when it is the first
	// one; pdfsign knows exactly when that is allowed, so ask it.
	if profile.Visibility == VisibilityInvisible {
		signData.Signature.CertType = sign.CertificationSignature
		err = sign.SignFile(inputPath, tmpPath, signData) //nolint:staticcheck // SA1019: the pdf.OpenFile API doesn't sign to a path yet
		if err != nil && strings.Contains(strings.ToLower(err.Error()), certificationRefused) {
			signData.Signature.CertType = sign.ApprovalSignature
		}
	}
	if signData.Signature.CertType == sign.ApprovalSignature {
		err = sign.SignFile(inputPath, tmpPath, signData) //nolint:staticcheck // SA1019: see above
	}
	if err != nil {
		return fmt.Errorf("failed to sign PDF: %w", err)
	}

	if fi, err := os.Stat(outputPath); err == nil {
		if err := os.Chmod(tmpPath, fi.Mode().Perm()); err != nil {
			return err
		}
	}
	if err := os.Rename(tmpPath, outputPath); err != nil {
		return fmt.Errorf("cannot write the signed file: %w", err)
	}
	return nil
}

// certificateChain is the signer's certificate followed by the CA
// certificates that came with its key, when the source provides them.
func certificateChain(signer CertificateSigner) []*x509.Certificate {
	chain := []*x509.Certificate{signer.Certificate()}
	if c, ok := signer.(interface{ CACertificates() []*x509.Certificate }); ok {
		chain = append(chain, c.CACertificates()...)
	}
	return chain
}

// createTemp creates an empty hidden file in dir with the permissions of any
// new file (0666 less the umask), unlike os.CreateTemp's 0600.
func createTemp(dir string) (string, error) {
	for {
		path := filepath.Join(dir, fmt.Sprintf(".lankir-signing-%d.pdf", rand.Uint64()))
		f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o666)
		if errors.Is(err, fs.ErrExist) {
			continue
		}
		if err != nil {
			return "", err
		}
		return path, f.Close()
	}
}
