package signature

import (
	"context"
)

type SignatureService struct {
	ctx            context.Context
	profileManager *ProfileManager
}

func NewSignatureService() *SignatureService {
	return &SignatureService{
		profileManager: NewProfileManager(),
	}
}

func (s *SignatureService) Startup(ctx context.Context) {
	s.ctx = ctx
}

// ListSignatureProfiles returns all available signature profiles
func (s *SignatureService) ListSignatureProfiles() ([]*SignatureProfile, error) {
	return s.profileManager.ListProfiles()
}

// GetSignatureProfile retrieves a profile by ID
func (s *SignatureService) GetSignatureProfile(profileID string) (*SignatureProfile, error) {
	return s.profileManager.GetProfile(profileID)
}

// GetDefaultSignatureProfile returns the default signature profile
func (s *SignatureService) GetDefaultSignatureProfile() (*SignatureProfile, error) {
	return s.profileManager.GetDefaultProfile()
}

// SaveSignatureProfile saves or updates a signature profile
func (s *SignatureService) SaveSignatureProfile(profile *SignatureProfile) error {
	return s.profileManager.SaveProfile(profile)
}

// DeleteSignatureProfile deletes a signature profile by ID
func (s *SignatureService) DeleteSignatureProfile(profileID string) error {
	return s.profileManager.DeleteProfile(profileID)
}
