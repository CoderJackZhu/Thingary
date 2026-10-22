import { useRef, useState } from "react";
import type { DebtRepayment, DebtTreatment } from "../../plan-core";
import {
  debtFirstMonth,
  debtReview,
  validateDebtRepayment,
} from "../../plan-debt";
import type { PlanningSources, ProfileState } from "../../plan";
import { useNav } from "../nav-context";
import { moneyText } from "../format";
import {
  Button,
  EmptyState,
  ErrorState,
  FormGroup,
  FormRow,
  Loading,
  MoneyField,
  NavBar,
  Notice,
  SelectField,
  Switch,
} from "../ui";
import { MonthField } from "./fields";
import { usePlan, usePlanSaver } from "./data";
import "./events.css";

/**
 * 已有贷款还款安排, reached from 待你确认 and from the funds step of the setup flow. Same refinement as desktop's
 * debt dialog: for each loan say how it is repaid before and after retirement. Nothing is guessed for the user.
 */
export default function DebtsPage() {
  const p = usePlan(),
    nav = useNav();
  return (
    <div className="m-page mp-page">
      <NavBar title="贷款还款安排" />
      {p.loading ? (
        <Loading />
      ) : p.error || !p.sources ? (
        <ErrorState message={p.error} onRetry={p.reload} />
      ) : !p.saved?.profile.retire.basic ? (
        <EmptyState
          icon="chart"
          title="先设置一个目标"
          message="设置目标与时间后，才能安排贷款还款。"
          action={
            <Button variant="primary" onClick={() => nav.push("plan.setup")}>
              设置条件
            </Button>
          }
        />
      ) : (
        <DebtEditor
          key={p.sources.generation}
          sources={p.sources}
          saved={p.saved}
          today={p.today}
          reload={p.reload}
          onDone={() => nav.pop()}
        />
      )}
    </div>
  );
}

export function DebtEditor({
  sources,
  saved,
  today,
  reload,
  onDone,
}: {
  sources: PlanningSources;
  saved: NonNullable<ProfileState["saved"]>;
  today: string;
  reload: () => void;
  onDone: () => void;
}) {
  const saver = usePlanSaver(sources, reload),
    r = saved.profile.retire;
  const snapshot =
      sources.snapshot.status === "ready" ? sources.snapshot.value : null,
    accounts =
      sources.accounts.status === "ready" ? sources.accounts.value : [];
  const review = debtReview(
    snapshot,
    r.core,
    r.life_events,
    undefined,
    undefined,
    accounts,
  );
  const [drafts, setDrafts] = useState<Record<string, DebtRepayment>>(() =>
      snapshot
        ? Object.fromEntries(
            review.rows.map((row) => [
              row.entry.account_id,
              {
                account_id: row.entry.account_id,
                recorded_on: today,
                as_of: snapshot.date,
                balance_cents: row.entry.amount_cents ?? "",
                start_month: debtFirstMonth(snapshot.date),
                last_month: null,
                monthly_cents: null,
                before: null,
                after: null,
                ...row.saved,
              },
            ]),
          )
        : {},
    ),
    [remove, setRemove] = useState<string[]>([]),
    [touched, setTouched] = useState<string[]>([]),
    [error, setError] = useState("");
  const frozen = saver.busy || saver.stuck;
  const editRevision = useRef(saved.revision);
  const inactive = (r.core?.debt_repayments ?? []).filter(
    (d) => !review.rows.some((row) => row.entry.account_id === d.account_id),
  );
  const patch = (id: string, fields: Partial<DebtRepayment>) => {
    if (!snapshot) return;
    setTouched((ids) => (ids.includes(id) ? ids : [...ids, id]));
    setDrafts((old) => ({
      ...old,
      [id]: {
        ...old[id],
        ...fields,
        recorded_on: today,
        as_of: snapshot.date,
        balance_cents:
          review.rows.find((row) => row.entry.account_id === id)!.entry
            .amount_cents ?? "",
      },
    }));
  };
  async function save() {
    try {
      const updates = Object.values(drafts).filter(
        (d) =>
          touched.includes(d.account_id) &&
          !remove.includes(d.account_id) &&
          !review.rows.find((row) => row.entry.account_id === d.account_id)
            ?.linked,
      );
      for (const d of updates) validateDebtRepayment(d);
      if (!updates.length && !remove.length)
        throw new Error("请先修改或确认至少一份还款安排，或取消修改。");
      setError("");
      if (
        await saver.save(
          { section: "debt_repayments", fields: { updates, remove } },
          editRevision.current,
        )
      )
        onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  if (!snapshot || sources.accounts.status !== "ready")
    return <Notice>需要完整盘点后才能安排贷款；未知余额不会当作零。</Notice>;
  return (
    <div className="mp-debts">
      <p className="mp-event-help">
        还款已经含在开销里、另外计算或暂不考虑，都由你明确选择。
      </p>
      {!review.rows.length && <p>这次盘点没有需要安排的负债账户。</p>}
      {inactive.map((d) => (
        <FormRow
          key={d.account_id}
          label={`移除旧安排：${accounts.find((a) => a.id === d.account_id)?.fields.name ?? "负债账户"}`}
          stacked
        >
          <Switch
            label={`移除旧还款${d.account_id}`}
            checked={remove.includes(d.account_id)}
            disabled={frozen}
            onChange={(checked) =>
              setRemove((ids) =>
                checked
                  ? [...ids, d.account_id]
                  : ids.filter((id) => id !== d.account_id),
              )
            }
          />
        </FormRow>
      ))}
      {review.rows.map((row) => {
        const d = drafts[row.entry.account_id];
        if (!d) return null;
        return (
          <FormGroup key={row.entry.account_id} title={row.name}>
            <p className="mp-event-help">
              截至 {snapshot.date}，余额{" "}
              {row.entry.amount_cents === null
                ? "未知"
                : moneyText(row.entry.amount_cents)}
              。
            </p>
            {row.changed && (
              <Notice>
                余额明显变化，请复核原安排。
                {row.zero && "余额已归零，独立还款已停用。"}
              </Notice>
            )}
            {row.linked ? (
              <Notice>
                已在「{row.linked.label}
                」中安排，不重复计算，请核对该大额计划。
              </Notice>
            ) : (
              <>
                {(["before", "after"] as const).map((phase) => (
                  <SelectField
                    key={phase}
                    label={`${row.name}${phase === "before" ? "退休前" : "退休后"}还款方式`}
                    value={d[phase] ?? ""}
                    disabled={frozen || row.entry.amount_cents === null}
                    options={[
                      { id: "", label: "尚未处理" },
                      { id: "scheduled", label: "每月还一笔，单独计算" },
                      { id: "included", label: "已含在每月开销里" },
                      { id: "excluded", label: "这次先不考虑" },
                    ]}
                    onChange={(value) =>
                      patch(row.entry.account_id, {
                        [phase]: (value || null) as DebtTreatment,
                      })
                    }
                  />
                ))}
                {(d.before === "scheduled" || d.after === "scheduled") && (
                  <>
                    <MoneyField
                      label={`${row.name}每月还款`}
                      value={d.monthly_cents ?? ""}
                      hint="本金和利息合计，每月实际付出；空表示未知。"
                      disabled={frozen}
                      onChange={(v) =>
                        patch(row.entry.account_id, {
                          monthly_cents: v || null,
                        })
                      }
                    />
                    <MonthField
                      label={`${row.name}首期月份`}
                      value={d.start_month}
                      disabled={frozen}
                      onChange={(start_month) =>
                        patch(row.entry.account_id, { start_month })
                      }
                    />
                    <MonthField
                      label={`${row.name}最后一期`}
                      value={d.last_month ?? ""}
                      disabled={frozen}
                      onChange={(v) =>
                        patch(row.entry.account_id, {
                          last_month: v || null,
                        })
                      }
                    />
                  </>
                )}
                {(d.before === "excluded" || d.after === "excluded") && (
                  <Notice>这部分还款未计入，结果可能偏乐观。</Notice>
                )}
                <Button
                  disabled={frozen || row.entry.amount_cents === null}
                  onClick={() => patch(row.entry.account_id, {})}
                >
                  确认这份安排仍适用
                </Button>
              </>
            )}
          </FormGroup>
        );
      })}
      {error && <Notice tone="danger">{error}</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="mp-event-actions">
        <Button disabled={frozen} onClick={onDone}>
          取消
        </Button>
        <Button
          variant="primary"
          disabled={
            frozen ||
            (!review.rows.some((row) => !row.linked) && !inactive.length)
          }
          onClick={() => void save()}
        >
          保存还款安排
        </Button>
      </div>
      {saver.notice && <Notice tone="danger">{saver.notice}</Notice>}
    </div>
  );
}
