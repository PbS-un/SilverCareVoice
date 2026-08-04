# THIRD_PARTY.md — 第三方依賴清單

銀髮一句通 SilverCare Macau 所使用的全部第三方依賴。
License 欄位以本機 `node_modules/<pkg>/package.json` 的 `license` 欄位實際核對（2026-08-05），
版本為 `package-lock.json` 實際安裝版本。

## 一、前端 Runtime 依賴（web/package.json `dependencies`）

| Name | Repository URL | License | Purpose |
| --- | --- | --- | --- |
| react | https://github.com/facebook/react | MIT | UI 框架（React 18） |
| react-dom | https://github.com/facebook/react | MIT | React DOM 渲染 |
| react-router-dom | https://github.com/remix-run/react-router | MIT | HashRouter 路由（GitHub Pages 友好） |
| dexie | https://github.com/dexie/Dexie.js | Apache-2.0 | IndexedDB 封裝（本地優先資料庫） |
| fuse.js | https://github.com/krisk/Fuse | Apache-2.0 | 知識庫模糊搜尋 |
| recharts | https://github.com/recharts/recharts | MIT | 血壓／血糖／趨勢圖表 |
| lucide-react | https://github.com/lucide-icons/lucide | ISC | 圖示 |
| zod | https://github.com/colinhacks/zod | MIT | AI 結構化輸出 schema 校驗（前後端共用） |

## 二、後端 Runtime 依賴（server/package.json `dependencies`）

| Name | Repository URL | License | Purpose |
| --- | --- | --- | --- |
| express | https://github.com/expressjs/express | MIT | HTTP 框架（AI proxy + sync API，埠 8787） |
| ws | https://github.com/websockets/ws | MIT | WebSocket（雙裝置即時同步廣播） |
| better-sqlite3 | https://github.com/WiseLibs/better-sqlite3 | MIT | SQLite（同步中繼資料庫） |
| dotenv | https://github.com/motdotla/dotenv | BSD-2-Clause | 讀取 server/.env（DEEPSEEK_API_KEY 只存後端） |
| zod | https://github.com/colinhacks/zod | MIT | 同步 payload / AI 輸出校驗 |

## 三、交付產物腳本依賴（根 package.json `devDependencies`，T11 新增）

| Name | Repository URL | License | Purpose |
| --- | --- | --- | --- |
| qrcode | https://github.com/soldair/node-qrcode | MIT | scripts/generate-pdf.mjs 生成 Prototype URL QR Code |
| pdf-lib | https://github.com/Hopding/pdf-lib | MIT | scripts/generate-pdf.mjs 校驗 PDF 頁數 ≤ 5 |
| concurrently | https://github.com/open-cli-tools/concurrently | MIT | `npm run dev:all` 同時啟動前後端 |

## 四、構建／測試工具（web/package.json `devDependencies`）

| Name | Repository URL | License | Purpose |
| --- | --- | --- | --- |
| vite | https://github.com/vitejs/vite | MIT | 前端構建與 dev/preview server |
| @vitejs/plugin-react | https://github.com/vitejs/vite-plugin-react | MIT | Vite React 支援 |
| typescript | https://github.com/microsoft/TypeScript | Apache-2.0 | 型別檢查（build 前 tsc --noEmit） |
| tailwindcss | https://github.com/tailwindlabs/tailwindcss | MIT | 原子化 CSS |
| postcss | https://github.com/postcss/postcss | MIT | CSS 處理管線 |
| autoprefixer | https://github.com/postcss/autoprefixer | MIT | CSS vendor prefix |
| vitest | https://github.com/vitest-dev/vitest | MIT | 單元測試（359 cases） |
| @testing-library/react | https://github.com/testing-library/react-testing-library | MIT | React 元件測試工具 |
| @testing-library/jest-dom | https://github.com/testing-library/jest-dom | MIT | DOM assertion 擴充 |
| jsdom | https://github.com/jsdom/jsdom | MIT | vitest 瀏覽器環境模擬 |
| fake-indexeddb | https://github.com/dumbmatter/fakeIndexedDB | Apache-2.0 | 測試用 IndexedDB 模擬 |
| @playwright/test | https://github.com/microsoft/playwright | Apache-2.0 | E2E 測試＋T11 PDF/影片產製（chromium） |

## 五、字體說明

本專案**不內嵌任何網路字型**。CSS font stack 依序嘗試：

- 內文：`'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', system-ui, sans-serif`
- 標題：`'Noto Serif TC', 'Songti TC', 'PMingLiU', serif`

即優先使用使用者作業系統已安裝之字型（Windows 為 Microsoft JhengHei、macOS 為 PingFang TC）。
若系統安裝 Noto Sans TC / Noto Serif TC，其字型授權為 SIL Open Font License 1.1（由使用者自行安裝，本專案不分發）。

## 六、授權相容性小结

全部依賴均為 MIT / Apache-2.0 / BSD-2-Clause / ISC 等寬鬆授權，無 Copyleft（GPL）元件；
作為示範原型使用與發布（含 GitHub Pages 靜態託管）不構成授權冲突。
