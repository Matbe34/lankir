package cli

import (
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/spf13/cobra"
	"github.com/spf13/pflag"
)

// docSection is the text under the heading that names "lankir <path>" in
// backticks, up to the next heading.
func docSection(doc, path string) (string, bool) {
	lines := strings.Split(doc, "\n")
	for i, line := range lines {
		if !strings.HasPrefix(line, "#") || !strings.Contains(line, "`lankir "+path+"`") {
			continue
		}
		end := len(lines)
		for j := i + 1; j < len(lines); j++ {
			if strings.HasPrefix(lines[j], "#") {
				end = j
				break
			}
		}
		return strings.Join(lines[i:end], "\n"), true
	}
	return "", false
}

// docFlagPattern finds the flags named in the first cell of a flag table row.
var docFlagPattern = regexp.MustCompile("`--([a-z0-9-]+)`")

// tableFlags returns the --flags named in the first column of the section's
// tables.
func tableFlags(section string) []string {
	var flags []string
	for _, line := range strings.Split(section, "\n") {
		cells := strings.Split(line, "|")
		if !strings.HasPrefix(line, "|") || len(cells) < 3 {
			continue
		}
		for _, m := range docFlagPattern.FindAllStringSubmatch(cells[1], -1) {
			flags = append(flags, m[1])
		}
	}
	return flags
}

// Every command and flag the CLI has must be in docs/cli.md: a heading per
// command, its flags under it, the global flags anywhere. A flag table must
// not name a flag the command doesn't have.
func TestCLIDocsCoverEveryCommandAndFlag(t *testing.T) {
	data, err := os.ReadFile("../../docs/cli.md")
	if err != nil {
		t.Fatalf("read docs/cli.md: %v", err)
	}
	doc := string(data)

	rootCmd.PersistentFlags().VisitAll(func(f *pflag.Flag) {
		if !strings.Contains(doc, "--"+f.Name) {
			t.Errorf("global flag --%s is not in docs/cli.md", f.Name)
		}
	})

	var walk func(c *cobra.Command)
	walk = func(c *cobra.Command) {
		for _, sub := range c.Commands() {
			if sub.Hidden || sub.Name() == "help" {
				continue
			}
			path := strings.TrimPrefix(sub.CommandPath(), "lankir ")
			section, ok := docSection(doc, path)
			if !ok {
				t.Errorf("command %q has no heading with `lankir %s` in docs/cli.md", path, path)
			} else {
				sub.LocalNonPersistentFlags().VisitAll(func(f *pflag.Flag) {
					if f.Name == "help" {
						return
					}
					if !strings.Contains(section, "--"+f.Name) {
						t.Errorf("flag --%s of %q is not in its section of docs/cli.md", f.Name, path)
					}
					if f.Shorthand != "" && !strings.Contains(section, "`-"+f.Shorthand+"`") {
						t.Errorf("shorthand -%s of %q --%s is not in its section of docs/cli.md", f.Shorthand, path, f.Name)
					}
				})
				for _, name := range tableFlags(section) {
					if sub.LocalFlags().Lookup(name) == nil && sub.InheritedFlags().Lookup(name) == nil {
						t.Errorf("docs/cli.md documents --%s for %q, which has no such flag", name, path)
					}
				}
			}
			walk(sub)
		}
	}
	walk(rootCmd)
}
