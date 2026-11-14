package cli

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/spf13/cobra"
	"github.com/spf13/pflag"
)

// Commands must never touch the user's real config.
func TestMain(m *testing.M) {
	home, err := os.MkdirTemp("", "lankir-cli-test-home-")
	if err != nil {
		panic(err)
	}
	os.Setenv("HOME", home)
	os.Setenv("XDG_CONFIG_HOME", filepath.Join(home, ".config"))
	code := m.Run()
	os.RemoveAll(home)
	os.Exit(code)
}

// writeTestPDF writes an n-page PDF where page i (from 0) is (100+10i) x (200+10i) points.
func writeTestPDF(t *testing.T, path string, n int) {
	t.Helper()
	var b bytes.Buffer
	var offsets []int
	obj := func(body string) {
		offsets = append(offsets, b.Len())
		fmt.Fprintf(&b, "%d 0 obj\n%s\nendobj\n", len(offsets), body)
	}
	b.WriteString("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
	kids := make([]string, n)
	for i := range kids {
		kids[i] = fmt.Sprintf("%d 0 R", 4+2*i)
	}
	obj("<< /Type /Catalog /Pages 2 0 R >>")
	obj(fmt.Sprintf("<< /Type /Pages /Kids [%s] /Count %d >>", strings.Join(kids, " "), n))
	obj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
	for i := 0; i < n; i++ {
		obj(fmt.Sprintf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %d %d] /Resources << /Font << /F1 3 0 R >> >> /Contents %d 0 R >>",
			100+10*i, 200+10*i, 5+2*i))
		content := fmt.Sprintf("BT /F1 12 Tf 10 10 Td (Page %d) Tj ET", i+1)
		obj(fmt.Sprintf("<< /Length %d >>\nstream\n%s\nendstream", len(content), content))
	}
	xref := b.Len()
	fmt.Fprintf(&b, "xref\n0 %d\n0000000000 65535 f \n", len(offsets)+1)
	for _, o := range offsets {
		fmt.Fprintf(&b, "%010d 00000 n \n", o)
	}
	fmt.Fprintf(&b, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(offsets)+1, xref)
	if err := os.WriteFile(path, b.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
}

func fixture(t *testing.T, n int) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "doc.pdf")
	writeTestPDF(t, path, n)
	return path
}

type exitCode int

// runCLI executes the root command in-process and returns its stdout and stderr. Flag
// values persist on the global command tree between runs, so every flag is reset first.
// ExitWithError ends the run with an error instead of the test process.
func runCLI(t *testing.T, stdin string, args ...string) (output string, err error) {
	t.Helper()
	resetFlags(rootCmd)
	var out bytes.Buffer
	rootCmd.SetOut(&out)
	rootCmd.SetErr(&out)
	rootCmd.SetIn(strings.NewReader(stdin))
	rootCmd.SetArgs(args)
	exit = func(code int) { panic(exitCode(code)) }
	t.Cleanup(func() { rootCmd.SetArgs(nil); exit = os.Exit })
	defer func() {
		if r := recover(); r != nil {
			code, ok := r.(exitCode)
			if !ok {
				panic(r)
			}
			output, err = out.String(), fmt.Errorf("exit status %d", code)
		}
	}()
	err = rootCmd.Execute()
	return out.String(), err
}

func resetFlags(c *cobra.Command) {
	reset := func(f *pflag.Flag) {
		if sv, ok := f.Value.(pflag.SliceValue); ok {
			_ = sv.Replace(nil)
		} else {
			_ = f.Value.Set(f.DefValue)
		}
		f.Changed = false
	}
	c.Flags().VisitAll(reset)
	for _, sub := range c.Commands() {
		resetFlags(sub)
	}
}
