package signature

import (
	"os"
	"testing"
	"time"

	"github.com/ferran/pdf_app/internal/signature/types"
	"github.com/google/uuid"
)

func TestSignatureProfileDefaults(t *testing.T) {
	// Test default invisible profile
	invisible := DefaultInvisibleProfile()
	expectedInvisibleID := uuid.MustParse("00000000-0000-0000-0000-000000000001")
	if invisible.ID != expectedInvisibleID {
		t.Errorf("Expected %s, got %s", expectedInvisibleID, invisible.ID)
	}
	if invisible.Visibility != VisibilityInvisible {
		t.Errorf("Expected invisible visibility, got %s", invisible.Visibility)
	}
	if !invisible.IsDefault {
		t.Error("Expected default invisible profile to be marked as default")
	}

	// Test default visible profile
	visible := DefaultVisibleProfile()
	expectedVisibleID := uuid.MustParse("00000000-0000-0000-0000-000000000002")
	if visible.ID != expectedVisibleID {
		t.Errorf("Expected %s, got %s", expectedVisibleID, visible.ID)
	}
	if visible.Visibility != VisibilityVisible {
		t.Errorf("Expected visible visibility, got %s", visible.Visibility)
	}
	if visible.IsDefault {
		t.Error("Expected default visible profile to not be marked as default")
	}

	// Verify visible profile has appearance settings
	if !visible.Appearance.ShowSignerName {
		t.Error("Expected visible profile to show signer name")
	}
	if !visible.Appearance.ShowSigningTime {
		t.Error("Expected visible profile to show signing time")
	}

	// Verify position is set for visible signature
	if visible.Position.Width <= 0 || visible.Position.Height <= 0 {
		t.Error("Expected visible signature to have positive dimensions")
	}
}

func TestProfileManager(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "profile-test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	pm := NewProfileManagerWithDir(tmpDir)

	// Test listing profiles
	profiles, err := pm.ListProfiles()
	if err != nil {
		t.Fatalf("Failed to list profiles: %v", err)
	}
	if len(profiles) != 2 {
		t.Errorf("Expected 2 default profiles, got %d", len(profiles))
	}

	// Test getting profile by ID
	invisibleID := uuid.MustParse("00000000-0000-0000-0000-000000000001")
	invisible, err := pm.GetProfile(invisibleID)
	if err != nil {
		t.Fatalf("Failed to get invisible profile: %v", err)
	}
	if invisible.Visibility != VisibilityInvisible {
		t.Error("Retrieved profile has wrong visibility")
	}

	// Test getting default profile
	defaultProfile, err := pm.GetDefaultProfile()
	if err != nil {
		t.Fatalf("Failed to get default profile: %v", err)
	}
	if !defaultProfile.IsDefault {
		t.Error("Default profile should be marked as default")
	}

	// Test getting non-existent profile
	_, err = pm.GetProfile(uuid.New())
	if err == nil {
		t.Error("Expected error when getting non-existent profile")
	}
}

func TestProfileValidation(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "profile-validation-test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	pm := NewProfileManagerWithDir(tmpDir)

	// Valid invisible profile
	validInvisible := &SignatureProfile{
		ID:         uuid.New(),
		Name:       "Test Invisible",
		Visibility: VisibilityInvisible,
	}
	if err := pm.ValidateProfile(validInvisible); err != nil {
		t.Errorf("Valid invisible profile failed validation: %v", err)
	}

	// Valid visible profile
	validVisible := &SignatureProfile{
		ID:         uuid.New(),
		Name:       "Test Visible",
		Visibility: VisibilityVisible,
		Position: SignaturePosition{
			Width:  200,
			Height: 80,
		},
	}
	if err := pm.ValidateProfile(validVisible); err != nil {
		t.Errorf("Valid visible profile failed validation: %v", err)
	}

	// Invalid: no ID
	invalidNoID := &SignatureProfile{
		Name:       "Test",
		Visibility: VisibilityInvisible,
	}
	if err := pm.ValidateProfile(invalidNoID); err == nil {
		t.Error("Profile without ID should fail validation")
	}

	// Invalid: no name
	invalidNoName := &SignatureProfile{
		ID:         uuid.New(),
		Visibility: VisibilityInvisible,
	}
	if err := pm.ValidateProfile(invalidNoName); err == nil {
		t.Error("Profile without name should fail validation")
	}

	// Invalid: visible without dimensions
	invalidNoDimensions := &SignatureProfile{
		ID:         uuid.New(),
		Name:       "Test",
		Visibility: VisibilityVisible,
		Position: SignaturePosition{
			Width:  0,
			Height: 0,
		},
	}
	if err := pm.ValidateProfile(invalidNoDimensions); err == nil {
		t.Error("Visible profile without dimensions should fail validation")
	}

	// Invalid: wrong visibility type
	invalidVisibility := &SignatureProfile{
		ID:         uuid.New(),
		Name:       "Test",
		Visibility: "wrong",
	}
	if err := pm.ValidateProfile(invalidVisibility); err == nil {
		t.Error("Profile with invalid visibility should fail validation")
	}
}

func TestCreateSignatureAppearance(t *testing.T) {
	cert := &types.Certificate{
		Name:         "Test User",
		Subject:      "CN=Test User, O=Test Org",
		Issuer:       "CN=Test CA",
		SerialNumber: "12345",
	}
	signingTime := time.Now()

	// Test invisible signature appearance
	invisibleProfile := DefaultInvisibleProfile()
	invisibleAppearance := CreateSignatureAppearance(invisibleProfile, cert, signingTime)
	if invisibleAppearance.Visible {
		t.Error("Invisible profile should create non-visible appearance")
	}

	// Test visible signature appearance
	visibleProfile := DefaultVisibleProfile()
	visibleAppearance := CreateSignatureAppearance(visibleProfile, cert, signingTime)
	if !visibleAppearance.Visible {
		t.Error("Visible profile should create visible appearance")
	}

	// Verify position is set correctly
	if visibleAppearance.LowerLeftX != visibleProfile.Position.X {
		t.Error("X position not set correctly")
	}
	if visibleAppearance.LowerLeftY != visibleProfile.Position.Y {
		t.Error("Y position not set correctly")
	}
	expectedUpperX := visibleProfile.Position.X + visibleProfile.Position.Width
	if visibleAppearance.UpperRightX != expectedUpperX {
		t.Errorf("Upper X position not calculated correctly: expected %f, got %f",
			expectedUpperX, visibleAppearance.UpperRightX)
	}
}
