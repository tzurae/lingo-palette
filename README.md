# Lingo Palette

Lingo Palette 是一個 Chrome Desktop 擴充套件，協助繁體中文使用者在閱讀網頁時理解並記住選取的英文，不需要離開目前頁面。

## Beta 狀態

`0.1.1` 是供實際使用與跨電腦測試的 GitHub Beta Release，不是 Chrome Web Store 版本。Unpacked extension 不會自動更新；每台電腦需要手動下載、安裝與更新。

## 主要功能

- Selection 上方自動顯示低干擾 Quick Hint。
- 在 Side Panel 執行 Deep Dive。
- 播放美式或英式發音，長 Selection 仍維持單一播放體驗。
- 保存 Lookup Records、Learning Items、Learner Notes 與 Review Evidence。
- 產生經 Evidence Pack 驗證的 Review Items。
- 匯出與匯入 Portable backup。

## 從 GitHub Release 安裝

1. 打開本 repository 的 [Releases](https://github.com/tzurae/lingo-palette/releases)。
2. 下載 `lingo-palette-0.1.1-chrome.zip`。
3. 對照同一個 Release 內的 `SHA256SUMS` 驗證下載檔案。
4. 將 ZIP 解壓縮到固定資料夾，例如 `~/Applications/Lingo Palette Beta/`。
5. 在 Chrome 打開 `chrome://extensions`。
6. 開啟「開發人員模式」。
7. 選擇「載入未封裝項目」，並選取包含 `manifest.json` 的解壓縮資料夾。
8. 在擴充套件的 Options 頁設定 OpenAI API key、模型與每日 hard limits。
9. 到一般 `http://` 或 `https://` 英文網頁，點擊 Lingo Palette 圖示，選取英文並啟用該網站。

macOS／Linux：

```bash
shasum -a 256 lingo-palette-0.1.1-chrome.zip
```

Windows PowerShell：

```powershell
Get-FileHash .\lingo-palette-0.1.1-chrome.zip -Algorithm SHA256
```

輸出的 SHA-256 必須與 `SHA256SUMS` 內該 ZIP 的值一致。

Chrome 最低版本為 116。`chrome://` 頁面、Chrome Web Store、PDF、本機檔案與像素形式文字不屬於 Supported Reading Surfaces。

## 手動更新

1. 從 Releases 下載新版 ZIP。
2. 用新版內容完整取代原本的解壓縮資料夾。
3. 到 `chrome://extensions`，在 Lingo Palette 卡片按「重新載入」。
4. 重新整理正在閱讀的網頁。

GitHub Release 不會替 unpacked extension 自動更新。

## 跨電腦資料

資料目前保存在每個 Chrome Profile 的本機儲存空間：

- OpenAI API key 必須在每台電腦分別設定；它不會同步或進入 Portable backup。
- Learning Items、Lookup Records、Review history 與可攜偏好可以透過 Options 頁的 Portable backup 手動搬移。
- 目前沒有即時或雙向跨裝置同步。

## OpenAI 與隱私邊界

在 Enabled Site 完成 Selection 後，Lingo Palette 會先查詢本機快取。快取未命中時，Selection 與有限的相鄰 Reading Context 會傳送到使用者設定的 OpenAI Responses API，並使用該使用者的 provider budget。

API key 只保存在該 Chrome Profile 的 extension local storage，不會寫入網頁、repository、Release ZIP 或 Portable backup。Portable backup 未加密，可能包含 Selection、Reading Context、Learner Notes 與 Review history；請存放於受保護的位置。

## 開發

需求：

- Node.js 22.13 或更新版本
- pnpm 11.21.0，由 `packageManager` 欄位固定
- Chrome 116 或更新版本

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm zip
```

`pnpm test` 預設使用背景 Chromium。需要觀察瀏覽器時：

```bash
WXT_TEST_HEADED=true pnpm test
```

實際 unpacked Google Chrome smoke：

```bash
pnpm dev
```

## Release approval gate

Repository Settings 的 `release-draft` environment 必須要求 Product Owner reviewer approval。

Push `vX.Y.Z` tag 後，read-only `verify` job 會測試並上傳該 tag 的 ZIP 與 `SHA256SUMS`。Workflow 隨後停在 `release-draft` environment：

1. Product Owner 從該 workflow run 下載 `release-candidate-vX.Y.Z` artifact。
2. 驗證 SHA-256。
3. 使用新的 Chrome Profile 將 ZIP 解壓並載入實際 Google Chrome，完成核心 unpacked smoke。
4. 只有該 artifact 通過後，才批准 `release-draft` environment。

批准後，獨立的 write-scoped job 才會把同一份 artifact 建立為 Draft pre-release。它不會自動 Publish。

## 專案文件

- [Domain glossary](./CONTEXT.md)
- [First Release Contract](./docs/first-release.md)
- [Third-party notices](./public/THIRD_PARTY_NOTICES.txt)
- [Issue tracker](https://github.com/tzurae/lingo-palette/issues)

## License

Lingo Palette 使用 [Apache License 2.0](./LICENSE)。第三方元件與 Evidence Pack 來源另見 `public/THIRD_PARTY_NOTICES.txt`。
