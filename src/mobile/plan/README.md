# 手机规划

手机规划只改布局，复用桌面 `planning-service`、五步设置草稿和 DTO、`buildBasicCapabilities`、`plan-ledger`、`plan-risk` 与同一 Rust/WASM 引擎。这里的 `*-model.ts` 只做输入变体和展示投影；没有新的账本或持久对象。

- `Goal`：目标结论、固定目标所需投入与保存投入对比、两人停工说明、核算注意事项、逐项条件、计划及盘点变化。
- `Setup`：一屏一步的五问，以及时间／预算／资金／收入／净投入／费用包含关系的单项编辑。伴侣存款是两人合计的一部分。阶段性支出在「退休生活预算」一步里维护（随该步一起保存），已有贷款的还款安排在 `Debts` 页（从「待你确认」或可用资金一步进入），孩子出生年月只用于换算支出终点，不写入孩子资料。
- `Detail`：今天购买力／未来账面金额、预计与所需资金轨迹、预算比较、默认折叠的内部横滚逐年表、生活费覆盖。
- `WhatIf`：压力、市场路径、3×3 敏感性和收益顺序。市场按现有接口分批，离页取消后续批次并拒绝迟到结果；无效／不存在的情景不补零。
- `Trials`：临时资金续航、职业变化表单和心愿影响。不会保存职业路线，不扣实际余额。
- `Report`：通过 `currentReportInput` 校验后冻结当前报告，默认隐私。预览、复制和导出使用同一脱敏投影。桌面下载自包含、可打印的 HTML；手机经原生 PDF 与系统分享面板交付（模拟器已验，真机分享目标未验）。

## 保存与资料边界

页面只用 `planning_sources` 的一致快照，读取 generation 不匹配会拒绝。打开编辑器时捕获修订，避免后台刷新替旧草稿认可新资料。初次设置及需要一起改变的字段使用已有 setup 事务；其他分区使用原有更新命令。假设采用 `nativePlanningFollowupPortV1` 的独立确认协议。

`usePlanSaver` 沿用 `savePlanningSection` → `submit` 的 request_id、generation、expected_revision 和原请求回执。未知提交由手机外壳暂停导航并只读核对；不新增请求、不保存普通草稿。错误保留当前输入，关闭取消丢弃未提交填写。

## 虚构浏览器预览

运行仓库的 `npm run dev -- --port 1431`，打开 `/mobile-preview.html`：

| 参数                                                                  | 状态                                                         |
| --------------------------------------------------------------------- | ------------------------------------------------------------ |
| `tab=plan&plan-profile=empty`                                         | 未设置目标                                                   |
| `tab=plan&plan-basic=saved&capabilities=real&plan-core=confirmed`     | 单人完整条件                                                 |
| 上行加 `plan-household=couple-age&plan-household-mode=fire`           | 两人错峰停工与伴侣存款                                       |
| `plan-basic=unknown` 或 `plan-core=partial`                           | 未知投入、核算缺项                                           |
| `plan=error`                                                          | 读取错误                                                     |
| `route=plan.setup&param.section=contribution&mobile-state=unknown`    | 提交成功但响应丢失，第一次自动核对失败，保留原请求待显式核对 |
| `route=plan.setup&param.section=contribution&mobile-state=save-error` | 保存失败，输入保留                                           |
| `route=plan.detail`、`plan.whatif`、`plan.trials`                     | 指定规划页面                                                 |
| `theme=light` 或 `theme=dark`                                         | 固定明暗                                                     |

各状态都可组合完整条件参数。预览仅为内存虚构资料，刷新重建；不访问正式身份或数据库，不证明 iOS 持久性、WKWebView、软键盘、安全区、VoiceOver 或原生分享能力。

回归：`tests/mobile-plan-*.test.mjs`；交付使用仓库四项检查。浏览器核对 390×844、375×667 的明暗及 320–430 宽度、44px 触控、逐年表内部横滚、设置／取消／未知恢复／错误及报告隐私下载。截图与详细执行证据放工作区外的验收目录，不存入公开源码。
