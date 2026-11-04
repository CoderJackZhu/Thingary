# 快速上手

先完成一件小事：盘一次账户，或给一件物品留档。无需账号，也不用先填完所有设置。

更多操作可按需查阅[使用指南](USER_GUIDE.md)。

<a id="install"></a>

## 1. 安装并看看样例

到[国内下载镜像（Gitee）](https://gitee.com/CoderJackZhu/thingary/releases)或 [GitHub 下载页](https://github.com/CoderJackZhu/Thingary/releases/tag/v0.1.0)，选择 **0.1.0** 的安装附件。Source code 是源码，不是安装包。

- **Mac**：下载 `Thingary-0.1.0-universal.dmg`，打开后将「物谱」拖进「应用程序」。Apple Silicon 与 Intel 使用同一个包。
- **Windows**：下载 `Thingary_0.1.0_x64-setup.exe` 并运行。默认只安装给当前用户；缺少 WebView2 时需联网补装。安装或启动失败时见[Windows 安装](USER_GUIDE.md#windows-install)。
- **安卓**：下载 `Thingary-0.1.0-android.apk`，需要 Android 10 及以上、64 位 ARM 手机。按提示允许浏览器或文件管理器「安装未知应用」，安装后可收回权限。详见[安卓安装](USER_GUIDE.md#android-install)。
- **iPhone**：暂无公开安装包，尚未上架 App Store，见[手机版说明](USER_GUIDE.md#iphone)。

首次打开可能遇到系统安全提示。Mac 可在「系统设置 › 隐私与安全性」查看「仍要打开」；Windows SmartScreen 可查看「更多信息 › 仍要运行」。只对可信来源的安装包操作；若提示损坏、恶意软件或没有放行按钮，请先看[安装排查](USER_GUIDE.md#download)，不要关闭系统保护。

电脑首次打开直接进入独立的**虚构样例**；手机可点「先看看样例」。准备好后点「开始记录我的资料」或「开始记录」，进入自己的空白资料。手机的底部导航与常用操作见[手机版说明](USER_GUIDE.md#iphone)。

## 2. 完成一件小事

**想看清家底：用「账户与盘点」。** 对照银行、支付宝、券商等平台，录入各账户当天的余额和欠款。明确为零就填 0，不知道就保留未知。完成一次完整盘点后可以看到净资产；以后每月或每季再盘一次即可；新一次盘点会按上次金额预填，没变的账户不用动，变了直接改，核对后统一保存。缺项时先补齐，不把未知当作 0。

**想整理物品：用「全部物品」。** 先记名称和已知的购买信息，照片、日期与保障以后再补。可以只使用物品档案，不必建立账户或规划。

**想为以后做计划：用「目标」。** 可以和前两项一起用，不需要一次填完全部信息。

不想看到的功能，到「设置 › 功能模块」按用途或逐项关闭；关闭只隐藏入口，已有资料会保留。同一用途关闭后再选回，该用途的功能会全部开启。

需要逐步说明时，看[第一次账户盘点](USER_GUIDE.md#first-snapshot)或[第一件物品](USER_GUIDE.md#first-record)。

## 3. 给资料留一份备份

到「设置 › 数据管理」，先选择启用备份加密或继续明文；选择前自动与额外备份暂停。然后做一次**完整备份**，另外保存一份到外接盘或其他位置。

加密备份需要你保管恢复密钥，丢失无法找回；它不会加密主资料库和图片。Excel 适合查看或整理表格，不能替代包含图片和关系的完整备份。操作见[备份与恢复](USER_GUIDE.md#backup)。

### 可选：在多台设备之间同步

电脑与手机版可在「设置 › 数据管理 › 同步」（手机：「我的 › 设置 › 同步」）选择 WebDAV，连接自己的服务器。同步仍为实验性功能，默认关闭，传输加密整库快照，不自动合并或替换本机资料。换设备需要同步口令；它不同于服务器的应用密码和备份恢复密钥，请另行保存。详见[同步说明](USER_GUIDE.md#sync)。

## 以后需要时再看

| 我想做什么 | 去哪里看 |
|---|---|
| 为一笔钱设目标 | [存钱目标](USER_GUIDE.md#savings-goals)，只跟踪进度，不冻结资金 |
| 算每月要存多少、何时能不靠工资 | [目标与规划](USER_GUIDE.md#planning)，按需填写条件，不是收益承诺 |
| 看一段时间的变化 | [区间回顾](USER_GUIDE.md#annual-review)，净资产变化不等于投资收益 |
| 录入外币或投资份额 | [外币账户](USER_GUIDE.md#外币账户) · [持仓录入](USER_GUIDE.md#按持仓记录投资) |
| 在多台设备之间同步 | [WebDAV 同步](USER_GUIDE.md#sync)，整库替换、不合并 |
| 更新软件或换电脑 | [更新与换机](USER_GUIDE.md#update)，先做完整备份 |
| 找不到功能、记录或数字 | [常见问题](USER_GUIDE.md#faq) |

<a id="limits"></a>

## 已知限制

- **平台**：Mac 最低目标为 macOS 14，Windows 为 Windows 10 1809+ / 11 x64；目前实机使用覆盖 Apple Silicon Mac 和 Windows 11 x64。Intel、macOS 14、Windows 10 和安卓真机尚未验证。Windows ARM 设备需通过系统模拟运行 x64 版；暂无 Linux 客户端。
- **加密范围**：加密导出的备份文件（可选）与 WebDAV 同步快照；主资料库、图片和恢复前保护副本未加密。
- **不做**：日常流水记账、行情交易、自动付款、后台常驻同步或记录级合并。

用过之后想说说感受（卡在哪、哪里看不懂、有没有用），填[使用反馈](https://github.com/CoderJackZhu/Thingary/issues/new?template=usage_feedback.yml)；遇到错误请提[缺陷报告](https://github.com/CoderJackZhu/Thingary/issues/new?template=bug_report.yml)。请遮住真实资料，不要上传数据库或备份。
