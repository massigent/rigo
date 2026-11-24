package main

import (
	"io/fs"
	"path"
	"path/filepath"
	"strings"
	"testing"
)

// The application binary ships //go:embed web. Development-only assets (the
// jsdom suite, its npm manifest/lockfile and node_modules) must never end up in
// that tree: they live in tests/frontend, outside the embed pattern. This test
// is reproducible after `npm ci`, because it checks both the embedded FS and the
// on-disk `web` tree that produces it.
func TestEmbeddedWebAssetsExcludeDevFiles(t *testing.T) {
	embeddedFiles := 0
	err := fs.WalkDir(embeddedWebFS, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if isDevDirName(d.Name()) {
				t.Errorf("dev directory embedded in the binary: %s", p)
			}
			return nil
		}
		embeddedFiles++
		if isDevDirSegment(p) || isDevFileName(d.Name()) {
			t.Errorf("dev file embedded in the binary: %s", p)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk embedded web assets: %v", err)
	}
	if embeddedFiles == 0 {
		t.Fatal("embedded web tree is empty")
	}

	// The real UI must still be embedded.
	for _, want := range []string{"web/index.html", "web/static/js/app.js"} {
		if _, err := fs.Stat(embeddedWebFS, want); err != nil {
			t.Errorf("expected embedded asset %q: %v", want, err)
		}
	}

	// The same rules applied to the source tree: an `npm install` inside web/
	// (or a moved-back test folder) must be caught here, not in a release.
	onDiskFiles := 0
	err = filepath.WalkDir("web", func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if isDevDirName(d.Name()) {
				t.Errorf("dev directory inside the embedded web tree: %s", p)
			}
			return nil
		}
		onDiskFiles++
		rel := filepath.ToSlash(p)
		if isDevDirSegment(rel) || isDevFileName(d.Name()) {
			t.Errorf("dev file inside the embedded web tree: %s", rel)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk web tree: %v", err)
	}
	if onDiskFiles != embeddedFiles {
		t.Errorf("embedded assets (%d) and files under web (%d) disagree", embeddedFiles, onDiskFiles)
	}
}

func isDevDirName(name string) bool {
	switch strings.ToLower(name) {
	case "node_modules", "tests", "test", "__tests__", "coverage", ".nyc_output":
		return true
	}
	return false
}

func isDevDirSegment(p string) bool {
	for _, segment := range strings.Split(path.Clean(filepath.ToSlash(p)), "/") {
		if isDevDirName(segment) {
			return true
		}
	}
	return false
}

func isDevFileName(name string) bool {
	lower := strings.ToLower(name)
	switch lower {
	case "package.json", "package-lock.json", "npm-shrinkwrap.json",
		"yarn.lock", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".npmrc":
		return true
	}
	return strings.HasSuffix(lower, ".test.js") ||
		strings.HasSuffix(lower, ".test.cjs") ||
		strings.HasSuffix(lower, ".test.mjs") ||
		strings.HasSuffix(lower, ".test.ts") ||
		strings.HasSuffix(lower, ".spec.js") ||
		strings.HasSuffix(lower, ".spec.cjs") ||
		strings.HasSuffix(lower, ".spec.mjs") ||
		strings.HasSuffix(lower, ".spec.ts")
}
