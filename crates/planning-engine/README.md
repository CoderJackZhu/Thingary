# 规划计算核心

独立 Rust 纯计算库。`dispatch(serde_json::Value)` 接收数据并返回结果或错误，不访问数据库、文件、网络或系统时间。应用的数据准备、未知值门控与展示留在 TypeScript；月账本、需求反求、支付覆盖、市场路径、敏感性和收益顺序共用本库。

## 构建与验证

在仓库根目录执行：

```sh
rustup target add wasm32-unknown-unknown
npm run build:engine
npm run test:engine
npm run test:engine-parity
npm run check:engine-source
npm run check:engine
```

构建脚本把同一源码编译为 WASM，生成 `src/planning-engine-wasm.ts`。该文件随源码保存，包含源码与二进制 SHA-256；不可手改。`check:engine-source` 不调用 Cargo，核对源码／锁文件散列与打包二进制自身散列，可在不同 Rust 版本下检查提交产物是否过期；CI 在重建前执行。`check:engine` 重新构建并核对字节，需使用与生成时一致的 Rust 工具链。`npm run dev` 在启动 Vite 前自动构建核心。桌面异步市场任务通过 path dependency 链接同一个 crate；桌面同步计算也使用 WASM；`dispatch_stdio` 只是验证两种目标的传输例子。

## 接口与边界

请求带 `op`；涉及计划时带 `plan`。金额单位为分，输入与中间结果必须有限且绝对值不超过 9e15；内部折现保留小数，展示时取整。最多 1440 个逐月区间、每次 20000 条模拟路径；必填数值遗漏或为 null 会报错，不能由调用方补零。`retirement_step` 的 balance、growth、lump、income、spend 五项均必填；明确零金额仍有效；growth 是总增长乘数，0 表示投资部分归零，1 表示本步没有投资涨跌。端点的一次性付款可以发生，端点不新增一个生活月份。

已知月初付款先于当月释放和月底收入；晚到账不能抹去早先付款失败。普通月底费用未支付部分与已入账的欠款分别处理。未来收入和受限资金释放只使用明确输入，不推算任何国家的政策权益。

`simulate_paths` 按 seed 与全局路径索引独立复现，分批和一次请求使用相同路径。`summarize_paths` 汇总采样点，保留负余额信息；分位数在 q×(n−1) 上线性插值。界面取消后停止后续批次，并丢弃已经发出的迟到结果；不声称正在计算的一批会被强制中断。

敏感性默认值由 `sensitivity_parameters` 提供，属于假设条件。界面必须显示实际变化幅度并向计算传入同一参数，不能把路径覆盖比例解释成现实概率。收益顺序比较固定基准的退休时间，并保持两条受压路径的累计回报相同。

WASM 输入由调用方 `alloc` / `release` 管理；`evaluate` 返回引擎拥有的 UTF-8 JSON，直到下次调用有效。输入传输上限为 64 MiB，路径／期限／数组的独立限制仍生效。

## 来源范围

本库由只获得行为规格和必要运行依赖的隔离实现环境编写。规格、审计与集成侧曾接触旧实现；隔离实现者未获得旧源码、旧测试、上游截图或预设。此说明只覆盖本库的新计算实现，不把现有界面、数据编译层或全部规划功能称为洁净室重建。

历史版本及许可记录见根目录 [SOURCE_NOTICES](../../SOURCE_NOTICES.md)。项目整体许可仍为 AGPL-3.0-or-later。详细隔离和验证记录由维护者保留，不是构建所需依赖。
