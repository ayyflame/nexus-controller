; NEXUS additions to Tauri's NSIS installer (bundle.windows.nsis.installerHooks).
;
; Tauri's uninstaller already removes NEXUS's "Start with Windows" entry
; (HKCU\Software\Microsoft\Windows\CurrentVersion\Run\NEXUS) and keeps
; profiles, macros and settings unless the user ticks "Delete the application
; data". This hook also removes the on/off flag Task Manager may have stored
; for that entry. Never during an update ($UpdateMode = 1), so updating keeps
; the user's choice.

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "${PRODUCTNAME}"
  ${EndIf}
!macroend
