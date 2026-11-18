# 名称与应用图标

中文名为「物谱」，英文名为 Thingary。应用图标采用谱线与记录点的组合；macOS 应用图标的全部尺寸与侧栏标志统一使用五线版，通知等小尺寸入口也保持同一图形。

## 正式资源

| 资源 | 用途 |
|---|---|
| [staff-relaxed-5.svg](chosen/staff-relaxed-5.svg) | 大尺寸五线图稿 |
| [staff-small-3sq.svg](chosen/staff-small-3sq.svg) | 历史三线方形图稿，不再用于 macOS 应用图标或侧栏 |
| `src-tauri/icons/icon.png`、`icon.icns` | 随 macOS 应用提供的打包图标 |
| `src/LogoMark.tsx` | 侧栏单色标志（五线版） |

macOS 的 `icon.icns` 从五线主图 `src-tauri/icons/icon.png` 生成，包含 16、32、128、256、512 点各自的标准与 Retina 表示，不能混入历史三线图稿。在 Mac 上运行 `node scripts/build-macos-icon.mjs` 重新生成，运行 `node scripts/build-macos-icon.mjs --check` 核对全部尺寸。Windows 与手机资源按各自打包配置维护，本说明不代表这些平台已重新生成或验收。

## macOS 更新后的图标核对

图标生成核对、包内资源核对与系统通知界面的显示分别验收。安装包内全部尺寸正确，也不能据此认定通知设置或通知中心已经更新。

如果退出重开后仍显示旧图标，先检查 Launch Services 中同一 bundle 标识的注册路径，尤其是展开保存的旧应用备份。仅对已确认的旧副本使用 `lsregister -u "<旧副本.app 路径>"` 取消注册，保留备份文件，再用 `lsregister -f "/Applications/物谱.app"` 刷新当前安装的应用。`lsregister` 位于 `/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/`。备份优先保存为压缩归档，避免展开的旧应用参与后续系统扫描。

注册路径正确和重新注册都不能证明旧缓存已失效。macOS 的 Icon Services 仍可能返回此前缓存的三线小图；更换包内图标或重开系统设置也可能继续使用该缓存。排查时分别核对当前包内资源和系统按 bundle 标识返回的小尺寸图标；确认后者仍旧时，先备份，再仅对已核实属于物谱的旧缓存定向重建。系统缓存维护可能需要管理员认证，不作为应用运行时功能，也不清空整个系统图标缓存。

验收依次检查通知应用列表中的物谱图标、「通知 → 物谱」详情中的图标和原有权限，再完全退出系统设置并重新打开，返回列表复查。详情临时显示正确不能代替重开后的列表核对；实际通知横幅及整机重启后的显示另行验收。不要为修复图标而删除通知数据库、重置通知权限或重建全局应用注册库。验收仍遵守正式资料库边界，不为发测试通知启动正式资料库。

## 使用边界

代码按 [AGPL-3.0-or-later](../../LICENSE) 授权。**名称「物谱」「Thingary」及应用图标不在 AGPL 授权范围内，使用权保留。**

欢迎学习和修改代码；再发布修改版时请使用自己的名称与图标，避免用户将其与本项目混淆。提供这些源文件是为了说明正式标志及支持构建，不表示另行授予品牌使用权。
