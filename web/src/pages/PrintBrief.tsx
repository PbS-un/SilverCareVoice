/**
 * 項目簡報打印頁（路由 '/print-brief'，T11 交付物）：
 * A4 × 5 頁編輯部風格簡報，由 scripts/generate-pdf.mjs 透過 Playwright
 * page.pdf() 輸出為 deliverables/銀髮一句通_項目簡報.pdf。
 *
 * 分頁：每頁固定 210mm × 296mm + break-after: page。
 * 內容結構（T1.4 更新）：
 *  P1 價值主張（一句即用／家庭閉環／多語澳門）
 *  P2 三項核心創新（一句話健康互動＋自動朗讀、家庭照護閉環、澳門四語言）
 *  P3 技術棧與架構（三種模式 + Local-first + Cloud-ready）
 *  P4 競品類別比較
 *  P5 未來願景（NOW / NEXT / FUTURE）+ 正式 URL + QR
 * 截圖：scripts/generate-pdf.mjs 會把真實 UI 截圖複製到 dist/brief/，
 *       本頁以相對路徑 brief/*.png 引用（載入失敗時顯示佔位框）。
 * QR／URL：經 hash query 傳入（#/print-brief?url=...&qr=data:...）；
 *       未提供時以「待發布」佔位呈現，絕不捏造 URL。
 */
import type { CSSProperties } from 'react';
import { useSearchParams } from 'react-router-dom';

const PAGE_STYLE = `
  @page { size: A4; margin: 0; }
  .brief-page {
    width: 210mm;
    height: 296mm;
    overflow: hidden;
    position: relative;
    page-break-after: always;
    break-after: page;
    background: #fbfaf7;
    color: #1f2937;
    font-family: 'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', system-ui, sans-serif;
  }
  .brief-page:last-child { page-break-after: auto; break-after: auto; }
  .brief-serif { font-family: 'Noto Serif TC', 'Songti TC', 'PMingLiU', serif; }
  .brief-rule { border-top: 2px solid #1f2937; }
  .brief-kicker {
    font-size: 9pt; letter-spacing: 0.35em; font-weight: 700;
    color: #3e7ea6; text-transform: uppercase;
  }
  .brief-flow-arrow { color: #5ba3d0; font-weight: 900; }
  .brief-img-frame {
    border: 1.5px solid #1f2937; border-radius: 6px; overflow: hidden;
    background: #fff; box-shadow: 4px 4px 0 rgba(31,41,55,0.12);
  }
  .brief-img-fallback {
    display: flex; align-items: center; justify-content: center;
    width: 100%; height: 100%; min-height: 60mm;
    color: #9ca3af; font-size: 10pt; border: 1.5px dashed #c9c3b6;
    border-radius: 6px; background: #fff;
  }
`;

function Shot({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="brief-img-frame">
      <img
        src={src}
        alt={alt}
        style={{ display: 'block', width: '100%', height: 'auto', objectFit: 'cover' }}
        onError={(e) => {
          const el = e.currentTarget;
          const box = document.createElement('div');
          box.className = 'brief-img-fallback';
          box.textContent = '真實 UI 截圖（執行 scripts/generate-pdf.mjs 自動生成）';
          el.replaceWith(box);
        }}
      />
    </div>
  );
}

function PageFooter({ pageNo, total = 5 }: { pageNo: number; total?: number }) {
  return (
    <footer
      className="brief-rule"
      style={{
        position: 'absolute', left: '14mm', right: '14mm', bottom: '9mm',
        paddingTop: '2.5mm', display: 'flex', justifyContent: 'space-between',
        fontSize: '8pt', color: '#4b5563', letterSpacing: '0.08em',
      }}
    >
      <span>銀髮一句通 SilverCare Macau — 灣區 AI 未來青年創造營</span>
      <span className="brief-serif" style={{ fontWeight: 700 }}>
        {String(pageNo).padStart(2, '0')} / {String(total).padStart(2, '0')}
      </span>
    </footer>
  );
}

function PageHead({ no, title, sub }: { no: string; title: string; sub?: string }) {
  return (
    <header style={{ marginBottom: '6mm' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '4mm' }}>
        <span className="brief-serif" style={{ fontSize: '26pt', fontWeight: 900, color: '#5ba3d0', lineHeight: 1 }}>
          {no}
        </span>
        <div>
          <h2 className="brief-serif" style={{ fontSize: '17pt', fontWeight: 900, margin: 0, lineHeight: 1.25 }}>
            {title}
          </h2>
          {sub && <p style={{ margin: '1mm 0 0', fontSize: '9pt', color: '#4b5563' }}>{sub}</p>}
        </div>
      </div>
      <div className="brief-rule" style={{ marginTop: '3mm', borderTopWidth: '1.5px' }} />
    </header>
  );
}

const PAD: CSSProperties = { padding: '14mm 14mm 20mm' };

export default function PrintBrief() {
  const [params] = useSearchParams();
  const publishedUrl = params.get('url') || '';
  const qrDataUrl = params.get('qr') || '';
  const hasUrl = Boolean(publishedUrl && publishedUrl.startsWith('http'));

  const loopNode: CSSProperties = {
    background: '#e8f2f9', border: '1px solid #5ba3d0', borderRadius: '999px',
    padding: '1.5mm 3.5mm', fontSize: '9pt', fontWeight: 700, color: '#1f2937', whiteSpace: 'nowrap',
  };

  return (
    <main data-testid="print-brief" style={{ background: '#d9d4c8' }}>
      <style>{PAGE_STYLE}</style>

      {/* ==================== P1 價值主張 ==================== */}
      <section className="brief-page" style={PAD} data-testid="brief-page-1">
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9pt', letterSpacing: '0.3em', color: '#4b5563', fontWeight: 700 }}>
          <span>SILVERCARE MACAU</span>
          <span>項目簡報 · PROJECT BRIEF</span>
        </div>
        <div className="brief-rule" style={{ marginTop: '2.5mm', borderTopWidth: '2.5px' }} />

        <div style={{ marginTop: '28mm' }}>
          <p className="brief-kicker" style={{ margin: 0 }}>灣區 AI 未來青年創造營 · 交付簡報</p>
          <h1 className="brief-serif" style={{ fontSize: '50pt', fontWeight: 900, margin: '6mm 0 3mm', lineHeight: 1.12, letterSpacing: '0.04em' }}>
            銀髮一句通
          </h1>
          <p style={{ fontSize: '13pt', fontWeight: 700, color: '#3e7ea6', margin: 0 }}>
            SilverCare Macau — 澳門長者 AI 慢病照護與家庭守護平台
          </p>
        </div>

        <div
          className="brief-serif"
          style={{
            margin: '14mm 0 0', padding: '8mm 9mm', background: '#fff',
            borderLeft: '4mm solid #5ba3d0', boxShadow: '5px 5px 0 rgba(31,41,55,0.10)',
            fontSize: '15.5pt', fontWeight: 700, lineHeight: 1.8,
          }}
        >
          讓長者只說一句，<br />讓家人少一份擔心，<br />讓健康多一份連續紀錄。
        </div>

        <div style={{ display: 'flex', gap: '5mm', marginTop: '14mm' }}>
          {[
            ['一句即用', '語音／文字一句完成健康互動，AI 回答後自動朗讀'],
            ['家庭閉環', '異常 → 提醒 → 跟進 → 回流，照護不中斷'],
            ['多語澳門', '繁中／简中／Português／English，語音語音輸出跟隨語言'],
          ].map(([t, d]) => (
            <div key={t} style={{ flex: 1, background: '#fff', border: '1.5px solid #1f2937', borderRadius: '6px', padding: '5mm', boxShadow: '3px 3px 0 rgba(31,41,55,0.10)' }}>
              <p className="brief-serif" style={{ margin: '0 0 2mm', fontSize: '12.5pt', fontWeight: 900, color: '#3e7ea6' }}>{t}</p>
              <p style={{ margin: 0, fontSize: '9pt', lineHeight: 1.6, color: '#4b5563' }}>{d}</p>
            </div>
          ))}
        </div>

        <div style={{ position: 'absolute', left: '14mm', right: '14mm', bottom: '20mm', display: 'flex', justifyContent: 'space-between', fontSize: '9pt', color: '#9ca3af' }}>
          <span>Functional Prototype · Demo Login（tester/tester）· 四語言 · 自動語音回應</span>
          <span>2026</span>
        </div>
        <PageFooter pageNo={1} />
      </section>

      {/* ==================== P2 三項核心創新 ==================== */}
      <section className="brief-page" style={PAD} data-testid="brief-page-2">
        <PageHead no="01" title="三項核心創新" sub="語音、AI、健康紀錄與家庭跟進整合成一條長者可以真正使用的流程" />

        {/* Innovation 1 */}
        <div style={{ background: '#fff', border: '1.5px solid #1f2937', borderRadius: '6px', padding: '4mm 5mm', marginBottom: '4mm' }}>
          <p className="brief-serif" style={{ margin: '0 0 2.5mm', fontSize: '13pt', fontWeight: 900, color: '#3e7ea6' }}>
            01 · 一句話完成健康互動
          </p>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '1.5mm', marginBottom: '2.5mm' }}>
            {['Speak once', 'Understand', 'Record', 'Assess', 'Respond'].map((n, i) => (
              <span key={n} style={{ display: 'inline-flex', alignItems: 'center', gap: '1.5mm' }}>
                <span style={loopNode}>{n}</span>
                {i < 4 && <span className="brief-flow-arrow" style={{ fontSize: '10pt' }}>→</span>}
              </span>
            ))}
          </div>
          <p style={{ margin: 0, fontSize: '9.5pt', lineHeight: 1.65, color: '#4b5563' }}>
            長者不需要學習複雜介面：說一句／輸入一句，系統即完成意圖識別、健康抽取、結構化記錄、風險評估與
            AI 回覆；<b>回答完成後自動朗讀一次</b>（TTS 跟隨語言，zh-HK／zh-CN／pt-PT／en-US）。對長者而言，
            更像與人說話，而不是操作健康資訊系統。
          </p>
        </div>

        {/* Innovation 2 */}
        <div style={{ background: '#fff', border: '1.5px solid #1f2937', borderRadius: '6px', padding: '4mm 5mm', marginBottom: '4mm' }}>
          <p className="brief-serif" style={{ margin: '0 0 2.5mm', fontSize: '13pt', fontWeight: 900, color: '#3e7ea6' }}>
            02 · 家庭照護閉環
          </p>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '1.5mm', marginBottom: '2.5mm' }}>
            {['Elder', 'AI', 'Health Event', 'Risk Assessment', 'Family Alert', 'Family Follow-up', 'Elder Feedback', 'Continuous Record'].map((n, i) => (
              <span key={n} style={{ display: 'inline-flex', alignItems: 'center', gap: '1.5mm' }}>
                <span style={loopNode}>{n}</span>
                {i < 7 && <span className="brief-flow-arrow" style={{ fontSize: '9pt' }}>→</span>}
              </span>
            ))}
            <span className="brief-flow-arrow" style={{ fontSize: '10pt', marginLeft: '1mm' }}>↺</span>
          </div>
          <p style={{ margin: 0, fontSize: '9.5pt', lineHeight: 1.65, color: '#4b5563' }}>
            不是 Chatbot 問完就結束：重要對話轉化為健康事件與家屬提醒，家屬「已跟進」回流成長期紀錄。
            我們不是讓 AI 只回答長者，而是讓重要對話有機會轉化為真正的家庭照護行動。
          </p>
        </div>

        {/* Innovation 3 + 截圖 */}
        <div style={{ display: 'flex', gap: '5mm', alignItems: 'stretch' }}>
          <div style={{ flex: 5, background: '#fff', border: '1.5px solid #1f2937', borderRadius: '6px', padding: '4mm 5mm' }}>
            <p className="brief-serif" style={{ margin: '0 0 2.5mm', fontSize: '13pt', fontWeight: 900, color: '#3e7ea6' }}>
              03 · 澳門四語言場景
            </p>
            <ul style={{ margin: 0, paddingLeft: '4.5mm', fontSize: '9.5pt', lineHeight: 1.8, color: '#4b5563' }}>
              <li>四種語言：繁體中文／简体中文／Português／English</li>
              <li>語音輸入（ASR）與語音輸出（TTS）跟隨所選語言</li>
              <li>AI 回覆按所選語言生成（DeepSeek prompt + Local Hybrid 本地化）</li>
              <li>Local-first + Cloud-ready，同一套前端三種模式運行</li>
            </ul>
            <p style={{ margin: '2mm 0 0', fontSize: '9.5pt', lineHeight: 1.6, fontStyle: 'italic', color: '#3e7ea6' }}>
              不同語言習慣的長者，都能用自己最自然的方式進入同一套照護系統。
            </p>
          </div>
          <div style={{ flex: 5, display: 'flex', flexDirection: 'column', gap: '3mm' }}>
            <Shot src="brief/elder-answer.png" alt="老人端回答氣泡實機截圖" />
            <Shot src="brief/family-alerts.png" alt="家屬提醒列表實機截圖" />
          </div>
        </div>
        <PageFooter pageNo={2} />
      </section>

      {/* ==================== P3 技術棧與架構 ==================== */}
      <section className="brief-page" style={PAD} data-testid="brief-page-3">
        <PageHead no="02" title="技術棧與架構" sub="同一套前端可以在 Local-first、Local Server 和 Cloud 三種模式運行" />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3mm', marginBottom: '4mm' }}>
          {[
            ['Frontend', 'React 18 · TypeScript · Vite · Tailwind CSS'],
            ['Data', 'IndexedDB · Dexie'],
            ['AI', 'DeepSeek · Local Hybrid Engine · Knowledge Base · Risk Rules'],
            ['Cloud', 'Supabase · PostgreSQL · Realtime · Edge Function'],
            ['Local Sync', 'Node.js · Express · WebSocket · SQLite'],
            ['Voice', 'Web Speech API · ASR · TTS'],
            ['Engineering', 'Vitest · Playwright · GitHub Actions · GitHub Pages'],
            ['Demo 體驗', 'Demo Login（tester/tester）· 四語言 · 自動語音回應'],
          ].map(([t, d]) => (
            <div key={t} style={{ background: '#fff', border: '1px solid #e7e3da', borderLeft: '3px solid #5ba3d0', borderRadius: '4px', padding: '2.5mm 3.5mm' }}>
              <p style={{ margin: 0, fontSize: '9pt', fontWeight: 700, color: '#3e7ea6', letterSpacing: '0.06em' }}>{t}</p>
              <p style={{ margin: '0.8mm 0 0', fontSize: '8.8pt', lineHeight: 1.55, color: '#4b5563' }}>{d}</p>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '5mm' }}>
          <div style={{ flex: 6 }}>
            <p className="brief-serif" style={{ margin: '0 0 3mm', fontSize: '12pt', fontWeight: 900 }}>資料流架構</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.8mm' }}>
              {[
                ['Voice / Text', '#5ba3d0'],
                ['Safety Layer（緊急／敏感攔截）', '#ef4444'],
                ['AI + Local Hybrid（DeepSeek prompt 跟隨語言；離線 Local Hybrid 本地化回覆）', '#f59e0b'],
                ['Structured Health Data（IndexedDB／SQLite／Postgres）', '#10b981'],
                ['Risk Engine（分診／風險規則）', '#3e7ea6'],
                ['Family Alert → Follow-up → Elder Feedback', '#1f2937'],
              ].map(([t, c], i, arr) => (
                <div key={String(t)}>
                  <div style={{ background: '#fff', border: '1.5px solid #1f2937', borderLeft: `3.5px solid ${c}`, borderRadius: '4px', padding: '2mm 3mm', fontSize: '8.8pt', fontWeight: 700 }}>
                    {t}
                  </div>
                  {i < arr.length - 1 && <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: '9pt', lineHeight: '2.6mm' }}>↓</div>}
                </div>
              ))}
            </div>
          </div>
          <div style={{ flex: 4, display: 'flex', flexDirection: 'column', gap: '3mm' }}>
            <div style={{ background: '#fff', border: '1.5px solid #1f2937', borderRadius: '6px', padding: '4mm' }}>
              <p className="brief-serif" style={{ margin: '0 0 2mm', fontSize: '11pt', fontWeight: 900 }}>三種運行模式</p>
              <ul style={{ margin: 0, paddingLeft: '4.5mm', fontSize: '8.8pt', lineHeight: 1.7, color: '#4b5563' }}>
                <li><b>Mode A</b> GitHub Pages 純前端：IndexedDB + Local Hybrid，離線可用</li>
                <li><b>Mode B</b> Local Server：Node + DeepSeek Proxy + WebSocket 雙裝置同步</li>
                <li><b>Mode C</b> Supabase Cloud：Edge Function + Postgres + Realtime</li>
              </ul>
            </div>
            <div style={{ background: '#1f2937', color: '#fff', borderRadius: '6px', padding: '4mm' }}>
              <p style={{ margin: 0, fontSize: '8.8pt', lineHeight: 1.7 }}>
                <b>離線 fallback：</b>DeepSeek 不可用時自動切換 Local Hybrid Engine；
                本輪新增 Login／Language／TTS Autoplay 三種模式一致可用。
              </p>
            </div>
            <div style={{ background: '#fff', border: '1.5px solid #1f2937', borderRadius: '6px', padding: '3mm' }}>
              <Shot src="brief/family-health-chart.png" alt="家屬健康趨勢血壓圖實機截圖" />
            </div>
          </div>
        </div>

        <p style={{ marginTop: '4mm', background: '#fef3f2', border: '1px solid #ef4444', borderRadius: '4px', padding: '3mm 4mm', fontSize: '9pt', lineHeight: 1.65, color: '#7f1d1d' }}>
          ⚠️ 免責聲明：本原型之內嵌 Demo triage rules（分診／風險規則）僅供演示，<b>並非醫療標準</b>，
          不構成任何醫療建議或診斷；實際照護決策必須由專業醫護人員作出。
        </p>
        <PageFooter pageNo={3} />
      </section>

      {/* ==================== P4 競品類別比較 ==================== */}
      <section className="brief-page" style={PAD} data-testid="brief-page-4">
        <PageHead no="03" title="競品類別比較" sub="不做無證據的品牌攻擊：以類別能力比較呈現差異（✓ 完整支援 · △ 部分／視情況）" />

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9.3pt' }}>
          <thead>
            <tr>
              {['能力', 'Health Tracking App', 'AI Voice Assistant', 'Wearable Device', 'SilverCare'].map((h) => (
                <th key={h} className="brief-serif" style={{ border: '1.5px solid #1f2937', background: '#e8f2f9', padding: '3mm 2mm', fontSize: '9.5pt', fontWeight: 900 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              ['Natural voice input', '△', '✓', '△', '✓'],
              ['Structured health record', '✓', '△', '✓', '✓'],
              ['Family care loop', '△', '△', '△', '✓'],
              ['AI explanation', '△', '✓', '△', '✓'],
              ['4-language UI', 'varies', 'varies', 'varies', '✓'],
              ['Auto voice response', '△', '✓', '△', '✓'],
              ['Local + cloud', '△', '△', '△', '✓'],
              ['Macau-focused workflow', '△', '△', '△', '✓'],
            ].map((row) => (
              <tr key={row[0]}>
                {row.map((cell, i) => (
                  <td
                    key={i}
                    style={{
                      border: '1px solid #c9c3b6', padding: '2.5mm 2mm',
                      textAlign: 'center', fontWeight: i === 0 ? 700 : 500,
                      color: i === 0 ? '#1f2937' : i === row.length - 1 && cell === '✓' ? '#0f766e' : '#4b5563',
                    }}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ marginTop: '6mm', background: '#fff', borderLeft: '4mm solid #5ba3d0', borderRadius: '6px', padding: '5mm 6mm', boxShadow: '4px 4px 0 rgba(31,41,55,0.10)' }}>
          <p className="brief-serif" style={{ margin: '0 0 2mm', fontSize: '12pt', fontWeight: 900, color: '#3e7ea6' }}>核心論點</p>
          <p style={{ margin: 0, fontSize: '10pt', lineHeight: 1.75, color: '#1f2937' }}>
            SilverCare 的差異不是單一技術，而是把語音、AI、健康紀錄、風險判斷與家庭跟進整合成一條
            長者可以真正使用的流程 —— 語音一句完成、家屬閉環跟進、澳門四語言場景，
            Local-first + Cloud-ready 兼顧隱私與跨裝置同步。
          </p>
        </div>
        <PageFooter pageNo={4} />
      </section>

      {/* ==================== P5 未來願景 ==================== */}
      <section className="brief-page" style={PAD} data-testid="brief-page-5">
        <PageHead no="04" title="從一句話開始，建立長者的 AI 照護入口" sub="NOW 為已實現功能；NEXT 為未來規劃（roadmap），不屬已完成成果" />

        <div style={{ display: 'flex', gap: '4mm', marginBottom: '4mm' }}>
          {[
            ['NOW · 功能原型', [
              'Elder / Family 雙端',
              'AI 對話 + 自動語音回應',
              '健康記錄與風險提醒',
              '家庭跟進回流',
              '四語言（繁中／简中／PT／EN）',
              'ASR / TTS 跟隨語言',
              'Local + Cloud 三模式',
            ], '#10b981'],
            ['NEXT · 未來 roadmap', [
              '智能手錶／血壓計／血糖儀整合',
              '服藥提醒與覆診安排',
              'WhatsApp / WeChat 通知',
              '照顧者儀表板',
            ], '#f59e0b'],
            ['FUTURE · 願景', [
              '長期健康檔案與個人化 AI',
              '健康趨勢預測',
              '主動式家庭介入',
              '社區服務與醫療 API 整合',
              '大灣區擴展',
            ], '#3e7ea6'],
          ].map(([t, items, color]) => (
            <div key={String(t)} style={{ flex: 1, background: '#fff', border: '1.5px solid #1f2937', borderTop: `3px solid ${color}`, borderRadius: '6px', padding: '4mm', display: 'flex', flexDirection: 'column' }}>
              <p className="brief-serif" style={{ margin: '0 0 2mm', fontSize: '10.5pt', fontWeight: 900 }}>{t}</p>
              <ul style={{ margin: 0, paddingLeft: '4mm', fontSize: '8.4pt', lineHeight: 1.65, color: '#4b5563', flex: 1 }}>
                {(items as string[]).map((it) => <li key={it}>{it}</li>)}
              </ul>
            </div>
          ))}
        </div>

        <div className="brief-serif" style={{ background: '#e8f2f9', borderRadius: '6px', padding: '4mm 6mm', fontSize: '10.5pt', fontWeight: 700, lineHeight: 1.75, marginBottom: '5mm' }}>
          今天，我們讓長者只說一句。<br />未來，我們希望 AI 能理解長者每天每一句話背後的健康變化。
        </div>

        <div style={{ display: 'flex', gap: '7mm', alignItems: 'flex-start' }}>
          <div style={{ flex: 5, display: 'flex', flexDirection: 'column', gap: '4mm' }}>
            <div style={{ background: '#fff', border: '1.5px solid #1f2937', borderRadius: '6px', padding: '5mm' }}>
              <p style={{ margin: '0 0 2mm', fontSize: '9pt', fontWeight: 700, color: '#3e7ea6', letterSpacing: '0.12em' }}>PROTOTYPE URL</p>
              {hasUrl ? (
                <p style={{ margin: 0, fontSize: '11pt', fontWeight: 700, wordBreak: 'break-all' }}>{publishedUrl}</p>
              ) : (
                <p style={{ margin: 0, fontSize: '13pt', fontWeight: 900, color: '#9ca3af', border: '1.5px dashed #c9c3b6', borderRadius: '4px', padding: '3mm', textAlign: 'center' }}>
                  待發布（PENDING）
                </p>
              )}
            </div>
            <div style={{ background: '#fff', border: '1.5px solid #1f2937', borderRadius: '6px', padding: '5mm' }}>
              <p style={{ margin: '0 0 2mm', fontSize: '9pt', fontWeight: 700, color: '#3e7ea6', letterSpacing: '0.12em' }}>DEMO LOGIN</p>
              <p style={{ margin: 0, fontSize: '11pt', fontWeight: 700 }}>
                ID：tester<br />Password：tester
              </p>
              <p style={{ margin: '2mm 0 0', fontSize: '8.5pt', color: '#4b5563' }}>
                登入後選擇「我是長者」即可體驗四語言 AI 語音照護。
              </p>
            </div>
            <p style={{ margin: 0, fontSize: '8.5pt', lineHeight: 1.6, color: '#4b5563' }}>
              取得正式 URL 後執行：<br />
              <code style={{ background: '#1f2937', color: '#e8f2f9', borderRadius: '3px', padding: '1mm 2mm', fontSize: '8pt' }}>
                node scripts/generate-pdf.mjs --url &lt;URL&gt;
              </code>
              <br />即可連同 QR Code 一併重新生成本簡報。
            </p>
          </div>

          <div style={{ flex: 4, textAlign: 'center' }}>
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="Prototype QR Code" style={{ width: '42mm', height: '42mm', border: '1.5px solid #1f2937', borderRadius: '6px', padding: '2mm', background: '#fff' }} />
            ) : (
              <div
                style={{
                  width: '42mm', height: '42mm', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: '2px dashed #c9c3b6', borderRadius: '6px', color: '#9ca3af', fontSize: '12pt', fontWeight: 900, background: '#fff',
                }}
              >
                QR<br />待發布
              </div>
            )}
            <p style={{ margin: '2mm 0 0', fontSize: '8.5pt', color: '#4b5563' }}>掃碼直達原型（發布後生效）</p>
          </div>
        </div>
        <PageFooter pageNo={5} />
      </section>
    </main>
  );
}
