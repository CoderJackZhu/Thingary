# 第三方许可证清单

本文件由 `node scripts/third-party-licenses.mjs` 生成，列出锁定的 macOS（Apple Silicon、Intel）与 Windows x64 MSVC Rust 依赖并集（保守包含构建依赖，不含仅用于测试的依赖）与前端生产依赖及其许可证标识。目标范围为 `aarch64-apple-darwin`、`x86_64-apple-darwin`、`x86_64-pc-windows-msvc`；目标列表示该依赖在对应目标的解析图中可达，不代表已经完成原生构建、验收或发布，也不等于二进制中实际链接的包。物谱自身按 [AGPL-3.0-or-later](LICENSE) 授权。此清单仅列标识与来源；安装包内 `许可/THIRD_PARTY_NOTICES.txt` 附全文与声明，由 `node scripts/distribution-notices.mjs` 按打包目标离线收集，另附每份文本的来源和 SHA-256。补全文本见 [说明](https://github.com/CoderJackZhu/Thingary/blob/main/scripts/license-overrides/README.md)；依赖升级后请重新核对并生成。

直接内置的外部内容不由包管理器发现，另见 [来源告知](SOURCE_NOTICES.md)；随包告知同时附上来源告知。

## Rust（macOS 与 Windows 目标并集，325 个）

许可证分布：MIT OR Apache-2.0（154）、MIT（55）、Apache-2.0 OR MIT（30）、MIT/Apache-2.0（21）、Unicode-3.0（18）、Unlicense OR MIT（9）、Zlib OR Apache-2.0 OR MIT（9）、MPL-2.0（5）、MIT OR Apache-2.0 OR Zlib（3）、BSD-3-Clause（2）、Zlib（2）、MIT OR Zlib OR Apache-2.0（2）、BSD-3-Clause OR Apache-2.0（2）、Unlicense/MIT（2）、Apache-2.0（2）、0BSD OR MIT OR Apache-2.0（1）、BSD-3-Clause AND MIT（1）、BSD-3-Clause/MIT（1）、Apache-2.0 AND MIT（1）、CC0-1.0 OR MIT-0 OR Apache-2.0（1）、(Apache-2.0 OR MIT) AND BSD-3-Clause（1）、Apache-2.0 / MIT（1）、Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT（1）、(MIT OR Apache-2.0) AND Unicode-3.0（1）

| 名称 | 版本 | 许可证 | 来源 | 目标 |
|---|---|---|---|---|
| adler2 | 2.0.1 | 0BSD OR MIT OR Apache-2.0 | https://github.com/oyvindln/adler2 | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| aho-corasick | 1.1.5 | Unlicense OR MIT | https://github.com/BurntSushi/aho-corasick | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| alloc-no-stdlib | 2.0.4 | BSD-3-Clause | https://github.com/dropbox/rust-alloc-no-stdlib | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| alloc-stdlib | 0.2.4 | BSD-3-Clause | https://github.com/dropbox/rust-alloc-no-stdlib | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| anyhow | 1.0.104 | MIT OR Apache-2.0 | https://github.com/dtolnay/anyhow | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| atoi_simd | 0.18.1 | MIT OR Apache-2.0 | https://github.com/RoDmitry/atoi_simd | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| autocfg | 1.5.1 | Apache-2.0 OR MIT | https://github.com/cuviper/autocfg | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| base64 | 0.21.7 | MIT OR Apache-2.0 | https://github.com/marshallpierce/rust-base64 | aarch64-apple-darwin<br>x86_64-apple-darwin |
| base64 | 0.22.1 | MIT OR Apache-2.0 | https://github.com/marshallpierce/rust-base64 | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| base64 | 0.23.1 | MIT OR Apache-2.0 | https://github.com/marshallpierce/rust-base64 | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| bit-set | 0.8.0 | Apache-2.0 OR MIT | https://github.com/contain-rs/bit-set | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| bit-vec | 0.8.0 | Apache-2.0 OR MIT | https://github.com/contain-rs/bit-vec | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| bitflags | 1.3.2 | MIT/Apache-2.0 | https://github.com/bitflags/bitflags | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| bitflags | 2.13.2 | MIT OR Apache-2.0 | https://github.com/bitflags/bitflags | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| block-buffer | 0.10.4 | MIT OR Apache-2.0 | https://github.com/RustCrypto/utils | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| block2 | 0.6.2 | MIT | https://github.com/madsmtm/objc2 | aarch64-apple-darwin<br>x86_64-apple-darwin |
| brotli | 8.0.4 | BSD-3-Clause AND MIT | https://github.com/dropbox/rust-brotli | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| brotli-decompressor | 5.0.3 | BSD-3-Clause/MIT | https://github.com/dropbox/rust-brotli-decompressor | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| bs58 | 0.5.1 | MIT/Apache-2.0 | https://github.com/Nullus157/bs58-rs | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| bumpalo | 3.20.3 | MIT OR Apache-2.0 | https://github.com/fitzgen/bumpalo | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| bytemuck | 1.25.2 | Zlib OR Apache-2.0 OR MIT | https://github.com/Lokathor/bytemuck | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| byteorder | 1.5.0 | Unlicense OR MIT | https://github.com/BurntSushi/byteorder | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| byteorder-lite | 0.1.0 | Unlicense OR MIT | https://github.com/image-rs/byteorder-lite | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| bytes | 1.12.1 | MIT | https://github.com/tokio-rs/bytes | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| calamine | 0.36.1 | MIT | https://github.com/tafia/calamine | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| camino | 1.2.6 | MIT OR Apache-2.0 | https://github.com/camino-rs/camino | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| cargo-platform | 0.1.9 | MIT OR Apache-2.0 | https://github.com/rust-lang/cargo | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| cargo_metadata | 0.19.2 | MIT | https://github.com/oli-obk/cargo_metadata | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| cargo_toml | 0.22.3 | Apache-2.0 OR MIT | https://gitlab.com/lib.rs/cargo_toml | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| cc | 1.4.7 | MIT OR Apache-2.0 | https://github.com/rust-lang/cc-rs | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| cfb | 0.7.3 | MIT | https://github.com/mdsteele/rust-cfb | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| cfg-if | 1.0.5 | MIT OR Apache-2.0 | https://github.com/rust-lang/cfg-if | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| chrono | 0.4.45 | MIT OR Apache-2.0 | https://github.com/chronotope/chrono | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| codepage | 0.1.3 | Apache-2.0 OR MIT | https://github.com/hsivonen/codepage | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| cookie | 0.18.2 | MIT OR Apache-2.0 | https://github.com/SergioBenitez/cookie-rs | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| core-foundation | 0.10.1 | MIT OR Apache-2.0 | https://github.com/servo/core-foundation-rs | aarch64-apple-darwin<br>x86_64-apple-darwin |
| core-foundation-sys | 0.8.7 | MIT OR Apache-2.0 | https://github.com/servo/core-foundation-rs | aarch64-apple-darwin<br>x86_64-apple-darwin |
| core-graphics | 0.25.0 | MIT OR Apache-2.0 | https://github.com/servo/core-foundation-rs | aarch64-apple-darwin<br>x86_64-apple-darwin |
| core-graphics-types | 0.2.0 | MIT OR Apache-2.0 | https://github.com/servo/core-foundation-rs | aarch64-apple-darwin<br>x86_64-apple-darwin |
| core_detect | 1.0.0 | MIT/Apache-2.0 | https://github.com/thomcc/core_detect | x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| cpufeatures | 0.2.17 | MIT OR Apache-2.0 | https://github.com/RustCrypto/utils | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| crc32fast | 1.5.2 | MIT OR Apache-2.0 | https://github.com/srijs/rust-crc32fast | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| crossbeam-channel | 0.5.17 | MIT OR Apache-2.0 | https://github.com/crossbeam-rs/crossbeam | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| crossbeam-utils | 0.8.23 | MIT OR Apache-2.0 | https://github.com/crossbeam-rs/crossbeam | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| crypto-common | 0.1.7 | MIT OR Apache-2.0 | https://github.com/RustCrypto/traits | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| cssparser | 0.36.0 | MPL-2.0 | https://github.com/servo/rust-cssparser | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| cssparser-macros | 0.6.1 | MPL-2.0 | https://github.com/servo/rust-cssparser | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| ctor | 0.8.0 | Apache-2.0 OR MIT | https://github.com/mmastrac/rust-ctor | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| ctor-proc-macro | 0.0.7 | Apache-2.0 OR MIT | https://github.com/mmastrac/rust-ctor | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| darling | 0.24.1 | MIT | https://github.com/TedDriggs/darling | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| darling_core | 0.24.1 | MIT | https://github.com/TedDriggs/darling | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| darling_macro | 0.24.1 | MIT | https://github.com/TedDriggs/darling | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| debug_unsafe | 0.1.4 | MIT OR Apache-2.0 | https://github.com/RoDmitry/debug_unsafe | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| defmt | 1.1.1 | MIT OR Apache-2.0 | https://github.com/knurling-rs/defmt | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| defmt-macros | 1.1.1 | MIT OR Apache-2.0 | https://github.com/knurling-rs/defmt | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| defmt-parser | 1.0.0 | MIT OR Apache-2.0 | https://github.com/knurling-rs/defmt | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| deranged | 0.5.8 | MIT OR Apache-2.0 | https://github.com/jhpratt/deranged | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| derive_more | 2.1.1 | MIT | https://github.com/JelteF/derive_more | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| derive_more-impl | 2.1.1 | MIT | https://github.com/JelteF/derive_more | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| digest | 0.10.7 | MIT OR Apache-2.0 | https://github.com/RustCrypto/traits | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| dirs | 6.0.0 | MIT OR Apache-2.0 | https://github.com/soc/dirs-rs | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| dirs-sys | 0.5.0 | MIT OR Apache-2.0 | https://github.com/dirs-dev/dirs-sys-rs | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| dispatch2 | 0.3.1 | Zlib OR Apache-2.0 OR MIT | https://github.com/madsmtm/objc2 | aarch64-apple-darwin<br>x86_64-apple-darwin |
| displaydoc | 0.2.7 | MIT OR Apache-2.0 | https://github.com/yaahc/displaydoc | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| dom_query | 0.27.0 | MIT | https://github.com/niklak/dom_query | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| dpi | 0.1.2 | Apache-2.0 AND MIT | https://github.com/rust-windowing/winit | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| dtoa | 1.0.11 | MIT OR Apache-2.0 | https://github.com/dtolnay/dtoa | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| dtoa-short | 0.3.5 | MPL-2.0 | https://github.com/upsuper/dtoa-short | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| dtor | 0.3.0 | Apache-2.0 OR MIT | https://github.com/mmastrac/rust-ctor | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| dtor-proc-macro | 0.0.6 | Apache-2.0 OR MIT | https://github.com/mmastrac/rust-ctor | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| dunce | 1.0.5 | CC0-1.0 OR MIT-0 OR Apache-2.0 | https://gitlab.com/kornelski/dunce | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| dyn-clone | 1.0.20 | MIT OR Apache-2.0 | https://github.com/dtolnay/dyn-clone | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| embed-resource | 3.0.11 | MIT | https://github.com/nabijaczleweli/rust-embed-resource | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| embed_plist | 1.2.2 | MIT OR Apache-2.0 | https://github.com/nvzqz/embed-plist-rs | aarch64-apple-darwin<br>x86_64-apple-darwin |
| encoding_rs | 0.8.42 | (Apache-2.0 OR MIT) AND BSD-3-Clause | https://github.com/hsivonen/encoding_rs | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| equivalent | 1.0.2 | Apache-2.0 OR MIT | https://github.com/indexmap-rs/equivalent | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| erased-serde | 0.4.10 | MIT OR Apache-2.0 | https://github.com/dtolnay/erased-serde | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| errno | 0.3.14 | MIT OR Apache-2.0 | https://github.com/lambda-fairy/rust-errno | aarch64-apple-darwin<br>x86_64-apple-darwin |
| fallible-iterator | 0.3.0 | MIT/Apache-2.0 | https://github.com/sfackler/rust-fallible-iterator | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| fallible-streaming-iterator | 0.1.9 | MIT/Apache-2.0 | https://github.com/sfackler/fallible-streaming-iterator | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| fast-float2 | 0.2.4 | MIT OR Apache-2.0 | https://github.com/Alexhuszagh/fast-float-rust | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| fastrand | 2.5.0 | Apache-2.0 OR MIT | https://github.com/smol-rs/fastrand | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| fdeflate | 0.3.7 | MIT OR Apache-2.0 | https://github.com/image-rs/fdeflate | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| find-msvc-tools | 0.1.13 | MIT OR Apache-2.0 | https://github.com/rust-lang/cc-rs | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| flate2 | 1.1.10 | MIT OR Apache-2.0 | https://github.com/rust-lang/flate2-rs | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| fnv | 1.0.7 | Apache-2.0 / MIT | https://github.com/servo/rust-fnv | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| foldhash | 0.2.0 | Zlib | https://github.com/orlp/foldhash | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| foreign-types | 0.5.0 | MIT/Apache-2.0 | https://github.com/sfackler/foreign-types | aarch64-apple-darwin<br>x86_64-apple-darwin |
| foreign-types-macros | 0.2.4 | MIT/Apache-2.0 | https://github.com/sfackler/foreign-types | aarch64-apple-darwin<br>x86_64-apple-darwin |
| foreign-types-shared | 0.3.1 | MIT/Apache-2.0 | https://github.com/sfackler/foreign-types | aarch64-apple-darwin<br>x86_64-apple-darwin |
| form_urlencoded | 1.2.2 | MIT OR Apache-2.0 | https://github.com/servo/rust-url | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| fs2 | 0.4.3 | MIT/Apache-2.0 | https://github.com/danburkert/fs2-rs | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| generic-array | 0.14.7 | MIT | https://github.com/fizyk20/generic-array.git | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| getrandom | 0.3.4 | MIT OR Apache-2.0 | https://github.com/rust-random/getrandom | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| getrandom | 0.4.3 | MIT OR Apache-2.0 | https://github.com/rust-random/getrandom | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| glob | 0.3.4 | MIT OR Apache-2.0 | https://github.com/rust-lang/glob | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| hashbrown | 0.12.3 | MIT OR Apache-2.0 | https://github.com/rust-lang/hashbrown | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| hashbrown | 0.17.1 | MIT OR Apache-2.0 | https://github.com/rust-lang/hashbrown | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| hashlink | 0.12.2 | MIT OR Apache-2.0 | https://github.com/djc/hashlink | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| heck | 0.5.0 | MIT OR Apache-2.0 | https://github.com/withoutboats/heck | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| hex | 0.4.3 | MIT OR Apache-2.0 | https://github.com/KokaKiwi/rust-hex | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| html5ever | 0.38.0 | MIT OR Apache-2.0 | https://github.com/servo/html5ever | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| http | 1.5.0 | MIT OR Apache-2.0 | https://github.com/hyperium/http | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| iana-time-zone | 0.1.65 | MIT OR Apache-2.0 | https://github.com/strawlab/iana-time-zone | aarch64-apple-darwin<br>x86_64-apple-darwin |
| ico | 0.5.0 | MIT | https://github.com/mdsteele/rust-ico | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| icu_collections | 2.3.0 | Unicode-3.0 | https://github.com/unicode-org/icu4x | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| icu_locale_core | 2.3.0 | Unicode-3.0 | https://github.com/unicode-org/icu4x | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| icu_normalizer | 2.3.0 | Unicode-3.0 | https://github.com/unicode-org/icu4x | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| icu_normalizer_data | 2.3.0 | Unicode-3.0 | https://github.com/unicode-org/icu4x | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| icu_properties | 2.3.0 | Unicode-3.0 | https://github.com/unicode-org/icu4x | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| icu_properties_data | 2.3.0 | Unicode-3.0 | https://github.com/unicode-org/icu4x | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| icu_provider | 2.3.1 | Unicode-3.0 | https://github.com/unicode-org/icu4x | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| ident_case | 1.0.1 | MIT/Apache-2.0 | https://github.com/TedDriggs/ident_case | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| idna | 1.1.0 | MIT OR Apache-2.0 | https://github.com/servo/rust-url/ | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| idna_adapter | 1.2.2 | Apache-2.0 OR MIT | https://github.com/hsivonen/idna_adapter | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| image | 0.25.10 | MIT OR Apache-2.0 | https://github.com/image-rs/image | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| image-webp | 0.2.4 | MIT OR Apache-2.0 | https://github.com/image-rs/image-webp | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| indexmap | 1.9.3 | Apache-2.0 OR MIT | https://github.com/bluss/indexmap | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| indexmap | 2.14.2 | Apache-2.0 OR MIT | https://github.com/indexmap-rs/indexmap | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| infer | 0.19.0 | MIT | https://github.com/bojand/infer | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| itoa | 1.0.18 | MIT OR Apache-2.0 | https://github.com/dtolnay/itoa | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| jiff | 0.2.37 | Unlicense OR MIT | https://github.com/BurntSushi/jiff | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| jiff-core | 0.1.1 | Unlicense OR MIT | https://github.com/BurntSushi/jiff | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| jiff-tzdb | 0.1.8 | Unlicense OR MIT | https://github.com/BurntSushi/jiff | x86_64-pc-windows-msvc |
| jiff-tzdb-platform | 0.1.3 | Unlicense OR MIT | https://github.com/BurntSushi/jiff | x86_64-pc-windows-msvc |
| json-patch | 3.0.1 | MIT/Apache-2.0 | https://github.com/idubrov/json-patch | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| jsonptr | 0.6.3 | MIT OR Apache-2.0 | https://github.com/chanced/jsonptr | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| keyboard-types | 0.7.0 | MIT OR Apache-2.0 | https://github.com/pyfisch/keyboard-types | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| libc | 0.2.189 | MIT OR Apache-2.0 | https://github.com/rust-lang/libc | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| libsqlite3-sys | 0.38.2 | MIT | https://github.com/rusqlite/rusqlite | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| litemap | 0.8.3 | Unicode-3.0 | https://github.com/unicode-org/icu4x | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| lock_api | 0.4.14 | MIT OR Apache-2.0 | https://github.com/Amanieu/parking_lot | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| log | 0.4.34 | MIT OR Apache-2.0 | https://github.com/rust-lang/log | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| markup5ever | 0.38.0 | MIT OR Apache-2.0 | https://github.com/servo/html5ever | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| memchr | 2.8.3 | Unlicense OR MIT | https://github.com/BurntSushi/memchr | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| mime | 0.3.17 | MIT OR Apache-2.0 | https://github.com/hyperium/mime | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| miniz_oxide | 0.8.9 | MIT OR Zlib OR Apache-2.0 | https://github.com/Frommi/miniz_oxide/tree/master/miniz_oxide | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| miniz_oxide | 0.9.1 | MIT OR Zlib OR Apache-2.0 | https://github.com/Frommi/miniz_oxide/tree/master/miniz_oxide | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| mio | 1.2.3 | MIT | https://github.com/tokio-rs/mio | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| moxcms | 0.8.1 | BSD-3-Clause OR Apache-2.0 | https://github.com/awxkee/moxcms.git | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| muda | 0.19.3 | Apache-2.0 OR MIT | https://github.com/tauri-apps/muda | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| multiversion_no_op | 1.0.0 | Apache-2.0 OR MIT | https://github.com/hsivonen/multiversion_no_op | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| new_debug_unreachable | 1.0.6 | MIT | https://github.com/mbrubeck/rust-debug-unreachable | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| num-conv | 0.2.2 | MIT OR Apache-2.0 | https://github.com/jhpratt/num-conv | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| num-traits | 0.2.19 | MIT OR Apache-2.0 | https://github.com/rust-num/num-traits | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| objc2 | 0.6.4 | MIT | https://github.com/madsmtm/objc2 | aarch64-apple-darwin<br>x86_64-apple-darwin |
| objc2-app-kit | 0.3.2 | Zlib OR Apache-2.0 OR MIT | https://github.com/madsmtm/objc2 | aarch64-apple-darwin<br>x86_64-apple-darwin |
| objc2-core-foundation | 0.3.2 | Zlib OR Apache-2.0 OR MIT | https://github.com/madsmtm/objc2 | aarch64-apple-darwin<br>x86_64-apple-darwin |
| objc2-core-graphics | 0.3.2 | Zlib OR Apache-2.0 OR MIT | https://github.com/madsmtm/objc2 | aarch64-apple-darwin<br>x86_64-apple-darwin |
| objc2-encode | 4.1.0 | MIT | https://github.com/madsmtm/objc2 | aarch64-apple-darwin<br>x86_64-apple-darwin |
| objc2-exception-helper | 0.1.1 | Zlib OR Apache-2.0 OR MIT | https://github.com/madsmtm/objc2 | aarch64-apple-darwin<br>x86_64-apple-darwin |
| objc2-foundation | 0.3.2 | MIT | https://github.com/madsmtm/objc2 | aarch64-apple-darwin<br>x86_64-apple-darwin |
| objc2-io-surface | 0.3.2 | Zlib OR Apache-2.0 OR MIT | https://github.com/madsmtm/objc2 | aarch64-apple-darwin<br>x86_64-apple-darwin |
| objc2-web-kit | 0.3.2 | Zlib OR Apache-2.0 OR MIT | https://github.com/madsmtm/objc2 | aarch64-apple-darwin<br>x86_64-apple-darwin |
| once_cell | 1.21.4 | MIT OR Apache-2.0 | https://github.com/matklad/once_cell | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| option-ext | 0.2.0 | MPL-2.0 | https://github.com/soc/option-ext.git | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| parking_lot | 0.12.5 | MIT OR Apache-2.0 | https://github.com/Amanieu/parking_lot | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| parking_lot_core | 0.9.12 | MIT OR Apache-2.0 | https://github.com/Amanieu/parking_lot | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| percent-encoding | 2.3.2 | MIT OR Apache-2.0 | https://github.com/servo/rust-url/ | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| phf | 0.13.1 | MIT | https://github.com/rust-phf/rust-phf | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| phf_codegen | 0.13.1 | MIT | https://github.com/rust-phf/rust-phf | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| phf_generator | 0.13.1 | MIT | https://github.com/rust-phf/rust-phf | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| phf_macros | 0.13.1 | MIT | https://github.com/rust-phf/rust-phf | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| phf_shared | 0.13.1 | MIT | https://github.com/rust-phf/rust-phf | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| pin-project-lite | 0.2.17 | Apache-2.0 OR MIT | https://github.com/taiki-e/pin-project-lite | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| pkg-config | 0.3.34 | MIT OR Apache-2.0 | https://github.com/rust-lang/pkg-config-rs | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| plist | 1.10.1 | MIT | https://github.com/ebarnard/rust-plist/ | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| png | 0.17.16 | MIT OR Apache-2.0 | https://github.com/image-rs/image-png | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| png | 0.18.1 | MIT OR Apache-2.0 | https://github.com/image-rs/image-png | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| potential_utf | 0.1.6 | Unicode-3.0 | https://github.com/unicode-org/icu4x | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| powerfmt | 0.2.0 | MIT OR Apache-2.0 | https://github.com/jhpratt/powerfmt | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| precomputed-hash | 0.1.1 | MIT | https://github.com/emilio/precomputed-hash | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| proc-macro2 | 1.0.107 | MIT OR Apache-2.0 | https://github.com/dtolnay/proc-macro2 | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| pxfm | 0.1.30 | BSD-3-Clause OR Apache-2.0 | https://github.com/awxkee/pxfm | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| quick-error | 2.0.1 | MIT/Apache-2.0 | http://github.com/tailhook/quick-error | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| quick-xml | 0.41.0 | MIT | https://github.com/tafia/quick-xml | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| quick-xml | 0.42.0 | MIT | https://github.com/tafia/quick-xml | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| quote | 1.0.47 | MIT OR Apache-2.0 | https://github.com/dtolnay/quote | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| raw-window-handle | 0.6.2 | MIT OR Apache-2.0 OR Zlib | https://github.com/rust-windowing/raw-window-handle | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| ref-cast | 1.0.27 | MIT OR Apache-2.0 | https://github.com/dtolnay/ref-cast | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| ref-cast-impl | 1.0.27 | MIT OR Apache-2.0 | https://github.com/dtolnay/ref-cast | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| regex | 1.13.1 | MIT OR Apache-2.0 | https://github.com/rust-lang/regex | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| regex-automata | 0.4.18 | MIT OR Apache-2.0 | https://github.com/rust-lang/regex | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| regex-syntax | 0.8.11 | MIT OR Apache-2.0 | https://github.com/rust-lang/regex | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| rfd | 0.17.2 | MIT | https://github.com/PolyMeilex/rfd | x86_64-pc-windows-msvc |
| rusqlite | 0.40.2 | MIT | https://github.com/rusqlite/rusqlite | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| rust_xlsxwriter | 0.99.1 | MIT OR Apache-2.0 | https://github.com/jmcnamara/rust_xlsxwriter | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| rustc-hash | 2.1.3 | Apache-2.0 OR MIT | https://github.com/rust-lang/rustc-hash | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| rustc_version | 0.4.1 | MIT OR Apache-2.0 | https://github.com/djc/rustc-version-rs | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| rustix | 1.1.5 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | https://github.com/bytecodealliance/rustix | aarch64-apple-darwin<br>x86_64-apple-darwin |
| rustversion | 1.0.23 | MIT OR Apache-2.0 | https://github.com/dtolnay/rustversion | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| same-file | 1.0.6 | Unlicense/MIT | https://github.com/BurntSushi/same-file | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| schemars | 0.8.22 | MIT | https://github.com/GREsau/schemars | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| schemars | 0.9.0 | MIT | https://github.com/GREsau/schemars | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| schemars | 1.2.2 | MIT | https://github.com/GREsau/schemars | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| schemars_derive | 0.8.22 | MIT | https://github.com/GREsau/schemars | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| scopeguard | 1.2.0 | MIT OR Apache-2.0 | https://github.com/bluss/scopeguard | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| selectors | 0.36.1 | MPL-2.0 | https://github.com/servo/stylo | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| semver | 1.0.28 | MIT OR Apache-2.0 | https://github.com/dtolnay/semver | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| serde | 1.0.229 | MIT OR Apache-2.0 | https://github.com/serde-rs/serde | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| serde-untagged | 0.1.9 | MIT OR Apache-2.0 | https://github.com/dtolnay/serde-untagged | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| serde_core | 1.0.229 | MIT OR Apache-2.0 | https://github.com/serde-rs/serde | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| serde_derive | 1.0.229 | MIT OR Apache-2.0 | https://github.com/serde-rs/serde | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| serde_derive_internals | 0.29.1 | MIT OR Apache-2.0 | https://github.com/serde-rs/serde | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| serde_json | 1.0.151 | MIT OR Apache-2.0 | https://github.com/serde-rs/json | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| serde_repr | 0.1.21 | MIT OR Apache-2.0 | https://github.com/dtolnay/serde-repr | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| serde_spanned | 1.1.1 | MIT OR Apache-2.0 | https://github.com/toml-rs/toml | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| serde_with | 3.23.0 | MIT OR Apache-2.0 | https://github.com/jonasbb/serde_with/ | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| serde_with_macros | 3.23.0 | MIT OR Apache-2.0 | https://github.com/jonasbb/serde_with/ | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| serialize-to-javascript | 0.1.2 | MIT OR Apache-2.0 | https://github.com/chippers/serialize-to-javascript | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| serialize-to-javascript-impl | 0.1.2 | MIT OR Apache-2.0 | https://github.com/chippers/serialize-to-javascript | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| servo_arc | 0.4.3 | MIT OR Apache-2.0 | https://github.com/servo/stylo | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| sha2 | 0.10.9 | MIT OR Apache-2.0 | https://github.com/RustCrypto/hashes | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| shlex | 2.0.1 | MIT OR Apache-2.0 | https://github.com/comex/rust-shlex | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| simd-adler32 | 0.3.10 | MIT | https://github.com/mcountryman/simd-adler32 | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| simdutf8 | 0.1.5 | MIT OR Apache-2.0 | https://github.com/rusticstuff/simdutf8 | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| siphasher | 1.0.3 | MIT/Apache-2.0 | https://github.com/jedisct1/rust-siphash | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| smallvec | 1.16.1 | MIT OR Apache-2.0 | https://github.com/servo/rust-smallvec | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| socket2 | 0.6.5 | MIT OR Apache-2.0 | https://github.com/rust-lang/socket2 | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| softbuffer | 0.4.8 | MIT OR Apache-2.0 | https://github.com/rust-windowing/softbuffer | x86_64-pc-windows-msvc |
| stable_deref_trait | 1.2.1 | MIT OR Apache-2.0 | https://github.com/storyyeller/stable_deref_trait | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| string_cache | 0.9.0 | MIT OR Apache-2.0 | https://github.com/servo/string-cache | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| string_cache_codegen | 0.6.1 | MIT OR Apache-2.0 | https://github.com/servo/string-cache | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| strsim | 0.11.1 | MIT | https://github.com/rapidfuzz/strsim-rs | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| swift-rs | 1.0.8 | MIT OR Apache-2.0 | https://github.com/Brendonovich/swift-rs | aarch64-apple-darwin<br>x86_64-apple-darwin |
| syn | 2.0.119 | MIT OR Apache-2.0 | https://github.com/dtolnay/syn | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| syn | 3.0.6 | MIT OR Apache-2.0 | https://github.com/dtolnay/syn | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| synstructure | 0.14.0 | MIT | https://github.com/mystor/synstructure | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| tao | 0.35.3 | Apache-2.0 | https://github.com/tauri-apps/tao | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| tauri | 2.11.6 | Apache-2.0 OR MIT | https://github.com/tauri-apps/tauri | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| tauri-build | 2.6.3 | Apache-2.0 OR MIT | https://github.com/tauri-apps/tauri | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| tauri-codegen | 2.6.3 | Apache-2.0 OR MIT | https://github.com/tauri-apps/tauri | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| tauri-macros | 2.6.3 | Apache-2.0 OR MIT | https://github.com/tauri-apps/tauri | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| tauri-plugin-single-instance | 2.4.5 | Apache-2.0 OR MIT | https://github.com/tauri-apps/plugins-workspace | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| tauri-runtime | 2.11.3 | Apache-2.0 OR MIT | https://github.com/tauri-apps/tauri | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| tauri-runtime-wry | 2.11.4 | Apache-2.0 OR MIT | https://github.com/tauri-apps/tauri | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| tauri-utils | 2.9.3 | Apache-2.0 OR MIT | https://github.com/tauri-apps/tauri | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| tauri-winres | 0.3.6 | MIT | https://github.com/tauri-apps/winres | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| tempfile | 3.27.0 | MIT OR Apache-2.0 | https://github.com/Stebalien/tempfile | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| tendril | 0.5.1 | MIT OR Apache-2.0 | https://github.com/servo/html5ever | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| thiserror | 1.0.69 | MIT OR Apache-2.0 | https://github.com/dtolnay/thiserror | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| thiserror | 2.0.21 | MIT OR Apache-2.0 | https://github.com/dtolnay/thiserror | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| thiserror-impl | 1.0.69 | MIT OR Apache-2.0 | https://github.com/dtolnay/thiserror | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| thiserror-impl | 2.0.21 | MIT OR Apache-2.0 | https://github.com/dtolnay/thiserror | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| time | 0.3.55 | MIT OR Apache-2.0 | https://github.com/time-rs/time | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| time-core | 0.1.9 | MIT OR Apache-2.0 | https://github.com/time-rs/time | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| time-macros | 0.2.32 | MIT OR Apache-2.0 | https://github.com/time-rs/time | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| tinystr | 0.8.4 | Unicode-3.0 | https://github.com/unicode-org/icu4x | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| tinyvec | 1.13.3 | Zlib OR Apache-2.0 OR MIT | https://github.com/Lokathor/tinyvec | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| tokio | 1.53.1 | MIT | https://github.com/tokio-rs/tokio | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| toml | 0.9.12+spec-1.1.0 | MIT OR Apache-2.0 | https://github.com/toml-rs/toml | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| toml | 1.1.6+spec-1.1.0 | MIT OR Apache-2.0 | https://github.com/toml-rs/toml | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| toml_datetime | 0.7.5+spec-1.1.0 | MIT OR Apache-2.0 | https://github.com/toml-rs/toml | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| toml_datetime | 1.1.1+spec-1.1.0 | MIT OR Apache-2.0 | https://github.com/toml-rs/toml | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| toml_parser | 1.1.3+spec-1.1.0 | MIT OR Apache-2.0 | https://github.com/toml-rs/toml | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| toml_writer | 1.1.2+spec-1.1.0 | MIT OR Apache-2.0 | https://github.com/toml-rs/toml | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| tracing | 0.1.44 | MIT | https://github.com/tokio-rs/tracing | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| tracing-attributes | 0.1.31 | MIT | https://github.com/tokio-rs/tracing | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| tracing-core | 0.1.36 | MIT | https://github.com/tokio-rs/tracing | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| tray-icon | 0.24.2 | MIT OR Apache-2.0 | https://github.com/tauri-apps/tray-icon | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| typed-path | 0.12.3 | MIT OR Apache-2.0 | https://github.com/chipsenkbeil/typed-path | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| typeid | 1.0.3 | MIT OR Apache-2.0 | https://github.com/dtolnay/typeid | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| typenum | 1.20.1 | MIT OR Apache-2.0 | https://github.com/paholg/typenum | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| unic-char-property | 0.9.0 | MIT/Apache-2.0 | https://github.com/open-i18n/rust-unic/ | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| unic-char-range | 0.9.0 | MIT/Apache-2.0 | https://github.com/open-i18n/rust-unic/ | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| unic-common | 0.9.0 | MIT/Apache-2.0 | https://github.com/open-i18n/rust-unic/ | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| unic-ucd-ident | 0.9.0 | MIT/Apache-2.0 | https://github.com/open-i18n/rust-unic/ | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| unic-ucd-version | 0.9.0 | MIT/Apache-2.0 | https://github.com/open-i18n/rust-unic/ | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| unicode-ident | 1.0.26 | (MIT OR Apache-2.0) AND Unicode-3.0 | https://github.com/dtolnay/unicode-ident | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| unicode-normalization | 0.1.25 | MIT OR Apache-2.0 | https://github.com/unicode-rs/unicode-normalization | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| unicode-segmentation | 1.13.3 | MIT OR Apache-2.0 | https://github.com/unicode-rs/unicode-segmentation | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| url | 2.5.8 | MIT OR Apache-2.0 | https://github.com/servo/rust-url | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| urlpattern | 0.3.0 | MIT | https://github.com/denoland/rust-urlpattern | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| utf8_iter | 1.0.4 | Apache-2.0 OR MIT | https://github.com/hsivonen/utf8_iter | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| uuid | 1.26.1 | Apache-2.0 OR MIT | https://github.com/uuid-rs/uuid | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| vcpkg | 0.2.15 | MIT/Apache-2.0 | https://github.com/mcgoo/vcpkg-rs | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| version_check | 0.9.5 | MIT/Apache-2.0 | https://github.com/SergioBenitez/version_check | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| vswhom | 0.1.0 | MIT | https://github.com/nabijaczleweli/vswhom.rs | x86_64-pc-windows-msvc |
| vswhom-sys | 0.1.3 | MIT | https://github.com/nabijaczleweli/vswhom-sys.rs | x86_64-pc-windows-msvc |
| walkdir | 2.5.0 | Unlicense/MIT | https://github.com/BurntSushi/walkdir | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| web_atoms | 0.2.6 | MIT OR Apache-2.0 | https://github.com/servo/html5ever | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| webview2-com | 0.38.2 | MIT | https://github.com/wravery/webview2-rs | x86_64-pc-windows-msvc |
| webview2-com-macros | 0.8.1 | MIT | https://github.com/wravery/webview2-rs | x86_64-pc-windows-msvc |
| webview2-com-sys | 0.38.2 | MIT | https://github.com/wravery/webview2-rs | x86_64-pc-windows-msvc |
| winapi | 0.3.9 | MIT/Apache-2.0 | https://github.com/retep998/winapi-rs | x86_64-pc-windows-msvc |
| winapi-util | 0.1.11 | Unlicense OR MIT | https://github.com/BurntSushi/winapi-util | x86_64-pc-windows-msvc |
| window-vibrancy | 0.6.0 | Apache-2.0 OR MIT | https://github.com/tauri-apps/tauri-plugin-vibrancy | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| windows | 0.61.3 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs | x86_64-pc-windows-msvc |
| windows-collections | 0.2.0 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs | x86_64-pc-windows-msvc |
| windows-core | 0.61.2 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs | x86_64-pc-windows-msvc |
| windows-future | 0.2.1 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs | x86_64-pc-windows-msvc |
| windows-implement | 0.60.2 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs | x86_64-pc-windows-msvc |
| windows-interface | 0.59.3 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs | x86_64-pc-windows-msvc |
| windows-link | 0.1.3 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs | x86_64-pc-windows-msvc |
| windows-link | 0.2.1 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs | x86_64-pc-windows-msvc |
| windows-numerics | 0.2.0 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs | x86_64-pc-windows-msvc |
| windows-result | 0.3.4 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs | x86_64-pc-windows-msvc |
| windows-strings | 0.4.2 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs | x86_64-pc-windows-msvc |
| windows-sys | 0.59.0 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs | x86_64-pc-windows-msvc |
| windows-sys | 0.60.2 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs | x86_64-pc-windows-msvc |
| windows-sys | 0.61.2 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs | x86_64-pc-windows-msvc |
| windows-targets | 0.52.6 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs | x86_64-pc-windows-msvc |
| windows-targets | 0.53.5 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs | x86_64-pc-windows-msvc |
| windows-threading | 0.1.0 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs | x86_64-pc-windows-msvc |
| windows-version | 0.1.7 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs | x86_64-pc-windows-msvc |
| windows_x86_64_msvc | 0.52.6 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs | x86_64-pc-windows-msvc |
| windows_x86_64_msvc | 0.53.1 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs | x86_64-pc-windows-msvc |
| winnow | 0.7.15 | MIT | https://github.com/winnow-rs/winnow | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| winnow | 1.0.4 | MIT | https://github.com/winnow-rs/winnow | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| winreg | 0.55.0 | MIT | https://github.com/gentoo90/winreg-rs | x86_64-pc-windows-msvc |
| writeable | 0.6.4 | Unicode-3.0 | https://github.com/unicode-org/icu4x | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| wry | 0.55.1 | Apache-2.0 OR MIT | https://github.com/tauri-apps/wry | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| yoke | 0.8.3 | Unicode-3.0 | https://github.com/unicode-org/icu4x | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| yoke-derive | 0.8.3 | Unicode-3.0 | https://github.com/unicode-org/icu4x | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| zerofrom | 0.1.8 | Unicode-3.0 | https://github.com/unicode-org/icu4x | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| zerofrom-derive | 0.1.8 | Unicode-3.0 | https://github.com/unicode-org/icu4x | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| zerotrie | 0.2.5 | Unicode-3.0 | https://github.com/unicode-org/icu4x | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| zerovec | 0.11.8 | Unicode-3.0 | https://github.com/unicode-org/icu4x | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| zerovec-derive | 0.11.6 | Unicode-3.0 | https://github.com/unicode-org/icu4x | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| zip | 8.6.0 | MIT | https://github.com/zip-rs/zip2 | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| zlib-rs | 0.6.8 | Zlib | https://github.com/trifectatechfoundation/zlib-rs | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| zmij | 1.0.23 | MIT | https://github.com/dtolnay/zmij | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| zopfli | 0.8.3 | Apache-2.0 | https://github.com/zopfli-rs/zopfli | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| zune-core | 0.5.3 | MIT OR Apache-2.0 OR Zlib | https://github.com/etemesi254/zune-image | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |
| zune-jpeg | 0.5.15 | MIT OR Apache-2.0 OR Zlib | https://github.com/etemesi254/zune-image/tree/dev/crates/zune-jpeg | aarch64-apple-darwin<br>x86_64-apple-darwin<br>x86_64-pc-windows-msvc |

## 前端生产依赖（4 个）

许可证分布：MIT（3）、Apache-2.0 OR MIT（1）

| 名称 | 版本 | 许可证 | 来源 |
|---|---|---|---|
| @tauri-apps/api | 2.11.1 | Apache-2.0 OR MIT | https://github.com/tauri-apps/tauri |
| react-dom | 19.3.0 | MIT | https://github.com/react/react |
| react | 19.3.0 | MIT | https://github.com/react/react |
| scheduler | 0.28.0 | MIT | https://github.com/react/react |
