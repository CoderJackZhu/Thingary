import { useEffect, useRef, useState } from "react";
import type { PageProps } from "../routes";
import type { PlanningSources, ProfileState } from "../../plan";
import type { Draft } from "../../planning-basic-forms";
import { setupDraft } from "../../planning-first-run";
import {
  contributionSources,
  retirementSources,
} from "../../planning-basic-forms";
import { ageToMonthV1, validMonthV1 } from "../../plan-simplified";
import {
  ageAtMonth,
  newIncome,
} from "../../planning-simplified-ui/income-view";
import {
  householdOf,
  isCouple,
  switchHousehold,
  stopAgeFromText,
  stopAgeText,
} from "../../planning-simplified-ui/household-view";
import { mustStayInLedger } from "../../plan-core";
import { useNav } from "../nav-context";
import { useSession } from "../session";
import {
  ActionBar,
  Button,
  DateField,
  ErrorState,
  FormGroup,
  FormRow,
  Loading,
  MoneyField,
  NavBar,
  Notice,
  SegmentedControl,
  SelectField,
  Switch,
  TextAreaField,
  TextField,
} from "../ui";
import { FlowProgress, MonthField } from "./fields";
import { usePlan, usePlanSaver } from "./data";
import { editorInput, flowSteps, progressText, stepIndex } from "./setup-model";
import { Assumptions } from "./assumptions";
import "./plan.css";

export default function Setup({ params }: PageProps) {
  const p = usePlan(),
    section = String(params.section ?? "setup"),
    flow = section === "setup",
    // Lives here so an intermediate save (which re-reads the sources) keeps the place in the flow.
    [flowStep, setFlowStep] = useState(0);
  if (p.loading)
    return (
      <div className="m-page mp-page">
        <NavBar title="设置条件" />
        <Loading />
      </div>
    );
  if (p.error || !p.sources)
    return (
      <div className="m-page mp-page">
        <NavBar title="设置条件" />
        <ErrorState message={p.error} onRetry={p.reload} />
      </div>
    );
  if (flow ? flowSteps[flowStep].unit === "assumptions" : section === "assumptions")
    return (
      <Assumptions
        sources={p.sources}
        reload={p.reload}
        flow={flow ? { index: flowStep, go: setFlowStep } : undefined}
      />
    );
  return (
    <Editor
      key={p.sources.generation}
      sources={p.sources}
      saved={p.saved}
      today={p.today}
      reload={p.reload}
      section={section}
      step={flowStep}
      onStep={setFlowStep}
    />
  );
}
export function Editor({
  sources,
  saved,
  today,
  reload,
  section,
  step: stepProp,
  onStep,
}: {
  sources: PlanningSources;
  saved: ProfileState["saved"];
  today: string;
  reload: () => void;
  section: string;
  step?: number;
  onStep?: (step: number) => void;
}) {
  const nav = useNav(),
    session = useSession();
  const snapshot =
    sources.snapshot.status === "ready" ? sources.snapshot.value : null;
  const [d, setD] = useState(() =>
    setupDraft(saved, snapshot, sources.modules.wealth),
  );
  const [shareTexts, setShareTexts] = useState<Record<string, string>>({});
  // "setup" walks all steps; any other section edits just that step.
  const flow = section === "setup",
    [ownStep, setOwnStep] = useState(0),
    step = flow ? (stepProp ?? ownStep) : Math.max(0, stepIndex(section)),
    setStep = onStep ?? setOwnStep,
    unit = flowSteps[step].unit,
    costs = flow ? unit === "costs" : section === "costs";
  const [notice, setNotice] = useState(""),
    [done, setDone] = useState(false);
  // What each save unit looked like on open, to tell edited steps from untouched ones.
  const snapshotOf = (x: Draft, u: string) =>
    JSON.stringify(
      u === "costs" ? [x.conScopes, x.retScopes] : { ...x, conScopes: 0, retScopes: 0 },
    );
  const [opened] = useState(() => ({
    setup: snapshotOf(d, "setup"),
    costs: snapshotOf(d, "costs"),
  }));
  const dirty = (u: string) =>
    u === "assumptions" ? false : snapshotOf(d, u) !== opened[u as "setup" | "costs"];
  const [expectedRevision] = useState(saved?.revision ?? null),
    settledAtOpen = useRef(session.settled);
  const saver = usePlanSaver(sources, reload),
    frozen = saver.busy || saver.stuck;
  const patch = (v: Partial<Draft>) => setD((x) => ({ ...x, ...v }));
  const h = householdOf(d.simplified),
    couple = isCouple(h),
    live = sources.modules.wealth && snapshot !== null;
  const setH = (household: typeof h) =>
    patch({ simplified: { ...d.simplified, household } });
  const time = d.simplified.time;
  const patchTime = (t: Partial<typeof time>) =>
    patch({ simplified: { ...d.simplified, time: { ...time, ...t } } });
  useEffect(() => {
    if (done && !session.navBlocked) nav.pop();
  }, [done, session.navBlocked]);
  useEffect(() => {
    if (
      session.settled &&
      session.settled !== settledAtOpen.current &&
      session.settled.command === "plan_profile_update" &&
      session.settled.input.generation === sources.generation
    )
      setDone(true);
  }, [session.settled, sources.generation]);
  useEffect(() => {
    document.querySelector(".m-modal")?.scrollTo(0, 0);
  }, [step]);
  /** Writes the current save unit. With `then` the page stays open and continues there instead of closing. */
  async function save(then?: () => void) {
    if (frozen) return;
    try {
      setNotice("");
      const input = editorInput(
        d,
        saved,
        today,
        live,
        flow ? (costs ? "costs" : "setup") : section,
      );
      if (await saver.save(input, expectedRevision)) {
        if (then) then();
        else setDone(true);
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }
  // Moving inside one unit never validates later steps: incomplete drafts must remain reachable.
  // Leaving a unit with edits (or before anything is saved) saves it first, so no edit is lost.
  function go(target: number) {
    if (frozen || target < 0 || target >= flowSteps.length) return;
    setNotice("");
    const from = flowSteps[step].unit;
    if (
      from !== flowSteps[target].unit &&
      (dirty(from) || (from === "setup" && !saved?.profile.retire.basic))
    )
      void save(() => setStep(target));
    else setStep(target);
  }
  function finish() {
    if (flow && !dirty(unit) && saved?.profile.retire.basic) nav.pop();
    else void save();
  }
  const title = flowSteps[step].title;
  const ageField = (label: string, field: "target_month" | "horizon_month") => (
    <TextField
      label={label}
      value={String(
        ageAtMonth(time.reference, time[field]) === null
          ? ""
          : ageAtMonth(time.reference, time[field])! / 12,
      )}
      inputMode="decimal"
      disabled={frozen || !time.reference}
      hint="按年龄自动换算；也可在下方直接填写月份"
      onChange={(v) => {
        try {
          patchTime({
            [field]:
              v.trim() !== "" && time.reference
                ? ageToMonthV1(time.reference, Math.round(Number(v) * 12))
                : null,
          });
        } catch {
          patchTime({ [field]: null });
        }
      }}
    />
  );
  return (
    <div className="m-page mp-page">
      <NavBar
        title={flow ? progressText(step) : title}
        primary={{
          label: flow ? "保存退出" : "保存",
          onClick: () => void save(),
          disabled: frozen,
        }}
      />
      {flow && <FlowProgress index={step} />}
      <fieldset disabled={frozen} className="mp-stack">
        <h2>{title}</h2>
        {costs ? (
          <>
            <Notice>
              确认哪些费用已经含在每月净投入或退休生活费里，避免重复计入。没有填写的关系保持未知。
            </Notice>
            {(
              [
                [
                  "conScopes",
                  "已含在每月能存的钱里？",
                  contributionSources(saved!.profile.retire),
                ],
                [
                  "retScopes",
                  "已含在退休生活费里？",
                  retirementSources(saved!.profile.retire),
                ],
              ] as const
            ).map(([key, label, rows]) => (
              <FormGroup key={key} title={label}>
                {rows.length === 0 && <p>没有需要核对的费用。</p>}
                {rows.map((row) => (
                  <div key={row.id}>
                    <SelectField
                      label={row.label}
                      value={d[key][row.id]?.treatment ?? ""}
                      onChange={(v) =>
                        patch({
                          [key]: {
                            ...d[key],
                            [row.id]: {
                              ref: d[key][row.id]?.ref ?? "",
                              treatment: v,
                            },
                          },
                        })
                      }
                      options={[
                        { id: "", label: "待确认" },
                        { id: "included", label: "已包含" },
                        { id: "extra", label: "另外计入" },
                        ...(!mustStayInLedger(row.id)
                          ? [{ id: "excluded", label: "本次不计" }]
                          : []),
                      ]}
                    />
                    {d[key][row.id]?.treatment === "included" && (
                      <MoneyField
                        label={`${row.label}已含金额`}
                        value={d[key][row.id].ref}
                        onChange={(ref) =>
                          patch({
                            [key]: {
                              ...d[key],
                              [row.id]: { ...d[key][row.id], ref },
                            },
                          })
                        }
                      />
                    )}
                  </div>
                ))}
              </FormGroup>
            ))}
          </>
        ) : (
          <>
            {step === 0 && (
              <>
                <FormGroup title="目标与范围">
                  <SegmentedControl
                    label="目标类型"
                    value={d.mode}
                    items={[
                      { id: "fire", label: "财务自由" },
                      { id: "traditional", label: "按计划退休" },
                    ]}
                    onChange={(mode) => patch({ mode })}
                  />
                  <p className="mp-muted">
                    财务自由按资金够用的时间停止工作；按计划退休检查固定目标月份的资金。
                  </p>
                  <SegmentedControl
                    label="规划给谁"
                    value={h.mode}
                    items={[
                      { id: "single", label: "一个人" },
                      { id: "couple", label: "两个人" },
                    ]}
                    onChange={(mode) => setH(switchHousehold(h, mode))}
                  />
                  <MonthField
                    label="你的出生年月"
                    value={
                      time.reference?.age_months === 0
                        ? time.reference.month
                        : ""
                    }
                    max={today.slice(0, 7)}
                    onChange={(month) =>
                      patchTime({
                        reference:
                          validMonthV1(month) && month <= today.slice(0, 7)
                            ? { month, age_months: 0 }
                            : null,
                      })
                    }
                    hint="修改出生年月保留已有的目标月份，请重新核对年龄"
                  />
                  {ageField("希望多少岁停工", "target_month")}
                  {ageField("规划到多少岁", "horizon_month")}
                  <MonthField
                    label="退休开始月份"
                    value={time.target_month ?? ""}
                    onChange={(v) => patchTime({ target_month: v || null })}
                  />
                  <MonthField
                    label="规划终点月份"
                    value={time.horizon_month ?? ""}
                    onChange={(v) => patchTime({ horizon_month: v || null })}
                  />
                </FormGroup>
                {couple && (
                  <FormGroup title="伴侣">
                    <MonthField
                      label="伴侣出生年月"
                      value={h.partner.birth_month}
                      max={today.slice(0, 7)}
                      onChange={(birth_month) =>
                        setH({ ...h, partner: { ...h.partner, birth_month } })
                      }
                    />
                    <SelectField
                      label="伴侣打算何时停工"
                      value={
                        h.partner.stop_age_months === null ? "same" : "age"
                      }
                      options={[
                        { id: "same", label: "跟我同时" },
                        { id: "age", label: "填一个年龄" },
                      ]}
                      onChange={(v) =>
                        setH({
                          ...h,
                          partner: {
                            ...h.partner,
                            stop_age_months: v === "same" ? null : -1,
                            monthly_cents:
                              v === "same" ? null : h.partner.monthly_cents,
                          },
                        })
                      }
                    />
                    {h.partner.stop_age_months !== null && (
                      <TextField
                        label="伴侣停工年龄"
                        value={stopAgeText(h.partner.stop_age_months)}
                        inputMode="numeric"
                        onChange={(v) =>
                          setH({
                            ...h,
                            partner: {
                              ...h.partner,
                              stop_age_months: stopAgeFromText(v),
                            },
                          })
                        }
                      />
                    )}
                  </FormGroup>
                )}
              </>
            )}
            {step === 1 && (
              <FormGroup
                title={couple ? "两人退休后的生活费" : "退休后的生活费"}
                footer="按今天物价填写；阶段性支出可保存后在「大额支出」页添加，按额外支出计入。应急金是参考线，不另从退休资金扣除。"
              >
                <MoneyField
                  label="每月生活费总额"
                  value={d.budget}
                  onChange={(budget) => patch({ budget })}
                  hint="未知可以留空，不会当作 0"
                />
                <TextField
                  label="应急金月数"
                  value={d.emergency}
                  inputMode="numeric"
                  onChange={(emergency) => patch({ emergency })}
                />
              </FormGroup>
            )}
            {step === 2 && (
              <>
                <FormGroup title="资金起点">
                  <SelectField
                    label="准备方式"
                    value={d.start}
                    options={[
                      ...(live
                        ? [
                            {
                              id: "live",
                              label: `最近完整盘点 ${snapshot!.date}`,
                            },
                          ]
                        : []),
                      { id: "simulation", label: "手填金额（替代盘点）" },
                    ]}
                    onChange={(v) => patch({ start: v as Draft["start"] })}
                  />
                  {d.start === "simulation" ? (
                    <>
                      <MoneyField
                        label="可用资金"
                        value={d.simAmount}
                        onChange={(simAmount) => patch({ simAmount })}
                      />
                      <DateField
                        label="金额截至日期"
                        value={d.simDate}
                        max={today}
                        allowClear
                        onChange={(simDate) => patch({ simDate })}
                      />
                      <TextAreaField
                        label="模拟说明"
                        value={d.simNotes}
                        onChange={(simNotes) => patch({ simNotes })}
                      />
                    </>
                  ) : !live ? (
                    <Notice>没有可用完整盘点，请改用手填金额。</Notice>
                  ) : (
                    <>
                      {snapshot!.entries
                        .filter((e) => e.counted && e.side === "asset")
                        .map((e) => {
                          const f = d.funds.find(
                            (f) => f.account_id === e.account_id,
                          );
                          const name =
                            sources.accounts.status === "ready"
                              ? (sources.accounts.value.find(
                                  (a) => a.id === e.account_id,
                                )?.fields.name ?? "历史账户")
                              : "账户";
                          return (
                            <div key={e.account_id}>
                              <SelectField
                                label={`${name}用途`}
                                value={f?.availability ?? "restricted"}
                                options={[
                                  ...(e.kind === "housing_fund"
                                    ? []
                                    : [{ id: "available", label: "可以动用" }]),
                                  { id: "restricted", label: "暂不能动用" },
                                  { id: "excluded", label: "不参与" },
                                ]}
                                onChange={(v) =>
                                  patch({
                                    funds: d.funds.map((x) =>
                                      x.account_id === e.account_id
                                        ? {
                                            ...x,
                                            availability:
                                              v as typeof x.availability,
                                          }
                                        : x,
                                    ),
                                  })
                                }
                              />
                              <TextField
                                label={`${name}计入比例（%）`}
                                inputMode="decimal"
                                value={
                                  shareTexts[e.account_id] ??
                                  (f ? String(f.share_hundredths / 100) : "")
                                }
                                onChange={(v) => {
                                  setShareTexts((old) => ({
                                    ...old,
                                    [e.account_id]: v,
                                  }));
                                  patch({
                                    funds: d.funds.map((x) =>
                                      x.account_id === e.account_id
                                        ? {
                                            ...x,
                                            share_hundredths:
                                              v.trim() === ""
                                                ? NaN
                                                : Math.round(Number(v) * 100),
                                          }
                                        : x,
                                    ),
                                  });
                                }}
                              />
                            </div>
                          );
                        })}
                    </>
                  )}
                </FormGroup>
                {d.start === "live" && live && (
                  <FormGroup
                    title="以后解锁的资金"
                    footer="只记计划解锁，不改变账户余额。已有解锁安排会原样保留。"
                  >
                    {d.releases.map((r, i) => (
                      <div className="mp-subcard" key={r.id}>
                        <SelectField
                          label={`解锁账户 ${i + 1}`}
                          value={r.account_id}
                          options={[
                            { id: "", label: "选择暂不能动用的账户" },
                            ...(sources.accounts.status === "ready"
                              ? sources.accounts.value
                              : []
                            )
                              .filter((a) =>
                                d.funds.some(
                                  (f) =>
                                    f.account_id === a.id &&
                                    f.availability === "restricted",
                                ),
                              )
                              .map((a) => ({ id: a.id, label: a.fields.name })),
                          ]}
                          onChange={(account_id) =>
                            patch({
                              releases: d.releases.map((x) =>
                                x.id === r.id ? { ...x, account_id } : x,
                              ),
                            })
                          }
                        />
                        <MonthField
                          label={`解锁月份 ${i + 1}`}
                          value={r.month}
                          onChange={(month) =>
                            patch({
                              releases: d.releases.map((x) =>
                                x.id === r.id ? { ...x, month } : x,
                              ),
                            })
                          }
                        />
                        <MoneyField
                          label={`解锁金额 ${i + 1}`}
                          value={r.net_cents ?? ""}
                          onChange={(net_cents) =>
                            patch({
                              releases: d.releases.map((x) =>
                                x.id === r.id
                                  ? { ...x, net_cents: net_cents || null }
                                  : x,
                              ),
                            })
                          }
                        />
                        <FormRow label="这是估计金额">
                          <Switch
                            label={`解锁安排 ${i + 1} 是估计金额`}
                            checked={r.estimated}
                            onChange={(estimated) =>
                              patch({
                                releases: d.releases.map((x) =>
                                  x.id === r.id ? { ...x, estimated } : x,
                                ),
                              })
                            }
                          />
                        </FormRow>
                        <FormRow
                          label="确认不含未来缴存"
                          hint="只填写已有余额的未来净到账，未来缴存另在每月能存的钱里维护"
                        >
                          <Switch
                            label={`解锁安排 ${i + 1} 不含未来缴存`}
                            checked={r.excludes_future_deposits}
                            onChange={(excludes_future_deposits) =>
                              patch({
                                releases: d.releases.map((x) =>
                                  x.id === r.id
                                    ? { ...x, excludes_future_deposits }
                                    : x,
                                ),
                              })
                            }
                          />
                        </FormRow>
                        <Button
                          onClick={() =>
                            patch({
                              releases: d.releases.filter((x) => x.id !== r.id),
                            })
                          }
                        >
                          删除解锁安排
                        </Button>
                      </div>
                    ))}
                    <Button
                      onClick={() =>
                        patch({
                          releases: [
                            ...d.releases,
                            {
                              id: crypto.randomUUID(),
                              account_id: "",
                              month: "",
                              net_cents: null,
                              estimated: false,
                              excludes_future_deposits: false,
                            },
                          ],
                        })
                      }
                    >
                      添加解锁安排
                    </Button>
                  </FormGroup>
                )}
              </>
            )}
            {step === 3 && (
              <>
                <FormGroup
                  title="退休后收入"
                  footer="这是手填的未来收入假设；领取资格和金额请另行核实。"
                >
                  <SelectField
                    label="未来收入计入方式"
                    value={d.simplified.income_mode}
                    options={[
                      { id: "excluded", label: "本次不计未来收入" },
                      { id: "manual", label: "计入所选手填收入" },
                      { id: "unconfirmed", label: "还没确认" },
                    ]}
                    onChange={(v) =>
                      patch({
                        simplified: {
                          ...d.simplified,
                          income_mode: v as typeof d.simplified.income_mode,
                        },
                      })
                    }
                  />
                </FormGroup>
                {d.simplified.future_incomes.map((income, i) => {
                  const set = (v: Partial<typeof income>) =>
                    patch({
                      simplified: {
                        ...d.simplified,
                        future_incomes: d.simplified.future_incomes.map((x) =>
                          x.id === income.id ? { ...x, ...v } : x,
                        ),
                      },
                    });
                  return (
                    <FormGroup key={income.id} title={`收入 ${i + 1}`}>
                      <TextField
                        label="收入名称"
                        value={income.name}
                        onChange={(name) => set({ name })}
                      />
                      <FormRow label="计入本次测算">
                        <Switch
                          label={`计入${income.name || "收入"}`}
                          checked={income.included}
                          onChange={(included) => set({ included })}
                        />
                      </FormRow>
                      <SelectField
                        label="收入类型"
                        value={income.role}
                        options={[
                          { id: "pension", label: "养老金" },
                          { id: "other", label: "其他固定收入" },
                        ]}
                        onChange={(role) =>
                          set({ role: role as typeof income.role })
                        }
                      />
                      <MoneyField
                        label="每月收入"
                        value={income.monthly_cents ?? ""}
                        onChange={(v) => set({ monthly_cents: v || null })}
                      />
                      <MonthField
                        label="开始领取月份"
                        value={income.start_month ?? ""}
                        onChange={(v) => set({ start_month: v || null })}
                      />
                      <MonthField
                        label="结束月份（空为规划终点）"
                        value={income.end_month ?? ""}
                        onChange={(v) => set({ end_month: v || null })}
                      />
                      <SelectField
                        label="金额对应物价"
                        value={income.basis}
                        options={[
                          { id: "start_month", label: "开始领取时的金额" },
                          { id: "reference_month", label: "指定月份的购买力" },
                        ]}
                        onChange={(v) =>
                          set({ basis: v as typeof income.basis })
                        }
                      />
                      {income.basis === "reference_month" && (
                        <MonthField
                          label="金额基准月份"
                          value={income.basis_month ?? ""}
                          onChange={(v) => set({ basis_month: v || null })}
                        />
                      )}
                      <SelectField
                        label="之后如何增长"
                        value={income.growth}
                        options={[
                          { id: "fixed_nominal", label: "固定账面金额" },
                          {
                            id: "constant_purchasing_power",
                            label: "保持购买力（跟随通胀）",
                          },
                        ]}
                        onChange={(v) =>
                          set({ growth: v as typeof income.growth })
                        }
                      />
                      <TextField
                        label="信息来源"
                        value={income.source ?? ""}
                        onChange={(v) => set({ source: v || null })}
                      />
                      <DateField
                        label="来源核对日期"
                        value={income.source_checked_on ?? ""}
                        allowClear
                        max={today}
                        onChange={(v) => set({ source_checked_on: v || null })}
                      />
                      <TextAreaField
                        label="收入备注"
                        value={income.notes}
                        onChange={(notes) => set({ notes })}
                      />
                      <Button
                        onClick={() =>
                          patch({
                            simplified: {
                              ...d.simplified,
                              future_incomes:
                                d.simplified.future_incomes.filter(
                                  (x) => x.id !== income.id,
                                ),
                            },
                          })
                        }
                      >
                        删除这笔收入
                      </Button>
                    </FormGroup>
                  );
                })}
                <Button
                  onClick={() =>
                    patch({
                      simplified: {
                        ...d.simplified,
                        future_incomes: [
                          ...d.simplified.future_incomes,
                          newIncome("pension"),
                        ],
                      },
                    })
                  }
                >
                  添加未来收入
                </Button>
              </>
            )}
            {step === 4 && (
              <FormGroup
                title={couple ? "两人每月一共能存" : "每月能存多少"}
                footer="到账减去全部开销后剩下的钱；买基金等投入也算，投资涨跌不算。空白是未知，0 表示不存钱，负数表示取用存款。"
              >
                <MoneyField
                  label="你估计每月能存"
                  signed
                  value={d.contribution}
                  onChange={(contribution) => patch({ contribution })}
                />
                {couple && h.partner.stop_age_months !== null && (
                  <MoneyField
                    label="其中伴侣每月存多少"
                    signed
                    value={h.partner.monthly_cents ?? ""}
                    hint="已包含在两人总额里，不是另外加的；不确定可留空"
                    onChange={(v) =>
                      setH({
                        ...h,
                        partner: { ...h.partner, monthly_cents: v || null },
                      })
                    }
                  />
                )}
                <Button onClick={() => patch({ contribution: "0" })}>
                  明确按每月存 0 元
                </Button>
              </FormGroup>
            )}
          </>
        )}
      </fieldset>
      {(notice || saver.notice) && (
        <Notice tone="danger">{notice || saver.notice}</Notice>
      )}
      <p className="mp-muted">没想好的条件可以先留空。取消不会保存草稿。</p>
      <ActionBar>
        {flow && step > 0 && (
          <Button disabled={frozen} onClick={() => go(step - 1)}>
            上一步
          </Button>
        )}
        {flow && step < flowSteps.length - 1 ? (
          <Button variant="primary" disabled={frozen} onClick={() => go(step + 1)}>
            下一步
          </Button>
        ) : (
          <Button variant="primary" disabled={frozen} onClick={finish}>
            完成
          </Button>
        )}
      </ActionBar>
    </div>
  );
}
