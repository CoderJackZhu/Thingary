# 商店提交清单（Microsoft Store / App Store Connect）

维护者提交两个商店时的执行清单。文案草稿见 [Microsoft Store 上架文案](microsoft-store-listing.md) 与 [App Store 上架文案](app-store-listing.md)；发布流程与验收边界见[发布流程](../RELEASING.md)，iOS 具体步骤见 [iOS 小节](../RELEASING.md#ios)。

状态从「未开始」起算；只有实际在后台完成并留存结果后才改为「已完成」。已定的产品决策写在备注，不等于后台已完成。谁做：维护者=Jack；T-MS／T-IOS 是 2026-10-25 发布扩展任务单中对应的 GPT 任务；OpenCode 只准备文案草稿。

任何密钥、证书、Team ID、描述文件或口令的真实值都不写入本仓库；本清单不读取、不上传。完成后在备注写日期与证据位置，不要把截图、数据库、备份或密钥提交到仓库。

## Microsoft Store

| 项目 | 谁做 | 在哪做 | 当前状态 | 备注／已定 |
|---|---|---|---|---|
| 开发者账号（Microsoft Store 个人） | 维护者 | <https://storedeveloper.microsoft.com> | 未开始 | 需政府证件＋自拍验证；中国大陆能否注册未确认，卡住时告知维护者 |
| 应用名保留 | 维护者 | Partner Center › 应用名称 | 未开始 | 中文「物谱」、英文「Thingary」；被占用时「物谱 Thingary」 |
| 身份与发布者 | 维护者 | Partner Center › 账户资料 › 发布者 | 未开始 | 发布者显示名待定；与包身份 Publisher 一致 |
| 包标识（Package/Identity；对应 Bundle ID） | T-MS（GPT）＋维护者 | MSIX 清单 / Partner Center | 未开始 | 由 T-MS 打包时确定；不得写入证书私钥或口令 |
| 应用记录（Store ID） | 维护者 | Partner Center › 新应用 | 未开始 | 创建后记录 Store ID |
| 隐私政策网址 | 维护者 | Partner Center › 属性 | 未开始 | <https://thingary.jackzhu.top/privacy/>；需未登录可访问 |
| 隐私问卷／数据收集声明 | 维护者 | Partner Center › 隐私 | 未开始 | 按实际包：不收集、不跟踪；同步可选、默认关闭；无广告或统计 |
| 出口合规 | 维护者 | Partner Center › 出口合规（如适用） | 未开始 | 按实际加密使用回答；本文不预填 |
| 年龄分级（IARC） | 维护者 | Partner Center › 年龄分级 | 未开始 | 建议答案见 [Microsoft Store 上架文案](microsoft-store-listing.md) |
| 类别 | 维护者 | Partner Center › 商店列表 | 未开始 | 建议 Personal finance；备选 Productivity 或 Utilities & tools |
| 审核备注 | 维护者 | 提交页 › 认证说明 | 未开始 | 无需登录、样例入口、同步默认关闭、无内购 |
| 截图 | 维护者（T-MS 提供包后） | Partner Center › 商店列表 | 未开始 | 5 张：总览、账户盘点、规划、物品、同步设置；尺寸以提交页为准；只用虚构数据 |
| 商店列表文案 | OpenCode 草稿 → 维护者复核 | [microsoft-store-listing.md](microsoft-store-listing.md) → Partner Center | 未开始 | 中英文；草稿已备，未录入后台 |
| 定价（免费） | 维护者 | Partner Center › 定价 | 未开始 | 免费，无内购；以实际后台为准 |
| 地区与语言 | 维护者 | Partner Center › 市场和语言 | 未开始 | 至少 zh-CN、en-US；其他市场待定 |
| 支持网址 | 维护者 | Partner Center › 属性 | 未开始 | 建议使用指南 <https://thingary.jackzhu.top/guide/> 或 GitHub Issues；提交前确认可访问 |
| 营销网址（可选） | 维护者 | Partner Center › 属性 | 未开始 | <https://thingary.jackzhu.top/> |
| MSIX 打包与包验收 | T-MS（GPT） | 工作流 / Windows 构建环境 | 未开始 | 不在本任务范围；WebView2、数据目录与更新行为按 T-MS 实际包核对 |
| 提交认证与发布 | 维护者 | Partner Center | 未开始 | 未经维护者授权不提交、不发布 |

## App Store Connect

| 项目 | 谁做 | 在哪做 | 当前状态 | 备注／已定 |
|---|---|---|---|---|
| 开发者账号（朋友的个人账号） | 维护者＋朋友（账号持有人） | <https://developer.apple.com> / App Store Connect | 未开始 | 需朋友提供 Team ID 并确认同意发布；账号权限以实际为准 |
| 应用名保留 | 维护者 | App Store Connect › App 信息 | 未开始 | 中文「物谱」；被占用时「物谱 Thingary」 |
| 身份与发布者 | 朋友（账号持有人）＋维护者 | App Store Connect › 协议、税务和银行业务 | 未开始 | 发布者显示名由账号持有人决定；免费应用也需完成协议 |
| Bundle ID | 维护者 | <https://developer.apple.com> › Identifiers | 未开始 | `local.thingary.main`；开发取证仍用 `local.thingary.preview` |
| 应用记录 | 维护者 | App Store Connect › 我的 App › 新建 | 未开始 | 公开 API 不能创建应用记录，需网页操作 |
| 隐私政策网址 | 维护者 | App Store Connect › App 隐私 | 未开始 | <https://thingary.jackzhu.top/privacy/>；需未登录可访问 |
| 隐私问卷（App 隐私标签） | 维护者 | App Store Connect › App 隐私 | 未开始 | 建议「不收集数据」；依据见 [App Store 上架文案](app-store-listing.md) |
| 出口合规 | 维护者 | 首次上传后 App Store Connect | 未开始 | 按实际问卷回答并截图交 Jack；不预写 `ITSAppUsesNonExemptEncryption` |
| 年龄分级 | 维护者 | App Store Connect › 年龄分级 | 未开始 | 建议答案见 [App Store 上架文案](app-store-listing.md)；预期 4+ |
| 审核备注 | 维护者 | 提交页 | 未开始 | 无需登录、样例入口、相机／面容 ID／通知用途、`UIFileSharingEnabled` 的原因 |
| 截图 | 维护者 | App Store Connect › 预览和截图 | 未开始 | 5 张 6.9 英寸；其他必需尺寸以实际槽位为准；只用虚构数据 |
| 商店文案 | OpenCode 草稿 → 维护者复核 | [app-store-listing.md](app-store-listing.md) | 未开始 | 副标题、宣传文本、描述、关键词；草稿已备，未录入后台 |
| 定价（免费） | 维护者 | App Store Connect › 价格与销售范围 | 未开始 | 免费；已定，未在后台设置 |
| 地区与语言 | 维护者 | App Store Connect › 价格与销售范围 / App 信息 | 未开始 | 海外区，排除中国大陆；主要语言简体中文 |
| 支持网址 | 维护者 | App Store Connect › App 信息 | 未开始 | 建议使用指南 <https://thingary.jackzhu.top/guide/> 或 GitHub Issues |
| 营销网址（可选） | 维护者 | App Store Connect › App 信息 | 未开始 | <https://thingary.jackzhu.top/> |
| TestFlight 内测 | T-IOS（GPT）＋维护者 | App Store Connect / 真机 | 未开始 | 先内部测试，不发起外部 Beta；真机记录见[发布流程](../RELEASING.md#ios) |
| 提交审核 | 维护者 | App Store Connect | 未开始 | 未经 Jack 明确授权不提交 |

## 通用注意

- 「未开始」不表示没有产品决定；名称、免费、地区等已由维护者定，但仍未在后台设置。
- 两个商店的审核备注、年龄分级、隐私问卷和截图都应引用实际包与当前功能；未验证的平台或签名状态不要写成已通过。
- 应用内文案与隐私页须一致：同步可选、默认关闭；不把默认离线写成无需联网的绝对状态；不写未验证的其他平台版本。
- 账号注册、账号权限、提交与发布授权由维护者完成；代理只准备文案与检查项。
