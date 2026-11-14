package cli

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Matbe34/lankir/internal/signature/types"
	"github.com/digitorus/pdfsign/sign"
)

// The test runs itself again with this set, its CA as the system's only root.
const verifyChildEnv = "LANKIR_TEST_VERIFY_ARGS"

func TestSignVerifyOfflineAsksNoCertificateAuthority(t *testing.T) {
	if args := os.Getenv(verifyChildEnv); args != "" {
		verifyChild(t, strings.Split(args, "\n"))
		return
	}

	var hits atomic.Int32
	var crl atomic.Pointer[[]byte]
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		_, _ = w.Write(*crl.Load())
	}))
	defer srv.Close()

	rootKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	rootTpl := &x509.Certificate{
		SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "Test Root"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
		IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
	}
	root := createCert(t, rootTpl, rootTpl, rootKey.Public(), rootKey)
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	leaf := createCert(t, &x509.Certificate{
		SerialNumber: big.NewInt(42), Subject: pkix.Name{CommonName: "Signer"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
		KeyUsage: x509.KeyUsageDigitalSignature, CRLDistributionPoints: []string{srv.URL + "/ca.crl"},
	}, root, key.Public(), rootKey)
	der, err := x509.CreateRevocationList(rand.Reader, &x509.RevocationList{
		Number: big.NewInt(1), ThisUpdate: time.Now().Add(-time.Minute), NextUpdate: time.Now().Add(time.Hour),
	}, root, rootKey)
	if err != nil {
		t.Fatal(err)
	}
	crl.Store(&der)

	dir := t.TempDir()
	pdf := filepath.Join(dir, "signed.pdf")
	err = sign.SignFile(fixture(t, 1), pdf, sign.SignData{ //nolint:staticcheck // SA1019: the API the app signs with
		Signature: sign.SignDataSignature{
			Info:     sign.SignDataSignatureInfo{Name: "Signer", Date: time.Now()},
			CertType: sign.ApprovalSignature, DocMDPPerm: sign.AllowFillingExistingFormFieldsAndSignaturesPerms,
		},
		Signer: key, DigestAlgorithm: crypto.SHA256, Certificate: leaf,
		CertificateChains: [][]*x509.Certificate{{leaf, root}}, SubFilter: sign.SubFilterETSICAdESDetached,
	})
	if err != nil {
		t.Fatal(err)
	}
	rootFile := filepath.Join(dir, "root.pem")
	if err := os.WriteFile(rootFile, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: root.Raw}), 0o600); err != nil {
		t.Fatal(err)
	}

	verify := func(flags ...string) types.SignatureInfo {
		t.Helper()
		out := filepath.Join(t.TempDir(), "out.json")
		cmd := exec.Command(os.Args[0], "-test.run=^TestSignVerifyOfflineAsksNoCertificateAuthority$")
		cmd.Env = append(os.Environ(), "SSL_CERT_FILE="+rootFile, "SSL_CERT_DIR="+t.TempDir(), "LANKIR_TEST_VERIFY_OUT="+out,
			verifyChildEnv+"="+strings.Join(append([]string{"sign", "verify", pdf, "--json"}, flags...), "\n"))
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("lankir sign verify %v: %v\n%s", flags, err, output)
		}
		data, err := os.ReadFile(out)
		if err != nil {
			t.Fatal(err)
		}
		var sigs []types.SignatureInfo
		if err := json.Unmarshal(data, &sigs); err != nil || len(sigs) != 1 {
			t.Fatalf("lankir sign verify %v printed %s: %v", flags, data, err)
		}
		return sigs[0]
	}

	// The setting is on by default.
	if sig := verify(); hits.Load() == 0 || sig.RevocationStatus != "good" {
		t.Fatalf("online: %d requests, revocation %q %q; want the CRL asked, good", hits.Load(), sig.RevocationStatus, sig.RevocationCheck)
	}
	hits.Store(0)
	if sig := verify("--offline"); hits.Load() != 0 || sig.RevocationStatus != "not_checked" || !sig.CertificateValid {
		t.Errorf("--offline: %d requests, revocation %q %q, certificate valid %v; want no request, not checked, trusted",
			hits.Load(), sig.RevocationStatus, sig.RevocationCheck, sig.CertificateValid)
	}
}

// verifyChild runs the CLI with stdout, where sign verify prints, in a file.
func verifyChild(t *testing.T, args []string) {
	out, err := runCLI(t, "", args...)
	if err != nil {
		t.Fatalf("%v: %s", err, out)
	}
	if err := os.WriteFile(os.Getenv("LANKIR_TEST_VERIFY_OUT"), []byte(out), 0o600); err != nil {
		t.Fatal(err)
	}
}

func createCert(t *testing.T, tpl, parent *x509.Certificate, pub crypto.PublicKey, key crypto.Signer) *x509.Certificate {
	t.Helper()
	der, err := x509.CreateCertificate(rand.Reader, tpl, parent, pub, key)
	if err != nil {
		t.Fatal(err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	return cert
}
