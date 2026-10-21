# 手机物品

物品列表、筛选、详情、新增／编辑、图标素材与统计分别由 `items.*` 路由懒加载。心愿沿用地基预留入口，由心愿模块实现。所有物品查询、统计与写入使用桌面 IPC；金额保留整数分，未填金额或日期保持未知。

- 列表通过 `list_assets` 查询与分页、`asset_counts` 计数、`asset_ids` 全选；筛选与排序直接传 `Query`，置顶顺序由后端决定。筛选弹窗的控件立即生效，顶部“完成”关闭弹窗。列表条件只在当前运行内存中保留。
- 当前物品日均成本使用 `overview.held_daily`，含使用中与已退役物品；售出、删除、按次与明确排除的物品不参与，资料不全显示已知部分。统计排除不隐藏列表中的档案。
- 批量操作使用 `batch_rows` 的当前修订与 `batch_change`，复用 `batch-select` 的状态／日期规则。批量删除与单件删除都进入最近删除。
- 拍照与相册使用文件输入，通过 `import_photo_bytes` 暂存，第一张作为封面。图标、立体素材、最近使用与我的图片复用 `materials.ts`。普通未提交表单离页丢弃；素材选择只通过当前编辑页的内存通道返回。
- 保障、维护、售出与状态记录复用原领域模块的请求构建与校验，支持更正、撤销适用的误记以及独立记录删除。保障和维护支持拍摄或多选图片凭证。
- 保存复用 `wealth.submit` 与手机统一导航锁。物品请求用 `saved_request`，独立记录删除用核对指纹的 `saved_record_trash_request`，批量用 `wealth_request_result`；新建／编辑身份从 `SaveAsset.base` 提取，仅回执元数据增加根身份，不改变发送给后端的原始载荷。未知结果保留同一请求，核对期间禁止编辑与切页；切库不能把原请求重提到新库。
- 统计使用 `stats_snapshot`、`purchase_trend`、`holding` 与 `resale_rate`，没有另一套统计计算。期间筛选只作用于期间摘要；趋势、持有分析与保值率按各命令的原有范围独立展示。

开发预览：`mobile-preview.html?tab=items`；空白 `&state=empty`，读取失败 `&state=error`，保存失败 `&mobile-state=save-error`，提交响应及首次核对丢失 `&mobile-state=unknown`。这些参数只操作虚构内存数据，刷新重置。可用 `route=items.detail&param.id=laptop` 直达详情（ID 以预览夹具为准）；素材选择应从编辑页进入。

模型、分页与提交恢复回归在 `tests/mobile-items-*.test.mjs`。浏览器预览不能证明原生相机、相册权限、通知送达、真实文件暂存或 iPhone 重启持久化；这些仍需隔离身份与虚构资料的设备验收。
