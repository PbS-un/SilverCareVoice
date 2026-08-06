/**
 * 項目簡報打印頁（路由 '/print-brief'，T10）
 *
 * Competition Project Proposal / Product Vision Deck 風格（A4 × 5 頁）：
 *  P1 項目定位　P2 核心功能　P3 家庭閉環＋本地化＋簡化技術
 *  P4 社會價值　P5 未來方向
 *
 * 硬性要求：
 *  - 唔顯示 prototype URL／QR／GitHub Pages URL／Demo 憑證／登入教學
 *  - 技術內容只佔半頁，唔當 architecture specification
 *  - 截圖 object-fit: contain、max-width/height 100%，唔裁剪手機 UI
 *  - ≤ 5 頁 A4
 * 截圖由 scripts/generate-pdf.mjs 生成並複製到 dist/brief/（真實 UI）。
 */
import type { CSSProperties } from 'react';

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
    font-family: 'Noto Sans TC', 'Noto Sans SC', 'PingFang TC', 'PingFang SC',
      'Microsoft JhengHei', 'Microsoft YaHei', system-ui, sans-serif;
  }
  .brief-page:last-child { page-break-after: auto; break-after: auto; }
  .brief-serif { font-family: 'Noto Serif TC', 'Noto Serif SC', 'Songti TC', 'PMingLiU', 'SimSun', serif; }
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

/**
 * 真實 UI 截圖（手機豎屏）：固定框架 + object-fit: contain —— 保證唔裁剪、
 * 唔溢出、唔跨頁，保持完整手機 UI。
 */
function PhoneShot({ src, alt, height = '108mm' }: { src: string; alt: string; height?: string }) {
  return (
    <div
      className="brief-img-frame"
      style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2mm' }}
    >
      <img
        src={src}
        alt={alt}
        style={{
          display: 'block',
          maxWidth: '100%',
          maxHeight: '100%',
          width: 'auto',
          height: '100%',
          objectFit: 'contain',
        }}
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
  const loopNode: CSSProperties = {
    background: '#e8f2f9', border: '1px solid #5ba3d0', borderRadius: '999px',
    padding: '1.5mm 3.5mm', fontSize: '9pt', fontWeight: 700, color: '#1f2937', whiteSpace: 'nowrap',
  };

  return (
    <main data-testid="print-brief" style={{ background: '#d9d4c8' }}>
      <style>{PAGE_STYLE}</style>

      {/* ==================== P1 項目定位 ==================== */}
      <section className="brief-page" style={PAD} data-testid="brief-page-1">
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9pt', letterSpacing: '0.3em', color: '#4b5563', fontWeight: 700 }}>
          <span>SILVERCARE MACAU</span>
          <span>項目簡報 · PROJECT BRIEF</span>
        </div>
        <div className="brief-rule" style={{ marginTop: '2.5mm', borderTopWidth: '2.5px' }} />

        <div style={{ marginTop: '30mm', textAlign: 'center' }}>
          <p className="brief-kicker" style={{ margin: 0 }}>澳門長者 AI 慢病家庭照護平台</p>
          <h1 className="brief-serif" style={{ fontSize: '48pt', fontWeight: 900, margin: '8mm 0 4mm', lineHeight: 1.12, letterSpacing: '0.05em' }}>
            銀髮一句通
          </h1>
          <p style={{ fontSize: '13pt', fontWeight: 700, color: '#3e7ea6', margin: 0 }}>
            SilverCare Macau
          </p>
        </div>

        <div
          className="brief-serif"
          style={{
            margin: '16mm 0 0', padding: '9mm 10mm', background: '#fff',
            borderLeft: '4mm solid #5ba3d0', boxShadow: '5px 5px 0 rgba(31,41,55,0.10)',
            fontSize: '17pt', fontWeight: 700, lineHeight: 1.85, textAlign: 'center',
          }}
        >
          讓長者只說一句，<br />讓家人少一份擔心。
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4mm', marginTop: '14mm' }}>
          {[
            ['一句式語音健康輸入', '長者講一句，AI 聽得明、記得低'],
            ['AI 結構化健康紀錄', '血壓／血糖／心率／體重／食藥／覆診'],
            ['家庭照護閉環', '異常 → 提醒 → 家人跟進 → 結果回流'],
            ['澳門四語言', '繁中／简中／Português／English'],
            ['Elder-friendly', '大字、大按鈕、慢速語音、自動語音回應'],
            ['Local-first', '斷網可用，聯網可協同，隱私優先'],
          ].map(([t, d]) => (
            <div key={t} style={{ background: '#fff', border: '1.5px solid #1f2937', borderRadius: '6px', padding: '4mm 5mm', boxShadow: '3px 3px 0 rgba(31,41,55,0.10)' }}>
              <p className="brief-serif" style={{ margin: '0 0 1.5mm', fontSize: '11pt', fontWeight: 900, color: '#3e7ea6' }}>{t}</p>
              <p style={{ margin: 0, fontSize: '8.6pt', lineHeight: 1.55, color: '#4b5563' }}>{d}</p>
            </div>
          ))}
        </div>
        <PageFooter pageNo={1} />
      </section>

      {/* ==================== P2 核心功能 ==================== */}
      <section className="brief-page" style={PAD} data-testid="brief-page-2">
        <PageHead no="01" title="核心功能" sub="一句語音、慢病管理、AI 友善長者 —— 全部為可實際操作嘅功能" />

        <div style={{ display: 'flex', gap: '6mm', alignItems: 'flex-start' }}>
          <div style={{ flex: 4, display: 'flex', flexDirection: 'column', gap: '3mm' }}>
            <div style={{ background: '#fff', border: '1.5px solid #1f2937', borderRadius: '6px', padding: '4mm' }}>
              <p className="brief-serif" style={{ margin: '0 0 2.5mm', fontSize: '12pt', fontWeight: 900, color: '#3e7ea6' }}>
                一句語音
              </p>
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '1.5mm' }}>
                {['語音', 'AI 理解', '健康紀錄', '風險評估', '語音回覆'].map((n, i) => (
                  <span key={n} style={{ display: 'inline-flex', alignItems: 'center', gap: '1.5mm' }}>
                    <span style={loopNode}>{n}</span>
                    {i < 4 && <span className="brief-flow-arrow" style={{ fontSize: '10pt' }}>→</span>}
                  </span>
                ))}
              </div>
            </div>

            <div style={{ background: '#fff', border: '1.5px solid #1f2937', borderRadius: '6px', padding: '4mm' }}>
              <p className="brief-serif" style={{ margin: '0 0 2mm', fontSize: '12pt', fontWeight: 900, color: '#3e7ea6' }}>
                慢病管理
              </p>
              <p style={{ margin: 0, fontSize: '9pt', lineHeight: 1.7, color: '#4b5563' }}>
                血壓 · 血糖 · 心率 · 體重 · 食藥記錄 · 覆診跟進 · 病歷時間線 ——
                全部由資料庫實算，形成可持續追蹤嘅連續健康紀錄。
              </p>
            </div>

            <div style={{ background: '#fff', border: '1.5px solid #1f2937', borderRadius: '6px', padding: '4mm' }}>
              <p className="brief-serif" style={{ margin: '0 0 2mm', fontSize: '12pt', fontWeight: 900, color: '#3e7ea6' }}>
                AI 友善長者
              </p>
              <ul style={{ margin: 0, paddingLeft: '4.5mm', fontSize: '8.8pt', lineHeight: 1.7, color: '#4b5563' }}>
                <li>慢速語音：長者中間停頓（8 秒內）唔會中斷</li>
                <li>四語溫和提示：「慢慢再講一次，我聽住你」</li>
                <li>AI 回答完成後自動語音朗讀（TTS 跟隨語言）</li>
                <li>最近對話記憶：承接上一句，唔使重複講</li>
              </ul>
            </div>
          </div>

          <div style={{ flex: 4, display: 'flex', flexDirection: 'column', gap: '3mm' }}>
            <PhoneShot src="brief/elder-answer.png" alt="長者端一句語音回答（實機截圖）" />
            <p style={{ fontSize: '8pt', color: '#9ca3af', margin: 0, textAlign: 'center' }}>
              長者端：一句輸入 → AI 回答 → 自動語音朗讀
            </p>
            <PhoneShot src="brief/demo-login.png" alt="100 名示範長者選擇（實機截圖）" height="78mm" />
            <p style={{ fontSize: '8pt', color: '#9ca3af', margin: 0, textAlign: 'center' }}>
              100 名合成示範長者：揀一位即入，健康資料各自獨立
            </p>
          </div>
        </div>
        <PageFooter pageNo={2} />
      </section>

      {/* ==================== P3 家庭閉環 + 本地化 + 簡化技術 ==================== */}
      <section className="brief-page" style={PAD} data-testid="brief-page-3">
        <PageHead no="02" title="家庭閉環 · 澳門本地化 · 簡化技術" sub="AI 唔係淨係回答問題，而係推動照護行動" />

        <div style={{ display: 'flex', gap: '6mm', alignItems: 'flex-start' }}>
          <div style={{ flex: 6 }}>
            <p className="brief-serif" style={{ margin: '0 0 3mm', fontSize: '12pt', fontWeight: 900, color: '#3e7ea6' }}>
              家庭照護閉環
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.8mm' }}>
              {['長者', 'AI', 'Health Event', 'Family Alert', '家人跟進', '回流長者健康檔案'].map((n, i, arr) => (
                <div key={n}>
                  <div style={{ background: '#fff', border: '1.5px solid #1f2937', borderLeft: '3.5px solid #10b981', borderRadius: '4px', padding: '2mm 3mm', fontSize: '9pt', fontWeight: 700 }}>
                    {n}
                  </div>
                  {i < arr.length - 1 && <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: '9pt', lineHeight: '2.6mm' }}>↓</div>}
                </div>
              ))}
            </div>
            <p style={{ margin: '3mm 0 0', fontSize: '9.5pt', lineHeight: 1.65, color: '#4b5563' }}>
              長者有異常 → 家屬收到提醒 → 跟進 → 結果寫返長者檔案：
              「家人已經知道 ✓」—— 照護唔會喺對話結束嗰刻就停。
            </p>

            <div style={{ marginTop: '5mm', background: '#fff', border: '1.5px solid #1f2937', borderRadius: '6px', padding: '4mm' }}>
              <p className="brief-serif" style={{ margin: '0 0 2mm', fontSize: '12pt', fontWeight: 900, color: '#3e7ea6' }}>
                澳門四語言
              </p>
              <p style={{ margin: 0, fontSize: '9pt', lineHeight: 1.7, color: '#4b5563' }}>
                繁中／粵語 · 简中／普通話 · Português · English
                <br />
                由輸入（ASR）、AI 回覆到語音輸出（TTS）都跟隨語言。
              </p>
            </div>
          </div>

          <div style={{ flex: 4, display: 'flex', flexDirection: 'column', gap: '3mm' }}>
            <PhoneShot src="brief/family-alerts.png" alt="家屬提醒列表（實機截圖）" />
            <p style={{ fontSize: '8pt', color: '#9ca3af', margin: 0, textAlign: 'center' }}>
              家屬端：異常即時變提醒，可「知道了／已跟進」
            </p>
          </div>
        </div>

        {/* 簡化技術：只佔半頁 */}
        <div style={{ marginTop: '5mm', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3mm' }}>
          {['Local-first', 'Cloud Sync', 'Offline Fallback', 'Privacy-aware'].map((t) => (
            <div key={t} style={{ background: '#1f2937', color: '#fff', borderRadius: '6px', padding: '3mm 4mm', textAlign: 'center', fontSize: '10pt', fontWeight: 700 }}>
              {t}
            </div>
          ))}
        </div>
        <PageFooter pageNo={3} />
      </section>

      {/* ==================== P4 社會價值 ==================== */}
      <section className="brief-page" style={PAD} data-testid="brief-page-4">
        <PageHead no="03" title="社會價值" sub="以照護需求出發，唔以技術炫技為本" />

        <div style={{ display: 'flex', flexDirection: 'column', gap: '4mm' }}>
          {[
            ['1. 慢病管理更容易', '將零散嘅血壓、血糖、食藥、症狀、覆診變成連續健康紀錄，長者同家屬都有完整脈絡。'],
            ['2. 獨居長者與照護人互通', '長者有異常 → AI 發現 → 通知家屬 → 家屬跟進 → 結果回流。家庭照護不再只靠電話問候。'],
            ['3. 長者取得健康資訊更容易', '唔需要學習複雜 App，只需要「說一句」。降低長者嘅數碼門檻。'],
            ['4. 協助醫療分流', 'SilverCare 不作醫療診斷、不取代醫生，定位係「初步健康資訊整理及風險提示參考」，讓部分非緊急資訊先在家庭層面整理，長遠有助分流及減輕醫療系統壓力。'],
          ].map(([t, d]) => (
            <div key={String(t)} style={{ background: '#fff', border: '1.5px solid #1f2937', borderLeft: '3.5px solid #5ba3d0', borderRadius: '6px', padding: '4mm 5mm', boxShadow: '3px 3px 0 rgba(31,41,55,0.08)' }}>
              <p className="brief-serif" style={{ margin: '0 0 1.5mm', fontSize: '12pt', fontWeight: 900, color: '#3e7ea6' }}>{t}</p>
              <p style={{ margin: 0, fontSize: '9.2pt', lineHeight: 1.7, color: '#4b5563' }}>{d}</p>
            </div>
          ))}
        </div>

        <div
          className="brief-serif"
          style={{
            marginTop: '6mm', background: '#e8f2f9', borderRadius: '6px', padding: '5mm 7mm',
            fontSize: '11pt', fontWeight: 700, lineHeight: 1.8, color: '#1f2937',
          }}
        >
          「一句說話，唔單止係輸入方式，更係長者同家人之間嘅照護橋樑。」
        </div>
        <PageFooter pageNo={4} />
      </section>

      {/* ==================== P5 未來方向 ==================== */}
      <section className="brief-page" style={PAD} data-testid="brief-page-5">
        <PageHead no="04" title="未來願景" sub="以下為未來規劃（roadmap），不屬已完成成果" />

        <div style={{ display: 'flex', flexDirection: 'column', gap: '3.2mm' }}>
          {[
            ['1. Wearable 自動化', '接入智能手錶、血壓計、血糖設備、心率設備，由「老人主動輸入」逐步發展至自動健康數據 → 風險監測 → 家庭提醒，更好保障長者安全。'],
            ['2. 社工＋醫院＋家庭三方管理', '未來接入 Elder／Family／Social Worker／Hospital 四方角色，實現信息同步、照護協同與跟進連續性。'],
            ['3. 長者慢病健康資料庫', '喺明確同意、匿名化、合規同隱私保護前提下，建立人口級健康資料，未來可供慢病研究、社區健康研究、公共衛生政策與老齡化政策調整作數據基礎。'],
            ['4. Online Family Doctor', '未來加入線上家庭醫生端，形成「老人—家庭—家庭醫生」長期協作，改善慢病管理、健康教育、覆診連續性與醫療品質。'],
            ['5. 更多數據提升 AI', '透過更多合法授權資料、medical validation 與 domain-specific evaluation，逐步提升初步健康風險辨識同資訊整理嘅準確度。'],
          ].map(([t, d]) => (
            <div key={String(t)} style={{ background: '#fff', border: '1.5px solid #1f2937', borderRadius: '6px', padding: '3.5mm 4.5mm' }}>
              <p className="brief-serif" style={{ margin: '0 0 1.2mm', fontSize: '11pt', fontWeight: 900, color: '#3e7ea6' }}>{t}</p>
              <p style={{ margin: 0, fontSize: '8.8pt', lineHeight: 1.6, color: '#4b5563' }}>{d}</p>
            </div>
          ))}
        </div>

        <div
          className="brief-serif"
          style={{
            marginTop: '6mm', background: '#1f2937', color: '#fff', borderRadius: '6px',
            padding: '6mm 8mm', textAlign: 'center', fontSize: '13pt', fontWeight: 700, lineHeight: 1.9,
          }}
        >
          今天，我們讓長者只說一句。<br />未來，我們希望 AI 能理解長者每一句話背後嘅健康變化。
        </div>
        <PageFooter pageNo={5} />
      </section>
    </main>
  );
}
