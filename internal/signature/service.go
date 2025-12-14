package signature

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/ferran/pdf_app/internal/config"
	"github.com/ferran/pdf_app/internal/signature/pkcs11"
	"github.com/ferran/pdf_app/internal/signature/pkcs12"
)

type SignatureService struct {
	ctx            context.Context
	profileManager *ProfileManager
	configService  *config.Service
}

func NewSignatureService(cfgService *config.Service) *SignatureService {
	return &SignatureService{
		profileManager: NewProfileManager(),
		configService:  cfgService,
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

// AddCertificateStore adds a new certificate store path
func (s *SignatureService) AddCertificateStore(path string) error {
	cfg := s.configService.Get()

	// Check if already exists
	for _, store := range cfg.CertificateStores {
		if store == path {
			return fmt.Errorf("store already exists")
		}
	}

	cfg.CertificateStores = append(cfg.CertificateStores, path)
	return s.configService.Update(cfg)
}

// RemoveCertificateStore removes a certificate store path
func (s *SignatureService) RemoveCertificateStore(path string) error {
	cfg := s.configService.Get()

	newStores := []string{}
	found := false
	for _, store := range cfg.CertificateStores {
		if store == path {
			found = true
			continue
		}
		newStores = append(newStores, store)
	}

	if !found {
		return fmt.Errorf("store not found")
	}

	cfg.CertificateStores = newStores
	return s.configService.Update(cfg)
}

// AddTokenLibrary adds a new PKCS#11 library path
func (s *SignatureService) AddTokenLibrary(path string) error {
	cfg := s.configService.Get()

	// Check if already exists
	for _, lib := range cfg.TokenLibraries {
		if lib == path {
			return fmt.Errorf("library already exists")
		}
	}

	cfg.TokenLibraries = append(cfg.TokenLibraries, path)
	return s.configService.Update(cfg)
}

// RemoveTokenLibrary removes a PKCS#11 library path
func (s *SignatureService) RemoveTokenLibrary(path string) error {
	cfg := s.configService.Get()

	newLibs := []string{}
	found := false
	for _, lib := range cfg.TokenLibraries {
		if lib == path {
			found = true
			continue
		}
		newLibs = append(newLibs, lib)
	}

	if !found {
		return fmt.Errorf("library not found")
	}

	cfg.TokenLibraries = newLibs
	return s.configService.Update(cfg)
}

// GetDefaultCertificateSources returns the default certificate store paths
func (s *SignatureService) GetDefaultCertificateSources() map[string][]string {
	homeDir, _ := os.UserHomeDir()

	userDirs := make([]string, len(pkcs12.DefaultUserCertDirs))
	for i, relDir := range pkcs12.DefaultUserCertDirs {
		userDirs[i] = filepath.Join(homeDir, relDir)
	}

	return map[string][]string{
		"system": pkcs12.DefaultSystemCertDirs,
		"user":   userDirs,
	}
}

// GetDefaultTokenLibraries returns the default PKCS#11 module paths
func (s *SignatureService) GetDefaultTokenLibraries() []string {
	return pkcs11.DefaultModules
}
