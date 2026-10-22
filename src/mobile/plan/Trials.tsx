import { useEffect, useMemo, useState } from "react";
import type {
  BasicCapabilities,
  PlanningSources,
} from "../../plan-basic-contract";
import type { CareerDraft, CareerLump } from "../../plan-career-contract";
import { prepareIncomeScope } from "../../career-preview/income-scope";
import type { IncomeDraft } from "../../career-preview/income-scope";
import {
  realGuidedDefaults,
  confirmGuidedCashCosts,
  restLevers,
  yuan,
} from "../../career-preview/guided-model";
import { retireCalcFromCapabilities } from "../../plan-retire-calc";
import { loadConsideringWishes } from "../../plan-data";
import {
  classifyWishes,
  counted,
  impactOf,
  impactSentence,
  isReady,
} from "../../plan-wishes";
import type { WishLike } from "../../plan-wishes";
import type { ProfileState } from "../../plan";
import { moneyText } from "../format";
import { contributionSources } from "../../planning-basic-forms";
import { useNav } from "../nav-context";
import { usePlan } from "./data";
import { careerTrial, runwayTrial, trialDateValid } from "./trial-model";
import type { CareerQuestion, CareerTrialResult } from "./trial-model";
import {
  Button,
  Card,
  DateField,
  EmptyState,
  ErrorState,
  FormRow,
  HBarChart,
  LargeTitle,
  Loading,
  MoneyField,
  Notice,
  Section,
  SelectField,
  Switch,
  TextField,
  UnknownState,
} from "../ui";
import { CoverageSummary } from "./CoverageSummary";
import "./trials.css";
import { t } from '../../i18n.ts';
function MonthField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  return (
    <FormRow label={label} stacked>
      <input
        className="m-input"
        aria-label={label}
        type="month"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
      />
    </FormRow>
  );
}
function CountField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <FormRow label={label} stacked>
      <input
        className="m-input"
        aria-label={label}
        inputMode="numeric"
        type="number"
        min="0"
        max="1200"
        step="1"
        value={value ?? ""}
        onChange={(e) =>
          onChange(e.target.value === "" ? null : Number(e.target.value))
        }
      />
    </FormRow>
  );
}
function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <FormRow label={label}>
      <Switch label={label} checked={checked} onChange={onChange} />
    </FormRow>
  );
}

export function MobileRunway({
  capabilities,
  today,
}: {
  capabilities: BasicCapabilities | null;
  today: string;
}) {
  const nav = useNav(),
    [manual, setManual] = useState(false),
    [start, setStart] = useState(""),
    [date, setDate] = useState(today);
  const [income, setIncome] = useState(""),
    [noIncome, setNoIncome] = useState(false),
    [spend, setSpend] = useState(""),
    [floor, setFloor] = useState(""),
    [months, setMonths] = useState(60);
  const funds = capabilities?.funds,
    useManual = manual || !funds;
  const balance = useManual
    ? start
    : funds?.status === "ready"
      ? funds.value.available_cents
      : null;
  const anchor = useManual
    ? date
    : funds?.status === "ready"
      ? funds.value.date
      : "";
  const result = useMemo(
    () =>
      runwayTrial({
        start: balance,
        date: anchor,
        today,
        income,
        noIncome,
        spend,
        floor,
        months,
      }),
    [balance, anchor, today, income, noIncome, spend, floor, months],
  );
  const stale =
    trialDateValid(anchor) &&
    (Date.parse(today) - Date.parse(anchor)) / 86400000 > 45;
  return (
    <Section title={t('资金续航')}>
      <Card>
        <p className="m-trial-note">
          {t('按当前收支，手里的钱能付几个月？无需退休目标，输入仅用于本次试算。')}
        </p>
        {funds && (
          <Check
            label={t('改用手填模拟资金')}
            checked={manual}
            onChange={setManual}
          />
        )}
        {useManual ? (
          <>
            <MoneyField
              label={t('当前可动用资金')}
              value={start}
              onChange={setStart}
            />
            <DateField
              label={t('资金截至日')}
              value={date}
              max={today}
              onChange={setDate}
            />
          </>
        ) : funds?.status === "ready" ? (
          <p className="m-trial-note">
            {t('截至 {date} 可用 {v2}（', { date: funds.value.date, v2: moneyText(funds.value.available_cents) })}
            {funds.value.kind === "live" ? t('实际盘点') : t('手填模拟')}）。
          </p>
        ) : (
          <UnknownState
            message={t('可用资金还未确认，可改用手填独立试算。')}
            action={
              <Button
                onClick={() => nav.push("plan.setup", { section: "funds" })}
              >
                {t('确认可用资金')}
              </Button>
            }
          />
        )}
        {stale && (
          <Notice>
            {t('起点已超过 45 天；计算从 {anchor}', { anchor })}{" "}
            {t('开始，之后实际变化未覆盖，不能当成今天余额。')}
          </Notice>
        )}
        <MoneyField
          label={t('每月可靠到账')}
          value={income}
          disabled={noIncome}
          onChange={setIncome}
        />
        <Check
          label={t('目前没有可靠到账')}
          checked={noIncome}
          onChange={setNoIncome}
        />
        <MoneyField label={t('每月必要开销')} value={spend} onChange={setSpend} />
        <MoneyField
          label={t('至少保留的资金（选填）')}
          value={floor}
          onChange={setFloor}
        />
        <SelectField
          label={t('检查期间')}
          value={String(months)}
          onChange={(v) => setMonths(Number(v))}
          options={[12, 24, 60, 120].map((n) => ({
            id: String(n),
            label: t('{n} 个月', { n }),
          }))}
        />
        {result.status === "missing" ? (
          <UnknownState title={t('条件待填写')} message={result.message} />
        ) : (
          <div aria-live="polite">
            <Notice
              tone={
                result.result.status === "not_reached" &&
                result.lines.tone !== "warn"
                  ? "positive"
                  : "warn"
              }
            >
              {result.lines.main}
            </Notice>
            {result.lines.floor && <p>{result.lines.floor}</p>}
          </div>
        )}
        <details>
          <summary>{t('计算口径与局限')}</summary>
          <p>
            {t('从截至日后按完整月检查，月初先付开销、月底再到账。不计收益、通胀、未来大额计划或月供结束。必要开销需自行包含房租、月供、社保等全部支出。资金不足以付整月不等于余额耗尽。')}
          </p>
          <p>
            {t('公积金缴存不能当作到账；余额已包含在起点时，不要再次计作收入。定期提取须能持续整个检查期间。')}
          </p>
        </details>
      </Card>
    </Section>
  );
}

function TrialIncome({
  value,
  onChange,
}: {
  value: IncomeDraft;
  onChange: (v: IncomeDraft) => void;
}) {
  const patch = (id: string, fields: Partial<IncomeDraft["items"][number]>) =>
    onChange({
      ...value,
      items: value.items.map((x) => (x.id === id ? { ...x, ...fields } : x)),
    });
  const add = () =>
    onChange({
      ...value,
      items: [
        ...value.items,
        {
          id: crypto.randomUUID(),
          name: "",
          role: "other",
          included: true,
          monthly_cents: null,
          start_month: null,
          end_month: null,
          basis: "start_month",
          basis_month: null,
          growth: "fixed_nominal",
          source: null,
          source_checked_on: null,
          notes: "",
        },
      ],
    });
  return (
    <>
      <SelectField
        label={t('本次未来收入')}
        value={value.mode}
        onChange={(mode) =>
          onChange({ ...value, mode: mode as IncomeDraft["mode"] })
        }
        options={[
          { id: "saved", label: t('沿用原计划') },
          { id: "excluded", label: t('本次不计入') },
          { id: "manual", label: t('手填本次条件') },
        ]}
      />
      <Check
        label={t('本次不计暂时取不出的钱转为可用资金')}
        checked={!!value.excludePools}
        onChange={(excludePools) => onChange({ ...value, excludePools })}
      />
      {value.mode === "manual" && (
        <>
          {value.items.map((x, i) => (
            <div key={x.id} className="m-trial-item">
              <Check
                label={t('计入第 {v1} 笔临时收入', { v1: i + 1 })}
                checked={x.included}
                onChange={(included) => patch(x.id, { included })}
              />
              {x.included && (
                <>
                  <TextField
                    label={t('第 {v1} 笔收入名称', { v1: i + 1 })}
                    value={x.name}
                    onChange={(name) => patch(x.id, { name })}
                  />
                  <MoneyField
                    label={t('第 {v1} 笔每月收入', { v1: i + 1 })}
                    value={x.monthly_cents ?? ""}
                    onChange={(v) => patch(x.id, { monthly_cents: v || null })}
                  />
                  <MonthField
                    label={t('第 {v1} 笔开始月份', { v1: i + 1 })}
                    value={x.start_month}
                    onChange={(start_month) => patch(x.id, { start_month })}
                  />
                  <MonthField
                    label={t('第 {v1} 笔结束月份（选填）', { v1: i + 1 })}
                    value={x.end_month}
                    onChange={(end_month) => patch(x.id, { end_month })}
                  />
                  <SelectField
                    label={t('第 {v1} 笔金额基准', { v1: i + 1 })}
                    value={x.basis}
                    onChange={(basis) =>
                      patch(x.id, { basis: basis as typeof x.basis })
                    }
                    options={[
                      { id: "start_month", label: t('开始月份的金额') },
                      { id: "reference_month", label: t('指定月份的金额') },
                    ]}
                  />
                  {x.basis === "reference_month" && (
                    <MonthField
                      label={t('第 {v1} 笔基准月份', { v1: i + 1 })}
                      value={x.basis_month}
                      onChange={(basis_month) => patch(x.id, { basis_month })}
                    />
                  )}
                  <Check
                    label={t('第 {v1} 笔保持购买力', { v1: i + 1 })}
                    checked={x.growth === "constant_purchasing_power"}
                    onChange={(v) =>
                      patch(x.id, {
                        growth: v
                          ? "constant_purchasing_power"
                          : "fixed_nominal",
                      })
                    }
                  />
                </>
              )}
              <Button
                variant="danger"
                onClick={() =>
                  onChange({
                    ...value,
                    items: value.items.filter((a) => a.id !== x.id),
                  })
                }
              >
                {t('删除此临时收入')}
              </Button>
            </div>
          ))}
          <Button onClick={add}>{t('添加临时未来收入')}</Button>
        </>
      )}
      <p className="m-trial-note">
        {t('养老金只使用已填写的金额与月份，不测算待遇、资格或缴费变化。固定账面金额会随通胀贬值；结束月仍计入。')}
      </p>
    </>
  );
}

export function MobileCareer({
  sources,
  today,
}: {
  sources: PlanningSources;
  today: string;
}) {
  const defaults = useMemo(
    () => realGuidedDefaults(sources, today),
    [sources, today],
  );
  const retire =
    sources.profile.status === "ready"
      ? sources.profile.value.saved?.profile.retire
      : null;
  const costNames = new Map(
    retire ? contributionSources(retire).map((x) => [x.id, x.label]) : [],
  );
  const [draft, setDraft] = useState(defaults.draft),
    [income, setIncome] = useState(defaults.income),
    [question, setQuestion] = useState<CareerQuestion>("rest");
  const [lowerGap, setLowerGap] = useState<number | null>(0),
    [result, setResult] = useState<CareerTrialResult | null>(null),
    [error, setError] = useState("");
  const [levers, setLevers] = useState<
    { label: string; text: string }[] | null
  >(null);
  const invalidate = () => {
    setResult(null);
    setLevers(null);
    setError("");
  };
  const patch = (fields: Partial<CareerDraft>) => {
    setDraft((d) => ({ ...d, ...fields }));
    invalidate();
  };
  const gap = (fields: Partial<CareerDraft["gap"]>) =>
    patch({ gap: { ...draft.gap, ...fields } });
  const extra = draft.gap.extra_income ?? {
    lump_cents: null,
    benefit_monthly_cents: null,
    benefit_months: null,
  };
  const setExtra = (fields: Partial<typeof extra>) =>
    gap({ extra_income: { ...extra, ...fields } });
  const lumps = draft.lumps ?? [],
    setLump = (i: number, fields: Partial<CareerLump>) =>
      patch({
        lumps: lumps.map((l, n) => (n === i ? { ...l, ...fields } : l)),
      });
  const hasGap =
    question === "rest" ||
    (question === "lower" ? lowerGap !== 0 : draft.gap_months !== 0);
  const run = () => {
    try {
      setError("");
      setResult(careerTrial(sources, draft, income, question, lowerGap));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <Section title={t('职业变化')}>
      <Card>
        <p className="m-trial-note">
          {t('沿用已保存的目标、资金和假设。下面只改变本次条件，关闭即丢弃。')}
        </p>
        <SelectField
          label={t('想知道什么')}
          value={question}
          onChange={(v) => {
            setQuestion(v as CareerQuestion);
            invalidate();
          }}
          options={[
            { id: "rest", label: t('我想歇一阵，能撑多久？') },
            { id: "switch", label: t('换工作后，每月要攒多少？') },
            { id: "lower", label: t('高收入还要做多久？') },
          ]}
        />
        {question !== "lower" && (
          <MonthField
            label={t('开始变化的月份')}
            value={draft.transition_month}
            onChange={(transition_month) => patch({ transition_month })}
          />
        )}
        {question !== "rest" && (
          <CountField
            label={t('中间空窗月数')}
            value={question === "lower" ? lowerGap : draft.gap_months}
            onChange={(v) => {
              if (question === "lower") {
                setLowerGap(v);
                invalidate();
              } else patch({ gap_months: v });
            }}
          />
        )}
        {hasGap && (
          <>
            <MoneyField
              label={t('不工作期间每月总花销')}
              value={draft.gap.spend_cents ?? ""}
              onChange={(v) => gap({ spend_cents: v || null })}
            />
            <MoneyField
              label={t('不工作期间每月到账')}
              value={draft.gap.income_cents ?? ""}
              onChange={(v) => gap({ income_cents: v || null })}
              hint={t('没有到账请明确填 0，留空表示未知。')}
            />
          </>
        )}
        {question !== "lower" && (
          <MoneyField
            label={t('找到新工作后每月能攒')}
            value={draft.recovery.monthly_cents ?? ""}
            signed
            onChange={(v) =>
              patch({
                recovery: { ...draft.recovery, monthly_cents: v || null },
              })
            }
            hint={
              defaults.from.recovery
                ? t('先沿用当前预计净投入，可改为自己的估计。')
                : t('扣除全部支出后能存下的钱，可以为 0 或负数。')
            }
          />
        )}
        <Check
          label={t('上述金额包含全部自付社保、医保等费用')}
          checked={
            draft.gap.insurance.included && draft.recovery.insurance.included
          }
          onChange={(v) => {
            setDraft(confirmGuidedCashCosts(draft, v));
            invalidate();
          }}
        />
        <details>
          <summary>{t('本次收入与资金假设')}</summary>
          <TrialIncome
            value={income}
            onChange={(v) => {
              setIncome(v);
              invalidate();
            }}
          />
          {question !== "lower" && (
            <>
              <MoneyField
                label={t('一次性补偿金（选填）')}
                value={extra.lump_cents ?? ""}
                onChange={(v) => setExtra({ lump_cents: v || null })}
              />
              <MoneyField
                label={t('失业金每月（选填）')}
                value={extra.benefit_monthly_cents ?? ""}
                onChange={(v) => setExtra({ benefit_monthly_cents: v || null })}
              />
              <CountField
                label={t('失业金最多领取月数')}
                value={extra.benefit_months}
                onChange={(benefit_months) => setExtra({ benefit_months })}
              />
              <p className="m-trial-note">
                {t('补偿金在变化月月底到账；失业金复工后停止。只填税后到账，不作政策估算。')}
              </p>
            </>
          )}
          {lumps.map((l, i) => (
            <div className="m-trial-item" key={i}>
              <MonthField
                label={t('第 {v1} 笔一次性收入月份', { v1: i + 1 })}
                value={l.month}
                onChange={(v) => setLump(i, { month: v ?? "" })}
              />
              <MoneyField
                label={t('第 {v1} 笔一次性收入金额', { v1: i + 1 })}
                value={l.cents}
                onChange={(cents) => setLump(i, { cents })}
              />
              <Button
                variant="danger"
                onClick={() =>
                  patch({ lumps: lumps.filter((_, n) => n !== i) })
                }
              >
                {t('删除这笔一次性收入')}
              </Button>
            </div>
          ))}
          <Button
            disabled={lumps.length >= 24}
            onClick={() =>
              patch({ lumps: [...lumps, { month: "", cents: "" }] })
            }
          >
            {t('添加一次性收入')}
          </Button>
          <p className="m-trial-note">
            {t('只填未含在每月净存入内的额外税后到账，在对应月月底计入。')}
          </p>
          {question === "rest" && (
            <>
              <MoneyField
                label={t('资金底线（选填）')}
                value={draft.floor_cents ?? ""}
                onChange={(v) => patch({ floor_cents: v || null })}
              />
              <Check
                label={t('这些钱随时能取出来用')}
                checked={draft.liquid_funds_confirmed}
                onChange={(liquid_funds_confirmed) =>
                  patch({ liquid_funds_confirmed })
                }
              />
            </>
          )}
          {(["gap", "recovery"] as const).map((stage) => (
            <div key={stage}>
              {!!draft[stage].costs?.length && (
                <p>
                  {stage === "gap" ? t('不工作期间') : t('复工后')}
                  {t('费用范围（沿用原计划）')}
                </p>
              )}
              {draft[stage].costs?.map((cost, i) => (
                <SelectField
                  key={cost.source_id}
                  label={`${stage === "gap" ? t('空窗') : t('复工')}：${costNames.get(cost.source_id) ?? t('费用 {v1}', { v1: i + 1 })}`}
                  value={cost.treatment}
                  onChange={(treatment) =>
                    patch({
                      [stage]: {
                        ...draft[stage],
                        costs: draft[stage].costs!.map((c) =>
                          c.source_id === cost.source_id
                            ? {
                                ...c,
                                treatment: treatment as typeof c.treatment,
                              }
                            : c,
                        ),
                      },
                    })
                  }
                  options={[
                    { id: "included", label: t('已包含在上述金额') },
                    { id: "extra", label: t('另行扣除') },
                    { id: "excluded", label: t('本次不计入') },
                  ]}
                />
              ))}
            </div>
          ))}
        </details>
        <Button block variant="primary" onClick={run}>
          {t('计算本次职业变化')}
        </Button>
        {error && <ErrorState title={t('试算失败')} message={error} onRetry={run} />}
        {!result && !error && (
          <p className="m-trial-note">
            {t('补充条件后点击计算；留空的金额不会按 0 处理。')}
          </p>
        )}
        {result?.message && (
          <UnknownState title={t('条件不完整')} message={result.message} />
        )}
        {result?.answer && (
          <div aria-live="polite">
            <Notice tone={result.answer.tone === "good" ? "positive" : "warn"}>
              {result.answer.headline}
            </Notice>
            <p>{result.answer.sub}</p>
          </div>
        )}
        {result?.rows && (
          <>
            <HBarChart
              summary={t('比较复工后按当前净投入的零、四分之一、一半和四分之三储蓄时，高收入需要持续到什么时候；具体结论见下方。')}
              rows={result.rows.map((r) => ({
                label: yuan(r.level),
                value: Number(r.level),
                display: r.say.tone === "good" ? t('可行') : t('待调整'),
              }))}
            />
            {result.rows.map((r) => (
              <div className="m-trial-item" key={r.level}>
                <strong>{t('之后每月攒 {v1}', { v1: yuan(r.level) })}</strong>
                <p>{r.say.headline}</p>
                <p className="m-trial-note">{r.say.sub}</p>
              </div>
            ))}
          </>
        )}
        {question === "rest" && result?.answer && (
          <>
            <Button
              onClick={() => {
                try {
                  const scope = prepareIncomeScope(sources, draft, income);
                  if (scope.sources)
                    setLevers(restLevers(scope.sources, scope.draft));
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              {t('怎样才能撑得更久？')}
            </Button>
            {levers?.map((l) => (
              <p key={l.label}>
                {l.label}：{l.text}
              </p>
            ))}
          </>
        )}
        <details>
          <summary>{t('结果的局限')}</summary>
          <p>
            {t('不预测失业风险、复工时间或工资变化；每月付款先后只在不工作区间检查。未来收入和受限资金是否计入，以上述本次假设为准。公积金周期缴存、提取与余额耗尽尚未推演。')}
          </p>
        </details>
      </Card>
    </Section>
  );
}

export function MobileWishImpact({
  saved,
  capabilities,
  today,
  sourceKey,
}: {
  saved: NonNullable<ProfileState["saved"]> | null;
  capabilities: BasicCapabilities | null;
  today: string;
  sourceKey: string;
}) {
  const nav = useNav(),
    [items, setItems] = useState<WishLike[] | null>(null),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setItems(null);
    setError("");
    loadConsideringWishes()
      .then((v) => {
        if (live) setItems(v);
      })
      .catch((e) => {
        if (live) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, [sourceKey, retry]);
  const calc = useMemo(
    () =>
      saved && capabilities
        ? retireCalcFromCapabilities(saved, capabilities, today)
        : null,
    [saved, capabilities, today],
  );
  const spends = useMemo(
      () => classifyWishes(items ?? [], today),
      [items, today],
    ),
    ready = isReady(calc);
  const total =
    ready && counted(spends).length ? impactOf(calc, counted(spends)) : null;
  return (
    <Section title={t('心愿影响')}>
      <Card>
        <p className="m-trial-note">
          {t('只比较「考虑中」的心愿影响，不计入目标；决定后可加入大额计划。已计入的大额计划照常发生。')}
        </p>
        {error ? (
          <ErrorState
            title={t('心愿读取失败')}
            message={error}
            onRetry={() => setRetry((n) => n + 1)}
          />
        ) : items === null ? (
          <Loading label={t('正在读取心愿…')} />
        ) : !spends.length ? (
          <EmptyState
            icon="chart"
            title={t('还没有考虑中的心愿')}
            message={t('添加预计价格与计划日期后，可以查看对目标的影响。')}
          />
        ) : (
          <>
            {!ready && (
              <UnknownState
                title={t('暂不能估算影响')}
                message={t('需要已保存的明确预计投入，以及完整的预测条件。')}
                action={
                  <Button
                    onClick={() =>
                      nav.push("plan.setup", { section: "contribution" })
                    }
                  >
                    {t('补充条件')}
                  </Button>
                }
              />
            )}
            {total && (
              <Notice>
                {total.base_offset === null
                  ? t('按当前条件，终点前本来就达不到财务自由。')
                  : total.with_offset === null
                    ? t('全部有日期的心愿发生后，终点前达不到财务自由。')
                    : t('全部有日期的心愿发生后，财务自由约推迟 {delay_months} 个月。', { delay_months: total.delay_months })}
                {total.breaches_emergency ? t('购买区间内会低于应急金线。') : ""}
              </Notice>
            )}
            {spends.map((s) => (
              <div className="m-trial-item" key={s.id}>
                <div className="m-trial-wish-title">
                  <strong>{s.name}</strong>
                  <span>
                    {s.status === "no_price"
                      ? t('价格未知')
                      : moneyText(String(s.cents))}
                  </span>
                </div>
                <p className="m-trial-note">
                  {s.status === "no_price"
                    ? t('未填预计价格，未计入。')
                    : s.status === "expired"
                      ? t('计划日期已过，未计入；更新日期后重算。')
                      : ready
                        ? impactSentence(
                            s,
                            impactOf(calc, [s]),
                            calc.r.emergency_months,
                            (v) => moneyText(String(v)),
                          )
                        : s.status === "today"
                          ? t('未设日期，仅作如果今天买下的单件假设，不计入合计。')
                          : t('计划 {date}，条件补齐后估算。', { date: s.date })}
                </p>
                <Button
                  variant="plain"
                  onClick={() => nav.push("wishes.detail", { id: s.id })}
                >
                  {t('查看心愿')}
                </Button>
              </div>
            ))}
          </>
        )}
      </Card>
    </Section>
  );
}

export default function Trials() {
  const { sources, saved, capabilities, today, reload, loading, error } =
    usePlan();
  const nav = useNav();
  const key = sources
    ? `${sources.generation}:${sources.write_version}:${saved?.revision ?? ""}:${today}`
    : "";
  return (
    <div className="m-page m-plan-trials">
      <LargeTitle title={t('试算')} subtitle={t('换个条件，看生活还有哪些可能')} />
      {loading ? (
        <Loading />
      ) : (
        <>
          {error && <ErrorState message={String(error)} onRetry={reload} />}
          <CoverageSummary annotations={capabilities?.annotations} />
          <MobileRunway
            key={`runway:${key}`}
            capabilities={capabilities ?? null}
            today={today}
          />
          {sources && saved ? (
            <MobileCareer
              key={`career:${key}`}
              sources={sources}
              today={today}
            />
          ) : (
            <EmptyState
              icon="chart"
              title={t('先设置一个规划目标')}
              message={t('设置目标、预算和资金后，就能试算职业变化；资金续航可独立使用。')}
              action={
                <Button onClick={() => nav.push("plan.setup")}>{t('设置条件')}</Button>
              }
            />
          )}
          {sources && (
            <MobileWishImpact
              key={`wishes:${key}`}
              sourceKey={key}
              saved={saved}
              capabilities={capabilities ?? null}
              today={today}
            />
          )}
        </>
      )}
    </div>
  );
}
