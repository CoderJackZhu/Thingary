# 规划假设与资金流动：双任务接入契约 v1

状态：**2026-10-12 前置契约已冻结；C1 假设、C2 资金流动原生端口与 C3 UI 已整合；自动检查及隔离核心原生闭环通过，验收边界见开发说明。** 源码基线为 `6332f874680e41a7f6c967493aad11706bc849c1`。目标以[边界设计第18节](PRODUCT_BOUNDARIES_DESIGN.md#planning-flow-followup)为准；本文件维护领域与UI接缝，不是已上线功能说明。

唯一类型定义：[planning-followup-contract.ts](../src/planning-followup-contract.ts)。该文件只有类型，没有保存、计算或运行时入口；其存在不表示原生端口可用。旧[投资核对v1](PLANNING_SIMPLIFICATION_CONTRACT.md)的输入输出继续作为计算核心边界，新契约在外层管理明细来源及确认失效，不向旧核心偷偷塞入未约定字段。

## 1. 所有权与接入顺序

领域任务负责全部Rust、数据库迁移／备份／导出／回执、现有领域TS和服务适配。UI任务负责TSX、样式、表单草稿转换、页面宿主和交互测试。共享类型由领域任务维护，改变冻结字段或语义时先修订本文件及共用夹具，再交付给UI任务；UI不得复制类型或自行猜测IPC。

领域提供 `src/planning-followup-port.ts`，导出 `nativePlanningFollowupPortV1(): PlanningFollowupPortV1`。UI可立即按注入的port制作组件／夹具；真实入口仅在领域适配器交付后接入。原生实现须复用当前 `submit`、pending保存和回执核对，不创建新的并行请求日志。

UI组件不直接invoke，不计算损益、区间流量、内容键或完整性。金额输入可做格式转换；严格校验、分页、分类、去重和状态优先级由领域负责。测试替身显式标为虚构，不能混入默认运行时分支。

## 2. 假设核对

`AssumptionValuesV1`是四个万分比整数。沿用实际收益−1000至2000、通胀0至2000、波动0至6000的后端边界；默认分别0、0、200、500。旧计划原值保持，不默认确认。

`saveAssumptions(values, confirm, context)`为单分区原子保存，不能顺带保存预算、预计投入或资金。confirm=true只来自用户明确“确认并保存”；普通保存／恢复默认／其他分区保存不会凭空确认。用户曾确认后值改变标needs_review；无历史确认标unconfirmed；值不变且不改确认的无关编辑保持原状态。后端必须保护所有旧basic/setup保存路径，旧载荷不得覆盖新确认元数据或把未核对标已确认。

四问仍走旧setup事务；新假设独立编辑器可由原“更多假设”区域进入。旧区域的生活目标和应急金仍由原所有者保存，不把它们丢掉。普通预算、投入、费用编辑必须原样携带已有波动值。新假设编辑器关闭不存草稿，结果未知沿原回执核对。profile尚不存在时允许读取默认值，但拒绝独立确认写入，提示先保存规划；不得偷偷创建不完整profile。

## 3. 流动事实、来源及列表

`amount_cents`为非零正整数分，范围沿用既有事实金额上限；日期真实有效，至少一端为账户，两端不能相同。只允许现有可维护的金融资产账户作为新流动端点，贷款／负债还款和受限资产解锁不在本轮自动分类范围。历史停用／删除账户仍可显示，不能用名字重绑。

用途校验：own_transfer为两个本人账户；external_funding为账户与外部之间的非投资收益本金移动；living_payment为账户到外部生活支付；income_distribution为已归属投资账户向其他账户／外部的现金收益分配；investment_cost为账户到外部投资费用。外部直接收到、没有可确认投资来源的收入保留在收入事实里，不伪造投资账户。对既有不支持运动继续使用区间unsupported_movements，不伪造普通现金流。

流动日期按实际结算日。金额、端点或用途无法确定时不能保存成虚假事实；UI可取消或先保留区间备注。投资账户直接消费必须作为生活支付流出，组合内互转抵消；投资费用不加回。范围外单独支付费用不被自动扣进所选投资组合净损益，结果披露不含该成本。

`MovementSourceV1.key`是领域提供的稳定、不透明来源键。收入和重要支出/其他可稳定定位的已发生支出通过listSources返回，UI不得使用列表序号或自行拼出复合键。首版关联整笔同额同日记录，不能关联已删除或已有其他有效流动关联的来源；历史来源变更保留流动且标needs_review。没有可靠稳定键的来源暂不提供候选，用户仍可记未关联流动；适配覆盖必须列入交付说明，不扩建消费账本。

listSources返回的候选身份由后端保存时重新校验。source_status为展示状态，不接受客户端写入；删除来源不能级联删除流动。关联解除通过保存source=null完成，使用流动修订校验；已删除流动也可按原字段仅解除来源而保持删除状态，其他编辑先恢复；永久清理来源须遵守显式解除及审计规则。

listMovements的from_date/to_date均为包含边界，null表示不限；区间汇总仍使用(B0,B1]，不得混用。空列表与读取失败分开。cursor由领域生成、校验查询及generation；过期游标返回错误并让UI重新从第一页读取，不能悄悄丢行。明细分页不能截断用于计算的全集。

## 4. 区间预览与确认

- readReview返回保存的draft及按当前事实校验后的结果；未有记录时draft为manual、两个null、未确认，不能复制默认0。listReviews含已删除历史，setReviewDeleted沿用原删除恢复与冲突规则，不能绕过新来源模式。
- manual选项允许null金额以保存未完整草稿；movements不接受客户端提交合计。
- `previewReview`是只读，含旧合计、新合计、差额和结果。result是按该draft和当前事实得到的候选结果，UI标“核对预览”，不得误呈现为已保存结果。
- `basis_key`由领域对端点、范围、模式、draft、有关流动及来源状态生成。UI原样提交；确认时同一事务重新读取并重算。包括“原来没有记录，后来新增一条”的情况，不能只比较旧成员revision。
- 模式切换前展示差额，明确操作后保存；不自动补齐差额为流水。保存新模式前需显式确认完整性，保存未完整状态则保持损益待核对。旧合计及模式更正保留审计。
- 无流动明细可预览合计0／0，但未明确confirmed_complete时不能ready。手填模式不将明细再叠加；新相关明细也会撤销原手填确认。
- 端点过期／范围不一致／不支持运动沿旧结果状态降级；流动或关联失效映射needs_review，reason code在FollowupIssue中扩展为stale_movements、source_mismatch、source_deleted。不要为此扩宽旧核心类型或令它猜测明细。
- 两端不同投资范围不得自动凑齐；本轮主页面沿用现有完整投资范围，不新增自定义组合选择器。F04的单账户范围用领域夹具验证。

`previous_totals`无历史核对时为null；difference的每项为新−旧有符号整数分，任一未知则null。selected_totals不因用户勾确认而改数值。movement_count只统计当前范围和期间相关明细，关联收入不另算一条流动。

## 5. 保存、错误和生命周期

每次用户动作由宿主生成一次request_id；expected_revision绑定用户正在编辑的记录，不以提交前重读的新revision覆盖。新记录id=null且expected_revision=null；编辑／删除／恢复使用真实ID与revision。saveReview的revision属于核对记录，saveAssumptions的revision属于profile。

saved表示事务已确认，宿主重新读取真实来源后关闭／展示；读取失败时显示“已保存，刷新失败”，不能重提。unresolved保持原请求及generation，冻结重复提交，允许安全关闭后在原pending入口核对。resolve不重放旧输入；跨generation或查不到原库回执不能谎报未提交，复用现有恢复安全规则。rejected保留草稿和字段错误；复用既有错误码，至少覆盖revision_conflict、stale_basis、overlapping_flow、source_conflict、pending_request和invalid_input的结构化原因。

读取返回ready／disabled／error；loading是UI本地在途状态。资料库切换、组件卸载、区间／查询切换时废弃旧响应，不把旧scope结果显示成新结果。模块关闭时后端也阻断相应读写；无两次盘点仍可独立记流动。无任何账户时引导先建账户，不生成外部→外部的无归属记录。

## 6. 接缝交付门槛

领域先交可编译适配器、逐方法状态说明、保存及故障测试、真实文件清单与完整提交SHA；不得交永远返回saved的占位端口。UI在此之前完成纯展示／交互、空白／未知／错误／提交未知和模拟端口测试，不把准备状态写成已经接通原生。

真实接入完成后四项仓库检查以及[第18节验收](PRODUCT_BOUNDARIES_DESIGN.md#planning-flow-followup)联合执行。UI提供同尺寸对照，原生保存、重启、备份恢复、文件选择和键盘分别记录；仅使用虚构预览或隔离身份。契约版本、数据库schema和应用版本彼此独立。

## 7. 已实现的原生适配

`nativePlanningFollowupPortV1()` 已提供本契约全部方法，无未就绪或占位保存分支。假设使用 schema 38 的独立核对表；资金流动与区间来源使用 schema 39，所有写入共用原请求引擎。端点候选首版限现金／投资／混合投资／基金／债券资产账户；来源候选覆盖月度收入和未关联物品的独立重要支出，其他派生支出暂不提供稳定候选。独立流动无需退休目标或两次盘点。

真实错误包括 `PROFILE_REQUIRED`、`REVISION_CONFLICT`、`STALE_BASIS`、`OVERLAPPING_FLOW`、`SOURCE_CONFLICT`、`SOURCE_MISMATCH`、`INVALID_INPUT`、`STALE_CURSOR`、`MODULE_DISABLED` 及 `STALE_DATASET`；写端口提供小写 issue.code，读端口保留原错误码。无回执且原 generation 仍有效时可判定 `not_committed`；跨 generation 或无法读取回执保持 unresolved。假设、流动、核对均保留原 pending 入口，不创建第二份请求日志。

F01—F12 的 Rust Store 与端口错误／回执自动测试使用虚构临时资料。它们验证真实事务、重启、备份恢复及 Excel 内容。C3 页面另完成隔离身份的保存、更正、删除恢复、来源关联、重启及系统备份／Excel 面板闭环；完整键盘、输入法与 VoiceOver 未验，范围由现行开发说明维护。
