//go:build linux

package platform

// DefaultPKCS11Modules contains default paths for PKCS#11 libraries on Linux
var DefaultPKCS11Modules = []string{
	"/usr/lib/x86_64-linux-gnu/pkcs11/p11-kit-client.so",
	"/usr/lib/x86_64-linux-gnu/opensc-pkcs11.so",
	"/usr/lib64/pkcs11/p11-kit-client.so",
	"/usr/lib64/opensc-pkcs11.so",
}

// DefaultSystemCertDirs contains default system certificate directories on Linux
var DefaultSystemCertDirs = []string{
	"/etc/ssl/certs",
	"/etc/pki/tls/certs",
	"/etc/pki/ca-trust/extracted/pem",
	"/usr/share/ca-certificates",
}

// AllowedCertPrefixes contains allowed path prefixes for certificate stores on Linux
var AllowedCertPrefixes = []string{
	"/etc/ssl/certs",
	"/usr/share/ca-certificates",
	"/etc/pki/ca-trust",
	"/etc/pki/tls/certs",
}

// DefaultUserCertDirs contains default user certificate directories (relative to home)
var DefaultUserCertDirs = []string{
	".pki/nssdb",
	".mozilla/firefox",
	".thunderbird",
}
