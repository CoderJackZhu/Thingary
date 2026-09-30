// U17 设计稿截图生成脚本。运行环境：ZCode node_repl（agent.browsers 内置浏览器），
// 需要 Vite 静态服务：`npm run dev -- --port 1429`。
// 2026-09-30 记录：ego-browser 的 Page.captureScreenshot 全部超时（连 about:blank），
// 本机 /Applications/Google Chrome.app 为指向未挂载卷的空壳，故使用 ZCode 内置浏览器。
// 逐张 `?capture=1&theme=b|c|d&mode=light|dark&screen=…&width=wide|narrow` 打开
// mockup.html 并按视口尺寸截图；已存在的文件跳过（可续跑）。
const browserPluginRoot =
  process.env.ZCODE_PLUGIN_ROOT ?? process.env.CLAUDE_PLUGIN_ROOT;
if (!browserPluginRoot) throw new Error("Browser plugin root is unavailable in the node_repl host");
const { join } = await import("node:path");
const { pathToFileURL } = await import("node:url");
const browserClientUrl = pathToFileURL(join(browserPluginRoot, "scripts", "browser-client.mjs")).href;
const { setupBrowserRuntime } = await import(browserClientUrl);
await setupBrowserRuntime({ globals: globalThis });
const browser = await agent.browsers.get("iab");
let tab = (await browser.tabs.list())[0] ?? (await browser.tabs.new());
tab = await browser.tabs.get(tab.id);
const fs = await import("node:fs/promises");
const base = "/Users/jackzhu/Code/Own/Possio/docs/ui/tag-investment/design";
const base_url = "http://127.0.0.1:1429/docs/ui/tag-investment/mockup.html";
await fs.mkdir(base, { recursive: true });
async function capture(file, url, size) {
  try { await fs.access(`${base}/${file}`); return "skip:" + file; } catch { /* 续跑 */ }
  await tab.setViewportSize(size === "800x600" ? { width: 800, height: 600 } : { width: 1280, height: 800 });
  await tab.goto(url);
  await tab.playwright.waitForLoadState({ state: "domcontentloaded" });
  await tab.playwright.waitForTimeout(250);
  let shot = null;
  for (let attempt = 0; attempt < 3 && !shot; attempt++) {
    try { shot = await tab.screenshot(); }
    catch { await tab.playwright.waitForTimeout(1200); }
  }
  if (!shot) return "fail:" + file;
  await fs.writeFile(`${base}/${file}`, shot);
  return file;
}
const done = [];
for (const theme of ["b", "c", "d"]) for (const mode of ["light", "dark"]) for (const size of ["1280x800", "800x600"]) {
  done.push(await capture(`design-${theme}-${mode}-normal-${size}.png`, `${base_url}?capture=1&theme=${theme}&mode=${mode}&screen=normal&width=${size === "800x600" ? "narrow" : "wide"}`, size));
}
const states = ["missing", "all-unknown", "zero", "mixed", "excluded", "held-empty", "empty", "no-results", "error"];
for (const mode of ["light", "dark"]) for (const screen of states) {
  done.push(await capture(`design-b-${mode}-${screen}-1280x800.png`, `${base_url}?capture=1&theme=b&mode=${mode}&screen=${screen}&width=wide`, "1280x800"));
}
for (const screen of ["missing", "empty", "no-results", "error"]) {
  done.push(await capture(`design-b-light-${screen}-800x600.png`, `${base_url}?capture=1&theme=b&mode=light&screen=${screen}&width=narrow`, "800x600"));
}
done.push(await capture("design-b-light-entry-1280x800.png", `${base_url}?capture=1&theme=b&mode=light&screen=entry&width=wide`, "1280x800"));
done;
