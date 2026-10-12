import type { Draft } from './planning-basic-forms';
import { FutureIncomeSection } from './planning-simplified-ui/FutureIncomeSection';
/** Embedded in the four-question setup; the parent saves one atomic transaction. */
export function IncomeQuestion({ d, patch, frozen, today, onEditingChange }: { d: Draft; patch: (v: Partial<Draft>) => void; frozen: boolean; today: string; onEditingChange?: (v: boolean) => void }) {
  return <FutureIncomeSection fields={d.simplified} issues={[]} busy={frozen} today={today} onDraftChange={simplified => patch({ simplified })} onEditingChange={onEditingChange}/>;
}
