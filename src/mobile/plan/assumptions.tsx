import { useEffect, useMemo, useRef, useState } from "react";
import type { PlanningSources } from "../../plan";
import type { AssumptionReadV1 } from "../../planning-followup-contract";
import { nativePlanningFollowupPortV1 } from "../../planning-followup-port";
import { pctToHundredths } from "../../plan";
import { useSession } from "../session";
import { useNav } from "../nav-context";
import { Button, FormGroup, Loading, NavBar, Notice, TextField } from "../ui";
import { t } from '../../i18n.ts';
export const assumptionFields = [
  ["real_return_before_hundredths", t('停工前实际年收益（%）')],
  ["real_return_after_hundredths", t('停工后实际年收益（%）')],
  ["inflation_hundredths", t('通胀（%）')],
  ["volatility_hundredths", t('市场模拟年波动率（%）')],
] as const;

/**
 * The 假设 draft: read once, edited in memory, written by `commit`. The setup flow keeps it alive across steps
 * and commits it together with the other steps when the person saves.
 */
export function useAssumptionDraft(sources: PlanningSources, enabled = true) {
  const port = useMemo(nativePlanningFollowupPortV1, []);
  const [read, setRead] = useState<AssumptionReadV1 | null>(null),
    [error, setError] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [values, setValues] = useState<Record<string, string>>({}),
    [opened, setOpened] = useState("");
  const edited = !!read && (JSON.stringify(values) !== opened || confirmed);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    port.readAssumptions(sources.generation).then((r) => {
      if (!live) return;
      if (r.status !== "ready") {
        setError(r.message);
        return;
      }
      if (r.value.generation !== sources.generation) {
        setError(t('资料库已变化，请返回后重新读取。'));
        return;
      }
      setRead(r.value);
      const initial = Object.fromEntries(
        Object.entries(r.value.values).map(([k, v]) => [k, String(v / 100)]),
      );
      setValues(initial);
      setOpened(JSON.stringify(initial));
    });
    return () => {
      live = false;
    };
  }, [sources.generation, port, enabled]);
  /** The first field whose text is not a percentage, or null when all parse. */
  const invalidKey = () =>
    Object.entries(values).find(([, v]) => pctToHundredths(v) === null)?.[0] ??
    null;
  /**
   * Writes the draft. `fresh` re-reads the revision first (the setup flow has just written the profile).
   * Resolves to an error message, or null when saved.
   */
  async function commit(fresh = false): Promise<string | null> {
    if (!read) return t('假设还没读取完成。');
    if (invalidKey() !== null) return t('请填写有效百分数，例如 2 或 2.5。');
    const parsed = Object.fromEntries(
      Object.entries(values).map(([k, v]) => [k, pctToHundredths(v)]),
    );
    let revision = read.revision;
    if (fresh) {
      const latest = await port.readAssumptions(sources.generation);
      if (latest.status !== "ready") return latest.message;
      revision = latest.value.revision;
    }
    const result = await port.saveAssumptions(
      parsed as unknown as AssumptionReadV1["values"],
      confirmed,
      {
        request_id: crypto.randomUUID(),
        generation: sources.generation,
        expected_revision: revision,
      },
    );
    if (result.status === "saved") {
      setOpened(JSON.stringify(values));
      setConfirmed(false);
      return null;
    }
    if (result.status === "rejected")
      return result.issues.map((i) => i.message).join("；");
    return t('保存结果未确定，请核对原请求。');
  }
  return { read, error, setError, values, setValues, confirmed, setConfirmed, edited, invalidKey, commit };
}
export type AssumptionDraft = ReturnType<typeof useAssumptionDraft>;

/** The four rate fields and the 已核对 toggle, shared by the standalone page and the setup step. */
export function AssumptionForm({ draft, disabled, fieldError }: { draft: AssumptionDraft; disabled: boolean; fieldError?: string }) {
  const { read, values, setValues, confirmed, setConfirmed } = draft;
  return (
    <>
      <FormGroup
        title={
          read?.confirmation === "confirmed"
            ? t('已核对的假设')
            : t('试算假设，尚需核对')
        }
        footer={t('实际收益已扣除通胀。默认收益 0% 只代表跑平通胀；默认波动率是程序试算值。')}
      >
        {assumptionFields.map(([k, label]) => (
          <TextField
            key={k}
            label={label}
            value={values[k] ?? ""}
            inputMode="decimal"
            disabled={disabled}
            onChange={(v) => setValues((x) => ({ ...x, [k]: v }))}
          />
        ))}
      </FormGroup>
      {fieldError && <p className="m-form-hint mp-field-error" role="alert">{fieldError}</p>}
      <Button disabled={disabled} onClick={() => setConfirmed((v) => !v)}>
        {confirmed ? t('已选择：我核对了这些假设') : t('我已核对这些假设（选填）')}
      </Button>
    </>
  );
}

/** Standalone 收益与其他假设 page (opened for just this section). */
export function Assumptions({
  sources,
  reload,
}: {
  sources: PlanningSources;
  reload: () => void;
}) {
  const session = useSession(),
    nav = useNav(),
    lock = useRef(false);
  const settledAtOpen = useRef(session.settled);
  const draft = useAssumptionDraft(sources);
  const { read, error, setError } = draft;
  const [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  useEffect(() => {
    if (done && !session.navBlocked) nav.pop();
  }, [done, session.navBlocked]);
  useEffect(() => {
    if (
      session.settled &&
      session.settled !== settledAtOpen.current &&
      session.settled.command === "plan_assumptions_save" &&
      session.settled.input.generation === sources.generation
    )
      setDone(true);
  }, [session.settled, sources.generation]);
  async function save() {
    if (!read || lock.current || session.navBlocked) return;
    lock.current = true;
    setBusy(true);
    session.setBusy(true);
    setError("");
    try {
      const failure = await draft.commit();
      if (failure === null) {
        reload();
        session.reload();
        setDone(true);
      } else setError(failure);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      lock.current = false;
      setBusy(false);
      session.setBusy(false);
      session.refreshPending();
    }
  }
  return (
    <div className="m-page mp-page">
      <NavBar title={t('收益与其他假设')} />
      {!read && !error ? (
        <Loading />
      ) : (
        <>
          <AssumptionForm draft={draft} disabled={busy || !!session.pending} />
          <Button
            variant="primary"
            disabled={!read || busy || !!session.pending}
            onClick={() => void save()}
          >
            {t('保存假设')}
          </Button>
        </>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
    </div>
  );
}
