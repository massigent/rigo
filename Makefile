# TypeCraft — Makefile
# Minimalist, High-Performance Markdown Editor for All Platforms

GO ?= $(shell which go 2>/dev/null || echo $(HOME)/.local/go/bin/go)
APP_NAME := typecraft
VERSION := 1.0.2
DIST_DIR := dist

.PHONY: all build test clean cross-compile dist-linux dist-windows dist-macos appimage

all: build

build:
	@echo "Building local $(APP_NAME)..."
	$(GO) build -trimpath -ldflags "-s -w -X main.version=$(VERSION)" -o $(APP_NAME) .

test:
	@echo "Running tests..."
	$(GO) test -v -race .

appimage: dist-linux
	@echo "Packaging Linux AppImage..."
	@rm -rf /tmp/TypeCraft.AppDir
	@mkdir -p /tmp/TypeCraft.AppDir/usr/bin /tmp/TypeCraft.AppDir/usr/share/applications /tmp/TypeCraft.AppDir/usr/share/icons/hicolor/256x256/apps
	@cp $(DIST_DIR)/$(APP_NAME)-linux-amd64 /tmp/TypeCraft.AppDir/usr/bin/typecraft
	@chmod +x /tmp/TypeCraft.AppDir/usr/bin/typecraft
	@cp typecraft.desktop /tmp/TypeCraft.AppDir/typecraft.desktop
	@cp typecraft.desktop /tmp/TypeCraft.AppDir/usr/share/applications/typecraft.desktop
	@cp TypeCraft.AppDir/typecraft.png /tmp/TypeCraft.AppDir/typecraft.png
	@cp TypeCraft.AppDir/typecraft.png /tmp/TypeCraft.AppDir/.DirIcon
	@cp TypeCraft.AppDir/typecraft.png /tmp/TypeCraft.AppDir/usr/share/icons/hicolor/256x256/apps/typecraft.png
	@cp TypeCraft.AppDir/AppRun /tmp/TypeCraft.AppDir/AppRun
	@chmod +x /tmp/TypeCraft.AppDir/AppRun
	ARCH=x86_64 /home/massimo/Scaricati/software/appimagetool /tmp/TypeCraft.AppDir /tmp/TypeCraft-x86_64.AppImage
	@mv -f /tmp/TypeCraft-x86_64.AppImage $(DIST_DIR)/TypeCraft-x86_64.AppImage
	@rm -f ../TypeCraft-x86_64.AppImage
	@cp -f $(DIST_DIR)/TypeCraft-x86_64.AppImage ../TypeCraft-x86_64.AppImage
	@chmod +x $(DIST_DIR)/TypeCraft-x86_64.AppImage ../TypeCraft-x86_64.AppImage

cross-compile: dist-linux dist-windows dist-macos
	@echo "Cross-compilation complete! Binaries are in $(DIST_DIR)/"
	@ls -lh $(DIST_DIR)/

dist-linux:
	@mkdir -p $(DIST_DIR)
	@echo "Compiling Linux (amd64 & arm64)..."
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 $(GO) build -trimpath -ldflags "-s -w -X main.version=$(VERSION)" -o $(DIST_DIR)/$(APP_NAME)-linux-amd64 .
	CGO_ENABLED=0 GOOS=linux GOARCH=arm64 $(GO) build -trimpath -ldflags "-s -w -X main.version=$(VERSION)" -o $(DIST_DIR)/$(APP_NAME)-linux-arm64 .

dist-windows:
	@mkdir -p $(DIST_DIR)
	@echo "Compiling Windows (x64)..."
	CGO_ENABLED=0 GOOS=windows GOARCH=amd64 $(GO) build -trimpath -ldflags "-s -w -H=windowsgui -X main.version=$(VERSION)" -o $(DIST_DIR)/$(APP_NAME)-windows-amd64.exe .

dist-macos:
	@mkdir -p $(DIST_DIR)
	@echo "Compiling macOS (Intel & Apple Silicon)..."
	CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 $(GO) build -trimpath -ldflags "-s -w -X main.version=$(VERSION)" -o $(DIST_DIR)/$(APP_NAME)-macos-amd64 .
	CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 $(GO) build -trimpath -ldflags "-s -w -X main.version=$(VERSION)" -o $(DIST_DIR)/$(APP_NAME)-macos-arm64 .

clean:
	@echo "Cleaning up..."
	@rm -f $(APP_NAME)
	@rm -rf $(DIST_DIR)
