# 首批工程验证记录

日期：2026-09-24。用户已明确“确认开始”，授权 V00–V05，终点 CP0；T01–T21 尚未开始。

## 环境与范围

只读实测：macOS 27.0 (26A428)、arm64、SDK 27.0、CommandLineTools；Node 26.9.0、npm 11.19.1、rustc/cargo 1.96.0。未升级全局工具。暂设最低打包目标 macOS 14.0，只有当前机器实测，不构成旧系统或 Intel 支持承诺。验证应用标识 local.possio.verification，与未来正式库分离。

## 输入契约（首批）

名称去首尾空白后 1–200 个 Unicode 字符；金额以整数分十进制字符串或 null 传输，购入价范围 0–99999999999 分，禁止小数分；合计使用检查过的 i64 运算，售出净成本允许负数。日期为严格 YYYY-MM-DD，1900–9999 年，购入不能晚于本地今天；含首尾自然日。所有业务未知用 null，不将未知映射成零。查询预留每页 1–100 条上限，本轮仅读取固定虚构资产，不实现分页页面。图片限制在 V03 实测后登记。

## 证据

V01：`npm run tauri -- build --debug --bundles app` 成功（前端类型检查与打包、Rust 编译、本机 App bundle）。首次检查发现缺少模板图标，已补本地占位图并重新构建通过。系统启动后检测到 App 进程；由测试发出的 SIGTERM 结束，不将此当作 ⌘Q 验收。

原生 UI 检查受限：computer-use 返回服务/客户端版本不匹配，要求重启桌面客户端。未取得窗口截图，关闭/重开、⌘Q、焦点和主题观感仍待测；不换手段绕过。此限制不阻断独立的数据实验，V01 保持部分完成。

## 官方依据

- [Tauri 前置环境](https://v2.tauri.app/start/prerequisites/)
- [Vite 集成](https://v2.tauri.app/start/frontend/vite/)
- [Rust 命令调用](https://v2.tauri.app/develop/calling-rust/)
- [单实例](https://v2.tauri.app/plugin/single-instance/)
- [rusqlite Backup API](https://docs.rs/rusqlite/latest/rusqlite/backup/index.html)

工具发现未提供 Context7 resolver/query，使用官方来源核对。后续证据区分自动测试、实际窗口观察、尚未测试的情况。
