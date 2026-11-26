#!/bin/sh
# Inspect the actual cross-built NSIS installer and macOS app archives on Linux.
set -eu
version=${1:-1.0.3}
out=$(cd "${2:-dist}" && pwd -P)
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
trap 'exit 1' HUP INT TERM
setup="$out/Rigo-$version-windows-x64-setup.exe"
7z x -y -o"$work/win" "$setup" >/dev/null
# The NSIS uninstaller is generated at install time; 7z lists the payload files.
for name in rigo.exe Rigo.ico NOTICE.txt; do
  test -s "$work/win/$name"
done
file "$work/win/rigo.exe" | grep -E 'PE32\+ executable for MS Windows.*x86-64'
python3 - "$version" "$out" <<'PY'
import plistlib
import stat
import struct
import sys
from pathlib import Path
from zipfile import ZipFile

version, artifact_dir = sys.argv[1:]
base = 'Rigo.app/Contents/'
for arch, cpu in [('arm64', 0x0100000C), ('amd64', 0x01000007)]:
    path = Path(artifact_dir) / f'Rigo-{version}-macos-{arch}.zip'
    with ZipFile(path) as app:
        assert app.testzip() is None
        info = plistlib.loads(app.read(base + 'Info.plist'))
        assert info['CFBundleExecutable'] == 'rigo'
        assert info['CFBundlePackageType'] == 'APPL'
        assert info['CFBundleShortVersionString'] == version
        executable = app.getinfo(base + 'MacOS/rigo')
        assert executable.create_system == 3 and stat.S_IMODE(executable.external_attr >> 16) == 0o755
        assert struct.unpack('<II', app.read(executable)[:8]) == (0xFEEDFACF, cpu)
        assert app.read(base + 'Resources/' + info['CFBundleIconFile']).startswith(b'icns')
        assert app.read(base + 'Resources/NOTICE.txt')
    print(f'{path.name}: {arch} Mach-O and bundle metadata verified')
PY
