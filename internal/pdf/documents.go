package pdf

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// DocumentRoute is where ServeHTTP is mounted on the Wails asset server;
// pdf.js loads a document from DocumentRoute + id.
const DocumentRoute = "/doc/"

// Document is a PDF the GUI has open. The webview reads and writes it by its
// random id; the only paths it can name are files the user picked in a dialog
// or asked to open, and for Save As only the one chosen in ChooseSavePath.
type Document struct {
	ID       string    `json:"id"`
	Path     string    `json:"path"`
	FileName string    `json:"fileName"`
	Size     int64     `json:"size"`
	ModTime  time.Time `json:"modTime"`

	saveAsPath string
}

// Reasons for a ConflictError.
const (
	// ConflictChanged: the file changed on disk since it was opened or last saved.
	ConflictChanged = "changed"
	// ConflictOpen: the Save As target is open in another tab.
	ConflictOpen = "open"
)

// ConflictError is returned instead of writing when a save would clobber
// changes the app doesn't hold. It reaches the frontend as the error's cause.
type ConflictError struct {
	Reason string `json:"conflict"`
	Path   string `json:"path"`
}

func (e *ConflictError) Error() string {
	if e.Reason == ConflictOpen {
		return fmt.Sprintf("%s is open in another tab", e.Path)
	}
	return fmt.Sprintf("%s changed on disk", e.Path)
}

// PDFService keeps the registry of documents open in the GUI, serves their
// bytes to pdf.js and writes the bytes pdf.js produces back to disk.
type PDFService struct {
	mu   sync.RWMutex
	docs map[string]*Document
}

// NewPDFService creates an empty document registry.
func NewPDFService() *PDFService {
	return &PDFService{docs: map[string]*Document{}}
}

// OpenPDF shows a file dialog and registers the chosen PDF. It returns nil
// when the user cancels.
func (s *PDFService) OpenPDF() (*Document, error) {
	path, err := application.Get().Dialog.OpenFile().
		SetTitle("Select PDF File").
		AddFilter("PDF Files (*.pdf)", "*.pdf").
		PromptForSingleSelection()
	if err != nil || path == "" {
		return nil, err
	}
	return s.OpenPDFByPath(path)
}

// OpenPDFByPath registers the PDF at path under a new id.
func (s *PDFService) OpenPDFByPath(path string) (*Document, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	doc, err := describe(abs)
	if err != nil {
		return nil, err
	}
	doc.ID, err = newID()
	if err != nil {
		return nil, err
	}

	s.mu.Lock()
	s.docs[doc.ID] = doc
	s.mu.Unlock()
	copied := *doc
	return &copied, nil
}

// ClosePDF forgets the document with the given id.
func (s *PDFService) ClosePDF(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.docs[id]; !ok {
		return fmt.Errorf("unknown document %q", id)
	}
	delete(s.docs, id)
	return nil
}

// SavePDF replaces the document's file with data. Unless overwrite is set it
// refuses, with a ConflictError, when the file changed on disk since it was
// opened or last saved.
func (s *PDFService) SavePDF(id string, data []byte, overwrite bool) (*Document, error) {
	doc, err := s.get(id)
	if err != nil {
		return nil, err
	}
	if !overwrite {
		if info, err := os.Stat(doc.Path); err != nil || info.Size() != doc.Size || !info.ModTime().Equal(doc.ModTime) {
			return nil, &ConflictError{Reason: ConflictChanged, Path: doc.Path}
		}
	}
	return s.saveAs(id, doc.Path, data)
}

// SaveTarget is a destination picked in the Save As dialog.
type SaveTarget struct {
	Path   string `json:"path"`
	Exists bool   `json:"exists"`
}

// ChooseSavePath shows a Save As dialog next to the document, suggesting
// filename (the document's own name when empty). It returns nil when the user
// cancels. The GTK dialog doesn't confirm overwrites, so Exists tells the
// caller to ask.
func (s *PDFService) ChooseSavePath(id, filename string) (*SaveTarget, error) {
	doc, err := s.get(id)
	if err != nil {
		return nil, err
	}
	if filename == "" {
		filename = doc.FileName
	}
	dialog := application.Get().Dialog.SaveFile()
	dialog.SetOptions(&application.SaveFileDialogOptions{
		Title:                "Save PDF As",
		Directory:            filepath.Dir(doc.Path),
		Filename:             filename,
		CanCreateDirectories: true,
		Filters:              []application.FileFilter{{DisplayName: "PDF Files (*.pdf)", Pattern: "*.pdf"}},
	})
	path, err := dialog.PromptForSingleSelection()
	if err != nil || path == "" {
		return nil, err
	}
	if !strings.EqualFold(filepath.Ext(path), ".pdf") {
		path += ".pdf"
	}
	s.chooseSaveAsPath(id, path)
	_, statErr := os.Stat(path)
	return &SaveTarget{Path: path, Exists: statErr == nil}, nil
}

func (s *PDFService) chooseSaveAsPath(id, path string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if doc, ok := s.docs[id]; ok {
		doc.saveAsPath = path
	}
}

// SavePDFAs writes data to path, which must be the one ChooseSavePath last
// returned for the document; the document then refers to the new file. It
// refuses, with a ConflictError, a path open under another id.
func (s *PDFService) SavePDFAs(id, path string, data []byte) (*Document, error) {
	doc, err := s.get(id)
	if err != nil {
		return nil, err
	}
	if path == "" || path != doc.saveAsPath {
		return nil, fmt.Errorf("save path was not chosen in the Save As dialog: %q", path)
	}
	s.mu.RLock()
	for otherID, other := range s.docs {
		if otherID != id && other.Path == path {
			s.mu.RUnlock()
			return nil, &ConflictError{Reason: ConflictOpen, Path: path}
		}
	}
	s.mu.RUnlock()
	return s.saveAs(id, path, data)
}

func (s *PDFService) saveAs(id, path string, data []byte) (*Document, error) {
	if len(data) == 0 {
		return nil, errors.New("refusing to save an empty document")
	}
	if _, err := s.get(id); err != nil {
		return nil, err
	}
	if err := writeFileAtomic(path, data); err != nil {
		return nil, err
	}
	doc, err := describe(path)
	if err != nil {
		return nil, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.docs[id]; !ok {
		return nil, fmt.Errorf("unknown document %q", id)
	}
	doc.ID = id
	s.docs[id] = doc
	copied := *doc
	return &copied, nil
}

// ServeHTTP streams a registered document, and saves the body of a PUT like
// SavePDF (?overwrite=1) or SavePDFAs (?saveAs=<path>). Raw bytes avoid the
// binding call's base64 JSON body and its 64 MiB cap. The asset server strips
// DocumentRoute, so the request path is just the id.
func (s *PDFService) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPut {
		s.serveSave(w, r)
		return
	}
	doc, err := s.get(strings.TrimPrefix(r.URL.Path, "/"))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	f, err := os.Open(doc.Path)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Cache-Control", "no-store")
	http.ServeContent(w, r, "", info.ModTime(), f)
}

func (s *PDFService) serveSave(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/")
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, MaxPDFFileSizeBytes))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	query := r.URL.Query()
	var doc *Document
	if query.Has("saveAs") {
		doc, err = s.SavePDFAs(id, query.Get("saveAs"), data)
	} else {
		doc, err = s.SavePDF(id, data, query.Get("overwrite") == "1")
	}
	w.Header().Set("Content-Type", "application/json")
	var conflict *ConflictError
	switch {
	case errors.As(err, &conflict):
		w.WriteHeader(http.StatusConflict)
		_ = json.NewEncoder(w).Encode(conflict)
	case err != nil:
		http.Error(w, err.Error(), http.StatusInternalServerError)
	default:
		_ = json.NewEncoder(w).Encode(doc)
	}
}

func (s *PDFService) get(id string) (*Document, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	doc, ok := s.docs[id]
	if !ok {
		return nil, fmt.Errorf("unknown document %q", id)
	}
	copied := *doc
	return &copied, nil
}

func describe(path string) (*Document, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, fmt.Errorf("%s is not a regular file", path)
	}
	if info.Size() > MaxPDFFileSizeBytes {
		return nil, fmt.Errorf("PDF file too large: %d bytes (max %d bytes)", info.Size(), MaxPDFFileSizeBytes)
	}
	return &Document{Path: path, FileName: filepath.Base(path), Size: info.Size(), ModTime: info.ModTime()}, nil
}

func newID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// writeFileAtomic writes data to a temp file next to path, syncs it and
// renames it over path, so a failure never leaves a half-written PDF. A
// symlink is written through, an existing file keeps its permissions and a
// new one gets the umask's. A read-only file is refused, not replaced.
func writeFileAtomic(path string, data []byte) (err error) {
	if resolved, evalErr := filepath.EvalSymlinks(path); evalErr == nil {
		path = resolved
	}
	info, statErr := os.Stat(path)
	if statErr == nil && info.Mode().Perm()&0o200 == 0 {
		return fmt.Errorf("%s is read-only", path)
	}
	suffix, err := newID()
	if err != nil {
		return err
	}
	tmp, err := os.OpenFile(filepath.Join(filepath.Dir(path), "."+filepath.Base(path)+"."+suffix+".tmp"),
		os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o666)
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = tmp.Close()
			_ = os.Remove(tmp.Name())
		}
	}()
	if _, err = tmp.Write(data); err != nil {
		return err
	}
	if statErr == nil {
		if err = tmp.Chmod(info.Mode().Perm()); err != nil {
			return err
		}
	}
	if err = tmp.Sync(); err != nil {
		return err
	}
	if err = tmp.Close(); err != nil {
		return err
	}
	if err = os.Rename(tmp.Name(), path); err != nil {
		return err
	}
	if dir, dirErr := os.Open(filepath.Dir(path)); dirErr == nil {
		_ = dir.Sync()
		_ = dir.Close()
	}
	return nil
}
