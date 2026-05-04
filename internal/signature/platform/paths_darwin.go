//go:build darwin

package platform

// DefaultPKCS11Modules contains default paths for PKCS#11 libraries on macOS
var DefaultPKCS11Modules = []string{
	"/usr/local/lib/p11-kit-client.dylib",
	"/opt/homebrew/lib/p11-kit-client.dylib",
	"/usr/local/lib/opensc-pkcs11.so",
	"/opt/homebrew/lib/opensc-pkcs11.so",
	"/Library/OpenSC/lib/opensc-pkcs11.so",
}

// DefaultSystemCertDirs contains default system certificate directories on macOS
// Note: macOS uses Keychain, not file-based certificates
var DefaultSystemCertDirs = []string{
	"/System/Library/Keychains",
	"/Library/Keychains",
}

// AllowedCertPrefixes contains allowed path prefixes for certificate stores on macOS
var AllowedCertPrefixes = []string{
	"/System/Library/Keychains",
	"/Library/Keychains",
	"/Users/",
}

// DefaultUserCertDirs contains default user certificate directories (relative to home)
var DefaultUserCertDirs = []string{
	"Library/Keychains",
}
