package cli

import (
	"fmt"
	"log/slog"
	"os"

	"github.com/spf13/cobra"
)

var (
	logger  *slog.Logger
	verbose bool
	jsonLog bool
)

var rootCmd = &cobra.Command{
	Use:   "pdf-app",
	Short: "PDF Editor Pro - A powerful PDF management tool",
	Long: `PDF Editor Pro is a comprehensive PDF management tool that supports:
- PDF viewing and rendering
- Digital signatures with PKCS#11, PKCS#12, and NSS support
- Certificate management
- Signature profiles
- Configuration management`,
	PersistentPreRun: func(cmd *cobra.Command, args []string) {
		setupLogger()
	},
}

func Execute() {
	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}

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
