/**
 * 佔位根元件 —— 路由與各頁面於後續任務建立。
 * 目前僅呈現品牌載入畫面（呼吸圓點 + 大字提示）。
 */
export default function App() {
  return (
    <main
      data-testid="app-root"
      className="flex min-h-screen flex-col items-center justify-center gap-8 bg-paper px-6 text-center"
    >
      <span
        aria-hidden
        className="animate-breathe block h-16 w-16 rounded-full bg-care-idle shadow-lg"
      />
      <h1 className="text-elder-title text-ink">銀髮一句通</h1>
      <p className="text-elder-body" style={{ color: 'var(--sc-ink-soft)' }} role="status">
        載入中……
      </p>
    </main>
  )
}
