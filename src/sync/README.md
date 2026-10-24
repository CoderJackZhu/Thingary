# 同步界面与虚构预览

桌面入口在「设置 › 数据管理」。`api.ts` 对接 Rust 命令，`state.ts` 提供状态文案，`SyncSettings.tsx` 承担桌面交互。拉取检查继续交给现有恢复确认流程。

停用同步可保留或清除机器本地连接信息与应用密码，两种选择都不删除云端数据。停用成功后直接显示未配置状态，不调用网络命令；再次保存配置才重新开启，仍需用户点「检查云端」才读取云端。

打开页面只调用本地的 `syncConfigGet()`，已配置时显示中性的「尚未检查云端」，点击「检查云端」才调用 `syncStatus()`。保存配置只执行本机的 `syncConfigSet()` 与 `syncConfigGet()`，清空缓存的云端状态并回到尚未检查视图。存在 `has_pending_push` 时直接显示结果未知，并暂停配置修改、停用及新的传输。只读核对调用 `syncReconcile()`：

| outcome | 界面结果 |
|---|---|
| `landed` | 显示确认成功与版本，刷新状态 |
| `not_landed` | 说明云端未收到、本机更改保留，刷新后可重新同步 |
| `remote_changed` | 说明其他设备更新了云端，刷新后处理冲突 |
| `nothing_pending` | 刷新状态 |

核对失败保留未知结果，只能重试只读核对。`syncStatus()` 用于核对完成后的状态刷新，不代替核对命令。`SYNC_SCHEMA_NEWER` 只提供升级入口，不提供推送或拉取。

上次同步时间、版本取本机已保存的同步基线；离线时显示本机配置中保存的设备名，检查后仅在云端版本与基线相同时采用云端设备名，避免把之后更新的设备归到这次基线。缺失项显示「尚未同步」。

浏览器入口为 `/visual-preview.html?section=settings&sync=<场景>`，进入「数据管理」。全部使用虚构内存数据，刷新重置，不连接 WebDAV：

- `unconfigured`、`synced`、`local_ahead`、`remote_ahead`、`conflict`、`push_error`：未配置、已同步、双方单向更改、冲突、推送失败。
- `unknown`、`unknown_not_landed`、`unknown_remote_changed`：待核对的三种结果；`unknown_error` 模拟核对失败。
- `locked`：点「立即同步」打开口令对话框，`preview-pass` 解锁，其他口令返回 `SYNC_PASSPHRASE`。
- `schema_newer`：云端 schema 较新，提示升级本应用。
- `unchecked`：与普通应用一样，只读本机配置、等待用户点击检查。

预览专用入口 `src/preview-ipc.ts` 将 `initialView()` 的虚构内存状态注册到 `preview-state.ts`，以便直接截图其他场景。普通桌面入口不注册它，默认返回 null；即使预览注入了状态，挂载仍只有 `sync_config_get`，不会为展示场景执行联网命令。保存配置后不再次应用这个初始状态。

预览和组件测试不能证明原生持久化、WebDAV 服务兼容性、系统权限或真实恢复流程已通过。
