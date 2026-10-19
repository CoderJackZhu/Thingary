[简体中文](README.md) | [English](README.en.md)

<p align="center">
  <img src="src-tauri/icons/icon.png" alt="Thingary app icon: lines and record points" width="112" height="112">
</p>

<h1 align="center">Thingary · 物谱</h1>

<p align="center"><strong>A monthly view of your net worth, and a clearer path toward life beyond a paycheck.</strong></p>

Thingary is a local desktop app for checking account balances, tracking assets and debts, and planning with the money you have. Update your balances monthly or quarterly, then explore three questions: **How much should I save each month? When could I stop relying on a salary? How long could I take a break?** Optional belongings records keep photos, purchase costs, repairs, and warranties together.

The app currently has a **Simplified Chinese interface only**. Its account types are designed around mainland China, including housing provident funds (公积金), individual pension accounts (个人养老金), and mortgages. Financial amounts are recorded in Chinese yuan (CNY).

![21-second slideshow of the overview, accounts, planning, savings goals, period review, and belongings](docs/images/walkthrough.gif)

▶ [53-second film](https://thingary.jackzhu.top/#film) (Chinese captions): monthly check-ins, net-worth changes, belongings, and how saving a little more moves your retirement date.

## Download

**[Download 0.0.8 from GitHub](https://github.com/CoderJackZhu/Thingary/releases/tag/v0.0.8)** · [Gitee mirror](https://gitee.com/CoderJackZhu/thingary/releases) · [Product website](https://thingary.jackzhu.top/) · [Report an issue](https://github.com/CoderJackZhu/Thingary/issues)

Thingary is an **unsigned public beta** for macOS and Windows. System security prompts may appear on first launch; see the [installation guide (Chinese)](https://thingary.jackzhu.top/quickstart/#install).

On Mac, open the `.dmg` and drag the app into Applications. On Windows, run the `x64-setup.exe` installer. Start with account balances, set a planning goal if useful, and return for your next balance check. You do not need to log every purchase.

## Features

| | |
|---|---|
| **Account check-ins** | Record assets and debts and follow your net-worth trend. Includes property, pension, insurance cash value, and precious-metal account types. Property is excluded from financial net worth. |
| **Goals and planning** | Estimate required monthly savings and a possible financial independence date; compare purchases, a break from work, or a job change using your own assumptions. |
| **Savings goals and period review** | Follow savings progress and review balances, income, and major expenses over the last year, year to date, all time, or custom dates. |
| **Belongings, optional** | Keep prices, photos, repairs, warranties, and daily ownership costs. Enable recurring costs and digital assets when needed. |
| **Data protection** | Full and automatic backups, recently deleted records, and optional backup encryption with a recovery key you keep. |

Built for occasional check-ins. No daily transaction ledger, market-data feed, trading, or automatic payments. Planning results are estimates based on your recorded facts and assumptions; unknown values remain unknown.

## Privacy

No account or cloud sync. Your records stay on your computer and normal use works offline. Public release lists are queried when you click **Check for updates**, or at most once per 24 hours on startup if you choose to enable startup checks. Downloads and installation remain manual.

The main database and photos are **not encrypted**. Backup encryption is optional. Automatic backups share the same disk as your main data, so keep a separate off-device copy. Read [privacy and data safety (Chinese)](https://thingary.jackzhu.top/guide/#privacy).

## Platforms

- **macOS:** universal download for Apple Silicon and Intel; minimum target macOS 14. Tested on Apple Silicon with macOS 27. Intel and older macOS versions have not been verified on hardware.
- **Windows:** Windows 10 1809+ / Windows 11, x64. Unsigned installer; SmartScreen may show a warning.
- Both are public betas. See [known limitations (Chinese)](https://thingary.jackzhu.top/quickstart/#limits). There is no mobile app or cross-device sync.

## Docs

- [Quick start (Chinese)](https://thingary.jackzhu.top/quickstart/) · [User guide (Chinese)](https://thingary.jackzhu.top/guide/)
- [Product rules (Chinese)](docs/PRODUCT_RULES.md) · [Changelog (Chinese)](CHANGELOG.md) · [Documentation index (Chinese)](docs/INDEX.md)
- [Contributing (Chinese)](CONTRIBUTING.md) · [Development and testing (Chinese)](docs/DEVELOPMENT.md)
- [Security policy (Chinese)](SECURITY.md): report vulnerabilities privately as described there.

## License

Code is licensed under [AGPL-3.0-or-later](LICENSE). Releases 0.0.4 and earlier were labeled GPL-3.0-or-later. See [third-party licenses](THIRD_PARTY_LICENSES.md).

Planning calculations use an independent Rust core; see [source notices (Chinese)](SOURCE_NOTICES.md) and the [core documentation (Chinese)](crates/planning-engine/README.md).

The names “物谱” and “Thingary” and the app icon are outside the AGPL license. Use your own name and icon when redistributing a modified app; see [brand usage (Chinese)](docs/brand/README.md).
