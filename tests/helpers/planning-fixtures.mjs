// Fictional current sources shared by general domain regressions. No native library opened.
import {basicFixtureSources} from '../../src/plan-basic-fixtures.ts';
export function fictionalSources(contribution=null) {
 const s=basicFixtureSources();s.profile.value.saved.profile.retire.basic.contribution.monthly_cents=contribution;
 s.generation=s.profile.value.generation='fictional';s.today='2026-10-07';return s;
}
