# 分类统一（schema 20）· 隔离原生验收

日期：2026-09-29。授权：用户同意统一为七个分类，并要求按「分类 → 详情页」顺序实现。执行：Claude。**正式 App 与 `local.possio.main` 未打开、未读取、未写入。**

## 环境

- 隔离身份 `local.possio.cat.acceptance`（配置 `.local/cat.conf.json`，被忽略）。改前构建来自 `d3c4a37`（schema 19），改后构建来自当前工作区（schema 20），两者读同一隔离库。窗口 1280×820，无故障注入 feature。
- 个人库：临时 cargo example 用 schema 19 代码的业务 API 建立样例同款长名分类与自建「乐器」，写入 9 件虚构物品，分布在电脑、电脑与办公、手机、手机与平板、摄影器材、音频、音频设备、家电、乐器；用完已删除 example。
- 样例库：用改前构建「查看样例」生成，得到与用户所见相同的短名＋长名并存状态。
- 操作方式：Swift AX 工具按可访问名称 AXPress，`screencapture -l` 截窗口；分类名与件数取自 AX 文本。

## 结果

| 场景 | 改前（schema 19） | 改后（schema 20） |
|---|---|---|
| 样例库 | 电脑 0、手机 0、摄影 0、音频 0、家电 0、其他 0、音频设备 2、生活家电 1、电脑与办公 2、手机与平板 2、摄影器材 1（11 项） | 电脑与办公 2、手机与平板 2、影音摄影 3、家电家居 1、服饰配饰 0、出行运动 0、其他 0（7 项） |
| 个人库 | 电脑 1、手机 1、摄影 0、音频 1、家电 1、其他 0、电脑与办公 1、手机与平板 1、摄影器材 1、音频设备 1、生活家电 0、乐器 1（12 项） | 电脑与办公 2、手机与平板 2、影音摄影 3、家电家居 1、服饰配饰 0、出行运动 0、其他 0、乐器 1（8 项） |
| 重置样例 | — | 重建后仍为上述 7 项，9 件样例物品分类正确（如 Fujifilm X100V、WH-1000XM5 均为影音摄影） |

物品总数不变（样例 9 件、个人库 9 件），自建「乐器」保留且排在统一集之后。

截图：[样例改前](../ui/categories/before-sample-settings.jpg)、[样例改后](../ui/categories/after-sample-settings.jpg)、[个人库改前](../ui/categories/before-personal-settings.jpg)、[个人库改后](../ui/categories/after-personal-settings.jpg)、[重置样例后的列表](../ui/categories/after-sample-assets.jpg)。设置页高于窗口，完整分类表以 AX 文本为准。

## 自动化

- `storage::taxonomy_migration_tests::version_twenty_merges_default_categories_only`：已有目标名优先、否则按排序保留；物品版本号 +1、心愿迁移、被合并行停用标记移除；改过名的默认分类与自建分类不动；结果顺序与版本号 20。
- 版本断言由 19 升到 20，新版拒绝测试改用 21；新库默认分类数由 6 变 7。全部 Rust 测试 185 项、clippy、fmt、界面测试 123 项与 `test:demo` 通过。`worker::tests::pending_receipt_resumes_its_library_after_restart` 在满载时出现一次锁等待超时，单独及复跑均通过。

## 未验

- 旧 schema 备份恢复：沿用既有迁移路径，由现有旧版本备份迁移测试覆盖，未在原生重做。
