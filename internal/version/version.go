// Package version holds the version this binary was built as.
package version

// Version is set at build time with
// -ldflags "-X github.com/Matbe34/lankir/internal/version.Version=<version>"
// (scripts/version.sh picks the value from VERSION or git describe).
var Version = "dev"
