# U01：Z code 内置素材库实施交接

日期：2026-09-25。状态：文档准备完成，应用未实现，执行器未启动。用户明确要求先给文档和 Prompt，由 Z code 执行，再交回 Codex review。任务状态只在 [实施计划](../../IMPLEMENTATION_PLAN.md) 维护。

## 1. 唯一工作位置与起点

- 目录：`/Users/jackzhu/Documents/Codex/2026-09-24/referenced-chatgpt-conversation-this-is-an/outputs/Possio-t06b`
- 分支：`codex/t06b-taxonomy-storage`。
- 应用代码基线：`9e6079954466f5ae96a352fc247f6d3666b7c442`。本交接随后有一个纯文档提交；执行时记录实际 HEAD，并确认该基线是祖先，不将 HEAD 强制 reset 到它。
- **不要使用 `/Users/jackzhu/Code/Own/Possio` 的落后 main，不从 main 建树。** 先核对 pwd、branch、HEAD、status；未知改动保留并查明来源，不覆盖、不 clean、不 reset。
- 本轮允许实现、必要测试、文档更新、当前分支本地提交。用户自己启动 Z code；不开 Hermes、后台循环、多 Agent，不推送/合并/发布，不继续 T10。

## 2. 目标与最少阅读

目标：新增资产默认点“从素材库选择”，无需寻找或上传文件；可选八种原始 Demo 图，正式离线 App 可用且随资料持久保存。编辑已有资产也可使用；旧照片、附件、维护凭证和缺图修复保持兼容。素材不等于自动导入八件 Demo 资产。

按序局部读取：
1. `AGENTS.md`、`README.md` 当前状态与运行命令。
2. `docs/IMPLEMENTATION_PLAN.md` 状态表和第 7.4 节。
3. `docs/PRODUCT_DESIGN.md` 第 10 节、15.2 的 D13；`docs/FUNCTIONAL_SPEC.md` 输入图片行、F01 与 U01 补充验收。
4. `docs/UI_DESIGN.md` 当前还原基线和 U01；`docs/decisions/001-local-desktop.md` 第 6 节。
5. `docs/verification/VISUAL_ALIGNMENT.md` 开头最新补充；`docs/verification/T09_MAINTENANCE_RESULT.md` 仅当前剩余缺口，必要时查原生启动说明。

不加载全部历史文档/聊天。现有图片原本就是可选，本次改变主选择入口，不是取消一个原本必填的字段。业务与视觉契约以以上权威章节为准。

## 3. 实施切片与代码入口

先核对实际代码，再串行完成：素材目录及受控后端准备 → 表单接入和预览适配 → 验证/必要修复/交回。不需要新依赖、数据库迁移或重构全局状态。

| 区域 | 起点与修改边界 |
|---|---|
| 原图 | `src/illustrations.ts` 的 objectArt：laptop/camera/headphones/phone/tablet/keyboard/coffee/box；`docs/ui/demo-photos/*.png` 为已转换原图，`scripts/render-demo-art.mjs` 可复现。不得重画、网络取图或生成新风格 |
| 素材目录 | 新增生产可用清单（稳定 ID、中文名、图资源映射），与 `src/demo-assets.json` 的虚构业务资料解耦。允许将 PNG 移到合适的生产资源目录；同步渲染脚本、`src-tauri/examples/import_demo.rs` 及文档引用，不同时维护两套图 |
| 表单 | `src/AssetEditor.tsx`：Draft、media、dirty、pickPhoto、save、resolvePending、askClose。新增素材区及局部样式/组件，继续使用现有 draftKey。保存素材选择和已托管 Photo，兼容缺少新字段的旧草稿；pending/busy 均不可改选 |
| 后端 | `src-tauri/src/commands.rs` 的 pick_photo 和 worker 调用方式；`photos.rs` 的 stage_photo、Selection；`lib.rs` 命令注册。新增受控 material ID 准备命令，禁止任意路径/URL；成功返回既有 Photo，save_asset/Selection 契约不变 |
| 展示 | `src/Photos.tsx` 的 Cover/PhotoView：已选封面优先，原分类图只作无封面兜底；已有照片丢失必须继续显示修复提示，不用素材掩盖 |
| 浏览器 | `src/visual-preview.ts` 的 IPC mock 增加对应命令，可演示选择/失败但不能代替原生托管；正式包只含素材，不导入 Demo 资产 JSON 或业务 fixture |
| 检查 | `tests/`、`src-tauri/tests/` 与导入 example 测试。更新受影响断言和新增实质行为测试，不删旧回归以求通过 |

### 交互和数据细节

- 素材网格默认八种、中文标签，通用物品不要声称具有录音设备外观；素材 ID 不是分类 ID，平板、手机和键盘必须可独立选，分类不会覆盖已选图。
- 先浏览候选，点击“添加所选素材”才准备并加入表单；准备期间禁止重复点击。取消不变更原图列表，第一张在空集合时设为封面，后续追加为附件；保留显式设封面/移除，最多 20 张。
- 素材选择不得填入名称、品牌、型号、金额、分类或历史事件。上传文件保留为次要入口，维护图片表单不强制改成素材库。
- Rust 从白名单取得随 App 打包的 PNG，经原 worker 暂存并托管，校验 generation、有效 ID、图片限制；不用开发目录绝对路径，不接收客户端任意字节/文件路径作为“素材”。空白/未知/路径穿越 ID 必须拒绝且不写资产。
- 素材选择进入原草稿/dirty 判断；取消表单不产生资产关系，允许原协议下可诊断的暂存残留，不自行实现垃圾回收。图片名称/替代文字明确“示意图，非实物照片”。
- 图准备失败保留输入及旧照片；素材失败的重试回素材准备，不误开系统文件选择器。用户明确取消失败选图后方可继续；成功保存只使用已准备的 ID。localStorage 失败提示与响应丢失处理不得退化。
- 保存依旧持久化完整原请求并使用原回执核对；不可为“重试素材”重建资产请求或把 pending 当成功。旧 generation、旧 revision、防双击、关闭保护沿用。
- 选择同种图供多个资产使用时各自关系独立，不能共用另一个资产的 photo ID；已有字节按哈希复用可接受。素材扩展只增加清单/资源，旧 ID 与内容保持稳定，已有托管档案不随目录更新而变图。
- 不需要自动修复缺失的旧原图，也不需要网络素材下载、素材管理后台、自定义素材包、分类重设计或 T10。发现必须修改 schema/备份/回执协议时，先记录原因与备选方案交回 Codex，不在此契约下自行扩大范围。

## 4. 验证与证据

起点证据为前端 36、Rust 50、导入 example 2 项通过，仅作基线。修改后必须实际跑：

```sh
npm run test:ui
npm test
npm run test:demo
npm run check
npm run build
npm run tauri -- build --debug --config .local/t06b.conf.json --bundles app
git diff --check
```

最终本地提交后重新核对 HEAD/status，并在该 HEAD 上执行上述检查，记录退出码与真实结果，不能把旧日志当交回证据。提交后检查如导致修复，创建修复提交并验证最新 HEAD。

重点测试：U01-01–05 全部逐项报告。覆盖正常、取消、未知 ID/旧 generation、托管失败、重复点击、保存响应丢失、草稿恢复、旧照片不变、共享素材不同资产独立关联。持久化/恢复/备份使用临时库自动测试；不拿实现本身生成的预期值作唯一断言。

原生包：`src-tauri/target/debug/bundle/macos/Possio T06b Preview.app`，标识 `local.possio.t06b.preview`。已有 `.local/t06b.conf.json`，不要改标识/数据根。只用隔离虚构库 `~/Library/Application Support/local.possio.t06b.preview/library`；读取 active.json 取当前 dataset，不硬编码历史 ID。保留现有十件样例，不要重置库或反复导入 Demo。

原生实际走：新增虚构资产选键盘素材 → 保存 → 编辑追加平板/切封面 → 退出重开 → 核对同一资产、图片及封面；另验只填名称、取消选择、保留草稿重启恢复、已有照片继续可读。软删除恢复和异常提交至少有自动测试，原生未执行项单列。不要修改系统日期或写真实库，不提交数据库/备份/凭据。

在 1080×760 及最小 800×600、浅/深主题检查表单和素材区：不横向溢出，焦点/ESC/取消正确，背景不可并行操作。正常图片和错误态各留小型截图，注明浏览器还是原生、实际窗口尺寸和代码 HEAD。浏览器工具按当前环境 AGENTS/Skill；GUI 即时确认规则照做，不绕过拒绝或直接改库冒充操作。工具不可用可完成其余部分，交回明确原生缺口，不伪称全部通过。

## 5. 模型、交回与停止点

用户在 Z code 选 GLM5.3 作为单一主执行者；GLM5.3Flash 可手动用于文档或机械核对，不自动多模型并发。本轮不要求统计 Token/费用，但软件费用完整性必须正确。模型能力没有在本次准备中实测，不承诺成本或质量比例。

新增 `docs/verification/U01_MATERIAL_LIBRARY_RESULT.md`，写清起点/最终 SHA、实际模型、变更/关键决定、受影响文件、命令及退出码、每项 U01 通过/失败/未验、浏览器和原生证据、现有 T09 缺口是否受影响、进程/窗口/库状态。不要复制另一套计划。更新 README 和实施计划为“实现已交回，待 Codex review/必要补验”，不要自行宣布最终验收或可集成。

审阅 diff，仅提交本任务文件。完成后停止，不开始 T10。交回格式：

```text
请 review Possio U01 素材库。
工作目录：<本文件指定绝对路径>
分支：codex/t06b-taxonomy-storage
起点 HEAD：<实际 SHA>
最终 HEAD：<提交后实际 SHA>
报告：<U01_MATERIAL_LIBRARY_RESULT.md 绝对路径>
实际模型：<Z code 实际选用模型>
提交后检查：<命令/结果>
原生已验与未验：<分别列出>
已知问题及当前进程/库状态：<实际状态>
```

## 6. 可直接输入 Z code 的 Prompt

```text
请实现 Possio U01“内置素材库选择”，完成后停下交回 Codex review。

直接使用工作目录：
/Users/jackzhu/Documents/Codex/2026-09-24/referenced-chatgpt-conversation-this-is-an/outputs/Possio-t06b
预期分支 codex/t06b-taxonomy-storage。先核对 cwd、分支、HEAD、git status；不要使用落后的 main、创建新工作树或 reset 当前提交。

先读 AGENTS.md、README.md，然后完整读取 docs/handoffs/U01_MATERIAL_LIBRARY_ZCODE.md，并按其中最少阅读顺序、范围、数据契约和验收执行。业务目标是新增/编辑默认从八种原始 Demo 素材选择封面与图片，无需上传；正式离线 App 可用且持久保存，可不选图片。复用现有托管、草稿、回执和照片兼容机制，不重画、不引入 Demo 业务资料、不推进 T10。

请用当前 GLM5.3 串行实现，不启动子代理/Hermes/其他执行器，不改全局配置。不要求统计 Token 费用。已授权本任务代码、必要测试、文档和当前分支本地提交；不推送、合并或发布。依赖即时确认的具体 GUI 操作按工具规则处理，其余直接推进。

完成后创建本地提交，在最终 HEAD 重新执行交接文档的完整检查，将真实结果与原生未验项写入 docs/verification/U01_MATERIAL_LIBRARY_RESULT.md，按交回模板给出最终 SHA。没有执行的验收明确写未验，不能用浏览器内存验证替代原生持久性。遇到必须改变 schema/恢复协议或同一根因两轮修复失败时，带证据交回 Codex，不无限尝试。
```
