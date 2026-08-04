# 銀髮一句通 SilverCare Macau

澳門長者 AI 慢病照護 Functional MVP —— 讓長者「一句」完成健康紀錄與照護互動。

> 本文件為骨架佔位，詳細內容（功能說明、架構、部署流程）後續補充。

## 快速開始

```powershell
npm install        # 安裝所有 workspace 依賴
npm run dev:all    # 同時啟動 server (8787) 與 web (5173)
```

## 倉庫結構

```
├── web/      # 前端：Vite + React 18 + TypeScript + Tailwind
├── server/   # 後端：Node ESM (Express + WS + SQLite)，埠 8787
└── .env.example
```

## 常用腳本（根目錄）

| 腳本 | 說明 |
| --- | --- |
| `npm run dev` | 啟動前端 dev server |
| `npm run dev:server` | 啟動後端 server |
| `npm run dev:all` | 前後端同時啟動 |
| `npm run build` | 構建前端 |
| `npm test` | 單元測試 (vitest) |
| `npm run test:e2e` | E2E 測試 (Playwright) |

<!-- TODO: 後續補充 —— 功能清單、系統架構圖、API 文件、部署說明 -->
