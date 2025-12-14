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
