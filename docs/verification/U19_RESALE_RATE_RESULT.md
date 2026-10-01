# U19 · 售出保值率验证报告

日期：2026-10-01。范围：[产品设计 D29](../PRODUCT_DESIGN.md#d29-product)、[U19 设计](../ui/U19_RESALE_RATE_DESIGN.md)。**所有数据为虚构；正式库与 `local.possio.main` 从未打开。** 本轮在 Linux 云端环境完成，**没有 macOS 原生执行环境，原生 UI 验收未做。**

## 1. 命令与结果

| 检查 | 结果 | 说明 |
|---|---|---|
| `cargo test --test insights`（临时副本） | 7/7 通过 | 含新增 2 项；见 §2 |
| `cargo test --lib --tests --no-fail-fast`（临时副本） | 21 个套件全过，16 个套件含失败；共 41 个测试失败 | **同一命令在未改动的 HEAD 基线上得到完全相同的 41 个失败名**（逐名 diff 一致），原因是副本里原生图片桥为空实现（`IMAGE_CORRUPT`），涉及照片、素材、演示样例、带图备份等。本次改动没有引入新失败，并新增 2 个通过的测试。失败套件里也包括 `sales`、`tag_investment`，其失败项同样在基线失败。**未在 macOS 上复跑，需要在 Mac 上执行 `npm test` 确认** |
| `cargo fmt --check` | 通过 | 仓库内直接执行 |
| `cargo clippy`（临时副本，insights 相关） | `insights.rs` 无告警 | 副本里其他告警来自去掉原生桥后的死代码，不适用；**完整 `npm run check` 需在 Mac 上执行** |
| `npm run test:ui` | 188/188 通过 | 含新增 `tests/resale.test.mjs` 5 项 |
| `npm run build`（`tsc --noEmit` + vite） | 通过 | 仅有既有的大文件分块提示 |

临时副本说明：Rust 部分链接 macOS 框架，无法在 Linux 构建。为运行测试，在草稿目录复制 `src-tauri`，去掉 Tauri 与命令层，用 C 空实现替换原生桥，仓库本身未改动构建配置。因此 `commands.rs` 里新增的 `resale_rate` 命令与 `lib.rs` 的注册**没有被编译过**，它与 `holding` 命令同形，需要 Mac 上的 `cargo build` 确认。

## 2. 验收条件对照

| 编号 | 结论 | 证据 |
|---|---|---|
| AC01 | 通过 | Rust `u19_resale_rate_matches_the_documented_sample`、TS `preview resale rate reproduces the documented sample`：平均 61.67%、总回收率 69.53%、总盈亏 −390,000 分，顺序 B、A、C，F、G、H、I 不出现 |
| AC02 | 通过 | 同上：D 购入金额未知、E 购入价为 ¥0 只在未参与清单；无参与物品时比率为 `None`/「—」，无 0% 与 NaN（Rust `u19_resale_rate_edges…`、TS 空样例） |
| AC03 | 通过 | 样例 C 售出价 ¥0，保值率 0.00% 并计入 3 件 |
| AC04 | 通过 | 夹具 +¥50,000 售价对应 5,000,000（50,000%）不封顶；界面样例显示 120.00% 与 +¥400 |
| AC05 | 通过（浏览器） | 截图 `empty-card.png`（无售出）、`skipped-card.png`（全部不可计算，指标「—」加未参与清单） |
| AC06 | 通过 | Rust 与 TS 同一组：3334/10000 对 333/1000 按精确比值排序；P、Q 同值按 ID；1/3 按半数进位为 3333 |
| AC07 | 部分 | Rust 覆盖删除、撤销售出、不计入统计、更正售价后重新读取的变化；**取消「不计入统计」与重开应用的原生链路未测**；`exclude.daily` 不影响本卡由查询只看 `exclude.statistics` 保证，未单独写用例 |
| AC08 | 通过（浏览器） | 交互脚本：排序切换（耳机、相机、键盘 ↔ 键盘、相机、耳机）；未参与折叠可展开；点击「相机」打开原档案；错误态 `error-card.png`（带重新读取，不影响其他卡）。排序切换不重新请求由实现保证（`reverse()`，无请求），未做请求计数 |
| AC09 | 通过（浏览器，Chromium） | 浅色、深色、1280×800、800×600 各截图，均无横向溢出；长名称由 CSS 截断并带 `title`；差额带 +/− 号。**未用 macOS 原生窗口复核** |
| AC10 | 通过 | Rust 断言「全部」期间回收为 890000 / 1280000；浏览器交互中回收分析卡显示 69.5%，脚注「2 件售出物品的购入价未知或为 ¥0，未纳入回收率」 |
| AC11 | 通过 | Rust 以上限金额 `99999999999` 分对购入价 1 分，保值率 999,999,999,990,000，金额字符串返回；汇总用 `i128` |

## 3. 视觉证据

目录 [`docs/ui/u19/`](../ui/u19/)（Chromium，预览数据，`visual-preview.html`；样例参数 `?resale-fixture`、`?resale-fixture=skipped`、`?resale-error`、`?state=empty`）：

| 文件 | 内容 |
|---|---|
| `sample-light-card.png` / `sample-dark-card.png` | 文档样例，1280×800，浅/深 |
| `sample-narrow-card.png` | 文档样例，800×600 |
| `light-card.png` / `dark-narrow-card.png` | 默认预览（一件售出） |
| `skipped-card.png` | 全部不可计算 |
| `empty-card.png` / `error-card.png` | 空状态、读取失败 |
| `light-page.png` | 统计页整体，用于核对位置（该图拍于卡片改为整行之前，仅作页面对照） |

## 4. 过程中修正的问题

- 首版卡片落在两列网格的右栏，与日均排行并排，被拉高留白；改为 `grid-column:1/-1` 独占整行后重拍全部截图。
- 错误态卡片最初不带 `resale-card`，没有占满整行；已补。

## 5. 未验与边界

- **原生 UI 行为未验**（真实窗口、系统外观、重开应用、售出/更正/撤销/删除后的刷新），按 U18 惯例，`USER_GUIDE` 与 README 现状暂不改写，待原生验收后更新。
- Mac 上需复跑：`npm test`、`npm run check`、`npm run build`，并编译 `resale_rate` 命令。
- 未做独立 Review。
