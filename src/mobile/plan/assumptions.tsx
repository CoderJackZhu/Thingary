import { useEffect, useMemo, useRef, useState } from "react";
import type { PlanningSources } from "../../plan";
import type { AssumptionReadV1 } from "../../planning-followup-contract";
import { nativePlanningFollowupPortV1 } from "../../planning-followup-port";
import { pctToHundredths } from "../../plan";
import { useSession } from "../session";
import { useNav } from "../nav-context";
import { Button, FormGroup, Loading, NavBar, Notice, TextField } from "../ui";
export function Assumptions({
  sources,
  reload,
}: {
  sources: PlanningSources;
  reload: () => void;
}) {
  const session = useSession(),
    nav = useNav(),
    port = useMemo(nativePlanningFollowupPortV1, []),
    lock = useRef(false);
  const settledAtOpen = useRef(session.settled);
  const [read, setRead] = useState<AssumptionReadV1 | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [done, setDone] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    port.readAssumptions(sources.generation).then((r) => {
      if (!live) return;
      if (r.status !== "ready") {
        setError(r.message);
        return;
      }
      if (r.value.generation !== sources.generation) {
        setError("资料库已变化，请返回后重新读取。");
        return;
      }
      setRead(r.value);
      setValues(
        Object.fromEntries(
          Object.entries(r.value.values).map(([k, v]) => [k, String(v / 100)]),
        ),
      );
    });
    return () => {
      live = false;
    };
  }, [sources.generation, port]);
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
      const parsed = Object.fromEntries(
        Object.entries(values).map(([k, v]) => [k, pctToHundredths(v)]),
      );
      if (Object.values(parsed).some((v) => v === null))
        throw new Error("请填写有效百分数，例如 2 或 2.5。");
      const result = await port.saveAssumptions(
        parsed as unknown as AssumptionReadV1["values"],
        confirmed,
        {
          request_id: crypto.randomUUID(),
          generation: sources.generation,
          expected_revision: read.revision,
        },
      );
      if (result.status === "saved") {
        reload();
        session.reload();
        setDone(true);
      } else if (result.status === "rejected")
        setError(result.issues.map((i) => i.message).join("；"));
      else setError("保存结果未确定，请核对原请求。");
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
      <NavBar title="收益与其他假设" />
      {!read && !error ? (
        <Loading />
      ) : (
        <>
          <FormGroup
            title={
              read?.confirmation === "confirmed"
                ? "已核对的假设"
                : "试算假设，尚需核对"
            }
            footer="实际收益已扣除通胀。默认收益 0% 只代表跑平通胀；默认波动率是程序试算值。"
          >
            {(
              [
                ["real_return_before_hundredths", "停工前实际年收益（%）"],
                ["real_return_after_hundredths", "停工后实际年收益（%）"],
                ["inflation_hundredths", "通胀（%）"],
                ["volatility_hundredths", "市场模拟年波动率（%）"],
              ] as const
            ).map(([k, label]) => (
              <TextField
                key={k}
                label={label}
                value={values[k] ?? ""}
                inputMode="decimal"
                disabled={busy || !!session.pending}
                onChange={(v) => setValues((x) => ({ ...x, [k]: v }))}
              />
            ))}
          </FormGroup>
          <Button
            disabled={busy || !!session.pending}
            onClick={() => setConfirmed((v) => !v)}
          >
            {confirmed
              ? "已选择：我核对了这些假设"
              : "我已核对这些假设（选填）"}
          </Button>
          <Button
            variant="primary"
            disabled={!read || busy || !!session.pending}
            onClick={() => void save()}
          >
            保存假设
          </Button>
        </>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
    </div>
  );
}
