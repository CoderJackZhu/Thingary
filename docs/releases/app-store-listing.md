# App Store 上架文案草稿（iOS）

维护者提交 App Store Connect 时的素材草稿，不是版本说明，也不代表已提交审核。2026-10-21 已定选项见下表；其余占位仍由维护者填写。用语以[使用指南](../USER_GUIDE.md)和[业务规则](../PRODUCT_RULES.md)为准；没有账号、联网行情或 AI，文案不得出现这些；同步可选、默认关闭，不得把默认离线写成从不联网或必须联网。使用指南已增加「iPhone 版」一节及备份、更新、隐私、通知各章的 iPhone 说明（标注 TestFlight 测试中、尚未上架）；上架后需维护者把「即将推出」改为 App Store 链接。

字数限制：宣传文本 170 字符、描述 4000 字符、关键词 100 bytes，出自 [App Store Connect 平台版本信息](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information)；名称与副标题 30 字符是常见限制，该页未列出，需维护者在填写时核实。

## 基本信息

| 项目 | 草稿 | 状态 |
|---|---|---|
| 应用名称 | 物谱；被占用时用「物谱 Thingary」 | Jack 已定；登录后检查可用性 |
| Bundle ID | `local.thingary.main` | Jack 已定；使用 `tauri.appstore.conf.json`，开发取证仍用 `local.thingary.preview` |
| SKU | 自定，例如 `thingary-ios-1` | 占位 |
| 主要语言 | 简体中文 | 建议 |
| 价格 | 免费 | Jack 已定 |
| 销售范围 | 海外区，排除中国大陆（尚未备案） | Jack 已定；登录后台后执行 |
| 设备 | 仅 iPhone、竖屏 | 不包含 iPad |
| 版权 | `© <年份> <持有人>` | 占位 |
| 开发者账号类型 | Jack 朋友的个人账号 | Jack 已定；需完成账号权限和签名配置 |

## 副标题（≤30 字）

盘家底，算还要上几年班

（11 字。备选：物品档案与资产盘点，全部留在本机）

## 宣传文本（≤170 字）

每月花十分钟盘一次家底：账户、物品、存下多少，一目了然。再用你自己的条件算算还要上几年班，一个人或两个人一起算。没有账号，资料默认只保存在你的手机里；可选的 WebDAV 同步默认关闭，只连接你自己配置的服务器。

## 描述（≤4000 字）

物谱帮你看清自己的家底，再为想过的生活做个计划。

不用每天记流水。每月或每季回来盘点一次，把分散在各处的账户余额、投资和物品收进一处，看见积累的变化。

【盘家底】
· 按账户记录余额，支持存款、投资、外币账户和负债，可按分组整理
· 每次盘点保留历史，未知的数字就标未知，不会当成零
· 设置存钱目标，查看进度

【还要上几年班】
· 填入年龄、家底、每月生活费和能存的钱，估算最早什么时候可以不靠工资生活
· 看每月需要存多少、歇一阵能撑多久，并查看结果背后的假设
· 可以试算工作变化、临时现金等不同条件
· 生成当前报告，通过系统分享面板导出 PDF

【两人一起算】
· 规划时选「两个人」，填入伴侣的出生年月和停工年龄
· 生活费与每月能存的钱按两人合计填写，结果会显示两人都不上班的时间
· 只做简单合并，不分别计算两人的社保、医保或养老待遇

【物品档案】
· 记录购买价格、日期、渠道和照片，查看每件物品的日均成本
· 保修、维护与周期付款可设置本机提醒
· 心愿清单帮你想清楚再买

【资料在本机，默认不联网】
· 没有账号、没有开发者运营的云端、没有广告和统计，开发者看不到你的任何资料
· 默认不访问网络，不检查更新；可选的 WebDAV 同步只连接你自己配置的服务器，内容用你的口令加密后上传，默认关闭
· 可导出完整备份，并用恢复密钥加密；备份通过系统分享面板，保存到哪里由你决定
· 可开启面容 ID 锁和「屏幕隐私」，切换应用时遮住内容

【请注意】
· 物谱是个人记录与估算工具，结果依赖你填写的数据和假设，不构成投资、税务或养老金建议
· 备份文件和恢复密钥由你自己保管；恢复密钥丢失后无法找回加密备份
· 没有联网行情；同步不会自动合并，两边都有改动时需要你选择保留哪一边

隐私政策：<https://thingary.jackzhu.top/privacy/>

> 描述中每一条都需对照当前 iOS 构建核对：外币、负债、分组、提醒、PDF 等以[使用指南](../USER_GUIDE.md)对应章节和手机界面实际行为为准，没有的就删。

## 关键词（≤100 字符）

家底,净资产,盘点,物品,收纳,退休,FIRE,存钱,保修,日均成本,隐私

（逗号分隔，含逗号 37 字符、UTF-8 共 83 字节。Apple 页面写的是「100 bytes」，汉字按 3 字节计时也不超限；是否按字节计需维护者在 App Store Connect 实测。不要使用他人商标或竞品名；名称与副标题里已有的词不必重复。）

## 类别建议

| 项目 | 建议 | 依据 |
|---|---|---|
| 主要类别 | 财务（Finance） | 账户盘点与规划是主线。备选「效率」（Productivity） |
| 次要类别 | 效率（Productivity）或 生活（Lifestyle） | 物品档案属辅助 |

物谱是本地记录与估算工具，不提供投资、借贷、交易或支付服务。若实际后台或审核要求额外说明，由维护者根据真实功能填写。

## 年龄分级问卷（建议答案）

问卷项目见 [Apple 年龄分级说明](https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions)。以下按当前功能的建议答案，维护者提交时以实际问卷为准：

| 问卷类别 | 建议答案 |
|---|---|
| 家长控制 / 年龄验证 | 无 |
| 无限制网页访问 | 否（应用内没有浏览器；点击链接由系统浏览器打开） |
| 用户生成内容 / 社交 / 消息聊天 | 否（内容只在本机，没有分享给其他用户的功能） |
| 广告 | 无 |
| 粗俗语言、恐怖、酒烟毒、性与裸露、暴力、枪械 | 无 |
| 医疗 / 健康 | 无 |
| 赌博、模拟赌博、抽奖、战利品箱 | 无 |

预期结果 4+。注意：「金融」功能并非问卷项目，但规划结果不得被描述为投资建议。

## App 隐私标签（建议）

数据类型：**不收集数据**（Data Not Collected）。依据：应用默认不联网（可选的 WebDAV 同步只连接用户自己配置的服务器，开发者不收到任何数据），没有账号，没有第三方 SDK 或统计，资料只存本机。应用内隐私清单 `PrivacyInfo.xcprivacy` 与此一致（NSPrivacyTracking=false，NSPrivacyCollectedDataTypes 为空）。填写参考 [App 隐私详情](https://developer.apple.com/app-store/app-privacy-details/)。我对「收集」的理解（数据离开设备并被开发者或第三方访问才算）是推断，维护者提交时请对照该页原文核对。

## 网址

| 项目 | 地址 |
|---|---|
| 支持网址 | <https://thingary.jackzhu.top/guide/>（也可用 GitHub Issues：<https://github.com/CoderJackZhu/Thingary/issues>） |
| 隐私政策网址 | <https://thingary.jackzhu.top/privacy/>（需先随官网部署上线） |
| 营销网址（可选） | <https://thingary.jackzhu.top/> |

## 审核备注（建议）

- 无需登录，不需要测试账号。
- 应用默认不联网；设置里的 WebDAV 同步默认关闭，审核无需开启；首次打开可点「先看看样例」体验虚构样例资料。
- 相机用于给物品拍照，面容 ID 用于可选的应用锁，通知为本机提醒。
- 开启 UIFileSharingEnabled 是为了让用户在「文件」App 中取得备份（见 Info.plist）。

## 截图清单

前 4 张使用样例，第 5 张在空白开发预览资料库手工录入「虚构风景装饰画」，照片选自新建模拟器自带的瀑布照片。全程使用默认预览身份，在 iPhone 17 Pro Max 模拟器拍摄 5 张浅色竖屏图（1320×2868）。原图与录屏保存在仓库外的 `~/Thingary-store-shots/`，PR 只附缩略图，不提交到 Git。保持真实应用画面，不另加图上标题。

| 序号 | 内容 | 实际入口 | 文件名 |
|---|---|---|---|
| 1 | 总览 | 「先看看样例」后，总览标签 | `01-overview.png` |
| 2 | 完整盘点 | 财富 › 完整盘点 | `02-full-checkin.png` |
| 3 | 一个人的规划结果，显示预计停工年龄／月份 | 规划 › 目标 | `03-plan-solo.png` |
| 4 | 两个人的规划结果 | 规划中设置「两个人」后回到目标 | `04-plan-couple.png` |
| 5 | 带照片的物品列表或详情 | 物品 › 虚构风景装饰画详情 | `05-item-photo.png` |

拍摄前清理状态栏：

```sh
xcrun simctl ui "$SIM_UDID" appearance light
xcrun simctl status_bar "$SIM_UDID" override --time '9:41' \
  --dataNetwork wifi --wifiMode active --wifiBars 3 \
  --batteryState charged --batteryLevel 100
xcrun simctl io "$SIM_UDID" screenshot "$HOME/Thingary-store-shots/01-overview.png"
```

完成后 `xcrun simctl status_bar "$SIM_UDID" clear`。PNG／JPEG 不得含 alpha，逐张检查尺寸、照片、规划人数和结果，不能用设置页替代规划结果。当前规划目标页显示预计停工年龄／月份，剩余工作年数显示在总览；第 3 张按实际目标页取景，第 1 张保留「还要上几年班」。

规格参考 [Apple 截图规范](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications)（2026-10-22 核对）：1320×2868 属于 Dynamic Island 大屏组；官方页面另列 Dynamic Island 中屏为必需尺寸，因此这 5 张是本轮指定的 6.9 英寸素材，**不表示其他必需尺寸已齐全**。提交前以 App Store Connect 实际槽位核对是否需补拍 1179×2556 或 1206×2622。仅支持 iPhone，不需 iPad 截图。
