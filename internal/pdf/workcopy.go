package pdf

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu"
	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/Matbe34/lankir/internal/pdfops"
)

// Page and document operations don't write the user's file. Each one produces a
// working copy under the user cache dir that /doc/<id> serves instead, until a
// save writes the content to disk (or close, revert or undo drops it). The
// stack of copies is the undo history.

// maxUndoSteps bounds the working copies kept per document; the oldest one
// beyond it stays as the floor that undo can't go past.
const maxUndoSteps = 20

// SaveOptions change how the next save of a document is written.
type SaveOptions struct {
	// Rewrite has Go rewrite the bytes instead of writing them as they are:
	// decrypted with the document's password (see SetPassword) if they are
	// encrypted, optimized if asked, then encrypted with Password if set.
	Rewrite bool `json:"rewrite"`
	// Password protects the rewritten file (AES-256) as both the user and
	// owner password.
	Password string `json:"password"`
	// Optimize applies pdfcpu's size optimizations in the rewrite.
	Optimize bool `json:"optimize"`
}

// SetPassword tells Go the password the document was opened with, so pdfcpu
// operations and rewriting saves can decrypt it.
func (s *PDFService) SetPassword(id, password string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	doc, ok := s.docs[id]
	if !ok {
		return fmt.Errorf("unknown document %q", id)
	}
	doc.password = password
	return nil
}

// SetSaveOptions applies opts to the next SavePDF or SavePDFAs call of the
// document only, whether it succeeds or not.
func (s *PDFService) SetSaveOptions(id string, opts SaveOptions) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	doc, ok := s.docs[id]
	if !ok {
		return fmt.Errorf("unknown document %q", id)
	}
	doc.saveOpts = opts
	return nil
}

// takeSaveOptions returns a copy of the document and clears its save options.
func (s *PDFService) takeSaveOptions(id string) (*Document, SaveOptions, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	doc, ok := s.docs[id]
	if !ok {
		return nil, SaveOptions{}, fmt.Errorf("unknown document %q", id)
	}
	opts := doc.saveOpts
	doc.saveOpts = SaveOptions{}
	copied := *doc
	return &copied, opts, nil
}

// PushWorkingCopy makes data the document's content, as a new undo step.
// pdf.js builds data, and its page editor drops the document information
// (title, author…) of merged files and stamps its own creator and producer,
// so the current content's information is put back.
func (s *PDFService) PushWorkingCopy(id string, data []byte) (*Document, error) {
	if len(data) == 0 {
		return nil, errors.New("refusing an empty working copy")
	}
	doc, err := s.get(id)
	if err != nil {
		return nil, err
	}
	return s.newWorkingCopy(id, false, func(in, out string) error {
		if err := os.WriteFile(out, data, 0o600); err != nil {
			return err
		}
		keepInfo(in, out, doc.password)
		return nil
	})
}

// keepInfo gives out the document information of in, modified now, unless
// out has it already, as pdf.js' incremental saves do. It is best effort: a
// file pdfcpu can't read stays as it is.
func keepInfo(in, out, password string) {
	plainIn, plainOut := out+".in", out+".plain"
	defer os.Remove(plainIn)
	defer os.Remove(plainOut)
	from, err := decryptedFile(in, plainIn, password)
	if err != nil {
		return
	}
	to, err := decryptedFile(out, plainOut, password)
	if err != nil {
		return
	}
	_ = pdfops.CopyInfo(from, to, out)
}

// The pdfcpu operations below work on a decrypted copy of a protected
// document, and so produce an unprotected working copy.

// RotatePages turns pages (1-based) of the current content clockwise by
// degrees, a multiple of 90.
func (s *PDFService) RotatePages(id string, pages []int, degrees int) (*Document, error) {
	return s.newWorkingCopy(id, true, func(in, out string) error { return pdfops.Rotate(in, out, pages, degrees) })
}

// InsertBlankPage adds a blank page after page after (0 = at the front).
func (s *PDFService) InsertBlankPage(id string, after int) (*Document, error) {
	return s.newWorkingCopy(id, true, func(in, out string) error { return pdfops.InsertBlankPage(in, out, after) })
}

// SetMetadata replaces the document information entries (empty ones are removed).
func (s *PDFService) SetMetadata(id string, m pdfops.Metadata) (*Document, error) {
	return s.newWorkingCopy(id, true, func(in, out string) error { return pdfops.SetMetadata(in, out, m) })
}

// UndoPageOp takes back the newest working copy; RedoPageOp can bring it back
// until the next operation.
func (s *PDFService) UndoPageOp(id string) (*Document, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	doc, ok := s.docs[id]
	if !ok {
		return nil, fmt.Errorf("unknown document %q", id)
	}
	if doc.UndoSteps == 0 {
		return nil, errors.New("nothing to undo")
	}
	last := len(doc.work) - 1
	doc.dropReplaced()
	doc.undone = append(doc.undone, doc.work[last])
	doc.work = doc.work[:last]
	doc.updateWorkState()
	copied := *doc
	return &copied, nil
}

// DropPageOp takes back the newest working copy as if it had never been
// pushed: it isn't kept for redo, and the redo steps it replaced come back.
// A page operation that fails calls it for the copy of unsaved edits it
// pushed to build on. A push that went past the undo bound already removed
// the oldest copy, which a drop doesn't bring back: undo then stops one step
// short.
func (s *PDFService) DropPageOp(id string) (*Document, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	doc, ok := s.docs[id]
	if !ok {
		return nil, fmt.Errorf("unknown document %q", id)
	}
	if doc.UndoSteps == 0 {
		return nil, errors.New("nothing to drop")
	}
	last := len(doc.work) - 1
	_ = os.Remove(doc.work[last])
	doc.work = doc.work[:last]
	doc.dropUndone()
	doc.undone, doc.replaced = doc.replaced, nil
	doc.updateWorkState()
	copied := *doc
	return &copied, nil
}

// RedoPageOp brings back the working copy UndoPageOp last took back.
func (s *PDFService) RedoPageOp(id string) (*Document, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	doc, ok := s.docs[id]
	if !ok {
		return nil, fmt.Errorf("unknown document %q", id)
	}
	if len(doc.undone) == 0 {
		return nil, errors.New("nothing to redo")
	}
	last := len(doc.undone) - 1
	doc.dropReplaced()
	doc.work = append(doc.work, doc.undone[last])
	doc.undone = doc.undone[:last]
	doc.updateWorkState()
	copied := *doc
	return &copied, nil
}

// RevertToSaved drops every working copy and pending save option, and takes
// the file as it is on disk now as the document's saved state.
func (s *PDFService) RevertToSaved(id string) (*Document, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	doc, ok := s.docs[id]
	if !ok {
		return nil, fmt.Errorf("unknown document %q", id)
	}
	fresh, err := describe(doc.Path)
	if err != nil {
		return nil, err
	}
	doc.dropWork()
	doc.Size, doc.ModTime = fresh.Size, fresh.ModTime
	doc.saveOpts = SaveOptions{}
	copied := *doc
	return &copied, nil
}

// ChooseExportFolder shows a folder dialog for files split from the
// document; ExportPDF then accepts new PDFs directly inside it. It returns ""
// when the user cancels.
func (s *PDFService) ChooseExportFolder(id string) (string, error) {
	doc, err := s.get(id)
	if err != nil {
		return "", err
	}
	dir, err := application.Get().Dialog.OpenFile().
		SetTitle("Choose a folder for the split files").
		SetDirectory(filepath.Dir(doc.Path)).
		CanChooseFiles(false).
		CanChooseDirectories(true).
		CanCreateDirectories(true).
		PromptForSingleSelection()
	if err != nil || dir == "" {
		return "", err
	}
	s.chooseExportDir(id, dir)
	return dir, nil
}

func (s *PDFService) chooseExportDir(id, dir string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if doc, ok := s.docs[id]; ok {
		doc.exportDir = filepath.Clean(dir)
	}
}

// ExportPDF writes data to a new file without changing the document: path is
// the one ChooseSavePath last returned, or a .pdf directly inside the folder
// ChooseExportFolder returned. An existing file is only replaced with
// overwrite, and never one that is open. Save options set just before (see
// SetSaveOptions) apply to this write, e.g. to protect it with a password.
func (s *PDFService) ExportPDF(id, path string, data []byte, overwrite bool) error {
	doc, opts, err := s.takeSaveOptions(id)
	if err != nil {
		return err
	}
	chosen := path != "" && path == doc.saveAsPath
	inFolder := doc.exportDir != "" && filepath.Dir(path) == doc.exportDir && strings.EqualFold(filepath.Ext(path), ".pdf")
	if !chosen && !inFolder {
		return fmt.Errorf("export path was not chosen in a dialog: %q", path)
	}
	if len(data) == 0 {
		return errors.New("refusing to export an empty document")
	}
	s.mu.RLock()
	for _, other := range s.docs {
		if other.Path == path {
			s.mu.RUnlock()
			return &ConflictError{Reason: ConflictOpen, Path: path}
		}
	}
	s.mu.RUnlock()
	if _, err := os.Stat(path); err == nil && !overwrite {
		return &ConflictError{Reason: ConflictExists, Path: path}
	}
	if opts.Rewrite {
		s.mu.Lock()
		dir, err := s.sessionDir()
		s.mu.Unlock()
		if err != nil {
			return err
		}
		if data, err = rewriteForSave(dir, data, opts, doc.password); err != nil {
			return err
		}
	}
	return writeFileAtomic(path, data)
}

// OpenPDFs shows a multi-select file dialog and registers each chosen PDF,
// e.g. to insert its pages into another document. It returns an empty list
// when the user cancels.
func (s *PDFService) OpenPDFs() ([]*Document, error) {
	paths, err := application.Get().Dialog.OpenFile().
		SetTitle("Select PDF Files").
		AddFilter("PDF Files (*.pdf)", "*.pdf").
		PromptForMultipleSelection()
	if err != nil {
		return nil, err
	}
	docs := []*Document{}
	for _, p := range paths {
		doc, err := s.OpenPDFByPath(p)
		if err != nil {
			for _, d := range docs {
				_ = s.ClosePDF(d.ID)
			}
			return nil, err
		}
		docs = append(docs, doc)
	}
	return docs, nil
}

// ServiceStartup removes, best effort, the working copies of sessions on
// this host that ended without ServiceShutdown, by a crash or a kill: those
// of protected files are decrypted. Another host's sessions, in a home
// shared over the network, are left alone: their processes can't be seen.
// So are this host's from before its name changed (DHCP, or macOS naming it
// by network): they stay until a start under the old name.
func (s *PDFService) ServiceStartup(context.Context, application.ServiceOptions) error {
	base, err := workBase()
	if err != nil {
		return nil
	}
	entries, err := os.ReadDir(base)
	if err != nil {
		return nil
	}
	prefix := "session-" + sessionHost() + "-"
	for _, e := range entries {
		rest, ours := strings.CutPrefix(e.Name(), prefix)
		pid, _, named := strings.Cut(rest, "-")
		n, err := strconv.Atoi(pid)
		if ours && named && err == nil && e.IsDir() && !processAlive(n) {
			_ = os.RemoveAll(filepath.Join(base, e.Name()))
		}
	}
	return nil
}

// ServiceShutdown removes this session's working copies when the app exits.
func (s *PDFService) ServiceShutdown() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.workDir == "" {
		return nil
	}
	err := os.RemoveAll(s.workDir)
	s.workDir = ""
	return err
}

// newWorkingCopy runs op from the document's current content (decrypted
// first if decrypt is set) to a new file and, if it succeeds, pushes that
// file as the newest working copy.
func (s *PDFService) newWorkingCopy(id string, decrypt bool, op func(in, out string) error) (*Document, error) {
	s.mu.Lock()
	doc, ok := s.docs[id]
	if !ok {
		s.mu.Unlock()
		return nil, fmt.Errorf("unknown document %q", id)
	}
	in, password := doc.source(), doc.password
	out, err := s.newWorkPath(id)
	s.mu.Unlock()
	if err != nil {
		return nil, err
	}
	if decrypt {
		plain := out + ".plain"
		defer os.Remove(plain)
		if in, err = decryptedFile(in, plain, password); err != nil {
			return nil, err
		}
	}
	err = op(in, out)
	if err == nil {
		// pdfops gives a new file the umask's mode.
		err = os.Chmod(out, 0o600)
	}
	if err != nil {
		_ = os.Remove(out)
		return nil, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	doc, ok = s.docs[id]
	if !ok {
		_ = os.Remove(out)
		return nil, fmt.Errorf("unknown document %q", id)
	}
	doc.dropReplaced()
	doc.replaced, doc.undone = doc.undone, nil
	doc.work = append(doc.work, out)
	if len(doc.work) > maxUndoSteps+1 {
		_ = os.Remove(doc.work[0])
		doc.work = doc.work[1:]
		doc.trimmed = true
	}
	doc.updateWorkState()
	copied := *doc
	return &copied, nil
}

// newWorkPath reserves a file name in this session's working-copy dir.
// Callers hold s.mu.
func (s *PDFService) newWorkPath(id string) (string, error) {
	dir, err := s.sessionDir()
	if err != nil {
		return "", err
	}
	s.workSeq++
	return filepath.Join(dir, fmt.Sprintf("%s-%d.pdf", id, s.workSeq)), nil
}

// sessionDir creates this process's working-copy dir on first use, named
// with its host and process id for ServiceStartup. Windows opened with Ctrl+Shift+N
// are processes of their own, so each gets one. Callers hold s.mu.
func (s *PDFService) sessionDir() (string, error) {
	if s.workDir != "" {
		return s.workDir, nil
	}
	base, err := workBase()
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(base, 0o700); err != nil {
		return "", err
	}
	if s.workDir, err = os.MkdirTemp(base, fmt.Sprintf("session-%s-%d-", sessionHost(), os.Getpid())); err != nil {
		return "", err
	}
	return s.workDir, nil
}

// sessionHost is the host name as part of a session dir's name.
func sessionHost() string {
	host, err := os.Hostname()
	if err != nil {
		host = "localhost"
	}
	return hostTag(host)
}

// hostTag is a short digest of host: it never holds "-", which separates the
// parts of the name, and stays short however long the host name is.
func hostTag(host string) string {
	sum := sha256.Sum256([]byte(host))
	return hex.EncodeToString(sum[:8])
}

// workBase holds each session's working-copy dir.
func workBase() (string, error) {
	cache, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(cache, "lankir", "work"), nil
}

// source is the file holding the document's current content.
func (d *Document) source() string {
	if n := len(d.work); n > 0 {
		return d.work[n-1]
	}
	return d.Path
}

func (d *Document) updateWorkState() {
	d.Modified = len(d.work) > 0
	d.UndoSteps = len(d.work)
	if d.trimmed {
		d.UndoSteps--
	}
	d.RedoSteps = len(d.undone)
}

func (d *Document) dropUndone() {
	for _, p := range d.undone {
		_ = os.Remove(p)
	}
	d.undone = nil
}

func (d *Document) dropReplaced() {
	for _, p := range d.replaced {
		_ = os.Remove(p)
	}
	d.replaced = nil
}

func (d *Document) dropWork() {
	d.dropUndone()
	d.dropReplaced()
	for _, p := range d.work {
		_ = os.Remove(p)
	}
	d.work, d.trimmed = nil, false
	d.updateWorkState()
}

// decryptedFile returns in, or plain holding in decrypted with password when
// in is encrypted.
func decryptedFile(in, plain, password string) (string, error) {
	data, err := os.ReadFile(in)
	if err != nil {
		return "", err
	}
	// Every encrypted PDF names its /Encrypt dictionary in the (never
	// compressed) trailer or xref stream dict, so most files skip pdfcpu here.
	if !bytes.Contains(data, []byte("/Encrypt")) {
		return in, nil
	}
	err = pdfops.Decrypt(in, plain, password)
	switch {
	case errors.Is(err, pdfcpu.ErrNotEncrypted):
		return in, nil
	case err != nil:
		return "", fmt.Errorf("decrypting the document: %w", err)
	}
	return plain, nil
}

// rewriteForSave returns data rewritten as opts ask, using temp files in dir;
// password decrypts encrypted data.
func rewriteForSave(dir string, data []byte, opts SaveOptions, password string) ([]byte, error) {
	tmp, err := os.MkdirTemp(dir, "save-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tmp)
	cur := filepath.Join(tmp, "in.pdf")
	if err := os.WriteFile(cur, data, 0o600); err != nil {
		return nil, err
	}
	if cur, err = decryptedFile(cur, filepath.Join(tmp, "plain.pdf"), password); err != nil {
		return nil, err
	}
	if opts.Optimize {
		next := filepath.Join(tmp, "optimized.pdf")
		if err := pdfops.Optimize(cur, next); err != nil {
			return nil, err
		}
		cur = next
	}
	if opts.Password != "" {
		next := filepath.Join(tmp, "protected.pdf")
		if err := pdfops.Encrypt(cur, next, opts.Password, opts.Password); err != nil {
			return nil, err
		}
		cur = next
	}
	return os.ReadFile(cur)
}
