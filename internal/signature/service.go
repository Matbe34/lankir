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
