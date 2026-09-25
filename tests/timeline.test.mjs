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
  assert.match(read('../src/main.tsx'), /section === 'timeline' && <TimelinePage/);
});
