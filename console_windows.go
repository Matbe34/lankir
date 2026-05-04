//go:build windows

package main

import (
	"os"
	"syscall"
)

// attachParentConsole reattaches stdout/stderr to the parent console on
// Windows. The binary is built with -H windowsgui so double-clicking does not
// flash a console window, but CLI invocation from cmd/PowerShell still needs
// stdout to land somewhere visible. AttachConsole returns 0 if there is no
// parent console (e.g. launched from Explorer) — that is the GUI path and we
// silently skip rebinding.
func attachParentConsole() {
	const attachParentProcess = ^uintptr(0) // -1, ATTACH_PARENT_PROCESS
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	if r1, _, _ := kernel32.NewProc("AttachConsole").Call(attachParentProcess); r1 == 0 {
		return
	}
	if h, err := syscall.GetStdHandle(syscall.STD_OUTPUT_HANDLE); err == nil && h != 0 {
		os.Stdout = os.NewFile(uintptr(h), "stdout")
	}
	if h, err := syscall.GetStdHandle(syscall.STD_ERROR_HANDLE); err == nil && h != 0 {
		os.Stderr = os.NewFile(uintptr(h), "stderr")
	}
}
