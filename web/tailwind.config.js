/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 狀態色 —— 與 CSS 變量 (src/styles/theme.css) 同源
        care: {
          idle: 'var(--sc-idle)', // #5BA3D0 主色／待命
          listening: 'var(--sc-listening)', // #1E3A8A 聆聽中
          thinking: 'var(--sc-thinking)', // #F59E0B 思考中
          ok: 'var(--sc-ok)', // #10B981 正常／完成
          urgent: 'var(--sc-urgent)', // #EF4444 緊急
          muted: 'var(--sc-muted)', // #9CA3AF 灰
        },
        ink: 'var(--sc-ink)',
        paper: 'var(--sc-paper)',
      },
      fontSize: {
        // 長者友善字級：內文 ≥ 24px、標題 ≥ 28px
        elder: ['var(--sc-font-body)', { lineHeight: '1.6' }],
        'elder-lg': ['var(--sc-font-body-lg)', { lineHeight: '1.55' }],
        'elder-title': ['var(--sc-font-title)', { lineHeight: '1.3', fontWeight: '700' }],
        'elder-display': ['var(--sc-font-display)', { lineHeight: '1.2', fontWeight: '800' }],
      },
      spacing: {
        tap: 'var(--sc-tap-target)', // 最小觸控目標
      },
      borderRadius: {
        card: 'var(--sc-radius-card)',
      },
    },
  },
  plugins: [],
}
