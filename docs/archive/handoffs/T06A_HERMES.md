# T06a：Hermes 分类与渠道界面交接

日期：2026-09-24。任务状态唯一来源：[实施计划](../../IMPLEMENTATION_PLAN.md)。本文件是执行契约；交付结果由执行者另填，不把准备完成当作实现完成。

## 本次返修说明

2026-09-24 用户已要求按审查建议执行下一步。Codex 在独立分支 `codex/t06a-review-fixes` 承接返修，原 Hermes 目录保留。上述模型选择与原工作目录约束仅针对最初的 Hermes 执行，不阻止本次用户授权的返修。实际位置、结果与未验项见 [返修报告](../../verification/T06A_HANDOFF_RESULT.md)。

## 1. 目标与执行位置

交付可复用的分类/购买渠道管理界面、选择字段和分类筛选组件，沿用 A「静序」。用独立内存预览证明交互，随后由 Codex 接入 SQLite、Tauri 和现有资产页面。这是首次协作试运行，不是重做 App 或完成整个 T06。

仅在以下独立 worktree 工作：

`/Users/jackzhu/Documents/Codex/2026-09-24/referenced-chatgpt-conversation-this-is-an/outputs/Possio-t06a`

分支：`hermes/t06a-taxonomy-ui`。开始时记录 `pwd`、`git branch --show-current`、`git rev-parse HEAD` 和 `git status --short`。若路径/分支不符，停止写入并报告；保留已有用户改动。主仓库是 `/Users/jackzhu/Code/Own/Possio`，不得在那里实现、合并或切换分支。

本次由用户在 Hermes 中发起执行。建议该会话选择已有 MiniMax 主模型；若实际仍为 GPT/Codex，先报告实际路由，等待用户在会话中切换。不要更改全局配置、启动 MoA、并发子 Agent 或后台循环。不要假定工具内的委派模型就是当前会话主模型。

## 2. 必读资料与权威

按顺序读根目录 [AGENTS](../../../AGENTS.md)、[README](../../../README.md)，然后本文件。按需读下列原有章节，不复制全部聊天：

- [产品设计](../../PRODUCT_DESIGN.md)：第 10 节分类/渠道；资产字段与中文、自用、人民币边界。
- [功能规格](../../FUNCTIONAL_SPEC.md)：输入/失败契约、键盘焦点、AC37，以及 AC05/06 的相关交互要求。
- [UI 设计](../../UI_DESIGN.md)：A「静序」，安静、清楚、操作顺手；B 只作历史记录。
- [技术设计](../../decisions/001-local-desktop.md)：稳定 ID、引用迁移、软删除关系和存储边界。
- 只读参考现有 `src/style.css` 和现有表单的视觉/焦点方式，不更改生产入口来展示新组件。

若发现业务规则冲突，报告原文位置与建议，不擅自扩大范围。

## 3. 允许文件与交付结构

仅允许新增下列文件；无必要时可少建，超出清单先报告原因：

| 文件 | 职责 |
|---|---|
| `src/taxonomy.ts` | 本文约定的界面类型；确有需要的纯展示辅助函数 |
| `src/TaxonomyManager.tsx` | 分类/渠道管理界面与确认交互 |
| `src/TaxonomyFields.tsx` | 分类选择、渠道选择、分类筛选三个可复用受控组件 |
| `src/taxonomy.css` | 以 taxonomy- 为前缀的局部样式，复用现有色彩变量 |
| `src/t06-preview.tsx` | 虚构数据、内存适配器、状态场景及组件演示 |
| `t06-preview.html` | 独立 Vite 开发预览入口，清楚标注“虚构样例，不写入真实资料” |
| `tests/taxonomy.test.mjs` | 有实际辅助逻辑时补独立预期的边界测试；不要为凑数量测试常量 |
| `docs/verification/T06A_HANDOFF_RESULT.md` | 最终交接报告，格式见第 7 节 |

不得修改 Rust/数据库/迁移、`src/main.tsx`、现有资产表单/类型、`src/style.css`、包和锁文件、Vite/Tauri 配置、产品规格、实施状态或 AGENTS。不新增依赖，不改全局环境，不访问 App 的真实 library，不调用 Tauri 写入，不以 localStorage 冒充正式持久化。预览只存内存，刷新重置。

按小增量实现：先类型/管理组件，再字段/预览，再验证/修正。最终以完整交付为准，不为控制文件数删验收。

## 4. 界面契约

在 `taxonomy.ts` 导出以下类型；可增加组件内部类型，不替换这些公共名称和语义：

```ts
export type TaxonomyKind = "category" | "channel";
export type CategoryIcon = "box" | "computer" | "phone" | "camera" | "audio" | "home";
export interface TaxonomyEntry {
  id: string;
  name: string;
  icon?: CategoryIcon; // 仅分类使用
  references: { activeAssets: number; deletedAssets: number };
}
export interface TaxonomySnapshot {
  categories: readonly TaxonomyEntry[]; // 数组顺序即显示顺序
  channels: readonly TaxonomyEntry[];
}
export type TaxonomyCommand =
  | { type: "create"; kind: TaxonomyKind; name: string; icon?: CategoryIcon }
  | { type: "rename"; kind: TaxonomyKind; id: string; name: string }
  | { type: "set-icon"; id: string; icon: CategoryIcon }
  | { type: "move-category"; id: string; direction: "up" | "down" }
  | { type: "remove"; kind: TaxonomyKind; id: string; targetId: string | null };
export type CommandResult =
  | { status: "success" }
  | { status: "error"; message: string; recovery: "retry" | "reload" };
export interface TaxonomyManagerProps {
  snapshot: TaxonomySnapshot | null;
  loading: boolean;
  loadError: string | null;
  // 成功读回才 resolve，失败必须 reject；重载时保留旧 snapshot。
  onReload: () => Promise<void>;
  validateName: (kind: TaxonomyKind, name: string, editingId?: string) => string | null;
  onCommand: (command: TaxonomyCommand) => Promise<CommandResult>;
}
```

组件默认导出 `TaxonomyManager`。父组件拥有唯一数据源；成功前由父组件更新 snapshot，然后返回 success。组件不保存第二份实体列表，仅保存交互草稿。写入排队、revision、generation、幂等回执及真实引用查询由未来 Codex 适配器负责，本次不能另造后端协议。

管理组件对每次操作等待结果，防重复提交；仅 success 清空对应草稿。error 显示消息并保留输入。recovery=reload 或意外 Promise rejection 时显示“结果待核对”，阻止再次变更，允许重新加载；重载成功解除阻止但保留草稿供用户核对，不自动重放旧操作。重载失败继续保留输入和阻止状态。

`TaxonomyFields.tsx` 命名导出：
- `CategorySelect`、`ChannelSelect`：props 为 `{ entries: readonly TaxonomyEntry[]; value: string | null; onChange: (id: string | null) => void; disabled?: boolean; id: string }`。可访问名称分别是“分类”“购买渠道”；null 显示“未分类”“未记录”。
- `CategoryFilter`：props 为 `{ entries: readonly TaxonomyEntry[]; value: { mode: "all" } | { mode: "uncategorized" } | { mode: "category"; id: string }; onChange: (value: 同一联合类型) => void; disabled?: boolean; id: string }`。请导出该联合类型为 `CategoryFilterValue`，代码中使用它替代这里的中文说明。
- “全部分类”和“未分类”是不同选项。未知/已移除 ID 要显式提示“选项已不可用”，不能静默选择第一项或触发 onChange。

校验通过 validateName 注入，最终前后端同源规则在 T06b 冻结。本次内存演示策略：trim + Unicode NFC 后判空、按同一类型名称不区分 ASCII 大小写判重，改名排除自身；不擅定生产长度上限。跨类型同名允许。未分类/未记录是 null 的界面标签，不创建实体来代替它们；演示适配器拒绝各自同名实体。这个演示策略不是已验收的数据库约束。

## 5. 必须能演示的交互

1. 分类/渠道切换；空白、加载、加载失败/重试与正常列表。创建、改名保留 ID，分类图标用上述固定单色符号并有中文标签，排序有键盘可用的上移/下移按钮，首尾禁用对应按钮。
2. 移除前确认：显示普通资产与最近删除资产的引用数量；先明确选择其他同类目标或 null（未分类/未记录），允许取消。目标不能是自身，不预先替用户选择迁移目的地。无引用也需要确认。内存适配器用虚构引用记录模拟迁移并重新计算数量，展示迁移后的引用核对。移除分类/渠道不删除资产。
3. 管理与三个字段组件共用同一 snapshot；改名后选中值仍是同 ID；删除后预览父组件根据迁移结果显式调整选中值，组件本身不偷改选择。心愿尚未实现，不声称心愿引用已验。
4. 可控演示：延迟提交、写入失败、需要重载核对；失败不清空输入，忙时不重复执行。恢复正常后可继续；切换页签不静默丢弃未提交草稿（保留或显式确认）。
5. 与 A 一致：复用 --bg、--card、--text、--muted、--line、--accent 等现有变量；深浅色可检查，无大型渐变/营销卡片。900px 与 1280px 宽度下内容、长名称、错误消息不遮挡动作。
6. 所有字段有 label，图标按钮有名称，错误可被辅助技术读出；Tab 顺序清楚，确认对话框焦点限制在内部，Escape 可取消，关闭后回到触发按钮。忙时不把已执行操作当作可撤销。只用虚构样例。

## 6. 实施和验证

使用当前 package.json 的命令；依赖未装时可在本 worktree `npm ci`，不得改锁文件。必须运行 `npm run build` 和 `npm run test:ui`。这只证明类型/构建及现有纯逻辑回归，不能写作 UI 点击测试通过。

独立预览可用 `npm run dev -- --port 1426`，打开 `http://127.0.0.1:1426/t06-preview.html`。不占现有原生预览的 1420 端口，不启动 Tauri。不改构建入口把预览打入正式 App。

逐项实际操作第 5 节，用截图或明确观察记录位置、操作、结果。无法操作浏览器时诚实列“未实测”，交回 Codex 补验，不编造证据。可用浏览器工具按本机规则使用；不新增工具/测试依赖来绕过限制。临时日志/截图存 `.local/t06a/`，报告列绝对路径，不提交庞大产物。

提交前检查 `git diff --check` 和具体差异，仅显式暂存允许文件；不得 git add .、合并 main、推送或发布。不修改现有测试来掩盖回归。仅前端任务无需为形式运行整套 Rust 故障实验；发现相关风险再报告。只终止自己启动的预览进程。

## 7. 完工报告与停止点

新增 `docs/verification/T06A_HANDOFF_RESULT.md`，包含：

- 工作目录、分支、开始时基线 SHA；实现与报告按主题本地提交，最后的聊天输出给出最终 HEAD（不要把最终 SHA 写进自身提交形成循环）。
- 修改文件和职责；逐项对照第 5 节，标明“实测通过 / 失败 / 未测”，写操作与证据，不能只填“完成”。
- 实际执行的命令、退出码、结果；截图/日志绝对路径；预览进程是否已停止。
- 已知限制、未完成项、是否有越界修改（正常应为无）。
- Codex 接入提示：公共组件/类型、父组件要提供的回调、哪些行为仅为内存演示。
- 明确写：没有接入生产资产页、没有数据库迁移、没有验证真实软删除引用事务；完整 T06/AC37 尚未通过，心愿关系在 T12 补验。

完成后停止，不自动推进 T06b、T07 或修改主仓库。最终给用户一段可转交 Codex 的摘要，附工作目录、分支、基线 SHA、最终 HEAD、报告绝对路径与未测项。Codex 将审查实际 diff 并复验，随后再决定接入，不凭摘要直接合并。
