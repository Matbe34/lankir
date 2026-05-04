//go:build windows && cgo

package pdf

/*
#include <io.h>
#include <fcntl.h>
#include <stdio.h>

static int saved_stderr_fd = -1;

void suppress_stderr(void) {
    fflush(stderr);
    if (saved_stderr_fd != -1) return;
    int devnull = _open("NUL", _O_WRONLY);
    if (devnull == -1) return;
    saved_stderr_fd = _dup(2);
    if (saved_stderr_fd == -1) {
        _close(devnull);
        return;
    }
    _dup2(devnull, 2);
    _close(devnull);
}

void restore_stderr(void) {
    fflush(stderr);
    if (saved_stderr_fd == -1) return;
    _dup2(saved_stderr_fd, 2);
    _close(saved_stderr_fd);
    saved_stderr_fd = -1;
}
*/
import "C"

func suppressMuPDFWarnings() { C.suppress_stderr() }
func restoreMuPDFWarnings()  { C.restore_stderr() }
