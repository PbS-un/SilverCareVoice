import '@testing-library/jest-dom/vitest';

/**
 * 測試隔離：固化 VITE_SUPABASE_URL 為空，強制單元測試走本地模式。
 * 原因：Vitest 會像 dev 般載入開發者 web/.env——若本地 .env 設了真實
 * VITE_SUPABASE_URL，測試會意外進入雲端模式（URL 構造器回傳絕對位址）
 * 而污染斷言。Vitest 的 import.meta.env 是 runtime 可變物件，setup 檔先於
 * 所有測試模組載入執行 → backend.ts 模組頂層讀到的必為空字串。
 */
const vitestEnv = (import.meta as { env?: Record<string, string | undefined> }).env;
if (vitestEnv) vitestEnv.VITE_SUPABASE_URL = '';
