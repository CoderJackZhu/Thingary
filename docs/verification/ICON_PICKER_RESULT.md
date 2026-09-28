# 图标选择器与外观切换

日期：2026-09-27。用户确认名称左侧默认图标、按来源与分类选择素材，以及更完整的太阳／月亮切换。实现位于 `codex/asset-icon-picker`；正式资料库未打开或用于测试。

## 交付范围

- 名称左侧默认箱子；点击打开选择器，预览后确认；支持恢复默认。
- 50 个原创线条图标，覆盖用户列出的设备、家电、厨具；保留原有 8 张立体示意图。清单与图形定义统一在 `src-tauri/materials/materials.json`，离线 PNG 随 App 内嵌。
- 图标／立体图标／最近／我的图片；名称和别名搜索，分类筛选，当前选择预览、选中状态和固定底部操作。
- 自有图片可系统选图、拖入或粘贴；原有图片解码、大小限制与资料库身份检查继续生效。
- 图片附件独立折叠。连续更换临时图标不累积附件；替换已保存封面保留原照片。默认箱子不占 20 张图片额度。
- 左下角太阳／月亮胶囊，高亮当前状态，短滑动反馈；减少动态效果偏好下关闭动画，设置保留跟随系统。
- 不改业务 schema，不改变资产名称、价格、日期、分类或已有图片文件。自定义素材继续沿用 schema 9 和完整备份。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| 前端构建 | TypeScript 与 Vite 通过 |
| 前端测试 | 88/88；覆盖所有指定图标、别名／来源／分类组合、最近使用隔离、图片替换及数量边界 |
| Rust 格式及 Clippy | 通过，无警告 |
| 素材存储测试 | 8/8；内嵌素材可读、旧 ID 兼容、自定义上传／删除引用与恢复 |
| 图片测试 | 6/6；沙盒内 ImageIO 解码受限，沙盒外使用临时虚构文件重跑通过 |
| 浏览器交互 | SSD 别名搜索、最近、默认恢复、名称不被修改、取消、拖入虚构 PNG、准备失败保留输入通过 |
| 800×600 浏览器布局 | 选择器 760×544，底栏 y=501–571，结果区独立滚动；单一模态窗口 |
| 原生 1280×840 | 默认表单、浅／深色切换、选择笔记本图标、保存虚构资产、退出重开后图标和日期保持 |
| 原生 800×600 | 深色选择器底部按钮可见，图标区可滚动，分类与来源可访问 |

原生身份分别为 `local.possio.icon.acceptance` 与 `local.possio.icon.small.acceptance`，均为虚构隔离资料。实际测试发现 WebKit 多模态层使选择器控件无法被辅助操作工具读取，已改为同一个原生模态窗口内切换内容；修复后可读取所有图标及操作按钮。搜索框保留单层焦点提示，返回恢复头像按钮焦点。

浏览器预览采用模拟存储，不能证明原生持久性；持久性以独立原生保存／重开为依据。拖入已验证浏览器事件与既有原生图片存储链路，尚未通过 Mac GUI 手动投递文件或图片剪贴板完成端到端补验。VoiceOver 完整流程仍沿用既有待验边界。

## 视觉证据

- [新增表单](icon-picker/editor-light.png)
- [浅色选择器](icon-picker/picker-light.png)
- [小窗口深色选择器](icon-picker/picker-small-dark.png)
- [原生小窗口控件](icon-picker/picker-small-native.txt)
- [重开后的图标](icon-picker/reopened-native.png)与[控件记录](icon-picker/reopened-native.txt)
- [深色主窗口与外观胶囊](icon-picker/shell-dark.png)

## 实现与复现

`npm run build`、`npm run test:ui`、`npm run check`；存储检查：`cargo test --manifest-path src-tauri/Cargo.toml --features fault-injection --test materials --test photos`。macOS 图片解码需要允许 ImageIO 正常运行。

图标原图生成入口：`scripts/render-material-icons.mjs`，参数为本机 sharp 包路径。它根据素材清单生成新增 PNG 及 Rust 嵌入清单，原有八张插图继续使用原生成脚本。

窗口关闭 Tauri 自带文件拖放接管，使用 HTML 文件拖放；配置依据为 [Tauri 官方 dragDropEnabled 文档](https://v2.tauri.app/reference/config/#dragdropenabled)。新增字节导入命令仍委托原 `stage_photo`，检查大小、实际图片内容与当前资料库 generation。

## 安装状态

`npm run release` 已成功。用户确认保存并退出后，已安装到 `/Applications/物志.app`，身份保持 `local.possio.main`。安装前后及正式构建的二进制 SHA256 一致：`054b0c3f99f6bd327814fb278efce63b8b02253b1c5d7fefe09bab090f0d0aae`。

旧包保留在 `/private/tmp/物志-before-icon-picker-20260927.app`。仅替换 App 包，未启动正式版、未打开或写入正式资料库。浏览器验收空间已关闭；隔离原生窗口只使用虚构资料。


## 2026-09-28 · 贵重大件图标扩充

用户要求“现有的图标库扩充一些图标，主要围绕着比较贵重的、值得记录的大件东西扩充，保持现有风格”。本次直接复用当前完整物品插图的 category palettes、80×80 SVG 框架、1.2 轮廓、渐变和落地阴影；不按本报告最初的线条图描述重画旧图。

新增 22 个主题：洗衣机、烘干机、扫地机器人、空气净化器；投影仪、音箱、相机镜头、网络存储（NAS）、VR 头显；床、衣柜、餐桌、升降桌、人体工学椅、钢琴、吉他、按摩椅；跑步机、划船机、动感单车；电动自行车、摩托车。全部归入原有分类，支持名称和中英文别名搜索。共 84 个素材（72 个 `icon-` 图标、原有 8 张示意图、4 个立体主题），隐藏旧别名的规则不变。

生成入口仍为 `scripts/design-material-art.mjs` → `scripts/render-material-icons.mjs <sharp 包绝对路径>`。新增 SVG 直接组合填色物体，旧图继续按原 shape 生成；PNG 为 320×320，清单、浏览器插图和 Rust 嵌入资源保持一致。旧图、旧 ID 和原有 PNG 文件均无差异，不涉及 schema 或业务逻辑。

### 验证与对照

- `npm run build` 通过（保留 Vite 单包超过 500 kB 的提示）；`npm run test:ui` 100/100；`npm run check` 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --features fault-injection --test materials` 8/8，使用临时虚构库；遍历目录清单与内嵌图片的已有测试覆盖新资源。
- Ego Lite 同一 TaskSpace，本地独立 1437 端口虚构预览：家居分类新增项目及图片加载正常；NAS 搜索命中网络存储；无匹配关键词呈现空结果；深色表单搜索“滚筒”命中洗衣机，点击直接返回，名称未改，封面加载成功，保存后图片附件显示“洗衣机示意图（非实物照片）”。[保存后的浏览器控件证据](icon-expansion/browser-save.txt)。
- 同尺寸 100×100 新旧图标对照：[浅色](icon-expansion/contact-light.png)、[深色](icon-expansion/contact-dark.png)。第一行是原有六个主题，其余为 22 个新增主题，已检查识别度、边界与配色。
- Ego Lite `Page.captureScreenshot` 两次超时，未取得实际页面截图；上述对照为 SVG 渲染的图标板，不冒充 App 截图。浏览器控件和图像加载检查通过。现有虚构预览另显示提醒不可用、保存后的 `list_timeline` 未模拟提示，与本次素材扩充无关，未修改这些流程。
- 首轮未执行原生 GUI 保存/重开与全流程回归；后续补验与打包结果见下节。首轮未启动正式 App、未打开正式资料库，未提交、推送或安装。

模型建议 Sol 中档；实际使用当前会话单主线，无子代理，未切换模型或配置，费用未采集。


## 2026-09-28 · 原生补验与 1.6.2 收尾

用户要求“继续完成后续工作以及收尾”。从 `main` 的 `64fdcef05d93bb1834430c38c0b761b54170d5c8` 继续；保留无关未跟踪 `.claude/` 与 `docs/ui/batch-mock.js`，不推送远程。默认开发 identity 不变，正式 override 版本升至 1.6.2，schema 仍为 18。

- 隔离构建：`.local/icon-expansion.conf.json`，identifier `local.possio.icon.expansion.acceptance`，窗口 1280×840。仅该身份填写虚构资料，AX 操作检查前台和窗口存在，不向其他应用输入。
- 原生验收：家电分类显示全部新增家电，搜索“滚筒”找到洗衣机；应用后保存“虚构大件图标验收洗衣机”，完整档案出现一张洗衣机封面；退出重开后同一名称与洗衣机缩略图仍可见。截图：[选择器](icon-expansion/native-picker.png)、[重开](icon-expansion/native-reopened.png)；控件证据：[保存](icon-expansion/native-saved.txt)、[重开](icon-expansion/native-reopened.txt)。本轮原生补验弥补首轮浏览器截图失败与持久性证据缺口；未重复全产品 GUI 回归。
- 发布检查：Rust 全套 164/164、UI 100/100、样例 2/2；既有 `npm run check` 通过，最终 `npm run release` 再次完成 TypeScript/Vite 与 release App 构建。首次沙盒全套回归在维护照片测试报 `IMAGE_CORRUPT`，相同测试在允许 macOS ImageIO 的环境全套重跑通过，未改业务代码。
- 正式产物：`src-tauri/target/release/bundle/macos/物志.app`；Info.plist 为 `local.possio.main` / `1.6.2`，`codesign --verify --deep --strict` 通过，沿用本地 ad-hoc 签名，未公证。
- 主程序 SHA-256：`a4145446646699f3384f9cc38a6dccfc0c1c60c47e8c8ecacbaf3525a5b32f08`。副本 `.local/install/物志-1.6.2.app` 哈希一致；旧 `.local/install/物志-1.6.1.app` 已保留。
- 安装状态：用户确认“已退出，完成安装和收尾工作”后，复核正式进程已退出，已将 1.6.2 安装至 `/Applications/物志.app`。替换前验证 1.6.1 备份与旧主程序一致；新包先复制到同卷临时目录并校验，再替换应用。安装后版本 `1.6.2`、identity `local.possio.main`、严格签名、主程序 SHA-256 与整个包的逐文件哈希均与已验收安装包一致；临时安装目录已清理。没有启动正式应用或读取正式资料库，schema 不变。隔离验收 App 已退出，先前浏览器空间与开发服务已关闭。实现提交为 `9fb381c`，本轮仅更新安装记录，未推送。
