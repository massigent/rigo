# TypeCraft — Makefile
# Minimalist, High-Performance Markdown Editor for All Platforms

GO ?= $(shell which go 2>/dev/null || echo $(HOME)/.local/go/bin/go)
APP_NAME := typecraft
VERSION := 1.0.3
DIST_DIR ?= dist

# Override with a path to the executable if appimagetool is not on PATH.
APPIMAGETOOL ?= appimagetool
APPIMAGE_NAME := TypeCraft-x86_64.AppImage
SOURCE_APPDIR := TypeCraft.AppDir

GO_LDFLAGS := -s -w -X main.version=$(VERSION)

.PHONY: all build test clean cross-compile dist-linux dist-windows dist-macos install-appdir appimage deb rpm linux-packages

all: build

build:
	@echo "Building local $(APP_NAME)..."
	$(GO) build -trimpath -buildvcs=false -ldflags "$(GO_LDFLAGS)" -o $(APP_NAME) .

test:
	@echo "Running tests..."
	$(GO) test -v -race .

# Build a fresh Linux amd64 binary into the tracked AppDir template for local
# testing/desktop integration. Packaging does not consume this ignored binary.
install-appdir:
	@mkdir -p $(SOURCE_APPDIR)/usr/bin
	@echo "Building fresh Linux amd64 binary into $(SOURCE_APPDIR)/usr/bin/$(APP_NAME)..."
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 $(GO) build -trimpath -buildvcs=false -ldflags "$(GO_LDFLAGS)" -o $(SOURCE_APPDIR)/usr/bin/$(APP_NAME) .
	@magic=$$(od -An -tx1 -N4 $(SOURCE_APPDIR)/usr/bin/$(APP_NAME) | tr -d ' \n'); \
	if [ "$$magic" != "7f454c46" ]; then \
		echo "error: $(SOURCE_APPDIR)/usr/bin/$(APP_NAME) is not a Linux ELF binary" >&2; \
		rm -f $(SOURCE_APPDIR)/usr/bin/$(APP_NAME); \
		exit 1; \
	fi

appimage:
	@set -eu; umask 022; \
	outdir='$(DIST_DIR)'; tool='$(APPIMAGETOOL)'; \
	if ! command -v "$$tool" >/dev/null 2>&1; then \
		echo "error: appimagetool not found: '$$tool'" >&2; \
		echo "       install it, put it on PATH, or set APPIMAGETOOL=/path/to/appimagetool" >&2; \
		exit 1; \
	fi; \
	mkdir -p -- "$$outdir"; \
	stage=$$(mktemp -d -- "$$outdir/.typecraft-appimage.XXXXXXXX"); \
	trap 'rm -rf -- "$$stage"' EXIT; \
	trap 'exit 1' HUP INT TERM; \
	appdir="$$stage/TypeCraft.AppDir"; \
	tmpout="$$stage/$(APPIMAGE_NAME)"; output="$$outdir/$(APPIMAGE_NAME)"; \
	mkdir -p -- "$$appdir/usr/bin" \
		"$$appdir/usr/share/applications" \
		"$$appdir/usr/share/icons/hicolor/256x256/apps"; \
	echo "Building fresh Linux amd64 binary into AppDir..."; \
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 $(GO) build -trimpath -buildvcs=false -ldflags "$(GO_LDFLAGS)" -o "$$appdir/usr/bin/$(APP_NAME)" .; \
	magic=$$(od -An -tx1 -N4 "$$appdir/usr/bin/$(APP_NAME)" | tr -d ' \n'); \
	if [ "$$magic" != "7f454c46" ]; then \
		echo "error: staged $(APP_NAME) is not a Linux ELF binary" >&2; \
		exit 1; \
	fi; \
	chmod 0755 "$$appdir/usr/bin/$(APP_NAME)"; \
	install -m 0755 $(SOURCE_APPDIR)/AppRun "$$appdir/AppRun"; \
	install -m 0644 typecraft.desktop "$$appdir/$(APP_NAME).desktop"; \
	install -m 0644 typecraft.desktop "$$appdir/usr/share/applications/$(APP_NAME).desktop"; \
	install -m 0644 $(SOURCE_APPDIR)/typecraft.png "$$appdir/$(APP_NAME).png"; \
	install -m 0644 $(SOURCE_APPDIR)/typecraft.png "$$appdir/.DirIcon"; \
	install -m 0644 $(SOURCE_APPDIR)/typecraft.png "$$appdir/usr/share/icons/hicolor/256x256/apps/$(APP_NAME).png"; \
	install -D -m 0644 packaging/copyright "$$appdir/usr/share/licenses/$(APP_NAME)/copyright"; \
	find "$$appdir" -type d -exec chmod 0755 {} +; \
	echo "Packaging $(APPIMAGE_NAME) with '$$tool'..."; \
	ARCH=x86_64 "$$tool" "$$appdir" "$$tmpout"; \
	if [ ! -f "$$tmpout" ] || [ ! -s "$$tmpout" ]; then \
		echo "error: appimagetool did not create a non-empty AppImage" >&2; \
		exit 1; \
	fi; \
	chmod 0755 "$$tmpout"; \
	mv -fT -- "$$tmpout" "$$output"; \
	echo "Created $$output"

cross-compile: dist-linux dist-windows dist-macos
	@echo "Cross-compilation complete! Binaries are in $(DIST_DIR)/"
	@ls -lh $(DIST_DIR)/

dist-linux:
	@mkdir -p $(DIST_DIR)
	@echo "Compiling Linux (amd64 & arm64)..."
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 $(GO) build -trimpath -buildvcs=false -ldflags "$(GO_LDFLAGS)" -o $(DIST_DIR)/$(APP_NAME)-linux-amd64 .
	CGO_ENABLED=0 GOOS=linux GOARCH=arm64 $(GO) build -trimpath -buildvcs=false -ldflags "$(GO_LDFLAGS)" -o $(DIST_DIR)/$(APP_NAME)-linux-arm64 .

dist-windows:
	@mkdir -p $(DIST_DIR)
	@echo "Compiling Windows (x64)..."
	CGO_ENABLED=0 GOOS=windows GOARCH=amd64 $(GO) build -trimpath -buildvcs=false -ldflags "$(GO_LDFLAGS) -H=windowsgui" -o $(DIST_DIR)/$(APP_NAME)-windows-amd64.exe .

dist-macos:
	@mkdir -p $(DIST_DIR)
	@echo "Compiling macOS (Intel & Apple Silicon)..."
	CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 $(GO) build -trimpath -buildvcs=false -ldflags "$(GO_LDFLAGS)" -o $(DIST_DIR)/$(APP_NAME)-macos-amd64 .
	CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 $(GO) build -trimpath -buildvcs=false -ldflags "$(GO_LDFLAGS)" -o $(DIST_DIR)/$(APP_NAME)-macos-arm64 .

linux-packages: deb rpm appimage

# Native x86_64 packages; no package-manager operations or downloads at build time.
deb rpm:
	@set -eu; \
	outdir='$(DIST_DIR)'; \
	mkdir -p -- "$$outdir"; \
	stage=$$(mktemp -d -- "$$outdir/.typecraft-build.XXXXXXXX"); \
	trap 'rm -rf -- "$$stage"' EXIT; \
	trap 'exit 1' HUP INT TERM; \
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 $(GO) build -trimpath -buildvcs=false -ldflags "$(GO_LDFLAGS)" -o "$$stage/$(APP_NAME)" .; \
	sh packaging/native.sh "$@" '$(VERSION)' "$$stage/$(APP_NAME)" "$$outdir"

clean:
	@echo "Cleaning up..."
	@rm -f $(APP_NAME)
	@rm -f -- '$(DIST_DIR)/$(APP_NAME)-linux-amd64' '$(DIST_DIR)/$(APP_NAME)-linux-arm64' \
		'$(DIST_DIR)/$(APP_NAME)-windows-amd64.exe' '$(DIST_DIR)/$(APP_NAME)-macos-amd64' \
		'$(DIST_DIR)/$(APP_NAME)-macos-arm64' '$(DIST_DIR)/$(APPIMAGE_NAME)' \
		'$(DIST_DIR)/$(APP_NAME)_$(VERSION)-1_amd64.deb' '$(DIST_DIR)/$(APP_NAME)-$(VERSION)-1.x86_64.rpm'
