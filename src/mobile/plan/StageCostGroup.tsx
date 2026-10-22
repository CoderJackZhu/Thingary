import { useState } from "react";
import type { StoredSpendItem } from "../../plan";
import { hundredthsToPct } from "../../plan";
import type { Draft } from "../../planning-basic-forms";
import { withSpendItem, withoutSpendItem } from "../../planning-basic-forms";
import { moneyText } from "../format";
import {
  Button,
  FormGroup,
  FormRow,
  Icon,
  MoneyField,
  Notice,
  SelectField,
  Switch,
  TextField,
} from "../ui";
import { MonthField } from "./fields";
import { childEndMonth, stageCost } from "./events-model";
import "./events.css";

const MAX_ITEMS = 20;
const TEMPLATES = ["子女教育", "赡养父母", "医疗与护理"];
type Form = {
  /** Set while editing an existing row; null for a new one. */
  editId: string | null;
  label: string;
  monthly: string;
  start: string;
  end: string;
  inflation: string;
  essential: boolean;
};
const blank: Form = {
  editId: null,
  label: "子女教育",
  monthly: "",
  start: "",
  end: "",
  inflation: "",
  essential: true,
};
const formOf = (i: StoredSpendItem): Form => ({
  editId: i.id,
  label: i.label,
  monthly: i.monthly_cents,
  start: i.start_month ?? "",
  end: i.end_month ?? "",
  inflation:
    i.inflation_hundredths === null
      ? ""
      : hundredthsToPct(i.inflation_hundredths),
  essential: i.essential,
});

/** One row's period: unset ends read as the target month / planning end, never as a blank. */
export const stagePeriod = (i: StoredSpendItem) =>
  `${i.start_month ?? "目标月份起"} → ${i.end_month ?? "规划终点"}`;

/**
 * 退休后的阶段性支出, inside the budget step as on desktop. It edits the setup draft only: items are written by the same
 * save as the rest of the step (setupFields carries them as the budget section), so nothing is saved on its own.
 */
export function StageCostGroup({
  d,
  patch,
  frozen,
  targetMonth,
}: {
  d: Draft;
  patch: (v: Partial<Draft>) => void;
  frozen: boolean;
  targetMonth: string | null;
}) {
  const [open, setOpen] = useState(d.spendItems.length > 0),
    [form, setForm] = useState<Form | null>(null),
    [birth, setBirth] = useState(""),
    [age, setAge] = useState("22"),
    [error, setError] = useState("");
  const expanded = open || form !== null;
  const set = (v: Partial<Form>) => setForm((x) => (x ? { ...x, ...v } : x));
  const changeChild = (b: string, a: string) => {
    setBirth(b);
    setAge(a);
    const end = childEndMonth(b, a);
    if (end) set({ end });
  };
  const close = () => {
    setForm(null);
    setError("");
  };
  function submit() {
    if (!form) return;
    try {
      const row = stageCost({
        id: form.editId ?? crypto.randomUUID(),
        ...form,
      });
      patch(
        form.editId
          ? {
              spendItems: d.spendItems.map((i) =>
                i.id === form.editId ? row : i,
              ),
            }
          : withSpendItem(d, row),
      );
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  return (
    <section className="mp-stage" aria-label="退休后的阶段性支出">
      <button
        type="button"
        className="mp-stage-toggle"
        aria-expanded={expanded}
        disabled={form !== null}
        onClick={() => setOpen(!open)}
      >
        <span>
          退休后另有阶段性支出（选填）
          {d.spendItems.length > 0 && (
            <small>已填 {d.spendItems.length} 笔</small>
          )}
        </span>
        <Icon name={expanded ? "chevronUp" : "chevronDown"} size={18} />
      </button>
      {expanded && (
        <div className="mp-stage-body">
          <p className="mp-event-help">
            例如退休后还要供孩子上学、赡养父母或护理费用。只计退休后的月份，额外叠加在生活费上，所以生活费总额里不要再包含。
          </p>
          {d.spendItems.length > 0 && (
            <ul className="mp-stage-list" aria-label="已填的阶段性支出">
              {d.spendItems.map((row) => (
                <li key={row.id}>
                  <span className="mp-stage-text">
                    <strong>{row.label}</strong>
                    <small>
                      {stagePeriod(row)}
                      {row.time_unconfirmed ? " · 请确认起止月份" : ""}
                    </small>
                    <small>
                      {row.essential ? "必需" : "灵活"}
                      {row.inflation_hundredths === null
                        ? " · 跟随通胀"
                        : ` · 每年上涨 ${hundredthsToPct(row.inflation_hundredths)}%`}
                    </small>
                  </span>
                  <span className="mp-stage-side">
                    <b>{moneyText(row.monthly_cents)}/月</b>
                    <span className="mp-stage-actions">
                      <button
                        type="button"
                        className="mp-coverage-go"
                        aria-label={`编辑${row.label}`}
                        disabled={frozen || form !== null}
                        onClick={() => {
                          setForm(formOf(row));
                          setError("");
                        }}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        className="mp-coverage-go"
                        aria-label={`删除${row.label}`}
                        disabled={frozen || form !== null}
                        onClick={() => patch(withoutSpendItem(d, row.id))}
                      >
                        删除
                      </button>
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {!form ? (
            <>
              <Button
                disabled={frozen || d.spendItems.length >= MAX_ITEMS}
                onClick={() => {
                  setForm({ ...blank });
                  setBirth("");
                  setAge("22");
                  setError("");
                }}
              >
                添加一笔阶段性支出
              </Button>
              {d.spendItems.length >= MAX_ITEMS && (
                <p className="mp-event-help">最多 {MAX_ITEMS} 项。</p>
              )}
            </>
          ) : (
            <div className="mp-event-editor">
              <FormGroup
                title={form.editId ? "修改阶段性支出" : "新的阶段性支出"}
              >
                <SelectField
                  label="支出模板"
                  value={TEMPLATES.includes(form.label) ? form.label : "其他"}
                  disabled={frozen}
                  options={[...TEMPLATES, "其他"].map((label) => ({
                    id: label,
                    label,
                  }))}
                  onChange={(label) => set({ label })}
                />
                <TextField
                  label="阶段性支出名称"
                  value={form.label}
                  disabled={frozen}
                  onChange={(label) => set({ label })}
                />
                <MoneyField
                  label="阶段性支出每月金额"
                  value={form.monthly}
                  disabled={frozen}
                  onChange={(monthly) => set({ monthly })}
                />
                {form.label === "子女教育" && !form.editId && (
                  <>
                    <MonthField
                      label="孩子出生年月"
                      value={birth}
                      disabled={frozen}
                      onChange={(v) => changeChild(v, age)}
                    />
                    <TextField
                      label="负担到孩子几岁"
                      value={age}
                      inputMode="numeric"
                      disabled={frozen}
                      onChange={(v) => changeChild(birth, v)}
                      hint="仅用于换算结束月份，孩子资料不保存。"
                    />
                  </>
                )}
                <MonthField
                  label="支出开始月份"
                  value={form.start}
                  hint="留空从目标月份开始"
                  disabled={frozen}
                  onChange={(start) => set({ start })}
                />
                <MonthField
                  label="支出结束月份"
                  value={form.end}
                  hint="留空到规划终点；可覆盖孩子年龄的换算结果。"
                  disabled={frozen}
                  onChange={(end) => set({ end })}
                />
                <TextField
                  label="支出每年上涨（%）"
                  value={form.inflation}
                  inputMode="decimal"
                  hint="留空跟随通胀；这是假设。"
                  disabled={frozen}
                  onChange={(inflation) => set({ inflation })}
                />
                <FormRow label="必需支出">
                  <Switch
                    label="阶段性支出必需"
                    checked={form.essential}
                    disabled={frozen}
                    onChange={(essential) => set({ essential })}
                  />
                </FormRow>
              </FormGroup>
              {form.end && targetMonth && form.end <= targetMonth && (
                <Notice>在退休目标月份前结束，不影响退休后的计算。</Notice>
              )}
              {error && <Notice tone="danger">{error}</Notice>}
              <div className="mp-event-actions">
                <Button disabled={frozen} onClick={close}>
                  取消
                </Button>
                <Button variant="primary" disabled={frozen} onClick={submit}>
                  {form.editId ? "更新这笔支出" : "加入这笔支出"}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
