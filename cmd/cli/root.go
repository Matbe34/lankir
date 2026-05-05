package cli

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
)

var (
	logger  *slog.Logger
	verbose bool
	jsonLog bool
)

var rootCmd = &cobra.Command{
	Use:   "lankir",
	Short: "Lankir - A powerful PDF management tool",
	Long: `Lankir is a comprehensive PDF management tool that supports:
- PDF viewing and rendering
- Digital signatures with PKCS#11, PKCS#12, and NSS support
- Certificate management
- Signature profiles
- Configuration management

Passing a PDF path as the first argument opens it in the GUI:
  lankir document.pdf

If you have a file literally named after a subcommand (e.g. "pdf"), pass it
with a leading "./" to disambiguate:
  lankir ./pdf
`,
	PersistentPreRun: func(cmd *cobra.Command, args []string) {
		setupLogger()
	},
}

func Execute(runGUI func()) {
	ExecuteWithArgs(os.Args[1:], func([]string) { runGUI() })
}

// ExecuteWithArgs runs the Cobra root command with explicit args. The runGUI
// callback is wired so that the `gui` subcommand opens an empty GUI; passing
// startup files happens via main()'s direct call to runGUI(initialFiles).
func ExecuteWithArgs(args []string, runGUI func([]string)) {
	guiFunc = func() { runGUI(nil) }
	rootCmd.SetArgs(args)
	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}

// IsKnownSubcommand reports whether name is a registered Cobra subcommand on
// the root command (or one of its aliases). Used by main.go to disambiguate
// file paths from CLI verbs.
func IsKnownSubcommand(name string) bool {
	for _, c := range rootCmd.Commands() {
		if c.Name() == name {
			return true
		}
		for _, alias := range c.Aliases {
			if alias == name {
				return true
			}
		}
	}
	return false
}

var guiFunc func()

func init() {
	rootCmd.PersistentFlags().BoolVarP(&verbose, "verbose", "v", false, "enable verbose logging")
	rootCmd.PersistentFlags().BoolVar(&jsonLog, "json", false, "output logs in JSON format")
}

func setupLogger() {
	var handler slog.Handler

	logLevel := slog.LevelInfo
	if verbose {
		logLevel = slog.LevelDebug
	}

	opts := &slog.HandlerOptions{
		Level: logLevel,
	}

	if jsonLog {
		handler = slog.NewJSONHandler(os.Stderr, opts)
	} else {
		handler = slog.NewTextHandler(os.Stderr, opts)
	}

	logger = slog.New(handler)
	slog.SetDefault(logger)
}

func GetLogger() *slog.Logger {
	if logger == nil {
		setupLogger()
	}
	return logger
}

func ExitWithError(msg string, err error) {
	if err != nil {
		GetLogger().Error(msg, "error", err)
		fmt.Fprintf(os.Stderr, "Error: %s: %v\n", msg, err)
	} else {
		GetLogger().Error(msg)
		fmt.Fprintf(os.Stderr, "Error: %s\n", msg)
	}
	os.Exit(1)
}

// SanitizePath sanitizes file paths for logging
func SanitizePath(path string) string {
	if verbose {
		return path
	}
	return filepath.Base(path)
}

// SanitizeCertName sanitizes certificate names for logging
func SanitizeCertName(name string) string {
	if verbose {
		return name
	}
	// Hash the name and return first 8 characters
	hash := sha256.Sum256([]byte(name))
	hashStr := hex.EncodeToString(hash[:])
	return hashStr[:8] + "..."
}

func IsVerbose() bool {
	return verbose
}
