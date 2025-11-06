package main

import (
	"context"
	"testing"
)

func TestNewApp(t *testing.T) {
	app := NewApp()
	if app == nil {
		t.Fatal("NewApp returned nil")
	}
	if app.ctx != nil {
		t.Error("Expected ctx to be nil before startup")
	}
}

func TestApp_Startup(t *testing.T) {
	app := NewApp()
	ctx := context.Background()

	app.startup(ctx)

	if app.ctx == nil {
		t.Error("Expected ctx to be set after startup")
	}
}

func TestApp_Greet(t *testing.T) {
	app := NewApp()

	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "Simple name",
			input:    "Alice",
			expected: "Hello Alice, welcome to PDF Editor Pro!",
		},
		{
			name:     "Empty name",
			input:    "",
			expected: "Hello , welcome to PDF Editor Pro!",
		},
		{
			name:     "Name with spaces",
			input:    "John Doe",
			expected: "Hello John Doe, welcome to PDF Editor Pro!",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := app.Greet(tt.input)
			if result != tt.expected {
				t.Errorf("Greet(%q) = %q, expected %q", tt.input, result, tt.expected)
			}
		})
	}
}
