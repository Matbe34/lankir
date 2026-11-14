package main

import "testing"

func TestSingleInstanceUnavailableWithoutSessionBus(t *testing.T) {
	t.Setenv("DBUS_SESSION_BUS_ADDRESS", "unix:path=/nonexistent/lankir-test-bus")
	if singleInstanceAvailable() {
		t.Fatal("single instance must be skipped when the session bus is unreachable")
	}
}
