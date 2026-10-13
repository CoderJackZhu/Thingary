// Installed acceptance WebView2 only. Node 22 fetch/WebSocket, no browser preview.
// Observations precede actions. Mouse/key events exercise actual production handlers.
// Appearance preferences use the owning implementation's existing storage keys.
// OS helper resizes the native HWND; screenshots capture its WebView2 content.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
const option = (n, d) => {
  const i = process.argv.indexOf(n);
  return i < 0 ? d : process.argv[i + 1];
};
const mode = option("--mode", "smoke"), output = resolve(option("--output", ".local/windows-native-acceptance")), pid = Number(option("--pid", "0"));
assert.equal(process.platform, "win32");
assert.ok(pid > 0);
mkdirSync(output, { recursive: true });
const report = { mode, transport: "installed native WebView2 CDP loopback", verified: [], screenshots: [], unverified: ["Chinese IME composition", "screen reader", "native file picker interaction", "physical keyboard", "visible desktop toast"] };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
// Negative assertions must never succeed in the blank document during reload.
const appRendered = `document.readyState==='complete' && !!window.__TAURI_INTERNALS__ && !!document.querySelector('.shell main') && !!document.querySelector('nav[aria-label="主导航"]')?.getClientRects().length && ['native','olive','bento'].includes(document.documentElement.dataset.style) && ['light','dark'].includes(document.documentElement.dataset.mode)`;
const mainNavigation = 'nav[aria-label="主导航"]';
const assetList = `!!document.querySelector('main .items[aria-label="物品列表"]') || [...document.querySelectorAll('main .empty h2')].some(e=>e.textContent==='从第一件物品开始')`;

async function until(fn, label, ms = 20000) {
  let last;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v)
        return v;
    } catch (e) {
      last = e;
    }
    await pause(150);
  }
  throw Error(label + " timed out" + (last ? ": " + last.message : ""));
}
let ws, seq = 0;
const pending = new Map;
function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq, timer = setTimeout(() => {
      pending.delete(id);
      reject(Error(method + " timed out"));
    }, 20000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function js(expression) {
  const r = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails)
    throw Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
async function observe(label) {
  const state = await js(`(()=>({title:document.title,url:location.href,text:document.body.innerText,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},appearance:{...document.documentElement.dataset},controls:[...document.querySelectorAll('button,input,textarea,select,dialog')].filter(e=>e.getClientRects().length).map(e=>({tag:e.tagName,id:e.id,role:e.getAttribute('role'),label:e.getAttribute('aria-label'),text:e.textContent?.trim().slice(0,160),value:e.value,open:e.open,pressed:e.getAttribute('aria-pressed')}))}))()`);
  appendFileSync(resolve(output, mode + "-observations.jsonl"), JSON.stringify({ label, ...state }) + `
`);
  return state;
}
async function click(selector, modifiers = 0) {
  await observe("before " + selector);
  const point = await js(`(()=>{const es=[...document.querySelectorAll(${JSON.stringify(selector)})].filter(e=>e.getClientRects().length);if(es.length!==1)throw Error('Expected one visible target: '+es.length);const e=es[0];if(e.disabled)throw Error('Target disabled');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  for (const type of ["mousePressed", "mouseReleased"])
    await cdp("Input.dispatchMouseEvent", { type, button: "left", clickCount: 1, ...point, modifiers });
}
async function button(text, scope = '') {
  await observe("before button " + text + (scope ? " in " + scope : ""));
  const candidates = scope ? `${scope} button` : 'button';
  const selector = await js(`(()=>{const found=[...document.querySelectorAll(${JSON.stringify(candidates)})].filter(e=>e.getClientRects().length&&(e.getAttribute('aria-label')===${JSON.stringify(text)}||e.textContent.trim()===${JSON.stringify(text)}||e.querySelector(':scope > span')?.textContent.trim()===${JSON.stringify(text)}));if(found.length!==1)throw Error('Button count '+found.length+': '+${JSON.stringify(text)});found[0].dataset.acceptanceTarget='current';return '[data-acceptance-target="current"]';})()`);
  try {
    await click(selector);
  } finally {
    await js("document.querySelector('[data-acceptance-target]')?.removeAttribute('data-acceptance-target')");
  }
}
async function key(key, code, modifiers = 0, vk = 0) {
  await observe("before key " + key);
  for (const type of ["keyDown", "keyUp"])
    await cdp("Input.dispatchKeyEvent", { type, key, code, modifiers, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
}
async function wait(expression, label) {
  await until(() => js(`(${appRendered}) && (${expression})`), label);
  return observe(label);
}
async function fill(selector, text) {
  await click(selector);
  await key("a", "KeyA", 2, 65);
  if (text)
    await cdp("Input.insertText", { text });
  else
    await key("Backspace", "Backspace", 0, 8);
  await wait(`document.querySelector(${JSON.stringify(selector)})?.value===${JSON.stringify(text)}`, "input value");
}
function native(action, width = 0, height = 0) {
  return JSON.parse(execFileSync("pwsh", ["-NoProfile", "-File", resolve(dirname(fileURLToPath(import.meta.url)), "windows-native-acceptance.ps1"), "-WindowOnly", action, "-ApplicationPid", String(pid), "-Width", String(width), "-Height", String(height)], { encoding: "utf8" }).trim());
}
async function shot(label, settle = true) {
  let renderReadiness;
  if (settle) {
    await wait(`document.fonts.status==='loaded' && [...document.images].filter(e=>{const r=e.getBoundingClientRect();return e.getClientRects().length&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth&&e.getAttribute('src');}).every(e=>e.complete&&e.naturalWidth>0)`, 'fonts and visible images ready for ' + label);
    renderReadiness = await js(`(async()=>{await document.fonts.ready;const images=[...document.images].filter(e=>{const r=e.getBoundingClientRect();return e.getClientRects().length&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth&&e.getAttribute('src');});await Promise.all(images.map(e=>e.decode()));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return {fonts:document.fonts.status,visibleImages:images.map(e=>({width:e.naturalWidth,height:e.naturalHeight})),paintFrames:2};})()`);
  }
  const state = await observe(label), r = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }), path = resolve(output, label + ".png");
  writeFileSync(path, Buffer.from(r.data, "base64"));
  report.screenshots.push({ label, path, viewport: state.viewport, appearance: state.appearance, renderReadiness, capture: "installed native WebView2 content; OS chrome excluded" });
}
async function assets() {
  await wait('true', 'rendered application before asset navigation');
  if (!await js(assetList))
    await button("全部物品", mainNavigation);
  await wait(assetList, "asset list");
}
const blur = () => js("document.activeElement?.blur()");
async function create(name, price = "") {
  await blur();
  await key("n", "KeyN", 2, 78);
  await wait("!!document.querySelector('dialog[open] #field-name')", "Ctrl+N new form");
  await fill("#field-name", name);
  if (price)
    await fill("#field-price", price);
  await button("保存物品");
  await wait("!document.querySelector('dialog[open].asset-editor')", "save");
  await assets();
  await wait(`!![...document.querySelectorAll('.asset-row')].find(e=>e.textContent.includes(${JSON.stringify(name)}))`, "saved row");
}
try {
  const page = await until(async () => {
    const pages = await (await fetch("http://127.0.0.1:9227/json/list", { signal: AbortSignal.timeout(1500) })).json(), candidates = pages.filter((p) => p.type === "page" && /tauri|localhost/.test(p.url) && !p.url.startsWith("devtools:"));
    assert.equal(candidates.length, 1);
    return candidates[0];
  }, "WebView2 debugger", 45000);
  assert.match(page.webSocketDebuggerUrl, /^ws:\/\/(127\.0\.0\.1|localhost):9227\//);
  ws = new WebSocket(page.webSocketDebuggerUrl);
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data), p = pending.get(m.id);
    if (p) {
      clearTimeout(p.timer);
      pending.delete(m.id);
      m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result);
    }
  });
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  await cdp("Page.enable");
  await cdp("Runtime.enable");
  report.runtime = await cdp("Browser.getVersion");
  await wait("document.body.innerText.includes('物品')&&!document.body.innerText.includes('正在读取总览…')", "native startup");
  assert.ok(await js("!!window.__TAURI_INTERNALS__"));
  report.nativeWindow = native("inspect");
  if (mode === "smoke") {
    const first = await observe("first launch");
    if (first.text.includes("样例体验")) {
      await shot("first-launch-sample");
      await button(first.text.includes("开始记录我的资料") ? "开始记录我的资料" : "返回我的资料");
      await wait("document.querySelector('.demo-banner strong')?.textContent==='我的资料' && !document.body.innerText.includes('样例体验')", "rendered personal library after leaving fictitious sample");
    }
    await assets();
    await wait("document.body.innerText.includes('从第一件物品开始') && document.querySelectorAll('.asset-row').length===0 && !document.body.innerText.includes('样例体验')", "fresh blank personal library");
    if (first.text.includes("样例体验"))
      report.verified.push("first-launch fictional sample and switch to confirmed blank personal acceptance library");
    await shot("blank");
    await blur();
    await key("n", "KeyN", 2, 78);
    await wait("!!document.querySelector('#field-name')", "new form");
    await button("保存物品");
    await wait("document.querySelector('#field-name')?.getAttribute('aria-invalid')==='true'", "required name failure");
    await shot("validation-failure");
    await fill("#field-name", "可撤销输入");
    await key("z", "KeyZ", 2, 90);
    await wait("document.querySelector('#field-name')?.value===''", "native text undo");
    report.verified.push("WebView2 native text Ctrl+Z");
    await fill("#field-name", "取消的虚构物品");
    await key("n", "KeyN", 2, 78);
    assert.equal(await js("document.querySelectorAll('dialog[open].asset-editor').length"), 1);
    await button("关闭表单");
    await wait("!document.querySelector('dialog[open]')", "cancel");
    assert.ok(!(await observe("cancel result")).text.includes("取消的虚构物品"));
    await create("Windows 验收未知物品");
    await wait("[...document.querySelectorAll('.asset-row')].find(e=>e.textContent.includes('Windows 验收未知物品'))?.textContent.includes('待补充')", "unknown remains unknown");
    await shot("unknown");
    await create("Windows 验收已知物品", "123.45");
    await wait("[...document.querySelectorAll('.asset-row')].find(e=>e.textContent.includes('Windows 验收已知物品'))?.textContent.includes('123.45')", "saved exact amount");
    await shot("normal");
    await blur();
    await key("f", "KeyF", 2, 70);
    await wait("document.activeElement?.tagName==='INPUT'", "Ctrl+F");
    await blur();
    await key("f", "KeyF", 10, 70);
    await wait("!!document.querySelector('dialog[open]')", "Ctrl+Shift+F");
    await key("Escape", "Escape", 0, 27);
    await wait("!document.querySelector('dialog[open]')", "Esc search");
    const rows = await js("[...document.querySelectorAll('.asset-row')].map(e=>'#'+e.id)");
    assert.ok(rows.length >= 2);
    await click(rows[0]);
    await click(rows[1], 2);
    await wait(`document.querySelectorAll('.asset-row[aria-pressed="true"]').length===2`, "Ctrl click multiselect");
    await click(rows[0]);
    await click(rows[1], 8);
    await wait(`document.querySelectorAll('.asset-row[aria-pressed="true"]').length===2`, "Shift range selection");
    await blur();
    await key("a", "KeyA", 2, 65);
    await wait(`document.querySelectorAll('.asset-row[aria-pressed="true"]').length===2`, "Ctrl+A selects rows");
    await click(rows[0]);
    await blur();
    await key("e", "KeyE", 2, 69);
    await wait("!!document.querySelector('#detail-heading')", "Ctrl+E");
    report.verified.push("blank startup", "required name failure", "cancel discards ordinary input", "known/unknown save", "Ctrl+N/F/Shift+F/E", "editing guard", "Ctrl click multiselect");
    report.verified.push("Shift range selection", "Ctrl+A list selection");
    report.unverified.push("app undo", "pending-result close confirmation");
    await button("账户与盘点");
    await wait("!!document.querySelector('.wealth-section')", "wealth page");
    await blur();
    await key("n", "KeyN", 2, 78);
    await wait("!!document.querySelector('#wealth-account-name')", "new account");
    await fill("#wealth-account-name", "未保存的虚构账户");
    native("close");
    await wait("document.body.innerText.includes('当前操作尚未完成')", "WM_CLOSE blocked");
    assert.equal(await js("document.querySelector('#wealth-account-name')?.value"), "未保存的虚构账户");
    await shot("native-close-blocked");
    await button("返回继续处理");
    await button("关闭账户表单");
    await wait("!document.querySelector('dialog[open]')", "cancel unsaved account");
    report.verified.push("WM_CLOSE preserves unsaved feature account input until explicit cancel");
    await blur();
    await key(",", "Comma", 2, 188);
    await wait("[...document.querySelectorAll('h1')].some(e=>e.textContent==='设置')", "Ctrl+, settings");
    const priorMode=await js("document.documentElement.dataset.mode");
    await key("d", "KeyD", 10, 68);
    await wait(`['light','dark'].includes(document.documentElement.dataset.mode) && document.documentElement.dataset.mode!==${JSON.stringify(priorMode)}`, "Ctrl+Shift+D appearance");
    report.verified.push("Ctrl+, settings", "Ctrl+Shift+D appearance");
    report.unverified.push("planning form WM_CLOSE");
  } else if (mode === "persistence") {
    await assets();
    const state = await observe("persisted assets");
    for (const n of ["Windows 验收未知物品", "Windows 验收已知物品"])
      assert.ok(state.text.includes(n), "Missing persisted " + n);
    assert.ok(!state.text.includes("取消的虚构物品"));
    await shot("persisted-" + option("--label", "restart"));
    report.verified.push("saved assets persist", "cancelled asset absent");
  } else if (mode === "fixture") {
    await assets();
    assert.ok(await js("document.querySelectorAll('.asset-row').length>0"));
    assert.ok(!(await observe("restored fixture")).text.includes("Windows 验收未知物品"));
    for (const [width, height] of [[1600, 1000], [800, 600]]) {
      const actual = native("resize", width, height);
      assert.equal(actual.client.width, Math.round(width * actual.dpiScale));
      assert.equal(actual.client.height, Math.round(height * actual.dpiScale));
      report.verified.push({ nativeResize: actual });
      await wait(`innerWidth===${width}&&innerHeight===${height}`, "native viewport size");
      for (const style of ["native", "olive", "bento"])
        for (const theme of ["light", "dark"]) {
          const previousDocument = await js('performance.timeOrigin');
          await js(`localStorage.setItem('thingary.style',${JSON.stringify(style)});localStorage.setItem('thingary.theme',${JSON.stringify(theme)});`);
          await cdp('Page.reload');
          await wait(`performance.timeOrigin!==${JSON.stringify(previousDocument)}&&document.documentElement.dataset.style===${JSON.stringify(style)}&&document.documentElement.dataset.mode===${JSON.stringify(theme)}&&!!document.querySelector('.asset-row')`, "appearance in reloaded document");
          await shot(`fixture-${style}-${theme}-${width}x${height}`);
        }
    }
    report.verified.push("restored fixture renders", "three styles × light/dark × two actual OS window sizes");
  } else
    throw Error("Unknown mode " + mode);
  report.status = "passed";
} catch (e) {
  report.status = "failed";
  report.error = e.stack;
  try {
    if (ws?.readyState === WebSocket.OPEN)
      await shot("failure-" + mode, false);
  } catch {}
  process.exitCode = 1;
} finally {
  writeFileSync(resolve(output, `ui-${mode}-${option("--label", "result")}.json`), JSON.stringify(report, null, 2) + `
`);
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.reject(Error("Driver ending"));
  }
  pending.clear();
  ws?.close();
}
