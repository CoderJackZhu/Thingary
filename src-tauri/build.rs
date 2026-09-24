fn main() {
    println!("cargo:rerun-if-changed=native/images.m");
    cc::Build::new()
        .file("native/images.m")
        .flag("-fobjc-arc")
        .flag("-mmacosx-version-min=14.0")
        .compile("possio_images");
    for framework in [
        "AppKit",
        "ImageIO",
        "UniformTypeIdentifiers",
        "CoreGraphics",
        "Foundation",
    ] {
        println!("cargo:rustc-link-lib=framework={framework}");
    }
    tauri_build::build()
}
