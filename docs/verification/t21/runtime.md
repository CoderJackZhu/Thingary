# T21 原生运行记录（2026-09-26）

所有数据为虚构。用户确认“现在方便，继续原生验收”后继续前台工作。辅助功能脚本位于 `/tmp/possio-t21/ax.swift`，每次动作检查 App active 和 AXWindows 非空；每次按键另检查同一状态。第一次检查退出 3，未注入按键；后续有一次截图后失去前台，⌘Q 注入被守卫阻止。

## release 与离线

初次 release 构建日志 `/tmp/possio-t21/initial-release.log`，exit 0。正式包 bundle `local.possio.t21.release`，最低 14.0；未启用故障注入。启动时首次库为空，先做 SQLite backup 一致性快照。

第一次 `sandbox-exec -p '(version 1)(allow default)(deny network*)' <App二进制>`：PID 45526 存在但 bundle 查询不到 App，未注入 UI，后用 SIGTERM 正常终止。未把此轮计作通过。

后续实际用于验收的命令：

```sh
sandbox-exec -p '(version 1)(allow default)(deny network-outbound (remote ip "*:*"))(deny network-inbound (local ip "*:*"))' \
  '<repo>/src-tauri/target/release/bundle/macos/Possio T21 Release.app/Contents/MacOS/possio'
```

PID 46320。直接从二进制启动时未被 bundle 搜索发现，按已核对 PID 建立 NSRunningApplication/AXUIElement，激活并等待窗口绘制后完成：

1. 原名称最小资产仍在；新增 `T21 离线虚构相机`，价格/日期留空，[保存详情](offline-created.txt)。
2. 同记录改为 `T21 离线虚构相机 更正`，进入详情。
3. 软删除后[侧栏最近删除](offline-trash.txt)显示唯一该条、原状态使用中。
4. 确认恢复后[原资料保持](offline-restored.txt)，设置入口最近删除为空（[证据](settings-trash.txt)）。
5. `lsof -nP -a -p 46320 -i` 无输出（无 IP socket/监听）；按 ⌘Q 后 `ps -p 46320` 无输出。没有为此包启动 HTTP 开发服务器。原始空输出保留 `/tmp/possio-t21/offline-sockets.txt`、`offline-after-quit.txt`。
6. LaunchServices 重新打开同一 `.app`，两条记录都在（[重开](reopened.txt)）。旧数据集随后通过恢复协议被保留，未抹除；[持久化只读旁证](offline-persistence.json)记录同一 ID 与版本。

这是主 App 进程的 IP 禁网验收，不等于关闭整机网络或对全部系统 XPC 服务抓包。前端正式 CSP 限制连接为 self/ipc；没有声称测试了所有离线 P0 路径。用户可按报告检查单做整机断网复核。

## 主题、图片与恢复

浅色选择成功后正常退出、重开确认截图仍浅色（[截图](reopened-light.png)）。初次主题选择器命中了同名 heading，修正脚本为 AXPopUpButton 后成功；无应用代码修改。NSOpenPanel 前往路径未确认时不把正在等待面板的 UI 当死锁，观察到路径弹层后再次确认。

源库在完整备份后做快照，可逆移走新 iPad 的托管原图到 `library/backups/t21-held-340abae4…`，另保留 `/tmp/possio-t21/repair.png`。GUI 修复后原路径 SHA256 为 `340abae4f1e0e8519c762a72ef4d7c4c9fc866cb9801702f44ca88326177b49b`，与原件一致；备份中的所有原图和空库恢复图也逐项相同。

目标 `local.possio.t21.empty` 的首次库为 0 资产，快照后恢复本轮 source release 备份。全表、图像及重开证据见主报告。坏备份拒绝与不支持图片取消后，全部表仍与备份相同。目标收尾一次键盘 ⌘Q 未观察到退出，后通过 AX 原生菜单 `退出物志` 成功退出；未将这次键盘发送结果当作成功。

## 收尾进程范围

最终 `pgrep -x possio` 只返回 **33139**，命令行属于开工前就已存在的 `Possio T06b Preview.app`。本任务记录的 43587、45526、46320、47751、51988、55758 等 App PID 都不在；source/empty 两个任务身份均已退出，未留写锁。

开工前 Vite PID **32895** 仍监听 `127.0.0.1:1429`，为已有 visual-preview 服务，未由本任务启动，保持不变。不能把它隐去后声称机器上完全没有 Possio 开发服务，也不能把它归咎为本轮 release 退出残留。

证据整理仅去除了 AX 文本的行尾空格。`empty-before.txt` / `empty-reopened.txt` 是页面尚未绘制时的窗口框读取，不用于证明数据为空或恢复完成；空库证据来自一致性快照，重开后的数据证据来自随后页面及全表核对。
