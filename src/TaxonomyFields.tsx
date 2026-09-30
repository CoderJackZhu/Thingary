import { useId, useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { planCategoryLayout, type CategoryLayoutPlan } from "./category-layout";
import type {
  CategoryFilterProps,
  CategoryFilterValue,
  CategorySelectProps,
  ChannelSelectProps,
  TaxonomyEntry,
} from "./taxonomy";

const UNCATEGORIZED_LABEL = "未分类";
const UNCHANNELED_LABEL = "未记录";
const STALE_HINT = "选项已不可用，请重新选择";

function buildOptionList(
  entries: readonly TaxonomyEntry[],
  nullLabel: string,
): { value: string; label: string }[] {
  // 这里不依赖任何持久顺序：交给父级 snapshot，原数组顺序即显示顺序
  return [
    { value: "__null__", label: nullLabel },
    ...entries.map((entry) => ({ value: entry.id, label: entry.name })),
  ];
}

function describeStaleness(
  value: string | null,
  entries: readonly TaxonomyEntry[],
): boolean {
  if (value === null) return false;
  return !entries.some((entry) => entry.id === value);
}

export function CategorySelect({
  entries,
  value,
  onChange,
  disabled,
  id,
}: CategorySelectProps) {
  const labelId = useId();
  const stale = describeStaleness(value, entries);
  const options = buildOptionList(entries, UNCATEGORIZED_LABEL);
  const selectValue = value === null ? "__null__" : value;
  return (
    <div className="taxonomy-field" data-component="category-select">
      <label id={labelId} htmlFor={id}>
        分类
      </label>
      <select
        id={id}
        className="taxonomy-select"
        data-state={stale ? "stale" : undefined}
        disabled={disabled}
        aria-labelledby={labelId}
        aria-describedby={stale ? `${id}-hint` : undefined}
        value={selectValue}
        onChange={(event) => {
          const next = event.target.value;
          if (next === "__null__") {
            onChange(null);
          } else {
            onChange(next);
          }
        }}
      >
        {stale && <option value={selectValue} disabled>选项已不可用</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {stale ? (
        <p id={`${id}-hint`} className="taxonomy-select-hint" role="alert">
          {STALE_HINT}
        </p>
      ) : null}
    </div>
  );
}

export function ChannelSelect({
  entries,
  value,
  onChange,
  disabled,
  id,
}: ChannelSelectProps) {
  const labelId = useId();
  const stale = describeStaleness(value, entries);
  const options = buildOptionList(entries, UNCHANNELED_LABEL);
  const selectValue = value === null ? "__null__" : value;
  return (
    <div className="taxonomy-field" data-component="channel-select">
      <label id={labelId} htmlFor={id}>
        购买渠道
      </label>
      <select
        id={id}
        className="taxonomy-select"
        data-state={stale ? "stale" : undefined}
        disabled={disabled}
        aria-labelledby={labelId}
        aria-describedby={stale ? `${id}-hint` : undefined}
        value={selectValue}
        onChange={(event) => {
          const next = event.target.value;
          if (next === "__null__") {
            onChange(null);
          } else {
            onChange(next);
          }
        }}
      >
        {stale && <option value={selectValue} disabled>选项已不可用</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {stale ? (
        <p id={`${id}-hint`} className="taxonomy-select-hint" role="alert">
          {STALE_HINT}
        </p>
      ) : null}
    </div>
  );
}

function targetLabel(target: CategoryFilterValue, entries: readonly TaxonomyEntry[]): string {
  if (target.mode === "all") return "全部分类";
  if (target.mode === "uncategorized") return UNCATEGORIZED_LABEL;
  const found = entries.find((entry) => entry.id === target.id);
  return found ? found.name : "已不可用的分类";
}

function isSameTarget(a: CategoryFilterValue, b: CategoryFilterValue): boolean {
  if (a.mode !== b.mode) return false;
  if (a.mode === "category" && b.mode === "category") return a.id === b.id;
  return true;
}

interface SegmentButtonProps {
  pressed: boolean;
  onSelect: () => void;
  label: string;
  ariaLabel: string;
  disabled?: boolean;
}

function SegmentButton({ pressed, onSelect, label, ariaLabel, disabled }: SegmentButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={pressed}
      onClick={onSelect}
      aria-label={ariaLabel}
    >
      {label}
    </button>
  );
}

// U18：溢出菜单内容（portal 到 body，避免被列表/检视器的 overflow 裁切）。
// 固定「全部分类／未分类」＋全部可筛选分类；搜索只过滤具体分类；打开即清空上次搜索。
function CategoryMenuPortal({
  anchor, entries, value, disabled, error, onRetry, onSelect, onClose, currentLabel,
}: {
  anchor: HTMLElement; entries: readonly TaxonomyEntry[]; value: CategoryFilterValue; disabled?: boolean;
  error?: string | null; onRetry?: () => void; onSelect: (v: CategoryFilterValue) => void; onClose: () => void;
  currentLabel: string;
}) {
  const [search, setSearch] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => { searchRef.current?.focus(); }, []);
  // Esc 关闭并还原触发钮焦点（与全局弹出层规则一致：先关菜单，不穿透页面）；
  // 点面板与触发钮之外关闭。
  useEffect(() => {
    const key = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } };
    const pointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !panelRef.current?.contains(target) && !anchor.contains(target)) onClose();
    };
    document.addEventListener("keydown", key, true);
    document.addEventListener("pointerdown", pointer, true);
    return () => { document.removeEventListener("keydown", key, true); document.removeEventListener("pointerdown", pointer, true); };
  }, [anchor, onClose]);
  // 定位一次并按菜单实际高度决定向上/向下；窗口滚动或缩放时直接关闭，避免错位。
  useEffect(() => {
    const panel = panelRef.current, rect = anchor.getBoundingClientRect();
    if (!panel) return;
    const height = panel.offsetHeight, spaceBelow = window.innerHeight - rect.bottom;
    setPos({
      left: Math.max(8, Math.min(rect.right, window.innerWidth - 8) - Math.min(panel.offsetWidth, 280)),
      top: spaceBelow < height + 12 ? Math.max(8, rect.top - height - 6) : rect.bottom + 6,
    });
    // 窗口滚动/缩放时关闭，避免菜单悬在错位处；菜单自身滚动不关闭。
    const close = (event: Event) => {
      if (panelRef.current && event.target instanceof Node && panelRef.current.contains(event.target)) return;
      onClose();
    };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => { window.removeEventListener("resize", close); window.removeEventListener("scroll", close, true); };
  }, [anchor, onClose]);
  const keyword = search.trim().toLowerCase();
  const matched = entries.filter((entry) => !keyword || entry.name.toLowerCase().includes(keyword));
  const options: { key: string; label: string; target: CategoryFilterValue; selected: boolean; aria: string }[] = [
    { key: "all", label: "全部分类", target: { mode: "all" }, selected: value.mode === "all", aria: "全部分类" },
    { key: "none", label: UNCATEGORIZED_LABEL, target: { mode: "uncategorized" }, selected: value.mode === "uncategorized", aria: UNCATEGORIZED_LABEL },
    ...matched.map((entry) => ({ key: entry.id, label: entry.name, target: { mode: "category" as const, id: entry.id }, selected: value.mode === "category" && value.id === entry.id, aria: `仅看分类 ${entry.name}` })),
  ];
  // 方向键在选项间移动；Esc 由全局弹出层规则处理（关闭并还原触发钮焦点）。
  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...(panelRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    if (!buttons.length) return;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[event.key === "ArrowDown" ? (index + 1 + buttons.length) % buttons.length : (index - 1 + buttons.length) % buttons.length]?.focus();
  };
  const pick = (target: CategoryFilterValue) => {
    if (disabled || isSameTarget(value, target)) { onClose(); return; }
    onSelect(target); onClose();
  };
  return createPortal(
    <div
      ref={panelRef}
      className="cat-menu-panel"
      role="listbox"
      aria-label="分类菜单"
      style={pos ? { left: pos.left, top: pos.top } : { visibility: "hidden" }}
      onKeyDown={onKeyDown}
    >
      <input
        ref={searchRef}
        className="cat-menu-search"
        aria-label="搜索分类"
        placeholder="搜索分类"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      {error ? (
        <div className="cat-menu-empty" role="alert">{error}<button type="button" onClick={() => onRetry?.()}>重试</button></div>
      ) : (
        <>
          {options.map((option) => (
            <button
              key={option.key}
              type="button"
              role="option"
              aria-selected={option.selected}
              className="cat-menu-item"
              disabled={disabled}
              onClick={() => pick(option.target)}
            >
              <span className="cat-menu-check" aria-hidden="true">{option.selected ? "✓" : ""}</span>
              <span className="cat-menu-name">{option.label}</span>
            </button>
          ))}
          {!matched.length && keyword && <p className="cat-menu-empty">没有匹配的分类</p>}
        </>
      )}
      <span className="visually-hidden" aria-live="polite">{`分类菜单，当前${currentLabel}`}</span>
    </div>,
    document.body,
  );
}

/* U18 鼠标优先的分类栏：空间充足时按实际宽度排完整分类胶囊；放不下时把
 * 放不下的部分收进固定在行末的「更多分类」菜单；极窄时收敛为单个选择按钮。
 * 尺寸变化只重排呈现——筛选值、列表结果与分类 ID 不经过任何持久化。
 * 布局决策见 src/category-layout.ts（纯函数，含溢出边界测试）。 */
export function CategoryFilter({
  entries,
  value,
  onChange,
  disabled,
  id,
  error,
  onRetry,
}: CategoryFilterProps) {
  const labelId = `${id}-label`;
  const heading = "分类筛选";
  const wrapRef = useRef<HTMLDivElement>(null);
  const measureLayerRef = useRef<HTMLDivElement>(null);
  // 触发按钮用回调 ref 存 state：portal 只在真实按钮挂载后渲染，
  // 不依赖 ref 在渲染与提交之间的时序。
  const [triggerEl, setTriggerEl] = useState<HTMLButtonElement | null>(null);
  // null＝全部可见；否则是 planCategoryLayout 的排布（含 compact）。
  const [layout, setLayout] = useState<CategoryLayoutPlan | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const selectedEntry = value.mode === "category" ? entries.find((entry) => entry.id === value.id) ?? null : null;
  const currentLabel = targetLabel(value, entries);
  // 条目集的稳定键：taxonomy 快照未就绪时 entries 是每次渲染新建的空数组，
  // 用内容键而不是数组引用做依赖，避免无意义重测。
  const entriesKey = entries.map((entry) => entry.id).join("\u0000");
  const compact = layout?.compact ?? false;
  const overflowed = layout !== null && layout.showMore;

  // 实测一次全部胶囊宽度并计算排布。只有结果真正变化才 setState——
  // planCategoryLayout 每次返回新对象，直接写入会形成无限更新（首轮 Review R1）。
  const measure = () => {
    const wrap = wrapRef.current, layer = measureLayerRef.current;
    if (!wrap || !layer) return;
    const width = wrap.clientWidth;
    if (width <= 0) return;
    const chips = [...layer.querySelectorAll<HTMLElement>("[data-chip]")];
    const byKey = new Map(chips.map((chip) => [chip.dataset.chip!, chip.offsetWidth]));
    const plan = planCategoryLayout(
      width,
      { all: byKey.get("__all__") ?? 0, none: byKey.get("__none__") ?? 0, more: byKey.get("__more__") ?? 0 },
      entries.map((entry) => ({ id: entry.id, width: byKey.get(entry.id) ?? 0 })),
      selectedEntry?.id ?? null,
    );
    // compact（showMore:false）也必须写入状态——映射成 null 会把整栏渲染成全部胶囊。
    const next: CategoryLayoutPlan | null = plan.showMore || plan.compact ? plan : null;
    setLayout((prev) => {
      const same = prev === null
        ? next === null
        : next !== null && prev.compact === next.compact && prev.showMore === next.showMore
          && prev.selectedPinned === next.selectedPinned && prev.visibleIds.length === next.visibleIds.length
          && prev.visibleIds.every((pid, i) => pid === next.visibleIds[i]);
      return same ? prev : next;
    });
  };
  // 通过 ref 让一次性挂载的 observer 始终调用最新闭包，生命周期稳定。
  const measureRef = useRef(measure);
  measureRef.current = measure;
  useLayoutEffect(() => {
    measureRef.current();
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measureRef.current());
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);
  // 条目集或选中项变化（换库、选择隐藏分类、主题字体变化后的宽度差）重测。
  useEffect(() => { measureRef.current(); }, [entriesKey, selectedEntry?.id]);
  // 换库：条目集变化即关闭菜单、丢弃搜索，选项随新库渲染。
  useEffect(() => { setMenuOpen(false); }, [entriesKey]);
  // 浏览器预览截图入口：?category-menu=open 在分类就绪后直接开菜单（原生无此流程）；
  // 声明在关菜单 effect 之后，首次加载时后者的 setMenuOpen(false) 被覆盖。
  useEffect(() => {
    if (!entries.length || sessionStorage.getItem('possio.category-menu.v1') !== 'open') return;
    sessionStorage.removeItem('possio.category-menu.v1');
    setMenuOpen(true);
  }, [entriesKey]);
  useEffect(() => { if (!menuOpen) return; const close = () => setMenuOpen(false); window.addEventListener("resize", close); return () => window.removeEventListener("resize", close); }, [menuOpen]);

  const closeMenu = () => { setMenuOpen(false); triggerEl?.focus(); };
  const chipProps = (target: CategoryFilterValue, label: string) => ({
    type: "button" as const,
    disabled,
    "aria-pressed": isSameTarget(value, target),
    "aria-label": target.mode === "category" ? `仅看分类 ${label}` : targetLabel(target, entries),
    onClick: () => { if (!isSameTarget(value, target)) onChange(target); },
  });

  const prefixEntries = layout && layout.showMore ? layout.visibleIds.map(pid => entries.find(entry => entry.id === pid)!).filter(Boolean) : entries;
  const selectedHidden = selectedEntry && !prefixEntries.some((entry) => entry.id === selectedEntry.id);
  // 有错误时即使没有溢出也要给出菜单入口（错误与重试在菜单内呈现）。
  const showTrigger = overflowed || !!error;

  return (
    <div className="taxonomy-field cat-filter" data-component="category-filter" id={id}>
      <span id={labelId} className="taxonomy-eyebrow">{heading}</span>
      <div ref={wrapRef} role="group" aria-labelledby={labelId} className="cat-chip-row" data-disabled={disabled ? "true" : undefined}>
        {compact ? (
          <button
            ref={setTriggerEl}
            type="button"
            className="cat-chip cat-compact"
            disabled={disabled}
            aria-haspopup="listbox"
            aria-expanded={menuOpen}
            aria-label={`分类：${currentLabel}，打开分类菜单`}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="cat-compact-label">分类：{currentLabel}</span>
            <span className="cat-caret" aria-hidden="true">▾</span>
          </button>
        ) : (
          <>
            <button {...chipProps({ mode: "all" }, "全部分类")} data-chip="__all__" className="cat-chip">全部分类</button>
            <button {...chipProps({ mode: "uncategorized" }, UNCATEGORIZED_LABEL)} data-chip="__none__" className="cat-chip">{UNCATEGORIZED_LABEL}</button>
            {prefixEntries.map((entry) => (
              <button key={entry.id} {...chipProps({ mode: "category", id: entry.id }, entry.name)} data-chip={entry.id} className="cat-chip">{entry.name}</button>
            ))}
            {selectedHidden && selectedEntry && (
              <button {...chipProps({ mode: "category", id: selectedEntry.id }, selectedEntry.name)} className="cat-chip">{selectedEntry.name}</button>
            )}
            {showTrigger && (
              <button
                ref={setTriggerEl}
                type="button"
                className="cat-chip cat-more"
                data-chip="__more__"
                disabled={disabled}
                aria-haspopup="listbox"
                aria-expanded={menuOpen}
                aria-label={`更多分类，当前${currentLabel}`}
                onClick={() => setMenuOpen((open) => !open)}
              >
                更多分类 <span className="cat-caret" aria-hidden="true">▾</span>
              </button>
            )}
          </>
        )}
      </div>
      {/* 隐藏测量层：渲染全部胶囊与按钮以获得真实字体宽度；不响应指针。 */}
      <div ref={measureLayerRef} className="cat-measure" aria-hidden="true">
        <span data-chip="__all__" className="cat-chip">全部分类</span>
        <span data-chip="__none__" className="cat-chip">{UNCATEGORIZED_LABEL}</span>
        <span data-chip="__more__" className="cat-chip cat-more">更多分类 <span className="cat-caret">▾</span></span>
        {entries.map((entry) => <span key={entry.id} data-chip={entry.id} className="cat-chip">{entry.name}</span>)}
      </div>
      <span className="taxonomy-help">当前：{currentLabel}</span>
      {menuOpen && triggerEl && (
        <CategoryMenuPortal
          anchor={triggerEl}
          entries={entries}
          value={value}
          disabled={disabled}
          error={error}
          onRetry={onRetry}
          currentLabel={currentLabel}
          onSelect={onChange}
          onClose={closeMenu}
        />
      )}
    </div>
  );
}
