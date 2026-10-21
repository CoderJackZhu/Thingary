import "./plan.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePlanningSources } from "../../planning-basic-data";
import type { SectionInput } from "../../planning-basic-data";
import { buildBasicCapabilities } from "../../plan-basic";
import { savePlanningSection } from "../../planning-service";
import type { PlanningSources } from "../../plan";
import { errorMessage } from "../../asset";
import { storedPending, Unresolved } from "../../wealth";
import { useSession } from "../session";
import { useReveal } from "../nav-context";

/** Each visible page reads one consistent source snapshot; reveal and receipt settlement invalidate it. */
export function usePlan() {
  const session = useSession(),
    reveal = useReveal();
  const { load, reload } = usePlanningSources(
    `${reveal}:${session.data?.summary.generation ?? ""}:${session.settled?.input.request_id ?? ""}`,
  );
  const sources = load.status === "ready" ? load.sources : null;
  const computed = useMemo(() => {
    if (!sources) return { capabilities: null, error: "" };
    if (sources.profile.status === "error")
      return { capabilities: null, error: sources.profile.value.message };
    try {
      return { capabilities: buildBasicCapabilities(sources), error: "" };
    } catch (e) {
      return { capabilities: null, error: errorMessage(e) };
    }
  }, [sources]);
  return {
    sources,
    saved:
      sources?.profile.status === "ready" ? sources.profile.value.saved : null,
    capabilities: computed.capabilities,
    today: sources?.today ?? session.today,
    reload,
    loading: load.status === "loading",
    error: load.status === "error" ? load.message : computed.error,
  };
}

/** The shared submit engine owns persistence, request identity and read-only receipt recovery. */
export function usePlanSaver(sources: PlanningSources, reload: () => void) {
  const session = useSession();
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const lock = useRef(false);
  const revision =
    sources.profile.status === "ready"
      ? (sources.profile.value.saved?.revision ?? null)
      : null;
  useEffect(
    () => () => {
      if (lock.current) session.refreshPending();
    },
    [],
  ); // An unmounted save still retains its receipt.
  async function save(input: SectionInput, expected: number | null = revision) {
    if (lock.current || storedPending()) {
      session.refreshPending();
      return null;
    }
    lock.current = true;
    setBusy(true);
    session.setBusy(true);
    setNotice("");
    try {
      const result = await savePlanningSection({
        ...input,
        request_id: crypto.randomUUID(),
        generation: sources.generation,
        expected_revision: expected,
      });
      reload();
      session.reload();
      return result;
    } catch (e) {
      setNotice(e instanceof Unresolved ? e.message : errorMessage(e));
      return null;
    } finally {
      lock.current = false;
      setBusy(false);
      session.setBusy(false);
      session.refreshPending();
    }
  }
  return {
    save,
    busy,
    stuck: !!session.pending,
    notice,
    clear: () => setNotice(""),
  };
}
