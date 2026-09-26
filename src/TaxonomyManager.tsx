import {DragHandle} from './FormControls';
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import {
  CATEGORY_ICONS,
  findCategoryIcon,
  normalizeName,
} from "./taxonomy";
import type {
  CategoryIcon,
  CommandResult,
  TaxonomyCommand,
  TaxonomyEntry,
  TaxonomyKind,
  TaxonomyManagerProps,
  TaxonomySnapshot,
} from "./taxonomy";

// 草稿状态：仅保存当前编辑草稿，绝不缓存另一份实体列表
type DraftState = {
  // rename / create 草稿
  name: string;
  // create 时可选图标
  icon: CategoryIcon;
};

const KIND_TABS: { value: TaxonomyKind; label: string; helper: string }[] = [
  { value: "category", label: "分类", helper: "决定列表与摘要里的分组归属" },
  { value: "channel", label: "购买渠道", helper: "记录每件物品的购入场所" },
];

const ICON_GLYPHS: Record<CategoryIcon, ReactNode> = {
  box: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 7l9-4 9 4v10l-9 4-9-4V7z" />
      <path d="M3 7l9 4 9-4" />
      <path d="M12 11v10" />
    </svg>
  ),
  computer: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  ),
  phone: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6" y="2.5" width="12" height="19" rx="3" />
      <path d="M11 18h2" />
    </svg>
  ),
  camera: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 8h4l2-2.5h4L16 8h4v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  ),
  audio: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 14V10l8-5v14l-8-5z" />
      <path d="M14 9c2 .8 2 5.2 0 6" />
    </svg>
  ),
  home: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 11l9-7 9 7v9H3z" />
      <path d="M9 20v-5h6v5" />
    </svg>
  ),
};

interface RemoveTarget {
  id: string;
  kind: TaxonomyKind;
  name: string;
  referenceCount: number;
  deletedReferenceCount: number;
  ongoingWishlistCount: number;
  abandonedWishlistCount: number;
}

interface ConfirmDialog {
  open: boolean;
  target: RemoveTarget | null;
  choice: string | null;
  busy: boolean;
}

interface NoticeState {
  text: string;
  state: "info" | "error";
}

const INITIAL_CONFIRM: ConfirmDialog = {
  open: false,
  target: null,
  choice: null,
  busy: false,
};

function totalReferences(entry: TaxonomyEntry): number {
  return entry.references.activeAssets
    + entry.references.deletedAssets
    + (entry.references.ongoingWishlist ?? 0)
    + (entry.references.abandonedWishlist ?? 0);
}

function blankDraft(): DraftState {
  return { name: "", icon: "box" };
}

function entryList(snapshot: TaxonomySnapshot | null, kind: TaxonomyKind): readonly TaxonomyEntry[] {
  if (!snapshot) return [];
  return kind === "category" ? snapshot.categories : snapshot.channels;
}

function otherEntries(
  snapshot: TaxonomySnapshot | null,
  kind: TaxonomyKind,
  excludeId: string,
): readonly TaxonomyEntry[] {
  return entryList(snapshot, kind).filter((entry) => entry.id !== excludeId);
}

interface IconPickerProps {
  value: CategoryIcon;
  onChange: (value: CategoryIcon) => void;
  disabled?: boolean;
  name: string;
}

function IconPicker({ value, onChange, disabled, name }: IconPickerProps) {
  return (
    <div className="taxonomy-icon-row" role="radiogroup" aria-label={`${name}图标`}>
      {CATEGORY_ICONS.map((icon) => (
        <button
          key={icon.value}
          type="button"
          className="taxonomy-icon-pick"
          aria-pressed={value === icon.value}
          aria-label={`${name}，选择图标 ${icon.label}`}
          role="radio"
          aria-checked={value === icon.value}
          tabIndex={value === icon.value ? 0 : -1}
          onKeyDown={(event) => {
            if (disabled || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
            event.preventDefault();
            const index = CATEGORY_ICONS.findIndex(item => item.value === value);
            const delta = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
            const next = (index + delta + CATEGORY_ICONS.length) % CATEGORY_ICONS.length;
            const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button");
            buttons?.[next]?.focus();
            onChange(CATEGORY_ICONS[next].value);
          }}
          disabled={disabled}
          onClick={() => onChange(icon.value)}
        >
          <span className="taxonomy-icon-glyph" aria-hidden="true">
            {ICON_GLYPHS[icon.value]}
          </span>
          <span>{icon.label}</span>
        </button>
      ))}
    </div>
  );
}

interface ListRowProps {
  entry: TaxonomyEntry;
  isFirst: boolean;
  isLast: boolean;
  kind: TaxonomyKind;
  busy: boolean;
  reloadVersion: number;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: (name: string) => Promise<void>;
  onChangeIcon: (icon: CategoryIcon) => Promise<void>;
  onDrop: (targetId:string)=>void;
  onMove: (direction: "up" | "down") => Promise<void>;
  onRemove: () => void;
}

function ListRow({
  entry,
  isFirst,
  isLast,
  kind,
  busy,
  reloadVersion,
  onStartEdit,
  onCancelEdit,
  onSave,
  onChangeIcon,
  onDrop,
  onMove,
  onRemove,
}: ListRowProps) {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [draftName, setDraftName] = useState(entry.name);
  const [rowError, setRowError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  // A successful reconciliation clears stale errors without discarding a name draft.
  useEffect(() => { setRowError(null); }, [reloadVersion]);

  useEffect(() => {
    if (mode === "edit") {
      requestAnimationFrame(() => nameInputRef.current?.focus());
    }
  }, [mode]);

  const total = totalReferences(entry);
  const iconDescriptor = entry.icon ? findCategoryIcon(entry.icon) : null;

  async function saveDraft() {
    if (busy) return;
    const trimmed = normalizeName(draftName);
    if (!trimmed) {
      setRowError("请填写名称。");
      return;
    }
    setRowError(null);
    try {
      await onSave(trimmed);
      setMode("view");
      onCancelEdit();
    } catch (error) {
      setRowError((error as Error).message || "保存未完成，请稍后重试。");
    }
  }

  async function commitIconChange(next: CategoryIcon) {
    if (next === (entry.icon ?? "box")) return;
    if (busy) return;
    try {
      await onChangeIcon(next);
      setRowError(null);
    } catch (error) {
      setRowError((error as Error).message || "图标未更新，请稍后重试。");
    }
  }

  if (mode === "view") {
    return <li data-sort-id={entry.id}><DragHandle label={entry.name} disabled={busy} onDrop={onDrop} onStep={d=>{if(!(d<0?isFirst:isLast))void onMove(d<0?'up':'down')}}/><strong>{iconDescriptor&&<span className="taxonomy-icon-glyph" aria-label={'图标：'+iconDescriptor.label}>{ICON_GLYPHS[iconDescriptor.value]}</span>}{entry.name}</strong><span className="taxonomy-meta">{entry.references.activeAssets} 件物品</span><details className="row-menu"><summary aria-label={entry.name+'的更多操作'}>•••</summary><div><button type="button" disabled={busy} onClick={()=>{setDraftName(entry.name);setRowError(null);onStartEdit();setMode('edit')}}>编辑名称与图标</button><button type="button" className="danger" disabled={busy} onClick={event=>{event.currentTarget.closest('details')?.removeAttribute('open');onRemove()}}>移除…</button></div></details></li>;
  }

  return (
    <li>
      <div className="taxonomy-edit-row">
        <input
          ref={nameInputRef}
          type="text"
          value={draftName}
          disabled={busy}
          onChange={(event) => setDraftName(event.target.value)}
          aria-label={`${entry.name} 的新名称`}
          aria-invalid={!!rowError}
          aria-describedby={rowError ? `edit-${entry.id}-err` : undefined}
          onKeyDown={(event) => {
            if (busy) return;
            if (event.key === "Enter") {
              event.preventDefault();
              void saveDraft();
            } else if (event.key === "Escape") {
              event.preventDefault();
              setMode("view");
              setRowError(null);
              onCancelEdit();
            }
          }}
        />
        <span aria-live="polite" id={`edit-${entry.id}-err`} className="taxonomy-help" data-state={rowError ? "error" : undefined}>
          {rowError ?? "按 Enter 保存，Esc 取消"}
        </span>
        <button type="button" disabled={busy} onClick={() => void saveDraft()}>
          保存
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setMode("view");
            setRowError(null);
            onCancelEdit();
          }}
        >
          取消
        </button>
        <button
          type="button"
          className="danger"
          disabled={busy}
          onClick={(event) => { event.currentTarget.focus(); onRemove(); }}
          aria-label={`移除 ${entry.name}`}
        >
          移除
        </button>
      </div>
      {kind === "category" ? (
        <div style={{ gridColumn: "1 / -1" }}>
          <small className="muted small">图标即时保存；名称需单独保存</small>
          <IconPicker
            value={entry.icon ?? "box"}
            name={entry.name}
            disabled={busy}
            onChange={(value) => {
              void commitIconChange(value);
            }}
          />
        </div>
      ) : null}
    </li>
  );
}

interface RemoveDialogProps {
  snapshot: TaxonomySnapshot | null;
  target: RemoveTarget;
  initialChoice: string | null | undefined;
  locked: boolean;
  message: string;
  onReload: () => void;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (targetId: string | null) => Promise<void>;
}

function RemoveDialog({
  snapshot,
  target,
  initialChoice,
  busy,
  locked,
  message,
  onReload,
  onCancel,
  onConfirm,
}: RemoveDialogProps) {
  const [choice, setChoice] = useState<string | null | undefined>(initialChoice);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const ref = useRef<HTMLDialogElement | null>(null);
  const others = otherEntries(snapshot, target.kind, target.id);
  const nullLabel = target.kind === "category" ? "未分类" : "未记录";
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const trigger = document.activeElement as HTMLElement | null;
    if (!node.open) node.showModal();
    const firstFocus = node.querySelector<HTMLElement>('input[name="target"]');
    firstFocus?.focus();
    return () => {
      if (node.open) node.close();
      requestAnimationFrame(() => {
        if (trigger?.isConnected) trigger.focus();
        else document.getElementById("taxonomy-tab-category")?.focus();
      });
    };
  }, []);

  async function submit() {
    if (busy || locked || choice === undefined) return;
    if (choice === null) {
      await onConfirm(null);
      return;
    }
    if (choice === target.id) {
      setConfirmError("无法迁移到自身，请选择其他目标。");
      return;
    }
    if (!others.some((entry) => entry.id === choice)) {
      setConfirmError("选中的目标已不再可用。");
      return;
    }
    await onConfirm(choice);
  }

  return (
    <dialog
      ref={ref}
      className="taxonomy-confirm"
      aria-labelledby="taxonomy-confirm-title"
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)')];
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <p className="taxonomy-eyebrow">
        移除 {target.kind === "category" ? "分类" : "购买渠道"}
      </p>
      <h2 id="taxonomy-confirm-title">确定要移除「{target.name}」吗？</h2>
      <p className="muted small">
        这些引用将迁移到你指定的目标；选「{nullLabel}」则改为未分类/未记录，不会删除任何物品。
      </p>
      <div className="taxonomy-stats" aria-label="当前引用统计">
        <span><strong>正常资产引用：</strong>{target.referenceCount}</span>
        <span><strong>最近删除引用：</strong>{target.deletedReferenceCount}</span>
        {target.kind === "category" ? <span><strong>进行中心愿：</strong>{target.ongoingWishlistCount}</span> : null}
        {target.kind === "category" ? <span><strong>已放弃心愿：</strong>{target.abandonedWishlistCount}</span> : null}
        <span><strong>合计：</strong>{target.referenceCount + target.deletedReferenceCount + target.ongoingWishlistCount + target.abandonedWishlistCount}</span>
      </div>
      <div className="taxonomy-choices" role="radiogroup" aria-label="选择迁移目标">
        <label data-selected={choice === null}>
          <input
            type="radio"
            name="target"
            value="__null__"
            checked={choice === null}
            disabled={busy}
            onChange={() => {
              setConfirmError(null);
              setChoice(null);
            }}
          />
          {nullLabel}
        </label>
        {others.map((entry) => (
          <label key={entry.id} data-selected={choice === entry.id}>
            <input
              type="radio"
              name="target"
              value={entry.id}
              checked={choice === entry.id}
              disabled={busy}
              onChange={() => {
                setConfirmError(null);
                setChoice(entry.id);
              }}
            />
            {entry.name}
          </label>
        ))}
      </div>
      {confirmError ? (
        <p className="taxonomy-notice" data-state="error" role="alert">
          <strong>无法继续</strong>
          <span>{confirmError}</span>
        </p>
      ) : null}
      {message && <p role="alert" className="taxonomy-select-hint">{message}</p>}
      {locked && <button type="button" disabled={busy} onClick={onReload}>重新加载并核对</button>}
      <footer>
        <button type="button" disabled={busy} onClick={onCancel}>
          取消
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy || locked || choice === undefined}
          onClick={() => {
            setConfirmError(null);
            void submit();
          }}
        >
          {busy ? "正在迁移…" : "迁移并移除"}
        </button>
      </footer>
    </dialog>
  );
}

export default function TaxonomyManager({
  snapshot,
  loading,
  loadError,
  onReload,
  validateName,
  onCommand,
  onDirtyChange,
}: TaxonomyManagerProps) {
  const [kind, setKind] = useState<TaxonomyKind>("category");
  const [draft, setDraft] = useState<DraftState>(blankDraft());
  const [draftError, setDraftError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog>(INITIAL_CONFIRM);
  const [unverified, setUnverified] = useState<{ kind: TaxonomyKind | null; id: string | null } | null>(null);
  const [notice, setNotice] = useState<NoticeState>({ text: "", state: "info" });
  const [blocked, setBlocked] = useState<{ message: string } | null>(null);
  const [pendingTabDraft, setPendingTabDraft] = useState<{
    kind: TaxonomyKind;
    draft: DraftState;
  } | null>(null);

  const [reloading, setReloading] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const inFlight = useRef(false);
  const editingRows = useRef(new Set<string>());
  const [editingCount, setEditingCount] = useState(0);
  useEffect(() => { onDirtyChange?.(confirmDialog.open || submitting || !!blocked || !!unverified); }, [draft.name, editingCount, confirmDialog.open, submitting, blocked, unverified, onDirtyChange]);
  useEffect(() => {
    if (!snapshot || loading) return;
    const ids = new Set([...snapshot.categories, ...snapshot.channels].map(e => e.id));
    for (const id of editingRows.current) if (!ids.has(id)) editingRows.current.delete(id);
    setEditingCount(editingRows.current.size);
    if (confirmDialog.target && !ids.has(confirmDialog.target.id)) setConfirmDialog(INITIAL_CONFIRM);
  }, [snapshot, loading, confirmDialog.target]);
  const entries = entryList(snapshot, kind);
  const unavailable = submitting || reloading || loading || snapshot === null || loadError !== null;
  const draftRef = useRef(draft);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  // 切换页签直接丢弃未提交输入；已发出的请求须先核对。
  function changeKind(next: TaxonomyKind) {
    if (next === kind) return;
    const hasDraft = normalizeName(draft.name) !== "" || editingRows.current.size > 0;
    if (inFlight.current) {
      setNotice({
        text: "请等待当前提交完成，再切换页签。",
        state: "error",
      });
      return;
    }
    editingRows.current.clear(); setEditingCount(0);
    setKind(next);
    requestAnimationFrame(() => document.getElementById("taxonomy-tab-" + next)?.focus());
    setDraft(blankDraft());
    setDraftError(null);
  }

  function noticeForResult(command: TaxonomyCommand, result: CommandResult): NoticeState {
    if (result.status === "success") {
      const label = commandLabel(command);
      return {
        text: command.type === "remove"
          ? `已迁移引用并移除。${label}`
          : `已保存：${label}`,
        state: "info",
      };
    }
    return {
      text: result.message + (result.recovery === "reload" ? "建议重新加载后再操作。" : ""),
      state: "error",
    };
  }

  const locked = blocked !== null || unverified !== null;

  async function runCommand(command: TaxonomyCommand): Promise<CommandResult> {
    if (locked) {
      setNotice({ text: "当前操作结果待核对，请先重新加载。", state: "error" });
      return { status: "error", message: "locked", recovery: "reload" };
    }
    if (inFlight.current || unavailable) {
      return { status: "error", message: "请等待当前操作完成。", recovery: "retry" };
    }
    inFlight.current = true;
    setSubmitting(true);
    try {
      const result = await onCommand(command);
      handleResult(command, result);
      return result;
    } catch (error) {
      const message = (error as Error).message || "提交未完成。";
      const result: CommandResult = { status: "error", message, recovery: "reload" };
      handleResult(command, result);
      return result;
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  function handleResult(command: TaxonomyCommand, result: CommandResult): void {
    if (result.status === "success") {
      if (command.type === "create") {
        setDraft(blankDraft());
        setPendingTabDraft(null);
      }
      setNotice(noticeForResult(command, result));
      setBlocked(null);
      setUnverified(null);
      return;
    }
    if (result.recovery === "reload") {
      setBlocked({ message: result.message });
      setUnverified({ kind: command.type === "create" ? null : extractKind(command), id: extractId(command) });
    } else {
      setNotice({ text: result.message, state: "error" });
    }
  }

  async function clearBlockedAndReload() {
    if (inFlight.current) return;
    inFlight.current = true;
    setReloading(true);
    try {
      // Resolve only on a successful read; failures must reject.
      await onReload();
      setReloadVersion(version => version + 1);
      setBlocked(null);
      setUnverified(null);
      setNotice({ text: "已重新加载，请核对当前输入后再保存。", state: "info" });
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : "重新加载失败。", state: "error" });
    } finally {
      inFlight.current = false;
      setReloading(false);
    }
  }

  async function submitCreate() {
    const trimmed = normalizeName(draft.name);
    const error = validateName(kind, trimmed);
    if (error) {
      setDraftError(error);
      return;
    }
    const command: TaxonomyCommand = {
      type: "create",
      kind,
      name: trimmed,
      ...(kind === "category" ? { icon: draft.icon } : {}),
    };
    const result = await runCommand(command);
    if (result.status !== "success") {
      setPendingTabDraft({ kind, draft });
    } else {
      setPendingTabDraft(null);
    }
  }

  async function submitRename(entry: TaxonomyEntry, next: string) {
    const error = validateName(kind, next, entry.id);
    if (error) {
      throw new Error(error);
    }
    const command: TaxonomyCommand = { type: "rename", kind, id: entry.id, name: next };
    const result = await runCommand(command);
    if (result.status !== "success") throw new Error(result.message);
  }

  async function submitIcon(entry: TaxonomyEntry, icon: CategoryIcon) {
    if (kind !== "category") return;
    const command: TaxonomyCommand = { type: "set-icon", id: entry.id, icon };
    const result = await runCommand(command);
    if (result.status !== "success") throw new Error(result.message);
  }

  async function reorder(entry:TaxonomyEntry,targetId:string) {
    const ids=entries.map(e=>e.id),from=ids.indexOf(entry.id),to=ids.indexOf(targetId);
    if(from<0||to<0||from===to)return;
    ids.splice(from,1);ids.splice(to,0,entry.id);
    await runCommand({type:'reorder',kind,ids});
  }
  async function move(entry:TaxonomyEntry,direction:'up'|'down') {
    const index=entries.findIndex(e=>e.id===entry.id),target=entries[index+(direction==='up'?-1:1)];
    if(target)await reorder(entry,target.id);
  }

  function requestRemove(entry: TaxonomyEntry) {
    if (locked) {
      setNotice({ text: "当前操作结果待核对，请先重新加载。", state: "error" });
      return;
    }
    setConfirmDialog({
      open: true,
      busy: false,
      choice: null,
      target: {
        id: entry.id,
        kind,
        name: entry.name,
        referenceCount: entry.references.activeAssets,
        deletedReferenceCount: entry.references.deletedAssets,
        ongoingWishlistCount: entry.references.ongoingWishlist ?? 0,
        abandonedWishlistCount: entry.references.abandonedWishlist ?? 0,
      },
    });
  }

  async function confirmRemove(targetId: string | null) {
    const target = confirmDialog.target;
    if (!target) return;
    setConfirmDialog((prev) => ({ ...prev, busy: true }));
    const command: TaxonomyCommand = {
      type: "remove",
      kind: target.kind,
      id: target.id,
      targetId,
    };
    const result = await runCommand(command);
    if (result.status === "success") {
      setConfirmDialog(INITIAL_CONFIRM);
    } else {
      setConfirmDialog((prev) => ({ ...prev, busy: false }));
    }
  }

  const reloadControl = (
    <button type="button" onClick={() => void clearBlockedAndReload()} disabled={loading || reloading}>
      {reloading || loading ? "正在加载…" : "重新加载"}
    </button>
  );

  return (
    <section className="taxonomy-shell" aria-labelledby="taxonomy-heading">
      <header>
        <p className="taxonomy-eyebrow">设置</p>
        <h1 id="taxonomy-heading">分类与购买渠道</h1>
        <p className="taxonomy-lede">
          整理物品的分类，记录每件物品从哪里购入。
        </p>
      </header>

      <div className="taxonomy-tabs" role="tablist" aria-label="分类与渠道">
        {KIND_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            id={`taxonomy-tab-${tab.value}`}
            aria-selected={kind === tab.value}
            aria-controls={`taxonomy-tabpanel-${tab.value}`}
            tabIndex={kind === tab.value ? 0 : -1}
            onKeyDown={(event) => {
              if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                event.preventDefault();
                const next = event.key === "Home" ? "category" : event.key === "End" ? "channel" : kind === "category" ? "channel" : "category";
                changeKind(next);
              }
            }}
            className="taxonomy-tab"
            onClick={() => changeKind(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <section
        id={`taxonomy-tabpanel-${kind}`}
        role="tabpanel"
        aria-labelledby={`taxonomy-tab-${kind}`}
        className="taxonomy-panel"
      >
        <p className="taxonomy-status" data-state={loadError ? "error" : undefined}>
          <span>

            {loading ? "正在加载…" : snapshot ? `共 ${entries.length} 项。` : "尚未加载。"}
          </span>
          {loadError ? <span aria-live="polite">加载失败：{loadError}</span> : null}
          {loadError ? reloadControl : null}
        </p>

        {blocked ? (
          <div className="taxonomy-locked" role="alert">
            <strong>当前操作结果待核对。</strong>
            <span>{blocked.message}</span>
            <button type="button" disabled={reloading || loading} onClick={() => void clearBlockedAndReload()}>
              重新加载并核对
            </button>
          </div>
        ) : null}

        {notice.text ? (
          <p
            className="taxonomy-notice"
            data-state={notice.state === "error" ? "error" : undefined}
            role="status"
          >
            <strong>{notice.state === "error" ? "结果" : "完成"}</strong>
            <span>{notice.text}</span>
          </p>
        ) : null}

        <form
          className="taxonomy-fields"
          aria-label={`新建${kind === "category" ? "分类" : "购买渠道"}`}
          onSubmit={(event) => {
            event.preventDefault();
            if (locked || unavailable) return;
            void submitCreate();
          }}
        >
          <div className="taxonomy-field">
            <label htmlFor="taxonomy-new-name">名称</label>
            <input
              id="taxonomy-new-name"
              type="text"
              value={draft.name}
              onChange={(event) => {
                setDraft((prev) => ({ ...prev, name: event.target.value }));
                setDraftError(null);
              }}
              placeholder={kind === "category" ? "例如：家电" : "例如：京东"}
              aria-invalid={!!draftError}
              aria-describedby={draftError ? "taxonomy-new-help" : "taxonomy-new-helper"}
              disabled={unavailable || locked}
            />
            <button type="submit" className="primary taxonomy-create-button" disabled={unavailable||locked||!normalizeName(draft.name)}>{submitting?'正在保存…':kind==='category'?'新建分类':'新建购买渠道'}</button>
            <span
              id={draftError ? "taxonomy-new-help" : "taxonomy-new-helper"}
              className="taxonomy-help"
              data-state={draftError ? "error" : undefined}
              role={draftError ? "alert" : undefined}
            >
              {draftError ?? "名称可随时更正"}
            </span>
          </div>
          {kind === "category" ? (
            <div className="taxonomy-field">
              <span className="taxonomy-eyebrow" id="taxonomy-icon-label">
                图标
              </span>
              <IconPicker
                name="新建分类"
                value={draft.icon}
                disabled={unavailable || locked}
                onChange={(value) =>
                  setDraft((prev) => ({ ...prev, icon: value }))
                }
              />
              <span className="taxonomy-help">
                {findCategoryIcon(draft.icon).label}
              </span>
            </div>
          ) : (
            <div />
          )}

        </form>

        {loading && !snapshot ? <p role="status">正在加载…</p> : !snapshot ? <p>暂时无法读取，请重新加载。</p> : entries.length === 0 ? (
          <div className="taxonomy-empty">
            还没有{kind === "category" ? "分类" : "购买渠道"}。在上方添加第一项。
          </div>
        ) : (
          <ul className="taxonomy-list" aria-label={`${kind === "category" ? "分类" : "购买渠道"} 列表`}>
            {entries.map((entry, index) => (
              <ListRow
                key={entry.id}
                entry={entry}
                kind={kind}
                busy={unavailable || locked}
                reloadVersion={reloadVersion}
                isFirst={index === 0}
                isLast={index === entries.length - 1}
                onChangeIcon={(icon) => submitIcon(entry, icon)}
                onMove={(direction) => move(entry, direction)}
                onDrop={target=>void reorder(entry,target)}
                onRemove={() => requestRemove(entry)}
                onSave={async (next) => {
                  await submitRename(entry, next);
                }}
                onStartEdit={() => {
                  editingRows.current.add(entry.id); setEditingCount(editingRows.current.size);
                }}
                onCancelEdit={() => {
                  editingRows.current.delete(entry.id); setEditingCount(editingRows.current.size);
                }}
              />
            ))}
          </ul>
        )}
      </section>

      {pendingTabDraft ? null : null}

      {confirmDialog.open && confirmDialog.target ? (
        <RemoveDialog
          snapshot={snapshot}
          target={(() => {
            const current = entryList(snapshot,confirmDialog.target.kind).find(e => e.id === confirmDialog.target!.id);
            return current ? {...confirmDialog.target,name:current.name,referenceCount:current.references.activeAssets,deletedReferenceCount:current.references.deletedAssets,ongoingWishlistCount:current.references.ongoingWishlist ?? 0,abandonedWishlistCount:current.references.abandonedWishlist ?? 0} : confirmDialog.target;
          })()}
          initialChoice={undefined}
          busy={confirmDialog.busy || submitting || reloading || loading}
          locked={locked}
          message={blocked?.message ?? (notice.state === "error" ? notice.text : "")}
          onReload={() => void clearBlockedAndReload()}
          onCancel={() => {
            if (inFlight.current) return;
            setConfirmDialog(INITIAL_CONFIRM);
            setNotice({ text: "已取消移除。", state: "info" });
          }}
          onConfirm={(choice) => confirmRemove(choice)}
        />
      ) : null}
    </section>
  );
}

function extractKind(command: TaxonomyCommand): TaxonomyKind | null {
  switch (command.type) {
    case "reorder":
    case "create":
    case "rename":
    case "remove":
      return command.kind;
    default:
      return null;
  }
}

function extractId(command: TaxonomyCommand): string | null {
  switch (command.type) {
    case "rename":
    case "set-icon":
    case "move-category":
    case "remove":
      return command.id;
    default:
      return null;
  }
}

function commandLabel(command: TaxonomyCommand): string {
  switch (command.type) {
    case "create":
      return `新建（${command.name}）`;
    case "rename":
      return `改名（${command.name}）`;
    case "set-icon":
      return "更新分类图标";
    case "move-category":
    case "reorder":
      return "调整顺序";
    case "remove":
      return "移除并迁移引用";
    default:
      return "更新";
  }
}
