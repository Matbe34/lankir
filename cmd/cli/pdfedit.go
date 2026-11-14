package cli

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/Matbe34/lankir/internal/pdfops"
	"github.com/spf13/cobra"
	"golang.org/x/term"
)

// Flag values shared by the page-operation commands.
var (
	opOutput    string
	opInPlace   bool
	opPages     string
	opDegrees   int
	opOrder     string
	opAfter     int
	opRanges    string
	opEvery     int
	opOutDir    string
	opUserPW    string
	opOwnerPW   string
	opPassword  string
	opMetaSets  []string
	opJSON      bool
	metaFields  = []string{"title", "author", "subject", "keywords", "creator", "producer"}
	errNoOutput = errors.New("specify -o/--output or --in-place")
)

// run adapts an error-returning command body to the CLI convention of ExitWithError.
func run(msg string, fn func(cmd *cobra.Command, args []string) error) func(*cobra.Command, []string) {
	return func(cmd *cobra.Command, args []string) {
		if err := fn(cmd, args); err != nil {
			ExitWithError(msg, err)
		}
	}
}

// resolveOutput picks where an edit is written: -o, or the input itself with --in-place.
func resolveOutput(in, out string, inPlace bool) (string, error) {
	switch {
	case out != "" && inPlace:
		return "", errors.New("-o/--output and --in-place are mutually exclusive")
	case inPlace:
		return in, nil
	case out == "":
		return "", errNoOutput
	}
	return out, nil
}

// edit runs op from args[0] to the resolved output and reports the result.
func edit(cmd *cobra.Command, in string, op func(out string) error) error {
	out, err := resolveOutput(in, opOutput, opInPlace)
	if err != nil {
		return err
	}
	if err := op(out); err != nil {
		return err
	}
	return report(cmd, out)
}

func report(cmd *cobra.Command, out string) error {
	GetLogger().Info("wrote PDF", "file", SanitizePath(out))
	// Encrypted outputs cannot be counted without their password.
	pages, countErr := pdfops.PageCount(out)
	if opJSON {
		res := map[string]any{"filePath": out}
		if countErr == nil {
			res["pageCount"] = pages
		}
		return printJSON(cmd, res)
	}
	if countErr != nil {
		fmt.Fprintf(cmd.OutOrStdout(), "Wrote %s\n", out)
	} else {
		fmt.Fprintf(cmd.OutOrStdout(), "Wrote %s (%d pages)\n", out, pages)
	}
	return nil
}

func printJSON(cmd *cobra.Command, v any) error {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	fmt.Fprintln(cmd.OutOrStdout(), string(data))
	return nil
}

// readSecret returns v, or one line from stdin when v is "-" so the secret stays out of shell history.
func readSecret(cmd *cobra.Command, v string) (string, error) {
	if v != "-" {
		return v, nil
	}
	return readHidden(cmd, "Password: ")
}

// readHidden reads one line from stdin. On a terminal it shows prompt and
// doesn't echo what is typed.
func readHidden(cmd *cobra.Command, prompt string) (string, error) {
	if f, ok := cmd.InOrStdin().(*os.File); ok && term.IsTerminal(int(f.Fd())) {
		fmt.Fprint(cmd.ErrOrStderr(), prompt)
		b, err := term.ReadPassword(int(f.Fd()))
		fmt.Fprintln(cmd.ErrOrStderr())
		return string(b), err
	}
	line, err := bufio.NewReader(cmd.InOrStdin()).ReadString('\n')
	if err != nil && line == "" {
		return "", fmt.Errorf("reading from stdin: %w", err)
	}
	return strings.TrimRight(line, "\r\n"), nil
}

func applyMetaSets(m pdfops.Metadata, sets []string) (pdfops.Metadata, error) {
	for _, kv := range sets {
		k, v, ok := strings.Cut(kv, "=")
		if !ok {
			return m, fmt.Errorf("invalid --set %q (want key=value)", kv)
		}
		f := metaField(&m, strings.ToLower(k))
		if f == nil {
			return m, fmt.Errorf("unknown metadata key %q (one of %s)", k, strings.Join(metaFields, ", "))
		}
		*f = v
	}
	return m, nil
}

func metaField(m *pdfops.Metadata, key string) *string {
	switch key {
	case "title":
		return &m.Title
	case "author":
		return &m.Author
	case "subject":
		return &m.Subject
	case "keywords":
		return &m.Keywords
	case "creator":
		return &m.Creator
	case "producer":
		return &m.Producer
	}
	return nil
}

func mustPages(flag string) ([]int, error) {
	pages, err := parsePages(flag)
	if err != nil {
		return nil, fmt.Errorf("--pages: %w", err)
	}
	return pages, nil
}

var pdfRotateCmd = &cobra.Command{
	Use:   "rotate <pdf-file>",
	Short: "Rotate pages",
	Args:  cobra.ExactArgs(1),
	Run: run("failed to rotate pages", func(cmd *cobra.Command, args []string) error {
		var pages []int
		if opPages != "" {
			var err error
			if pages, err = mustPages(opPages); err != nil {
				return err
			}
		}
		return edit(cmd, args[0], func(out string) error { return pdfops.Rotate(args[0], out, pages, opDegrees) })
	}),
}

var pdfDeleteCmd = &cobra.Command{
	Use:   "delete <pdf-file>",
	Short: "Delete pages",
	Args:  cobra.ExactArgs(1),
	Run: run("failed to delete pages", func(cmd *cobra.Command, args []string) error {
		pages, err := mustPages(opPages)
		if err != nil {
			return err
		}
		return edit(cmd, args[0], func(out string) error { return pdfops.DeletePages(args[0], out, pages) })
	}),
}

var pdfReorderCmd = &cobra.Command{
	Use:   "reorder <pdf-file>",
	Short: "Reorder pages",
	Long:  `Rewrite the document with its pages in the given order, a permutation of all page numbers.`,
	Args:  cobra.ExactArgs(1),
	Run: run("failed to reorder pages", func(cmd *cobra.Command, args []string) error {
		order, err := parsePages(opOrder)
		if err != nil {
			return fmt.Errorf("--order: %w", err)
		}
		return edit(cmd, args[0], func(out string) error { return pdfops.ReorderPages(args[0], out, order) })
	}),
}

var pdfInsertBlankCmd = &cobra.Command{
	Use:   "insert-blank <pdf-file>",
	Short: "Insert a blank page",
	Long:  `Insert a blank page after page N (0 inserts at the front).`,
	Args:  cobra.ExactArgs(1),
	Run: run("failed to insert blank page", func(cmd *cobra.Command, args []string) error {
		return edit(cmd, args[0], func(out string) error { return pdfops.InsertBlankPage(args[0], out, opAfter) })
	}),
}

var pdfExtractCmd = &cobra.Command{
	Use:   "extract <pdf-file>",
	Short: "Extract pages into a new PDF",
	Args:  cobra.ExactArgs(1),
	Run: run("failed to extract pages", func(cmd *cobra.Command, args []string) error {
		pages, err := mustPages(opPages)
		if err != nil {
			return err
		}
		if err := pdfops.ExtractPages(args[0], opOutput, pages); err != nil {
			return err
		}
		return report(cmd, opOutput)
	}),
}

var pdfSplitCmd = &cobra.Command{
	Use:   "split <pdf-file>",
	Short: "Split a PDF into several files",
	Long: `Split a PDF into several files, named <name>_part<N>.pdf.
With --ranges each ";"-separated group of pages is one file; with --every N each file holds N pages.`,
	Args: cobra.ExactArgs(1),
	Run: run("failed to split PDF", func(cmd *cobra.Command, args []string) error {
		var ranges [][]int
		switch {
		case (opRanges == "") == (opEvery == 0):
			return errors.New("specify exactly one of --ranges or --every")
		case opEvery < 0:
			return errors.New("--every must be positive")
		case opRanges != "":
			var err error
			if ranges, err = parseRanges(opRanges); err != nil {
				return fmt.Errorf("--ranges: %w", err)
			}
		default:
			total, err := pdfops.PageCount(args[0])
			if err != nil {
				return err
			}
			ranges = chunks(total, opEvery)
		}
		dir := opOutDir
		if dir == "" {
			dir = filepath.Dir(args[0])
		}
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
		paths, err := pdfops.Split(args[0], dir, ranges)
		if err != nil {
			return err
		}
		if opJSON {
			return printJSON(cmd, map[string]any{"files": paths})
		}
		for _, p := range paths {
			fmt.Fprintln(cmd.OutOrStdout(), p)
		}
		return nil
	}),
}

var pdfMergeCmd = &cobra.Command{
	Use:   "merge <out.pdf> <in1.pdf> <in2.pdf> [...]",
	Short: "Merge PDFs into one",
	Args:  cobra.MinimumNArgs(3),
	Run: run("failed to merge PDFs", func(cmd *cobra.Command, args []string) error {
		if err := pdfops.Merge(args[1:], args[0]); err != nil {
			return err
		}
		return report(cmd, args[0])
	}),
}

var pdfEncryptCmd = &cobra.Command{
	Use:   "encrypt <pdf-file>",
	Short: "Encrypt a PDF with a password",
	Long: `Encrypt a PDF with AES-256. Pass "-" as a password to read it from stdin instead of the command line.
Permission restrictions (printing only) apply only when --owner-password differs from --user-password;
with one password for both, anyone who can open the PDF has full rights.`,
	Args:  cobra.ExactArgs(1),
	Run: run("failed to encrypt PDF", func(cmd *cobra.Command, args []string) error {
		if opUserPW == "-" && opOwnerPW == "-" {
			return errors.New("only one password can be read from stdin")
		}
		user, err := readSecret(cmd, opUserPW)
		if err != nil {
			return err
		}
		owner, err := readSecret(cmd, opOwnerPW)
		if err != nil {
			return err
		}
		// pdfcpu refuses to encrypt with a user password alone.
		if owner == "" {
			owner = user
		}
		return edit(cmd, args[0], func(out string) error { return pdfops.Encrypt(args[0], out, user, owner) })
	}),
}

var pdfDecryptCmd = &cobra.Command{
	Use:   "decrypt <pdf-file>",
	Short: "Remove a PDF's password protection",
	Long:  `Decrypt a PDF with its user or owner password. Pass "-" as the password to read it from stdin.`,
	Args:  cobra.ExactArgs(1),
	Run: run("failed to decrypt PDF", func(cmd *cobra.Command, args []string) error {
		pw, err := readSecret(cmd, opPassword)
		if err != nil {
			return err
		}
		return edit(cmd, args[0], func(out string) error { return pdfops.Decrypt(args[0], out, pw) })
	}),
}

var pdfMetaCmd = &cobra.Command{
	Use:   "meta <pdf-file>",
	Short: "Show or edit document metadata",
	Long:  `Print the document information dictionary, or change entries with --set key=value (an empty value removes the entry).`,
	Args:  cobra.ExactArgs(1),
	Run: run("failed to process metadata", func(cmd *cobra.Command, args []string) error {
		m, err := pdfops.GetMetadata(args[0])
		if err != nil {
			return err
		}
		if len(opMetaSets) > 0 {
			if m, err = applyMetaSets(m, opMetaSets); err != nil {
				return err
			}
			return edit(cmd, args[0], func(out string) error { return pdfops.SetMetadata(args[0], out, m) })
		}
		if opOutput != "" || opInPlace {
			return errors.New("-o/--output and --in-place need --set")
		}
		if opJSON {
			res := map[string]string{}
			for _, k := range metaFields {
				res[k] = *metaField(&m, k)
			}
			return printJSON(cmd, res)
		}
		for _, k := range metaFields {
			fmt.Fprintf(cmd.OutOrStdout(), "%-9s %s\n", k+":", *metaField(&m, k))
		}
		return nil
	}),
}

var pdfOptimizeCmd = &cobra.Command{
	Use:   "optimize <pdf-file>",
	Short: "Optimize a PDF",
	Args:  cobra.ExactArgs(1),
	Run: run("failed to optimize PDF", func(cmd *cobra.Command, args []string) error {
		return edit(cmd, args[0], func(out string) error { return pdfops.Optimize(args[0], out) })
	}),
}

var pdfValidateCmd = &cobra.Command{
	Use:   "validate <pdf-file>",
	Short: "Validate a PDF's structure",
	Args:  cobra.ExactArgs(1),
	Run: run("PDF is not valid", func(cmd *cobra.Command, args []string) error {
		if err := pdfops.Validate(args[0]); err != nil {
			if opJSON {
				_ = printJSON(cmd, map[string]any{"filePath": args[0], "valid": false, "error": err.Error()})
			}
			return err
		}
		if opJSON {
			return printJSON(cmd, map[string]any{"filePath": args[0], "valid": true})
		}
		fmt.Fprintf(cmd.OutOrStdout(), "%s is valid\n", args[0])
		return nil
	}),
}

func init() {
	// -o/--output and --in-place on commands that edit a PDF.
	for _, c := range []*cobra.Command{pdfRotateCmd, pdfDeleteCmd, pdfReorderCmd, pdfInsertBlankCmd,
		pdfEncryptCmd, pdfDecryptCmd, pdfMetaCmd, pdfOptimizeCmd} {
		c.Flags().StringVarP(&opOutput, "output", "o", "", "output PDF file")
		c.Flags().BoolVar(&opInPlace, "in-place", false, "overwrite the input file")
	}
	for _, c := range []*cobra.Command{pdfRotateCmd, pdfDeleteCmd, pdfReorderCmd, pdfInsertBlankCmd, pdfExtractCmd,
		pdfSplitCmd, pdfMergeCmd, pdfEncryptCmd, pdfDecryptCmd, pdfMetaCmd, pdfOptimizeCmd, pdfValidateCmd} {
		c.Flags().BoolVarP(&opJSON, "json", "j", false, "output in JSON format")
		pdfCmd.AddCommand(c)
	}

	pdfRotateCmd.Flags().IntVar(&opDegrees, "degrees", 0, "clockwise rotation: 90, 180, 270 or -90")
	_ = pdfRotateCmd.MarkFlagRequired("degrees")
	pdfRotateCmd.Flags().StringVar(&opPages, "pages", "", "pages to rotate, e.g. 1,3-5 (default: all)")

	pdfDeleteCmd.Flags().StringVar(&opPages, "pages", "", "pages to delete, e.g. 2,4-6")
	_ = pdfDeleteCmd.MarkFlagRequired("pages")

	pdfReorderCmd.Flags().StringVar(&opOrder, "order", "", "new page order, e.g. 3,1,2")
	_ = pdfReorderCmd.MarkFlagRequired("order")

	pdfInsertBlankCmd.Flags().IntVar(&opAfter, "after", 0, "insert after this page (0 for the front)")
	_ = pdfInsertBlankCmd.MarkFlagRequired("after")

	pdfExtractCmd.Flags().StringVar(&opPages, "pages", "", "pages to extract, e.g. 1,3-5")
	pdfExtractCmd.Flags().StringVarP(&opOutput, "output", "o", "", "output PDF file")
	_ = pdfExtractCmd.MarkFlagRequired("pages")
	_ = pdfExtractCmd.MarkFlagRequired("output")

	pdfSplitCmd.Flags().StringVar(&opRanges, "ranges", "", `page groups, one file each, e.g. "1-3,4-6;7-9"`)
	pdfSplitCmd.Flags().IntVar(&opEvery, "every", 0, "split into files of N pages")
	pdfSplitCmd.Flags().StringVar(&opOutDir, "out-dir", "", "directory for the parts (default: the input's directory)")

	pdfEncryptCmd.Flags().StringVar(&opUserPW, "user-password", "", `password to open the PDF ("-" reads stdin)`)
	pdfEncryptCmd.Flags().StringVar(&opOwnerPW, "owner-password", "", `owner password, default: the user password ("-" reads stdin)`)

	pdfDecryptCmd.Flags().StringVar(&opPassword, "password", "", `user or owner password ("-" reads stdin)`)
	_ = pdfDecryptCmd.MarkFlagRequired("password")

	pdfMetaCmd.Flags().StringArrayVar(&opMetaSets, "set", nil, "set an entry, e.g. --set title=Report (title, author, subject, keywords, creator, producer)")
}
