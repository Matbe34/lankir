package main

import "github.com/godbus/dbus/v5"

// singleInstanceAvailable reports whether Wails' D-Bus based single-instance lock
// can work. Wails v3 exits the process when the session bus is unreachable
// (root, ssh -X, minimal sessions); in that case we start without the lock.
func singleInstanceAvailable() bool {
	conn, err := dbus.ConnectSessionBus()
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}
