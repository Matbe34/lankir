package signature

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Matbe34/lankir/internal/signature/types"
	"github.com/google/uuid"
)

// TestDefaultInvisibleProfile tests default invisible profile
func TestDefaultInvisibleProfile(t *testing.T) {
	profile := DefaultInvisibleProfile()

	if profile == nil {
		t.Fatal("profile is nil")
	}

	expectedID := uuid.MustParse("00000000-0000-0000-0000-000000000001")
	if profile.ID != expectedID {
		t.Errorf("Expected ID %s, got %s", expectedID, profile.ID)
	}
	if profile.Visibility != VisibilityInvisible {
		t.Errorf("Expected invisible visibility, got %s", profile.Visibility)
	}
	if !profile.IsDefault {
		t.Error("Should be marked as default")
	}
	if profile.Name == "" {
		t.Error("Name should not be empty")
	}
}

// TestDefaultVisibleProfile tests default visible profile
func TestDefaultVisibleProfile(t *testing.T) {
	profile := DefaultVisibleProfile()

	if profile == nil {
		t.Fatal("profile is nil")
	}

	expectedID := uuid.MustParse("00000000-0000-0000-0000-000000000002")
	if profile.ID != expectedID {
		t.Errorf("Expected ID %s, got %s", expectedID, profile.ID)
	}
	if profile.Visibility != VisibilityVisible {
		t.Errorf("Expected visible visibility, got %s", profile.Visibility)
	}
	if profile.IsDefault {
		t.Error("Visible profile should not be default")
	}
	if profile.Name == "" {
		t.Error("Name should not be empty")
	}
	if profile.Position.Width <= 0 || profile.Position.Height <= 0 {
		t.Error("Visible profile should have positive dimensions")
	}
	if !profile.Appearance.ShowSignerName {
		t.Error("Should show signer name")
	}
	if !profile.Appearance.ShowSigningTime {
		t.Error("Should show signing time")
	}
}

// TestNewProfileManager tests profile manager creation
func TestNewProfileManager(t *testing.T) {
	pm := NewProfileManager()

	if pm == nil {
		t.Fatal("profile manager is nil")
	}
	if pm.configDir == "" {
		t.Error("configDir not set")
	}
}

// TestNewProfileManagerWithDir tests profile manager with custom directory
func TestNewProfileManagerWithDir(t *testing.T) {
	tmpDir := t.TempDir()

	pm := NewProfileManagerWithDir(tmpDir)

	if pm == nil {
		t.Fatal("profile manager is nil")
	}
	if pm.configDir != tmpDir {
		t.Errorf("Expected configDir %s, got %s", tmpDir, pm.configDir)
	}
}

// TestListProfiles tests profile listing
func TestListProfiles(t *testing.T) {
	tmpDir := t.TempDir()
	pm := NewProfileManagerWithDir(tmpDir)

	profiles, err := pm.ListProfiles()
	if err != nil {
		t.Fatalf("ListProfiles failed: %v", err)
	}

	if len(profiles) != 2 {
		t.Errorf("Expected 2 default profiles, got %d", len(profiles))
	}

	// Should have one invisible and one visible
	hasInvisible := false
	hasVisible := false
	for _, p := range profiles {
		if p.Visibility == VisibilityInvisible {
			hasInvisible = true
		}
		if p.Visibility == VisibilityVisible {
			hasVisible = true
		}
	}

	if !hasInvisible || !hasVisible {
		t.Error("Missing default profiles")
	}
}

// TestGetProfile tests getting profile by ID
func TestGetProfile(t *testing.T) {
	tmpDir := t.TempDir()
	pm := NewProfileManagerWithDir(tmpDir)

	invisibleID := uuid.MustParse("00000000-0000-0000-0000-000000000001")

	profile, err := pm.GetProfile(invisibleID)
	if err != nil {
		t.Fatalf("GetProfile failed: %v", err)
	}

	if profile == nil {
		t.Fatal("profile is nil")
	}
	if profile.ID != invisibleID {
		t.Error("Wrong profile returned")
	}
}

// TestGetProfile_NonExistent tests getting nonexistent profile
func TestGetProfile_NonExistent(t *testing.T) {
	tmpDir := t.TempDir()
	pm := NewProfileManagerWithDir(tmpDir)

	randomID := uuid.New()

	_, err := pm.GetProfile(randomID)
	if err == nil {
		t.Error("Expected error for nonexistent profile")
	}
}

// TestGetDefaultProfile tests getting default profile
func TestGetDefaultProfile(t *testing.T) {
	tmpDir := t.TempDir()
	pm := NewProfileManagerWithDir(tmpDir)

	profile, err := pm.GetDefaultProfile()
	if err != nil {
		t.Fatalf("GetDefaultProfile failed: %v", err)
	}

	if profile == nil {
		t.Fatal("profile is nil")
	}
	if !profile.IsDefault {
		t.Error("Profile not marked as default")
	}
	if profile.Visibility != VisibilityInvisible {
		t.Error("Default should be invisible")
	}
}

// TestSaveProfile tests saving a profile
func TestSaveProfile(t *testing.T) {
	tmpDir := t.TempDir()
	pm := NewProfileManagerWithDir(tmpDir)

	newProfile := &SignatureProfile{
		ID:          uuid.New(),
		Name:        "Test Profile",
		Description: "Test description",
		Visibility:  VisibilityInvisible,
		IsDefault:   false,
	}

	err := pm.SaveProfile(newProfile)
	if err != nil {
		t.Fatalf("SaveProfile failed: %v", err)
	}

	// Verify it was saved
	loaded, err := pm.GetProfile(newProfile.ID)
	if err != nil {
		t.Fatalf("Failed to load saved profile: %v", err)
	}

	if loaded.Name != newProfile.Name {
		t.Errorf("Expected name %s, got %s", newProfile.Name, loaded.Name)
	}
	if loaded.Description != newProfile.Description {
		t.Error("Description not saved correctly")
	}
}

// TestSaveProfile_Update tests updating existing profile
func TestSaveProfile_Update(t *testing.T) {
	tmpDir := t.TempDir()
	pm := NewProfileManagerWithDir(tmpDir)

	profile := &SignatureProfile{
		ID:         uuid.New(),
		Name:       "Original Name",
		Visibility: VisibilityInvisible,
	}

	pm.SaveProfile(profile)

	// Update it
	profile.Name = "Updated Name"
	profile.Description = "New description"

	err := pm.SaveProfile(profile)
	if err != nil {
		t.Fatalf("SaveProfile update failed: %v", err)
	}

	// Verify updates
	loaded, _ := pm.GetProfile(profile.ID)
	if loaded.Name != "Updated Name" {
		t.Error("Name not updated")
	}
	if loaded.Description != "New description" {
		t.Error("Description not updated")
	}
}

// TestDeleteProfile tests profile deletion
func TestDeleteProfile(t *testing.T) {
	tmpDir := t.TempDir()
	pm := NewProfileManagerWithDir(tmpDir)

	profile := &SignatureProfile{
		ID:         uuid.New(),
		Name:       "To Delete",
		Visibility: VisibilityInvisible,
	}

	pm.SaveProfile(profile)

	err := pm.DeleteProfile(profile.ID)
	if err != nil {
		t.Fatalf("DeleteProfile failed: %v", err)
	}

	// Verify it's gone
	_, err = pm.GetProfile(profile.ID)
	if err == nil {
		t.Error("Profile still exists after deletion")
	}
}

// TestDeleteProfile_NonExistent tests deleting nonexistent profile
func TestDeleteProfile_NonExistent(t *testing.T) {
	tmpDir := t.TempDir()
	pm := NewProfileManagerWithDir(tmpDir)

	randomID := uuid.New()

	err := pm.DeleteProfile(randomID)
	if err == nil {
		t.Error("Expected error for nonexistent profile")
	}
}

// TestValidateProfile tests profile validation
func TestValidateProfile(t *testing.T) {
	tmpDir := t.TempDir()
	pm := NewProfileManagerWithDir(tmpDir)

	tests := []struct {
		name    string
		profile *SignatureProfile
		wantErr bool
	}{
		{
			name: "valid invisible",
			profile: &SignatureProfile{
				ID:         uuid.New(),
				Name:       "Test",
				Visibility: VisibilityInvisible,
			},
			wantErr: false,
		},
		{
			name: "valid visible",
			profile: &SignatureProfile{
				ID:         uuid.New(),
				Name:       "Test",
				Visibility: VisibilityVisible,
				Position: SignaturePosition{
					Width:  200,
					Height: 80,
				},
			},
			wantErr: false,
		},
		{
			name: "no ID",
			profile: &SignatureProfile{
				Name:       "Test",
				Visibility: VisibilityInvisible,
			},
			wantErr: true,
		},
		{
			name: "no name",
			profile: &SignatureProfile{
				ID:         uuid.New(),
				Visibility: VisibilityInvisible,
			},
			wantErr: true,
		},
		{
			name: "invalid visibility",
			profile: &SignatureProfile{
				ID:         uuid.New(),
				Name:       "Test",
				Visibility: "invalid",
			},
			wantErr: true,
		},
		{
			name: "visible without dimensions",
			profile: &SignatureProfile{
				ID:         uuid.New(),
				Name:       "Test",
				Visibility: VisibilityVisible,
				Position: SignaturePosition{
					Width:  0,
					Height: 0,
				},
			},
			wantErr: true,
		},
		{
			name: "visible with negative width",
			profile: &SignatureProfile{
				ID:         uuid.New(),
				Name:       "Test",
				Visibility: VisibilityVisible,
				Position: SignaturePosition{
					Width:  -10,
					Height: 80,
				},
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := pm.ValidateProfile(tt.profile)
			if (err != nil) != tt.wantErr {
				t.Errorf("ValidateProfile() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

// TestLoadCustomProfiles tests loading profiles from disk
func TestLoadCustomProfiles(t *testing.T) {
	tmpDir := t.TempDir()
	pm := NewProfileManagerWithDir(tmpDir)

	// Save some profiles
	profile1 := &SignatureProfile{
		ID:         uuid.New(),
		Name:       "Profile 1",
		Visibility: VisibilityInvisible,
	}
	profile2 := &SignatureProfile{
		ID:         uuid.New(),
		Name:       "Profile 2",
		Visibility: VisibilityVisible,
		Position: SignaturePosition{
			Width:  200,
			Height: 80,
		},
	}

	pm.SaveProfile(profile1)
	pm.SaveProfile(profile2)

	// Create new manager to force reload
	pm2 := NewProfileManagerWithDir(tmpDir)

	profiles, err := pm2.ListProfiles()
	if err != nil {
		t.Fatalf("ListProfiles failed: %v", err)
	}

	if len(profiles) != 2 {
		t.Errorf("Expected 2 loaded profiles, got %d", len(profiles))
	}

	// Verify profiles were loaded
	foundProfile1 := false
	foundProfile2 := false
	for _, p := range profiles {
		if p.ID == profile1.ID {
			foundProfile1 = true
		}
		if p.ID == profile2.ID {
			foundProfile2 = true
		}
	}

	if !foundProfile1 || !foundProfile2 {
		t.Error("Not all profiles were loaded")
	}
}

// TestCreateSignatureAppearance tests signature appearance creation
func TestCreateSignatureAppearance(t *testing.T) {
	cert := &types.Certificate{
		Name:    "Test User",
		Subject: "CN=Test User",
		Issuer:  "CN=Test CA",
	}
	signingTime := time.Now()

	t.Run("invisible", func(t *testing.T) {
		profile := DefaultInvisibleProfile()
		appearance := CreateSignatureAppearance(profile, cert, signingTime)

		if appearance.Visible {
			t.Error("Invisible profile should create non-visible appearance")
		}
	})

	t.Run("visible", func(t *testing.T) {
		profile := DefaultVisibleProfile()
		appearance := CreateSignatureAppearance(profile, cert, signingTime)

		if !appearance.Visible {
			t.Error("Visible profile should create visible appearance")
		}

		// Check position
		if appearance.LowerLeftX != profile.Position.X {
			t.Error("X position incorrect")
		}
		if appearance.LowerLeftY != profile.Position.Y {
			t.Error("Y position incorrect")
		}

		expectedUpperX := profile.Position.X + profile.Position.Width
		if appearance.UpperRightX != expectedUpperX {
			t.Errorf("UpperRightX incorrect: expected %.2f, got %.2f", expectedUpperX, appearance.UpperRightX)
		}

		expectedUpperY := profile.Position.Y + profile.Position.Height
		if appearance.UpperRightY != expectedUpperY {
			t.Errorf("UpperRightY incorrect: expected %.2f, got %.2f", expectedUpperY, appearance.UpperRightY)
		}
	})

	t.Run("visible with signer name", func(t *testing.T) {
		profile := DefaultVisibleProfile()
		profile.Appearance.ShowSignerName = true

		appearance := CreateSignatureAppearance(profile, cert, signingTime)

		// The appearance content should be generated
		// We can't easily test the exact content without knowing the implementation
		// But we can verify it's not empty
		if !appearance.Visible {
			t.Error("Should be visible")
		}
	})
}

// TestSignatureVisibility tests visibility constants
func TestSignatureVisibility(t *testing.T) {
	if VisibilityInvisible == "" {
		t.Error("VisibilityInvisible should not be empty")
	}
	if VisibilityVisible == "" {
		t.Error("VisibilityVisible should not be empty")
	}
	if VisibilityInvisible == VisibilityVisible {
		t.Error("Visibility constants should be different")
	}
}

// TestSignaturePosition tests position structure
func TestSignaturePosition(t *testing.T) {
	pos := SignaturePosition{
		Page:   1,
		X:      100,
		Y:      200,
		Width:  300,
		Height: 100,
	}

	if pos.Page != 1 {
		t.Error("Page not set correctly")
	}
	if pos.Width <= 0 || pos.Height <= 0 {
		t.Error("Dimensions should be positive")
	}
}

// TestSignatureAppearance tests appearance structure
func TestSignatureAppearance(t *testing.T) {
	appearance := SignatureAppearance{
		ShowSignerName:  true,
		ShowSigningTime: true,
		ShowLocation:    false,
		FontSize:        10,
	}

	if !appearance.ShowSignerName {
		t.Error("ShowSignerName not set")
	}
	if !appearance.ShowSigningTime {
		t.Error("ShowSigningTime not set")
	}
	if appearance.FontSize <= 0 {
		t.Error("FontSize should be positive")
	}
}

// TestProfilePersistence tests that profiles persist across manager instances
func TestProfilePersistence(t *testing.T) {
	tmpDir := t.TempDir()

	// Create and save profile
	pm1 := NewProfileManagerWithDir(tmpDir)
	profile := &SignatureProfile{
		ID:          uuid.New(),
		Name:        "Persistent",
		Description: "Should persist",
		Visibility:  VisibilityInvisible,
	}

	err := pm1.SaveProfile(profile)
	if err != nil {
		t.Fatalf("SaveProfile failed: %v", err)
	}

	// Create new manager and verify profile exists
	pm2 := NewProfileManagerWithDir(tmpDir)
	loaded, err := pm2.GetProfile(profile.ID)
	if err != nil {
		t.Fatalf("Profile not found after reload: %v", err)
	}

	if loaded.Name != profile.Name {
		t.Error("Profile data not persisted correctly")
	}
}

// TestProfileFilePermissions tests profile file permissions
func TestProfileFilePermissions(t *testing.T) {
	tmpDir := t.TempDir()
	pm := NewProfileManagerWithDir(tmpDir)

	profile := &SignatureProfile{
		ID:         uuid.New(),
		Name:       "Test",
		Visibility: VisibilityInvisible,
	}

	pm.SaveProfile(profile)

	profilePath := filepath.Join(tmpDir, profile.ID.String()+".json")
	info, err := os.Stat(profilePath)
	if err != nil {
		t.Fatalf("Failed to stat profile file: %v", err)
	}

	mode := info.Mode().Perm()
	expected := os.FileMode(0600)

	if mode != expected {
		t.Errorf("Profile file has incorrect permissions: got %o, want %o", mode, expected)
	}
}

// TestDefaultSignatureConstants tests default signature dimensions
func TestDefaultSignatureConstants(t *testing.T) {
	if DefaultSignatureWidth <= 0 {
		t.Error("DefaultSignatureWidth should be positive")
	}
	if DefaultSignatureHeight <= 0 {
		t.Error("DefaultSignatureHeight should be positive")
	}
}

// TestProfileManagerWithManyProfiles tests handling many profiles
func TestProfileManagerWithManyProfiles(t *testing.T) {
	tmpDir := t.TempDir()
	pm := NewProfileManagerWithDir(tmpDir)

	// Create many profiles
	const numProfiles = 50
	ids := make([]uuid.UUID, numProfiles)

	for i := 0; i < numProfiles; i++ {
		profile := &SignatureProfile{
			ID:         uuid.New(),
			Name:       "Profile " + string(rune('A'+i%26)),
			Visibility: VisibilityInvisible,
		}
		ids[i] = profile.ID
		pm.SaveProfile(profile)
	}

	// List all profiles
	profiles, err := pm.ListProfiles()
	if err != nil {
		t.Fatalf("ListProfiles failed: %v", err)
	}

	if len(profiles) != numProfiles {
		t.Errorf("Expected %d profiles, got %d", numProfiles, len(profiles))
	}

	// Verify all can be retrieved
	for _, id := range ids {
		_, err := pm.GetProfile(id)
		if err != nil {
			t.Errorf("Failed to get profile %s: %v", id, err)
		}
	}
}
