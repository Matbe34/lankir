package main

import (
	"reflect"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/Matbe34/lankir/internal/config"
)

// The Hardware acceleration setting picks WebKit's acceleration policy.
func TestWebviewGpuPolicy(t *testing.T) {
	if got := webviewGpuPolicy(&config.Config{HardwareAccel: true}); got != application.WebviewGpuPolicyAlways {
		t.Errorf("hardwareAccel on: policy %v, want always", got)
	}
	if got := webviewGpuPolicy(&config.Config{HardwareAccel: false}); got != application.WebviewGpuPolicyNever {
		t.Errorf("hardwareAccel off: policy %v, want never", got)
	}
}

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
		{"completion subcommand", []string{"completion", "bash"}, []string{"completion", "bash"}, nil},
		{"help subcommand", []string{"help"}, []string{"help"}, nil},
		{"shell completion request", []string{"__complete", "pdf", ""}, []string{"__complete", "pdf", ""}, nil},
		{"shell completion request without descriptions", []string{"__completeNoDesc", "pdf", ""}, []string{"__completeNoDesc", "pdf", ""}, nil},
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
