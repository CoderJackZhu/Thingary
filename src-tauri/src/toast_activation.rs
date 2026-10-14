//! Windows unpackaged toast activation. The NSIS Start-menu shortcut carries
//! the AUMID used to display notifications, but an unpackaged app also needs a
//! registered COM activator before a toast click can open it. This mirrors the
//! documented desktop pattern from Microsoft.Toolkit.Uwp.Notifications
//! (ToastNotificationManagerCompat): `AppUserModelId\{AUMID}` CustomActivator
//! and DisplayName values, `CLSID\{CLSID}\LocalServer32` pointing at this exe,
//! the shortcut's `System.AppUserModel.ToastActivatorCLSID` property, and a
//! class object registered for the process lifetime. Activation only shows and
//! focuses the main window; there is no deep-link payload, background service
//! or new navigation.

#[cfg(any(windows, test))]
pub(crate) fn activator_clsid(identity: &str) -> String {
    // Deterministic per-identity CLSID, mirroring the toolkit's name-hash GUID
    // derivation; SHA-256 is already a dependency of this crate.
    use sha2::{Digest, Sha256};
    let hash = Sha256::digest(identity.as_bytes());
    let hex = |i: usize| format!("{:02x}", hash[i]);
    format!(
        "{}{}{}{}-{}{}-{}{}-{}{}-{}{}{}{}{}{}",
        hex(0),
        hex(1),
        hex(2),
        hex(3),
        hex(4),
        hex(5),
        hex(6),
        hex(7),
        hex(8),
        hex(9),
        hex(10),
        hex(11),
        hex(12),
        hex(13),
        hex(14),
        hex(15)
    )
}

#[cfg(any(windows, test))]
pub(crate) fn activator_value(clsid: &str) -> String {
    format!("{{{clsid}}}")
}

#[cfg(any(windows, test))]
pub(crate) fn local_server_command(exe_path: &str) -> String {
    // The launch flag lets a future start know the process was COM-launched;
    // the application itself ignores extra arguments.
    format!("\"{exe_path}\" -ToastActivated")
}

#[cfg(windows)]
mod native {
    use super::{activator_clsid, activator_value, local_server_command};
    use tauri::Manager;
    use windows::core::{implement, Interface, GUID, HRESULT, HSTRING, PCWSTR, PWSTR};
    use windows::Win32::Foundation::{CLASS_E_NOAGGREGATION, E_POINTER, PROPERTYKEY};
    use windows::Win32::System::Com::StructuredStorage::{
        PropVariantClear, PropVariantToStringAlloc, PROPVARIANT, PROPVARIANT_0_0,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoRegisterClassObject, CoTaskMemAlloc, CoTaskMemFree,
        CoUninitialize, IClassFactory, IClassFactory_Impl, IPersistFile, CLSCTX_INPROC_SERVER,
        CLSCTX_LOCAL_SERVER, COINIT_APARTMENTTHREADED, REGCLS_MULTIPLEUSE, STGM_READWRITE,
    };
    use windows::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegSetValueExW, HKEY_CURRENT_USER, KEY_SET_VALUE,
        REG_OPTION_NON_VOLATILE, REG_SZ,
    };
    use windows::Win32::System::Variant::VT_LPWSTR;
    use windows::Win32::UI::Notifications::{
        INotificationActivationCallback, INotificationActivationCallback_Impl,
        NOTIFICATION_USER_INPUT_DATA,
    };
    use windows::Win32::UI::Shell::PropertiesSystem::{IPropertyStore, PSGetPropertyKeyFromName};
    use windows::Win32::UI::Shell::{
        FOLDERID_Programs, IShellLinkW, SHGetKnownFolderPath, KNOWN_FOLDER_FLAG,
    };

    const ACTIVATOR_VALUE_NAME: PCWSTR = windows::core::w!("CustomActivator");
    const DISPLAY_NAME_VALUE: PCWSTR = windows::core::w!("DisplayName");
    const AUMID_PROPERTY: PCWSTR = windows::core::w!("System.AppUserModel.ID");
    const TOAST_ACTIVATOR_PROPERTY: PCWSTR =
        windows::core::w!("System.AppUserModel.ToastActivatorCLSID");

    pub(crate) fn enable(app: &tauri::AppHandle) {
        let identity = app.config().identifier.clone();
        let display_name = app
            .config()
            .product_name
            .clone()
            .unwrap_or_else(|| "物谱 Thingary".into());
        if let Err(error) = register_identity(&identity, &display_name) {
            eprintln!("Windows 通知激活注册未完成：{error}");
            return;
        }
        if let Err(error) = register_class_object(app.clone(), &identity) {
            eprintln!("Windows 通知激活对象未注册：{error}");
        }
    }

    fn register_identity(identity: &str, display_name: &str) -> windows::core::Result<()> {
        let clsid = activator_clsid(identity);
        let aumid_key = format!(r"Software\Classes\AppUserModelId\{identity}");
        set_registry_string(
            &aumid_key,
            Some(ACTIVATOR_VALUE_NAME),
            &activator_value(&clsid),
        )?;
        set_registry_string(&aumid_key, Some(DISPLAY_NAME_VALUE), display_name)?;
        let exe = std::env::current_exe().map_err(|error| {
            windows::core::Error::new(HRESULT(0x80070005_u32 as _), error.to_string())
        })?;
        let server_key = format!(r"Software\Classes\CLSID\{{{clsid}}}\LocalServer32");
        set_registry_string(
            &server_key,
            None,
            &local_server_command(&exe.to_string_lossy()),
        )?;
        mark_start_menu_shortcuts(identity, &activator_value(&clsid))
    }

    fn set_registry_string(
        subkey: &str,
        value_name: Option<PCWSTR>,
        data: &str,
    ) -> windows::core::Result<()> {
        let mut key = Default::default();
        unsafe {
            RegCreateKeyExW(
                HKEY_CURRENT_USER,
                &HSTRING::from(subkey),
                None,
                None,
                REG_OPTION_NON_VOLATILE,
                KEY_SET_VALUE,
                None,
                &mut key,
                None,
            )
        }
        .ok()?;
        let mut wide = Vec::with_capacity((data.len() + 1) * 2);
        for unit in data.encode_utf16().chain(core::iter::once(0)) {
            wide.extend_from_slice(&unit.to_le_bytes());
        }
        let result = unsafe {
            RegSetValueExW(
                key,
                value_name.unwrap_or(PCWSTR::null()),
                None,
                REG_SZ,
                Some(&wide),
            )
            .ok()
        };
        let _ = unsafe { RegCloseKey(key) };
        result
    }

    fn mark_start_menu_shortcuts(identity: &str, activator: &str) -> windows::core::Result<()> {
        // Setup may run before the event loop initializes COM on this thread;
        // shell property-store access needs an apartment either way.
        let apartment = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().is_ok() };
        let result = mark_start_menu_shortcuts_inner(identity, activator);
        if apartment {
            unsafe { CoUninitialize() };
        }
        result
    }

    fn mark_start_menu_shortcuts_inner(
        identity: &str,
        activator: &str,
    ) -> windows::core::Result<()> {
        let programs =
            unsafe { SHGetKnownFolderPath(&FOLDERID_Programs, KNOWN_FOLDER_FLAG(0), None)? };
        let path = unsafe { programs.to_string() }.map_err(|error| {
            windows::core::Error::new(HRESULT(0x80070057_u32 as _), error.to_string())
        })?;
        unsafe { CoTaskMemFree(Some(programs.as_ptr() as _)) };
        let mut shortcuts = Vec::new();
        collect_shortcuts(std::path::Path::new(&path), 0, &mut shortcuts);
        let mut marked = 0usize;
        let mut failure = None;
        for shortcut in &shortcuts {
            match mark_shortcut(shortcut, identity, activator) {
                Ok(true) => marked += 1,
                Ok(false) => {}
                Err(error) => failure = Some(error),
            }
        }
        if marked == 0 {
            // The notifier cannot display without an AUMID shortcut, so an
            // empty result means the installed layout differs from that.
            return Err(failure.unwrap_or_else(|| {
                windows::core::Error::new(
                    HRESULT(0x80070002_u32 as _),
                    format!(
                        "开始菜单未找到本应用快捷方式（枚举 {} 个）",
                        shortcuts.len()
                    ),
                )
            }));
        }
        Ok(())
    }

    fn collect_shortcuts(dir: &std::path::Path, depth: u8, out: &mut Vec<String>) {
        if depth > 2 {
            return;
        }
        let entries = match std::fs::read_dir(dir) {
            Ok(entries) => entries,
            Err(_) => return,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path
                .extension()
                .is_some_and(|e| e.eq_ignore_ascii_case("lnk"))
            {
                out.push(path.to_string_lossy().into_owned());
            } else if path.is_dir() {
                collect_shortcuts(&path, depth + 1, out);
            }
        }
    }

    fn mark_shortcut(path: &str, identity: &str, activator: &str) -> windows::core::Result<bool> {
        unsafe {
            // CLSID_ShellLink from shlguid.h; windows-rs does not ship the constant.
            let clsid_shell_link = GUID::from_u128(0x00021401_0000_0000_c000_000000000046);
            let link: IShellLinkW =
                CoCreateInstance(&clsid_shell_link, None, CLSCTX_INPROC_SERVER)?;
            let file: IPersistFile = link.cast()?;
            // Read-write: committing a property-store change on a shortcut
            // opened read-only fails with STG_E_ACCESSDENIED.
            file.Load(&HSTRING::from(path), STGM_READWRITE)?;
            let store: IPropertyStore = link.cast()?;
            let mut aumid_key = PROPERTYKEY::default();
            PSGetPropertyKeyFromName(AUMID_PROPERTY, &mut aumid_key)?;
            let mut current = match store.GetValue(&aumid_key) {
                Ok(current) => current,
                Err(_) => return Ok(false),
            };
            let matches = PropVariantToStringAlloc(&current)
                .ok()
                .map(|value| {
                    let text = value.to_string().unwrap_or_default();
                    CoTaskMemFree(Some(value.as_ptr() as _));
                    text == identity
                })
                .unwrap_or(false);
            PropVariantClear(&mut current)?;
            if !matches {
                return Ok(false);
            }
            let mut activator_key = PROPERTYKEY::default();
            PSGetPropertyKeyFromName(TOAST_ACTIVATOR_PROPERTY, &mut activator_key)?;
            // PROPVARIANT strings must be CoTaskMem allocated: PropVariantClear
            // frees the pointer, so a Rust-owned buffer would corrupt the heap.
            let wide: Vec<u16> = activator
                .encode_utf16()
                .chain(core::iter::once(0))
                .collect();
            let buffer = CoTaskMemAlloc(wide.len() * 2);
            if buffer.is_null() {
                return Err(windows::core::Error::from_hresult(windows::core::HRESULT(
                    0x80070008_u32 as _,
                )));
            }
            core::ptr::copy_nonoverlapping(wide.as_ptr(), buffer as *mut u16, wide.len());
            let mut value = PROPVARIANT::default();
            let inner = &mut *(&mut value.Anonymous.Anonymous
                as *mut core::mem::ManuallyDrop<PROPVARIANT_0_0>
                as *mut PROPVARIANT_0_0);
            inner.vt = VT_LPWSTR;
            inner.Anonymous.pwszVal = PWSTR(buffer as *mut u16);
            store.SetValue(&activator_key, &value)?;
            PropVariantClear(&mut value)?;
            store.Commit()?;
            // The ShellLink property store only persists properties through
            // IPersistFile; Commit alone reports success without writing.
            file.Save(&HSTRING::from(path), true)?;
            Ok(true)
        }
    }

    #[implement(IClassFactory)]
    struct ToastActivatorFactory {
        app: tauri::AppHandle,
    }

    impl IClassFactory_Impl for ToastActivatorFactory_Impl {
        fn CreateInstance(
            &self,
            outer: windows::core::Ref<'_, windows::core::IUnknown>,
            iid: *const GUID,
            out: *mut *mut core::ffi::c_void,
        ) -> windows::core::Result<()> {
            if out.is_null() {
                return Err(E_POINTER.into());
            }
            unsafe { *out = core::ptr::null_mut() };
            if !outer.is_null() {
                return Err(CLASS_E_NOAGGREGATION.into());
            }
            let activator: INotificationActivationCallback = ToastActivator {
                app: self.app.clone(),
            }
            .into();
            let unknown: windows::core::IUnknown = activator.into();
            unsafe { (unknown.vtable().QueryInterface)(unknown.as_raw(), iid, out) }.ok()
        }

        fn LockServer(&self, _lock: windows::core::BOOL) -> windows::core::Result<()> {
            Ok(())
        }
    }

    #[implement(INotificationActivationCallback)]
    struct ToastActivator {
        app: tauri::AppHandle,
    }

    impl INotificationActivationCallback_Impl for ToastActivator_Impl {
        fn Activate(
            &self,
            _app_user_model_id: &PCWSTR,
            _invoked_arguments: &PCWSTR,
            _input: *const NOTIFICATION_USER_INPUT_DATA,
            _count: u32,
        ) -> windows::core::Result<()> {
            // Basic wake-up only: bring the existing window forward on the UI
            // thread without touching data or navigation.
            let app = self.app.clone();
            let focus = app.clone();
            app.run_on_main_thread(move || {
                if let Some(window) = focus.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            })
            .map_err(|error| {
                windows::core::Error::new(HRESULT(0x80004005_u32 as _), error.to_string())
            })
        }
    }

    fn register_class_object(app: tauri::AppHandle, identity: &str) -> windows::core::Result<()> {
        let clsid = activator_clsid(identity);
        let compact: String = clsid.chars().filter(|c| *c != '-').collect();
        let guid = u128::from_str_radix(&compact, 16)
            .map(GUID::from_u128)
            .map_err(|_| {
                windows::core::Error::new(HRESULT(0x80070057_u32 as _), "激活 CLSID 无效")
            })?;
        let factory: IClassFactory = ToastActivatorFactory { app }.into();
        // The registration lives for the process lifetime; the SCM releases it
        // when the process exits, so no explicit revoke is needed here.
        unsafe { CoRegisterClassObject(&guid, &factory, CLSCTX_LOCAL_SERVER, REGCLS_MULTIPLEUSE)? };
        core::mem::forget(factory);
        Ok(())
    }
}

#[cfg(windows)]
pub(crate) use native::enable;

#[cfg(test)]
mod tests {
    use super::{activator_clsid, activator_value, local_server_command};

    #[test]
    fn activator_clsid_is_stable_and_identity_scoped() {
        let first = activator_clsid("local.thingary.win.acceptance");
        assert_eq!(first, activator_clsid("local.thingary.win.acceptance"));
        assert_ne!(first, activator_clsid("local.thingary.preview"));
        assert_ne!(first, activator_clsid("local.thingary.main"));
        assert!(first.chars().all(|c| c.is_ascii_hexdigit() || c == '-'));
        let widths: Vec<usize> = first.split('-').map(|part| part.len()).collect();
        assert_eq!(
            widths,
            vec![8, 4, 4, 4, 12],
            "GUID fields use canonical widths"
        );
    }

    #[test]
    fn registry_values_follow_the_documented_formats() {
        let clsid = activator_clsid("local.thingary.win.acceptance");
        assert_eq!(activator_value(&clsid), format!("{{{clsid}}}"));
        assert_eq!(
            local_server_command(r"C:\Apps\Thingary\thingary.exe"),
            "\"C:\\Apps\\Thingary\\thingary.exe\" -ToastActivated"
        );
    }
}
