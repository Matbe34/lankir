package signature

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/ferran/pdf_app/internal/config"
	"github.com/ferran/pdf_app/internal/signature/pkcs11"
	"github.com/ferran/pdf_app/internal/signature/pkcs12"
	"github.com/google/uuid"
)

// SignatureService manages digital signature operations including certificate discovery,
// PDF signing, signature verification, and signature profile management.
// It supports multiple certificate backends: PKCS#12 files, PKCS#11 hardware tokens, and NSS databases.
type SignatureService struct {
	ctx            context.Context
	profileManager *ProfileManager
	configService  *config.Service
}

// NewSignatureService creates a new signature service instance with the given configuration service.
func NewSignatureService(cfgService *config.Service) *SignatureService {
	return &SignatureService{
		profileManager: NewProfileManager(),
		configService:  cfgService,
	}
}

// Startup initializes the service with the application context.
// This is called by the Wails runtime during application startup.
func (s *SignatureService) Startup(ctx context.Context) {
	s.ctx = ctx
}

// ListSignatureProfiles returns all available signature profiles
func (s *SignatureService) ListSignatureProfiles() ([]*SignatureProfile, error) {
	return s.profileManager.ListProfiles()
}

// GetSignatureProfile retrieves a profile by ID (accepts string from frontend, parses to UUID)
func (s *SignatureService) GetSignatureProfile(profileIDStr string) (*SignatureProfile, error) {
	profileID, err := uuid.Parse(profileIDStr)
	if err != nil {
		return nil, fmt.Errorf("invalid profile ID format: %w", err)
	}
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

// DeleteSignatureProfile deletes a signature profile by ID (accepts string from frontend, parses to UUID)
func (s *SignatureService) DeleteSignatureProfile(profileIDStr string) error {
	profileID, err := uuid.Parse(profileIDStr)
	if err != nil {
		return fmt.Errorf("invalid profile ID format: %w", err)
	}
	return s.profileManager.DeleteProfile(profileID)
}

// validateCertificateStorePath validates that a path is safe to use as a certificate store
func validateCertificateStorePath(path string) error {
	// Basic validation
	if path == "" {
		return fmt.Errorf("path cannot be empty")
	}

	if !filepath.IsAbs(path) {
		return fmt.Errorf("path must be absolute")
	}

	cleanPath := filepath.Clean(path)

	resolvedPath := cleanPath
	if resolved, err := filepath.EvalSymlinks(cleanPath); err == nil {
		resolvedPath = resolved
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("failed to resolve path: %w", err)
	}

	resolvedPath = filepath.Clean(resolvedPath)

	homeDir, _ := os.UserHomeDir()
	allowedPrefixes := []string{
		"/etc/ssl/certs",
		"/usr/share/ca-certificates",
		"/etc/pki/ca-trust",
		"/etc/pki/tls/certs",
	}

	if homeDir != "" {
		allowedPrefixes = append(allowedPrefixes, homeDir)
	}

	allowed := false
	for _, prefix := range allowedPrefixes {
		if strings.HasPrefix(resolvedPath, prefix) {
			allowed = true
			break
		}
	}
	if !allowed {
		return fmt.Errorf("path not in allowed directories (must be in user home or system cert directories)")
	}

	// Check that the path is a directory if it exists
	if stat, err := os.Stat(resolvedPath); err == nil {
		if !stat.IsDir() {
			return fmt.Errorf("path must be a directory")
		}
	}

	return nil
}

// AddCertificateStore adds a new certificate store path
func (s *SignatureService) AddCertificateStore(path string) error {
	// Validate the path
	if err := validateCertificateStorePath(path); err != nil {
		return fmt.Errorf("invalid certificate store path: %w", err)
	}

	cfg := s.configService.Get()

	// Check if already exists
	for _, store := range cfg.CertificateStores {
		if store == path {
			return fmt.Errorf("certificate store already exists")
		}
	}

	cfg.CertificateStores = append(cfg.CertificateStores, path)
	return s.configService.Update(cfg)
}

// RemoveCertificateStore removes a certificate store path
func (s *SignatureService) RemoveCertificateStore(path string) error {
	cfg := s.configService.Get()

	originalLen := len(cfg.CertificateStores)
	cfg.CertificateStores = slices.DeleteFunc(cfg.CertificateStores, func(store string) bool {
		return store == path
	})

	if len(cfg.CertificateStores) == originalLen {
		return fmt.Errorf("certificate store %s not found", path)
	}

	return s.configService.Update(cfg)
}

// validateTokenLibraryPath validates that a path is safe to use as a PKCS#11 library
func validateTokenLibraryPath(path string) error {
	if path == "" {
		return fmt.Errorf("path cannot be empty")
	}

	if !filepath.IsAbs(path) {
		return fmt.Errorf("path must be absolute")
	}

	cleanPath := filepath.Clean(path)

	resolvedPath := cleanPath
	if resolved, err := filepath.EvalSymlinks(cleanPath); err == nil {
		resolvedPath = resolved
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("failed to resolve path: %w", err)
	}

	resolvedPath = filepath.Clean(resolvedPath)

	if strings.Contains(resolvedPath, "..") {
		return fmt.Errorf("path contains invalid directory traversal")
	}

	if stat, err := os.Stat(resolvedPath); err == nil {
		if stat.IsDir() {
			return fmt.Errorf("path must be a file, not a directory")
		}
	}

	ext := strings.ToLower(filepath.Ext(resolvedPath))
	validExts := []string{".so", ".dylib", ".dll"}
	validExt := false
	for _, validExtension := range validExts {
		if ext == validExtension || strings.HasSuffix(resolvedPath, validExtension) {
			validExt = true
			break
		}
	}
	if !validExt {
		return fmt.Errorf("file must have a valid shared library extension (.so, .dylib, or .dll)")
	}

	return nil
}

// AddTokenLibrary adds a new PKCS#11 library path
func (s *SignatureService) AddTokenLibrary(path string) error {
	if err := validateTokenLibraryPath(path); err != nil {
		return fmt.Errorf("invalid PKCS#11 library path: %w", err)
	}

	cfg := s.configService.Get()

	// Check if already exists
	for _, lib := range cfg.TokenLibraries {
		if lib == path {
			return fmt.Errorf("PKCS#11 library already exists")
		}
	}

	cfg.TokenLibraries = append(cfg.TokenLibraries, path)
	return s.configService.Update(cfg)
}

// RemoveTokenLibrary removes a PKCS#11 library path
func (s *SignatureService) RemoveTokenLibrary(path string) error {
	cfg := s.configService.Get()

	originalLen := len(cfg.TokenLibraries)
	cfg.TokenLibraries = slices.DeleteFunc(cfg.TokenLibraries, func(lib string) bool {
		return lib == path
	})

	if len(cfg.TokenLibraries) == originalLen {
		return fmt.Errorf("PKCS#11 library %s not found", path)
	}

	return s.configService.Update(cfg)
}

// GetDefaultCertificateSources returns the default certificate store paths
func (s *SignatureService) GetDefaultCertificateSources() map[string][]string {
	result := map[string][]string{
		"system": pkcs12.DefaultSystemCertDirs,
		"user":   []string{},
	}

	// Only add user directories if home directory is available
	homeDir, err := os.UserHomeDir()
	if err == nil {
		userDirs := make([]string, len(pkcs12.DefaultUserCertDirs))
		for i, relDir := range pkcs12.DefaultUserCertDirs {
			userDirs[i] = filepath.Join(homeDir, relDir)
		}
		result["user"] = userDirs
	}

	return result
}

// GetDefaultTokenLibraries returns the default PKCS#11 module paths
func (s *SignatureService) GetDefaultTokenLibraries() []string {
	return pkcs11.DefaultModules
}
