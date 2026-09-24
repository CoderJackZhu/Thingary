import { useId } from "react";
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

export function CategoryFilter({
  entries,
  value,
  onChange,
  disabled,
  id,
}: CategoryFilterProps) {
  const groupId = `${id}-group`;
  const labelId = `${id}-label`;
  const heading = "分类筛选";
  return (
    <div className="taxonomy-field" data-component="category-filter">
      <span id={labelId} className="taxonomy-eyebrow">
        {heading}
      </span>
      <div
        id={id}
        role="group"
        aria-labelledby={labelId}
        className="taxonomy-segmented"
        data-disabled={disabled ? "true" : undefined}
        onKeyDown={(event) => {
          // 让方向键可在 segmented 之间循环；显式留给父级管理滚动，
          // 这里只保留 Enter/Space 默认行为
          if (event.key === "ArrowRight" || event.key === "ArrowDown") {
            event.preventDefault();
            const buttons = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>(
                'button:not([disabled])',
              ),
            );
            if (!buttons.length) return;
            const current = document.activeElement as HTMLButtonElement | null;
            const idx = current ? buttons.indexOf(current) : -1;
            const next = buttons[(idx + 1 + buttons.length) % buttons.length];
            next?.focus();
          } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
            event.preventDefault();
            const buttons = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>(
                'button:not([disabled])',
              ),
            );
            if (!buttons.length) return;
            const current = document.activeElement as HTMLButtonElement | null;
            const idx = current ? buttons.indexOf(current) : -1;
            const next = buttons[(idx - 1 + buttons.length) % buttons.length];
            next?.focus();
          }
        }}
      >
        <SegmentButton
          disabled={disabled}
          ariaLabel="全部分类"
          label="全部分类"
          pressed={value.mode === "all"}
          onSelect={() => {
            if (!isSameTarget(value, { mode: "all" } as CategoryFilterValue)) {
              onChange({ mode: "all" });
            }
          }}
        />
        <SegmentButton
          disabled={disabled}
          ariaLabel={UNCATEGORIZED_LABEL}
          label={UNCATEGORIZED_LABEL}
          pressed={value.mode === "uncategorized"}
          onSelect={() => {
            if (!isSameTarget(value, { mode: "uncategorized" } as CategoryFilterValue)) {
              onChange({ mode: "uncategorized" });
            }
          }}
        />
        {entries.map((entry) => {
          const current: CategoryFilterValue = { mode: "category", id: entry.id };
          const selected = value.mode === "category" && value.id === entry.id;
          return (
            <SegmentButton
          disabled={disabled}
              key={entry.id}
              ariaLabel={`仅看分类 ${entry.name}`}
              label={entry.name}
              pressed={selected}
              onSelect={() => {
                if (!isSameTarget(value, current)) onChange(current);
              }}
            />
          );
        })}
      </div>
      <span id={groupId} className="taxonomy-help">
        当前：{targetLabel(value, entries)}
      </span>
    </div>
  );
}
