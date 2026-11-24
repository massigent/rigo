# Package the Linux amd64 binary built by the Makefile.
%global debug_package %{nil}

Name:           typecraft
Version:        %{tc_version}
Release:        1
Summary:        Minimalist Markdown editor
License:        MIT AND BSD-3-Clause
URL:            https://github.com/massigent/typecraft
ExclusiveArch:  x86_64
Requires:       xdg-utils
Source0:        typecraft
Source1:        typecraft.desktop
Source2:        typecraft.png
Source3:        copyright

%description
TypeCraft is a single-binary Markdown editor with live preview, typewriter
scrolling and focus dimming. It opens the editor in a local web browser.

%install
install -D -m 0755 "%{SOURCE0}" "%{buildroot}%{_bindir}/typecraft"
install -D -m 0644 "%{SOURCE1}" "%{buildroot}%{_datadir}/applications/typecraft.desktop"
install -D -m 0644 "%{SOURCE2}" "%{buildroot}%{_datadir}/icons/hicolor/256x256/apps/typecraft.png"
install -D -m 0644 "%{SOURCE3}" "%{buildroot}%{_datadir}/licenses/typecraft/copyright"

%files
%{_bindir}/typecraft
%{_datadir}/applications/typecraft.desktop
%{_datadir}/icons/hicolor/256x256/apps/typecraft.png
%dir %{_datadir}/licenses/typecraft
%license %{_datadir}/licenses/typecraft/copyright
