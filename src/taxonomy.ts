// Public contracts for the T06a classification and purchase-channel UI.
//
// The integration target in T06b will own the canonical snapshot and the
// real reference counts; this file intentionally exposes only the surface
// the front-end components need plus a few pure helpers the in-memory
// preview uses (and which the eventual adapter is free to replace).

export type TaxonomyKind = "category" | "channel";

export type CategoryIcon =
  | "box"
  | "computer"
  | "phone"
  | "camera"
  | "audio"
  | "home";

export interface CategoryIconDescriptor {
  readonly value: CategoryIcon;
  readonly label: string; // 中文标签，保证可见焦点与 ARIA 名称稳定
}

export const CATEGORY_ICONS: readonly CategoryIconDescriptor[] = [
  { value: "box", label: "通用" },
  { value: "computer", label: "电脑" },
  { value: "phone", label: "手机" },
  { value: "camera", label: "摄影" },
  { value: "audio", label: "音频" },
  { value: "home", label: "家电" },
];

export function findCategoryIcon(value: CategoryIcon): CategoryIconDescriptor {
  return CATEGORY_ICONS.find((icon) => icon.value === value) ?? CATEGORY_ICONS[0];
}

export interface TaxonomyEntry {
  id: string;
  name: string;
  icon?: CategoryIcon;
  references: {
    activeAssets: number;
    deletedAssets: number;
  };
}

export interface TaxonomySnapshot {
  readonly categories: readonly TaxonomyEntry[];
  readonly channels: readonly TaxonomyEntry[];
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
  // Resolve after a successful read; reject on failure. Keep the previous snapshot while reloading.
  onReload: () => Promise<void>;
  validateName: (
    kind: TaxonomyKind,
    name: string,
    editingId?: string,
  ) => string | null;
  onCommand: (command: TaxonomyCommand) => Promise<CommandResult>;
}

export interface CategorySelectProps {
  entries: readonly TaxonomyEntry[];
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
  id: string;
}

export interface ChannelSelectProps {
  entries: readonly TaxonomyEntry[];
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
  id: string;
}

export type CategoryFilterValue =
  | { mode: "all" }
  | { mode: "uncategorized" }
  | { mode: "category"; id: string };

export interface CategoryFilterProps {
  entries: readonly TaxonomyEntry[];
  value: CategoryFilterValue;
  onChange: (value: CategoryFilterValue) => void;
  disabled?: boolean;
  id: string;
}

// 演示态使用的纯函数，适配器可替换
export function normalizeName(input: string): string {
  return input.trim().normalize("NFC");
}

export function isDuplicateName(
  entries: readonly TaxonomyEntry[],
  name: string,
  editingId?: string,
): boolean {
  const normalized = normalizeName(name).replace(/[A-Z]/g, (c) => c.toLowerCase());
  return entries.some(
    (entry) =>
      entry.id !== editingId &&
      normalizeName(entry.name).replace(/[A-Z]/g, (c) => c.toLowerCase()) === normalized,
  );
}

// Development-preview data only. Production transactions belong to T06b.
export interface PreviewAssetReference {
  id: string;
  categoryId: string | null;
  channelId: string | null;
  deleted: boolean;
}
export interface PreviewCatalog {
  categories: TaxonomyEntry[];
  channels: TaxonomyEntry[];
  assets: PreviewAssetReference[];
}
export function previewSnapshot(catalog: PreviewCatalog): TaxonomySnapshot {
  const entries = (kind: TaxonomyKind) => {
    const field = kind === "category" ? "categoryId" : "channelId";
    return catalog[kind === "category" ? "categories" : "channels"].map(entry => ({
      ...entry,
      references: {
        activeAssets: catalog.assets.filter(a => a[field] === entry.id && !a.deleted).length,
        deletedAssets: catalog.assets.filter(a => a[field] === entry.id && a.deleted).length,
      },
    }));
  };
  return { categories: entries("category"), channels: entries("channel") };
}

export function validatePreviewName(entries: readonly TaxonomyEntry[], kind: TaxonomyKind, name: string, editingId?: string): string | null {
  const normalized = normalizeName(name);
  if (!normalized) return "请填写名称。";
  if (normalized === (kind === "category" ? "未分类" : "未记录")) return "这是未选择时的显示名称，请换一个名称。";
  return isDuplicateName(entries, normalized, editingId) ? "已有同名项，请更换。" : null;
}

export function applyPreviewCommand(source: PreviewCatalog, command: TaxonomyCommand, newId?: string): PreviewCatalog {
  const catalog = structuredClone(source);
  const kind = "kind" in command ? command.kind : "category";
  const key = kind === "category" ? "categories" : "channels";
  const entries = catalog[key];
  if (command.type === "create" || command.type === "rename") {
    const error = validatePreviewName(entries, kind, command.name, command.type === "rename" ? command.id : undefined);
    if (error) throw new Error(error);
  }
  if (command.type === "create") {
    if (!newId || entries.some(e => e.id === newId)) throw new Error("新建标识无效。");
    entries.push({ id: newId, name: normalizeName(command.name), ...(kind === "category" ? { icon: command.icon ?? "box" } : {}), references: { activeAssets: 0, deletedAssets: 0 } });
    return catalog;
  }
  const index = entries.findIndex(e => e.id === command.id);
  if (index < 0) throw new Error("目标已不可用，请重新加载。");
  switch (command.type) {
    case "rename": entries[index].name = normalizeName(command.name); break;
    case "set-icon": entries[index].icon = command.icon; break;
    case "move-category": {
      const target = index + (command.direction === "up" ? -1 : 1);
      if (target >= 0 && target < entries.length) [entries[index], entries[target]] = [entries[target], entries[index]];
      break;
    }
    case "remove": {
      if (command.targetId === command.id || (command.targetId !== null && !entries.some(e => e.id === command.targetId))) throw new Error("请选择有效的迁移目标。");
      const field = kind === "category" ? "categoryId" : "channelId";
      for (const asset of catalog.assets) if (asset[field] === command.id) asset[field] = command.targetId;
      entries.splice(index, 1);
      break;
    }
  }
  return catalog;
}
