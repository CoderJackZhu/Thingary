import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('asset detail and global page read the same backend timeline projection', () => {
  const views = read('../src/AssetViews.tsx');
  const timeline = read('../src/Timeline.tsx');
  assert.match(views, /<Timeline assetId=\{record\.asset\.id\}/);
  assert.doesNotMatch(views, /购入记录/, 'no second hand-built purchase row in the detail');
  assert.match(timeline, /invoke<TimelinePage>\('list_timeline', \{ query: \{ filter, asset_id: assetId \?\? null \} \}\)/);
  assert.match(timeline, /日期待补充/);
  // Q03: the global page is the single source-navigation timeline; the legacy
  // dual entry is gone.
  assert.match(read('../src/main.tsx'), /section === 'timeline' && <SourceTimelinePage/);
  assert.doesNotMatch(read('../src/main.tsx'), /\bTimelinePage\b/);
});

test('every labelled event kind has an icon, shared by the timeline page and the overview recent list', () => {
  const timeline = read('../src/Timeline.tsx');
  const labels = timeline.match(/export function eventLabel[\s\S]*?return \(\{([\s\S]*?)\} as Record<string, string>/)[1];
  const kinds = new Set([...labels.matchAll(/(\w+): /g)].map(m => m[1]));
  const icons = timeline.match(/export function eventIcon[\s\S]*?\?\? 'clock';/)[0];
  assert.ok(kinds.size >= 14, 'label table parsed');
  for (const kind of kinds) assert.ok(kind.startsWith('wish_') || kind.startsWith('warranty_') || new RegExp(`\\b${kind}: '`).test(icons), `no icon for ${kind}`);
  assert.match(timeline, /const icon = eventIcon\(e\.kind\)/);
  assert.match(read('../src/ReviewView.tsx'), /icon: eventIcon\(ev\.kind\)/);
});
