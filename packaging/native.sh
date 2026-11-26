#!/bin/sh
# Called by the Makefile with a staged Linux amd64 binary and output directory.
set -eu
umask 022
format=$1
version=$2
binary=$3
out=$4
case "$format" in deb|rpm) ;; *) exit 2 ;; esac
case "$version" in ''|*[!0-9.]* ) echo 'Unsupported package version' >&2; exit 2 ;; esac

stage=$(mktemp -d -- "$out/.rigo-$format.XXXXXXXX")
rpmtop=
cleanup() {
  if [ -n "$rpmtop" ]; then rm -rf -- "$rpmtop"; fi
  rm -rf -- "$stage"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
icon=Rigo.AppDir/rigo.png

if [ "$format" = deb ]; then
  pkg="$stage/pkg"
  install -D -m 0755 "$binary" "$pkg/usr/bin/rigo"
  install -D -m 0644 rigo.desktop "$pkg/usr/share/applications/rigo.desktop"
  install -D -m 0644 "$icon" "$pkg/usr/share/icons/hicolor/256x256/apps/rigo.png"
  install -D -m 0644 packaging/copyright "$pkg/usr/share/doc/rigo/copyright"
  mkdir -p "$pkg/DEBIAN"
  installed_size=$(du -sk -- "$pkg/usr" | cut -f1)
  {
    printf 'Package: rigo\nVersion: %s-1\n' "$version"
    printf 'Architecture: amd64\nMaintainer: massigent <60149346+massigent@users.noreply.github.com>\n'
    printf 'Installed-Size: %s\nDepends: xdg-utils\nSection: editors\nPriority: optional\n' "$installed_size"
    printf 'Homepage: https://github.com/massigent/rigo\n'
    printf 'Description: minimalist Markdown editor\n Rigo includes live preview, typewriter scrolling and focus dimming.\n'
  } > "$pkg/DEBIAN/control"
  # Do not inherit restrictive build-host ACL masks in package directories.
  find "$pkg" -type d -exec chmod 0755 {} +
  artifact="rigo_${version}-1_amd64.deb"
  dpkg-deb --build --root-owner-group "$pkg" "$stage/$artifact"
else
  # rpmbuild shell macros assume a top directory without spaces. The result
  # is copied into private staging beside the final output before publication.
  rpmtop=$(mktemp -d /tmp/rigo-rpmbuild.XXXXXXXX)
  mkdir -p "$rpmtop/SOURCES"
  install -m 0755 "$binary" "$rpmtop/SOURCES/rigo"
  cp -- rigo.desktop "$icon" packaging/copyright "$rpmtop/SOURCES/"
  rpmbuild -bb --nodeps --target x86_64 \
    --define "_topdir $rpmtop" --define "_tmppath $rpmtop" --define "tc_version $version" \
    --define '_build_id_links none' packaging/rigo.spec
  artifact="rigo-${version}-1.x86_64.rpm"
  cp -- "$rpmtop/RPMS/x86_64/$artifact" "$stage/$artifact"
fi

test -s "$stage/$artifact"
mv -fT -- "$stage/$artifact" "$out/$artifact"
printf 'Created %s\n' "$out/$artifact"
