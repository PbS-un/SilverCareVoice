/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Supabase Edge Function 完整 base URL
   * （形如 https://<ref>.functions.supabase.co/silvercare）。
   * 未設置（空）→ 本地模式：所有後端調用沿用相對路徑（dev proxy → localhost:8787）。
   */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon public key（公開層級，非機密；雲端請求 apikey／Realtime 用）。 */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** 選填：Supabase 項目根 URL（Realtime 連線用）；缺省時自動從 VITE_SUPABASE_URL 推導。 */
  readonly VITE_SUPABASE_PROJECT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
