; custom.nsh
; Silently removes the legacy Inno Setup installation (any version) before
; the electron-builder NSIS installer proceeds.  This handles the one-time
; migration from AppId {6DDB6EDC-7F9E-4B25-9727-78F7C42D12F0} to
; com.er.team-picker so users do not end up with two entries in Add/Remove.

!macro customInstall
  ; Try HKLM first (per-machine Inno Setup install)
  ReadRegStr $0 HKLM \
    "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{6DDB6EDC-7F9E-4B25-9727-78F7C42D12F0}_is1" \
    "UninstallString"
  ${If} $0 != ""
    DetailPrint "이전 버전 제거 중 (Inno Setup)..."
    ExecWait '"$0" /SILENT'
  ${EndIf}

  ; Also try HKCU (per-user Inno Setup install)
  ReadRegStr $0 HKCU \
    "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{6DDB6EDC-7F9E-4B25-9727-78F7C42D12F0}_is1" \
    "UninstallString"
  ${If} $0 != ""
    DetailPrint "이전 버전 제거 중 (Inno Setup, 사용자)..."
    ExecWait '"$0" /SILENT'
  ${EndIf}
!macroend
