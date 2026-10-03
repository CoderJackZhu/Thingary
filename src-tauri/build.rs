fn main() {
    println!("cargo:rerun-if-changed=native/images.m");
    println!("cargo:rerun-if-changed=native/notifications.m");
    let mut native = cc::Build::new();
    if std::env::var_os("CARGO_FEATURE_FAULT_INJECTION").is_some() {
        native.define("THINGARY_NOTIFICATION_ACCEPTANCE", None);
    }
    native
        .file("native/images.m")
        .file("native/notifications.m")
        .flag("-fobjc-arc")
        .flag("-mmacosx-version-min=14.0")
        .compile("thingary_images");
    for framework in [
        "AppKit",
        "UserNotifications",
        "ImageIO",
        "UniformTypeIdentifiers",
        "CoreGraphics",
        "Foundation",
    ] {
        println!("cargo:rustc-link-lib=framework={framework}");
    }
    tauri_build::build()
}
