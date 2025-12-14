package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"syscall"

	"github.com/ferran/pdf_app/internal/config"
	"github.com/ferran/pdf_app/internal/signature"
	"github.com/spf13/cobra"
	"golang.org/x/term"
)

var signCmd = &cobra.Command{
	Use:   "sign",
	Short: "PDF signing operations",
	Long:  `Sign PDF documents with digital certificates and manage signature profiles.`,
}

var (
	signCertFingerprint string
	signPin             string
	signProfile         string
	signPage            int
	signX               float64
	signY               float64
	signWidth           float64
	signHeight          float64
	signOutput          string
)

var signPDFCmd = &cobra.Command{
	Use:   "pdf <pdf-file>",
	Short: "Sign a PDF document",
	Long:  `Sign a PDF document using a digital certificate. Supports PKCS#11 tokens, PKCS#12 files, and NSS databases.`,
	Args:  cobra.ExactArgs(1),
	Run: func(cmd *cobra.Command, args []string) {
		pdfPath := args[0]

		if _, err := os.Stat(pdfPath); os.IsNotExist(err) {
			ExitWithError("PDF file not found", err)
		}

		if signCertFingerprint == "" {
			ExitWithError("certificate fingerprint is required (use --cert flag)", nil)
		}

		cfgService, err := config.NewService()
		if err != nil {
			ExitWithError("failed to initialize config service", err)
		}
		service := signature.NewSignatureService(cfgService)
		service.Startup(context.Background())

		certs, err := service.ListCertificates()
		if err != nil {
			ExitWithError("failed to list certificates", err)
		}

		var cert *signature.Certificate
		for _, c := range certs {
			if c.Fingerprint == signCertFingerprint {
				cert = &c
				break
			}
		}

		if cert == nil {
			ExitWithError("certificate not found", nil)
		}

		if cert.RequiresPin && signPin == "" {
			fmt.Print("Enter PIN: ")
			pinBytes, err := term.ReadPassword(int(syscall.Stdin))
			fmt.Println()
			if err != nil {
				ExitWithError("failed to read PIN", err)
			}
			signPin = string(pinBytes)
		}

		GetLogger().Info("signing PDF", "file", SanitizePath(pdfPath), "cert", SanitizeCertName(cert.Name), "profile", signProfile)

		var outputPath string
		var signingErr error

		if signPage > 0 || signX > 0 || signY > 0 {
			position := &signature.SignaturePosition{
				Page:   signPage,
				X:      signX,
				Y:      signY,
				Width:  signWidth,
				Height: signHeight,
			}

			if signProfile == "" {
				profile, err := service.GetDefaultSignatureProfile()
				if err != nil {
					ExitWithError("failed to get default profile", err)
				}
				signProfile = profile.ID.String()
			}

			outputPath, signingErr = service.SignPDFWithProfileAndPosition(pdfPath, signCertFingerprint, signPin, signProfile, position)
		} else if signProfile != "" {
			outputPath, signingErr = service.SignPDFWithProfile(pdfPath, signCertFingerprint, signPin, signProfile)
		} else {
			outputPath, signingErr = service.SignPDF(pdfPath, signCertFingerprint, signPin)
		}

		if signingErr != nil {
			ExitWithError("failed to sign PDF", signingErr)
		}

		if signOutput != "" {
			if err := os.Rename(outputPath, signOutput); err != nil {
				GetLogger().Warn("failed to rename output file", "error", err)
				fmt.Printf("Signed PDF saved to: %s (failed to rename to %s)\n", outputPath, signOutput)
			} else {
				outputPath = signOutput
			}
		}

		GetLogger().Info("PDF signed successfully", "output", SanitizePath(outputPath))
		fmt.Printf("PDF signed successfully: %s\n", outputPath)
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

		signatures, err := service.VerifySignature(pdfPath)
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

func init() {
	rootCmd.AddCommand(signCmd)
	signCmd.AddCommand(signPDFCmd)
	signCmd.AddCommand(signVerifyCmd)
	signCmd.AddCommand(signProfileListCmd)
	signCmd.AddCommand(signProfileInfoCmd)

	signPDFCmd.Flags().StringVarP(&signCertFingerprint, "cert", "c", "", "certificate fingerprint (required)")
	signPDFCmd.Flags().StringVarP(&signPin, "pin", "p", "",
		"⚠️  SECURITY WARNING: PIN/password for certificate (if not provided, will prompt securely)\n"+
		"    Using this flag exposes your PIN in shell history and process list.\n"+
		"    For production use, omit this flag to be prompted securely.")
	signPDFCmd.Flags().StringVar(&signProfile, "profile", "", "signature profile ID")
	signPDFCmd.Flags().IntVar(&signPage, "page", 0, "page number for visible signature (0 = last page)")
	signPDFCmd.Flags().Float64Var(&signX, "x", 0, "x position for visible signature")
	signPDFCmd.Flags().Float64Var(&signY, "y", 0, "y position for visible signature")
	signPDFCmd.Flags().Float64Var(&signWidth, "width", 200, "width of visible signature")
	signPDFCmd.Flags().Float64Var(&signHeight, "height", 80, "height of visible signature")
	signPDFCmd.Flags().StringVarP(&signOutput, "output", "o", "", "output file path (default: <pdf>_signed.pdf)")
	signPDFCmd.MarkFlagRequired("cert")

	signVerifyCmd.Flags().BoolVarP(&jsonOutput, "json", "j", false, "output in JSON format")

	signProfileListCmd.Flags().BoolVarP(&jsonOutput, "json", "j", false, "output in JSON format")

	signProfileInfoCmd.Flags().BoolVarP(&jsonOutput, "json", "j", false, "output in JSON format")
}
