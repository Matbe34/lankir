package signature

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// SignatureVisibility defines whether a signature is visible or invisible
type SignatureVisibility string

const (
	VisibilityInvisible SignatureVisibility = "invisible"
	VisibilityVisible   SignatureVisibility = "visible"
)

// SignaturePosition defines where a visible signature appears on the page
type SignaturePosition struct {
	Page   int     `json:"page"`   // Page number (1-indexed, 0 = last page, -1 = first page)
	X      float64 `json:"x"`      // X coordinate (in points, from left)
	Y      float64 `json:"y"`      // Y coordinate (in points, from bottom)
	Width  float64 `json:"width"`  // Width of signature box
	Height float64 `json:"height"` // Height of signature box
}

// SignatureAppearance defines the visual content of a visible signature
type SignatureAppearance struct {
	ShowSignerName      bool   `json:"showSignerName"`            // Show the certificate name/DN
	ShowSigningTime     bool   `json:"showSigningTime"`           // Show timestamp
	ShowReason          bool   `json:"showReason"`                // Show reason for signing
	ShowLocation        bool   `json:"showLocation"`              // Show location
	ShowCertificateInfo bool   `json:"showCertificateInfo"`       // Show cert issuer/serial
	ShowLogo            bool   `json:"showLogo"`                  // Show custom logo (future)
	LogoPath            string `json:"logoPath,omitempty"`        // Path to logo image (future)
	CustomText          string `json:"customText,omitempty"`      // Additional custom text (future)
	FontSize            int    `json:"fontSize"`                  // Font size for text (future)
	BackgroundColor     string `json:"backgroundColor,omitempty"` // Hex color (future)
	TextColor           string `json:"textColor,omitempty"`       // Hex color (future)
}

// SignatureProfile represents a reusable signing configuration
// In the future, users can create, save, and manage multiple profiles
type SignatureProfile struct {
	ID          string              `json:"id"`          // Unique identifier
	Name        string              `json:"name"`        // User-friendly name
	Description string              `json:"description"` // Optional description
	Visibility  SignatureVisibility `json:"visibility"`  // Invisible or visible
	Position    SignaturePosition   `json:"position"`    // Where to place signature (if visible)
	Appearance  SignatureAppearance `json:"appearance"`  // What to show (if visible)
	Reason      string              `json:"reason"`      // Default reason for signing
	Location    string              `json:"location"`    // Default location
	ContactInfo string              `json:"contactInfo"` // Default contact info
	IsDefault   bool                `json:"isDefault"`   // Whether this is the default profile
}

// DefaultInvisibleProfile returns the default invisible signature profile
// This maintains backward compatibility with existing behavior
func DefaultInvisibleProfile() *SignatureProfile {
	return &SignatureProfile{
		ID:          "default-invisible",
		Name:        "Invisible Signature",
		Description: "Digital signature without visible appearance",
		Visibility:  VisibilityInvisible,
		Reason:      "Document digitally signed",
		Location:    "Digital Signature",
		ContactInfo: "",
		IsDefault:   true,
		Position: SignaturePosition{
			Page:   0, // Not used for invisible
			X:      0,
			Y:      0,
			Width:  0,
			Height: 0,
		},
		Appearance: SignatureAppearance{
			ShowSignerName:  false,
			ShowSigningTime: false,
			ShowReason:      false,
			ShowLocation:    false,
		},
	}
}

// DefaultVisibleProfile returns a default visible signature profile
// Shows signer name and timestamp in bottom-right of last page
func DefaultVisibleProfile() *SignatureProfile {
	return &SignatureProfile{
		ID:          "default-visible",
		Name:        "Visible Signature",
		Description: "Visible signature with signer name and timestamp",
		Visibility:  VisibilityVisible,
		Reason:      "Document digitally signed",
		Location:    "Digital Signature",
		ContactInfo: "",
		IsDefault:   false,
		Position: SignaturePosition{
			Page:   0,   // 0 = last page
			X:      360, // Right side of A4 page (595pt wide)
			Y:      50,  // Bottom of page
			Width:  200,
			Height: 80,
		},
		Appearance: SignatureAppearance{
			ShowSignerName:      true,
			ShowSigningTime:     true,
			ShowReason:          false,
			ShowLocation:        false,
			ShowCertificateInfo: false,
			FontSize:            10,
		},
	}
}

// ProfileManager handles storage and retrieval of signature profiles
// Currently returns built-in profiles, but designed to support
// future persistence (file-based or database)
type ProfileManager struct {
	configDir string
}

// NewProfileManager creates a new profile manager
func NewProfileManager() *ProfileManager {
	// Prepare for future file-based storage
	homeDir, _ := os.UserHomeDir()
	configDir := filepath.Join(homeDir, ".config", "pdf_app", "signature_profiles")

	return &ProfileManager{
		configDir: configDir,
	}
}

// ListProfiles returns all available signature profiles
// Currently returns built-in profiles
// Future: will read from config directory
func (pm *ProfileManager) ListProfiles() ([]*SignatureProfile, error) {
	profiles := []*SignatureProfile{
		DefaultInvisibleProfile(),
		DefaultVisibleProfile(),
	}

	// Future: load custom profiles from configDir
	// if err := pm.loadCustomProfiles(&profiles); err != nil {
	//     return nil, err
	// }

	return profiles, nil
}

// GetProfile retrieves a profile by ID
func (pm *ProfileManager) GetProfile(id string) (*SignatureProfile, error) {
	profiles, err := pm.ListProfiles()
	if err != nil {
		return nil, err
	}

	for _, profile := range profiles {
		if profile.ID == id {
			return profile, nil
		}
	}

	return nil, fmt.Errorf("profile not found: %s", id)
}

// GetDefaultProfile returns the default signature profile
func (pm *ProfileManager) GetDefaultProfile() (*SignatureProfile, error) {
	profiles, err := pm.ListProfiles()
	if err != nil {
		return nil, err
	}

	for _, profile := range profiles {
		if profile.IsDefault {
			return profile, nil
		}
	}

	// Fallback to invisible profile
	return DefaultInvisibleProfile(), nil
}

// SaveProfile saves a custom signature profile
// Future implementation: persist to file system
func (pm *ProfileManager) SaveProfile(profile *SignatureProfile) error {
	// Validate profile
	if profile.ID == "" {
		return fmt.Errorf("profile ID cannot be empty")
	}
	if profile.Name == "" {
		return fmt.Errorf("profile name cannot be empty")
	}

	// Future: ensure config directory exists
	// if err := os.MkdirAll(pm.configDir, 0755); err != nil {
	//     return fmt.Errorf("failed to create config directory: %w", err)
	// }

	// Future: save to file
	// profilePath := filepath.Join(pm.configDir, profile.ID+".json")
	// data, err := json.MarshalIndent(profile, "", "  ")
	// if err != nil {
	//     return fmt.Errorf("failed to marshal profile: %w", err)
	// }
	// if err := os.WriteFile(profilePath, data, 0644); err != nil {
	//     return fmt.Errorf("failed to write profile: %w", err)
	// }

	// For now, just validate that JSON serialization works
	_, err := json.MarshalIndent(profile, "", "  ")
	if err != nil {
		return fmt.Errorf("invalid profile structure: %w", err)
	}

	return fmt.Errorf("saving custom profiles not yet implemented")
}

// DeleteProfile deletes a custom signature profile
// Future implementation
func (pm *ProfileManager) DeleteProfile(id string) error {
	// Prevent deletion of built-in profiles
	if id == "default-invisible" || id == "default-visible" {
		return fmt.Errorf("cannot delete built-in profile")
	}

	// Future: delete profile file
	// profilePath := filepath.Join(pm.configDir, id+".json")
	// if err := os.Remove(profilePath); err != nil {
	//     return fmt.Errorf("failed to delete profile: %w", err)
	// }

	return fmt.Errorf("deleting custom profiles not yet implemented")
}

// ValidateProfile checks if a profile is valid
func (pm *ProfileManager) ValidateProfile(profile *SignatureProfile) error {
	if profile.ID == "" {
		return fmt.Errorf("profile ID is required")
	}
	if profile.Name == "" {
		return fmt.Errorf("profile name is required")
	}
	if profile.Visibility != VisibilityInvisible && profile.Visibility != VisibilityVisible {
		return fmt.Errorf("invalid visibility: %s", profile.Visibility)
	}

	if profile.Visibility == VisibilityVisible {
		if profile.Position.Width <= 0 || profile.Position.Height <= 0 {
			return fmt.Errorf("visible signature must have positive width and height (got width=%.2f, height=%.2f)",
				profile.Position.Width, profile.Position.Height)
		}
		if profile.Position.Page <= 0 {
			return fmt.Errorf("visible signature must have valid page number (got page=%d)", profile.Position.Page)
		}
	}

	return nil
}
