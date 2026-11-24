//go:build windows

package main

// isReadOnlyFilesystem: Windows does not expose EROFS through Go's syscall
// package; read-only volumes and ACL denials surface through the permission
// checks in writeFailureStatus.
func isReadOnlyFilesystem(err error) bool {
	return false
}
