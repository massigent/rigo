#!/bin/sh
# Exercise AppDir assembly and publish/cleanup without a real appimagetool.
set -eu
cd "$(dirname "$0")/.."
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
trap 'exit 1' HUP INT TERM
cat > "$work/mock-appimagetool" <<'MOCK'
#!/bin/sh
set -eu
test "$ARCH" = x86_64
test -x "$1/AppRun"
test -x "$1/usr/bin/rigo"
test "$(od -An -tx1 -N4 "$1/usr/bin/rigo" | tr -d ' \n')" = 7f454c46
# e_machine in an amd64 little-endian ELF.
test "$(od -An -tx1 -j18 -N2 "$1/usr/bin/rigo" | tr -d ' \n')" = 3e00
cmp "$1/rigo.desktop" "$1/usr/share/applications/rigo.desktop"
cmp "$1/rigo.png" "$1/.DirIcon"
cmp "$1/rigo.png" "$1/usr/share/icons/hicolor/256x256/apps/rigo.png"
printf '%s\n' 'mock artifact' > "$2"
if [ "${FAIL_MOCK:-0}" = 1 ]; then
  printf '%s\n' 'partial artifact' > "$2"
  exit 1
fi
MOCK
chmod +x "$work/mock-appimagetool"
PATH="$work:$PATH"
export PATH
dist="$work/output files"
make appimage DIST_DIR="$dist" APPIMAGETOOL=mock-appimagetool
test -x "$dist/Rigo-x86_64.AppImage"
test "$(find "$dist" -mindepth 1 -maxdepth 1 | wc -l)" -eq 1
if FAIL_MOCK=1 make appimage DIST_DIR="$dist" APPIMAGETOOL="$work/mock-appimagetool"; then
  echo 'Expected the mock packager failure' >&2
  exit 1
fi
printf '%s\n' 'mock artifact' | cmp - "$dist/Rigo-x86_64.AppImage"
test "$(find "$dist" -mindepth 1 -maxdepth 1 | wc -l)" -eq 1
printf '%s\n' 'Packaging smoke test passed'
