# 简化规划 UI：独立组件检查点

本目录实现时间／未来收入表单、分区编辑窗口和虚构预览。尚未接入 PlanningPage、首次四问、真实原生保存或旧政策页面退出；不能把本目录通过当成第一批产品交付。

## 组件与使用

- `TimeFields`：明确年月与可选年龄换算，消费领域的时间函数。
- `FutureIncomeFields`／`FutureIncomeSection`：可空月收入、开始／结束月、金额基准及来源；类型仅来自 `plan-simplified-contract.ts`。切换计入模式不删除已有收入。
- `SimplifiedPlanningDialog`：注入 `SimplifiedPlanningPortV1`；读取、分区保存及核对原请求。首次四问不得调用本窗口逐项保存，须由向导用领域 `saveSetup` 一次提交。
- `OfficialToolLink`：默认普通官方外链，无任何个人参数；原生可注入经宿主支持的 `onOpenOfficial`，返回 false 或抛错时显示可复制地址。普通外链不通过 `window.open` 返回值判断成功，无法确认外部服务已完成测算。

宿主应保持 port 身份稳定，以资料库 generation／窗口会话作为 React key；切库或更换来源时卸载旧组件，不原地替换同一窗口的 port。宿主持有 pendingContext，并传入 onPendingChange，在发出请求前保留原 request_id／generation／revision；关闭后重新打开须回传它。普通关闭不保存草稿；提交未知时关闭仅在宿主承接请求后可用。没有承接回调的独立组件阻止未知状态下关闭，先核对原请求。此回调是已有回执的持有端口，不是新保存协议；原生宿主仍须复用现有跨窗口／重启的待核对机制。

FutureIncomeSection 的 `onEditingChange` 告知父级当前是否还有未完成的收入子草稿。宿主在该状态下禁止外层保存／下一步，直到“完成”合入或“取消”丢弃；不能静默遗漏子草稿。独立窗口已经处理此约束。

保存和核对有同步互斥保护；拒绝保留草稿并聚焦错误摘要；异常按结果未知保留原请求，可重试核对但不自动重放提交。卸载后的读取响应不会回写。父级收到 saved 再关闭／刷新，真实读取错误保持为错误，不当作空白。

## 开发预览与验证

运行仓库开发服务后打开 `/planning-simplified-preview.html`。使用 `?state=normal|unknown|empty|legacy|reject|unresolved|read-error`，深色追加 `&theme=dark`。所有资料虚构，仅内存，刷新重置；预览的保存结果不证明原生持久化。端口在同一场景重开窗口时保留内存结果，切换场景重新建立。

定向检查：`node --test tests/planning-simplified-ui.test.mjs`；全量检查沿用仓库四项命令。测试运行生产组件处理器，叶子控件和 React hooks 使用测试替身，不能代替真实浏览器／原生交互验证。

后续联调：消费领域最终端口、接入四问原子保存和逐项编辑、移除旧政策消费者、适配年龄为空的图表与深入分析，再完成旧库迁移／备份和原生验收。当前目录只保留逻辑接口依赖，没有假绑定到真实 Store，也不提供政策兼容层。
