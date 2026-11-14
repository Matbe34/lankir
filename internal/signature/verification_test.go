package signature

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"errors"
	"math/big"
	"reflect"
	"testing"
	"time"

	"github.com/Matbe34/lankir/internal/signature/types"
	"github.com/digitorus/pdfsign/verify"
	"github.com/digitorus/timestamp"
)

type testCA struct {
	cert *x509.Certificate
	key  crypto.Signer
}

func newTestCert(t *testing.T, tmpl *x509.Certificate, key crypto.Signer, parent *testCA) *x509.Certificate {
	t.Helper()
	parentCert, parentKey := tmpl, key
	if parent != nil {
		parentCert, parentKey = parent.cert, parent.key
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, parentCert, key.Public(), parentKey)
	if err != nil {
		t.Fatal(err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	return cert
}

// testChain builds root (ECDSA P-384) -> intermediate (ECDSA P-256) -> signer (RSA 2048).
func testChain(t *testing.T) (signer, intermediate, root *x509.Certificate) {
	t.Helper()
	notBefore := time.Date(2024, 3, 1, 9, 0, 0, 0, time.UTC)
	notAfter := time.Date(2029, 3, 1, 9, 0, 0, 0, time.UTC)

	rootKey, _ := ecdsa.GenerateKey(elliptic.P384(), rand.Reader)
	root = newTestCert(t, &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "AC RAIZ FNMT-RCM", Organization: []string{"FNMT-RCM"}, Country: []string{"ES"}},
		NotBefore:    notBefore, NotAfter: notAfter,
		IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign,
	}, rootKey, nil)

	interKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	intermediate = newTestCert(t, &x509.Certificate{
		SerialNumber: big.NewInt(2),
		Subject:      pkix.Name{CommonName: "AC FNMT Usuarios", Organization: []string{"FNMT-RCM"}, Country: []string{"ES"}},
		NotBefore:    notBefore, NotAfter: notAfter,
		IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign,
	}, interKey, &testCA{root, rootKey})

	signerKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	signer = newTestCert(t, &x509.Certificate{
		SerialNumber: new(big.Int).SetBytes([]byte{0x4c, 0x1f, 0x0a, 0x9b}),
		Subject:      pkix.Name{CommonName: "GARCIA LOPEZ MARIA - 12345678Z", SerialNumber: "IDCES-12345678Z", Country: []string{"ES"}},
		NotBefore:    notBefore, NotAfter: notAfter,
		KeyUsage: x509.KeyUsageDigitalSignature | x509.KeyUsageContentCommitment,
	}, signerKey, &testCA{intermediate, interKey})
	return signer, intermediate, root
}

func TestConvertSignerToInfoDetails(t *testing.T) {
	signerCert, intermediate, root := testChain(t)
	signed := time.Date(2026, 11, 9, 11, 32, 0, 0, time.UTC)
	stamped := time.Date(2026, 11, 9, 11, 32, 5, 0, time.UTC)

	signer := verify.Signer{
		Name:            "",
		ContactInfo:     "maria@example.es",
		ValidSignature:  true,
		TrustedIssuer:   false,
		Certificates:    []verify.Certificate{{Certificate: signerCert, OCSPEmbedded: true}, {Certificate: root}, {Certificate: intermediate}},
		TimeStamp:       &timestamp.Timestamp{Time: stamped},
		SignatureTime:   &signed,
		TimestampStatus: "untrusted",
		TimeSource:      "current_time",
		Warnings:        []error{errors.New("Timestamp certificate chain validation failed: unknown authority")},
	}

	info := (&SignatureService{}).convertSignerToInfo(signer, "", true)

	checks := map[string][2]string{
		"SignerName":            {info.SignerName, "GARCIA LOPEZ MARIA - 12345678Z"},
		"SigningTime":           {info.SigningTime, "2026-11-09T11:32:00Z"},
		"SigningTimeSource":     {info.SigningTimeSource, "signer"},
		"SigningHashAlgorithm":  {info.SigningHashAlgorithm, ""},
		"KeyAlgorithm":          {info.KeyAlgorithm, "RSA 2048"},
		"SignatureType":         {info.SignatureType, "ECDSA-SHA256"},
		"IssuerName":            {info.IssuerName, "AC FNMT Usuarios"},
		"IssuerDN":              {info.IssuerDN, "CN=AC FNMT Usuarios,O=FNMT-RCM,C=ES"},
		"CertificateSerial":     {info.CertificateSerial, "4C:1F:0A:9B"},
		"CertificateValidFrom":  {info.CertificateValidFrom, "2024-03-01T09:00:00Z"},
		"CertificateValidUntil": {info.CertificateValidUntil, "2029-03-01T09:00:00Z"},
		"TimestampTime":         {info.TimestampTime, "2026-11-09T11:32:05Z"},
		"TimestampStatus":       {info.TimestampStatus, "untrusted"},
		"RevocationStatus":      {info.RevocationStatus, "not_checked"},
		"RevocationCheck":       {info.RevocationCheck, "Not checked: the issuer isn't trusted"},
	}
	for name, c := range checks {
		if c[0] != c[1] {
			t.Errorf("%s = %q, want %q", name, c[0], c[1])
		}
	}

	wantChain := []types.ChainCertificate{
		{Subject: "GARCIA LOPEZ MARIA - 12345678Z", Issuer: "AC FNMT Usuarios"},
		{Subject: "AC FNMT Usuarios", Issuer: "AC RAIZ FNMT-RCM"},
		{Subject: "AC RAIZ FNMT-RCM", Issuer: "AC RAIZ FNMT-RCM"},
	}
	if !reflect.DeepEqual(info.Chain, wantChain) {
		t.Errorf("Chain = %+v, want %+v", info.Chain, wantChain)
	}
	if want := []string{"Timestamp certificate chain validation failed: unknown authority"}; !reflect.DeepEqual(info.Warnings, want) {
		t.Errorf("Warnings = %q, want %q", info.Warnings, want)
	}
}

func TestConvertSignerToInfoWithoutExtras(t *testing.T) {
	signerCert, _, _ := testChain(t)
	now := time.Now()
	signer := verify.Signer{
		ValidSignature:   true,
		Certificates:     []verify.Certificate{{Certificate: signerCert}},
		VerificationTime: &now,
		TimeSource:       "current_time",
		TimestampStatus:  "missing",
	}

	info := (&SignatureService{}).convertSignerToInfo(signer, "", true)

	if info.SigningTime != "" || info.SigningTimeSource != "" {
		t.Errorf("no recorded signing time: got %q (%q), want none", info.SigningTime, info.SigningTimeSource)
	}
	if info.TimestampStatus != "none" || info.TimestampTime != "" {
		t.Errorf("timestamp = %q %q, want none", info.TimestampStatus, info.TimestampTime)
	}
	if info.RevocationStatus != "not_checked" || info.RevocationCheck != "The certificate names no revocation service" {
		t.Errorf("revocation = %q %q, want not checked, no service named", info.RevocationStatus, info.RevocationCheck)
	}
	want := []types.ChainCertificate{{Subject: "GARCIA LOPEZ MARIA - 12345678Z", Issuer: "AC FNMT Usuarios"}}
	if !reflect.DeepEqual(info.Chain, want) {
		t.Errorf("Chain = %+v, want %+v", info.Chain, want)
	}
	if info.Warnings == nil {
		t.Error("Warnings is nil, want an empty list so JSON carries []")
	}
}

func TestConvertSignerToInfoTrustedTimestampAndRevocation(t *testing.T) {
	signerCert, _, _ := testChain(t)
	stamped := time.Date(2026, 11, 9, 11, 32, 5, 0, time.UTC)
	revoked := time.Date(2026, 12, 1, 0, 0, 0, 0, time.UTC)
	signer := verify.Signer{
		ValidSignature:     true,
		TrustedIssuer:      true,
		RevokedCertificate: true,
		Certificates: []verify.Certificate{{
			Certificate: signerCert, CRLExternal: true, OCSPEmbedded: true, RevocationTime: &revoked,
		}},
		TimeStamp:        &timestamp.Timestamp{Time: stamped},
		VerificationTime: &stamped,
		TimestampStatus:  "valid",
		TimestampTrusted: true,
		TimeSource:       "embedded_timestamp",
	}

	info := (&SignatureService{}).convertSignerToInfo(signer, "", true)

	if info.SigningTime != "2026-11-09T11:32:05Z" || info.SigningTimeSource != "timestamp" {
		t.Errorf("signing time = %q (%q), want the trusted timestamp", info.SigningTime, info.SigningTimeSource)
	}
	if info.TimestampStatus != "valid" {
		t.Errorf("TimestampStatus = %q, want valid", info.TimestampStatus)
	}
	if info.RevocationStatus != "revoked" {
		t.Errorf("RevocationStatus = %q, want revoked", info.RevocationStatus)
	}
	if !info.IssuerTrusted || info.CertificateValid {
		t.Errorf("IssuerTrusted = %v, CertificateValid = %v: want a trusted issuer and a revoked, so invalid, certificate", info.IssuerTrusted, info.CertificateValid)
	}
	// The embedded OCSP flag comes with no answer to check, so only the CRL counts.
	if want := "CRL checked online with the certificate authority"; info.RevocationCheck != want {
		t.Errorf("RevocationCheck = %q, want %q", info.RevocationCheck, want)
	}
}

func TestKeyAlgorithmNames(t *testing.T) {
	ecKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	cert := &x509.Certificate{PublicKeyAlgorithm: x509.ECDSA, PublicKey: &ecKey.PublicKey}
	if got := keyAlgorithm(cert); got != "ECDSA P-256" {
		t.Errorf("keyAlgorithm(P-256) = %q", got)
	}
}

func TestConvertSignerToInfoPrefersTheTrustedTimestamp(t *testing.T) {
	signerCert, _, _ := testChain(t)
	claimed := time.Date(2026, 11, 9, 11, 0, 0, 0, time.UTC)
	stamped := time.Date(2026, 11, 9, 11, 32, 5, 0, time.UTC)
	signer := verify.Signer{
		ValidSignature:   true,
		Certificates:     []verify.Certificate{{Certificate: signerCert}},
		SignatureTime:    &claimed,
		TimeStamp:        &timestamp.Timestamp{Time: stamped},
		VerificationTime: &stamped,
		TimestampStatus:  "valid",
		TimeSource:       "embedded_timestamp",
	}

	info := (&SignatureService{}).convertSignerToInfo(signer, "", true)
	if info.SigningTime != "2026-11-09T11:32:05Z" || info.SigningTimeSource != "timestamp" {
		t.Errorf("valid timestamp: signing time = %q (%q), want the timestamp's", info.SigningTime, info.SigningTimeSource)
	}

	signer.TimestampStatus = "untrusted"
	info = (&SignatureService{}).convertSignerToInfo(signer, "", true)
	if info.SigningTime != "2026-11-09T11:00:00Z" || info.SigningTimeSource != "signer" {
		t.Errorf("untrusted timestamp: signing time = %q (%q), want the signer's", info.SigningTime, info.SigningTimeSource)
	}
}
