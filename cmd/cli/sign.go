package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/ferran/pdf_app/internal/config"
	"github.com/ferran/pdf_app/internal/signature"
	"github.com/ferran/pdf_app/internal/signature/types"
	"github.com/spf13/cobra"
)

var signCmd = &cobra.Command{
	Use:   "sign",
	Short: "PDF signing operations",
	Long:  `Sign PDF documents with digital certificates and manage signature profiles.`,
}

var signPDFCmd = &cobra.Command{
	Use:   "pdf <input-pdf> <output-pdf>",
	Short: "Sign a PDF file",
	Long:  `Sign a PDF file using a digital certificate. You can specify the certificate by fingerprint, name, or file path.`,
	Args:  cobra.ExactArgs(2),
	Run: func(cmd *cobra.Command, args []string) {
		inputPath := args[0]
		outputPath := args[1]

		if _, err := os.Stat(inputPath); os.IsNotExist(err) {
			ExitWithError(fmt.Sprintf("input file not found: %s", inputPath), nil)
		}

		cfgService, err := config.NewService()
		if err != nil {
			ExitWithError("failed to initialize config service", err)
		}
		service := signature.NewSignatureService(cfgService)
		service.Startup(context.Background())

		var cert *types.Certificate

		if signCertFile != "" {
			GetLogger().Info("loading certificate from file", "path", signCertFile)

			certs, err := service.ListCertificates()
			if err != nil {
				ExitWithError("failed to list certificates", err)
			}

			absPath, _ := filepath.Abs(signCertFile)
			for _, c := range certs {
				if c.FilePath == signCertFile || c.FilePath == absPath {
					cert = &c
					break
				}
			}

			if cert == nil {
				ExitWithError(fmt.Sprintf("certificate file not found in available sources: %s", signCertFile), nil)
			}
		} else if signCertFingerprint != "" {
			GetLogger().Info("finding certificate by fingerprint", "fingerprint", signCertFingerprint)
			certs, err := service.ListCertificates()
			if err != nil {
				ExitWithError("failed to list certificates", err)
			}

			for _, c := range certs {
				if c.Fingerprint == signCertFingerprint {
					cert = &c
					break
				}
			}

			if cert == nil {
				ExitWithError(fmt.Sprintf("certificate with fingerprint %s not found", signCertFingerprint), nil)
			}
		} else if signCertName != "" {
			GetLogger().Info("finding certificate by name", "name", signCertName)
			results, err := service.SearchCertificates(signCertName)
			if err != nil {
				ExitWithError("failed to search certificates", err)
			}

			if len(results) == 0 {
				ExitWithError(fmt.Sprintf("no certificate found matching name: %s", signCertName), nil)
			} else if len(results) > 1 {
				fmt.Printf("Found %d certificates matching '%s'. Please specify fingerprint:\n", len(results), signCertName)
				for _, c := range results {
					fmt.Printf("  - %s (Fingerprint: %s)\n", c.Name, c.Fingerprint)
				}
				os.Exit(1)
			}

			cert = &results[0]
		} else {
			ExitWithError("please specify a certificate using --file, --fingerprint, or --name", nil)
		}

		GetLogger().Info("using certificate", "name", cert.Name, "fingerprint", cert.Fingerprint)

		if cert.RequiresPin || (cert.PinOptional && signPin != "") {
			if signPin == "" {
				fmt.Print("Enter PIN: ")
				var pin string
				fmt.Scanln(&pin)
				signPin = pin
			}
		}

		var profileID string
		var position *signature.SignaturePosition

		if signVisible {
			defProfile := signature.DefaultVisibleProfile()
			profileID = defProfile.ID.String()

			position = &signature.SignaturePosition{
				Page:   signPage,
				X:      signX,
				Y:      signY,
				Width:  signWidth,
				Height: signHeight,
			}
		} else {
			defProfile := signature.DefaultInvisibleProfile()
			profileID = defProfile.ID.String()
		}

		GetLogger().Info("signing PDF", "input", inputPath)

		generatedPath, err := service.SignPDFWithProfileAndPosition(inputPath, cert.Fingerprint, signPin, profileID, position)
		if err != nil {
			ExitWithError("failed to sign PDF", err)
		}

		if generatedPath != outputPath {
			if err := os.Rename(generatedPath, outputPath); err != nil {
				ExitWithError(fmt.Sprintf("failed to move signed file from %s to %s", generatedPath, outputPath), err)
			}
		}

		fmt.Printf("Successfully signed PDF: %s\n", outputPath)
	},
}

var signVerifyCmd = &cobra.Command{
	Use:   "verify <pdf-file>",
	Short: "Verify PDF signatures",
	Long:  `Verify digital signatures in a PDF document.`,
	Args:  cobra.ExactArgs(1),
	Run: func(cmd *cobra.Command, args []string) {
		pdfPath := args[0]

		if _, err := os.Stat(pdfPath); os.IsNotExist(err) {
			ExitWithError("PDF file not found", err)
		}

		cfgService, err := config.NewService()
		if err != nil {
			ExitWithError("failed to initialize config service", err)
		}
		service := signature.NewSignatureService(cfgService)
		service.Startup(context.Background())

		GetLogger().Info("verifying signatures", "file", SanitizePath(pdfPath))

		signatures, err := service.VerifySignatures(pdfPath)
		if err != nil {
			ExitWithError("failed to verify signatures", err)
		}

		if len(signatures) == 0 {
			fmt.Println("No signatures found in PDF")
			return
		}

		if jsonOutput {
			data, err := json.MarshalIndent(signatures, "", "  ")
			if err != nil {
				ExitWithError("failed to marshal signatures to JSON", err)
			}
			fmt.Println(string(data))
		} else {
			fmt.Printf("Found %d signature(s):\n\n", len(signatures))

			for i, sig := range signatures {
				fmt.Printf("Signature %d:\n", i+1)
				fmt.Printf("  Signer Name:    %s\n", sig.SignerName)
				fmt.Printf("  Signer DN:      %s\n", sig.SignerDN)
				fmt.Printf("  Signing Time:   %s\n", sig.SigningTime)
				fmt.Printf("  Signature Type: %s\n", sig.SignatureType)
				fmt.Printf("  Hash Algorithm: %s\n", sig.SigningHashAlgorithm)
				fmt.Printf("  Valid:          %v\n", sig.IsValid)
				fmt.Printf("  Cert Valid:     %v\n", sig.CertificateValid)
				fmt.Printf("  Validation:     %s\n", sig.ValidationMessage)
				if sig.CertificateValidationMessage != "" {
					fmt.Printf("  Cert Status:    %s\n", sig.CertificateValidationMessage)
				}
				if sig.Reason != "" {
					fmt.Printf("  Reason:         %s\n", sig.Reason)
				}
				if sig.Location != "" {
					fmt.Printf("  Location:       %s\n", sig.Location)
				}
				if sig.ContactInfo != "" {
					fmt.Printf("  Contact:        %s\n", sig.ContactInfo)
				}
				fmt.Println()
			}
		}
	},
}

var signProfileListCmd = &cobra.Command{
	Use:   "profile-list",
	Short: "List signature profiles",
	Long:  `List all available signature profiles.`,
	Run: func(cmd *cobra.Command, args []string) {
		cfgService, err := config.NewService()
		if err != nil {
			ExitWithError("failed to initialize config service", err)
		}
		service := signature.NewSignatureService(cfgService)
		service.Startup(context.Background())

		GetLogger().Info("listing signature profiles")

		profiles, err := service.ListSignatureProfiles()
		if err != nil {
			ExitWithError("failed to list profiles", err)
		}

		if jsonOutput {
			data, err := json.MarshalIndent(profiles, "", "  ")
			if err != nil {
				ExitWithError("failed to marshal profiles to JSON", err)
			}
			fmt.Println(string(data))
		} else {
			fmt.Printf("Found %d signature profile(s):\n\n", len(profiles))

			for i, profile := range profiles {
				fmt.Printf("Profile %d:\n", i+1)
				fmt.Printf("  ID:          %s\n", profile.ID)
				fmt.Printf("  Name:        %s\n", profile.Name)
				fmt.Printf("  Description: %s\n", profile.Description)
				fmt.Printf("  Visibility:  %s\n", profile.Visibility)
				fmt.Printf("  Default:     %v\n", profile.IsDefault)

				if profile.Visibility == signature.VisibilityVisible {
					fmt.Printf("  Position:\n")
					fmt.Printf("    Page:   %d\n", profile.Position.Page)
					fmt.Printf("    X:      %.2f\n", profile.Position.X)
					fmt.Printf("    Y:      %.2f\n", profile.Position.Y)
					fmt.Printf("    Width:  %.2f\n", profile.Position.Width)
					fmt.Printf("    Height: %.2f\n", profile.Position.Height)
					fmt.Printf("  Appearance:\n")
					fmt.Printf("    Show Signer Name:  %v\n", profile.Appearance.ShowSignerName)
					fmt.Printf("    Show Signing Time: %v\n", profile.Appearance.ShowSigningTime)
					fmt.Printf("    Show Location:     %v\n", profile.Appearance.ShowLocation)
					fmt.Printf("    Show Logo:         %v\n", profile.Appearance.ShowLogo)
					fmt.Printf("    Font Size:         %d\n", profile.Appearance.FontSize)
				}
				fmt.Println()
			}
		}
	},
}

var signProfileInfoCmd = &cobra.Command{
	Use:   "profile-info <profile-id>",
	Short: "Display signature profile details",
	Long:  `Display detailed information for a specific signature profile.`,
	Args:  cobra.ExactArgs(1),
	Run: func(cmd *cobra.Command, args []string) {
		profileID := args[0]

		cfgService, err := config.NewService()
		if err != nil {
			ExitWithError("failed to initialize config service", err)
		}
		service := signature.NewSignatureService(cfgService)
		service.Startup(context.Background())

		GetLogger().Info("retrieving profile info", "id", profileID)

		profile, err := service.GetSignatureProfile(profileID)
		if err != nil {
			ExitWithError("failed to get profile", err)
		}

		if jsonOutput {
			data, err := json.MarshalIndent(profile, "", "  ")
			if err != nil {
				ExitWithError("failed to marshal profile to JSON", err)
			}
			fmt.Println(string(data))
		} else {
			fmt.Printf("Signature Profile:\n\n")
			fmt.Printf("  ID:          %s\n", profile.ID)
			fmt.Printf("  Name:        %s\n", profile.Name)
			fmt.Printf("  Description: %s\n", profile.Description)
			fmt.Printf("  Visibility:  %s\n", profile.Visibility)
			fmt.Printf("  Default:     %v\n", profile.IsDefault)

			if profile.Visibility == signature.VisibilityVisible {
				fmt.Printf("\n  Position:\n")
				fmt.Printf("    Page:   %d\n", profile.Position.Page)
				fmt.Printf("    X:      %.2f\n", profile.Position.X)
				fmt.Printf("    Y:      %.2f\n", profile.Position.Y)
				fmt.Printf("    Width:  %.2f\n", profile.Position.Width)
				fmt.Printf("    Height: %.2f\n", profile.Position.Height)

				fmt.Printf("\n  Appearance:\n")
				fmt.Printf("    Show Signer Name:  %v\n", profile.Appearance.ShowSignerName)
				fmt.Printf("    Show Signing Time: %v\n", profile.Appearance.ShowSigningTime)
				fmt.Printf("    Show Location:     %v\n", profile.Appearance.ShowLocation)
				fmt.Printf("    Show Logo:         %v\n", profile.Appearance.ShowLogo)
				if profile.Appearance.LogoPath != "" {
					fmt.Printf("    Logo Path:         %s\n", profile.Appearance.LogoPath)
				}
				if profile.Appearance.CustomText != "" {
					fmt.Printf("    Custom Text:       %s\n", profile.Appearance.CustomText)
				}
				fmt.Printf("    Font Size:         %d\n", profile.Appearance.FontSize)
			}
		}
	},
}

var (
	signCertFile        string
	signCertFingerprint string
	signCertName        string
	signPin             string
	signPage            int
	signX               float64
	signY               float64
	signWidth           float64
	signHeight          float64
	signVisible         bool
)

func init() {
	rootCmd.AddCommand(signCmd)
	signCmd.AddCommand(signPDFCmd)
	signCmd.AddCommand(signVerifyCmd)
	signCmd.AddCommand(signProfileListCmd)
	signCmd.AddCommand(signProfileInfoCmd)

	signPDFCmd.Flags().StringVarP(&signCertFile, "cert-file", "f", "", "path to certificate file (p12/pfx)")
	signPDFCmd.Flags().StringVar(&signCertFingerprint, "fingerprint", "", "certificate fingerprint")
	signPDFCmd.Flags().StringVarP(&signCertName, "name", "n", "", "certificate name (partial match)")
	signPDFCmd.Flags().StringVar(&signPin, "pin", "", "PIN/password for the certificate")

	signPDFCmd.Flags().IntVar(&signPage, "page", 1, "page number to sign (1-based)")
	signPDFCmd.Flags().Float64Var(&signX, "x", 100, "x coordinate")
	signPDFCmd.Flags().Float64Var(&signY, "y", 100, "y coordinate")
	signPDFCmd.Flags().Float64Var(&signWidth, "width", 200, "signature width")
	signPDFCmd.Flags().Float64Var(&signHeight, "height", 100, "signature height")

	signPDFCmd.Flags().BoolVar(&signVisible, "visible", true, "create a visible signature")

	signVerifyCmd.Flags().BoolVarP(&jsonOutput, "json", "j", false, "output in JSON format")
	signProfileListCmd.Flags().BoolVarP(&jsonOutput, "json", "j", false, "output in JSON format")
	signProfileInfoCmd.Flags().BoolVarP(&jsonOutput, "json", "j", false, "output in JSON format")
}
