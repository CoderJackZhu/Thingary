import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

test('macOS native notifications distinguish unrequested, denied, authorized and failed requests', {skip:process.platform!=='darwin'}, ()=>{
  const directory=mkdtempSync(join(tmpdir(),'thingary-notifications-test-'));
  try{
    const contents=join(directory,'Fictional Notifications.app','Contents');
    mkdirSync(join(contents,'MacOS'),{recursive:true});
    writeFileSync(join(contents,'Info.plist'),`<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>local.thingary.notifications.unittest</string><key>CFBundleExecutable</key><string>notifications</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`);
    const executable=join(contents,'MacOS','notifications');
    execFileSync('xcrun',['clang','-fobjc-arc','-framework','Foundation','-framework','UserNotifications',fileURLToPath(new URL('./fixtures/macos-notifications.m',import.meta.url)),'-o',executable],{encoding:'utf8',timeout:60000,stdio:'pipe'});
    assert.match(execFileSync(executable,[],{encoding:'utf8',timeout:10000}),/regression checks passed/);
  }finally{rmSync(directory,{recursive:true,force:true});}
});
