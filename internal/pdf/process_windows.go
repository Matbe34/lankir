//go:build windows

package pdf

import (
	"errors"
	"os"
	"syscall"
)

// errorInvalidParameter is what OpenProcess answers for a pid no process has.
const errorInvalidParameter = syscall.Errno(87)

// processAlive reports whether a process with pid exists. One that can't be
// opened for another reason counts.
func processAlive(pid int) bool {
	p, err := os.FindProcess(pid)
	if err != nil {
		return !errors.Is(err, errorInvalidParameter)
	}
	_ = p.Release()
	return true
}
