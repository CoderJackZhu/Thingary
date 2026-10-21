# 手机界面开发约定

给在 `src/mobile/` 里加页面的模块任务。手机界面只重写布局；业务逻辑、IPC 命令、`src/*.ts` 的数据层与计算原样复用，不复制、不改写。范围与设计稿见 [ARCHITECTURE「手机界面」](../../docs/ARCHITECTURE.md) 和 [docs/design/mobile](../../docs/design/mobile/README.md)。

## 目录与归属

| 路径 | 归属 |
|---|---|
| `src/mobile/<模块>/` | 该模块任务（`items`、`wealth`、`spending`、`plan`、`me`、`home`） |
| `tests/mobile-<模块>-*.test.mjs` | 该模块任务 |
| `src/mobile/ui/`、`routes.ts` 的框架部分、`nav*.ts`、`MobileApp.tsx`、`mobile.css`、`preview.ts` | 地基，模块任务不改 |
| `src/mobile/routes.ts` 中自己模块的那几行 | 该模块任务 |

缺共用组件时先在自己的模块目录里写，需要提升为共用再向地基提出。不要改 `theme.css`；需要新令牌向地基提出（令牌以 `--m-` 开头，定义在 `mobile.css`，由 `theme.css` 派生）。颜色和字体只用令牌，浅色与深色都要看。

`model.ts` 与 `service.ts` 是 PR #9 的盘点读取与保存逻辑（有测试），`wealth/Legacy*.tsx` 是临时挂载的旧页面，由财富任务替换。

## 注册路由

在 `src/mobile/routes.ts` 的 `routes` 里，每条路由一行；占位页在登记时已存在，替换时给自己的行加 `load`：

```ts
'items.detail': { tab: 'items', title: '物品详情', design: '04', load: () => import('./items/ItemDetail') },
```

字段：`tab`（所属标签）、`kind`（`page` 默认，或 `modal`、`sheet`）、`title`（也是下一页返回按钮上的文字）、`design`（设计稿编号）、`load`（懒加载，模块 `default` 导出组件，接收 `{ params }`）、`fullscreen`（隐藏标签栏，仅首次打开）。路由名已全部预留；确需新增路由名才加一行，并在对应测试里补充。

标签与顶部分段在同一文件的 `tabs` 里：物品「物品 / 心愿 / 统计」、财富「概览 / 账户 / 盘点记录」、规划「目标 / 测算详情 / 试算」。分段页是标签根页，切换分段替换根页。分段带 `module` 时对应功能开关关闭会隐藏。财富标签在财富、支出、周期费用、虚拟资产、收入全关时隐藏，规划标签在规划关闭时隐藏，其余标签始终显示（`visibleTabs`）。页面可用 `useModules()` 读开关，修改开关后调用 `reload()`。

## 页面栈

```tsx
import { useEntry, useNav, useReveal } from '../nav-context';
const nav = useNav();
nav.push('items.detail', { id });     // page 推入；modal 全屏上滑；sheet 底部弹窗
nav.pop();                            // 返回或关闭
nav.replace('items.detail', { id });  // 保存新物品后换成详情
nav.popToRoot(); nav.switchTab('plan'); nav.setSegment('wishes.list');
const { params, kind, backTitle } = useEntry();
const reveal = useReveal();           // 上层页面关闭后变化；放进 effect 依赖里重新读取
```

- 参数只放可序列化的小值（ID、筛选键），业务数据在页面里用 IPC 读取。
- 每个标签有独立的栈，切换标签保留；其他标签的页面卸载，页面内存状态不保留，滚动位置保留。刷新后回到标签根页。
- 浏览器后退键和 iOS 边缘返回弹出一页（`history.ts`）。
- 保存结果未确定时（`session.pending`）所有切页、后退都暂停，沿用 `storedPending` / `resolvePending`；核对卡由 `MobileApp` 统一显示。保存请使用 `src/wealth.ts` 的 `submit`，用 `useSession()` 的 `setBusy` / `refreshPending` 配合。普通表单关闭不存草稿。
- 页面根元素用 `<div className="m-page">`。栈内页面首行放 `<NavBar/>`，标签根页首行放 `<LargeTitle/>`（分段控件由外壳绘制）。模态页：`<NavBar title primary={{label:'保存', onClick}}/>`（左上「取消」自动）。弹窗页只放内容，标题与「完成」由外壳提供。
- `ErrorBoundary` 包住每一页；页面应自己处理读取失败（`ErrorState`）、空白（`EmptyState`）、未知（`UnknownState` 或 `unknown` 值）。未知不等于零，金额用整数分字符串。

## 组件（`import { … } from '../ui'`）

| 组件 | 用途 |
|---|---|
| `LargeTitle`、`IconButton` | 标签根页大标题与右上圆形按钮 |
| `NavBar` | 返回「‹ 上一页标题」、模态「取消」与右上主操作 |
| `SegmentedControl` | 页内分段 |
| `Card`、`Section`、`HeroCard`、`Metric`、`MetricGrid` | 卡片、小节标题、渐变主卡、指标格 |
| `ListGroup`、`ListRow` | 分组列表行：左图标、标题、副标题、右值、› |
| `SwipeRow` | 左滑露出操作（置顶、删除），操作为真实按钮 |
| `ChipRow` | 横滑标签，单选或 `multiple` |
| `Switch`、`Button` | 开关、按钮（不低于 44px） |
| `FormGroup`、`FormRow`、`TextField`、`TextAreaField`、`SelectField` | 表单 |
| `MoneyField`、`DateField` | 包装 `CurrencyInput`（整数分字符串，空为未知）与 `DateInput` |
| `Sheet` | 页内小弹窗；路由 sheet 由外壳套用 |
| `ActionBar` | 固定在底部的操作条 |
| `EmptyState`、`UnknownState`、`ErrorState`、`Loading`、`Notice` | 状态块 |
| `LineAreaChart`、`BarChart`、`HBarChart`、`DonutChart` | 迷你图，必须传 `summary`（文字结论，作为 `role="img"` 的名称）；`null` 值表示未知，画成缺口而不是 0 |
| `Icon` | 线性图标集，物品图标仍复用 `src/materials.ts` |

```tsx
export default function ItemDetail({ params }: PageProps) {
  const nav = useNav();
  return <div className="m-page">
    <NavBar title="" primary={{ label: '编辑', onClick: () => nav.push('items.edit', { id: params.id }) }}/>
    <LargeTitle title="索尼 A7C2 相机"/>
    <MetricGrid><Metric label="日均成本" value="¥11.42" sub="按日计算"/><Metric label="已持有" value="612 天"/></MetricGrid>
    <ListGroup title="购买与投入"><ListRow title="购入价" value="¥6,490"/><ListRow title="购入日期" value="未知" unknown/></ListGroup>
  </div>;
}
```

键盘布局由 `ui/keyboard-viewport.ts` 在 `start.tsx` 统一安装：监听可见视口的 resize／scroll，将高度和偏移交给弹出层与 Sheet，NavBar 继续在各自容器内 sticky。焦点避让共用导航栏、ActionBar 及既有完整盘点底栏；键盘收起后恢复安全区和标签栏。不在业务页面添加键盘监听或手工平移，也不修改页面容器的 transform。日期输入统一为至少 16px，避免 iOS 聚焦时自动缩放；不禁止用户手动缩放。无 VisualViewport 时沿用 CSS 回退；用户缩放时不强行重排。

约束：触控区域不小于 44px，适配 `env(safe-area-inset-*)`，320 到 430 宽无横向滚动；不要给页面容器加 `transform`（会破坏固定定位的弹窗）。

## 预览与截图

```sh
npm run dev -- --port 1431   # 然后打开 http://127.0.0.1:1431/mobile-preview.html
```

使用与桌面预览相同的虚构数据（`src/preview-ipc.ts`，两个预览共用，在那里补虚构命令）。参数：`theme=light|dark`、`wealth=empty|missing|error`、`mobile-state=unknown|save-error`、`tab=overview|items|wealth|plan|me`、`route=<路由名>`（可加 `param.id=xxx` 传路由参数）、`route=dev.gallery`（组件库，另有 `dev.gallery.page|modal|sheet`）。预览仅用虚构内存数据，刷新重置。

截图用 python3 + playwright，chromium 在 `/opt/pw-browsers/chromium-*/chrome-linux/chrome`（`launch(executable_path=…)`，不要运行 `playwright install`），视口 390×844，`color_scheme` 分别取 `light` 与 `dark`，URL 带 `theme=`。

## 测试

纯逻辑（路由、栈、历史、数据投影）用 `tests/mobile-<模块>-*.test.mjs`，Node 直接加载 `.ts`（不要用构造函数参数属性、枚举等需要转译的语法，导入写 `.ts` 扩展名）。组件交互参考 `tests/planning-component-runtime.mjs`。注册表的约束见 `tests/mobile-routes.test.mjs`。提交前运行 `npm run build`、`npm run test:ui`。
