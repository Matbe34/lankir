package signature

import (
	"context"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/pem"
	"fmt"
	"io/ioutil"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// SignatureService handles digital signature operations
type SignatureService struct {
	ctx context.Context
}

// NewSignatureService creates a new signature service
func NewSignatureService() *SignatureService {
	return &SignatureService{}
}

// Startup is called when the app starts
func (s *SignatureService) Startup(ctx context.Context) {
	s.ctx = ctx
	
	// Ensure common PKCS#11 modules are registered in NSS
	// This allows pdfsig to access smart cards and hardware tokens
	s.ensurePKCS11ModulesRegistered()
}

// ensurePKCS11ModulesRegistered checks and registers common PKCS#11 modules in NSS
func (s *SignatureService) ensurePKCS11ModulesRegistered() {
	nssDir := filepath.Join(os.Getenv("HOME"), ".pki/nssdb")
	
	// Create NSS database if it doesn't exist
	if _, err := os.Stat(nssDir); os.IsNotExist(err) {
		exec.Command("certutil", "-d", "sql:"+nssDir, "-N", "--empty-password").Run()
	}

	// List of common PKCS#11 modules to register
	modules := []struct {
		name string
		path string
	}{
		{"Bit4ID Token", "/usr/lib/libbit4xpki.so"},
		{"OpenSC", "/usr/lib/x86_64-linux-gnu/opensc-pkcs11.so"},
		{"OpenSC", "/usr/lib/opensc-pkcs11.so"},
	}

	// Check which modules are already registered
	cmd := exec.Command("modutil", "-dbdir", "sql:"+nssDir, "-list")
	output, err := cmd.Output()
	if err != nil {
		return // Can't check modules, skip
	}

	registeredModules := string(output)

	// Register missing modules
	for _, mod := range modules {
		// Skip if already registered
		if strings.Contains(registeredModules, mod.name) {
			continue
		}

		// Check if module file exists
		if _, err := os.Stat(mod.path); os.IsNotExist(err) {
			continue
		}

		// Register the module (silently, don't block on browser warning)
		cmd := exec.Command("modutil", "-dbdir", "sql:"+nssDir, "-add", mod.name, "-libfile", mod.path, "-force")
		cmd.Run() // Ignore errors - module might already be registered or browser might be open
	}
}

// Certificate represents a digital certificate
type Certificate struct {
	Name         string   `json:"name"`
	Issuer       string   `json:"issuer"`
	Subject      string   `json:"subject"`
	SerialNumber string   `json:"serialNumber"`
	ValidFrom    string   `json:"validFrom"`
	ValidTo      string   `json:"validTo"`
	Fingerprint  string   `json:"fingerprint"`
	Source       string   `json:"source"` // "system-nss", "pkcs11", "file"
	KeyUsage     []string `json:"keyUsage"`
	IsValid      bool     `json:"isValid"`
	// NSS nickname (used for signing, especially for PKCS#11 tokens)
	NSSNickname  string   `json:"nssNickname,omitempty"`
	// PKCS#11 specific fields
	PKCS11URL    string   `json:"pkcs11Url,omitempty"`    // Full PKCS#11 URL
	PKCS11Module string   `json:"pkcs11Module,omitempty"` // Path to PKCS#11 module
}

// ListCertificates returns available certificates for signing
func (s *SignatureService) ListCertificates() ([]Certificate, error) {
	fmt.Println("===== ListCertificates called =====")
	
	var allCerts []Certificate
	
	// Get NSS certificates (fast)
	nssCerts, err := s.listNSSCertificatesSimple()
	if err != nil {
		fmt.Printf("Error listing NSS certificates: %v\n", err)
	} else {
		allCerts = append(allCerts, nssCerts...)
	}
	
	// Get PKCS#11 certificates directly (no NSS needed)
	pkcs11Certs := s.listPKCS11CertificatesDirect()
	allCerts = append(allCerts, pkcs11Certs...)
	
	fmt.Printf("Found %d certificates total\n", len(allCerts))
	return allCerts, nil
}

// listPKCS11CertificatesDirect lists certificates from PKCS#11 tokens using p11tool directly
// This doesn't require NSS registration
func (s *SignatureService) listPKCS11CertificatesDirect() []Certificate {
	var certs []Certificate
	
	p11toolPath, err := exec.LookPath("p11tool")
	if err != nil {
		fmt.Println("p11tool not found, skipping PKCS#11 certificates")
		return certs
	}
	
	// List of common PKCS#11 modules to check
	modules := []string{
		"/usr/lib/libbit4xpki.so",
		"/usr/lib/libbit4ipki.so",
		"/usr/lib/x86_64-linux-gnu/opensc-pkcs11.so",
		"/usr/lib/opensc-pkcs11.so",
	}
	
	seenTokens := make(map[string]bool)
	
	for _, module := range modules {
		// Check if module exists
		if _, err := os.Stat(module); os.IsNotExist(err) {
			continue
		}
		
		fmt.Printf("Checking PKCS#11 module: %s\n", filepath.Base(module))
		
		// List tokens for this module
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		cmd := exec.CommandContext(ctx, p11toolPath, "--provider="+module, "--list-tokens")
		output, err := cmd.Output()
		cancel()
		
		if err != nil {
			continue
		}
		
		// Parse token URLs
		lines := strings.Split(string(output), "\n")
		for _, line := range lines {
			if strings.Contains(line, "pkcs11:") {
				parts := strings.Fields(line)
				for _, part := range parts {
					if strings.HasPrefix(part, "pkcs11:") {
						tokenURL := part
						
						// Skip if we've seen this token
						if seenTokens[tokenURL] {
							continue
						}
						seenTokens[tokenURL] = true
						
						// List certificates for this token
						tokenCerts := s.listCertificatesFromToken(p11toolPath, module, tokenURL)
						certs = append(certs, tokenCerts...)
					}
				}
			}
		}
	}
	
	fmt.Printf("Found %d PKCS#11 certificates\n", len(certs))
	return certs
}

// listCertificatesFromToken lists certificates from a specific PKCS#11 token
func (s *SignatureService) listCertificatesFromToken(p11toolPath, module, tokenURL string) []Certificate {
	var certs []Certificate
	
	// List certificates in this token
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	cmd := exec.CommandContext(ctx, p11toolPath, "--provider="+module, "--list-all-certs", tokenURL)
	output, err := cmd.Output()
	cancel()
	
	if err != nil {
		return certs
	}
	
	// Parse certificate URLs
	lines := strings.Split(string(output), "\n")
	for _, line := range lines {
		if strings.Contains(line, "pkcs11:") && strings.Contains(line, "type=cert") {
			// Extract the certificate URL
			idx := strings.Index(line, "pkcs11:")
			if idx >= 0 {
				certURL := line[idx:]
				// Remove trailing text
				if spaceIdx := strings.Index(certURL, " "); spaceIdx > 0 {
					certURL = certURL[:spaceIdx]
				}
				
				// Try to get certificate label/name
				certName := s.extractCertNameFromPKCS11URL(certURL)
				if certName == "" {
					certName = "Smart Card Certificate"
				}
				
				// Extract token name
				tokenName := s.extractTokenNameFromURL(tokenURL)
				
				// Create certificate entry
				cert := Certificate{
					Name:         certName,
					Subject:      certName,
					Issuer:       tokenName,
					Source:       "pkcs11",
					IsValid:      true,
					KeyUsage:     []string{"Digital Signature", "Non-Repudiation"},
					Fingerprint:  certURL, // Use URL as unique identifier
					PKCS11URL:    certURL,
					PKCS11Module: module,
					ValidFrom:    "",
					ValidTo:      "",
					SerialNumber: "",
				}
				
				certs = append(certs, cert)
				fmt.Printf("Added PKCS#11 certificate: %s from %s\n", certName, tokenName)
			}
		}
	}
	
	return certs
}

// extractCertNameFromPKCS11URL extracts certificate name/label from PKCS#11 URL
func (s *SignatureService) extractCertNameFromPKCS11URL(pkcs11URL string) string {
	// Look for object= or label= parameter
	parts := strings.Split(pkcs11URL, ";")
	for _, part := range parts {
		if strings.HasPrefix(part, "object=") {
			name := strings.TrimPrefix(part, "object=")
			decoded, _ := url.QueryUnescape(name)
			return decoded
		}
		if strings.HasPrefix(part, "label=") {
			name := strings.TrimPrefix(part, "label=")
			decoded, _ := url.QueryUnescape(name)
			return decoded
		}
	}
	return ""
}

// extractTokenNameFromURL extracts token name from PKCS#11 URL
func (s *SignatureService) extractTokenNameFromURL(tokenURL string) string {
	parts := strings.Split(tokenURL, ";")
	for _, part := range parts {
		if strings.HasPrefix(part, "token=") {
			name := strings.TrimPrefix(part, "token=")
			decoded, _ := url.QueryUnescape(name)
			return decoded
		}
	}
	return "Smart Card"
}

// listNSSCertificatesSimple lists certificates from NSS database using certutil -L
func (s *SignatureService) listNSSCertificatesSimple() ([]Certificate, error) {
	var certs []Certificate
	
	nssDir := filepath.Join(os.Getenv("HOME"), ".pki/nssdb")
	
	// First, get certificates without hardware tokens (fast, no PIN needed)
	cmd := exec.Command("certutil", "-L", "-d", "sql:"+nssDir)
	output, err := cmd.Output()
	if err != nil {
		return certs, fmt.Errorf("failed to list certificates: %w", err)
	}

	// Parse output to get certificate nicknames
	lines := strings.Split(string(output), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		
		// Skip header and empty lines
		if line == "" || 
		   strings.Contains(line, "Certificate Nickname") || 
		   strings.Contains(line, "SSL,S/MIME,JAR") ||
		   strings.Contains(line, "---") {
			continue
		}

		// Extract nickname (everything before trust attributes)
		var nickname string
		parts := strings.Fields(line)
		
		if len(parts) < 2 {
			continue
		}
		
		// Find where trust attributes start (contains commas)
		trustIdx := -1
		for i, part := range parts {
			if strings.Contains(part, ",") {
				trustIdx = i
				break
			}
		}
		
		if trustIdx > 0 {
			nickname = strings.Join(parts[:trustIdx], " ")
		} else {
			continue
		}

		// Get certificate details
		cert, err := s.getNSSCertificateDetails("certutil", nssDir, nickname)
		if err != nil {
			fmt.Printf("Skipped certificate '%s': %v\n", nickname, err)
			continue
		}
		
		// Store the NSS nickname
		cert.NSSNickname = nickname
		
		// Only add if it's a valid user certificate with signing capability
		if cert.Name != "" && cert.IsValid {
			hasSigningCap := false
			for _, usage := range cert.KeyUsage {
				if strings.Contains(usage, "Digital Signature") || 
				   strings.Contains(usage, "Non-Repudiation") {
					hasSigningCap = true
					break
				}
			}
			
			if hasSigningCap {
				certs = append(certs, cert)
				fmt.Printf("Added certificate: %s (Source: %s)\n", cert.Name, cert.Source)
			}
		}
	}
	
	// Now try to add hardware token certificates in a non-blocking way
	// Run this in background with a short timeout
	tokenCerts := s.listHardwareTokenCertificates(nssDir)
	certs = append(certs, tokenCerts...)

	return certs, nil
}

// listHardwareTokenCertificates attempts to list certificates from hardware tokens
// This runs with a timeout to avoid blocking
func (s *SignatureService) listHardwareTokenCertificates(nssDir string) []Certificate {
	var certs []Certificate
	
	// Use a 3-second timeout - certutil outputs the list before asking for PIN
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	
	cmd := exec.CommandContext(ctx, "certutil", "-L", "-h", "all", "-d", "sql:"+nssDir)
	
	// Create a pipe for stdin to send empty responses to PIN prompts
	stdin, err := cmd.StdinPipe()
	if err == nil {
		// Send empty lines in background to respond to PIN prompts
		go func() {
			defer stdin.Close()
			// Wait a bit then send empty responses
			time.Sleep(500 * time.Millisecond)
			stdin.Write([]byte("\n\n\n\n"))
		}()
	}
	
	// Get output - this will contain the certificate list even if command fails later
	output, _ := cmd.CombinedOutput()
	// Ignore error - command will fail when PIN is wrong, but we got the output we need
	
	// Parse output looking for token certificates (contain ":")
	lines := strings.Split(string(output), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		
		if line == "" || 
		   strings.Contains(line, "Certificate Nickname") || 
		   strings.Contains(line, "SSL,S/MIME,JAR") ||
		   strings.Contains(line, "Enter Password") ||
		   strings.Contains(line, "Enter Pin") ||
		   strings.Contains(line, "---") {
			continue
		}

		// Extract nickname
		var nickname string
		parts := strings.Fields(line)
		
		if len(parts) < 2 {
			continue
		}
		
		trustIdx := -1
		for i, part := range parts {
			if strings.Contains(part, ",") {
				trustIdx = i
				break
			}
		}
		
		if trustIdx > 0 {
			nickname = strings.Join(parts[:trustIdx], " ")
		} else {
			continue
		}

		// Only process token certificates (contain ":")
		if strings.Contains(nickname, ":") {
			tokenParts := strings.SplitN(nickname, ":", 2)
			if len(tokenParts) == 2 {
				tokenName := tokenParts[0]
				certName := tokenParts[1]
				
				cert := Certificate{
					Name:         certName,
					Subject:      certName,
					Issuer:       tokenName,
					Source:       "pkcs11",
					IsValid:      true,
					KeyUsage:     []string{"Digital Signature", "Non-Repudiation"},
					Fingerprint:  nickname,
					NSSNickname:  nickname,
					ValidFrom:    "",
					ValidTo:      "",
					SerialNumber: "",
				}
				
				certs = append(certs, cert)
				fmt.Printf("Added smart card certificate: %s (Source: pkcs11)\n", certName)
			}
		}
	}
	
	return certs
}

// deduplicateCertificates removes duplicate certificates based on fingerprint
func (s *SignatureService) deduplicateCertificates(certs []Certificate) []Certificate {
	seen := make(map[string]bool)
	unique := []Certificate{}

	for _, cert := range certs {
		if cert.Fingerprint == "" {
			continue // Skip invalid certificates
		}

		if !seen[cert.Fingerprint] {
			seen[cert.Fingerprint] = true
			unique = append(unique, cert)
		}
	}

	return unique
}

// listNSSUserCertificates reads only user certificates (with private keys) from NSS database
func (s *SignatureService) listNSSUserCertificates() ([]Certificate, error) {
	var certs []Certificate

	// Common NSS database locations
	nssDirs := []string{
		filepath.Join(os.Getenv("HOME"), ".pki/nssdb"),
		filepath.Join(os.Getenv("HOME"), ".mozilla/firefox"),
	}

	for _, baseDir := range nssDirs {
		if _, err := os.Stat(baseDir); err != nil {
			continue
		}

		// For Firefox, we need to find the profile directory
		if strings.Contains(baseDir, "firefox") {
			profiles, _ := filepath.Glob(filepath.Join(baseDir, "*.default*"))
			for _, profile := range profiles {
				profileCerts, _ := s.readNSSDatabase(profile, true) // true = user certs only
				certs = append(certs, profileCerts...)
			}
		} else {
			dbCerts, _ := s.readNSSDatabase(baseDir, true) // true = user certs only
			certs = append(certs, dbCerts...)
		}
	}

	return certs, nil
}

// readNSSDatabase reads certificates from an NSS database
func (s *SignatureService) readNSSDatabase(dbDir string, userCertsOnly bool) ([]Certificate, error) {
	var certs []Certificate

	// Use certutil to list certificates
	// -L lists certificates, -d specifies database directory
	args := []string{"-L", "-d", "sql:" + dbDir}

	cmd := exec.Command("certutil", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return certs, err
	}

	// Parse certutil output to get certificate nicknames
	lines := strings.Split(string(output), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)

		// Skip header and empty lines
		if line == "" || strings.HasPrefix(line, "Certificate Nickname") || strings.HasPrefix(line, "---") {
			continue
		}

		// certutil -L output format: "nickname    trust_flags"
		// Extract nickname (everything before the trust flags)
		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}

		// Get all parts except the last one (trust flags)
		nickname := strings.Join(parts[:len(parts)-1], " ")

		// Get certificate details
		cert, err := s.getNSSCertificateDetails("certutil", dbDir, nickname)
		if err == nil {
			certs = append(certs, cert)
		}
	}

	return certs, nil
}

// listNSSCertificates reads certificates from NSS database (Firefox, Chrome, etc.)
func (s *SignatureService) listNSSCertificates() ([]Certificate, error) {
	var certs []Certificate

	// Check if certutil is available (part of libnss3-tools)
	certutilPath, err := exec.LookPath("certutil")
	if err != nil {
		return certs, fmt.Errorf("certutil not found: %w", err)
	}

	// Common NSS database locations
	nssDirs := []string{
		filepath.Join(os.Getenv("HOME"), ".pki/nssdb"),
		filepath.Join(os.Getenv("HOME"), ".mozilla/firefox"),
	}

	for _, nssDir := range nssDirs {
		if _, err := os.Stat(nssDir); err != nil {
			continue
		}

		// List certificates in NSS database
		cmd := exec.Command(certutilPath, "-L", "-d", "sql:"+nssDir)
		output, err := cmd.Output()
		if err != nil {
			continue
		}

		// Parse certutil output
		lines := strings.Split(string(output), "\n")
		for i, line := range lines {
			// Skip header lines
			if i < 3 || strings.TrimSpace(line) == "" {
				continue
			}

			// Extract certificate nickname
			parts := strings.Fields(line)
			if len(parts) > 0 {
				nickname := strings.Join(parts[:len(parts)-1], " ")

				// Get detailed certificate info
				certInfo, err := s.getNSSCertificateDetails(certutilPath, nssDir, nickname)
				if err == nil {
					certInfo.Source = "system-nss"
					certs = append(certs, certInfo)
				}
			}
		}
	}

	return certs, nil
}

// getNSSCertificateDetails gets detailed information about an NSS certificate
func (s *SignatureService) getNSSCertificateDetails(certutilPath, nssDir, nickname string) (Certificate, error) {
	cmd := exec.Command(certutilPath, "-L", "-d", "sql:"+nssDir, "-n", nickname, "-a")
	output, err := cmd.Output()
	if err != nil {
		return Certificate{}, err
	}

	// Parse PEM certificate
	block, _ := pem.Decode(output)
	if block == nil {
		return Certificate{}, fmt.Errorf("failed to decode PEM certificate")
	}

	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return Certificate{}, err
	}

	// Determine source: if nickname contains ":" it's from a PKCS#11 token
	source := "system-nss"
	if strings.Contains(nickname, ":") {
		source = "pkcs11"
	}

	certInfo := s.certificateFromX509(cert, nickname, source)
	// Check if certificate was filtered out (e.g., CA certificate)
	if certInfo.Name == "" {
		return Certificate{}, fmt.Errorf("certificate filtered out")
	}

	return certInfo, nil
}

// listPKCS11Certificates discovers certificates from PKCS#11 tokens
func (s *SignatureService) listPKCS11Certificates() ([]Certificate, error) {
	var certs []Certificate

	// Check if p11tool is available (part of gnutls-bin)
	p11toolPath, err := exec.LookPath("p11tool")
	if err != nil {
		fmt.Println("PKCS#11: p11tool not found")
		return certs, nil // Not an error, just not available
	}

	// List of PKCS#11 modules to try
	pkcs11Modules := []string{
		"",                              // Default (p11-kit)
		"/usr/lib/libbit4xpki.so",       // Bit4ID
		"/usr/lib/libbit4ipki.so",       // Bit4ID alternative
		"/usr/lib/opensc-pkcs11.so",     // OpenSC
		"/usr/lib/x86_64-linux-gnu/opensc-pkcs11.so", // OpenSC on x86_64
	}

	allTokenURLs := make(map[string]bool)

	for _, module := range pkcs11Modules {
		var cmd *exec.Cmd
		var moduleDesc string

		if module == "" {
			moduleDesc = "default p11-kit"
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			cmd = exec.CommandContext(ctx, p11toolPath, "--list-tokens")
		} else {
			// Check if module exists
			if _, err := os.Stat(module); os.IsNotExist(err) {
				continue
			}
			moduleDesc = filepath.Base(module)
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			cmd = exec.CommandContext(ctx, p11toolPath, "--provider="+module, "--list-tokens")
		}

		output, err := cmd.Output()
		if err != nil {
			fmt.Printf("PKCS#11: Error listing tokens with %s: %v\n", moduleDesc, err)
			continue
		}

		fmt.Printf("PKCS#11: Checking module %s\n", moduleDesc)

		// Parse token URLs
		lines := strings.Split(string(output), "\n")
		for _, line := range lines {
			if strings.Contains(line, "pkcs11:") {
				parts := strings.Fields(line)
				for _, part := range parts {
					if strings.HasPrefix(part, "pkcs11:") {
						allTokenURLs[part] = true
						break
					}
				}
			}
		}
	}

	tokenURLs := make([]string, 0, len(allTokenURLs))
	for url := range allTokenURLs {
		tokenURLs = append(tokenURLs, url)
	}

	fmt.Printf("PKCS#11: Found %d unique token(s)\n", len(tokenURLs))

	// List certificates for each token
	maxTokens := 10
	for i, tokenURL := range tokenURLs {
		if i >= maxTokens {
			break
		}

		fmt.Printf("PKCS#11: Scanning token %d: %s\n", i+1, tokenURL)

		// Try with default first, then try specific modules
		var output []byte
		var err error
		var workingModule string
		
		// First try default
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		cmd := exec.CommandContext(ctx, p11toolPath, "--list-all-certs", tokenURL)
		output, err = cmd.Output()
		cancel()
		if err == nil {
			workingModule = "default"
		}

		// If failed, try with Bit4ID module
		if err != nil && fileExists("/usr/lib/libbit4xpki.so") {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			cmd := exec.CommandContext(ctx, p11toolPath, "--provider=/usr/lib/libbit4xpki.so", "--list-all-certs", tokenURL)
			output, err = cmd.Output()
			cancel()
			if err == nil {
				workingModule = "/usr/lib/libbit4xpki.so"
			}
		}

		if err != nil {
			fmt.Printf("PKCS#11: Error listing certs for token %d: %v\n", i+1, err)
			continue
		}

		// Parse certificate information - handle multi-line URLs
		certURLs := []string{}
		lines := strings.Split(string(output), "\n")
		var currentURL strings.Builder
		
		for _, line := range lines {
			trimmed := strings.TrimSpace(line)
			
			// Start of a new certificate object
			if strings.HasPrefix(trimmed, "Object") {
				// Save previous URL if we have one
				if currentURL.Len() > 0 {
					url := currentURL.String()
					if strings.Contains(url, "type=cert") {
						certURLs = append(certURLs, url)
					}
					currentURL.Reset()
				}
			}
			
			// Check if line contains URL part
			if strings.Contains(trimmed, "pkcs11:") {
				// Find the pkcs11: URL
				idx := strings.Index(trimmed, "pkcs11:")
				if idx >= 0 {
					urlPart := trimmed[idx:]
					// Remove any trailing text after the URL (like "Type:")
					if typeIdx := strings.Index(urlPart, "Type:"); typeIdx > 0 {
						urlPart = strings.TrimSpace(urlPart[:typeIdx])
					}
					currentURL.WriteString(urlPart)
				}
			} else if currentURL.Len() > 0 && strings.HasPrefix(trimmed, "%") {
				// Continuation of URL on next line (starts with encoded char)
				currentURL.WriteString(trimmed)
			}
		}
		
		// Don't forget the last URL
		if currentURL.Len() > 0 {
			url := currentURL.String()
			if strings.Contains(url, "type=cert") {
				certURLs = append(certURLs, url)
			}
		}

		fmt.Printf("PKCS#11: Found %d certificate(s) in token %d\n", len(certURLs), i+1)

		// Get details for each certificate (limit to avoid hanging)
		maxCerts := 10
		for j, certURL := range certURLs {
			if j >= maxCerts {
				break
			}

			certInfo, err := s.getPKCS11CertificateDetails(p11toolPath, certURL, workingModule)
			if err == nil {
				certInfo.Source = "pkcs11"
				certs = append(certs, certInfo)
				fmt.Printf("PKCS#11: Added certificate: %s\n", certInfo.Name)
			} else {
				fmt.Printf("PKCS#11: Skipped certificate %d: %v\n", j+1, err)
			}
		}
	}

	fmt.Printf("PKCS#11: Total certificates found: %d\n", len(certs))
	return certs, nil
}

// getPKCS11CertificateDetails gets detailed information about a PKCS#11 certificate
func (s *SignatureService) getPKCS11CertificateDetails(p11toolPath, certURL, moduleHint string) (Certificate, error) {
	// Add timeout to prevent hanging
	// Use --no-login to avoid PIN prompt (certificates are public, don't need authentication)
	
	var output []byte
	var err error
	var usedModule string
	
	// Try with module hint first if provided
	if moduleHint != "" && fileExists(moduleHint) {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, p11toolPath, "--provider="+moduleHint, "--export", "--no-login", certURL)
		output, err = cmd.CombinedOutput()
		if err == nil {
			usedModule = moduleHint
		}
	}
	
	// Try default if module hint didn't work
	if err != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, p11toolPath, "--export", "--no-login", certURL)
		output, err = cmd.CombinedOutput()
		if err == nil {
			usedModule = "default"
		}
	}
	
	// Try with Bit4ID module as fallback
	if err != nil && fileExists("/usr/lib/libbit4xpki.so") {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, p11toolPath, "--provider=/usr/lib/libbit4xpki.so", "--export", "--no-login", certURL)
		output, err = cmd.CombinedOutput()
		if err == nil {
			usedModule = "/usr/lib/libbit4xpki.so"
		}
	}
	
	if err != nil {
		// Log the actual error for debugging
		fmt.Printf("PKCS#11: Export error: %v, output: %s\n", err, string(output))
		return Certificate{}, err
	}

	// Parse PEM certificate
	block, _ := pem.Decode(output)
	if block == nil {
		return Certificate{}, fmt.Errorf("failed to decode PEM certificate")
	}

	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return Certificate{}, err
	}

	certInfo := s.certificateFromX509(cert, cert.Subject.CommonName, "pkcs11")
	// Check if certificate was filtered out (e.g., CA certificate)
	if certInfo.Name == "" {
		return Certificate{}, fmt.Errorf("certificate filtered out")
	}

	// Store PKCS#11 specific information
	certInfo.PKCS11URL = certURL
	certInfo.PKCS11Module = usedModule

	return certInfo, nil
}

// listUserCertificates reads certificates from user's certificate directory
func (s *SignatureService) listUserCertificates() ([]Certificate, error) {
	homeDir := os.Getenv("HOME")
	certDir := filepath.Join(homeDir, ".certificates")

	// Create directory if it doesn't exist
	if _, err := os.Stat(certDir); os.IsNotExist(err) {
		os.MkdirAll(certDir, 0755)
		return []Certificate{}, nil
	}

	return s.scanCertificateDirectory(certDir, "file")
}

// scanCertificateDirectory scans a directory for certificate files
func (s *SignatureService) scanCertificateDirectory(dir, source string) ([]Certificate, error) {
	var certs []Certificate

	files, err := ioutil.ReadDir(dir)
	if err != nil {
		return certs, err
	}

	for _, file := range files {
		if file.IsDir() {
			continue
		}

		// Check for certificate file extensions
		ext := strings.ToLower(filepath.Ext(file.Name()))
		if ext != ".pem" && ext != ".crt" && ext != ".cer" && ext != ".p12" && ext != ".pfx" {
			continue
		}

		filePath := filepath.Join(dir, file.Name())

		// Read and parse certificate
		data, err := ioutil.ReadFile(filePath)
		if err != nil {
			continue
		}

		// Try to parse as PEM
		if ext == ".pem" || ext == ".crt" || ext == ".cer" {
			block, _ := pem.Decode(data)
			if block != nil && block.Type == "CERTIFICATE" {
				cert, err := x509.ParseCertificate(block.Bytes)
				if err == nil {
					certInfo := s.certificateFromX509(cert, file.Name(), source)
					// Only add if not filtered out (e.g., not a CA certificate)
					if certInfo.Name != "" {
						certs = append(certs, certInfo)
					}
				}
			}
		}
		// PKCS#12 files would need password - skip for now or handle separately
	}

	return certs, nil
}

// certificateFromX509 converts an x509.Certificate to our Certificate struct
func (s *SignatureService) certificateFromX509(cert *x509.Certificate, name, source string) Certificate {
	// Calculate SHA-256 fingerprint for logging
	fingerprint := sha256.Sum256(cert.Raw)
	fingerprintHex := hex.EncodeToString(fingerprint[:])
	
	// Log certificate details
	fmt.Printf("Processing cert: CN=%s, IsCA=%v, KeyUsage=%d, Source=%s, Fingerprint=%s\n", 
		cert.Subject.CommonName, cert.IsCA, cert.KeyUsage, source, fingerprintHex[:16]+"...")
	
	// Skip CA certificates - we only want end-user certificates
	if cert.IsCA {
		fmt.Printf("  -> Skipped: CA certificate\n")
		return Certificate{}
	}

	// Determine if certificate is currently valid
	now := time.Now()
	isValid := now.After(cert.NotBefore) && now.Before(cert.NotAfter)

	// Extract key usage information
	keyUsage := []string{}
	if cert.KeyUsage&x509.KeyUsageDigitalSignature != 0 {
		keyUsage = append(keyUsage, "Digital Signature")
	}
	if cert.KeyUsage&x509.KeyUsageContentCommitment != 0 {
		keyUsage = append(keyUsage, "Non-Repudiation")
	}
	if cert.KeyUsage&x509.KeyUsageKeyEncipherment != 0 {
		keyUsage = append(keyUsage, "Key Encipherment")
	}

	certInfo := Certificate{
		Name:         name,
		Issuer:       cert.Issuer.String(),
		Subject:      cert.Subject.String(),
		SerialNumber: cert.SerialNumber.String(),
		ValidFrom:    cert.NotBefore.Format(time.RFC3339),
		ValidTo:      cert.NotAfter.Format(time.RFC3339),
		Fingerprint:  fingerprintHex,
		Source:       source,
		KeyUsage:     keyUsage,
		IsValid:      isValid,
	}
	
	fmt.Printf("  -> Added: %s (Valid=%v, KeyUsage=%v)\n", certInfo.Name, isValid, keyUsage)
	return certInfo
}

// SignPDF signs a PDF with the specified certificate
func (s *SignatureService) SignPDF(pdfPath string, certFingerprint string, pin string) (string, error) {
	// Find the certificate
	certs, err := s.ListCertificates()
	if err != nil {
		return "", fmt.Errorf("failed to list certificates: %w", err)
	}

	var selectedCert *Certificate
	for _, cert := range certs {
		if cert.Fingerprint == certFingerprint {
			selectedCert = &cert
			break
		}
	}

	if selectedCert == nil {
		return "", fmt.Errorf("certificate not found")
	}

	// Check if certificate is valid for signing
	if !selectedCert.IsValid {
		return "", fmt.Errorf("certificate is not valid")
	}

	hasSigningCapability := false
	for _, usage := range selectedCert.KeyUsage {
		if strings.Contains(usage, "Digital Signature") || strings.Contains(usage, "Non-Repudiation") {
			hasSigningCapability = true
			break
		}
	}

	if !hasSigningCapability {
		return "", fmt.Errorf("certificate does not have digital signature capability")
	}

	// Sign based on certificate source
	switch selectedCert.Source {
	case "pkcs11":
		return s.signWithPKCS11(pdfPath, selectedCert, pin)
	case "system-nss":
		return s.signWithPKCS11(pdfPath, selectedCert, pin) // NSS certs often accessible via PKCS#11
	case "file":
		return "", fmt.Errorf("signing with file-based certificates requires PKCS#12 support (not yet implemented)")
	default:
		return "", fmt.Errorf("unsupported certificate source: %s", selectedCert.Source)
	}
}

// signWithPKCS11 signs a PDF using PKCS#11 token
func (s *SignatureService) signWithPKCS11(pdfPath string, cert *Certificate, pin string) (string, error) {
	// Create output path
	outputPath := strings.TrimSuffix(pdfPath, ".pdf") + "_signed.pdf"

	// For NSS certificates, use pdfsig
	if cert.Source == "system-nss" {
		if _, err := exec.LookPath("pdfsig"); err == nil {
			certNick, err := s.findNSSNickname(cert)
			if err == nil {
				return s.signWithPdfsig(pdfPath, outputPath, certNick, pin)
			}
		}
	}
	
	// For PKCS#11 certificates, we have the module and URL
	// We need to use a tool that supports PKCS#11 directly
	// Option 1: Use autofirma (which you have installed)
	if _, err := exec.LookPath("autofirma"); err == nil {
		return s.signWithAutofirma(pdfPath, outputPath, cert, pin)
	}
	
	// Option 2: Try to use the certificate via NSS if module is registered
	// First try to register the module temporarily
	if cert.PKCS11Module != "" {
		s.ensurePKCS11ModuleRegistered(cert.PKCS11Module)
		
		// Try pdfsig with the registered module
		if _, err := exec.LookPath("pdfsig"); err == nil {
			// The certificate should now be accessible via NSS
			// Try to find it by searching for the certificate name in NSS
			certNick := s.findPKCS11CertInNSS(cert)
			if certNick != "" {
				return s.signWithPdfsig(pdfPath, outputPath, certNick, pin)
			}
		}
	}

	return "", fmt.Errorf("PDF signing with PKCS#11 smart cards requires either:\n1. AutoFirma (recommended)\n2. PKCS#11 module registered in NSS database\n\nYour certificate: %s\nModule: %s", cert.Name, cert.PKCS11Module)
}

// ensurePKCS11ModuleRegistered registers a single PKCS#11 module in NSS
func (s *SignatureService) ensurePKCS11ModuleRegistered(modulePath string) {
	if modulePath == "" {
		return
	}
	
	nssDir := filepath.Join(os.Getenv("HOME"), ".pki/nssdb")
	moduleName := filepath.Base(modulePath)
	moduleName = strings.TrimSuffix(moduleName, filepath.Ext(moduleName))
	
	// Check if already registered
	cmd := exec.Command("modutil", "-dbdir", "sql:"+nssDir, "-list")
	output, err := cmd.Output()
	if err == nil && strings.Contains(string(output), moduleName) {
		return // Already registered
	}
	
	// Register it
	cmd = exec.Command("modutil", "-dbdir", "sql:"+nssDir, "-add", moduleName, "-libfile", modulePath, "-force")
	cmd.Run() // Ignore errors
}

// findPKCS11CertInNSS tries to find a PKCS#11 certificate in NSS database
func (s *SignatureService) findPKCS11CertInNSS(cert *Certificate) string {
	nssDir := filepath.Join(os.Getenv("HOME"), ".pki/nssdb")
	
	cmd := exec.Command("certutil", "-L", "-h", "all", "-d", "sql:"+nssDir)
	
	// Use timeout and send empty PINs
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	cmd = exec.CommandContext(ctx, "certutil", "-L", "-h", "all", "-d", "sql:"+nssDir)
	
	stdin, _ := cmd.StdinPipe()
	go func() {
		if stdin != nil {
			defer stdin.Close()
			time.Sleep(500 * time.Millisecond)
			stdin.Write([]byte("\n\n\n"))
		}
	}()
	
	output, _ := cmd.CombinedOutput()
	
	// Look for certificate nickname containing the cert name
	lines := strings.Split(string(output), "\n")
	for _, line := range lines {
		if strings.Contains(line, cert.Name) && strings.Contains(line, ":") {
			// Extract nickname
			parts := strings.Fields(line)
			if len(parts) >= 2 {
				for i, part := range parts {
					if strings.Contains(part, ",") && i > 0 {
						return strings.Join(parts[:i], " ")
					}
				}
			}
		}
	}
	
	return ""
}

// signWithAutofirma uses AutoFirma for signing
func (s *SignatureService) signWithAutofirma(inputPath, outputPath string, cert *Certificate, pin string) (string, error) {
	// AutoFirma command-line signing
	// This is a placeholder - AutoFirma typically uses GUI
	return "", fmt.Errorf("AutoFirma GUI-based signing not yet implemented. Please use AutoFirma application directly or register PKCS#11 module in NSS")
}

// findNSSNickname finds the NSS nickname for a certificate
func (s *SignatureService) findNSSNickname(cert *Certificate) (string, error) {
	// If we already have the NSS nickname stored, use it
	if cert.NSSNickname != "" {
		return cert.NSSNickname, nil
	}

	// Fallback: use the certificate name
	if cert.Name != "" {
		return cert.Name, nil
	}

	return "", fmt.Errorf("certificate nickname not available")
}

// signWithPdfsig uses pdfsig from poppler-utils
func (s *SignatureService) signWithPdfsig(inputPath, outputPath, certLabel, pin string) (string, error) {
	// pdfsig -add-signature -nssdir ~/.pki/nssdb -nss-pwd <pin> -nick <certLabel> <input> <output>
	nssDir := filepath.Join(os.Getenv("HOME"), ".pki/nssdb")

	args := []string{
		"-add-signature",
		"-nssdir", nssDir,
		"-nick", certLabel,
	}

	// Only add password if provided
	if pin != "" {
		args = append(args, "-nss-pwd", pin)
	}

	args = append(args, inputPath, outputPath)

	cmd := exec.Command("pdfsig", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("pdfsig failed: %w - %s", err, string(output))
	}

	return outputPath, nil
}

// signWithPKCS11Token signs a PDF using a PKCS#11 smart card token
func (s *SignatureService) signWithPKCS11Token(inputPath, outputPath string, cert *Certificate, pin string) (string, error) {
	// For PKCS#11 tokens, we need to use tools that support PKCS#11 directly
	// Option 1: Use Java-based tools like PortableSigner or jsignpdf
	// Option 2: Use p11tool to create signature and inject into PDF
	// Option 3: Use Go PKCS#11 library to sign
	
	// For now, we'll try using jSignPdf if available (common PDF signing tool)
	// Otherwise, we'll fallback to a simpler solution using p11tool
	
	// Check for jsignpdf
	jsignpdfPath, _ := exec.LookPath("jsignpdf")
	if jsignpdfPath != "" {
		return s.signWithJSignPdf(inputPath, outputPath, cert, pin)
	}
	
	// Fallback to manual signing with p11tool
	return s.signWithP11Tool(inputPath, outputPath, cert, pin)
}

// signWithP11Tool creates a PDF signature using p11tool
func (s *SignatureService) signWithP11Tool(inputPath, outputPath string, cert *Certificate, pin string) (string, error) {
	p11toolPath, err := exec.LookPath("p11tool")
	if err != nil {
		return "", fmt.Errorf("p11tool not found: %w", err)
	}

	// Create a temporary file for the signature
	tmpDir := os.TempDir()
	tmpHash := filepath.Join(tmpDir, fmt.Sprintf("pdf_hash_%d.bin", time.Now().UnixNano()))
	tmpSig := filepath.Join(tmpDir, fmt.Sprintf("pdf_sig_%d.bin", time.Now().UnixNano()))
	defer os.Remove(tmpHash)
	defer os.Remove(tmpSig)

	// Read the PDF
	pdfData, err := ioutil.ReadFile(inputPath)
	if err != nil {
		return "", fmt.Errorf("failed to read PDF: %w", err)
	}

	// Calculate SHA-256 hash of the PDF content
	hash := sha256.Sum256(pdfData)
	if err := ioutil.WriteFile(tmpHash, hash[:], 0600); err != nil {
		return "", fmt.Errorf("failed to write hash: %w", err)
	}

	// Build p11tool command to sign the hash
	args := []string{
		"--sign",
		"--infile=" + tmpHash,
		"--outfile=" + tmpSig,
		"--login",
		"--hash=SHA256",
	}

	// Add provider if we have a specific module
	if cert.PKCS11Module != "" && cert.PKCS11Module != "default" {
		args = append(args, "--provider="+cert.PKCS11Module)
	}

	// Add PIN
	if pin != "" {
		args = append(args, "--set-pin="+pin)
	}

	// Add certificate URL
	args = append(args, cert.PKCS11URL)

	cmd := exec.Command(p11toolPath, args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("p11tool signing failed: %w - Output: %s", err, string(output))
	}

	// Read the signature
	sigData, err := ioutil.ReadFile(tmpSig)
	if err != nil {
		return "", fmt.Errorf("failed to read signature: %w", err)
	}

	// For a complete implementation, we would need to:
	// 1. Parse the PDF structure
	// 2. Create a signature dictionary
	// 3. Insert the signature into the PDF
	// 4. Update the xref table and trailer
	//
	// This is complex, so for now we'll return an error with a helpful message
	// In practice, users should use dedicated PDF signing tools

	_ = sigData // Keep the signature data for future implementation

	return "", fmt.Errorf("PKCS#11 smart card signing requires additional PDF manipulation libraries. Please use pdfsig with NSS database or jsignpdf for PKCS#11 tokens. Signature was created successfully but PDF embedding is not yet implemented")
}

// signWithJSignPdf uses jsignpdf for PKCS#11 signing
func (s *SignatureService) signWithJSignPdf(inputPath, outputPath string, cert *Certificate, pin string) (string, error) {
	// jsignpdf supports PKCS#11 signing
	// Command format: jsignpdf -kst PKCS11 -ksp <module> -ksa <alias> input.pdf output.pdf
	
	args := []string{
		"-kst", "PKCS11",
	}

	if cert.PKCS11Module != "" && cert.PKCS11Module != "default" {
		args = append(args, "-ksp", cert.PKCS11Module)
	}

	// Extract alias from PKCS#11 URL (the certificate label)
	alias := extractAliasFromPKCS11URL(cert.PKCS11URL)
	if alias != "" {
		args = append(args, "-ksa", alias)
	}

	if pin != "" {
		args = append(args, "-kspwd", pin)
	}

	args = append(args, inputPath, outputPath)

	cmd := exec.Command("jsignpdf", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("jsignpdf failed: %w - %s", err, string(output))
	}

	return outputPath, nil
}

// extractAliasFromPKCS11URL extracts the certificate alias/label from a PKCS#11 URL
func extractAliasFromPKCS11URL(pkcs11URL string) string {
	// PKCS#11 URLs typically contain id= or object= parameters
	// Example: pkcs11:...;object=Certificate%20Name;...
	parts := strings.Split(pkcs11URL, ";")
	for _, part := range parts {
		if strings.HasPrefix(part, "object=") {
			value := strings.TrimPrefix(part, "object=")
			// URL decode
			decoded, _ := url.QueryUnescape(value)
			return decoded
		}
	}
	return ""
}

// signWithManualPKCS11 implements manual PKCS#11 signing
func (s *SignatureService) signWithManualPKCS11(inputPath, outputPath string, cert *Certificate, pin string) (string, error) {
	// This is a simplified implementation
	// In production, you would use a proper PDF signing library

	// Step 1: Read PDF file
	pdfData, err := ioutil.ReadFile(inputPath)
	if err != nil {
		return "", fmt.Errorf("failed to read PDF: %w", err)
	}

	// Step 2: Create signature placeholder in PDF
	// This is where we would insert a signature dictionary
	// For now, we'll use p11tool to create a detached signature

	// Create temporary file for hash
	tmpHash := filepath.Join(os.TempDir(), "pdf_hash.bin")
	tmpSig := filepath.Join(os.TempDir(), "pdf_sig.bin")
	defer os.Remove(tmpHash)
	defer os.Remove(tmpSig)

	// Calculate SHA-256 hash of PDF
	hash := sha256.Sum256(pdfData)
	if err := ioutil.WriteFile(tmpHash, hash[:], 0600); err != nil {
		return "", fmt.Errorf("failed to write hash: %w", err)
	}

	// Use p11tool to sign the hash
	// Find the PKCS#11 URL for this certificate
	p11URL, err := s.findPKCS11URL(cert)
	if err != nil {
		return "", fmt.Errorf("failed to find PKCS#11 URL: %w", err)
	}

	// Sign with p11tool
	cmd := exec.Command("p11tool",
		"--sign",
		"--infile", tmpHash,
		"--outfile", tmpSig,
		"--login",
		"--set-pin", pin,
		p11URL,
	)

	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("p11tool signing failed: %w - %s", err, string(output))
	}

	// Read signature
	sigData, err := ioutil.ReadFile(tmpSig)
	if err != nil {
		return "", fmt.Errorf("failed to read signature: %w", err)
	}

	// Step 3: Embed signature in PDF
	// This requires proper PDF manipulation
	// For now, we'll create a basic signed PDF structure
	signedPDF, err := s.embedSignatureInPDF(pdfData, sigData, cert)
	if err != nil {
		return "", fmt.Errorf("failed to embed signature: %w", err)
	}

	// Write signed PDF
	if err := ioutil.WriteFile(outputPath, signedPDF, 0644); err != nil {
		return "", fmt.Errorf("failed to write signed PDF: %w", err)
	}

	return outputPath, nil
}

// findPKCS11URL finds the PKCS#11 URL for a certificate
func (s *SignatureService) findPKCS11URL(cert *Certificate) (string, error) {
	// Use p11tool to list URLs and match by fingerprint
	cmd := exec.Command("p11tool", "--list-all", "--login")
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("failed to list PKCS#11 objects: %w", err)
	}

	lines := strings.Split(string(output), "\n")
	for i, line := range lines {
		if strings.Contains(line, "URL:") {
			url := strings.TrimSpace(strings.TrimPrefix(line, "URL:"))
			// Check if this URL corresponds to our certificate
			// by checking subsequent lines for matching subject or fingerprint
			for j := i + 1; j < len(lines) && j < i+10; j++ {
				if strings.Contains(lines[j], cert.Subject) || strings.Contains(lines[j], cert.Fingerprint) {
					return url, nil
				}
			}
		}
	}

	return "", fmt.Errorf("PKCS#11 URL not found for certificate")
}

// embedSignatureInPDF embeds a signature into a PDF
func (s *SignatureService) embedSignatureInPDF(pdfData, signature []byte, cert *Certificate) ([]byte, error) {
	// This is a simplified implementation
	// A proper implementation would:
	// 1. Parse the PDF structure
	// 2. Create a Signature dictionary
	// 3. Add the signature to the PDF's AcroForm
	// 4. Update cross-reference table and trailer

	// For now, we'll return an error indicating this needs a proper PDF library
	return nil, fmt.Errorf("PDF signature embedding requires a full PDF library - use pdfsig instead")
}

// extractCNFromSubject extracts the Common Name from a certificate subject
func extractCNFromSubject(subject string) string {
	parts := strings.Split(subject, ",")
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if strings.HasPrefix(part, "CN=") {
			return strings.TrimPrefix(part, "CN=")
		}
	}
	return ""
}

// VerifySignature verifies the signatures in a PDF
func (s *SignatureService) VerifySignature(pdfPath string) ([]SignatureInfo, error) {
	// Use pdfsig to verify signatures
	if _, err := exec.LookPath("pdfsig"); err != nil {
		return nil, fmt.Errorf("pdfsig not found - install poppler-utils")
	}

	cmd := exec.Command("pdfsig", pdfPath)
	output, err := cmd.CombinedOutput()

	// pdfsig returns exit code 2 when there are no signatures, which is not an error for us
	outputStr := string(output)
	if err != nil && !strings.Contains(outputStr, "does not contain any signatures") {
		return nil, fmt.Errorf("pdfsig verification failed: %w - %s", err, outputStr)
	}

	// Parse output to extract signature information
	signatures := s.parseSignatureOutput(outputStr)
	return signatures, nil
}

// SignatureInfo contains information about a PDF signature
type SignatureInfo struct {
	SignerName                   string `json:"signerName"`
	SignerDN                     string `json:"signerDN"`
	SigningTime                  string `json:"signingTime"`
	SigningHashAlgorithm         string `json:"signingHashAlgorithm"`
	SignatureType                string `json:"signatureType"`
	IsValid                      bool   `json:"isValid"`
	CertificateValid             bool   `json:"certificateValid"`
	ValidationMessage            string `json:"validationMessage"`
	CertificateValidationMessage string `json:"certificateValidationMessage"`
	Reason                       string `json:"reason"`
	Location                     string `json:"location"`
	ContactInfo                  string `json:"contactInfo"`
}

// parseSignatureOutput parses pdfsig output
func (s *SignatureService) parseSignatureOutput(output string) []SignatureInfo {
	var signatures []SignatureInfo

	lines := strings.Split(output, "\n")
	var currentSig *SignatureInfo

	for _, line := range lines {
		line = strings.TrimSpace(line)

		if strings.HasPrefix(line, "Signature #") {
			if currentSig != nil {
				signatures = append(signatures, *currentSig)
			}
			currentSig = &SignatureInfo{
				CertificateValid: true, // Default to true, set false if we find issues
			}
		}

		if currentSig != nil {
			// Remove "- " prefix if present
			line = strings.TrimPrefix(line, "- ")

			if strings.HasPrefix(line, "Signer Certificate Common Name:") {
				currentSig.SignerName = strings.TrimPrefix(line, "Signer Certificate Common Name:")
				currentSig.SignerName = strings.TrimSpace(currentSig.SignerName)
			} else if strings.HasPrefix(line, "Signer full Distinguished Name:") {
				currentSig.SignerDN = strings.TrimPrefix(line, "Signer full Distinguished Name:")
				currentSig.SignerDN = strings.TrimSpace(currentSig.SignerDN)
				// If we don't have a name yet, use the DN
				if currentSig.SignerName == "" {
					currentSig.SignerName = currentSig.SignerDN
				}
			} else if strings.HasPrefix(line, "Signing Date:") || strings.HasPrefix(line, "Signing Time:") {
				timeStr := strings.TrimPrefix(line, "Signing Date:")
				timeStr = strings.TrimPrefix(timeStr, "Signing Time:")
				currentSig.SigningTime = strings.TrimSpace(timeStr)
			} else if strings.HasPrefix(line, "Signing Hash Algorithm:") {
				currentSig.SigningHashAlgorithm = strings.TrimPrefix(line, "Signing Hash Algorithm:")
				currentSig.SigningHashAlgorithm = strings.TrimSpace(currentSig.SigningHashAlgorithm)
			} else if strings.HasPrefix(line, "Signature Type:") {
				currentSig.SignatureType = strings.TrimPrefix(line, "Signature Type:")
				currentSig.SignatureType = strings.TrimSpace(currentSig.SignatureType)
			} else if strings.HasPrefix(line, "Signature Validation:") {
				validationStatus := strings.TrimPrefix(line, "Signature Validation:")
				validationStatus = strings.TrimSpace(validationStatus)
				currentSig.ValidationMessage = validationStatus
				currentSig.IsValid = strings.Contains(strings.ToLower(validationStatus), "valid")
			} else if strings.HasPrefix(line, "Certificate Validation:") {
				certStatus := strings.TrimPrefix(line, "Certificate Validation:")
				certStatus = strings.TrimSpace(certStatus)
				currentSig.CertificateValidationMessage = certStatus
				// Certificate is valid if it doesn't contain error/unknown/issue
				currentSig.CertificateValid = !strings.Contains(strings.ToLower(certStatus), "unknown") &&
					!strings.Contains(strings.ToLower(certStatus), "issue") &&
					!strings.Contains(strings.ToLower(certStatus), "error") &&
					!strings.Contains(strings.ToLower(certStatus), "corrupt")
			} else if strings.Contains(line, "Signature is Valid") {
				currentSig.IsValid = true
			} else if strings.HasPrefix(line, "Reason:") {
				currentSig.Reason = strings.TrimPrefix(line, "Reason:")
				currentSig.Reason = strings.TrimSpace(currentSig.Reason)
			} else if strings.HasPrefix(line, "Location:") {
				currentSig.Location = strings.TrimPrefix(line, "Location:")
				currentSig.Location = strings.TrimSpace(currentSig.Location)
			} else if strings.HasPrefix(line, "Contact Info:") {
				currentSig.ContactInfo = strings.TrimPrefix(line, "Contact Info:")
				currentSig.ContactInfo = strings.TrimSpace(currentSig.ContactInfo)
			}
		}
	}

	if currentSig != nil {
		signatures = append(signatures, *currentSig)
	}

	return signatures
}

// fileExists checks if a file exists
func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
