import test from 'node:test';
import assert from 'node:assert/strict';
import {savingPercent} from '../src/preferences.ts';
test('savings ring agrees with cent precision at the completion boundary',()=>{
 assert.equal(savingPercent('9999','10000'),99);
 assert.equal(savingPercent('10000','10000'),100);
 assert.equal(savingPercent('10001','10000'),100);
 assert.equal(savingPercent('0',null),null);
 assert.equal(savingPercent('0','0'),100);
 assert.equal(savingPercent('99999999998','99999999999'),99);
});
