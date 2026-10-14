; Tauri NSIS hooks (bundle.windows.nsis.installerHooks).
;
; The application registers a per-user toast activator when it starts
; (src/toast_activation.rs): HKCU\Software\Classes\AppUserModelId\<identifier>
; with a CustomActivator value, and HKCU\Software\Classes\CLSID\{clsid} whose
; LocalServer32 names the installed executable. Remove both on a real uninstall
; so no activator points at a deleted program. The CLSID is read back from the
; CustomActivator value, so this stays correct for every identifier. Updates
; (/UPDATE) keep the registration. User data is never touched here; the
; uninstaller's own "delete app data" choice stays the only way to remove it.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    Push $R0
    Push $R1
    ReadRegStr $R0 HKCU "Software\Classes\AppUserModelId\${BUNDLEID}" "CustomActivator"
    StrCpy $R1 $R0 1
    ${If} $R1 == "{"
      DeleteRegKey HKCU "Software\Classes\CLSID\$R0"
    ${EndIf}
    DeleteRegKey HKCU "Software\Classes\AppUserModelId\${BUNDLEID}"
    Pop $R1
    Pop $R0
  ${EndIf}
!macroend
