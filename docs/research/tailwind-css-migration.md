# Tailwind CSS 全面重構研究

**Research cutoff:** 2026-08-18
**Scope:** WXT + React 瀏覽器擴充套件 `lingo-palette` 的 Tailwind CSS 官方導入路徑。本文只做研究；不安裝套件、不改產品碼或建置設定。

## 結論

- **推薦 Tailwind CSS v4.3 的 CSS-first 路徑，不建立 `tailwind.config.js`。** 未來只需 dev dependencies `tailwindcss`、`@tailwindcss/vite`，在 `wxt.config.ts` 的頂層 `vite` callback 加 `tailwindcss()`，再由各 surface CSS import Tailwind。Tailwind 官方推薦 Vite 專用 plugin；WXT 官方提供 `vite: () => ({ plugins: [...] })` extension point。[[Tailwind Vite installation](https://tailwindcss.com/docs/installation/using-vite); [WXT Vite config](https://wxt.dev/guide/essentials/config/vite.html#add-vite-plugins)]
- **三份 stylesheet 各用 `source(none)` + 精確 `@source`。** 否則每個 CSS root 可能掃完整 repo，使三份輸出重複包含另外兩個 surface 的 utilities。[[Tailwind source detection](https://tailwindcss.com/docs/detecting-classes-in-source-files#disabling-automatic-detection)]
- **Selection Surface 必須將 `?raw` 改為 `?inline`。** Vite 的 `?inline` 回傳「經處理、但不自動注入」的 CSS 字串；Tailwind Vite plugin 原始碼明確排除 `raw` query，保留 `?raw` 會繞過 Tailwind transform。[[Vite `?inline`](https://vite.dev/guide/features.html#disabling-css-injection-into-the-page); [Tailwind Vite plugin source](https://github.com/tailwindlabs/tailwindcss/blob/main/packages/%40tailwindcss-vite/src/index.ts)]
- **遷移順序：infrastructure/tokens → Options → Side Panel → Selection Surface。** 每個 surface 原子切換、驗證、可單獨回滾；不做一次性 919 行大爆改。
- **全量重構不等於零 CSS。** `@theme` 只放 design tokens；一次性 layout 用 utilities；vanilla DOM 可用少量 `@layer components` 表達重複的單一元素 recipe；Shadow 邊界、runtime geometry、keyframes、forced-colors、複雜 selector/文字描邊保留 CSS/inline styles。[[Tailwind managing duplication](https://tailwindcss.com/docs/styling-with-utility-classes#managing-duplication)]

## 現況盤點

| Surface | 框架與載入方式 | 邊界 | CSS |
|---|---|---|---:|
| `entrypoints/options` | Vanilla HTML + TypeScript DOM；`main.ts` import `./style.css` | 完整 extension page | 219 行 |
| `entrypoints/sidepanel` | Vanilla HTML + TypeScript DOM；HTML `<link>` 載入 `style.css` | 完整 extension side panel；大量 DOM runtime 建立 | 390 行 |
| `src/modules/reading-flow/selection-surface` | React 19 + Zustand + Floating UI；CSS 目前以 `?raw` 取字串 | `reading-flow.js` 是動態注入的 unlisted script；程式手刻 open Shadow Root | 310 行 |

共 **919 行 CSS**、約 **90 個 HTML/JSX/DOM class 寫入點**。Options/Side Panel 不是 React；只有 Selection Surface 是 React。

WXT 以 `entrypoints/` 內 HTML/JS/CSS 作 Vite inputs；Vite 會處理 HTML `<link>`/module script 與 JS CSS import，因此 Options/Side Panel 的現有載入 seam 都可直接交給 Tailwind Vite plugin。[[WXT entrypoints](https://wxt.dev/guide/essentials/entrypoints.html); [Vite HTML/CSS](https://vite.dev/guide/features.html#html)]

Selection Surface 的特殊責任：

- host 的 fixed position、最高 z-index、viewport max width、pointer-events，以及 Floating UI 寫入的 `left/top/visibility` 是 runtime inline styles，應保留。
- 現有 CSS 包含 `:host`、data/ARIA selectors、reduced-motion、forced-colors、keyframes、`color-mix()`、`-webkit-text-stroke`、`paint-order`、SVG filter。
- `.close`、`.quick-hint`、`.pronunciation-variety`、`.deep-dive` 也是 focus query hooks，不可當純 style class 直接刪除；若改 refs/data hooks，必須同一變更遷移 callers/tests。

目前 Chrome 最低版本是 116，高於 Tailwind v4 核心 Chrome 111 基線；若未來發佈 Firefox，Tailwind v4 基線是 Firefox 128。[[Tailwind compatibility](https://tailwindcss.com/docs/compatibility#browser-support)]

## 推薦設定

### 套件與 WXT

未來實作：

```bash
pnpm add -D tailwindcss@^4.3.0 @tailwindcss/vite@^4.3.0
```

不需另加 PostCSS、`postcss-import` 或 Autoprefixer；v4 已處理 imports/vendor prefixing。[[Tailwind v4 Vite upgrade](https://tailwindcss.com/docs/upgrade-guide#using-vite)]

```ts
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({ plugins: [tailwindcss()] }),
  react: { vite: { jsxRuntime: 'classic' } },
  // 現有 manifest 原樣保留
});
```

不要另建平行 `vite.config.ts`。[[WXT add Vite plugins](https://wxt.dev/guide/essentials/config/vite.html#add-vite-plugins)]

### CSS-first design tokens

建立單一 `src/styles/theme.css`。`@theme` 同時產生 utility API 與 CSS variables，所以只放跨 surface 的語意 tokens，不放 button/card recipe。[[Tailwind theme variables](https://tailwindcss.com/docs/theme#what-are-theme-variables)]

Selection 在宿主頁 Shadow Root，`rem` 仍依宿主 `<html>` font-size。為保持目前像素幾何，shared spacing/type/radius/container 用 px：

```css
@theme {
  --spacing: 4px;
  --color-canvas: #f8fafc;
  --color-surface: #fff;
  --color-ink: #172033;
  --color-ink-muted: #475569;
  --color-border: #cbd5e1;
  --color-border-strong: #64748b;
  --color-brand: #1d4ed8;
  --color-brand-soft: #eff6ff;
  --color-danger: #991b1b;
  --color-warning: #b45309;
  --color-focus: #f59e0b;

  --font-sans: Inter, ui-sans-serif, system-ui, -apple-system,
    BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-mono: ui-monospace, "Cascadia Code", monospace;
  --text-ui: 15px;
  --text-ui--line-height: 1.55;
  --text-selection: 14px;
  --text-selection--line-height: 1.45;
  --text-caption: 12px;
  --text-caption--line-height: 1.15;
  --font-weight-label: 650;

  --radius-control: 7px;
  --radius-card: 10px;
  --radius-panel: 12px;
  --shadow-floating: 0 8px 28px rgb(15 23 42 / 24%);
  --container-settings: 720px;
  --container-selection: 320px;
}
```

上述 namespaces 是 v4 官方 `@theme` utility namespaces。只有 retained CSS/runtime JS 必須無條件讀取全部 tokens 時才考慮 `@theme static`。[[Theme namespaces](https://tailwindcss.com/docs/theme#theme-variable-namespaces); [static theme variables](https://tailwindcss.com/docs/theme#generating-all-css-variables)]

### 每個 surface 的 source scoping

```css
/* entrypoints/options/style.css */
@import "tailwindcss" source(none);
@import "../../src/styles/theme.css";
@source "./index.html";
@source "./main.ts";
```

```css
/* entrypoints/sidepanel/style.css */
@import "tailwindcss" source(none);
@import "../../src/styles/theme.css";
@source "./index.html";
@source "./main.ts";
```

```css
/* selection-surface.css */
@import "tailwindcss" source(none);
@import "../../../styles/theme.css";
@source "./selection-surface.tsx";
```

```tsx
import surfaceStyles from './selection-surface.css?inline';

<style>{surfaceStyles}</style>
```

Tailwind 把 source 當純文字掃描，不理解字串插值；不要寫 `bg-${tone}-500`，要把 state 映射到完整 literals。正常不需 safelist；極少數無法靜態表達的 class 才用 `@source inline()`。[[Dynamic classes](https://tailwindcss.com/docs/detecting-classes-in-source-files#dynamic-class-names); [safelist](https://tailwindcss.com/docs/detecting-classes-in-source-files#safelisting-specific-utilities)]

不要把每個重複 class string 抽成 TS 常數：迴圈內 class 本來只 authored 一次。真正 runtime state 可用完整 class map；Options/Side Panel 跨 render path 重複的單一 button/card recipe，可少量放 `@layer components`。[[Tailwind loops/custom CSS](https://tailwindcss.com/docs/styling-with-utility-classes#using-loops)]

### Preflight

完整 `@import "tailwindcss"` 會加入 Preflight：清除 margins/padding、unstyled headings/lists、reset borders，並以 `display:none !important` 維持 `[hidden]`。半完成 surface 直接啟用會造成大範圍外觀改變。[[Tailwind Preflight](https://tailwindcss.com/docs/preflight)]

共存期先只 import theme + utilities、略過 Preflight：

```css
@layer theme, base, components, utilities;
@import "tailwindcss/theme.css" layer(theme);
@import "../../src/styles/theme.css";
@import "tailwindcss/utilities.css" layer(utilities) source(none);
```

等該 surface 的 headings/lists/forms/buttons/SVG defaults 都明確 styled，才切回完整 import。Tailwind 官方允許個別 import 並省略 `preflight.css`。[[Disabling Preflight](https://tailwindcss.com/docs/preflight#disabling-preflight)]

## Shadow DOM、prefix、important、dark mode

WXT 官方 Shadow UI 路徑是 content script import CSS、`cssInjectionMode: 'ui'`、`createShadowRootUi`。本 repo 已有動態 unlisted script + 手刻 Shadow Root；只為 Tailwind 改 abstraction 沒必要，`?inline` 是較小 seam。[[WXT Shadow Root UI](https://wxt.dev/guide/essentials/content-scripts.html#shadow-root)]

WXT helper 預設 `all: initial`，但 `rem`、外部 CSS variables、外部 `@font-face` 仍可穿透。手刻 Shadow Root更不會自動得到該 reset，所以必測 hostile page CSS/root font-size/custom properties。[[WXT Shadow options](https://wxt.dev/api/reference/wxt/utils/content-script-ui/shadow-root/type-aliases/ShadowRootContentScriptUiOptions.html#inheritstyles)]

Tailwind v4.3 compiler 會把 theme variables 產生在 `:root, :host`，因此經編譯 CSS 注入 Shadow Root可命中 host。[[Tailwind compiler source](https://github.com/tailwindlabs/tailwindcss/blob/main/packages/tailwindcss/src/index.ts)]

**Implementation discovery:** WXT 0.21.3 builds the unlisted `reading-flow.js` through a path where Vite 8.2.1 can run `vite:css-post` for a `?inline` import before `vite:css` initializes `cssModulesCache`. The repository therefore carries `patches/vite@8.2.1.patch`, changing that lookup to `cssModulesCache.get(config)?.get(id)`. The patch preserves the required processed inline CSS and should be removed once the WXT/Vite path no longer reproduces this build failure.

**預設不加 prefix、不開 global important：** extension pages不與網站共用 namespace；Selection descendants已在 Shadow Root。只有實測 conflict 才用 `@import "tailwindcss" prefix(lp)`；global `important` 會妨礙 forced-colors/focus/retained CSS cascade。[[Prefix/important](https://tailwindcss.com/docs/styling-with-utility-classes#managing-style-conflicts)]

目前產品是 light-only，第一輪維持既有 `color-scheme`，不順便加 `dark:`。日後 OS dark可用預設 media；手動 dark用 `@custom-variant`，但 Shadow host需另做 attribute propagation。[[Tailwind dark mode](https://tailwindcss.com/docs/dark-mode)]

## `tailwind.config` 要怎麼設定？

### v4 推薦答案

**不需要 config。**

| 舊概念 | v4 CSS-first 位置 |
|---|---|
| `content` | `source(none)` + `@source` |
| `theme.extend.*` | shared semantic `@theme` |
| `darkMode` | 預設 media或 `@custom-variant dark` |
| `prefix` | import `prefix(lp)` |
| `important` | import `important`；單一 utility尾綴 `!` |
| `safelist` | `@source inline()` |
| custom base/components | `@layer base/components`；複雜 utility用 `@utility` |

`@theme` 不是一般 `:root`：它會決定 utility API；不需 utility 的 runtime variables放普通 `:root`/`:host`。[[Why `@theme`](https://tailwindcss.com/docs/theme#why-theme-instead-of-root)]

### JavaScript config 相容方案（非推薦）

v4 仍支援 JavaScript config，但不自動偵測，CSS 要 `@config`。此 repo 是 ESM，`.js` 用 `export default`。官方文件明確保證 JavaScript config，不應無必要假定 `.ts` 在所有 WXT/Tailwind loader 組合相容。[[JS config compatibility](https://tailwindcss.com/docs/upgrade-guide#using-a-javascript-config-file)]

```js
// tailwind.config.js — compatibility alternative
export default {
  content: ['./entrypoints/**/*.{html,ts}', './src/**/*.tsx'],
  darkMode: 'media',
  theme: {
    extend: {
      colors: { canvas: '#f8fafc', ink: '#172033', brand: '#1d4ed8' },
      fontWeight: { label: '650' },
      borderRadius: { control: '7px', card: '10px' },
      boxShadow: { floating: '0 8px 28px rgb(15 23 42 / 24%)' },
    },
  },
};
```

```css
@import "tailwindcss";
@config "../../tailwind.config.js";
```

`corePlugins`、`safelist`、`separator` 在 v4 JS config不支援；不要同時在 JS `theme.extend` 與 CSS `@theme` 維護同一 tokens。單一大 `content` 也容易使三個 CSS roots重複輸出，這正是本 repo 優先 CSS-first/local `@source` 的理由。[[Unsupported options](https://tailwindcss.com/docs/upgrade-guide#using-a-javascript-config-file)]

## 分階段、可回滾遷移

### Phase 0：基準證據

保存三面代表 states 的 screenshot/computed styles/keyboard流程：Options forms/disclosure/errors；Side Panel 四 tabs與 dynamic states；Selection peek/expanded/pronunciation/error/viewport edges/hostile page。基準只用來維持現況，不順便 redesign。

### Phase 1：Infrastructure/tokens

1. 加兩個 dev dependencies與 WXT plugin。
2. 加 shared `theme.css`。
3. 三份 root加 local sources，先無 Preflight。
4. Selection改 `?inline`，確認 Shadow `<style>` 是 compiled CSS。

尚未改 markup，整階段可直接 revert。

### Phase 2：Options

先 page/sections/forms，再 controls/focus/hidden/error。一次性 layout用 utilities；重複單一元素recipe才用 component layer。所有 UA defaults明確後開 Preflight，刪除被取代 CSS。Options三檔獨立 commit/revert。

### Phase 3：Side Panel

先 shell/tabs，再按 Current → Recent → Saved → Review逐 render path遷移 loading/empty/success/error/action。Generated DOM用完整 class literals；保留 IDs/ARIA/tab keyboard/focus restoration。最後開 Preflight並刪 legacy CSS。獨立 commit/revert。

### Phase 4：Selection Surface

最後處理最高風險面：先 expanded，再 pronunciation/result/status，再 peek。保留 runtime positioning、line-height reservation、Shadow/special CSS及 focus hooks。驗證 hostile host、forced-colors/reduced-motion後才決定完整 Preflight。獨立 commit/revert。

### Phase 5：收斂

刪重複 tokens、過渡 selectors、未用 safelist；只有真正局部/演算法 raw value可留。檢查三份輸出沒有互相包含 utilities，component layer也沒有重建另一套 utility framework。

## 應保留的少量 CSS

- `:host`/Shadow reset/inheritance。
- Floating UI與 DOM measurement的 runtime inline position/visibility/z-index/line-height。
- reduced-motion keyframes、forced-colors多 selector override。
- text stroke/paint order/複合 shadow/filter與 annotation data selectors。
- 必要 a11y helper、`:has()` focus bridge、auto-fit/minmax等複合 selector。
- vanilla surfaces少數重複單一元素 recipe。

保留 CSS 應引用 theme variables，不再複製 palette magic numbers。[[Theme variables in custom CSS](https://tailwindcss.com/docs/theme#with-custom-css)]

## 驗證清單

### Build/source detection

- [ ] 只有 `@tailwindcss/vite`，無平行 PostCSS pipeline。
- [ ] 三份 CSS各自編譯；輸出無原樣 Tailwind at-rules。
- [ ] Selection `surfaceStyles` 是 processed CSS，Shadow `<style>` 有實際 utilities。
- [ ] 每份 output只含自身 candidates；conditional classes都是完整 literals或精確 `@source inline`。

### Visual/state

- [ ] Options 720px/窄 viewport與所有 forms/hidden/error states。
- [ ] Side Panel 280px/常見寬度、四 tabs及所有 dynamic render branches。
- [ ] Selection viewport四邊、長內容、scroll/resize/reposition、全部 state。
- [ ] `hidden` attribute與 display utilities無衝突；ARIA/data variants、pointer-events、z-index不變。

### Shadow/a11y/platform

- [ ] Host `<html>` 10/16/32px font-size、hostile selectors/custom properties下 Selection仍正確。
- [ ] 200%/400% zoom、keyboard focus、focus restoration、live regions正常。
- [ ] forced-colors下 borders/tabs/buttons/annotation/focus可見。
- [ ] reduced-motion下無非必要 animation。
- [ ] light-only `color-scheme`維持現況，未意外引入 dark behavior。

## 最終建議檔案

```text
package.json                                  # + two dev dependencies
wxt.config.ts                                # + top-level vite plugin
src/styles/theme.css                         # semantic @theme tokens
entrypoints/options/{index.html,main.ts,style.css}
entrypoints/sidepanel/{index.html,main.ts,style.css}
src/modules/reading-flow/selection-surface/
  selection-surface.css                      # Tailwind root + retained Shadow CSS
  selection-surface.tsx                      # ?inline + JSX utilities
```

**推薦起點：** v4.3 Vite plugin + shared px-based `@theme` + 三份 `source(none)`/`@source` + Selection `?inline`；不建 config、不先開 prefix/important、不附帶 dark redesign，依 Options → Side Panel → Selection 原子遷移。
