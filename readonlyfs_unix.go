//go:build !windows

package main

import (
	"errors"
	"syscall"
)

// isReadOnlyFilesystem reports the EROFS errno (read-only mount), also when it
// is wrapped by *os.PathError. os.IsPermission does not cover it, so without
// this check a read-only filesystem would be reported as a generic 500 instead
// of a write refusal.
func isReadOnlyFilesystem(err error) bool {
	return errors.Is(err, syscall.EROFS)
}
