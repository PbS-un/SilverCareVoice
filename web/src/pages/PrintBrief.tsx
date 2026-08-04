/**
 * 項目簡報打印頁（路由 '/print-brief'，T11 交付物）：
 * A4 × 5 頁編輯部風格簡報，由 scripts/generate-pdf.mjs 透過 Playwright
 * page.pdf() 輸出為 deliverables/銀髮一句通_項目簡報.pdf。
 *
 * 分頁：每頁固定 210mm × 297mm + break-after: page。
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

  const flowNode: CSSProperties = {
    background: '#fff', border: '1.5px solid #1f2937', borderRadius: '4px',
    padding: '1.8mm 2.5mm', fontSize: '9.5pt', fontWeight: 700, whiteSpace: 'nowrap',
  };
  const loopNode: CSSProperties = {
    background: '#e8f2f9', border: '1px solid #5ba3d0', borderRadius: '999px',
    padding: '1.5mm 3.5mm', fontSize: '9pt', fontWeight: 700, color: '#1f2937', whiteSpace: 'nowrap',
  };

  return (
    <main data-testid="print-brief" style={{ background: '#d9d4c8' }}>
      <style>{PAGE_STYLE}</style>

      {/* ==================== P1 封面 ==================== */}
      <section className="brief-page" style={PAD} data-testid="brief-page-1">
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9pt', letterSpacing: '0.3em', color: '#4b5563', fontWeight: 700 }}>
          <span>SILVERCARE MACAU</span>
          <span>項目簡報 · PROJECT BRIEF</span>
        </div>
        <div className="brief-rule" style={{ marginTop: '2.5mm', borderTopWidth: '2.5px' }} />

        <div style={{ marginTop: '30mm' }}>
          <p className="brief-kicker" style={{ margin: 0 }}>灣區 AI 未來青年創造營 · 交付簡報</p>
          <h1 className="brief-serif" style={{ fontSize: '52pt', fontWeight: 900, margin: '6mm 0 4mm', lineHeight: 1.12, letterSpacing: '0.04em' }}>
            銀髮一句通
          </h1>
          <p style={{ fontSize: '14pt', fontWeight: 700, color: '#3e7ea6', margin: 0 }}>
            澳門長者 AI 慢病照護與家庭守護平台
          </p>
        </div>

        <div
          className="brief-serif"
          style={{
            margin: '16mm 0 0', padding: '8mm 9mm', background: '#fff',
            borderLeft: '4mm solid #5ba3d0', boxShadow: '5px 5px 0 rgba(31,41,55,0.10)',
            fontSize: '15.5pt', fontWeight: 700, lineHeight: 1.75,
          }}
        >
          「讓長者只說一句，<br />讓家人少一份擔心，<br />讓健康多一份連續紀錄。」
        </div>

        <div style={{ display: 'flex', gap: '5mm', marginTop: '16mm' }}>
          {[
            ['澳門 × 極簡', '粵語／繁中界面，一句說話即完成紀錄，長者零學習成本'],
            ['慢病 × 家庭', '血壓血糖連續追蹤，異常即時化為家屬可行動的提醒'],
            ['數據 × 長期價值', '每次對話沉澱為連續健康紀錄，愈用愈懂這位長者'],
          ].map(([t, d]) => (
            <div key={t} style={{ flex: 1, background: '#fff', border: '1.5px solid #1f2937', borderRadius: '6px', padding: '5mm', boxShadow: '3px 3px 0 rgba(31,41,55,0.10)' }}>
              <p className="brief-serif" style={{ margin: '0 0 2mm', fontSize: '12.5pt', fontWeight: 900, color: '#3e7ea6' }}>{t}</p>
              <p style={{ margin: 0, fontSize: '9pt', lineHeight: 1.6, color: '#4b5563' }}>{d}</p>
            </div>
          ))}
        </div>

        <div style={{ position: 'absolute', left: '14mm', right: '14mm', bottom: '20mm', display: 'flex', justifyContent: 'space-between', fontSize: '9pt', color: '#9ca3af' }}>
          <span>Functional Prototype · 雙端（長者／家屬）· 本地優先數據</span>
          <span>2026</span>
        </div>
        <PageFooter pageNo={1} />
      </section>

      {/* ==================== P2 雙端與資料流 ==================== */}
      <section className="brief-page" style={PAD} data-testid="brief-page-2">
        <PageHead no="01" title="雙端與資料流" sub="不是預設影片，而是實際可操作的資料流 —— 每個節點都對應真實頁面與真實寫庫" />

        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '2mm', marginBottom: '6mm' }}>
          {['老人自由輸入', 'AI / Parser', 'Health Database', 'Risk Engine', 'Family Alert', 'Follow Up'].map((n, i) => (
            <span key={n} style={{ display: 'inline-flex', alignItems: 'center', gap: '2mm' }}>
              <span style={{ ...flowNode, ...(i === 0 ? { background: '#5ba3d0', color: '#fff' } : {}) }}>{n}</span>
              {i < 5 && <span className="brief-flow-arrow" style={{ fontSize: '11pt' }}>→</span>}
            </span>
          ))}
        </div>

        <p style={{ fontSize: '10pt', lineHeight: 1.7, margin: '0 0 5mm', color: '#1f2937' }}>
          長者在老人端用<b>一句粵語或文字</b>描述身體狀況；系統經安全檢查、意圖識別與抽取，
          把症狀／血壓／用藥寫入健康資料庫；風險引擎即時評估並生成家屬提醒；家屬跟進後又回流成新紀錄。
          下圖均為<b>原型實機截圖</b>（非設計稿）：左為 /elder 回答氣泡，右為 /family/alerts 提醒列表。
        </p>

        <div style={{ display: 'flex', gap: '6mm', alignItems: 'flex-start' }}>
          <div style={{ flex: 5 }}>
            <Shot src="brief/elder-answer.png" alt="老人端回答氣泡實機截圖" />
            <p style={{ fontSize: '8pt', color: '#9ca3af', margin: '1.5mm 0 0' }}>/elder — 長者輸入一句後，AI 回覆 + 今日狀態實算</p>
          </div>
          <div style={{ flex: 5 }}>
            <Shot src="brief/family-alerts.png" alt="家屬提醒列表實機截圖" />
            <p style={{ fontSize: '8pt', color: '#9ca3af', margin: '1.5mm 0 0' }}>/family/alerts — 風險引擎產出的提醒，可「知道了／已跟進」</p>
          </div>
        </div>

        <div style={{ marginTop: '6mm', background: '#e8f2f9', borderRadius: '6px', padding: '4mm 5mm', fontSize: '9.5pt', lineHeight: 1.7 }}>
          <b>關鍵差異：</b>同一次操作會同時產生 SymptomRecord、HealthEvent 與 Alert 三筆真實資料，
          家屬端、時間線、週報全部由資料庫實算呈現 —— 演示時評委可自行輸入任意句子驗證。
        </div>
        <PageFooter pageNo={2} />
      </section>

      {/* ==================== P3 慢病閉環 ==================== */}
      <section className="brief-page" style={PAD} data-testid="brief-page-3">
        <PageHead no="02" title="慢病閉環" sub="記錄 → 趨勢 → 異常 → 提示 → 家屬 → 跟進 → 紀錄：一個完整、可重複運轉的閉環" />

        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '1.5mm', marginBottom: '6mm' }}>
          {['記錄', '趨勢', '異常', '提示', '家屬', '跟進', '紀錄'].map((n, i) => (
            <span key={n} style={{ display: 'inline-flex', alignItems: 'center', gap: '1.5mm' }}>
              <span style={loopNode}>{n}</span>
              {i < 6 && <span className="brief-flow-arrow" style={{ fontSize: '10pt' }}>→</span>}
            </span>
          ))}
          <span className="brief-flow-arrow" style={{ fontSize: '10pt', marginLeft: '1mm' }}>↺</span>
        </div>

        <div style={{ display: 'flex', gap: '6mm' }}>
          <div style={{ flex: 6 }}>
            <Shot src="brief/family-health-chart.png" alt="家屬健康趨勢血壓圖實機截圖" />
            <p style={{ fontSize: '8pt', color: '#9ca3af', margin: '1.5mm 0 0' }}>
              /family/health — 血壓雙線圖（含參考帶）；截圖前已實際新增一筆血壓，圖表右端新點即為當次操作寫入
            </p>
          </div>
          <div style={{ flex: 4, display: 'flex', flexDirection: 'column', gap: '3mm' }}>
            {[
              ['記錄', '一句說話或「量血壓」快捷鍵，VitalRecord 即時寫庫'],
              ['趨勢', '7／30 日圖表由 vitalsBetween 真實查詢繪製'],
              ['異常＋提示', '規則引擎判定偏高 → HealthEvent + Alert'],
              ['家屬＋跟進', '家屬「已跟進」寫 CaregiverFollowUp，Alert 轉 resolved'],
              ['紀錄', '跟進結果回流時間線，成為下一次判斷的上下文'],
            ].map(([t, d]) => (
              <div key={t} style={{ background: '#fff', border: '1px solid #e7e3da', borderLeft: '3px solid #10b981', borderRadius: '4px', padding: '2.5mm 3.5mm' }}>
                <p style={{ margin: 0, fontSize: '9.5pt', fontWeight: 700 }}>{t}</p>
                <p style={{ margin: '0.8mm 0 0', fontSize: '8.5pt', lineHeight: 1.55, color: '#4b5563' }}>{d}</p>
              </div>
            ))}
          </div>
        </div>
        <PageFooter pageNo={3} />
      </section>

      {/* ==================== P4 Database + AI Architecture ==================== */}
      <section className="brief-page" style={PAD} data-testid="brief-page-4">
        <PageHead no="03" title="Database + AI Architecture" sub="本地優先：資料先落 IndexedDB，後端只負責 AI 代理與雙裝置同步" />

        <div style={{ display: 'flex', gap: '6mm' }}>
          <div style={{ flex: 6 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2mm' }}>
              {[
                ['Web Client（React + IndexedDB/Dexie）', '#5ba3d0'],
                ['Safety Layer（敏感詞／緊急情境攔截）', '#ef4444'],
                ['Intent / Extraction（意圖識別＋結構化抽取）', '#f59e0b'],
                ['AI Provider（DeepSeek via local proxy）＋ Knowledge Base（31 篇澳門長者文檔）', '#3e7ea6'],
                ['Repository／Services（Alert・Report・Insight・Risk Rules）', '#10b981'],
                ['Database：IndexedDB（前端）＋ SQLite（同步中繼）', '#1f2937'],
                ['Family 端／Insights／可打印報告', '#5ba3d0'],
              ].map(([t, c], i, arr) => (
                <div key={t}>
                  <div style={{ background: '#fff', border: '1.5px solid #1f2937', borderLeft: `3.5px solid ${c}`, borderRadius: '4px', padding: '2mm 3mm', fontSize: '8.8pt', fontWeight: 700 }}>
                    {t}
                  </div>
                  {i < arr.length - 1 && <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: '9pt', lineHeight: '3mm' }}>↓</div>}
                </div>
              ))}
            </div>
          </div>
          <div style={{ flex: 4, display: 'flex', flexDirection: 'column', gap: '3mm' }}>
            <div style={{ background: '#fff', border: '1.5px solid #1f2937', borderRadius: '6px', padding: '4mm' }}>
              <p className="brief-serif" style={{ margin: '0 0 2mm', fontSize: '11pt', fontWeight: 900 }}>Consent · Audit · Privacy</p>
              <ul style={{ margin: 0, paddingLeft: '4.5mm', fontSize: '8.8pt', lineHeight: 1.7, color: '#4b5563' }}>
                <li>進入長者／家屬端必須先經免責同意畫面（Consent）</li>
                <li>對話、提醒、跟進全數留痕，時間線即審計軌跡（Audit）</li>
                <li>API Key 只存後端；離線時 Local Hybrid Engine 全本地運行（Privacy）</li>
                <li>雙裝置同步採本地優先，資料主體在長者裝置</li>
              </ul>
            </div>
            <div style={{ background: '#1f2937', color: '#fff', borderRadius: '6px', padding: '4mm' }}>
              <p style={{ margin: 0, fontSize: '8.8pt', lineHeight: 1.7 }}>
                <b>離線 fallback：</b>後端無 DEEPSEEK_API_KEY 或離線時，
                自動切換 Local Hybrid Engine（本地意圖＋規則引擎），功能不中斷。
              </p>
            </div>
          </div>
        </div>

        <p style={{ marginTop: '5mm', background: '#fef3f2', border: '1px solid #ef4444', borderRadius: '4px', padding: '3mm 4mm', fontSize: '9pt', lineHeight: 1.65, color: '#7f1d1d' }}>
          ⚠️ 免責聲明：本原型之內嵌 Demo triage rules（分診／風險規則）僅供演示，<b>並非醫療標準</b>，
          不構成任何醫療建議或診斷；實際照護決策必須由專業醫護人員作出。
        </p>
        <PageFooter pageNo={4} />
      </section>

      {/* ==================== P5 Try it yourself ==================== */}
      <section className="brief-page" style={PAD} data-testid="brief-page-5">
        <PageHead no="04" title="Try it yourself" sub="評委可自行操作 —— 以下 URL 於正式發布後填入，現為「待發布」佔位" />

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
              <p style={{ margin: '0 0 2mm', fontSize: '9pt', fontWeight: 700, color: '#3e7ea6', letterSpacing: '0.12em' }}>GITHUB PAGES URL</p>
              <p style={{ margin: 0, fontSize: '13pt', fontWeight: 900, color: '#9ca3af', border: '1.5px dashed #c9c3b6', borderRadius: '4px', padding: '3mm', textAlign: 'center' }}>
                待用戶 push 後啟用
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

        <div style={{ marginTop: '6mm' }}>
          <p className="brief-serif" style={{ margin: '0 0 3mm', fontSize: '12pt', fontWeight: 900 }}>評委可自行輸入的示例句子</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2mm' }}>
            {[
              '我啱啱血壓 158/95，仲有啲頭暈',
              '我今朝食咗降壓藥',
              '今晚覺得有啲氣喘，瞓唔著',
              '聽日朝早要去衛生中心覆診',
              '澳門長者醫療券點樣用？',
            ].map((s, i) => (
              <div key={s} style={{ display: 'flex', gap: '3mm', alignItems: 'baseline', background: '#fff', border: '1px solid #e7e3da', borderRadius: '4px', padding: '2mm 3.5mm' }}>
                <span className="brief-serif" style={{ fontSize: '11pt', fontWeight: 900, color: '#5ba3d0' }}>{i + 1}.</span>
                <span style={{ fontSize: '10pt', fontWeight: 500 }}>{s}</span>
              </div>
            ))}
          </div>
        </div>
        <PageFooter pageNo={5} />
      </section>
    </main>
  );
}
