import type { SimplifiedPlanningPortV1, SimplifiedPlanningFieldsV1, SimplifiedPlanningSetupV1, SaveContextV1, SaveOutcomeV1 } from './plan-simplified-contract.ts';
import { validateSimplifiedPlanningV1 } from './plan-simplified.ts';
/** Inject an actual transaction/receipt driver. Missing drivers throw; no default saved result. */
export function createSimplifiedPlanningPortV1(driver: SimplifiedPlanningPortV1): SimplifiedPlanningPortV1 {
  const save = async (fields: SimplifiedPlanningFieldsV1, context: SaveContextV1, setup?: SimplifiedPlanningSetupV1): Promise<SaveOutcomeV1> => {
    const issues = validateSimplifiedPlanningV1(fields);
    if (issues.length) return { status: 'rejected', issues };
    return setup ? driver.saveSetup(setup, context) : driver.save(fields, context);
  };
  return { read: () => driver.read(), save: (f, c) => save(f, c), saveSetup: (s, c) => save(s.fields, c, s), resolve: c => driver.resolve(c) };
}
