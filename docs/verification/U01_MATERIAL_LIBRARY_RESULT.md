# U01 内置素材库验证记录

日期：2026-09-25。执行：Z code（GLM-5.3 主实现，单执行者串行；未启用子代理/Hermes/其他执行器，未统计 Token 费用）。

## 0. Codex review 修复（2026-09-25，起点 10d79c9）

用户授权修复 review 的三项 P2。以下是最新结果，后续原交付章节保留为历史；不将历史的“无已知缺陷”或旧测试数量作为修复证据。

- 上传：前端在打开文件选择器前持久保存操作 UUID 和 generation；操作 UUID 同时作为素材行 ID。后端在打开选择器/读取原文件前查已保存行，重试返回同一素材。响应丢失先经串行 worker 调用 `material_upload_result`；核对也失败则保留原 ID、冻结新上传与删除，跨页面/重开可继续核对；确认未写入后才开放新上传。保留 schema 9，无新迁移；资料切换后不把旧请求发送至新资料。此机制用于上传结果核对，不是永久删除素材后的历史审计协议。
- 缩略图：加载、成功、读取/解码失败分别显示；失败有“重试”，失败时不能盲选；重试按钮与选图按钮是同级元素，没有嵌套按钮。
- 辅助功能：列表项角色移到外层，八个素材恢复原生 button 语义；新隔离包的无障碍树已确认八个 button。

### 修复后的实际检查

完整命令链 exit 0：`npm run test:ui` **45 项**、`npm test` **58 项**、`npm run test:demo` **2 项**、`npm run check`、`npm run build`、`npm run tauri -- build --debug --config .local/t06b.conf.json --bundles app`；`git diff --check` 通过。新增两项 Rust 故障测试和四项前端恢复测试。

Rust 实测：提交后故障 → 重开 → 删除测试源文件 → 原 ID 查询/重试仍仅一条素材且图片可读；提交前故障无素材行，可核对为空后重试；未知 ID/旧 generation 拒绝。既有 schema、备份和 Demo 回归通过。

Ego Lite 实测：注入 `material_preview` 失败后显示八个失败状态、八个选图按钮禁用；恢复服务并点键盘“重试”后该图片恢复、按钮可用。注入上传已成功但响应丢失 + 首次核对不可用：上传按钮禁用、原操作 ID 存在 localStorage；离开再进入素材库后核对成功，卡片总数从八变九，上传调用次数保持一，待核对记录清除。均为内存故障复现，不冒充原生文件选择器实测。

### 原生证据与边界

前一轮 Codex review 已实际创建 `U01 Review Fictional Keyboard`，ID `bec3ab74-fb58-4837-a405-a6ec53f7bbee`：键盘素材保存 → 编辑追加平板 → 显式切封面 → 退出重开通过；revision 2、两张图、平板封面保持，`integrity_check=ok`。虚构库现十一件，保留该记录。

本轮已重新构建、退出旧实例并启动新包，十一件资料正常加载；新增表单八个素材在原生无障碍树中均为 button。未新增原生资产、未删除任何记录。三项 review 问题的针对性修复与复测通过；原生自定义上传完整流程、草稿重启恢复及原 T09 缺口仍须补验，不因此宣布整个分支可集成，T10 继续暂停。

---

## 1. 起点、范围与中途调整

- 工作目录：`/Users/jackzhu/Documents/Codex/2026-09-24/referenced-chatgpt-conversation-this-is-an/outputs/Possio-t06b`，分支 `codex/t06b-taxonomy-storage`。
- 起点 HEAD：`8da3d2ab5288895afecd201468c96c9e4c8d67eb`（纯文档交接提交；代码基线 `9e60799` 为其祖先）。实现提交：`318abb0cd2b238086f1c76efc61365e936229211`；本报告提交后的最终 HEAD 以交回信息为准。
- 按交接契约完成首轮实现（八种内置素材 + `prepare_material` + 表单展开式网格）后，**用户中途调整**（对话原话要点）：① 侧栏“资料管理”在“最近删除”“设置”之上新增**素材库**页面，可上传自己的素材，也包含内置素材；② 新增资产“封面与图片”简化为**平铺小图列表直选，小图不含任何文字**。本报告描述的是调整后的最终形态；权威章节（产品设计 D13、UI 设计 U01、功能规格 U01 补充验收、ADR-001 第 6 节）已按“最新用户决定优先”同步更新。
- 关键实现决定：
  - 素材清单（稳定 ID + 中文名）单一来源 `src-tauri/materials/materials.json`；PNG 原图由 `docs/ui/demo-photos/` `git mv` 至 `src-tauri/materials/`（保留历史），渲染脚本、Demo 导入 example 复用同一白名单，不维护两套图。
  - 用户上传素材持久化采用 **schema 9** 新表 `materials`（id、名称、哈希、大小、创建时间），字节存入既有内容寻址 `files/<sha256>` 仓；备份打包 attachments 与 materials 引用的全部文件并校验。此为用户中途要求引入的真实 schema 变更（交接契约原定“无需迁移”），已按“最新用户决定优先”落实并在迁移 8→9 上有原子性与保留性测试；未改 request_id/revision/generation/草稿/回执协议。
  - 表单封面区为纯小图平铺（aria 标签保留素材名与示意图身份，满足可访问性而不在图上显示文字）；点击即经 `prepare_material` 暂存并加入集合，第一张在空集合时设为封面，后续追加；失败保留输入、平铺小图即重试入口，明确取消后方可保存。
  - 上传走原生 NSOpenPanel → worker 校验（格式、20 MiB、可生成预览）→ 先落盘后入库；删除仅移除目录条目，不影响已保存资产；内置素材不可删除。

## 2. 受影响文件

代码：`src-tauri/src/materials.rs`（新增）、`src-tauri/src/{commands,lib,photos,storage,backup}.rs`、`src-tauri/examples/import_demo.rs`、`src-tauri/tests/{materials.rs(新增),photos.rs}`、`src/materials.ts`（新增）、`src/MaterialLibrary.tsx`（新增）、`src/{AssetEditor.tsx,main.tsx,style.css,visual-preview.ts}`、`scripts/render-demo-art.mjs`、`src-tauri/materials/materials.json`（新增）及 8 张 PNG（git mv）、`tests/materials.test.mjs`（新增）。
文档：AGENTS.md、README.md、PRODUCT_DESIGN（D13/第 10 节）、UI_DESIGN（U01）、FUNCTIONAL_SPEC（U01 补充验收）、ADR-001（第 6 节）、IMPLEMENTATION_PLAN、VISUAL_ALIGNMENT、本记录。
截图：`docs/verification/u01-material/`（浏览器 5 张）。

## 3. 命令与退出码（在实现提交 318abb0 上实际执行）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npm run test:ui` | 0 | 41 项通过（基线 36 + 素材 5，含目录与 JSON/PNG 同步、D13 名称、aria 标签） |
| `npm test` | 0 | 56 项通过（基线 50 + 素材 6：白名单/未知与穿越 ID 拒绝、独立暂存与提交、重开、备份恢复含自定义素材、上传/删除/拒绝、schema 8→9 迁移） |
| `npm run test:demo` | 0 | 2 项通过（Demo 导入改用素材白名单后不变） |
| `npm run check` | 0 | fmt + clippy（fault-injection，-D warnings）通过 |
| `npm run build` | 0 | tsc + vite 构建通过 |
| `npm run tauri -- build --debug --config .local/t06b.conf.json --bundles app` | 0 | 隔离验收包重建成功（标识/数据根未改） |
| `git diff --check` | 0 | 无空白问题 |

基线复核（起点 8da3d2a）：前端 36、Rust 50、Demo 2 通过后才开工。

## 4. U01 验收逐项

| 编号 | 结果 | 证据 |
|---|---|---|
| U01-01 | 自动+浏览器通过；**原生 GUI 未验** | 默认平铺小图、八种原图+自定义、小图无文字、不打开系统选择器、不带入 Demo 业务数据、仅名称可保存（浏览器实测 + Rust 测试） |
| U01-02 | 自动+浏览器通过；**原生 GUI 未验** | 空集合第一张成封面、追加不覆盖、显式换封面、移除即撤销、20 张上限沿用（浏览器实测 + `material_selections_stage_independently_and_commit_per_asset`） |
| U01-03 | 自动通过；**原生 GUI 未验** | 同 ID 编辑、金额/分类不被改写、重开与备份恢复保留图片与封面（Rust 测试）；重复保存幂等由既有回执机制覆盖 |
| U01-04 | 自动+浏览器通过；**原生重启恢复未验** | 选图进草稿与 dirty、失败保留输入、平铺小图即重试、明确取消后可保存、pending 冻结（浏览器实测 + 既有回执测试）；草稿 localStorage 写入实测，重载恢复为原生未验项 |
| U01-05 | 自动+浏览器通过；**原生 GUI 未验** | 旧照片显示/预览/修复机制未改动（Rust 既有回归通过）；缺图兜底不变；同素材多资产独立关联、共享字节按哈希复用（Rust 测试）；素材库上传/删除与备份恢复（Rust 测试 + 浏览器 mock 流程）；扩展只增清单/资源 |

软删除恢复与异常提交：既有自动测试覆盖（trash/save 回执系列），本轮未破坏。

## 5. 浏览器证据（visual-preview.html，代码 HEAD 318abb0）

| 场景 | 结果 | 截图 |
|---|---|---|
| 浅色 1080×760 表单平铺小图 + 已选键盘（自动封面） | 通过 | `u01-material/browser-form-light-1080.png` |
| 深色 1080×760 表单（对比度、无溢出，doc/grid 溢出检查 0） | 通过 | `u01-material/browser-form-dark-1080.png` |
| 浅色 800×600（无横向溢出，可保存） | 通过 | `u01-material/browser-form-light-800.png` |
| 素材准备失败错误态（保存禁用、明确取消按钮） | 通过 | `u01-material/browser-error-light-1080.png` |
| 素材库页面上传→两步删除（8 内置恢复） | 通过 | `u01-material/browser-library-light-800.png` |

交互实测（无截图）：点击小图直选、追加第二张不覆盖封面、显式“设为封面/移除”、ESC 脏状态走关闭保护/干净状态直接关闭、仅名称保存成功、保存后详情封面正确且未带入业务字段、aria/键盘 Tab 可达。说明：浏览器为内存 mock，不能证明原生持久性。

## 6. 原生证据与未验项

**已验（真实隔离库，非 UI 自动化）**：退出旧实例（Apple quit 事件）→ 以最终构建启动 → 真实数据集 `0a0e28f8-0b00-4f4a-9d05-9c1da9650abe` 由 schema 8 迁移至 9；只读核对 `user_version=9`、资产 10 件、附件 9 条、`files/` 9 个原图俱在、`materials` 表存在（0 行）、`integrity_check=ok`；随后正常退出。

**未验（本会话原生 GUI 工具不可用，如实列出，不伪称通过）**：
- 新增资产选键盘素材 → 保存 → 编辑追加平板/切封面 → 退出重开核对的 GUI 全流程；
- 只填名称、取消选择的 GUI 流程；草稿重启恢复（kill 后重启出现“恢复草稿”）；
- 已有照片在 GUI 中继续可读的目视核对；
- 素材库页面上传/删除的原生 NSOpenPanel 交互；
- 原生窗口截图（屏幕录制权限同样被拒）。

原因：本会话 node_repl 未启用 Computer Use 能力（browser-use 插件会话），osascript 辅助访问被 macOS 拒绝（-25211），screencapture 被拒。上述路径由临时库自动测试覆盖同等逻辑（第 4 节），但**不能替代原生 GUI 验收**，需 Codex 在可用环境补验。

T09 已登记的原生缺口不受本轮影响（图片修复/错误恢复路径未改动）。

## 7. 进程、窗口与库状态（交回时）

- 隔离 App 已正常退出，无残留进程；未运行 `demo:import`，虚构库未重置、未新增记录（迁移仅升级 schema）。
- vite dev server（1429 端口）仍在后台运行，可随时停止。
- 本地分支两个新提交（实现 + 本报告），未合并、未推送、未发布；T10 未推进。
