//go:build (linux || darwin) && cgo

package pdf

/*
#include <unistd.h>
#include <fcntl.h>
#include <stdio.h>

static int saved_stderr_fd = -1;

void suppress_stderr(void) {
    fflush(stderr);
    if (saved_stderr_fd != -1) return;        // already suppressed
    int devnull = open("/dev/null", O_WRONLY);
    if (devnull == -1) return;
    saved_stderr_fd = dup(2);                 // save original
    if (saved_stderr_fd == -1) {
        close(devnull);
        return;
    }
    dup2(devnull, 2);
    close(devnull);
}

void restore_stderr(void) {
    fflush(stderr);
    if (saved_stderr_fd == -1) return;        // nothing to restore
    dup2(saved_stderr_fd, 2);
    close(saved_stderr_fd);
    saved_stderr_fd = -1;
}
*/
import "C"

func suppressMuPDFWarnings() { C.suppress_stderr() }
func restoreMuPDFWarnings()  { C.restore_stderr() }
