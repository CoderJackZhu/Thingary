# Microsoft Store 上架文案草稿（Windows）

维护者提交 Microsoft Store 时的文案与素材草稿，不是版本说明，也不代表已打包、已提交或已通过认证。本文只覆盖商店列表内容；MSIX 打包、包身份、WebView2 与数据目录行为见[发布流程的微软商店小节](../RELEASING.md#microsoft-store)，提交项见[商店提交清单](store-submission-checklist.md)。

当前源码的桌面版默认不联网；可选的 WebDAV 整库同步为实验性功能，默认关闭。文案不把默认离线写成无需联网的绝对状态，不写未验证的其他平台版本，不写未发生的代码签名或商店认证。商店包可能调整更新检查或数据目录；提交前由 T-MS 按实际包核对本文的网络与更新描述。

本文不包含密钥、证书、账号口令或真实服务器信息。所有「待维护者填写」由维护者提交时补齐；字段上限与截图规格以 Partner Center 当前要求为准，本文不凭记忆写具体字符数或像素。

## 1. 应用名称

| 语言 | 草稿 | 被占用时 |
|---|---|---|
| 简体中文 | 物谱 | 物谱 Thingary |
| English | Thingary | 物谱 Thingary |

商店显示名称、发布者名称与包身份是不同字段；发布者名称由维护者在 Partner Center 决定，本文不填。

## 2. 简短描述

| 语言 | 草稿 |
|---|---|
| 简体中文 | 每月十分钟盘一次家底：账户、物品和计划放在一处，算清每月要存多少、还要上几年班。资料默认只在本机。 |
| English | Spend ten minutes a month on your net worth: accounts, belongings and plans in one place, with estimates for monthly saving and time to financial independence. Local-first by default. |

只写当前桌面版已提供的能力；不写其他平台或未验证的功能。

## 3. 完整描述

### 简体中文

物谱帮你看清家底，再为想过的生活做个计划。

不用每天记流水。每月或每季回来盘点一次，把分散在各处的账户余额、投资和物品收进一处，看见积累的变化。

【盘家底】

- 按账户记录余额，支持存款、投资、外币账户和负债，可按分组整理
- 每次盘点保留历史；未知的数字保持未知，不会当成零
- 设置存钱目标，查看进度

【还要上几年班】

- 填入年龄、家底、每月生活费和能存的钱，估算最早什么时候可以不靠工资生活
- 查看每月需要存多少、歇一阵能撑多久，以及结果背后的假设
- 可以试算工作变化、临时现金等不同条件
- 规划支持简单的两人合计；不分别计算两人的社保、医保或养老待遇

【物品档案（可选）】

- 记录购买价格、日期、渠道和照片，查看每件物品的日均持有成本
- 售出或退役后仍保留历史
- 心愿清单帮你想清楚再买

【资料与隐私】

- 没有物谱账号，没有开发者运营的云端，没有广告和统计，开发者看不到你的资料
- 资料默认只保存在本机；可选 WebDAV 整库同步为实验性功能，默认关闭，只连接你自己配置的服务器
- 桌面版默认不联网。商店版只有你主动使用 WebDAV 同步时才会联网（快照只发送到你配置的服务器）；版本更新由 Microsoft Store 提供，应用内不检查新版本
- 可导出完整备份，并用你自己保管的恢复密钥加密；恢复密钥丢失后无法找回加密备份

【请注意】

- 物谱是个人记录与估算工具，结果依赖你填写的数据和假设，不构成投资、税务或养老金建议
- 不提供联网行情、交易、支付或 AI 功能
- 商店版要求 Windows 11 x64；MSIX 不能在启动时安装 WebView2。公开桌面安装包只在 Windows 11 x64 实测，Windows 10 1809+ 为目标范围但尚未实机验证

### English

Thingary helps you see what you have and plan for the life you want.

No daily bookkeeping. Come back once a month or once a quarter: record balances across banks, brokerages, funds and other accounts, keep your belongings in one place, and watch the accumulation over time.

[Net worth]

- Record balances by account, including savings, investments, foreign-currency accounts and debts; group accounts as you like
- Every check-in keeps its history; unknown amounts stay unknown instead of becoming zero
- Set savings goals and follow progress

[Time to financial independence]

- Enter your age, assets, monthly living costs and how much you can save; estimate the earliest age you could stop relying on a salary
- See how much you need to save each month, how long a break would last, and the assumptions behind the result
- Try different work, cash and spending conditions
- Planning supports a simple two-person total; it does not calculate separate social security, health insurance or pension benefits for each person

[Belongings (optional)]

- Record purchase price, date, source and photos; see the average daily cost of each item
- History is kept after an item is sold or retired
- A wish list helps you think before buying

[Data and privacy]

- No Thingary account, no developer-operated cloud, no ads or analytics; the developer cannot see your data
- Data stays on your device by default. Optional WebDAV whole-library sync is experimental and off by default; it connects only to a server you configure
- The Store app does not use the network by default. It goes online only when you use the optional WebDAV sync you configured (snapshots go only to your own server). Updates are delivered by the Microsoft Store; the app does not check for new versions
- Export a full backup and encrypt it with a recovery key you keep; a lost key cannot be recovered

[Please note]

- Thingary is a personal record and estimation tool. Results depend on the data and assumptions you enter and are not investment, tax or pension advice
- No market data, trading, payments or AI features
- The Store version requires Windows 11 x64; an MSIX cannot install WebView2 at launch. The public desktop package has been tested on Windows 11 x64 only; Windows 10 1809+ is the target range but has not been tested on a real device

上述描述以拟提交的商店包为准：应用内不检查更新，版本由 Microsoft Store 提供。若提交前数据目录、同步入口或 WebView2 支持范围再有变化，维护者应同步删改对应句子。

## 4. 关键词（最多 7 项）

| 语言 | 草稿 |
|---|---|
| 简体中文 | 家底, 净资产, 盘点, 物品, 退休, 存钱, 隐私 |
| English | net worth, personal finance, inventory, retirement, FIRE, savings, privacy |

使用逗号分隔，最多 7 项；不使用竞品名或他人商标；每项长度以 Partner Center 当前限制为准。

## 5. 类别建议

| 项目 | 建议 | 说明 |
|---|---|---|
| 主要类别 | Personal finance（个人理财） | 账户盘点与规划是主线 |
| 备选类别 | Productivity（效率）或 Utilities & tools（实用工具） | 以 Partner Center 实际可选值为准 |
| 次要类别 | 以提交页实际字段为准 | 不凭记忆强行填写第二类别 |

物谱是本地记录与估算工具，不提供投资、借贷、交易或支付服务。若商店后台或认证要求额外说明，由维护者按真实功能填写。

## 6. 年龄分级问卷（建议答案）

问卷题目和措辞会随 IARC 版本变化；以下只给回答方向，维护者按 Partner Center 中的实际题目逐项回答，最终分级以问卷结果为准。

| 问卷方向 | 建议答案 | 说明 |
|---|---|---|
| 暴力、血腥 | 无 | 应用不包含暴力内容 |
| 性内容、裸露 | 无 | 应用不包含性内容 |
| 粗俗语言 | 无 | 应用不包含粗俗语言 |
| 恐怖、惊吓 | 无 | 应用不包含恐怖内容 |
| 酒精、烟草、毒品 | 无 | 应用不包含相关引用或推广 |
| 赌博、模拟赌博、抽奖、战利品箱 | 无 | 没有真钱或模拟赌博，没有抽奖或战利品箱 |
| 用户生成内容、用户互动、社交 | 无 | 没有账号、分享或多人协作；资料只在本机 |
| 位置共享 | 无 | 不请求定位，不共享位置 |
| 个人身份信息收集或共享 | 无 | 不收集、不上传；可选同步只连接用户自己的服务器 |
| 广告 | 无 | 没有广告或第三方统计 |
| 应用内购买、数字商品 | 无 | 免费，没有内购 |
| 无限制网页访问 | 无 | 应用内没有浏览器；外链由系统浏览器打开 |
| 金融交易或投资建议 | 不提供 | 只做记录与估算，不构成投资、税务或养老金建议 |
| 预期结果 | Everyone / 3+（以 IARC 结果为准） | 最终以 Partner Center 中 IARC 问卷和分级结果为准 |

## 7. 隐私政策网址

<https://thingary.jackzhu.top/privacy/>

提交前用未登录窗口确认可访问，内容与商店版实际行为一致。若商店版改变网络行为，先更新隐私页再提交。

## 8. 截图清单

尺寸、格式、数量、文件大小与是否分语言，以 Partner Center 当前要求为准；本文不写具体像素。不要放大、拼接或加伪造界面。

| 序号 | 内容 | 实际入口 | 备注 |
|---|---|---|---|
| 1 | 桌面总览 | 总览 | 使用虚构样例；显示净资产、规划和物品摘要 |
| 2 | 账户盘点 | 账户与盘点 › 更新今天的余额 / 完整盘点 | 使用虚构账户与余额；不出现真实账户名或卡号 |
| 3 | 规划 | 规划 › 目标 | 使用虚构年龄、收入与结果 |
| 4 | 物品 | 全部物品 › 虚构物品详情 | 使用虚构物品与照片；不出现真实序列号或地址 |
| 5 | 同步设置 | 设置 › 数据管理 › 同步（WebDAV） | 使用虚构服务器地址与用户名；口令留空或遮住；不显示真实设备名 |

所有截图只使用虚构数据。桌面截图在 Windows 11 上拍摄；不要用浏览器窗口冒充应用。如果商店要求分语言截图，至少准备简体中文；English 列表按提交页要求使用同一组或另拍。

## 9. 版本说明模板

只写本版实际发生的变化；未验证的平台、签名或商店认证不要写。商店版由 Store 更新时，不写应用内检查更新。

### 简体中文模板

```markdown
## <版本号>（YYYY-MM-DD）

### 新增
- <待维护者填写>

### 改进
- <待维护者填写>

### 修复
- <待维护者填写>

### 资料与兼容性
- 资料结构：schema <待维护者填写>
- 升级前请先做完整备份；与上一商店版本的兼容性：<待维护者填写>
- 已知限制：<待维护者填写；同步为实验性、默认关闭；安装包签名状态以实际包为准>

### 包校验
- 安装包：<待维护者填写>
- SHA-256：<待维护者填写>
```

### English template

```markdown
## <Version> (YYYY-MM-DD)

### New
- <TBD by maintainer>

### Improved
- <TBD by maintainer>

### Fixed
- <TBD by maintainer>

### Data and compatibility
- Schema: <TBD by maintainer>
- Back up before upgrading. Compatibility with the previous Store version: <TBD by maintainer>
- Known limitations: <TBD by maintainer; sync is experimental and off by default; signing status depends on the actual package>

### Package verification
- Installer: <TBD by maintainer>
- SHA-256: <TBD by maintainer>
```

## 10. 提交前核对

- [ ] 名称、简短描述、完整描述、关键词、类别、年龄分级、隐私政策网址已录入 Partner Center。
- [ ] 描述中的网络、同步与系统要求句子与 T-MS 实际 MSIX 包一致。
- [ ] 截图使用虚构数据，尺寸、格式、数量按提交页要求。
- [ ] 没有写入密钥、证书、真实服务器或账号信息。
- [ ] 提交与发布由维护者授权；本文不代替 T-MS 的打包验收。

## 相关文档

- [商店提交清单](store-submission-checklist.md)
- [App Store 上架文案](app-store-listing.md)（iOS 对照）
- [发布流程](../RELEASING.md)
- [业务规则](../PRODUCT_RULES.md)
- [隐私政策](https://thingary.jackzhu.top/privacy/)
