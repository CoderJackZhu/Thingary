fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rerun-if-changed=native/images.m");
        println!("cargo:rerun-if-changed=native/auth.m");
        println!("cargo:rerun-if-changed=native/notifications.m");
        let mut native = cc::Build::new();
        if std::env::var_os("CARGO_FEATURE_FAULT_INJECTION").is_some() {
            native.define("THINGARY_NOTIFICATION_ACCEPTANCE", None);
        }
        native
            .file("native/images.m")
            .file("native/auth.m")
            .file("native/notifications.m")
            .flag("-fobjc-arc")
            .flag("-mmacosx-version-min=14.0")
            .compile("thingary_images");
        for framework in [
            "AppKit",
            "LocalAuthentication",
            "UserNotifications",
            "ImageIO",
            "UniformTypeIdentifiers",
            "CoreGraphics",
            "Foundation",
        ] {
            println!("cargo:rustc-link-lib=framework={framework}");
        }
    }
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("ios") {
        println!("cargo:rerun-if-changed=native/ios.m");
        println!("cargo:rerun-if-changed=native/ios_pdf.m");
        cc::Build::new()
            .file("native/ios.m")
            .file("native/ios_pdf.m")
            .flag("-fobjc-arc")
            .compile("thingary_ios");
        for framework in [
            "UIKit",
            "PhotosUI",
            "WebKit",
            "LocalAuthentication",
            "UserNotifications",
            "ImageIO",
            "UniformTypeIdentifiers",
            "CoreGraphics",
            "Foundation",
        ] {
            println!("cargo:rustc-link-lib=framework={framework}");
        }
    }
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        println!("cargo:rerun-if-changed=windows/app.manifest");
        let windows = tauri_build::WindowsAttributes::new()
            .app_manifest(include_str!("windows/app.manifest"));
        tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
            .expect("failed to prepare Windows build");
    } else {
        tauri_build::build();
    }
}
