import { useEffect, useRef, useState } from "react";
import type { PageProps } from "../routes";
import type { PlanningSources, ProfileState } from "../../plan";
import type { Draft } from "../../planning-basic-forms";
import { setupDraft } from "../../planning-first-run";
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
  Sheet,
  DateField,
  ErrorState,
  FormGroup,
  ListGroup,
  ListRow,
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
import { FlowSteps, MonthField } from "./fields";
import { usePlan, usePlanSaver } from "./data";
import {
  costRows,
  editorInput,
  flowSteps,
  setupIssues,
  stepIndex,
  stepStatuses,
} from "./setup-model";
import { costsInput } from "../../planning-basic-forms";
import { Assumptions, AssumptionForm, useAssumptionDraft } from "./assumptions";
import { StageCostGroup } from "./StageCostGroup";
import { debtSummary } from "./debts-model";
import "./plan.css";

export default function Setup({ params }: PageProps) {
  const p = usePlan(),
    section = String(params.section ?? "setup");
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
  if (section === "assumptions")
    return <Assumptions sources={p.sources} reload={p.reload} />;
  return (
    <Editor
      key={p.sources.generation}
      sources={p.sources}
      saved={p.saved}
      today={p.today}
      reload={p.reload}
      section={section}
    />
  );
}
export function Editor({
  sources,
  saved,
  today,
  reload,
  section,
}: {
  sources: PlanningSources;
  saved: ProfileState["saved"];
  today: string;
  reload: () => void;
  section: string;
}) {
  const nav = useNav(),
    session = useSession();
  const snapshot =
    sources.snapshot.status === "ready" ? sources.snapshot.value : null;
  const [d, setD] = useState(() =>
    setupDraft(saved, snapshot, sources.modules.wealth),
  );
  const [shareTexts, setShareTexts] = useState<Record<string, string>>({});
  // "setup" walks all steps and writes them together on 保存; any other section edits just that step.
  const flow = section === "setup",
    [step, setStep] = useState(() => Math.max(0, stepIndex(section))),
    unit = flowSteps[step].unit,
    costs = flow ? unit === "costs" : section === "costs";
  const [notice, setNotice] = useState(""),
    [done, setDone] = useState(false),
    [saving, setSaving] = useState(false),
    [attempted, setAttempted] = useState(false),
    [visited, setVisited] = useState<ReadonlySet<number>>(() => new Set([step])),
    [confirmCancel, setConfirmCancel] = useState(false);
  const asm = useAssumptionDraft(sources, flow);
  // What each save unit looked like on open (or on its last save), to tell edited steps from untouched ones.
  const snapshotOf = (x: Draft, u: string) =>
    JSON.stringify(
      u === "costs"
        ? [x.conScopes, x.retScopes]
        : { ...x, conScopes: 0, retScopes: 0 },
    );
  const [opened, setOpened] = useState(() => ({
    setup: snapshotOf(d, "setup"),
    costs: snapshotOf(d, "costs"),
  }));
  const dirty = (u: string) =>
    u === "assumptions"
      ? asm.edited
      : snapshotOf(d, u) !== opened[u as "setup" | "costs"];
  // Single-step pages write the setup unit (or costs); the flow writes every unit that changed.
  const anyDirty = flow
    ? dirty("setup") || dirty("costs") || asm.edited
    : dirty(section === "costs" ? "costs" : "setup");
  const [expectedRevision, setExpectedRevision] = useState(
      saved?.revision ?? null,
    ),
    settledAtOpen = useRef(session.settled);
  const saver = usePlanSaver(sources, reload),
    frozen = saver.busy || saver.stuck || saving;
  const patch = (v: Partial<Draft>) => setD((x) => ({ ...x, ...v }));
  const h = householdOf(d.simplified),
    couple = isCouple(h),
    live = sources.modules.wealth && snapshot !== null;
  const setH = (household: typeof h) =>
    patch({ simplified: { ...d.simplified, household } });
  const time = d.simplified.time;
  const patchTime = (t: Partial<typeof time>) =>
    patch({ simplified: { ...d.simplified, time: { ...time, ...t } } });
  // Wrong values by step. They only show once a save was refused, then follow the edits.
  const found = [
    ...setupIssues(d, saved, today, live),
    ...(flow && asm.invalidKey() !== null
      ? [{ step: flowSteps.findIndex((x) => x.id === "assumptions"), field: "assumptions", message: "请填写有效百分数，例如 2 或 2.5。" }]
      : []),
  ];
  const shown = attempted ? found : [];
  const fieldError = (field: string) => {
    const issue = shown.find((x) => x.step === step && x.field === field);
    return issue ? (
      <p className="m-form-hint mp-field-error" role="alert">
        {issue.message}
      </p>
    ) : null;
  };
  // Steps with an error but no field of their own (or one not drawn) still say it once at the top.
  const stepNote = shown.find(
    (x) => x.step === step && (x.field === "" || !flow),
  )?.message;
  const statuses = stepStatuses({ d, saved, issues: shown, visited, assumptionsEdited: asm.edited });
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
  function jump(target: number) {
    if (frozen || target < 0 || target >= flowSteps.length) return;
    setNotice("");
    setVisited((v) => new Set(v).add(target));
    setStep(target);
  }
  /**
   * 保存: validates what is wrong (blank optional fields never block), jumps to the first step with a problem,
   * otherwise writes the changed units in order: setup, fee relations, then assumptions (which last, so the
   * rates the person typed are the ones that stay). Nothing is written before this.
   */
  async function save() {
    if (frozen) return;
    setNotice("");
    setAttempted(true);
    const problem = found[0];
    if (problem) {
      if (flow) jump(problem.step);
      else setNotice(problem.message);
      return;
    }
    if (!anyDirty && saved?.profile.retire.basic) {
      nav.pop();
      return;
    }
    setSaving(true);
    try {
      if (!flow) {
        const input = editorInput(d, saved, today, live, section);
        if (await saver.save(input, expectedRevision)) setDone(true);
        return;
      }
      let current = saved,
        revision = expectedRevision;
      if (dirty("setup") || !saved?.profile.retire.basic) {
        const result = await saver.save(
          editorInput(d, current, today, live, "setup"),
          revision,
        );
        if (!result) return;
        current = result;
        revision = result.revision;
        setOpened((o) => ({ ...o, setup: snapshotOf(d, "setup") }));
        setExpectedRevision(revision);
      }
      if (dirty("costs") && current?.profile.retire.basic) {
        const input = costsInput(d, current);
        const wanted = input.section === "basic" ? input.fields.basic : null;
        const have = current.profile.retire.basic;
        const same =
          wanted &&
          JSON.stringify([wanted.contribution_costs, wanted.retirement_costs]) ===
            JSON.stringify([have?.contribution_costs, have?.retirement_costs]);
        if (!same) {
          const result = await saver.save(input, revision);
          if (!result) return;
          current = result;
          revision = result.revision;
          setExpectedRevision(revision);
        }
        setOpened((o) => ({ ...o, costs: snapshotOf(d, "costs") }));
      }
      if (asm.edited) {
        const failure = await asm.commit(true);
        if (failure !== null) {
          setNotice(failure);
          jump(flowSteps.findIndex((x) => x.id === "assumptions"));
          return;
        }
      }
      reload();
      session.reload();
      setDone(true);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }
  function cancel() {
    if (anyDirty) setConfirmCancel(true);
    else nav.pop();
  }
  // The loan page saves on its own, so edits made here are written first and none are lost on the way back.
  const debts = debtSummary(
    snapshot,
    saved?.profile.retire.core,
    saved?.profile.retire.life_events ?? [],
    sources.accounts.status === "ready" ? sources.accounts.value : [],
  );
  function openDebts() {
    if (frozen) return;
    if (dirty("setup")) void saveThen(() => nav.push("plan.debts"));
    else nav.push("plan.debts");
  }
  async function saveThen(then: () => void) {
    setNotice("");
    setSaving(true);
    try {
      const input = editorInput(d, saved, today, live, "setup");
      const result = await saver.save(input, expectedRevision);
      if (result) {
        setOpened((o) => ({ ...o, setup: snapshotOf(d, "setup") }));
        setExpectedRevision(result.revision);
        then();
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
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
        title={flow ? "设置条件" : title}
        onCancel={cancel}
        primary={{
          label: "保存",
          onClick: () => void save(),
          busy: saving,
          disabled: frozen,
        }}
      />
      {flow && (
        <FlowSteps index={step} statuses={statuses} onJump={jump} disabled={frozen} />
      )}
      <fieldset disabled={frozen} className="mp-stack">
        {!flow && <h2>{title}</h2>}
        {stepNote && <Notice tone="danger">{stepNote}</Notice>}
        {costs ? (
          <>
            <Notice>
              确认哪些费用已经含在每月净投入或退休生活费里，避免重复计入。没有填写的关系保持未知。
            </Notice>
            {costRows(d, saved).map(([key, rows]) => {
              const label =
                key === "conScopes"
                  ? "已含在每月能存的钱里？"
                  : "已含在退休生活费里？";
              return (
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
                    {fieldError(`scope:${key}:${row.id}`)}
                  </div>
                ))}
              </FormGroup>
              );
            })}
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
                  {fieldError("birth")}
                  {ageField("希望多少岁停工", "target_month")}
                  {ageField("规划到多少岁", "horizon_month")}
                  <MonthField
                    label="退休开始月份"
                    value={time.target_month ?? ""}
                    onChange={(v) => patchTime({ target_month: v || null })}
                  />
                  {fieldError("target_month")}
                  <MonthField
                    label="规划终点月份"
                    value={time.horizon_month ?? ""}
                    onChange={(v) => patchTime({ horizon_month: v || null })}
                  />
                  {fieldError("horizon_month")}
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
                    {fieldError("partner_birth")}
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
                    {fieldError("partner_stop")}
                  </FormGroup>
                )}
              </>
            )}
            {step === 1 && (
              <>
                <FormGroup
                  title={couple ? "两人退休后的生活费" : "退休后的生活费"}
                  footer="按今天物价填写。应急金是参考线，不另从退休资金扣除。"
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
                  {fieldError("emergency")}
                </FormGroup>
                <StageCostGroup
                  d={d}
                  patch={patch}
                  frozen={frozen}
                  targetMonth={time.target_month}
                />
              </>
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
                              {fieldError(`share:${e.account_id}`)}
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
                {debts && (
                  <ListGroup footer="每笔贷款退休前后怎么还，可以随时回来修改。">
                    <ListRow
                      title={debts.text}
                      icon={
                        debts.pending || debts.changed ? "warning" : undefined
                      }
                      tone="warn"
                      disabled={frozen}
                      onClick={openDebts}
                    />
                  </ListGroup>
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
                  {fieldError("income_mode")}
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
                      {fieldError(`income:${income.id}`)}
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
                {fieldError("partner_monthly")}
                <Button onClick={() => patch({ contribution: "0" })}>
                  明确按每月存 0 元
                </Button>
              </FormGroup>
            )}
            {flow && step === flowSteps.length - 2 && (
              <>
                <AssumptionForm draft={asm} disabled={frozen} />
                {fieldError("assumptions")}
                {asm.error && <Notice tone="danger">{asm.error}</Notice>}
              </>
            )}
          </>
        )}
      </fieldset>
      {(notice || saver.notice) && (
        <Notice tone="danger">{notice || saver.notice}</Notice>
      )}
      <p className="mp-muted">
        没想好的条件可以先留空。点「保存」才会写入；取消不保存。
      </p>
      {flow && (
        <ActionBar>
          {step > 0 && (
            <Button disabled={frozen} onClick={() => jump(step - 1)}>
              上一步
            </Button>
          )}
          {step < flowSteps.length - 1 ? (
            <Button variant="primary" disabled={frozen} onClick={() => jump(step + 1)}>
              下一步
            </Button>
          ) : (
            <Button variant="primary" disabled={frozen} onClick={() => void save()}>
              保存
            </Button>
          )}
        </ActionBar>
      )}
      {confirmCancel && (
        <Sheet title="放弃这次修改？" cancelLabel="继续编辑" onClose={() => setConfirmCancel(false)}>
          <div className="m-confirm">
            <p className="m-confirm-text">已填的内容还没有保存，放弃后会丢失。</p>
            <Button variant="danger" block onClick={() => nav.pop()}>
              放弃
            </Button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
