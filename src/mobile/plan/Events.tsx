import { useEffect, useMemo, useRef, useState } from "react";
import type {
  PlanningSources,
  ProfileState,
  StoredLifeEvent,
} from "../../plan";
import { moneyText } from "../format";
import { pctToHundredths, hundredthsToPct } from "../../plan";
import { buildBasicCapabilities } from "../../plan-basic";
import { eventImpact, offsetOf, totalImpact } from "../../plan-events";
import { toEvent } from "../../plan-retire-calc";
import {
  canRetractOccurrence,
  retractOccurrence,
} from "../../plan-occurrence-actions";
import { occurrenceIssues } from "../../plan-core";
import type { Occurrence, Payment } from "../../plan-core";
import {
  Button,
  Card,
  DateField,
  FormGroup,
  FormRow,
  MoneyField,
  EmptyState,
  Notice,
  SelectField,
  Sheet,
  Switch,
  TextField,
} from "../ui";
import { usePlanSaver } from "./data";
import {
  childEndMonth,
  eventForKind,
  eventTemplate,
  eventTemplates,
  impactText,
  validateEvent,
} from "./events-model";
import "./events.css";

type Props = {
  sources: PlanningSources;
  saved: NonNullable<ProfileState["saved"]>;
  today: string;
  reload: () => void;
  /** The 添加 sheet is owned by the page that shows the + button. */
  picker?: boolean;
  onPicker?: (open: boolean) => void;
};
function MonthField({
  label,
  value,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <FormRow label={label} hint={hint} stacked>
      <input
        className="m-input"
        aria-label={label}
        type="month"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </FormRow>
  );
}
export default function Events({
  sources,
  saved,
  today,
  reload,
  picker,
  onPicker,
}: Props) {
  const saver = usePlanSaver(sources, reload),
    r = saved.profile.retire;
  const [editing, setEditing] = useState<StoredLifeEvent | null>(null),
    [occurring, setOccurring] = useState<StoredLifeEvent | null>(null),
    [confirm, setConfirm] = useState("");
  const locked = saver.busy || saver.stuck;
  const editRevision = useRef(saved.revision),
    occurrenceRevision = useRef(saved.revision);
  const caps = useMemo(() => buildBasicCapabilities(sources), [sources]);
  const prediction =
    caps.prediction.status === "ready" ? caps.prediction.value : null;
  const snapshot =
    sources.snapshot.status === "ready" ? sources.snapshot.value : null;
  const accounts =
    sources.accounts.status === "ready" ? sources.accounts.value : [];
  const issues = snapshot
    ? occurrenceIssues(snapshot, r.core, r.life_events, today)
    : [];
  const impacts = useMemo(() => {
    if (!prediction) return null;
    const P0 = {
      ...prediction.plan0,
      anchor_date: prediction.plan.anchor_date,
      core: r.core,
      basis_factor: prediction.plan.basis_factor,
      first_month_fraction: prediction.plan.first_month_fraction,
    };
    const future = r.life_events.filter(
      (e) =>
        e.date >= today.slice(0, 7) &&
        !r.core?.occurrences.some((o) => o.event_id === e.id),
    );
    try {
      return {
        items: future.map((e) => ({
          id: e.id,
          impact: eventImpact(
            P0,
            toEvent(e),
            offsetOf(e.date, prediction.plan.anchor_date ?? today),
            r.emergency_months * (prediction.plan.items[0]?.monthly_cents ?? 0),
          ),
        })),
        total: totalImpact(
          P0,
          future
            .filter((e) => e.included)
            .map((e) => ({
              e: toEvent(e),
              offset: offsetOf(e.date, prediction.plan.anchor_date ?? today),
            })),
        ),
      };
    } catch {
      return null;
    }
  }, [prediction, r, today]);
  useEffect(() => {
    if (editing && typeof document !== "undefined")
      document
        .getElementById("mp-event-editor")
        ?.scrollIntoView?.({ block: "start" });
  }, [editing?.id]);
  async function write(events: StoredLifeEvent[], expected = saved.revision) {
    return saver.save(
      {
        section: "events",
        fields: {
          life_events: events,
          occurrences: (r.core?.occurrences ?? []).filter((o) =>
            events.some((e) => e.id === o.event_id),
          ),
        },
      },
      expected,
    );
  }
  return (
    <div className="mp-events">
      {picker && onPicker && (
        <Sheet
          title="添加大额支出"
          cancelLabel="取消"
          onClose={() => onPicker(false)}
        >
          <div className="mp-event-picker">
            {eventTemplates.map((t) => (
              <Button
                key={t.id}
                disabled={locked || r.life_events.length >= 20 || !!editing}
                onClick={() => {
                  editRevision.current = saved.revision;
                  setEditing(
                    eventTemplate(
                      t.id,
                      today,
                      crypto.randomUUID(),
                      r.life_events.some(
                        (e) => e.kind === "house" && e.included,
                      ),
                    ),
                  );
                  onPicker(false);
                }}
              >
                {t.label}
              </Button>
            ))}
          </div>
        </Sheet>
      )}
      {!r.life_events.length && !editing && (
        <EmptyState
          icon="chart"
          title="还没有大额计划"
          message="买房、买车、装修这类大额支出，可以先设想一笔，看看对停工时间的影响。模板里的金额只是占位，请改成自己的估计。"
          action={
            onPicker && (
              <Button
                variant="primary"
                disabled={locked}
                onClick={() => onPicker(true)}
              >
                从模板添加
              </Button>
            )
          }
        />
      )}
      {r.life_events.map((e) => {
        const occurrence = r.core?.occurrences.find((o) => o.event_id === e.id);
        const impact = impacts?.items.find((i) => i.id === e.id)?.impact;
        return (
          <Card key={e.id} className="mp-event-card" label={e.label}>
            <div className="mp-event-head">
              <div>
                <h3>{e.label}</h3>
                <small>
                  {e.date} · {moneyText(e.price_cents)} ·{" "}
                  {e.included || occurrence?.status === "occurred"
                    ? "已计入"
                    : "未计入"}
                </small>
              </div>
              <Switch
                label={`计入${e.label}`}
                checked={e.included || occurrence?.status === "occurred"}
                disabled={locked || occurrence?.status === "occurred"}
                onChange={(included) =>
                  void write(
                    r.life_events.map((row) =>
                      row.id === e.id ? { ...row, included } : row,
                    ),
                  )
                }
              />
            </div>
            {occurrence && (
              <p className="mp-event-note">
                {occurrence.status === "occurred"
                  ? `已发生 · ${occurrence.actual_date}，按实际资料接续`
                  : `已取消 · ${occurrence.actual_date}`}
              </p>
            )}
            {e.time_unconfirmed && (
              <Notice>持有或循环终点待重设，这部分未计入。</Notice>
            )}
            {impact ? (
              <>
                <p className="mp-event-note">
                  {impactText(
                    impact.delay_months,
                    impact.base_fi,
                    impact.with_fi,
                  )}
                  。
                  {impact.short === 0
                    ? "预计现金足够"
                    : `预计现金还差 ${moneyText(String(Math.round(impact.short)))}`}
                  （含应急金线）。
                </p>
                {impact.payment_nominal > 0 && (
                  <p className="mp-event-note">
                    固定名义月供{" "}
                    {moneyText(String(Math.round(impact.payment_nominal)))}
                    ；买后每月约能存{" "}
                    {moneyText(String(Math.round(impact.saving_after)))}。
                  </p>
                )}
              </>
            ) : (
              <p className="mp-event-help">
                {occurrence?.status === "occurred"
                  ? "实际付款与剩余贷款继续计入。"
                  : "补齐规划与每月能存的钱后，可比较影响。"}
              </p>
            )}
            {issues
              .filter((i) => i.event_id === e.id)
              .map((i, n) => (
                <Notice key={n}>{i.message}</Notice>
              ))}
            <div className="mp-event-actions">
              <Button
                disabled={locked}
                onClick={() => {
                  editRevision.current = saved.revision;
                  setEditing(structuredClone(e));
                }}
              >
                编辑
              </Button>
              <Button
                disabled={locked}
                onClick={() => {
                  occurrenceRevision.current = saved.revision;
                  setOccurring(e);
                }}
              >
                发生核对
              </Button>
              {confirm === e.id ? (
                <>
                  <Button
                    variant="danger"
                    disabled={locked}
                    onClick={async () => {
                      if (
                        await write(
                          r.life_events.filter((row) => row.id !== e.id),
                        )
                      )
                        setConfirm("");
                    }}
                  >
                    确认删除
                  </Button>
                  <Button disabled={locked} onClick={() => setConfirm("")}>
                    取消删除
                  </Button>
                </>
              ) : (
                <Button
                  variant="plain"
                  disabled={locked || occurrence?.status === "occurred"}
                  onClick={() => setConfirm(e.id)}
                >
                  删除
                </Button>
              )}
            </div>
          </Card>
        );
      })}
      {impacts &&
        !r.core?.occurrences.some((o) => o.status === "occurred") &&
        r.life_events.some((e) => e.included) && (
          <p className="mp-event-help">
            全部计入的计划合计：
            {impactText(
              impacts.total.delay_months,
              impacts.total.base_fi,
              impacts.total.with_fi,
            )}
            。已经含在退休结论中。
          </p>
        )}
      {editing && (
        <EventEditor
          key={editing.id}
          value={editing}
          busy={locked}
          onCancel={() => setEditing(null)}
          onSave={async (event) => {
            const exists = r.life_events.some((e) => e.id === event.id);
            if (
              await write(
                exists
                  ? r.life_events.map((e) => (e.id === event.id ? event : e))
                  : [...r.life_events, event],
                editRevision.current,
              )
            )
              setEditing(null);
          }}
        />
      )}
      {occurring && (
        <OccurrenceEditor
          key={occurring.id}
          event={occurring}
          existing={r.core?.occurrences.find(
            (o) => o.event_id === occurring.id,
          )}
          snapshot={snapshot}
          accounts={accounts}
          today={today}
          busy={locked}
          unavailable={
            sources.snapshot.status !== "ready" ||
            sources.accounts.status !== "ready" ||
            !snapshot
          }
          onCancel={() => setOccurring(null)}
          onSave={async (o) => {
            const old = r.core?.occurrences ?? [];
            const occurrences = o
              ? [...old.filter((x) => x.event_id !== o.event_id), o]
              : retractOccurrence(
                  old,
                  old.find((x) => x.event_id === occurring.id)?.id ?? "",
                );
            if (
              await saver.save(
                {
                  section: "events",
                  fields: { life_events: r.life_events, occurrences },
                },
                occurrenceRevision.current,
              )
            )
              setOccurring(null);
          }}
        />
      )}
      {saver.notice && <Notice tone="danger">{saver.notice}</Notice>}
      {r.life_events.length > 0 && (
        <p className="mp-event-help">
          这些是设想，计入后会重算，不扣实际余额。
        </p>
      )}
    </div>
  );
}
function EventEditor({
  value,
  busy,
  onCancel,
  onSave,
}: {
  value: StoredLifeEvent;
  busy: boolean;
  onCancel: () => void;
  onSave: (v: StoredLifeEvent) => void;
}) {
  const [d, setD] = useState(value),
    [error, setError] = useState(""),
    [child, setChild] = useState(""),
    [age, setAge] = useState("22");
  const [rate, setRate] = useState(hundredthsToPct(value.loan_rate_hundredths)),
    [years, setYears] = useState(String(value.loan_years)),
    [cycle, setCycle] = useState(
      value.cycle_years === null ? "" : String(value.cycle_years),
    );
  const patch = (p: Partial<StoredLifeEvent>) => setD((x) => ({ ...x, ...p }));
  const financed = Number(d.price_cents) > Number(d.down_cents);
  const childChange = (birth: string, years: string) => {
    setChild(birth);
    setAge(years);
    const end = childEndMonth(birth, years);
    if (end) patch({ until_month: end });
  };
  return (
    <div
      className="mp-event-editor"
      id="mp-event-editor"
      role="group"
      aria-label="大额计划表单"
    >
      <h3>{value.label}</h3>
      <FormGroup footer="所有金额按今天的钱。首付、杂费只扣一次；每月成本要核对是否含在生活费里。">
        <SelectField
          label="计划类型"
          value={d.kind}
          options={[
            { id: "house", label: "买房" },
            { id: "car", label: "买车" },
            { id: "other", label: "其他" },
          ]}
          disabled={busy}
          onChange={(v) => patch({ kind: v as StoredLifeEvent["kind"] })}
        />
        <TextField
          label="计划名称"
          value={d.label}
          maxLength={40}
          disabled={busy}
          onChange={(label) => patch({ label })}
        />
        <MonthField
          label="计划月份"
          value={d.date}
          disabled={busy}
          onChange={(date) => patch({ date })}
        />
        <MoneyField
          label="计划总价"
          value={d.price_cents}
          disabled={busy}
          onChange={(price_cents) => patch({ price_cents })}
        />
        <MoneyField
          label="首付或一次付清"
          hint="等于总价表示全款；首付须明确填写。"
          value={d.down_cents}
          disabled={busy}
          onChange={(down_cents) => patch({ down_cents })}
        />
        <MoneyField
          label="一次性杂费"
          value={d.extra_cents}
          disabled={busy}
          onChange={(extra_cents) => patch({ extra_cents })}
        />
        {financed && (
          <>
            <TextField
              label="贷款年利率（%）"
              value={rate}
              inputMode="decimal"
              disabled={busy}
              onChange={setRate}
            />
            <TextField
              label="贷款年限"
              value={years}
              inputMode="numeric"
              disabled={busy}
              onChange={setYears}
            />
          </>
        )}
        <MoneyField
          label={d.kind === "car" ? "每月养车费" : "每月持续支出"}
          value={d.holding_cents}
          disabled={busy}
          onChange={(holding_cents) => patch({ holding_cents })}
        />
        {d.kind === "house" ? (
          <MoneyField
            label="买房后省下的月房租"
            hint="不会自动增加每月能存的钱；退休后只扣除已含的房租。"
            value={d.rent_saved_cents}
            disabled={busy}
            onChange={(rent_saved_cents) => patch({ rent_saved_cents })}
          />
        ) : (
          <>
            <TextField
              label="每隔几年重复"
              hint="留空表示只发生一次"
              value={cycle}
              inputMode="numeric"
              disabled={busy}
              onChange={setCycle}
            />
            <MonthField
              label="持续截止月份"
              hint="留空到规划终点"
              value={d.until_month ?? ""}
              disabled={busy}
              onChange={(v) =>
                patch({ until_month: v || null, time_unconfirmed: false })
              }
            />
            {d.kind === "car" && (
              <MoneyField
                label="每次卖旧车回收"
                value={d.resale_cents}
                disabled={busy}
                onChange={(resale_cents) => patch({ resale_cents })}
              />
            )}
          </>
        )}
        {d.kind === "other" && (
          <>
            <MonthField
              label="孩子出生年月（换算用）"
              value={child}
              disabled={busy}
              onChange={(v) => childChange(v, age)}
            />
            <TextField
              label="负担到孩子几岁"
              value={age}
              inputMode="numeric"
              disabled={busy}
              onChange={(v) => childChange(child, v)}
              hint="只换算持续截止月份，不保存孩子资料；仍可手动调整。"
            />
          </>
        )}
        <FormRow label="计入目标">
          <Switch
            label="大额计划计入目标"
            checked={d.included}
            disabled={busy}
            onChange={(included) => patch({ included })}
          />
        </FormRow>
      </FormGroup>
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="mp-event-actions">
        <Button disabled={busy} onClick={onCancel}>
          取消本次修改
        </Button>
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => {
            const event = eventForKind({
              ...d,
              loan_rate_hundredths: pctToHundredths(rate) ?? -1,
              loan_years: /^\d+$/.test(years) ? Number(years) : 0,
              cycle_years:
                cycle === "" ? null : /^\d+$/.test(cycle) ? Number(cycle) : -1,
            });
            const problem = validateEvent(event);
            if (problem) setError(problem);
            else {
              setError("");
              onSave({
                ...event,
                label: event.label.trim(),
                time_unconfirmed: false,
              });
            }
          }}
        >
          保存大额计划
        </Button>
      </div>
    </div>
  );
}

const blankPayment = (date: string): Payment => ({
  id: crypto.randomUUID(),
  date,
  amount_cents: null,
  account_id: null,
  absorbed_snapshot_id: null,
  absorbed_revision: null,
  source_kind: null,
  source_id: null,
});
function OccurrenceEditor({
  event,
  existing,
  snapshot,
  accounts,
  today,
  busy,
  unavailable,
  onCancel,
  onSave,
}: {
  event: StoredLifeEvent;
  existing?: Occurrence;
  snapshot: import("../../wealth").Snapshot | null;
  accounts: import("../../wealth").Account[];
  today: string;
  busy: boolean;
  unavailable: boolean;
  onCancel: () => void;
  onSave: (o: Occurrence | null) => void;
}) {
  const [o, setO] = useState<Occurrence>(() =>
      structuredClone(
        existing ?? {
          id: crypto.randomUUID(),
          event_id: event.id,
          status: "occurred",
          actual_date: today,
          payments_complete: false,
          payments: [blankPayment(today)],
          loan: null,
        },
      ),
    ),
    [pending, setPending] = useState(!existing),
    [error, setError] = useState("");
  const patch = (p: Partial<Occurrence>) => setO((x) => ({ ...x, ...p }));
  const payment = (id: string, patch: Partial<Payment>) =>
    setO((x) => ({
      ...x,
      payments: x.payments.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));
  const accountName = (id: string) =>
    accounts.find((a) => a.id === id)?.fields.name ?? "历史账户";
  function save() {
    if (busy || unavailable) return;
    if (pending) {
      if (existing && !canRetractOccurrence(existing))
        return setError("已有实际事实，请核对更正，不能撤回。");
      onSave(null);
      return;
    }
    if (!o.actual_date || o.actual_date > today)
      return setError("实际日期须不晚于今天。");
    if (o.payments.some((p) => !p.date)) return setError("请填写付款日期。");
    setError("");
    onSave(
      o.status === "cancelled"
        ? { ...o, payments: [], loan: null, payments_complete: false }
        : o,
    );
  }
  return (
    <div
      className="mp-event-editor"
      id="mp-event-editor"
      role="group"
      aria-label="实际发生核对"
    >
      <h3>核对 {event.label}</h3>
      <p className="mp-event-help">
        只维护实际发生与来源关系，不改变账户余额，不复制支出。未知资料可先留空，结果会提示未计入。
      </p>
      {unavailable && (
        <Notice>
          账户或完整盘点暂不可用，目前仅能查看。重新读取后才能保存。
        </Notice>
      )}
      <FormGroup>
        <SelectField
          label="是否已经发生"
          value={pending ? "pending" : o.status}
          disabled={busy || existing?.status === "occurred"}
          options={[
            { id: "pending", label: "尚未发生" },
            { id: "occurred", label: "已发生" },
            { id: "cancelled", label: "已取消" },
          ]}
          onChange={(v) => {
            setPending(v === "pending");
            if (v !== "pending") patch({ status: v as Occurrence["status"] });
          }}
        />
        {!pending && (
          <DateField
            label={o.status === "occurred" ? "实际发生日期" : "取消日期"}
            value={o.actual_date}
            max={today}
            disabled={busy}
            onChange={(actual_date) => patch({ actual_date })}
          />
        )}
      </FormGroup>
      {!pending && o.status === "occurred" && (
        <>
          {o.payments.map((p, index) => (
            <FormGroup title={`付款 ${index + 1}`} key={p.id}>
              <DateField
                label={`付款${index + 1}日期`}
                value={p.date}
                disabled={busy}
                onChange={(date) =>
                  payment(p.id, {
                    date,
                    absorbed_snapshot_id: null,
                    absorbed_revision: null,
                  })
                }
              />
              <MoneyField
                label={`付款${index + 1}金额`}
                hint="留空未知，明确零可保存。"
                value={p.amount_cents ?? ""}
                disabled={busy}
                onChange={(v) => payment(p.id, { amount_cents: v || null })}
              />
              <SelectField
                label={`付款${index + 1}账户`}
                value={p.account_id ?? ""}
                disabled={busy}
                options={[
                  { id: "", label: "请选择付款账户" },
                  ...(snapshot?.entries
                    .filter((e) => e.side === "asset" && e.counted)
                    .map((e) => ({
                      id: e.account_id,
                      label: accountName(e.account_id),
                    })) ?? []),
                ]}
                onChange={(v) =>
                  payment(p.id, {
                    account_id: v || null,
                    absorbed_snapshot_id: null,
                    absorbed_revision: null,
                  })
                }
              />
              {snapshot && p.date <= snapshot.date && (
                <FormRow
                  label={`付款已包含在 ${snapshot.date} 盘点`}
                  hint="更正或新增盘点后，需要重新核对。"
                  stacked
                >
                  <Switch
                    label={`付款${index + 1}已计入盘点`}
                    disabled={busy || !p.account_id}
                    checked={
                      p.absorbed_snapshot_id === snapshot.id &&
                      p.absorbed_revision === snapshot.revision
                    }
                    onChange={(checked) =>
                      payment(p.id, {
                        absorbed_snapshot_id: checked ? snapshot.id : null,
                        absorbed_revision: checked ? snapshot.revision : null,
                      })
                    }
                  />
                </FormRow>
              )}
              <details>
                <summary>关联已有来源</summary>
                <SelectField
                  label={`付款${index + 1}来源类型`}
                  value={p.source_kind ?? ""}
                  options={[
                    { id: "", label: "暂不关联" },
                    { id: "asset", label: "物品" },
                    { id: "expense", label: "重要支出" },
                    { id: "wish", label: "已购入心愿" },
                  ]}
                  disabled={busy}
                  onChange={(v) =>
                    payment(p.id, {
                      source_kind: (v || null) as Payment["source_kind"],
                      source_id: null,
                    })
                  }
                />
                {p.source_kind && (
                  <TextField
                    label={`付款${index + 1}来源ID`}
                    value={p.source_id ?? ""}
                    disabled={busy}
                    onChange={(v) => payment(p.id, { source_id: v || null })}
                  />
                )}
              </details>
              <Button
                disabled={busy}
                onClick={() =>
                  patch({
                    payments: o.payments.filter((x) => x.id !== p.id),
                    payments_complete: false,
                  })
                }
              >
                移除此付款分项
              </Button>
            </FormGroup>
          ))}
          <Button
            disabled={busy || o.payments.length >= 50}
            onClick={() =>
              patch({
                payments: [...o.payments, blankPayment(today)],
                payments_complete: false,
              })
            }
          >
            添加付款分项
          </Button>
          <FormGroup>
            <FormRow
              label="已核对全部一次性付款"
              hint="首付和杂费等都已列出；部分付款保持关闭。"
              stacked
            >
              <Switch
                label="付款分项完整"
                checked={o.payments_complete}
                disabled={busy}
                onChange={(payments_complete) => patch({ payments_complete })}
              />
            </FormRow>
          </FormGroup>
          {(Number(event.price_cents) > Number(event.down_cents) || o.loan) && (
            <FormGroup
              title="截至起点的剩余贷款"
              footer="仅核对剩余本金和期数，不重新开始贷款。"
            >
              <SelectField
                label="贷款账户"
                value={o.loan?.account_id ?? ""}
                disabled={busy}
                options={[
                  { id: "", label: "请选择负债账户" },
                  ...(snapshot?.entries
                    .filter(
                      (e) =>
                        e.counted &&
                        e.side === "liability" &&
                        e.amount_cents !== null,
                    )
                    .map((e) => ({
                      id: e.account_id,
                      label: accountName(e.account_id),
                    })) ?? []),
                ]}
                onChange={(v) => {
                  const entry = snapshot?.entries.find(
                    (e) => e.account_id === v,
                  );
                  patch({
                    loan:
                      entry && entry.amount_cents !== null && snapshot
                        ? {
                            account_id: entry.account_id,
                            as_of: snapshot.date,
                            principal_cents: entry.amount_cents,
                            remaining_months: 0,
                          }
                        : null,
                  });
                }}
              />
              {o.loan && (
                <>
                  <DateField
                    label="剩余欠款截至日"
                    value={o.loan.as_of}
                    disabled={busy}
                    onChange={(as_of) => patch({ loan: { ...o.loan!, as_of } })}
                  />
                  <MoneyField
                    label="剩余本金"
                    value={o.loan.principal_cents}
                    disabled={busy}
                    onChange={(principal_cents) =>
                      patch({ loan: { ...o.loan!, principal_cents } })
                    }
                  />
                  <TextField
                    label="剩余期数（月）"
                    value={String(o.loan.remaining_months)}
                    inputMode="numeric"
                    disabled={busy}
                    onChange={(v) =>
                      patch({
                        loan: {
                          ...o.loan!,
                          remaining_months: /^\d+$/.test(v) ? Number(v) : -1,
                        },
                      })
                    }
                  />
                </>
              )}
            </FormGroup>
          )}
        </>
      )}
      {existing?.status === "occurred" && (
        <>
          <Button
            disabled={busy || unavailable || !canRetractOccurrence(existing)}
            onClick={() => onSave(null)}
          >
            撤回为尚未发生
          </Button>
          <p className="mp-event-help">
            已有实际付款、来源或贷款事实时不能撤回，请在这里核对更正。
          </p>
        </>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="mp-event-actions">
        <Button disabled={busy} onClick={onCancel}>
          取消核对
        </Button>
        <Button variant="primary" disabled={busy || unavailable} onClick={save}>
          保存核对
        </Button>
      </div>
    </div>
  );
}
