Unicode true
!include "MUI2.nsh"
!include "WinVer.nsh"
!include "x64.nsh"

!define REGKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Rigo"
!define MUI_ICON "${ICON}"
Name "Rigo"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\Rigo"
RequestExecutionLevel user
SetCompressor /SOLID lzma
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "Rigo"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "FileDescription" "Rigo Setup (x64)"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "Rigo contributors"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  ${IfNot} ${IsNativeAMD64}
  ${OrIfNot} ${AtLeastWin10}
    MessageBox MB_ICONSTOP "Rigo requires Windows 10 or later on an x64 PC." /SD IDOK
    Abort
  ${EndIf}
  SetShellVarContext current
  SetRegView 64
FunctionEnd

Section "Install"
  SetOutPath "$INSTDIR"
  File /oname=rigo.exe "${PAYLOAD}"
  File /oname=Rigo.ico "${ICON}"
  File /oname=NOTICE.txt "${NOTICE}"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortcut "$SMPROGRAMS\Rigo.lnk" "$INSTDIR\rigo.exe" "" "$INSTDIR\Rigo.ico"

  WriteRegStr HKCU "${REGKEY}" "DisplayName" "Rigo"
  WriteRegStr HKCU "${REGKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${REGKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${REGKEY}" "DisplayIcon" "$INSTDIR\Rigo.ico"
  WriteRegStr HKCU "${REGKEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "${REGKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${REGKEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  SetRegView 64
  IfFileExists "$INSTDIR\rigo.exe" 0 remove_files
  ClearErrors
  Delete "$INSTDIR\rigo.exe"
  IfErrors 0 remove_files
  MessageBox MB_ICONSTOP "Close Rigo before uninstalling it." /SD IDOK
  Abort
  remove_files:
  Delete "$SMPROGRAMS\Rigo.lnk"
  Delete "$INSTDIR\NOTICE.txt"
  Delete "$INSTDIR\Rigo.ico"
  Delete "$INSTDIR\Uninstall.exe"
  DeleteRegKey HKCU "${REGKEY}"
  RMDir "$INSTDIR"
SectionEnd
