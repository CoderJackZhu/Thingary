# 开发与测试

本文面向贡献者。使用软件请从[使用指南](USER_GUIDE.md#download)开始；行为口径见[业务规则](PRODUCT_RULES.md)，提交与文档职责见[贡献指南](../CONTRIBUTING.md)和[文档维护](MAINTAINING.md)。本页维护当前验证入口和边界，逐轮执行日志另行归档。

## 准备环境

Mac 需要 Xcode 命令行工具、Node.js 22.18 或更新（测试直接加载 `.ts`，更早的 22.x 会报 `ERR_UNKNOWN_FILE_EXTENSION`）与 npm、Rust stable。Windows 需要 Node.js 22.18 或更新、Rust stable 的 MSVC 工具链与 `x86_64-pc-windows-msvc` 目标、Visual Studio Build Tools 的“使用 C++ 的桌面开发”工作负载（MSVC 编译器与 Windows SDK），以及 Microsoft Edge WebView2 Runtime。Windows 原生验收脚本另外需要 PowerShell 7（`pwsh`）。使用仓库锁文件，不随意升级依赖。

CI 在 `macos-latest` 与 `windows-latest` 运行同样的四项自动检查，Windows 使用 Git Bash 作为 npm 脚本 shell，保证通配符行为一致。macOS 构建链接原生框架，Windows 使用原生文件对话框、Rust 图片预览与 WinRT 通知；两平台共用业务与资料格式。前端构建不能代替完整应用构建或原生验收。当前源码包含 Windows 接入，目标 Windows 10 1809+／11 x64，运行与发布边界见[Windows 验收清单](WINDOWS_ACCEPTANCE.md)。

```sh
rustup target add wasm32-unknown-unknown
npm ci
npm run tauri -- dev
```

开发应用标题为「物谱 · 开发预览」，身份 `local.thingary.preview`。开发、测试和验收一律使用虚构资料、临时目录或独立身份，**不得打开或写入正式资料库 `local.thingary.main`**。样例库不是自己的资料，正式安装包也不是测试环境。

## iOS 开发

使用完整 Xcode（含 iOS SDK）、CocoaPods、XcodeGen、Node 和 Rust。`xcode-select -p` 应指向 Xcode.app 的 Developer 目录。用 `xcrun simctl list runtimes` 检查运行时已经安装且 available，再用 `xcrun simctl list devices available` 确认目标机型；SDK 和模拟器运行时是不同组件。安装 `aarch64-apple-ios`（真机）、`aarch64-apple-ios-sim`（Apple Silicon 模拟器），Intel Mac 按需安装 `x86_64-apple-ios`。运行时并非必须与 SDK 的小版本相同；若 CLI 因二者版本不同转入 Xcode，保持 CLI 进程运行，在生成工程中选择已安装运行时的设备后运行。也可在另一终端用 xcodebuild 指定 simulator destination 和 CODE_SIGNING_ALLOWED=NO 构建，再用 simctl install / launch 启动预览身份。

另外安装 rustup 的 `llvm-tools` 组件（`rustup component add llvm-tools`）。Xcode 27 的 SwiftPM 在 Release 配置下会把 Tauri Swift 包（`Tauri.swift`、`Logger.swift`）的 `@_cdecl` 导出符号编译成静态库内的局部符号（`nm` 显示小写 `t`），`swift-rs` 依靠该组件里的 `llvm-objcopy` 把它们恢复为全局符号；缺少时 Debug 仍能链接，Release 会在 Rust 静态库链接阶段报 `_log_stdout`、`_on_webview_created`、`_run_plugin_command` 未定义。这是本机工具链前提，不需要改 Rust 依赖或链接选项。

```sh
rustup component add llvm-tools
npm ci
npm run ios:check
npm run ios:dev -- "<可用的标准 iPhone 名称>" --no-watch
```

工程已通过官方 `npm run tauri ios init` 生成；需要重建时用 `npm run ios:init`，并检查生成差异，保留下面的框架、plist 和构建脚本配置。提交 `src-tauri/gen/apple` 中的工程、共享 scheme、源文件、图标、plist、Podfile 和 project.yml；不提交 Externals、assets、build、Pods 或 xcuserdata。根目录忽略规则保持不变，首次加入生成源文件需逐项 `git add -f`。修改 project.yml 后在其目录运行 `xcodegen generate`，权限用途与 UIScene 配置同时保存在 project.yml 和 Info.ios.plist，保证 XcodeGen 重建不丢失。不得加入个人开发团队或发行签名。隐私清单 `thingary_iOS/PrivacyInfo.xcprivacy` 随工程提交（`project.yml` 的 `thingary_iOS` 目录源自动作为资源），新增需说明理由的 API 时同步更新，核对办法见[发布流程的 iOS 小节](RELEASING.md#ios)。

Xcode 27 要求 UIScene；Info.ios.plist 使用 Tao 自带的 TaoSceneDelegate，并提供非空的场景配置。Tauri 需为 2.12 及以上（Tao 0.36+）：Tao 0.35.3 在 `application:configurationForConnectingSceneSession:options:` 中提前释放返回的 UISceneConfiguration，真机 Release 启动即在 `-[UIApplication _connectUISceneFromFBSScene:…]` 的 `objc_retain` 段错误。桌面与 iOS 统一使用官方 CLI 2.12.3（2.11.5 会把 Xcode 27 devicectl 返回的模拟器当作真机）；`ios:tauri` 脚本固定同一版本，首次执行需联网取得 npm 缓存。生成工程的预构建脚本也必须调用 `npm run -- ios:tauri ios xcode-script …`，与父进程使用同一 CLI，避免通信端口不一致。`ios:dev` 使用本机回环地址；真机开发改用 `npm run ios:tauri -- ios dev --host <Mac局域网IP>`，由维护者配置开发证书。交叉编译通过不代表真机安装通过。需要完整编译真机 Rust 静态库时，运行 `cargo build --manifest-path src-tauri/Cargo.toml --lib --target aarch64-apple-ios`，不涉及设备安装或签名。

iOS 入口为独立界面任务提供的 mobile.html。资料库使用 `app_local_data_dir()/library`，开发身份仍为 `local.thingary.preview`；绝不打开 `local.thingary.main`。桌面菜单、窗口尺寸和单实例插件仅在桌面启用。SQLite、规划核心、金额整数分、日期、request_id、generation 和回执机制均与桌面共用。

### 真机自测（免费 Apple ID）

用于维护者把开发预览版（`local.thingary.preview`，与正式版 `local.thingary.main` 是两个 App，资料互不影响）装到自己的 iPhone 上试用。Team ID、设备 ID 只放在本机环境变量或个人笔记里，不写进仓库。

一次性准备：
1. Xcode › Settings › Accounts 登录 Apple ID，得到 Personal Team。用 `defaults read com.apple.dt.Xcode IDEProvisioningTeamByIdentifier` 找 `isFreeProvisioningTeam = 1` 的那项，记下 `teamID`。
2. iPhone 连 Mac 并信任；在 设置 › 隐私与安全性 › 开发者模式 打开并重启。
3. `rustup target add aarch64-apple-ios`，`rustup component add llvm-tools`（swift-rs 需要 llvm-objcopy，缺了 Release 链接会报 Tauri 的 `@_cdecl` 符号找不到）。
4. 第一次必须在 Xcode 里装一次，让免费账号登记这台设备：`npm run ios:tauri -- ios run --release --open`，在 thingary_iOS › Signing & Capabilities 选 Personal Team，有 Register Device 就点，选中 iPhone 后运行。完成后 `git checkout src-tauri/gen/apple` 撤销工程改动。
5. 建议用单独的工作目录装手机版：`git worktree add ../Thingary-phone origin/main`，然后在其中运行 `npm ci`。

每次更新（在 `Thingary-phone` 目录）：

```sh
git fetch origin && git checkout --detach origin/main && npm ci
xcrun devicectl list devices                       # 查 iPhone 名称和设备 ID
APPLE_DEVELOPMENT_TEAM=<teamID> npm run ios:tauri -- ios run --release "<iPhone 名称>"
```

Tauri CLI 2.12.3 最后的 Exporting app 一步会报 `Couldn't load -exportOptionsPlist`（EXPORT FAILED）。只要前面出现 `** BUILD SUCCEEDED **`，签好名的 App 已经生成，直接安装并启动：

```sh
APP=$(ls -d ~/Library/Developer/Xcode/DerivedData/thingary-*/Build/Products/release-iphoneos/"Thingary Preview.app" | head -1)
xcrun devicectl device install app --device <设备 ID> "$APP"
xcrun devicectl device process launch --device <设备 ID> local.thingary.preview
```

- 第一次打开若提示「不受信任的开发者」：设置 › 通用 › VPN与设备管理 › 信任。
- 免费签名 7 天过期，过期后重新执行「每次更新」即可；覆盖安装保留资料，删除 App 会连资料一起删掉。
- 免费账号最多同时装 3 个自签 App，7 天内最多注册 10 个应用标识。
- 常见报错：`Your team has no devices` 或 `No profiles for 'local.thingary.preview'` 说明还没做第 4 步；真机一启动就闪退，先确认 Tauri 为 2.12 以上（见上文 UIScene 说明）。

### 前端调用约定

| 能力 | 调用与返回 |
| --- | --- |
| 平台能力 | `invoke('platform_capabilities')`：`platform`、`updates_supported`、`native_file_sharing`、`background_privacy_cover`、`auth_name`（面容／触控 ID 或通用身份验证）。手机界面不提供更新设置和入口。 |
| 统一分享 | `invoke('ios_share_file', {name})`：仅接受 Documents 中已存在的备份、xlsx、PDF 或 txt 文件名，完成为 true，取消为 false，系统错误则拒绝；不能传任意路径。 |
| 完整备份／表格 | 继续调用 `create_backup`／`export_workbook`，发布到 Documents 后自动打开系统分享面板。iOS 结果额外包含 `share: {completed,error}`；分享取消或失败不等于导出文件未写入。可用返回的文件名调用统一分享重试。 |
| 规划报告 PDF | `src/mobile/plan/Report.tsx` 将现有隐私模式下的 HTML 快照交给 `src/mobile/me/files.ts` 的 shareReport；iOS 调用 `ios_export_pdf`（name、html），由无脚本、无网络、非持久 WKWebView 和 A4 打印器生成 PDF，再走同一分享面板。HTML 限 4 MiB、PDF 限 32 MiB／200 页，返回 `{name,share}`。桌面继续下载 HTML。 |
| 恢复备份 | 沿用 `inspect_backup` → 必要时解密 → 确认 → `restore_backup_session` 及回执核对流程。原生“文件”选择器接受 .thingary、.thingary.age，可浏览 App Documents 和其他文件提供者；选中后复制到私有临时目录再检查。 |
| 拍照／多选照片 | WKWebView 使用 `<input type="file" accept="image/*" capture="environment">` 拍照，另设不带 capture 的 multiple 输入选择相册；读取 File 字节，沿用 `import_photo_bytes`、`photo_preview` 和物品保存回执。Info.plist 包含中文相机、照片用途说明；原图保持不变，预览由 ImageIO 生成。 |
| 恢复密钥文件 | files.ts 的 downloadText 在 iOS 调用 ios_share_text，分享期间使用私有临时文件，完成、取消和失败均清除；界面等待完成才标记已保存，不保留在 Documents 或备份中。 |
| 心愿照片 | 保留现有 pick_photo 命令；iOS 使用 PHPicker 系统相册单选，仅取得用户选择的照片，原始文件进入已有 staging／generation 流程。 |
| 身份验证 | 沿用 privacy_lock 命令和状态，LocalAuthentication 使用设备机主验证策略，支持系统密码回退，名称由系统生物识别类型决定，SE 不用机型／屏宽猜测面容 ID；生物识别信息不会进入 App。 |
| 提醒 | 沿用 `notification_permission` 和 notification-permission.ts 流程，iOS 文案判断只在 notification-permission.ts 内。UNUserNotificationCenter 复用盘点、保修、周期付款等现有计划和稳定 ID，在本地日期 09:00 提醒；系统队列按临近时间保留，超限明确报错。 |

Documents 已开启 UIFileSharingEnabled 和 LSSupportsOpeningDocumentsInPlace，用户可在“文件”App 查看或放入备份；自动备份位于 Documents/Backups。系统分享面板提供“存储到文件”等目标，iCloud Drive 和隔空投送的实际可用性取决于设备配置。导出保留原有备份格式，桌面和手机互相导入；加密恢复继续使用原有密钥和会话机制。

手机 privacy-runtime 将后台遮挡／锁定偏好交给原生层；启用任一保护时，场景失活即添加不透明模糊遮罩保护 App 切换器。原生场景事件同时通知前端状态机，回到前台后先更新 DOM 锁屏，再撤去原生遮罩。iOS 的手动检查、自动发现、更新同意写入和更新下载链接在后端均禁用，拒绝发生于网络请求之前；前端平台判断统一位于 update-check.ts，update-discovery.ts 调用这一判断。手机「关于」不显示更新入口，桌面行为保持不变。

### 平台边界与验收

当前已在标准 iPhone 17（iOS 27.0 模拟器，402×874 点）完成独立手机入口、虚构物品、未知价格／日期、账户和完整盘点、原生规划结果、两页隐私 PDF 与分享面板、系统文件选择及备份检查恢复。桌面生成的明文备份在手机恢复，再由手机导出、桌面临时库恢复，全部 SQLite 用户表（含回执）及托管原图 SHA-256 一致。系统“保存到文件”完成回调、物品双照片导入、心愿 PHPicker 单选与 ImageIO 预览、通知授权和 App 切换器原生遮罩已验。另在 iPhone SE 第三代（375×667）和 iPhone 14 Pro Max（430×932）检查五个主要页面、安全区和底部标签栏，验证键盘焦点输入框位于键盘上方，并分别打开原生 PDF 分享面板。该轮曾记录窄屏长表单的顶部保存按钮随键盘平移离开视口，现已由手机共用视口层修正，补验范围见下段。代表截图见 PR #17 的描述。恢复密钥分享取消后不会误标为已保存，临时密钥目录已清除。加密备份自动测试通过，iOS 加密密钥界面往返、真机拍照／Face ID／通知实际送达、iCloud Drive 和隔空投送仍需对应环境验证。

2026-10-22 键盘补验：iOS 27.0 的 iPhone SE 第三代（375×667）、标准 iPhone 17（402×874）与 iPhone 18 Pro Max（440×956）各完成 8 项真实 WKWebView／XCUITest 检查，覆盖新增物品、新增账户、完整盘点、心愿编辑、记一笔支出、规划设置条件，以及日期输入不自动缩放、键盘打开时实际保存虚构物品并恢复标签栏。导航固定在可见顶部，按钮避开状态栏，焦点框保持在导航与键盘／底部操作条之间；原始同尺寸截图随修复 PR 提供，不加入源码目录。四项仓库检查均通过。浏览器功能回归使用本仓库的 mobile-preview.html 虚构 IPC 入口；直接打开 mobile.html 仍需要 Tauri 桥接。真机、第三方输入法、硬件键盘、VoiceOver、横屏与 iPad／浮动键盘未验证。

iOS 不提供桌面应用菜单、窗口尺寸恢复、单实例进程控制，也不支持额外自动备份目录；需要外部副本时使用系统分享。`auto_backup_open_folder` 返回提示，用户到“文件”App 的 Documents/Backups 查看。设备未设置密码／生物识别时身份验证不可用；用户拒绝通知后仍保存提醒数据，但通知不能送达。文件操作取消与系统错误分别返回，导出已完成但分享未完成时文件仍留在 Documents。

可复用 `src-tauri/examples/ios_portability.rs` 的 seed／restore 模式生成虚构备份及全表／原图的规范化比较结果；它要求 --isolated-fictional、全新的绝对目录和显式输入输出路径，拒绝打开已有资料库。

开发验收必须使用虚构资料。分别记录实际机型、运行时、账户／未知和正常盘点／规划计算、照片与缩略图、备份桌面往返、分享完成与取消、通知权限、前后台遮罩。标准 iPhone 为主，另验 SE 和 Pro Max；模拟器截图不代表真机拍照、Face ID、隔空投送或 iCloud 已验。原生功能需在真实 Tauri WKWebView 中验证，浏览器演示不能替代。交付前同时运行本页四项检查和 macOS 开发预览，不能把编译成功写成全部原生验收成功。

<a id="android"></a>

## Android 开发与模拟器

> 应用 ID 与应用名默认是预览身份（`local.thingary.preview`／Thingary Preview）；正式构建用环境变量 `THINGARY_ANDROID_APPLICATION_ID` 与 `THINGARY_ANDROID_APP_LABEL` 切换，细节见[发布流程](RELEASING.md)的 Android 一节。Kotlin 插件类固定在 `local.thingary.preview` 包下，Rust 用 `crate::android::PLUGIN_PACKAGE` 注册。

Android 与 iOS 共用 `mobile.html` 和 Rust 业务层。工程在 `src-tauri/gen/android/`，平台配置为 `src-tauri/tauri.android.conf.json`，开发应用标识 `local.thingary.preview`。当前 Gradle 配置的 `compileSdk`／`targetSdk` 为 37、`minSdk` 为 29；这是编译／目标／最低系统要求，不代表所有对应系统都已验收。Android 原生能力边界见[架构说明](ARCHITECTURE.md#android-平台层)。

### 工具与构建

准备 Node.js 22.18+、Rust、Android Studio 或 SDK Command-line Tools，以及 **JDK 17**、**NDK 27.2.12479018**。安装 `platform-tools`、构建工具，以及 Gradle 要求的 `platforms;android-N`；缺少的平台 Gradle 会自动下载，需事先接受许可。`N` 以当前 Gradle 工程为准。SDK Manager 同时安装 Command-line Tools；模拟器另需 Android Emulator 和与宿主架构匹配的系统镜像。参考 [Tauri 前置环境](https://v2.tauri.app/start/prerequisites/)与 [Android SDK 自动下载说明](https://developer.android.com/studio/intro/update#AutoDownload)。

以下以 macOS、SDK 默认目录为例；其他系统改用本机实际安装路径。不要直接假定 Android Studio 捆绑的 JBR 就是 JDK 17。

```sh
export JAVA_HOME="$(/usr/libexec/java_home -v 17)"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export NDK_HOME="$ANDROID_HOME/ndk/27.2.12479018"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
java -version
sdkmanager --licenses
sdkmanager --install "platform-tools" "ndk;27.2.12479018"
rustup target add aarch64-linux-android
npm ci
npm run ios:tauri -- android build --apk --debug --target aarch64 --ci
```

`ios:tauri` 虽以 iOS 命名，实际固定调用 Tauri CLI 2.12.3，也可运行 Android 子命令；Gradle 的 Rust 构建任务调用本地 `npm run tauri`，两者版本应一致。CLI 自动合并 Android 平台配置。首次执行 `ios:tauri` 可能需要下载 CLI，Gradle／Rust 也可能下载依赖；构建成功不代表安装、首开或原生能力通过。查找输出：

```sh
rg --files --no-ignore src-tauri/gen/android/app/build/outputs/apk | rg '\.apk$'
```

只选择本次 debug APK；不要合并正式发布配置或使用 `local.thingary.main`。已有生成工程无需重复 `android init`；确需重新生成时先保留改动并核对差异。

### 发布签名（Android）

正式 APK 的签名只从环境变量读取，仓库内不保存密钥、路径或口令：`THINGARY_ANDROID_KEYSTORE`（keystore 文件绝对路径）、`THINGARY_ANDROID_KEYSTORE_PASSWORD`、`THINGARY_ANDROID_KEY_ALIAS`、`THINGARY_ANDROID_KEY_PASSWORD`。四项齐全且文件存在时，Gradle 的 release 构建自动使用该签名；任一缺失或文件不存在时构建仍然成功，产物为不带签名的 `*-unsigned.apk`，并打印一条只列变量名的警告。debug 构建不受影响。

正式发布用的 keystore 由维护者在仓库外创建并离线备份，口令使用占位符替换：

```sh
keytool -genkeypair -v -keystore /path/outside/repo/thingary-release.jks \
  -alias <别名> -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass '<store 口令>' -keypass '<key 口令>' -dname "CN=<名称>"
```

keystore 一旦丢失，已安装的应用无法再原地升级：签名不符只能卸载重装，卸载会一并删除资料。因此必须与口令分开保管并多处备份；任何情况下都不要把 keystore、口令或包含它们的备份提交到仓库、日志或 CI artifact。[发布草稿工作流](../.github/workflows/release-draft.yml) 使用的仓库 secrets `ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD` 会还原到 runner 临时目录并映射为上述四个变量。

### 独立创建 AVD、安装与截图

APK 构建的 `--ci` 跳过交互，不负责创建验收用 AVD。先在 Android Studio 的 Device Manager 手动创建并命名一个专用模拟器，明确系统镜像、屏幕和架构，避免依赖 CLI 自动选择设备。Apple Silicon 选 ARM64 镜像，与上面的 aarch64 APK 匹配；x86_64 模拟器需另装 `x86_64-linux-android` 目标并用 `--target x86_64` 构建。系统镜像的 API 不低于 `minSdk`，不要求等于 `compileSdk`。创建方法见 [Android 官方 AVD 说明](https://developer.android.com/studio/run/managing-avds)。

```sh
emulator -list-avds
emulator -avd ThingaryPreview
```

`ThingaryPreview` 是示例 AVD 名称，换成刚创建的名字。另开终端，按 `adb devices` 输出填写设备序号，并把构建输出中的实际 APK 绝对路径填入变量。以下步骤会安装应用，仅在维护者批准安装后的独立验收环境执行；所有记录、图片、服务器和凭据均用虚构或专用测试资料。

```sh
adb devices
export THINGARY_ANDROID_SERIAL="emulator-5554"
export THINGARY_ANDROID_APK="/absolute/path/to/debug.apk"
adb -s "$THINGARY_ANDROID_SERIAL" wait-for-device
adb -s "$THINGARY_ANDROID_SERIAL" install -r "$THINGARY_ANDROID_APK"
adb -s "$THINGARY_ANDROID_SERIAL" shell monkey -p local.thingary.preview -c android.intent.category.LAUNCHER 1
adb -s "$THINGARY_ANDROID_SERIAL" exec-out screencap -p > /tmp/thingary-android-preview.png
adb -s "$THINGARY_ANDROID_SERIAL" logcat -d -s AndroidRuntime
```

核对首开样例、五个标签、虚构记录保存重启、正常／未知／空白／错误状态，并记录 AVD、API、WebView 和截图尺寸。启用屏幕隐私后 `FLAG_SECURE` 会使截图、录屏及最近任务缩略图受保护；验证开关前后效果时分别记录预期，不能把空白截图当作页面未加载。当前分享、文件／照片选择和更新检查尚未接入，不把编译或截图当作它们已验。

隐私锁验证使用专用预览身份和虚构资料；设备身份验证已接入，策略为 API ≥ 30 的 `BIOMETRIC_STRONG | DEVICE_CREDENTIAL`，API 29 独立兼容函数的 `setDeviceCredentialAllowed(true)`。先在独立验收模拟器执行 `adb shell locksettings set-pin 1234`，开启「设备解锁」并选择最短的 5 分钟闲置重验，离开应用至少 5 分钟后回前台，应显示锁屏；与 iOS 一致，不自动弹出系统验证，点击「解锁」后再输入正确 PIN，核对成功、取消、失败及等待 120 秒超时的现有码和消息。另在无锁屏口令时核对 `privacy_auth_available` 为 false、开启控件禁用；结束后必须执行 `adb shell locksettings clear --old 1234` 恢复无口令，并复查能力。系统 PIN 输错通常保留在系统提示内允许重试，应与应用收到终止性认证失败的情况分别记录，不能把系统内重试写成后端已返回失败。

通知已接入不精确闹钟 `setAndAllowWhileIdle`、通知渠道与 Android 13 以上的 `POST_NOTIFICATIONS` 权限；计划按本地 09:00 整体替换且幂等，重启后由 `BootReceiver` 从私有偏好恢复，该偏好不进资料库、备份与导出。通知只显示固定的提醒类型与打开应用提示，不展示可能含金额的名称或自填备注。系统自动备份已对整个应用关闭，资料只通过物谱自己的备份导出离开设备；`node --test tests/android-system-backup.test.mjs` 在主机核对 Manifest 与云备份／系统换机迁移的全域排除规则。调试 APK 已构建，API 35 模拟器通知权限、拒绝、替换、幂等、到点通知、重启恢复与超容量提示尚未验证；真机省电策略与各厂商 ROM 的后台限制未验证。

### 工程维护的两个边界

- `tauri.android.conf.json` 的窗口必须保持 `create: false`；`lib.rs` 在 `setup` 完成 Worker、同步运行时等状态托管后创建窗口。提前加载页面会使首启 IPC 遇到 `state not managed`。
- 根目录忽略 `src-tauri/gen/`。首次新增生成源文件要逐项 `git add -f <具体文件>`，只纳入 Kotlin、Gradle 配置／wrapper、Manifest、必要资源等构建输入；不强加整个 gen 目录，不提交 `local.properties`、个人 SDK 路径、缓存、构建输出、APK 或凭据，也不修改根 `.gitignore`。

## 多语言

界面文字用 `t('简体中文原文')`（`src/i18n.ts`）：原文即 key，缺译文时显示原文；带变量写 `t('共 {n} 期', { n })`。英文译文在 `src/locales/en.ts`。`node scripts/i18n-keys.mjs` 列出全部 key（含 Rust 固定错误文字），`--check` 检查 en.ts 中过期的条目。改中文文案后须同步 en.ts 的 key。切换语言会重新载入窗口，所以 `t()` 是同步函数。读取源码做断言的测试通过 `tests/setup/unwrap-t.mjs`（`npm run test:ui` 已加载）把 `t()` 还原成原文，断言仍写中文。

## 内置参考汇率

`src/reference-rates.ts` 由 `node scripts/update-reference-rates.mjs` 生成（欧洲央行汇率，经 api.frankfurter.dev），发版前由维护者运行一次并提交；应用运行时读取内置汇率不联网。挂钩币种（AED、SAR、MOP）按固定挂钩推算，欧洲央行不覆盖的币种不内置。

## 自动检查

在仓库根目录执行适用检查：

```sh
npm run build
npm run test:ui
npm run check
npm test
```

| 命令 | 覆盖范围 |
|---|---|
| `npm run build` | Rust 核心 WASM 构建、TypeScript 类型检查与 Vite 前端构建 |
| `npm run test:ui` | 前端纯逻辑、真实组件处理器及部分渲染／布局约束；不是原生 UI 自动化 |
| `npm run check` | cargo fmt 与启用测试故障注入的 clippy |
| `npm test` | 独立计算核心及 Rust 领域、存储、迁移、回执与恢复测试；临时虚构资料 |
| `npm run check:engine-source` | 不重建，核对已提交 WASM 的源码／锁文件散列、二进制散列和接口 |
| `npm run test:engine-parity` | 同一虚构输入的原生 / WASM 结果及 ABI 所有权检查 |
| `npm run test:demo` | 独立样例导入工具 |

故障注入 feature 只用于测试，不进入普通应用。检查结果按本次实际执行登记；测试文件存在、历史通过或源码提交不代表当前工作树已通过。文案／样式核对受影响页面与断点；表单验证保存、取消、未知与失败；计算运行对应数值和调用链回归。纯文档检查链接、锚点、术语和离线交付依赖。

规划核心的 ABI 所有权测试同时在原生测试进程和 WASM 中验证。地址使用指针宽度的 `usize`（wasm32 下仍为 32 位），不能把 64 位测试宿主的地址截断为 `u32`；原生测试断言分配地址完整保留，WASM 对照检查实际导出接口及所有权行为。修改核心后需重新生成随源码保存的 WASM，并运行 `check:engine-source` 和 `test:engine-parity`。

<a id="sync-tests"></a>

### 同步测试

同步测试只使用临时虚构资料与进程内假 WebDAV（本机回环地址），不连接真实网盘、不打开正式资料库：

```sh
cargo test --manifest-path src-tauri/Cargo.toml --features fault-injection --test sync_state --test sync_fingerprint --test sync_engine --test sync_webdav --test sync_e2e
node --import ./tests/setup/unwrap-t.mjs --test tests/sync-state.test.mjs tests/sync-settings.test.mjs
```

`sync_webdav` 的假服务器覆盖 MKCOL／PROPFIND／PUT／GET／DELETE、条件写入和错误脱敏；`sync_state` 覆盖方向判断、配置和口令期限；`sync_fingerprint` 覆盖内容指纹；`sync_engine` 覆盖错误口令、篡改／截断、大小／散列不符和待核对推送。`sync_e2e` 通过两个独立临时身份覆盖首次推拉、连续版本、冲突两种选择、原资料保护、全表计数与托管文件 SHA-256、远端 schema 较新拦截、清单应答丢失、未配置零连接及秘密不落盘。三个 `reconcile_*` 用例分别验证 `landed`／`not_landed`／`remote_changed`，并断言核对没有远端写入。

上述命令也包含在相关全套检查中；测试存在不代表本工作树本次已通过。当前桌面“核对”处理器只调用 `sync_status`，未消费新增 `sync_reconcile`；手机界面没有同步入口。实际坚果云／Nextcloud、无 ETag 的并发、移动端往返、Windows 权限及大库性能需独立验收，不能用假服务器测试替代。现行限制见[同步架构](ARCHITECTURE.md#sync)。

<a id="v124-validation"></a>

### 四项补充范围与统一验收

账户扩充、存钱目标、加密备份和区间回顾的历史整合使用 schema 42。当前开发候选继续至 schema 44，使用既有新列补充盘点与核算能力；功能与界面冻结已于 2026-10-17 解除，备份容器格式不变。下述原生阶段结果按各自受测提交与资料版本保留，不能替代当前候选验收。使用隔离身份和虚构资料，禁止读取正式资料库。

专项入口：`src-tauri/tests/account_kinds.rs` 检查双表迁移、回滚与未知结构拒绝；`savings_goals.rs` 检查保存回执、来源缺项、恢复、永久删除和备份／表格；`annual_review.rs` 检查同一读取事务、模块关闭、范围变化、旧年份超过24条、修订失效与只读。前端口径与隐私回归见 `tests/account-kinds.test.mjs`、`savings-goals*.test.mjs` 和 `annual-review*.test.mjs`。当前集成候选按本页四项命令验证；较早独立功能检查的计数不能代替集成结果。虚构浏览器覆盖三种外观明暗、窄窗、正常／未知／空白／错误和隐私复制；它们不能替代四项集成后的统一原生验证。

### 区间回顾缺陷修复验证（2026-10-16）

基于 `7a0b14fffc44f45d0be2929c1361cae970dba6f7` 的修复工作树完成 `npm run build`、`npm run test:ui`（1,248 项通过）、`npm run check`、`npm test`（含独立核心共 864 项通过、3 项忽略、0 失败）。自动回归覆盖稀疏盘点、跨年窗口、无完整盘点、单端点、范围变化、整月跨度、开始日及窗口前起点、自选日期、自然年事实、隐私摘要和边界日期，并保留来源一致性与迟到响应检查。

Mac 原生：**通过**，范围为同一隔离身份的虚构资料：默认近 12 个月、自然年及自选日期切换、三次稀疏完整盘点的实际端点与金额、单端点及空窗口独立保留收支和当前目标、隐私／含金额摘要的系统剪贴板核对、重启后事实与隐藏金额偏好保留且默认期间复位。深色 800×600 逻辑点窗口（实际捕获 1600×1200 像素）下，自选日期控件换行、底部复制入口可达；柔和卡片浅色同夹具 1440×1000 修复前后对照及 1440×968 内容图见[截图清单](images/README.md)。

原生输入工具在一次 10 字符结束日期输入中丢失首字符；无效日期保留上一有效区间并提示，随后改用日历选择器完成，没有反复重试文本输入。这是本轮已遇到的工具限制，不作为完整输入法验证。Windows、Intel、macOS 14、完整键盘路径与 VoiceOver：**未验证**。本轮没有安装、下载、推送、发布或更改应用版本。

<a id="windows-validation"></a>

### Windows 候选实现与验证

V1–V4 的 Windows 补验源码为 `68adfe77ba6720c1ce894a0046b754257521d4ed`（0.0.7，schema 42）。Windows 11 Pro 原生 x64、150% 缩放下，全新隔离身份的构建、包核验与完整安装验收脚本通过；Rust 许可文本缺失 0。构建、1,241 项 UI、格式／Clippy 与 865 项 Rust 回归通过，4 项按规则忽略。原生补验覆盖四类账户默认值、真实 schema 40 库正常升级及旧备份恢复、目标关联账户永久清除保护、策略缺失／损坏暂停、含明文暂存的受保护 ACL、八次密钥轮换后的最近七份保留、年度来源与隐私、首次完整盘点询问卡和提示不遮挡。三风格明暗两尺寸共 12 张已安装 WebView2 内容区图已检查；它们不是系统桌面全窗口捕获，不能据此证明原生选择器、讲述人或实体输入通过。心愿和盘点提醒在应用关闭后进入系统通知历史。此前 Mac 端虚构明文与加密备份在该安装应用恢复后，账户／盘点／目标行内容及计数一致，夹具不含图片；后续另用 Mac 提供的明文虚构备份恢复，59 张业务表的计数与行散列、8 张托管原图 SHA-256 一致。

该 `68adfe7` 阶段：OneDrive 虚构目录中的额外密文副本散列一致；Windows 生产后端实测目标文件被占用时保留旧成品、失败状态独立，释放后重试成功。同源程序的后补验收已完成恢复密钥原生保存、原生选回该密钥并验证开启加密，以及手动密文备份原生保存与保存面板取消，中文与空格路径的应用回执和文件结果一致。云同步、额外目录原生选择、选图／备份／xlsx 文件选择矩阵、OneDrive 文件恢复、磁盘不足、升级中强退，以及进行中的加密／解密取消和备份发布／恢复替换中强退在该阶段未验证。双向虚构明文与密文恢复已有分别记录，不能扩展为所有夹具均通过。该阶段也未覆盖 Windows 10、真正缺少 WebView2 的联网／断网机器、多屏及 100%／125% 缩放、SmartScreen、通知拒绝／系统关闭、可见 toast、其他提醒类型、完整实体键盘／讲述人／输入法和 Excel 原生导入回执矩阵。以上是指定范围的阶段结果，不代表 V1–V4 全矩阵通过、界面冻结或可发布；详细过程证据另行保存。

另有真实 x64 的[指定原生交互记录](WINDOWS_ACCEPTANCE.md#原生交互与同尺寸对照)：五类文件面板的成功／取消、中文带空格路径与父窗口模态，搜索／物品名称／备注中的微软拼音 Esc／Enter，指定讲述人控件，单屏 100%／125%／150% 及重启窗口可见均已验；交互安装与 SmartScreen 放行有用户反馈但缺原生截图，人工卸载保留资料与重装已核对。心愿提醒的可见横幅、系统禁用提示与通知点击冷启动也有记录。上述结果各按原受测包保留；缺 WebView2、Windows 10、多屏及完整键盘／输入法／讲述人、其他提醒类型等矩阵仍未闭环，也不覆盖当前候选新增或修改的界面。

后补 SQL 探针仅在 Windows 虚构临时 Store 中使用 SQLite `sqlite3_trace_v2`：开启模块的正对照捕获到目标表读取；关闭账户与盘点后，直接目标读取返回 `MODULE_DISABLED` 且没有执行 SQL，普通／年度来源各重复 20 次，200 条实际 SQL 中没有目标表读取。此结果只覆盖生产 Store 入口，不是已安装应用的持续后台 SQL 采样；该后台验证仍未完成。临时探针未进入普通应用或产品源码。

整合 Rust 规划核心及关于页更新入口的受测源码为 `fb94e192dd1c4e3766e59574b21c8c41d19a26ec`（0.0.7 候选）。[核心 CI](https://github.com/CoderJackZhu/Thingary/actions/runs/38597178419) 四任务与 [Windows 包及原生自动流程](https://github.com/CoderJackZhu/Thingary/actions/runs/38597178389) 两任务均成功：两平台构建、UI 各 1,145 项、格式／Clippy、Rust Mac 747 项／Windows 754 项通过，分别忽略 3／4 项测试；15 类原生／WASM 运算、5 类缺字段拒绝及产物散列校验通过。双向恢复的 schema 40、57 张表计数和 8 个原图 SHA-256 完全一致。Windows 目标离线告知包含 301 项 Rust、4 项 npm 与独立 SDK 告知，无缺失。隔离安装后的保存重启、关窗保护、通知排期／系统历史、卸载重装和物品外观矩阵通过；环境为 Windows 11 ARM64 下的 x64 模拟。

虚构浏览器已核对 Windows 下载、空列表、缺包、单源及错误提示；截图接口超时，未取得关于页本轮同尺寸图片对照。关于页真实外部链接／查询、新核心整页交互与取消，以及整合版本的通知点击和实体关窗抽查仍待真实 Windows 补验。此前实体验收与自动脚本结果分别保留，不能以旧包或 CDP 合成按键替代新版本实体证据。步骤与判定见 [Windows 清单](WINDOWS_ACCEPTANCE.md#主分支整合后的复验)。

Windows 接入阶段的 0.0.7 候选已包含图片／文件选择、文件占用重试与长路径、窗口／Ctrl 交互、WinRT 定时提醒和 NSIS 打包，接入基线为 schema 40，随后账户类型和存钱目标补充升至 schema 42。当前开发候选为 schema 44，备份容器格式不变，升级兼容性须按当前源码重新验证。Windows 界面与数据语义复用 Mac；公开安装包与附件以对应 Release 为准，本节历史结果不代表当前候选已完成原生验收。

两平台 CI 分别执行构建、完整 UI 回归、格式／Clippy 与 Rust 回归；容量测试默认忽略，安装身份的通知集成测试由原生验收任务单独执行。每份候选包的通过状态、测试数量、运行器系统与源码 SHA 以对应工作流日志和 artifact 摘要为准；逐次证据另行保存。工作流配置、验收脚本存在或另一平台通过，不能推定该候选包已通过。

`ci.yml` 的两平台检查分别生成虚构完整备份；后续 `cross_restore` 互换备份并严格比较恢复前后的 JSON，含 schema、57 张表的计数及 8 个托管原图 SHA-256。此检查不使用正式资料，不改变备份格式；只有实际任务成功才算该次往返通过，表计数与散列也不能代替界面操作、文件对话框或用户内容逐项核对。

[Windows 候选包工作流](https://github.com/CoderJackZhu/Thingary/actions/workflows/windows-package.yml)分别构建正式身份 release 候选包与隔离 debug 验收包。release 任务使用 `windows-latest` x64，正式身份只构建和静态检查，不启动；验收任务使用标准托管 `windows-11-arm`，运行 x64 应用的系统模拟，不能据此声称真实 x64 硬件已验。运行器范围见 [GitHub 托管运行器说明](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)。工作流 artifact 保留 30 天，下载需登录 GitHub，不自动发布 Release。

原生验收从已安装的 `local.thingary.win.acceptance` 开始，核对安装目录 `许可/BUILD_INFO.json`、源码 SHA、版本、许可散列与快捷方式 AUMID 后才启动。`scripts/windows-native-acceptance.ps1` 和 `scripts/windows-native-ui.mjs` 自动检查窗口、保存／取消／重启、单实例、恢复夹具、实际通知排队／移除与应用退出后的系统历史送达、默认静默卸载保留及重装，并生成结果和同尺寸截图。排队与系统历史送达检查不证明通知已在桌面可见；人工安装、文件面板、输入法、讲述人与缩放的历史已验范围见本节及 Windows 清单，当前候选改动后的路径与剩余矩阵仍须分别验收。完整步骤与证据要求唯一维护于[Windows 验收清单](WINDOWS_ACCEPTANCE.md)。

### 0.0.6 发布验证

前端构建、1,085 项 UI 测试、格式／Clippy 和 596 项 Rust 测试通过，3 项既有容量测试按规则忽略。新增盘点提醒、差距提醒、目标进度与主动检查更新的回归随全套检查通过；schema 39→40 回滚、重试及备份恢复使用临时虚构资料测试。通用包正式身份、版本、双架构、严格签名、只读挂载与复制一致性通过；离线指南图片和内部链接完整。发布前隔离原生走查因 UI 工具超时未完成；发布后用户打开独立身份后补验 schema 39→40：旧 56 张表内容一致，只新增 goal_progress，空库无点，首次打开样例目标生成 1 个点。设置内检查更新真实显示 0.0.6 已是最新版本；后端真实读取两处均为 0.0.6、没有不可达来源。规划轨迹、压力／市场／矩阵／收益顺序图已补拍。系统通知送达、完整键盘／输入法、VoiceOver、Intel 和真实下载首开未验，不由自动检查推定通过。详情见[版本说明](releases/v0.0.6.md)。

### 0.0.5 发布后文档与截图收尾

0.0.5 已作为 Pre-release 公开，源码为 `v0.0.5`；工程回归与通用包静态核验见[版本说明](releases/v0.0.5.md)。发布后用同源码、全新隔离身份走查浅／深总览、账户与盘点、收支记录、财务复盘、目标、详情主按钮、试算、报告默认隐私和空库起步；确认顶层导航不带返回链接，报告保留 6 项影响提示，新增物品日期为空、补充更多收起，关闭表单没有新增记录。更新原生截图及 12 秒三帧演示，来源与实际尺寸见[截图清单](images/README.md)。

本轮只改文档与媒体，没有应用代码或格式变化；重新生成离线指南并检查图片、链接与内部跳转。新指南不替换已经发布的 DMG。完整持久化、备份恢复、键盘／输入法、VoiceOver、Intel、其他系统和下载首开的验证边界沿用原记录，不由截图走查推定通过。

### 0.0.4 发布验证

本轮构建、1,059 项 UI 测试、格式／Clippy 和 578 项 Rust 测试通过，3 项既有容量测试按原规则忽略。新增 36→37、37→38 提交前故障回滚与重试测试；总览待关注的来源完整性只检查已启用模块，回归覆盖隐藏来源及已启用来源真实失败。样例横幅说明图标的拉伸已修正并原生复验。

全新隔离身份完成 v0.0.3 原生生成虚构资料、schema35→39 直接升级、重启、旧完整备份原生恢复及恢复后重启；50 张旧事实表、236 行旧字段与 8 个原图／16 个缓存图片一致。另完成样例→空个人库→取消／保存物品→账户→完整盘点→手动备份／恢复→重启保留，未知金额和日期保持为空。发布截图为真实原生捕获，来源见[截图清单](images/README.md)。完整键盘／输入法、VoiceOver、其他系统、通知送达和下载后 Gatekeeper 首开仍未验；交付状态见[0.0.4 说明](releases/v0.0.4.md)。未启动正式身份包或访问正式库。

### 定位、导航与首次使用验证

定位、导航与首次使用调整（物品状态并入列表、规划页内三标签、起步选择、表单与术语简化）已在当前源码实施，不改变 schema、备份／Excel、模块默认值或计算口径。物品状态分段与标题回归在 `collection-navigation`；规划视图、修正聚焦与阻断在 `planning-detail-navigation`／`planning-current-report`；起步载荷、存储失败及总览视图意图消费在 `start-choice`；表单折叠与默认空日期在 `asset-editor-layout`；来源返回在 `planning-source-navigation`。每步分别运行构建、UI、格式／Clippy 与 Rust 检查；最终 UI 1,057 项通过，Rust 576 项通过、3 项容量测试按原规则忽略。

浏览器使用内存虚构资料，核对同尺寸前后、物品正常／空白／筛选无结果／读取失败、规划未设置／已设置／投入未知／读取失败／待确认回执、1280／820 明暗布局、报告限制数量、起步模块失败与两条主路径、职业确认项键盘焦点。公开媒体来源见[截图清单](images/README.md)。统计来源经全局搜索打开物品时保留真实返回；显式侧栏目标入口清除它。基线与当前均未复现旧“目标返回物品统计”的报告，原操作路径未知，不按推测改变导航。

原生使用用户确认全部为虚构资料的 `local.thingary.preview` debug 包，未打开正式库。已验证物品起步与勾选隐藏辅助模块、仅名称／日期未知保存、重启保留物品／物品视图／模块偏好、账户空页转到数据管理导入、未设置目标的独立试算、虚构目标设置保存及重启、测算详情与修正回目标、默认隐私报告、职业确认项焦点抽查。原生未验：起步复选框取消分支及账户起步卡、故障注入与全部来源修正组合、报告有影响项的数量提示、心愿转购入的本轮完整原生闭环、完整键盘／输入法和 VoiceOver。浏览器与处理器回归不替代这些未验项；旧原生记录不推定本轮全矩阵通过。

### 临时目录残留导致样例测试失败

若历史样例测试因临时同级目录残留损坏资料而报“已有数据但缺少指针”，先保留现场，再用全新临时根目录重跑；不删除不明目录，不到正式库修复测试。

```sh
thingary_test_tmp=$(mktemp -d -t thingary-tests)
env TMPDIR="$thingary_test_tmp" npm test
```

## 浏览器预览

### 关于与帮助入口验证

平台更新接入：构建、1,104 项 UI 和全量 710 项 Rust 通过，3 项既有容量测试忽略；最终下载排序与中文地址兼容补充后，格式／Clippy 和 13 项更新模块回归通过。覆盖 Mac／Windows 互不误提示、架构与版本、跨镜像通用包优先、附件缺失、异常地址、中文文件名及 Gitee 两种附件结构。虚构浏览器核对直接下载、备用来源、打开失败、查询失败、缺包及单源状态，前后同为 1440×1000，另核对 900×720 浅色。独立原生实际查询当前 Mac 可用版本 0.0.6，Gitee 成功、GitHub 未连接并披露限制；实际新版本文件下载、Windows 原生、完整键盘／输入法和 VoiceOver 未验。发布附件约定见[发布流程](RELEASING.md#平台更新与附件约定)。

当前直接展示方案：移除关于弹窗与二层按钮，版本与检查更新按钮同行，结果紧接该行显示；维护者名字打开 GitHub 主页，底部 Star 提示打开项目页，不自动点赞。关于／帮助菜单进入这一页，更新菜单定位版本行，不自动联网。构建、1,101 项 UI、格式／Clippy 及 705 项 Rust 通过，3 项既有容量测试忽略。独立虚构身份原生验证直接按钮、真实检查结果、维护者主页链接、浅深布局及逻辑 900×720 窄窗口；本次前后图实际均 2560×1400。版本不可用、忙态、新版本、失败重试及链接失败由组件回归覆盖；原生网络故障注入、完整键盘／输入法、VoiceOver 和 Intel 未验。下述弹窗记录为已替代方案，不作当前操作说明。

2026-10-14 早先的弹窗方案（已由直接展示方案替代）：应用菜单「关于物谱」／「检查更新…」和设置内关于按钮共用关于弹窗，版本、更新结果和帮助许可在原处显示，数据管理移除更新区域。构建、1,101 项 UI、格式／Clippy和705项Rust测试通过，3项既有容量测试仍忽略。独立虚构身份原生复现旧跳转，并验证设置及两种原生菜单入口、手动检查显示0.0.6已是最新、关闭保留目标／帮助页面、弹窗打开时设置快捷键不改变背景，以及数据管理没有更新区域。帮助页修复前后同一虚构资料和外观，固定独立身份的启动窗口偏好后，实际截图均2560×1400；最初不同高度的图保留，未用于同尺寸声明。打开不主动联网由组件调用回归验证；网络失败／重试和版本不可用沿组件回归，未原生注入错误。原生全键盘／输入法、VoiceOver、Intel及新版本下载／安装流程未验。

更早的入口方案（历史验证，已替代）：关于窗口、设置中的帮助汇总、帮助菜单与备份／更新定位曾接入。构建、1,088 项 UI 测试、格式／Clippy 和 597 项 Rust 测试通过，3 项既有容量测试仍忽略。内存虚构预览覆盖宽窄、浅深、空资料、版本不可用、链接打开失败、离线许可展开及备份／更新标题焦点；左下角本地状态圆点已改为整行居中并核对。独立虚构身份原生确认关于窗口名称／版本／维护者、帮助菜单进入设置、更新与备份区域定位，未触发检查更新或备份恢复。外部浏览器真实访问、VoiceOver 和完整键盘路径未在该次验收，圆点最后的样式修正只做了浏览器核对。该次源码与文档变更没有替换当时的正式安装包。

关于页更新发现预览：`update=available|none|unavailable|partial|error|ahead` 覆盖可下载、空列表、缺包、单源及失败，均为虚构发布信息；`update-platform=windows` 切换平台；`update-consent=unset|enabled|disabled|damaged|future` 模拟开关选择、偏好损坏与未来格式，`update-seen=1`／`update-ignored=1` 模拟已读／已忽略，`update-unsaved=1` 模拟本次状态无法保存，`update-write=error` 模拟显式设置写入失败。预览不会发出真实更新请求。关于页版本失败预览可加 `support-version=error`；外部链接在预览中始终拒绝打开，展示可复制地址，不访问真实网站。

```sh
npm run dev -- --port 1429
```

访问 <http://127.0.0.1:1429/visual-preview.html>。页面仅使用内存虚构资料，刷新重置，不包含于普通发布构建；预览保存提示不证明原生持久化或系统文件能力。

手机预览访问 `/mobile-preview.html`，与桌面预览共用 `src/preview-ipc.ts` 的虚构数据；参数 `theme`、`wealth`、`mobile-state`、`tab`、`route` 见 [src/mobile/README.md](../src/mobile/README.md)。

| 参数／入口 | 用途 |
|---|---|
| `?state=empty`、`?state=error`、`?state=save-error` | 空白、读取失败、保存失败 |
| `?wealth=empty|first|error` | 账户与盘点状态 |
| `?section=overview&started=first-use&state=empty` | 未开始的虚构资料（首次样例横幅）；可加 `module-write-error`／`module-read-error` 注入模块写入／读取失败，模块仅在预览内存中更新 |
| `?section=planning&plan-basic=saved|unknown|negative|blank&capabilities=real` | 已保存通用规划、投入未知／负值、基础未填；真实纯计算 |
| `?section=planning&plan-basic=saved&capabilities=real&plan-core=confirmed` | 当前目标、大额计划、计算详情与真实报告入口 |
| `?section=planning&plan-basic=saved&capabilities=real&plan-household=couple-same|couple-age|couple-age-empty`（可加 `plan-household-mode=fire`） | 虚构两人规划：伴侣同时停工、指定年龄并填存款、指定年龄但存款为空 |
| `?plan=error`、`?plan-profile=empty` | 规划读取失败／没有已保存规划 |
| `?plan-core=occurred|partial|overdue` | 已发生接续、付款缺项与过期待核对 |
| `?section=planning&plan-debt=normal|unknown|empty|error|changed|zero|saved` | 已有贷款直接还款安排 |
| `?movement=populated|error` | 资金流动列表与读取失败；预览拒绝流动写入 |
| `?import-kind=incomes&import=normal|unknown|empty|error` | 收入导入展示状态 |
| `?state=components&style=bento&theme=light` | 共用表单、菜单、日期／月份控件 |
| `style=native|olive|bento`、`theme=light|dark` | 三种外观的浅／深组合 |
| `?section=overview&receipt-recovery=account`（可加 `state=unresolved` 或 `plan-wealth=off`） | 重启总览的虚构回执核对、失败保留与模块关闭恢复 |
| `?section=finance-records&income-default-error` | 收入默认值读取失败仍可填写，缴存未知不补零 |

### 手机总览长按排序验证

虚构入口 `/mobile-preview.html?theme=light|dark`，在 320、390、430px 宽检查：短按仍打开原卡片；长按约 450ms 浮起并在顶部出现「取消 / 完成」；上下拖动、边缘自动滚动、松手后留在排序；取消恢复、完成刷新后保留；关闭模块后重开位置保留；坏偏好回默认、保存失败提示并可重试。自动回归为 `tests/mobile-home-order.test.mjs`（顺序持久化与取消、坏偏好、模块隐藏、手势阈值／多指／滚动取消、点击抑制、保存失败）。浏览器证据只覆盖 Chromium 预览；iOS WKWebView 原生长按与系统滚动接管、触觉反馈、VoiceOver 和真机安全区未验。

### 订阅期间与付款维护

schema 44 增加明确的停订／重新开通边界。未来重开沿用既有分段表，不增加 schema；新段服务与付款锚点分别验证，待生效不计当前负担。未付款末段调整／撤销、预付后的取消续费、软删除付款保护、旧回执兼容及特殊期清理纳入 `recurring.rs`、`subscriptions.rs` 和 `virtual_billing.rs` 回归。专项回归覆盖同 ID 多段订阅、停订空档排除、月末与固定天数、旧付款和分段价格保留、历史补记、迁移中断回滚、关联双方修订、未知回执重放、重启及完整备份恢复。`tests/subscription-usability.test.mjs` 执行实际组件处理器，覆盖付款更正入口、最新修订与生效期价格、读取失败、历史分页和重新订阅的未知结果保留；另覆盖未来日历、独立付款日、日期预览、提前实付覆盖、待生效调整／撤销与付款事实保护。

浏览器使用虚构资料核对重新开通、扣款、更正、取消返回、空白、未知覆盖期、读取与保存失败，以及三种外观浅／深的 800×600 布局；1280×720 同资料前后对照另行留存。

Mac 原生专项已于 2026-10-17 在 Apple Silicon／macOS 27.0.1、独立验收身份与虚构资料中通过：schema 43 结构夹具升级至 44；历史付款金额更正、改为本期不付、误记移入最近删除及重新记录；同档案停订后重新开通、停订期间不出现在历史补记候选；取消后续续费保留历史；空价格阻断、日历与 Esc 取消；保存退出重开；800×600 深色与浅色详情；原生保存面板取消及中文含空格路径完整备份、选择备份恢复、再次重启。恢复后的付款、价格、排期、期间边界、计划及服务档案六张表逐行一致，稳定 ID 保持。受测应用为同源码的 debug 独立身份包，不含故障注入；正式资料库未用于验收。读取／保存故障和结果未知仍引用自动与浏览器证据；完整键盘／输入法、VoiceOver、Intel、Windows 及下载后 Gatekeeper 首开未在本专项验证，不能由上述通过推定。

未来重订的补充原生路径也在独立虚构身份通过：共享日历选择未来21日生效；展开／收起固定提前付款；17日实付对应21日至下月20日服务，后续仍按21日排期；预付后取消续费建议已付期末并保留该服务；未付款安排调整、确认撤销与取消返回；空价格阻断；重启后日期、历史与另一订阅保持独立。待生效不计「使用中」数量与当前负担。1280×800逻辑点同资料的新旧表单对照已留存；本次补充不代表窄窗、VoiceOver、Intel或Windows已重新验收。

### 规划核算与实际发生预览

当前规划共用 `PlanningSources` 和真实 `buildBasicCapabilities`。未知投入仍可反求需求，预测保持缺项；临时投入不回写其他消费者。资金起点、事件付款、盘点吸收、剩余贷款、费用包含与受限资金分别检查，不用未知零值绕过校验。

`tests/planning-core.test.mjs`、`planning-basic-ledger-integration.test.mjs`、`planning-basic-consumers-integration.test.mjs`、`planning-coverage-consumers.test.mjs` 覆盖账本与共享结果；`src-tauri/tests/plan_profile.rs` 和 `planning_basic.rs` 覆盖事务、引用、事实保全、旧回执与恢复。旧政策／职业阶段夹具应显示待重新设置，不能重新进入旧估算路径。

### 金融导入解析与报告组件

外部表格只接受 Excel `.xlsx`。`spreadsheet.rs` 将受控工作表规范化为内部 CSV 文本，继续复用纯解析器；没有外部 CSV、OCR、银行格式转换或资金流动回导。解析器契约与虚构样例见[解析器说明](../src-tauri/src/financial_import_parser/README.md)。

`src-tauri/tests/financial_import.rs`、`financial_import_parser.rs`、`spreadsheet.rs`、`finance_export.rs` 和 `tests/financial-import.test.mjs` 覆盖外部键、同日冲突、未知／零、整批回滚、旧备份迁移、回执重放、删除可用性、中文路径、Excel 行号及恶意公式／ZIP／范围拒绝。覆盖声明与历史总额参考仍仅有纯解析能力，未接入产品。

容量测试默认跳过，独立串行运行；需要测量时用 `/usr/bin/time -l` 包裹测试进程，区分预览、提交、取消和构建峰值：

```sh
cargo test --manifest-path src-tauri/Cargo.toml --features fault-injection --test financial_import maximum_ -- --ignored --nocapture --test-threads=1
```

总计 20 MiB／5 万行、5 万账户及已有 5 万账户的重复预览与取消已在 Apple M4／16 GiB、macOS 27 的 debug 测试进程通过。此测量没有既定产品耗时／内存阈值，不代表其他机型或 release 应用性能达标；分页不能缩减后端完整校验，取消不得留下写入。

独立报告预览 `/planning-report-preview.html` 仅展示固定虚构 v1 状态。真实当前报告入口另见[当前报告验证](#current-report-validation)，基准／比较与原生打印 PDF 未接入。组件契约与回归见[报告说明](../src/planning-report/README.md)和 `tests/planning-report.test.mjs`。

### 职业变化情景原型

`/career-preview.html` 使用虚构现金流比较空窗、降低投入或换工作。普通目标页的职业试算共用通用模型；关闭丢弃临时条件，不保存职业路线，不恢复政策待遇、资格或停续缴计算。

职业入口与常驻资金续航已做同源码独立身份的核心原生验证：三种问题切换、空窗收支、未知恢复投入、负净投入失败提示、月初付款与底线、关闭焦点返回、保存基础条件后重取值，以及重启保留已保存条件／清空临时输入。1440 宽与 900 宽原生窗口已抽查，无须展开外层工具区域；不将系统可见高度限制称为严格 900×720 对照。读取失败注入、完整键盘／输入法和 VoiceOver 尚未在这条路径覆盖。公积金周期缴存／提取尚未接入，原生通过不扩大该能力范围。

## 当前功能验证入口

### 更新发现（未发布候选）

`src-tauri/src/update_state.rs` 的内嵌测试覆盖偏好缺失／损坏／未来格式、每进程一轮与 24 小时节流（成功与失败都计数）、时钟回拨重建基准、手动绕过频率并登记尝试、部分来源不抹掉更高缓存、双源撤下旧候选、关闭代次取消迟到结果、已读／忽略与并发写冲突、升级后清除、7 天新鲜度、缓存损坏不重置授权、尝试时间写失败不联网、手动结果无法落盘的当次展示。前端纯逻辑与真实组件处理器在 `tests/update-discovery.test.mjs`（含专用上下文运行时），`tests/support.test.mjs` 核对关于页文案与入口；`tests/check-in-locate.test.mjs` 与 `tests/planning-completion-contract.test.mjs` 分别覆盖定位未填／回车／持平的纯函数与目标页结论先于条件的 DOM 顺序。原生菜单、重启持久化、锁定与系统浏览器的行为按受影响范围另行隔离验收；自动检查与真实网络的可达性只在使用隔离身份的明确授权下人工核对。

2026-10-17 的 Apple Silicon／macOS 27.0.1 集成原生抽查通过：沿用虚构订阅的两段期间和两笔付款，取消付款更正保留原金额；新账户保存后进入盘点、空金额阻断及未填定位、完整盘点保存后回概览、关闭提醒邀请、退出重开保留账户与盘点。更新默认保持手动，实际手动查询完成并披露单源限制；开启启动检查后重启保留选择，24 小时内尝试时间未改变。使用同源码的 debug 独立身份包，不含故障注入，正式资料库未用于验收。此前独立原生还覆盖偏好损坏修复与保留损坏副本；并发、迟到结果、已读重试和失败／未知保存主要由自动回归覆盖。完整锁屏／键盘／输入法、VoiceOver、Windows、Intel、最低系统及真实新版本附件下载首开仍未验证，不由本次通过推定。

<a id="finance-workspace-validation"></a>

### 财务工作区接入与联合验收

当前源码的财富入口为账户与盘点、收支记录和财务复盘，规划仅保留目标。`finance_sources` 在同一读取事务中返回期间事实，关闭来源不读取；收入、资金流动和目标分别门控，旧配置继承只执行一次。模块偏好规则见[架构说明](ARCHITECTURE.md#module-preferences)。

前端回归入口为 `tests/finance-*.test.mjs`；Store 回归在 `src-tauri/tests/finance_sources.rs`、`plan_income.rs`、`expenses.rs`、`investment_review.rs`、`planning_flow.rs` 与 `financial_import.rs`。核对完整盘点、收入分类、区间端点、互斥流动来源、切库、迟到响应、来源返回和未知回执；不要把独立切片测试当联合验证。

隔离原生已覆盖收入／支出／转账、账户／完整盘点、投资核对及失效重确认、系统备份保存／选择／恢复、Excel 导出／收入导入与重启。日期与年份控件、普通来源返回及保存焦点也已抽查；完整键盘、全部系统输入法和通知实际送达仍未完整覆盖。公开版本、本机安装与本轮源码验证分别记录，不能互相替代。

### 通用规划基础联合验收

五步主要条件在内存编辑（净投入可跳过），最终 setup 一次事务保存；后续分区修改只改对应条件。回归 `planning-basic-ui`、`planning-basic-service-integration`、`planning-fourq-components`、`planning-debt` 与 `planning-component-runtime`；Rust 重点为 `plan_profile.rs`、`planning_basic.rs` 和 `tests/helpers/planning_migration.rs`。旧政策输入退出，真实资产、收入、付款、附件、稳定 ID 和历史回执继续保全。

需求与预测门控独立，完整预算／零终点判据、收益上下调 200 bps、月初付款顺序、引用去重与模型标注共用现行账本。风险与来源回归见 `tests/plan-risk.test.mjs` 和 `source-provenance.test.mjs`；来源与许可另见 [SOURCE_NOTICES](../SOURCE_NOTICES.md)。

### 收入分类与投资区间接入验证

`income-classification`、`income-records`、`investment-review-host`、`planning-followup-ui` 与 Store 的 `plan_income`、`investment_review`、`planning_flow` 测试覆盖分类事实、手填／明细互斥、区间重叠、更正／删除／恢复失效及旧请求兼容。独立损益组件可运行：

```sh
cargo test --manifest-path src-tauri/Cargo.toml --example investment_review_contract
```

假设四字段、资金流动、关联来源、端点更正、失效重确认、完整备份／Excel 与重启已做隔离核心原生验证。端点更正和资金流动更正应使用不同受控原因，不改变保存前依据校验；备注更正不应撤销确认。原生故障注入与完整操作矩阵不由 Store 测试推定。

<a id="current-report-validation"></a>

### 当前规划报告预览与验证边界

2026-10-13 目标首页与当前报告可读性更新已通过构建、1,020 项 UI 测试、Rust 格式／Clippy 和 576 项 Rust 测试（3 项容量测试按原规则忽略）。虚构浏览器核对了五步设置、正常／未知／空白／假设读取失败、隐私／完整报告和 1280×720／820×720 布局。本轮未做原生保存重启、完整键盘／输入法或 VoiceOver 验收；旧原生通过记录不替代这次界面改动的验收。假设只读预览参数 `assumptions=confirmed|unconfirmed|needs_review|error` 是虚构展示，预览仍拒绝原生假设确认写入。

2026-10-13 后续复核移除页头重复报告入口，统一操作对齐与工具栏尺寸，并修正出生年月、详情返回及未来收入入口文案。追加回归覆盖详情进入／返回／卸载与零月龄／旧年龄参考／未知；1,022 项 UI 测试通过。虚构浏览器验证 1280×720 同尺寸对照、820×720 报告、侧栏切换及真实跨页来源保留。原生交互验收限制沿上述说明。

“查看当前报告”使用同一批已保存来源与领域能力，经 v1 校验生成独立只读快照。普通刷新不替换正文；切库、恢复、规划关闭或离开目标使其失效。未知投入不补零；影响计算的遗漏或未确认假设限制结论。只展示列明的账户资金、结构化条件、需求与已有确定性输出，不造逐月趋势、逐项购买结果或历史比较。

回归在 `planning-report-current-adapter.test.mjs`、`planning-current-report.test.mjs` 和 `planning-report.test.mjs`：快照脱离来源、错误和上下文失效、未知／零／负、费用遗漏、未来收入基准、稳定别名、隐私及复制失败重试。真实入口默认隐私，无打印／PDF；完整与隐私都从同一快照投影，不把隐藏金额留在 DOM／可访问文本或复制输出。

隔离原生已验证隐私／完整金额与盘点一致、隐私摘要的真实剪贴板回读、Tab 模态循环、Escape 返回、三主题明暗稳定窄窗截图及重启不保留报告。快切主题的过渡帧不作为常态表面缺陷；截图前等待主题与页面稳定。目标网格宽度修复后的 900×720 原生窗口无整页横滚，表格保留内部滚动。收入保存的禁用触发按钮回退页标题已原生复验。旧前后图 Retina 比例不同，不称严格同像素对照；浏览器 DOM 矩阵也不冒充截图验收。

### 加密备份验证（未发布源码）

当前集成源码使用 age 0.12.1、关闭默认特性，以标准 X25519 恢复密钥加密外层，内层 ZIP／SQLite 格式不变。新增依赖许可全文经既有 override 与离线告知脚本收集；材料完整不替代维护者对分发许可的判断。受限头解析、完整流认证、私有暂存权限与失败清理分别由低层测试核对，不能从浏览器画面推定通过。

Rust 入口包括 `src-tauri/tests/backup_security.rs`、`auto_backup.rs`、`backup_staging.rs`、`backup_copy_epoch.rs`、`backup_pipeline.rs` 和模块内嵌测试，覆盖策略选择与异常暂停、密钥验证／轮换、首备结果、目标目录无明文、冻结会话、代际发布及取消。`v1234_integration.rs` 用临时虚构资料核对 schema 42、新账户类型、目标关系和年度事实经标准 age 解密与恢复后的结果，以及只读恢复回执。`examples/v1234_acceptance_fixture.rs` 仅接受显式隔离根目录，拒绝非空目录重新创建，已有验收资料只读检查使用 `--inspect`。前端回归在 `tests/backup-security.test.mjs`、`finance-data-management.test.mjs` 和 `data-management.test.mjs`；运行中取消须等原 promise 清理后才解除互斥，恢复最终提交不提供取消。

已有 Apple Silicon 隔离普通构建的开发验证记录覆盖账户／目标保存、未知盘点回退、删除恢复、重启持久化、年度隐私摘要复制、恢复密钥文件保存与验证、手动／自动／额外密文、标准 age CLI 双向互通及加密恢复。原生大文件读取取消和独立小型测试卷空间不足均保留旧好成品并清理临时文件；启动清理用孤儿夹具复验，不等于所有强退时点都已实测。该 Mac 记录不覆盖 Windows；历史 schema 40 的工程双向恢复与 schema 42 的虚构明文／密文双向恢复分别记录于[Windows 验证](#windows-validation)，ACL、MSVC 链接与占用重试也按各自受测范围保留。当前 schema 44 候选的双向恢复与 Windows 长路径原生专项仍须按对应源码复验；所有导出／恢复强退时点、真实容量上限、Intel、macOS 14、完整键盘／输入法和 VoiceOver 仍未验证，不以已实现或自动检查替代。

## 样例与原生验收

`npm run demo:import` 只用于独立开发预览。`src-tauri/examples/` 的夹具有各自身份保护，调用前检查；不得把正式包或真实备份复制成夹具。代理操作不能代替真实用户的理解与完成度。

界面变更核对 1440×1000 与 900×720、三主题明暗、正常／未知／空白／错误，以及保存、取消、焦点和键盘。涉及原生文件、持久化或通知时，另用隔离身份验证相应边界。全矩阵在阶段集成或发布前集中执行，小改动按影响范围复验，未验范围明确登记。

盘点提醒（`checkin_reminder`）、目标页差距提醒和目标进度记录（`goal_progress`，schema 40）的 Mac 发布验证与后补的隔离升级结果见上方“0.0.6 发布验证”；系统通知实际送达及这些新增功能的完整原生保存／重启／备份矩阵仍未闭环。Windows 按本页独立验证边界记录，不沿用 Mac 结果；Rust 回归在 `src-tauri/tests/checkin_reminder.rs`、`goal_progress.rs`，前端在 `tests/checkin-reminder.test.mjs`、`plan-saving-hint.test.mjs`、`goal-progress*.test.mjs`。

Mac 当前只在 Apple Silicon、macOS 27 实测；Mac 正式包为 Apple Silicon 与 Intel 通用包，Intel 部分只经构建与架构检查。Windows 候选源码的自动与原生验证边界另见[Windows 验证](#windows-validation)，不沿用 Mac 的通过记录。macOS 14 最低打包目标不是兼容验收；Intel、VoiceOver、显示缩放、完整键盘、全部输入法组合与通知送达仍不能宣称完成。豆包拼音仅在支出名称验证组合、Space 提交和 Escape 顺序，不推广为所有表单通过。

### README 与使用指南截图

公开截图均使用虚构资料。来源、尺寸与复现路径只维护在[截图清单](images/README.md)，照片内容更新不能仅改名或由浏览器图替代原生能力证明。纯文档更新检查链接／锚点／图片，生成离线指南并核对内部跳转：

```sh
node scripts/offline-guide.mjs <临时输出目录>
```

<a id="planning-engine-validation"></a>

### 当前规划核心接入验收（未发布源码）

2026-10-14 当前工作树的构建、1,098 项 UI 测试、格式／Clippy 和 705 项 Rust 测试通过，3 项既有容量测试仍按原配置忽略。其中独立核心 debug／release 各 106 项通过；15 类原生／WASM 运算与 5 类必填字段缺失拒绝对照通过。源码／锁文件与产物散列、ABI 所有权、分批路径一致性及取消／迟到结果另有回归。开发启动自动生成核心；CI 在生成前检查已提交产物，防止过期 WASM 被构建覆盖后误判通过。

本次用独立身份、全新目录与虚构资料，在真实 macOS WKWebView 验证同步 WASM、异步原生命令、81 路径按 40／40／1 分批汇总、必填字段拒绝、明确零和迟到取消。实际产品页验证投入修改取消、未知保存及预测阻断、已知投入保存与重启、1,000 条市场路径完成、2 万条运行时切回概览、压力参数与收益顺序说明。默认隐私报告保留当前公开核心版本标识，金额继续隐藏；任意自由文本版本仍脱敏。Escape 关闭只读报告后返回触发入口。隐私报告版本修复前后使用同一虚构计划、外观和原生窗口，截图实际均为 3200×1866；此对照只验证本次修复，不代表规划 UI 已完成独立设计。

重建范围只覆盖 Rust 计算核心，TypeScript 仍承担资料编译、产品门控与展示。历史目标进度未记录核心版本，不能保证跨版本数值可直接比较。历史来源、旧版本及整个产品的 AGPL 记录保留，详见[来源告知](../SOURCE_NOTICES.md)。本轮没有验收系统通知、原生 PDF、完整键盘／输入法、VoiceOver、Intel、最低系统兼容、签名公证或真实下载首开；源码验收不代表正式包已发布或安装。

## Rust 规划核心

修改计算库后运行 `npm run build:engine`；首次需要 `rustup target add wasm32-unknown-unknown`。`npm run build` 与 `npm run dev` 都会先运行 `build:engine`：Rust 输入（源码、Cargo.toml、Cargo.lock）未变且已提交 WASM 的源码／二进制散列与接口校验通过时直接沿用，不重建，因此不同 Rust 工具链不会改动受跟踪文件；输入变化时才重建，`npm run build:engine -- --force` 可强制重建。`tauri dev` 的前置开发命令同样触发此构建。生成的 `src/planning-engine-wasm.ts` 随源码保存，不手工编辑；原生应用通过 path dependency 编译同一库。

```sh
npm run test:engine
npm run test:engine-parity
npm run check:engine-source
npm run check:engine
```

`test:engine-parity` 使用虚构数据比较原生 dispatch 与真实 WASM 输出，并验证内存所有权与拒绝路径；它不等同于 macOS WebView／IPC 的完整交互验收。CI 在重建前执行 `check:engine-source`，核对已提交产物的源码与二进制散列；此检查不调用 Cargo、不覆盖产物，不要求 Rust 编译器版本相同。`check:engine` 则需要与生成产物一致的 Rust 工具链。模块设计及来源边界见[核心说明](../crates/planning-engine/README.md)。

## 构建应用

```sh
npm run tauri -- build --bundles app
```

上述 `--bundles app` 用于 Mac，默认产物 `src-tauri/target/release/bundle/macos/Thingary Preview.app` 使用开发预览身份。Windows 默认开发运行可使用上方 `npm run tauri -- dev`；安装验收包在 Windows 上运行以下命令：

```sh
npm run build:win:acceptance
node scripts/verify-windows-package.mjs --acceptance
pwsh -NoProfile -File scripts/windows-native-acceptance.ps1
```

构建前需先 `npm ci` 和 `cargo fetch --locked --manifest-path src-tauri/Cargo.toml`，供离线许可收集。验收脚本要求验收身份的 Local／Roaming 目录不存在，输出也必须是新目录；不自动清除已有资料。重跑使用新的验收身份及输出目录，保全原有虚构证据与资料。验收配置使用 debug／fault-injection，只在 loopback 开启 CDP 9227，供脚本读取安装后的 WebView；这不是正式包，不可用于个人资料或作为公开安装包。Windows 系统通知须使用安装后匹配 AUMID 的包，不能用 `tauri dev` 证明有效。

若默认身份已有资料，三步使用同一个新身份（后缀 1–32 位小写字母、数字或连字符，首位须为字母或数字）：

```sh
npm run build:win:acceptance -- --identity local.thingary.win.acceptance.run-20261016a
node scripts/verify-windows-package.mjs --acceptance --identity local.thingary.win.acceptance.run-20261016a
pwsh -NoProfile -File scripts/windows-native-acceptance.ps1 -Identity local.thingary.win.acceptance.run-20261016a -ArtifactRoot .local/windows-native-acceptance-run-20261016a
```

后缀同步区分安装名称、开始菜单快捷方式、通知 AUMID、Local／Roaming 与静态核验目录；脚本仍拒绝已有资料及输出。CDP 端口保持 9227，同一时间只运行一个验收实例。原生窗口助手临时采用目标窗口的 DPI 上下文并恢复调用线程状态，避免 125%／150% 下重复缩放；矩阵仍须同时核对物理客户区和 WebView 的实际 CSS 尺寸，不用截图缩放代替。通知诊断只接受这一隔离命名空间，仅 fault-injection 构建提供，不触及其他身份的通知。

正式候选包由维护者在 Mac 运行 `npm run release`、Windows 运行 `npm run release:win`；版本、签名、公证、支持平台和公开附件按[发布流程](RELEASING.md)核验，不由源码检查推定。

源码与现行文档只在本仓库维护。修改行为同步 PRODUCT_RULES，修改操作同步 USER_GUIDE，修改实现取舍同步 ARCHITECTURE；设计状态由 INDEX 导向唯一规格。外部贡献者无需访问私有过程记录即可构建、测试或理解约束。

## Android 文件进出验证

使用调试身份 `local.thingary.preview` 和虚构资料；不得打开正式资料库。模拟器只有一台，先以 `mkdir /tmp/thingary-emulator.lock` 独占，用完释放；启动必须带 `-no-window`。构建使用 `npm run android:build -- --debug --target aarch64`，APK 位于 `src-tauri/gen/android/app/build/outputs/apk/universal/debug/`。编译通过不能代替以下设备验证：

1. 在手机数据管理导出完整备份和工作簿，确认系统分享面板弹出；取消后用调试身份的 `adb shell run-as local.thingary.preview ls files/exports` 核对文件仍在。应用没有重新分享记录入口；需要保存到其他位置时重新导出并选择分享目标。
2. 把虚构备份以 `adb push <虚构备份> /sdcard/Download/fiction.thingary` 放入 Downloads，从应用的选择备份按钮打开系统文档选择器，走检查、明确确认替换、恢复和结果核对；比较恢复后的虚构记录，并确认 `cache/backup-staging/` 没有遗留选择副本。取消选择应保持当前资料不变。
3. 选择非备份文件，确认显示不能恢复的原因、当前资料不变且 staging 清理；调用 `ios_share_file` 传入 `../escape.thingary`，应以 `EXPORT_NAME` 拒绝。普通目录和符号链接也必须被拒绝。
4. 用隔离测试提供者覆盖声明大小超限、未声明大小但实际读取超限、读取失败与恰好上限；失败后核对 `.part` 和目标副本均不存在。生产复制上限沿用备份上限，不能为验收降低普通应用的上限或加入故障注入入口。
5. 核对 `platform_capabilities` 的 `native_file_sharing: true`、`pdf_export: false`；当前报告隐藏导出入口并保留复制摘要。对照缺少 `pdf_export` 字段时仍显示导出的组件测试，见 `tests/mobile-report-export.test.mjs`。

保留 `adb exec-out screencap -p` 截图、原生命令结果和虚构资料核对摘要于私有验收记录。真机、第三方文件提供者及分享目标的实际保存行为未验证；系统交接回调不能证明对方已经保存文件。
