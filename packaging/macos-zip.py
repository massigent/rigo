#!/usr/bin/env python3
"""Package a prebuilt Mach-O as a macOS drag-and-drop application."""
import plistlib
import stat
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


def package(version, binary, icon, notice, output):
    info = {
        "CFBundleIdentifier": "io.github.massigent.rigo",
        "CFBundleName": "Rigo",
        "CFBundleDisplayName": "Rigo",
        "CFBundleExecutable": "rigo",
        "CFBundlePackageType": "APPL",
        "CFBundleShortVersionString": version,
        "CFBundleVersion": version,
        "CFBundleIconFile": "Rigo.icns",
        "LSMinimumSystemVersion": "11.0",
    }
    with ZipFile(output, "w") as archive:
        for path, data, mode in (
            ("Info.plist", plistlib.dumps(info), 0o644),
            ("MacOS/rigo", Path(binary).read_bytes(), 0o755),
            ("Resources/Rigo.icns", Path(icon).read_bytes(), 0o644),
            ("Resources/NOTICE.txt", Path(notice).read_bytes(), 0o644),
        ):
            member = ZipInfo("Rigo.app/Contents/" + path)
            member.create_system = 3  # UNIX; preserve the executable bit in Finder.
            member.external_attr = (stat.S_IFREG | mode) << 16
            archive.writestr(member, data, compress_type=ZIP_DEFLATED)


if __name__ == "__main__":
    if len(sys.argv) != 6:
        sys.exit(f"usage: {sys.argv[0]} VERSION BINARY ICON NOTICE OUTPUT")
    package(*sys.argv[1:])
