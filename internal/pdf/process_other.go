//go:build !windows

package pdf

import (
	"errors"
	"os"
	"syscall"
)

// processAlive reports whether a process with pid exists. One of another
// user (EPERM) counts.
func processAlive(pid int) bool {
	p, err := os.FindProcess(pid)
	if err != nil {
		return true
	}
	err = p.Signal(syscall.Signal(0))
	_ = p.Release()
	return !errors.Is(err, os.ErrProcessDone)
}
