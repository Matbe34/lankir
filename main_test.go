package main

import (
	"reflect"
	"testing"
)

func TestParseArgs(t *testing.T) {
	cases := []struct {
		name    string
		args    []string
		wantCLI []string
		wantGUI []string
	}{
		{"no args", nil, nil, nil},
		{"cobra subcommand", []string{"pdf", "info", "x.pdf"}, []string{"pdf", "info", "x.pdf"}, nil},
		{"single pdf path", []string{"foo.pdf"}, nil, []string{"foo.pdf"}},
		{"multiple pdf paths", []string{"a.pdf", "b.pdf"}, nil, []string{"a.pdf", "b.pdf"}},
		{"global flag before subcommand", []string{"--verbose", "pdf", "info", "x.pdf"}, []string{"--verbose", "pdf", "info", "x.pdf"}, nil},
		{"dot-slash workaround", []string{"./pdf"}, nil, []string{"./pdf"}},
		{"unknown subcommand routes to GUI", []string{"pdf-info", "x.pdf"}, nil, []string{"pdf-info", "x.pdf"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cli, gui := parseArgs(tc.args)
			if !reflect.DeepEqual(cli, tc.wantCLI) {
				t.Errorf("CLI: got %v want %v", cli, tc.wantCLI)
			}
			if !reflect.DeepEqual(gui, tc.wantGUI) {
				t.Errorf("GUI: got %v want %v", gui, tc.wantGUI)
			}
		})
	}
}
