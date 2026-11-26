# Package the Linux amd64 binary built by the Makefile.
%global debug_package %{nil}

Name:           rigo
Version:        %{tc_version}
Release:        1
Summary:        Minimalist Markdown editor
License:        MIT AND BSD-3-Clause
URL:            https://github.com/massigent/rigo
ExclusiveArch:  x86_64
Requires:       xdg-utils
Source0:        rigo
Source1:        rigo.desktop
Source2:        rigo.png
Source3:        copyright

%description
Rigo is a single-binary Markdown editor with live preview, typewriter
scrolling and focus dimming. It opens the editor in a local web browser.

%install
install -D -m 0755 "%{SOURCE0}" "%{buildroot}%{_bindir}/rigo"
install -D -m 0644 "%{SOURCE1}" "%{buildroot}%{_datadir}/applications/rigo.desktop"
install -D -m 0644 "%{SOURCE2}" "%{buildroot}%{_datadir}/icons/hicolor/256x256/apps/rigo.png"
install -D -m 0644 "%{SOURCE3}" "%{buildroot}%{_datadir}/licenses/rigo/copyright"

%files
%{_bindir}/rigo
%{_datadir}/applications/rigo.desktop
%{_datadir}/icons/hicolor/256x256/apps/rigo.png
%dir %{_datadir}/licenses/rigo
%license %{_datadir}/licenses/rigo/copyright
