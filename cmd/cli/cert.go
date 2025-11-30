package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/ferran/pdf_app/internal/signature"
	"github.com/spf13/cobra"
)

var certCmd = &cobra.Command{
	Use:   "cert",
	Short: "Certificate management",
	Long:  `Manage digital certificates from various sources including system stores, PKCS#11 tokens, and PKCS#12 files.`,
}

var (
	certSource    string
	certSearch    string
	certValidOnly bool
	certShowAll   bool
)

var certListCmd = &cobra.Command{
	Use:   "list",
	Short: "List available certificates",
	Long:  `List all available certificates from system stores, user stores, and PKCS#11 tokens.`,
	Run: func(cmd *cobra.Command, args []string) {
		service := signature.NewSignatureService()
		service.Startup(context.Background())

		GetLogger().Info("listing certificates", "source", certSource, "valid_only", certValidOnly)

		filter := signature.CertificateFilter{
			Source:    certSource,
			Search:    certSearch,
			ValidOnly: certValidOnly,
		}

		certs, err := service.ListCertificatesFiltered(filter)
		if err != nil {
			ExitWithError("failed to list certificates", err)
		}

		GetLogger().Debug("certificates retrieved", "count", len(certs))

		if jsonOutput {
			data, _ := json.MarshalIndent(certs, "", "  ")
			fmt.Println(string(data))
		} else {
			fmt.Printf("Found %d certificate(s):\n\n", len(certs))

			for i, cert := range certs {
				if !certShowAll && i >= 20 {
					fmt.Printf("\n... and %d more (use --all to show all)\n", len(certs)-20)
					break
				}

				fmt.Printf("Certificate %d:\n", i+1)
				fmt.Printf("  Name:          %s\n", cert.Name)
				fmt.Printf("  Subject:       %s\n", cert.Subject)
				fmt.Printf("  Issuer:        %s\n", cert.Issuer)
				fmt.Printf("  Serial:        %s\n", cert.SerialNumber)
				fmt.Printf("  Valid From:    %s\n", cert.ValidFrom)
				fmt.Printf("  Valid To:      %s\n", cert.ValidTo)
				fmt.Printf("  Fingerprint:   %s\n", cert.Fingerprint)
				fmt.Printf("  Source:        %s\n", cert.Source)
				fmt.Printf("  Valid:         %v\n", cert.IsValid)
				fmt.Printf("  Can Sign:      %v\n", cert.CanSign)
				if cert.RequiresPin {
					fmt.Printf("  Requires PIN:  yes\n")
				} else if cert.PinOptional {
					fmt.Printf("  Requires PIN:  optional\n")
				}
				if cert.FilePath != "" {
					fmt.Printf("  File Path:     %s\n", cert.FilePath)
				}
				if cert.PKCS11Module != "" {
					fmt.Printf("  PKCS11 Module: %s\n", cert.PKCS11Module)
				}
				if len(cert.KeyUsage) > 0 {
					fmt.Printf("  Key Usage:     %s\n", strings.Join(cert.KeyUsage, ", "))
				}
				fmt.Println()
			}
		}
	},
}

var certSearchCmd = &cobra.Command{
	Use:   "search <query>",
	Short: "Search for certificates",
	Long:  `Search for certificates by name, subject, issuer, or serial number.`,
	Args:  cobra.ExactArgs(1),
	Run: func(cmd *cobra.Command, args []string) {
		query := args[0]

		service := signature.NewSignatureService()
		service.Startup(context.Background())

		GetLogger().Info("searching certificates", "query", query)

		certs, err := service.SearchCertificates(query)
		if err != nil {
			ExitWithError("failed to search certificates", err)
		}

		GetLogger().Debug("certificates found", "count", len(certs))

		if jsonOutput {
			data, _ := json.MarshalIndent(certs, "", "  ")
			fmt.Println(string(data))
		} else {
			fmt.Printf("Found %d certificate(s) matching '%s':\n\n", len(certs), query)

			for i, cert := range certs {
				fmt.Printf("Certificate %d:\n", i+1)
				fmt.Printf("  Name:          %s\n", cert.Name)
				fmt.Printf("  Subject:       %s\n", cert.Subject)
				fmt.Printf("  Issuer:        %s\n", cert.Issuer)
				fmt.Printf("  Serial:        %s\n", cert.SerialNumber)
				fmt.Printf("  Valid From:    %s\n", cert.ValidFrom)
				fmt.Printf("  Valid To:      %s\n", cert.ValidTo)
				fmt.Printf("  Fingerprint:   %s\n", cert.Fingerprint)
				fmt.Printf("  Source:        %s\n", cert.Source)
				fmt.Printf("  Valid:         %v\n", cert.IsValid)
				fmt.Printf("  Can Sign:      %v\n", cert.CanSign)
				fmt.Println()
			}
		}
	},
}

var certInfoCmd = &cobra.Command{
	Use:   "info <fingerprint>",
	Short: "Display detailed certificate information",
	Long:  `Display detailed information for a specific certificate by fingerprint.`,
	Args:  cobra.ExactArgs(1),
	Run: func(cmd *cobra.Command, args []string) {
		fingerprint := args[0]

		service := signature.NewSignatureService()
		service.Startup(context.Background())

		GetLogger().Info("retrieving certificate info", "fingerprint", fingerprint)

		certs, err := service.ListCertificates()
		if err != nil {
			ExitWithError("failed to list certificates", err)
		}

		var targetCert *signature.Certificate
		for _, cert := range certs {
			if cert.Fingerprint == fingerprint {
				targetCert = &cert
				break
			}
		}

		if targetCert == nil {
			ExitWithError(fmt.Sprintf("certificate not found: %s", fingerprint), nil)
		}

		if jsonOutput {
			data, _ := json.MarshalIndent(targetCert, "", "  ")
			fmt.Println(string(data))
		} else {
			fmt.Printf("Certificate Information:\n\n")
			fmt.Printf("  Name:          %s\n", targetCert.Name)
			fmt.Printf("  Subject:       %s\n", targetCert.Subject)
			fmt.Printf("  Issuer:        %s\n", targetCert.Issuer)
			fmt.Printf("  Serial Number: %s\n", targetCert.SerialNumber)
			fmt.Printf("  Valid From:    %s\n", targetCert.ValidFrom)
			fmt.Printf("  Valid To:      %s\n", targetCert.ValidTo)
			fmt.Printf("  Fingerprint:   %s\n", targetCert.Fingerprint)
			fmt.Printf("  Source:        %s\n", targetCert.Source)
			fmt.Printf("  Is Valid:      %v\n", targetCert.IsValid)
			fmt.Printf("  Can Sign:      %v\n", targetCert.CanSign)
			fmt.Printf("  Requires PIN:  %v\n", targetCert.RequiresPin)
			fmt.Printf("  PIN Optional:  %v\n", targetCert.PinOptional)

			if targetCert.FilePath != "" {
				fmt.Printf("  File Path:     %s\n", targetCert.FilePath)
			}
			if targetCert.PKCS11Module != "" {
				fmt.Printf("  PKCS11 Module: %s\n", targetCert.PKCS11Module)
			}
			if targetCert.PKCS11URL != "" {
				fmt.Printf("  PKCS11 URL:    %s\n", targetCert.PKCS11URL)
			}
			if targetCert.NSSNickname != "" {
				fmt.Printf("  NSS Nickname:  %s\n", targetCert.NSSNickname)
			}

			if len(targetCert.KeyUsage) > 0 {
				fmt.Printf("\n  Key Usage:\n")
				for _, usage := range targetCert.KeyUsage {
					fmt.Printf("    - %s\n", usage)
				}
			}
		}
	},
}

func init() {
	rootCmd.AddCommand(certCmd)
	certCmd.AddCommand(certListCmd)
	certCmd.AddCommand(certSearchCmd)
	certCmd.AddCommand(certInfoCmd)

	certListCmd.Flags().StringVarP(&certSource, "source", "s", "", "filter by source (system, user, pkcs11)")
	certListCmd.Flags().StringVar(&certSearch, "search", "", "search query")
	certListCmd.Flags().BoolVar(&certValidOnly, "valid-only", false, "only show valid certificates")
	certListCmd.Flags().BoolVarP(&jsonOutput, "json", "j", false, "output in JSON format")
	certListCmd.Flags().BoolVar(&certShowAll, "all", false, "show all certificates (default: limit to 20)")

	certSearchCmd.Flags().BoolVarP(&jsonOutput, "json", "j", false, "output in JSON format")

	certInfoCmd.Flags().BoolVarP(&jsonOutput, "json", "j", false, "output in JSON format")
}