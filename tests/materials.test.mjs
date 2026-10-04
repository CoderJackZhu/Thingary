import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { MATERIALS, materialOf, materialArt, materialPhotoName, materialActionLabel, materialCategories, filterMaterials } from '../src/materials.ts';
import { objectArt } from '../src/illustrations.ts';

test('material catalog equals the shipped manifest and embedded artwork', () => {
  const manifest = JSON.parse(readFileSync(new URL('../src-tauri/materials/materials.json', import.meta.url), 'utf8'));
  assert.deepEqual(MATERIALS, manifest);
  const embedded = readdirSync(new URL('../src-tauri/materials/', import.meta.url)).filter(f => f.endsWith('.png')).sort();
  assert.deepEqual(embedded, manifest.map(m => `${m.id}.png`).sort());
});

test('eight original illustrations keep stable ids and D13 names', () => {
  assert.deepEqual(MATERIALS.slice(0, 8).map(m => m.id), ['laptop', 'camera', 'headphones', 'phone', 'tablet', 'keyboard', 'coffee', 'box']);
  assert.deepEqual(MATERIALS.slice(0, 8).map(m => m.name), ['电脑', '相机', '耳机', '手机', '平板', '键盘', '咖啡机', '通用物品']);
  // The generic illustration must not claim a recorder look; ids are not category ids.
  assert.equal(materialOf('box').name, '通用物品');
  assert.notEqual(materialOf('phone').id, materialOf('tablet').id);
});

test('unknown material ids resolve to nothing and fall back to the generic art', () => {
  assert.equal(materialOf(''), null);
  assert.equal(materialOf('../materials/laptop'), null);
  assert.equal(materialOf('录音设备'), null);
  assert.equal(materialOf(null), null);
  assert.equal(materialArt('../materials/laptop'), objectArt('box'));
  assert.ok(new Set(MATERIALS.map(m => materialArt(m.id))).size >= 50);
});

test('photography groups existing gear with distinct accessories and keeps recent-use ordering', () => {
  assert.ok(materialCategories.includes('摄影'));
  for (const id of ['camera','icon-camera','icon-lens','icon-camcorder','icon-webcam','icon-actioncam','icon-drone','icon-gimbal','object3d-camera']) assert.equal(materialOf(id).category,'摄影');
  const entries=MATERIALS.map(m=>({id:m.id,name:m.name,builtin:true}));
  const photos=filterMaterials(entries,'icon','摄影','',[]);
  assert.deepEqual(photos.slice(0,6).map(m=>m.id),['icon-camera','icon-lens','icon-camera-battery','icon-memory-card','icon-camera-bag','icon-camera-charger']);
  for(const id of ['flash','fill-light','filter','reflector','camera-battery','camera-charger','camera-bag','dry-cabinet','tripod','memory-card','lens-hood','camera-strap']) assert.ok(photos.some(m=>m.id==='icon-'+id));
  assert.equal(new Set(photos.map(m=>materialArt(m.id))).size,photos.length);
  assert.deepEqual(filterMaterials(entries,'recent','摄影','',['icon-filter','icon-lens']).map(m=>m.id),['icon-filter','icon-lens']);
  assert.deepEqual(filterMaterials(entries,'icon','摄影','ND',[]).map(m=>m.id),['icon-filter']);
});

test('material photo names state they are illustrations, not photos', () => {
  assert.equal(materialPhotoName(materialOf('keyboard')), '键盘示意图（非实物照片）');
  for (const m of MATERIALS) {
    const name = materialPhotoName(m);
    assert.ok(name.includes(m.name) && name.includes('示意图') && name.includes('非实物照片'));
  }
});

test('tile action labels keep the illustration note for built-ins only', () => {
  assert.equal(materialActionLabel({ id: 'keyboard', name: '键盘', builtin: true }), '添加素材：键盘（示意图，非实物照片）');
  assert.equal(materialActionLabel({ id: 'uuid-1', name: '我的照片.png', builtin: false }), '添加素材：我的照片.png');
});
