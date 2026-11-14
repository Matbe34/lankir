// Package pdfops implements page and document operations on PDF files, backed by pdfcpu.
//
// Pages are 1-based. Every operation that writes reads its whole input first and writes
// to a temporary file next to out, renamed into place only on success, so in == out is
// safe and a failed operation never leaves a partial output.
package pdfops

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"math/rand/v2"
	"os"
	"path/filepath"
	"strings"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
)

// Metadata holds the document information dictionary entries Lankir edits.
type Metadata struct {
	Title    string
	Author   string
	Subject  string
	Keywords string
	Creator  string
	Producer string
}

var bg = context.Background()

// newConf avoids pdfcpu's default configuration, which reads and writes a config dir under
// the user's home, and uses relaxed validation so slightly broken real-world PDFs still load.
func newConf() *model.Configuration {
	conf := model.NewStatelessConfiguration()
	conf.ValidationMode = model.ValidationRelaxed
	conf.Offline = true
	return conf
}

// PageCount returns the number of pages in the PDF at path.
func PageCount(path string) (int, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}
	return api.PageCount(bg, bytes.NewReader(data), newConf())
}

// Validate reports whether the PDF at path passes pdfcpu's relaxed validation.
func Validate(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return api.Validate(bg, bytes.NewReader(data), newConf(), nil)
}

// Rotate rotates pages clockwise by degrees, a multiple of 90 (negative turns counter-clockwise).
// Empty pages rotates every page.
func Rotate(in, out string, pages []int, degrees int) error {
	if degrees%90 != 0 {
		return fmt.Errorf("degrees must be a multiple of 90, got %d", degrees)
	}
	return transform(in, out, model.ROTATE, func(ctx *model.Context) (*model.Context, error) {
		sel := types.IntSet{}
		if len(pages) == 0 {
			for p := 1; p <= ctx.PageCount; p++ {
				sel[p] = true
			}
		} else {
			if err := checkPages(pages, ctx.PageCount); err != nil {
				return nil, err
			}
			for _, p := range pages {
				sel[p] = true
			}
		}
		return ctx, pdfcpu.RotatePages(bg, ctx, sel, degrees)
	})
}

// DeletePages removes pages. Deleting every page is refused.
func DeletePages(in, out string, pages []int) error {
	return transform(in, out, model.REMOVEPAGES, func(ctx *model.Context) (*model.Context, error) {
		if err := checkPages(pages, ctx.PageCount); err != nil {
			return nil, err
		}
		if len(pages) == ctx.PageCount {
			return nil, errors.New("cannot delete all pages")
		}
		drop := map[int]bool{}
		for _, p := range pages {
			drop[p] = true
		}
		var keep []int
		for p := 1; p <= ctx.PageCount; p++ {
			if !drop[p] {
				keep = append(keep, p)
			}
		}
		return extract(ctx, keep)
	})
}

// ReorderPages rewrites the document with its pages in order, a permutation of 1..n.
func ReorderPages(in, out string, order []int) error {
	return transform(in, out, model.COLLECT, func(ctx *model.Context) (*model.Context, error) {
		if err := checkPages(order, ctx.PageCount); err != nil {
			return nil, err
		}
		if len(order) != ctx.PageCount {
			return nil, fmt.Errorf("order must be a permutation of 1..%d, got %d pages", ctx.PageCount, len(order))
		}
		return extract(ctx, order)
	})
}

// InsertBlankPage inserts a blank page after page after (0 inserts at the front),
// sized like the page it is inserted next to.
func InsertBlankPage(in, out string, after int) error {
	cmd := model.INSERTPAGESAFTER
	if after == 0 {
		cmd = model.INSERTPAGESBEFORE
	}
	return transform(in, out, cmd, func(ctx *model.Context) (*model.Context, error) {
		if after < 0 || after > ctx.PageCount {
			return nil, fmt.Errorf("insert position %d out of range (0-%d)", after, ctx.PageCount)
		}
		page := max(after, 1)
		// pdfcpu's nil-dimension default prefers a MediaBox inherited from the page tree over
		// the page's own, so size the blank page from the neighbour's effective box ourselves.
		_, _, inh, err := ctx.PageDict(bg, page, false)
		if err != nil {
			return nil, err
		}
		if inh.MediaBox == nil {
			return nil, fmt.Errorf("page %d has no MediaBox", page)
		}
		dim := &types.Dim{Width: inh.MediaBox.Width(), Height: inh.MediaBox.Height()}
		if inh.Rotate%180 != 0 {
			// Match the neighbour as displayed.
			dim.Width, dim.Height = dim.Height, dim.Width
		}
		return ctx, ctx.InsertBlankPages(bg, types.IntSet{page: true}, dim, after == 0)
	})
}

// ExtractPages writes a new PDF holding just pages, in the given order.
func ExtractPages(in, out string, pages []int) error {
	return transform(in, out, model.COLLECT, func(ctx *model.Context) (*model.Context, error) {
		if err := checkPages(pages, ctx.PageCount); err != nil {
			return nil, err
		}
		return extract(ctx, pages)
	})
}

// Split writes one PDF per range into outDir, named <base>_part<N>.pdf (N from 1), each
// holding that range's pages in order, and returns their paths. On error no part is left behind.
func Split(in, outDir string, ranges [][]int) (paths []string, err error) {
	if len(ranges) == 0 {
		return nil, errors.New("no ranges given")
	}
	data, err := os.ReadFile(in)
	if err != nil {
		return nil, err
	}
	ctx, err := readContext(data, newConf(), model.EXTRACTPAGES)
	if err != nil {
		return nil, err
	}
	for i, r := range ranges {
		if err := checkPages(r, ctx.PageCount); err != nil {
			return nil, fmt.Errorf("range %d: %w", i+1, err)
		}
	}

	base := strings.TrimSuffix(filepath.Base(in), filepath.Ext(in))
	partPath := func(i int) string { return filepath.Join(outDir, fmt.Sprintf("%s_part%d.pdf", base, i+1)) }
	var existing []string
	for i := range ranges {
		if _, err := os.Lstat(partPath(i)); err == nil {
			existing = append(existing, partPath(i))
		}
	}
	if len(existing) > 0 {
		return nil, fmt.Errorf("refusing to overwrite existing files: %s", strings.Join(existing, ", "))
	}

	defer func() {
		if err != nil {
			for _, p := range paths {
				os.Remove(p)
			}
			paths = nil
		}
	}()
	for i, r := range ranges {
		part, err := extract(ctx, r)
		if err != nil {
			return paths, fmt.Errorf("range %d: %w", i+1, err)
		}
		p := partPath(i)
		if err := writeAtomic(p, func(w io.Writer) error { return api.Write(bg, part, w, ctx.Configuration) }); err != nil {
			return paths, fmt.Errorf("range %d: %w", i+1, err)
		}
		paths = append(paths, p)
	}
	return paths, nil
}

// Merge concatenates inputs, in order, into out. out may be one of the inputs.
func Merge(inputs []string, out string) error {
	if len(inputs) < 2 {
		return fmt.Errorf("merge needs at least 2 inputs, got %d", len(inputs))
	}
	rs := make([]io.ReadSeeker, len(inputs))
	for i, in := range inputs {
		data, err := os.ReadFile(in)
		if err != nil {
			return err
		}
		rs[i] = bytes.NewReader(data)
	}
	return writeAtomic(out, func(w io.Writer) error {
		return api.MergeRaw(bg, rs, w, false, newConf())
	})
}

// Encrypt protects the document with AES-256. At least one password is required; pdfcpu's
// default permissions (printing only, without the owner password) apply.
func Encrypt(in, out, userPW, ownerPW string) error {
	if userPW == "" && ownerPW == "" {
		return errors.New("a user or owner password is required")
	}
	conf := newConf()
	conf.UserPW, conf.OwnerPW = userPW, ownerPW
	conf.EncryptUsingAES = true
	conf.EncryptKeyLength = 256
	return rewrite(in, out, func(r io.ReadSeeker, w io.Writer) error { return api.Encrypt(bg, r, w, conf) })
}

// Decrypt removes encryption using either the user or the owner password.
func Decrypt(in, out, pw string) error {
	conf := newConf()
	conf.UserPW, conf.OwnerPW = pw, pw
	return rewrite(in, out, func(r io.ReadSeeker, w io.Writer) error { return api.Decrypt(bg, r, w, conf) })
}

// Optimize rewrites the document, dropping redundant objects and compressing structure.
func Optimize(in, out string) error {
	return rewrite(in, out, func(r io.ReadSeeker, w io.Writer) error { return api.Optimize(bg, r, w, newConf(), nil) })
}

// GetMetadata reads the document information dictionary.
func GetMetadata(path string) (Metadata, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return Metadata{}, err
	}
	conf := newConf()
	conf.Cmd = model.LISTINFO
	ctx, err := api.ReadAndValidate(bg, bytes.NewReader(data), conf)
	if err != nil {
		return Metadata{}, err
	}
	return Metadata{
		Title:    ctx.Title,
		Author:   ctx.Author,
		Subject:  ctx.Subject,
		Keywords: ctx.Keywords,
		Creator:  ctx.Creator,
		Producer: ctx.Producer,
	}, nil
}

// SetMetadata replaces the six Metadata entries; an empty field removes its entry.
func SetMetadata(in, out string, m Metadata) error {
	conf := newConf()
	// Without this pdfcpu overwrites Producer (and the dates) with its own on write.
	conf.PreserveInfoDict = true
	return transformWith(conf, in, out, model.ADDPROPERTIES, func(ctx *model.Context) (*model.Context, error) {
		entries := map[string]string{
			"Title":    m.Title,
			"Author":   m.Author,
			"Subject":  m.Subject,
			"Keywords": m.Keywords,
			"Creator":  m.Creator,
			"Producer": m.Producer,
		}
		set := map[string]string{}
		for k, v := range entries {
			if v != "" {
				set[k] = v
			}
		}
		// Also creates the info dictionary when missing.
		if err := pdfcpu.PropertiesAdd(bg, ctx, set); err != nil {
			return nil, err
		}
		d, err := ctx.DereferenceDict(*ctx.Info)
		if err != nil {
			return nil, err
		}
		for k, v := range entries {
			if v == "" {
				d.Delete(k)
			}
		}
		return ctx, nil
	})
}

func checkPages(pages []int, n int) error {
	if len(pages) == 0 {
		return errors.New("no pages given")
	}
	seen := map[int]bool{}
	for _, p := range pages {
		if p < 1 || p > n {
			return fmt.Errorf("page %d out of range (1-%d)", p, n)
		}
		if seen[p] {
			return fmt.Errorf("duplicate page %d", p)
		}
		seen[p] = true
	}
	return nil
}

// extract builds a new document from pages of ctx. pdfcpu.ExtractPages starts from an empty
// document, dropping the info dictionary (and outlines), so the info entries are copied over.
func extract(ctx *model.Context, pages []int) (*model.Context, error) {
	dest, err := pdfcpu.ExtractPages(bg, ctx, pages, false)
	if err != nil || ctx.Info == nil {
		return dest, err
	}
	src, err := ctx.DereferenceDict(*ctx.Info)
	if err != nil || src == nil {
		return dest, err
	}
	info := types.NewDict()
	for k, v := range src {
		v, err := ctx.Dereference(v)
		if err != nil {
			return nil, err
		}
		switch v.(type) {
		case types.StringLiteral, types.HexLiteral, types.Name:
			info.Insert(k, v)
		}
	}
	if dest.Info, err = dest.IndRefForNewObject(info); err != nil {
		return nil, err
	}
	return dest, nil
}

func readContext(data []byte, conf *model.Configuration, cmd model.CommandMode) (*model.Context, error) {
	conf.Cmd = cmd
	return api.ReadValidateAndOptimize(bg, bytes.NewReader(data), conf, nil)
}

// transform reads in, applies op to its context and writes the context op returns to out.
func transform(in, out string, cmd model.CommandMode, op func(*model.Context) (*model.Context, error)) error {
	return transformWith(newConf(), in, out, cmd, op)
}

func transformWith(conf *model.Configuration, in, out string, cmd model.CommandMode, op func(*model.Context) (*model.Context, error)) error {
	data, err := os.ReadFile(in)
	if err != nil {
		return err
	}
	ctx, err := readContext(data, conf, cmd)
	if err != nil {
		return err
	}
	result, err := op(ctx)
	if err != nil {
		return err
	}
	return writeAtomic(out, func(w io.Writer) error { return api.Write(bg, result, w, conf) })
}

// rewrite runs a pdfcpu stream operation from in to out.
func rewrite(in, out string, op func(io.ReadSeeker, io.Writer) error) error {
	data, err := os.ReadFile(in)
	if err != nil {
		return err
	}
	return writeAtomic(out, func(w io.Writer) error { return op(bytes.NewReader(data), w) })
}

// writeAtomic writes out through a temp file in the same directory, renamed into place on
// success and removed on failure. An existing out keeps its permissions.
func writeAtomic(out string, write func(io.Writer) error) (err error) {
	if out == "" {
		return errors.New("output path is empty")
	}
	// Write through a symlink to its target rather than replacing the link.
	if resolved, err := filepath.EvalSymlinks(out); err == nil {
		out = resolved
	}
	var keepPerm os.FileMode // set when replacing a file, whose mode we keep
	if fi, err := os.Stat(out); err == nil {
		keepPerm = fi.Mode().Perm()
	}
	tmp, err := createTemp(out)
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			tmp.Close()
			os.Remove(tmp.Name())
		}
	}()
	if err = write(tmp); err != nil {
		return err
	}
	if keepPerm != 0 {
		if err = tmp.Chmod(keepPerm); err != nil {
			return err
		}
	}
	if err = tmp.Sync(); err != nil {
		return err
	}
	if err = tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), out)
}

// createTemp creates the temp file next to out with mode 0666, so a new output
// follows the umask (os.CreateTemp always uses 0600).
func createTemp(out string) (*os.File, error) {
	for {
		name := filepath.Join(filepath.Dir(out), fmt.Sprintf(".%s.%d.tmp", filepath.Base(out), rand.Uint64()))
		f, err := os.OpenFile(name, os.O_RDWR|os.O_CREATE|os.O_EXCL, 0o666)
		if !errors.Is(err, fs.ErrExist) {
			return f, err
		}
	}
}
