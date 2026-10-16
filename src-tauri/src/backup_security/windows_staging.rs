//! Windows staging has a protected DACL independent of the library's permissions.
use std::{ffi::c_void, mem::size_of, os::windows::ffi::OsStrExt, path::Path, ptr};
use windows::{
    core::{PCWSTR, PWSTR},
    Win32::{
        Foundation::{CloseHandle, LocalFree, HANDLE, HLOCAL},
        Security::{
            Authorization::{
                ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
                GetNamedSecurityInfoW, SetNamedSecurityInfoW, SE_FILE_OBJECT,
            },
            GetAce, GetSecurityDescriptorControl, GetSecurityDescriptorDacl, GetTokenInformation,
            TokenUser, ACCESS_ALLOWED_ACE, ACL, DACL_SECURITY_INFORMATION,
            PROTECTED_DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID, SECURITY_ATTRIBUTES,
            SE_DACL_PROTECTED, TOKEN_QUERY, TOKEN_USER,
        },
        Storage::FileSystem::{CreateDirectoryW, FILE_ALL_ACCESS},
        System::Threading::{GetCurrentProcess, OpenProcessToken},
    },
};

struct LocalMemory(*mut c_void);
impl Drop for LocalMemory {
    fn drop(&mut self) {
        // SDDL conversion and GetNamedSecurityInfo allocate with LocalAlloc.
        unsafe {
            LocalFree(Some(HLOCAL(self.0)));
        }
    }
}
struct Token(HANDLE);
impl Drop for Token {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

fn sid_text(sid: PSID) -> windows::core::Result<String> {
    let mut text = PWSTR::null();
    unsafe {
        ConvertSidToStringSidW(sid, &mut text)?;
    }
    let _memory = LocalMemory(text.0.cast());
    unsafe { Ok(text.to_string()?) }
}

fn current_user() -> windows::core::Result<String> {
    let mut token = Token(HANDLE::default());
    unsafe {
        OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token.0)?;
    }
    let mut needed = 0;
    unsafe {
        let _ = GetTokenInformation(token.0, TokenUser, None, 0, &mut needed);
    }
    if needed == 0 || needed > 4096 {
        return Err(windows::core::Error::from_win32());
    }
    // usize storage satisfies TOKEN_USER alignment; its SID points into this buffer.
    let mut buffer = vec![0usize; (needed as usize).div_ceil(size_of::<usize>())];
    unsafe {
        GetTokenInformation(
            token.0,
            TokenUser,
            Some(buffer.as_mut_ptr().cast()),
            needed,
            &mut needed,
        )?;
        sid_text((*buffer.as_ptr().cast::<TOKEN_USER>()).User.Sid)
    }
}

fn descriptor(sddl: &str) -> windows::core::Result<LocalMemory> {
    let text: Vec<_> = sddl.encode_utf16().chain(Some(0)).collect();
    let mut sd = PSECURITY_DESCRIPTOR::default();
    unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            PCWSTR(text.as_ptr()),
            1,
            &mut sd,
            None,
        )?;
    }
    Ok(LocalMemory(sd.0))
}

fn dacl(sd: PSECURITY_DESCRIPTOR) -> windows::core::Result<*mut ACL> {
    let mut present = false.into();
    let mut defaulted = false.into();
    let mut acl = ptr::null_mut();
    unsafe {
        GetSecurityDescriptorDacl(sd, &mut present, &mut acl, &mut defaulted)?;
    }
    if !present.as_bool() || acl.is_null() {
        return Err(windows::core::Error::from_win32());
    }
    Ok(acl)
}

fn read_descriptor(path: &[u16]) -> windows::core::Result<LocalMemory> {
    let mut sd = PSECURITY_DESCRIPTOR::default();
    unsafe {
        GetNamedSecurityInfoW(
            PCWSTR(path.as_ptr()),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            None,
            None,
            None,
            None,
            &mut sd,
        )
        .ok()?;
    }
    Ok(LocalMemory(sd.0))
}

fn apply(path: &[u16], sd: &LocalMemory) -> windows::core::Result<()> {
    let acl = dacl(PSECURITY_DESCRIPTOR(sd.0))?;
    unsafe {
        SetNamedSecurityInfoW(
            PCWSTR(path.as_ptr()),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
            None,
            None,
            Some(acl),
            None,
        )
        .ok()
    }
}

fn verify(path: &[u16], user: &str) -> windows::core::Result<()> {
    let allocation = read_descriptor(path)?;
    let sd = PSECURITY_DESCRIPTOR(allocation.0);
    let mut control = 0;
    let mut revision = 0;
    unsafe {
        GetSecurityDescriptorControl(sd, &mut control, &mut revision)?;
    }
    let acl = dacl(sd)?;
    if control & SE_DACL_PROTECTED.0 == 0 || unsafe { (*acl).AceCount } != 2 {
        return Err(windows::core::Error::from_win32());
    }
    let mut trustees = Vec::new();
    for index in 0..2 {
        let mut ace = ptr::null_mut();
        unsafe {
            GetAce(acl, index, &mut ace)?;
        }
        // Check the header before reading the ACCESS_ALLOWED_ACE-specific fields.
        let header = unsafe { &*ace.cast::<windows::Win32::Security::ACE_HEADER>() };
        // ACCESS_ALLOWED_ACE_TYPE = 0; OI | CI = 3, with no inherited ACEs.
        if header.AceType != 0 || header.AceFlags != 3 {
            return Err(windows::core::Error::from_win32());
        }
        let ace = unsafe { &*ace.cast::<ACCESS_ALLOWED_ACE>() };
        if ace.Mask != FILE_ALL_ACCESS.0 {
            return Err(windows::core::Error::from_win32());
        }
        trustees.push(sid_text(PSID(
            ptr::addr_of!(ace.SidStart).cast_mut().cast(),
        ))?);
    }
    trustees.sort();
    let mut expected = vec![user.to_owned(), "S-1-5-18".to_owned()];
    expected.sort();
    if trustees != expected {
        return Err(windows::core::Error::from_win32());
    }
    Ok(())
}

pub(super) fn ensure(dir: &Path) -> windows::core::Result<()> {
    let user = current_user()?;
    let sd = descriptor(&format!("D:P(A;OICI;FA;;;{user})(A;OICI;FA;;;SY)"))?;
    let path: Vec<_> = dir.as_os_str().encode_wide().chain(Some(0)).collect();
    let attributes = SECURITY_ATTRIBUTES {
        nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: sd.0,
        bInheritHandle: false.into(),
    };
    // New directories are private at creation, before any plaintext is written.
    if let Err(error) = unsafe { CreateDirectoryW(PCWSTR(path.as_ptr()), Some(&attributes)) } {
        if !dir.is_dir() {
            return Err(error);
        }
    }
    // Reused staging gets the same protected DACL; no parent ACL is modified.
    apply(&path, &sd)?;
    verify(&path, &user)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn private_staging_restricts_new_and_reused_directories_without_changing_library_acl() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("library");
        std::fs::create_dir(&root).unwrap();
        let root_path: Vec<_> = root.as_os_str().encode_wide().chain(Some(0)).collect();
        let broad = descriptor("D:P(A;OICI;FA;;;WD)").unwrap();
        apply(&root_path, &broad).unwrap();
        let dir = crate::backup_security::ensure_staging(&root).unwrap();
        let path: Vec<_> = dir.as_os_str().encode_wide().chain(Some(0)).collect();
        let user = current_user().unwrap();
        verify(&path, &user).unwrap();
        apply(&path, &broad).unwrap();
        assert!(verify(&path, &user).is_err());
        crate::backup_security::ensure_staging(&root).unwrap();
        verify(&path, &user).unwrap();
        let root_sd = read_descriptor(&root_path).unwrap();
        let root_acl = dacl(PSECURITY_DESCRIPTOR(root_sd.0)).unwrap();
        assert_eq!(
            unsafe { (*root_acl).AceCount },
            1,
            "library ACL must stay broad"
        );
        let mut root_ace = ptr::null_mut();
        unsafe {
            GetAce(root_acl, 0, &mut root_ace).unwrap();
        }
        let root_ace = unsafe { &*root_ace.cast::<ACCESS_ALLOWED_ACE>() };
        assert_eq!(
            sid_text(PSID(ptr::addr_of!(root_ace.SidStart).cast_mut().cast())).unwrap(),
            "S-1-1-0"
        );
        // New plaintext files and subdirectories inherit only the allowed trustees.
        let nested = dir.join("plaintext");
        std::fs::create_dir(&nested).unwrap();
        let plain = nested.join("fictional.thingary");
        std::fs::write(&plain, b"fictional plaintext").unwrap();
        for child in [&nested, &plain] {
            let child_path: Vec<_> = child.as_os_str().encode_wide().chain(Some(0)).collect();
            let sd = read_descriptor(&child_path).unwrap();
            let acl = dacl(PSECURITY_DESCRIPTOR(sd.0)).unwrap();
            assert_eq!(unsafe { (*acl).AceCount }, 2);
            for index in 0..2 {
                let mut ace = ptr::null_mut();
                unsafe {
                    GetAce(acl, index, &mut ace).unwrap();
                }
                let ace = unsafe { &*ace.cast::<ACCESS_ALLOWED_ACE>() };
                let sid = sid_text(PSID(ptr::addr_of!(ace.SidStart).cast_mut().cast())).unwrap();
                assert!([user.clone(), "S-1-5-18".into()].contains(&sid));
            }
        }
        let blocked = temp.path().join("blocked");
        std::fs::create_dir(&blocked).unwrap();
        std::fs::write(blocked.join("backup-staging"), b"not a directory").unwrap();
        assert_eq!(
            crate::backup_security::ensure_staging(&blocked)
                .unwrap_err()
                .code,
            "BACKUP_PRIVATE_DIR"
        );
    }
}
