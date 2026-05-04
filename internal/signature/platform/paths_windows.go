//go:build windows

package platform

import (
	"os"
	"path/filepath"
)

// DefaultPKCS11Modules contains default paths for PKCS#11 libraries on Windows
var DefaultPKCS11Modules = []string{
	getPKCS11Path("OpenSC Project", "OpenSC", "pkcs11", "opensc-pkcs11.dll"),
	getPKCS11Path("OpenSC Project", "OpenSC", "pkcs11", "onepin-opensc-pkcs11.dll"),
	// YubiKey
	getPKCS11Path("Yubico", "Yubico PIV Tool", "bin", "libykcs11.dll"),
	// Generic paths
	"opensc-pkcs11.dll",
	"libykcs11.dll",
}

// DefaultSystemCertDirs contains default system certificate directories on Windows
// Note: Windows uses Certificate Store API, not file-based certificates
// This is kept for potential certificate file imports
var DefaultSystemCertDirs = []string{}

// AllowedCertPrefixes contains allowed path prefixes for certificate stores on
// Windows. Built at init from environment, with empty entries filtered out so
// an unset env var does not turn validateCertificateStorePath into a no-op
// (an empty prefix matches every path under strings.HasPrefix).
var AllowedCertPrefixes []string

func init() {
	candidates := []string{
		os.Getenv("USERPROFILE"),
		os.Getenv("APPDATA"),
		os.Getenv("LOCALAPPDATA"),
		os.Getenv("ProgramFiles"),
		os.Getenv("ProgramFiles(x86)"),
	}
	if sysroot := os.Getenv("SystemRoot"); sysroot != "" {
		candidates = append(candidates, filepath.Join(sysroot, "System32", "certs"))
	}
	for _, c := range candidates {
		if c != "" {
			AllowedCertPrefixes = append(AllowedCertPrefixes, c)
		}
	}
}

// DefaultUserCertDirs contains default user certificate directories (relative to home)
// Windows typically uses Certificate Store instead of file-based certificates
var DefaultUserCertDirs = []string{}

// getPKCS11Path constructs a path in Program Files or Program Files (x86)
func getPKCS11Path(parts ...string) string {
	// Try Program Files first
	programFiles := os.Getenv("ProgramFiles")
	if programFiles != "" {
		path := filepath.Join(append([]string{programFiles}, parts...)...)
		return path
	}

	// Fallback to Program Files (x86)
	programFilesX86 := os.Getenv("ProgramFiles(x86)")
	if programFilesX86 != "" {
		return filepath.Join(append([]string{programFilesX86}, parts...)...)
	}

	// Default fallback
	return filepath.Join(parts...)
}
