import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import TaxonomyManager from "./TaxonomyManager";
import {
  CategoryFilter,
  CategorySelect,
  ChannelSelect,
} from "./TaxonomyFields";
import {
  CATEGORY_ICONS,
  applyPreviewCommand,
  previewSnapshot,
  validatePreviewName,
  findCategoryIcon,
  isDuplicateName,
  normalizeName,
} from "./taxonomy";
import type {
  CategoryFilterValue,
  PreviewCatalog,
  CommandResult,
  TaxonomyCommand,
  TaxonomyEntry,
  TaxonomyKind,
  TaxonomySnapshot,
} from "./taxonomy";

import "./style.css";
import "./taxonomy.css";

// 1. 虚构数据：与产品设计第 4 节样例并不重叠，仅用于本次独立内存预览。
const FIXTURE_CATEGORIES: TaxonomyEntry[] = [
  {
    id: "cat-electronics",
    name: "电子",
    icon: "computer",
    references: { activeAssets: 5, deletedAssets: 1 },
  },
  {
    id: "cat-camera",
    name: "摄影",
    icon: "camera",
    references: { activeAssets: 2, deletedAssets: 0 },
  },
  {
    id: "cat-home",
    name: "家居",
    icon: "home",
    references: { activeAssets: 3, deletedAssets: 2 },
  },
  {
    id: "cat-audio",
    name: "音频",
    icon: "audio",
    references: { activeAssets: 1, deletedAssets: 0 },
  },
  {
    id: "cat-misc",
    name: "杂物",
    icon: "box",
    references: { activeAssets: 0, deletedAssets: 0 },
  },
];

const FIXTURE_CHANNELS: TaxonomyEntry[] = [
  {
    id: "ch-apple",
    name: "Apple Store",
    references: { activeAssets: 3, deletedAssets: 0 },
  },
  {
    id: "ch-jd",
    name: "京东自营",
    references: { activeAssets: 4, deletedAssets: 1 },
  },
  {
    id: "ch-offline",
    name: "线下店",
    references: { activeAssets: 2, deletedAssets: 1 },
  },
  {
    id: "ch-second",
    name: "二手闲置",
    references: { activeAssets: 1, deletedAssets: 0 },
  },
];

type Behaviour = "live" | "slow" | "fail-write" | "needs-reload" | "load-error" | "loading";

interface AdapterSettings {
  behaviour: Behaviour;
  delayMs: number;
  failReload?: boolean;
}

function snapshotFromCategories(
  categories: readonly TaxonomyEntry[],
  channels: readonly TaxonomyEntry[],
): TaxonomySnapshot {
  return {
    categories: [...categories],
    channels: [...channels],
  };
}

interface InMemoryAdapter {
  load: () => Promise<TaxonomySnapshot | null>;
  command: (cmd: TaxonomyCommand) => Promise<CommandResult>;
  settings: AdapterSettings;
  inspect: () => PreviewCatalog;
}

function buildAdapter(initial: TaxonomySnapshot, inputSettings: AdapterSettings): InMemoryAdapter {
  const settings = { ...inputSettings };
  const refs = (entries: readonly TaxonomyEntry[], deleted: boolean) => entries.flatMap(e =>
    Array.from({ length: deleted ? e.references.deletedAssets : e.references.activeAssets }, () => e.id));
  const assets = [false, true].flatMap(deleted => {
    const categories = refs(initial.categories, deleted);
    const channels = refs(initial.channels, deleted);
    return Array.from({ length: Math.max(categories.length, channels.length) }, (_, i) => ({
      id: (deleted ? "deleted-" : "active-") + i,
      deleted, categoryId: categories[i] ?? null, channelId: channels[i] ?? null,
    }));
  });
  let catalog: PreviewCatalog = { categories: structuredClone([...initial.categories]), channels: structuredClone([...initial.channels]), assets };
  async function wait() {
    if (settings.delayMs > 0) await new Promise<void>(resolve => setTimeout(resolve, settings.delayMs));
  }
  return {
    settings,
    inspect: () => structuredClone(catalog),
    load: async () => {
      await wait();
      if (settings.failReload) throw new Error("模拟重新加载失败，保留草稿和核对锁。");
      return previewSnapshot(catalog);
    },
    command: async (cmd) => {
      await wait();
      if (settings.behaviour === "fail-write") return { status: "error", message: "模拟保存失败，输入已保留。", recovery: "retry" };
      if (settings.behaviour === "needs-reload") return { status: "error", message: "结果待核对，请重新加载。", recovery: "reload" };
      try {
        catalog = applyPreviewCommand(catalog, cmd, cmd.type === "create" ? crypto.randomUUID() : undefined);
        return { status: "success" };
      } catch (error) {
        return { status: "error", message: error instanceof Error ? error.message : "操作失败。", recovery: "retry" };
      }
    },
  };
}

interface ScenarioState {
  behaviour: Behaviour;
  delayMs: number;
  description: string;
  tag: string;
  tone: "info" | "warn" | "danger";
}

const SCENARIOS: Record<Behaviour, ScenarioState> = {
  live: {
    behaviour: "live",
    delayMs: 0,
    description: "立即返回、可控演示正常路径。",
    tag: "正常路径",
    tone: "info",
  },
  slow: {
    behaviour: "slow",
    delayMs: 1200,
    description: "提交延迟 1.2s，用于观察忙状态与草稿保留。",
    tag: "提交延迟",
    tone: "info",
  },
  "fail-write": {
    behaviour: "fail-write",
    delayMs: 600,
    description: "写入返回失败，要求用户稍后重试。",
    tag: "写入失败",
    tone: "warn",
  },
  "needs-reload": {
    behaviour: "needs-reload",
    delayMs: 600,
    description: "返回 recovery=reload：阻止再次变更，允许重载核对。",
    tag: "需要重载核对",
    tone: "warn",
  },
  "load-error": {
    behaviour: "load-error",
    delayMs: 400,
    description: "首次加载失败，需通过「重新加载」恢复。",
    tag: "加载失败/重试",
    tone: "danger",
  },
  loading: {
    behaviour: "loading",
    delayMs: 4000,
    description: "加载持续 4s，观察空白/加载提示。",
    tag: "加载中（空白）",
    tone: "info",
  },
};

interface PreviewState {
  snapshot: TaxonomySnapshot | null;
  loading: boolean;
  loadError: string | null;
  blocker: { message: string } | null;
}

function PreviewApp() {
  const initialBehaviour: Behaviour = (() => {
    if (typeof window === "undefined") return "live";
    const params = new URLSearchParams(window.location.search);
    const candidate = params.get("scenario");
    if (candidate && (Object.keys(SCENARIOS) as Behaviour[]).includes(candidate as Behaviour)) {
      return candidate as Behaviour;
    }
    return "live";
  })();
  const [scenario, setScenario] = useState<Behaviour>(initialBehaviour);
  const [state, setState] = useState<PreviewState>({
    snapshot: scenario === "loading" ? null : snapshotFromCategories(FIXTURE_CATEGORIES, FIXTURE_CHANNELS),
    loading: scenario === "loading",
    loadError: null,
    blocker: null,
  });
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>("cat-camera");
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>("ch-apple");
  const [filter, setFilter] = useState<CategoryFilterValue>({ mode: "category", id: "cat-camera" });
  const [eventLog, setEventLog] = useState<string[]>([]);
  const [forcedReload, setForcedReload] = useState(0);
  const adapterRef = useRef<InMemoryAdapter>(
    buildAdapter(
      snapshotFromCategories(FIXTURE_CATEGORIES, FIXTURE_CHANNELS),
      SCENARIOS.live,
    ),
  );

  // 应用 scenario 切换
  useEffect(() => {
    const next = SCENARIOS[scenario];
    adapterRef.current = buildAdapter(
      snapshotFromCategories(FIXTURE_CATEGORIES, FIXTURE_CHANNELS),
      next,
    );
    if (scenario === "loading") {
      setState((prev) => ({
        ...prev,
        snapshot: null,
        loading: true,
        loadError: null,
        blocker: null,
      }));
      // 模拟 4s 后返回成功
      const t = window.setTimeout(() => {
        setState({
          snapshot: snapshotFromCategories(FIXTURE_CATEGORIES, FIXTURE_CHANNELS),
          loading: false,
          loadError: null,
          blocker: null,
        });
        setSelectedCategoryId("cat-camera");
        setSelectedChannelId("ch-apple");
        setFilter({ mode: "category", id: "cat-camera" });
        setEventLog((log) => ["加载完成", ...log].slice(0, 8));
      }, next.delayMs);
      return () => window.clearTimeout(t);
    }
    if (scenario === "load-error") {
      setState({
        snapshot: null,
        loading: false,
        loadError: "无法读取分类与渠道快照。",
        blocker: null,
      });
      setEventLog((log) => ["加载失败：需要重试", ...log].slice(0, 8));
      return;
    }
    setState({
      snapshot: snapshotFromCategories(FIXTURE_CATEGORIES, FIXTURE_CHANNELS),
      loading: false,
      loadError: null,
      blocker: null,
    });
    setEventLog((log) => [`场景已切换：${next.tag}`, ...log].slice(0, 8));
  }, [scenario]);

  // 在 needs-reload 场景里，加载后再次提交就能触发 blocked 状态
  const validateName = useMemo(
    () =>
      function (kind: TaxonomyKind, name: string, editingId?: string): string | null {
        const pool = kind === "category" ? state.snapshot?.categories ?? [] : state.snapshot?.channels ?? [];
        return validatePreviewName(pool, kind, name, editingId);
      },
    [state.snapshot],
  );

  async function reload() {
    setState(prev => ({ ...prev, loading: true, loadError: null }));
    setForcedReload(n => n + 1);
    try {
      const next = await adapterRef.current.load();
      adapterRef.current.settings.behaviour = "live";
      setState({ snapshot: next, loading: false, loadError: null, blocker: null });
      setEventLog(log => ["重新加载成功；可核对草稿后重试", ...log].slice(0, 12));
    } catch (error) {
      const message = error instanceof Error ? error.message : "加载失败。";
      setState(prev => ({ ...prev, loading: false, loadError: message }));
      setEventLog(log => ["重新加载失败，保持锁定", ...log].slice(0, 12));
      throw error;
    }
  }

  async function onCommand(command: TaxonomyCommand): Promise<CommandResult> {
    setEventLog((log) => [`提交：${formatCommand(command)}`, ...log].slice(0, 12));
    const result = await adapterRef.current.command(command);
    setEventLog((log) => [
      `${result.status === "success" ? "返回" : "失败"}：${
        result.status === "success" ? formatCommand(command) : result.message
      }`,
      ...log,
    ].slice(0, 12));
    if (result.status === "success") {
      const next = await adapterRef.current.load();
      setState((prev) => ({
        ...prev,
        snapshot: next,
        blocker: null,
      }));
      if (command.type === "remove") {
        const targetId = command.id;
        const migrated = command.targetId;
        if (command.kind === "category" && filter.mode === "category" && filter.id === command.id) {
          setFilter(migrated === null ? { mode: "uncategorized" } : { mode: "category", id: migrated });
        }
        if (migrated === null) {
          // 演示：移除后把字段组件的选中值按迁移目标显式调整，但不擅自选择新值；
          // 仅在 selectedCategoryId === targetId 时清空
          if (selectedCategoryId === targetId || selectedChannelId === targetId) {
            if (command.kind === "category") setSelectedCategoryId(null);
            if (command.kind === "channel") setSelectedChannelId(null);
          }
        } else if (migrated !== undefined) {
          if (command.kind === "category" && selectedCategoryId === targetId) setSelectedCategoryId(migrated);
          if (command.kind === "channel" && selectedChannelId === targetId) setSelectedChannelId(migrated);
        }
      }
    } else {
      if (result.recovery === "reload") {
        setState((prev) => ({ ...prev, blocker: { message: result.message } }));
      }
    }
    return result;
  }

  const scenarioInfo = SCENARIOS[scenario];

  return (
    <main className="taxonomy-preview">
      <header>
        <p className="eyebrow">T06a 独立预览</p>
        <h1>分类与购买渠道界面（虚构样例，不写入真实资料）</h1>
        <p className="muted">
          本页为开发验收样例，不写入真实资料。
          切换下方场景可观察空白、加载、加载失败/重试、写入失败和需要重载核对等不同提示。
        </p>
      </header>

      <section className="taxonomy-card" aria-labelledby="scenario-title">
        <div className="taxonomy-card-header">
          <h2 id="scenario-title">演示场景</h2>
          <span className="muted small">{scenarioInfo.tag}</span>
        </div>
        <div className="taxonomy-control-row" role="group" aria-label="切换场景">
          <label htmlFor="scenario-select">选择状态：</label>
          <select
            id="scenario-select"
            value={scenario}
            onChange={(event) => setScenario(event.target.value as Behaviour)}
          >
            {(Object.keys(SCENARIOS) as Behaviour[]).map((key) => (
              <option key={key} value={key}>
                {SCENARIOS[key].tag}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              setEventLog([]);
            }}
          >
            清空事件日志
          </button>
          <label><input type="checkbox" aria-label="模拟重载失败" onChange={e => { adapterRef.current.settings.failReload = e.target.checked; }} />模拟重载失败</label>
          <button type="button" onClick={() => {
            adapterRef.current.settings.behaviour = "live";
            setEventLog(log => ["恢复正常写入", ...log]);
          }}>恢复正常写入</button>
          <button type="button" onClick={() => {
            adapterRef.current = buildAdapter({ categories: [], channels: [] }, SCENARIOS.live);
            setState({ snapshot: { categories: [], channels: [] }, loading: false, loadError: null, blocker: null });
            setSelectedCategoryId(null); setSelectedChannelId(null); setFilter({ mode: "all" });
          }}>空数据样例</button>
          <button type="button" onClick={() => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; }}>切换深浅色</button>
        </div>
        <p className="muted small">{scenarioInfo.description}</p>
      </section>

      <div className="taxonomy-grid">
        <TaxonomyManager
          snapshot={state.snapshot}
          loading={state.loading}
          loadError={state.loadError}
          onReload={reload}
          validateName={validateName}
          onCommand={onCommand}
        />

        <section className="taxonomy-card" aria-labelledby="fields-title">
          <div className="taxonomy-card-header">
            <h2 id="fields-title">字段组件演示</h2>
            <span className="muted small">与上方共用同一 snapshot</span>
          </div>
          <p className="muted small">
            将这里的选择项与分类排序核对：如果管理页改名后 ID 不变，选中值仍是同一个分类。
            迁移选中分类时，字段与筛选跟随迁移目标；可单独检查选项失效状态。
          </p>
          <div className="taxonomy-field-row">
            <div className="taxonomy-helper">
              <strong>分类选择</strong>
              <small>对应资产表单中的「分类」字段</small>
              <small>{summaryOf(filter, state.snapshot?.categories ?? [], selectedCategoryId)}</small>
            </div>
            <div className="taxonomy-input">
              <CategorySelect
                entries={state.snapshot?.categories ?? []}
                value={selectedCategoryId}
                disabled={state.loading}
                onChange={setSelectedCategoryId}
                id="preview-category-select"
              />
              <div role="group" aria-label="重置选中" style={{ marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => setSelectedCategoryId(null)}
                >
                  改回「未分类」
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedCategoryId("cat-deleted-fixture")}
                  style={{ marginLeft: 8 }}
                >
                  选择一个已不可用的 ID（演示 stale）
                </button>
              </div>
            </div>
          </div>

          <div className="taxonomy-field-row">
            <div className="taxonomy-helper">
              <strong>购买渠道</strong>
              <small>对应资产表单中的「购买渠道」字段</small>
              <small>{channelSummary(state.snapshot?.channels ?? [], selectedChannelId)}</small>
            </div>
            <div className="taxonomy-input">
              <ChannelSelect
                entries={state.snapshot?.channels ?? []}
                value={selectedChannelId}
                disabled={state.loading}
                onChange={setSelectedChannelId}
                id="preview-channel-select"
              />
              <button
                type="button"
                onClick={() => setSelectedChannelId(null)}
                style={{ marginTop: 8 }}
              >
                改回「未记录」
              </button>
            </div>
          </div>

          <div className="taxonomy-field-row">
            <div className="taxonomy-helper">
              <strong>分类筛选</strong>
              <small>列表/网格顶部的分类筛选</small>
              <small>筛选当前：{targetLabel(filter, state.snapshot?.categories ?? [])}</small>
            </div>
            <div className="taxonomy-input">
              <CategoryFilter
                entries={state.snapshot?.categories ?? []}
                value={filter}
                disabled={state.loading}
                onChange={setFilter}
                id="preview-category-filter"
              />
            </div>
          </div>
        </section>
      </div>

      <section className="taxonomy-card" aria-labelledby="events-title">
        <div className="taxonomy-card-header">
          <h2 id="events-title">操作事件</h2>
          <span className="muted small">最近 12 条 · 仅本次会话</span>
        </div>
        {eventLog.length === 0 ? (
          <p className="muted small">尚未提交操作。试着新建一项、改名、上移下移或移除分类。</p>
        ) : (
          <ol style={{ paddingLeft: 18, margin: 0 }}>
            {eventLog.map((entry, idx) => (
              <li key={idx} className="small">
                {entry}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="taxonomy-card" aria-labelledby="fixtures-title">
        <h2 id="fixtures-title">初始数据快照（仅用于核对字段组件行为）</h2>
        <p className="muted small">所有名称都是虚构的；预览刷新即重置，不写入真实应用数据。</p>
        <table className="muted small">
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>分类</th>
              <th>图标</th>
              <th>引用（正常）</th>
              <th>引用（已删除）</th>
            </tr>
          </thead>
          <tbody>
            {(state.snapshot?.categories ?? FIXTURE_CATEGORIES).map((entry) => (
              <tr key={entry.id}>
                <td>{entry.name}</td>
                <td>{entry.icon ? findCategoryIcon(entry.icon).label : "-"}</td>
                <td>{entry.references.activeAssets}</td>
                <td>{entry.references.deletedAssets}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="taxonomy-card" aria-label="引用迁移核对">
        <h2>引用迁移核对</h2>
        <table><thead><tr><th>虚构资产</th><th>位置</th><th>分类</th><th>渠道</th></tr></thead>
          <tbody>{adapterRef.current.inspect().assets.map(a => <tr key={a.id}>
            <td>{a.id}</td><td>{a.deleted ? "最近删除" : "资产列表"}</td>
            <td>{state.snapshot?.categories.find(e => e.id === a.categoryId)?.name ?? (a.categoryId ? "引用失效" : "未分类")}</td>
            <td>{state.snapshot?.channels.find(e => e.id === a.channelId)?.name ?? (a.channelId ? "引用失效" : "未记录")}</td>
          </tr>)}</tbody>
        </table>
      </section>

      <section className="taxonomy-card" aria-labelledby="legend-title">
        <h2 id="legend-title">图例与图标</h2>
        <p className="muted small">图标仅用作分类的图形标识，遵循 A「静序」细线、清楚、不抢戏。</p>
        <ul className="taxonomy-icon-row" aria-label="分类图标对照">
          {CATEGORY_ICONS.map((icon) => (
            <li key={icon.value} className="taxonomy-icon-pick" aria-label={`图标 ${icon.label}`}>
              <span className="taxonomy-icon-glyph">{iconGlyph(icon.value)}</span>
              <span>{icon.label}</span>
            </li>
          ))}
        </ul>
      </section>

      <p className="muted small">重新加载计数：{forcedReload}。Adaptor 行为：{scenarioInfo.tag}</p>
    </main>
  );
}

function iconGlyph(value: keyof typeof CATEGORY_ICONS extends never ? never : import("./taxonomy").CategoryIcon): import("react").ReactNode {
  return <span aria-hidden="true">{value}</span>;
}

function summaryOf(
  filter: CategoryFilterValue,
  categories: readonly TaxonomyEntry[],
  selected: string | null,
): string {
  if (filter.mode === "category" && selected === filter.id) {
    return `列表只显示「${categories.find((entry) => entry.id === filter.id)?.name ?? filter.id}」分类。`;
  }
  if (selected === null) return "资产归为「未分类」。";
  const found = categories.find((entry) => entry.id === selected);
  if (!found) return "选中项已不在列表中。";
  return `新资产归为「${found.name}」。`;
}

function channelSummary(
  channels: readonly TaxonomyEntry[],
  selected: string | null,
): string {
  if (selected === null) return "购买渠道未记录。";
  const found = channels.find((entry) => entry.id === selected);
  if (!found) return "选中的渠道已不可用。";
  return `购买渠道：${found.name}。`;
}

function targetLabel(target: CategoryFilterValue, categories: readonly TaxonomyEntry[]): string {
  if (target.mode === "all") return "全部分类";
  if (target.mode === "uncategorized") return "未分类";
  const found = categories.find((entry) => entry.id === target.id);
  return found ? found.name : "已不可用的分类";
}

function formatCommand(cmd: TaxonomyCommand): string {
  switch (cmd.type) {
    case "create":
      return `新建${cmd.kind === "category" ? "分类" : "渠道"}：${cmd.name}${cmd.icon ? `（图标：${cmd.icon}）` : ""}`;
    case "rename":
      return `${cmd.kind === "category" ? "分类" : "渠道"}改名：${cmd.id} -> ${cmd.name}`;
    case "set-icon":
      return `更新分类图标：${cmd.id} -> ${cmd.icon}`;
    case "reorder":
      return `调整顺序：${cmd.ids.join(", ")}`;
    case "move-category":
      return `分类排序：${cmd.id} -> ${cmd.direction}`;
    case "remove":
      return `移除${cmd.kind === "category" ? "分类" : "渠道"}：${cmd.id} → ${cmd.targetId ?? "未分类/未记录"}`;
  }
}

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<PreviewApp />);
}

export { PreviewApp };
