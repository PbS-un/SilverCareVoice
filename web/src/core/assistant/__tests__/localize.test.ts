/**
 * T1.4 Local Hybrid 回覆語言化測試：英文／葡文／簡中模板翻譯 + graceful fallback。
 */
import { localizeFallbackAnswer, localizeFallbackDetailed } from '../localize';

describe('localizeFallbackAnswer', () => {
  it('zh-HK 原句直出', () => {
    const zh = '收到，你而家血壓 138/82，我幫你記低咗。';
    expect(localizeFallbackAnswer(zh, 'zh-HK')).toBe(zh);
  });

  it('血壓記錄句翻譯成英文', () => {
    const out = localizeFallbackAnswer('收到，你而家血壓 138/82，我幫你記低咗。', 'en');
    expect(out).toContain('138/82');
    expect(out).toContain('recorded');
  });

  it('血壓記錄句翻譯成葡文', () => {
    const out = localizeFallbackAnswer('收到，你而家血壓 138/82，我幫你記低咗。', 'pt');
    expect(out).toContain('138/82');
    expect(out).toContain('já registei');
  });

  it('血壓記錄句翻譯成簡中', () => {
    const out = localizeFallbackAnswer('收到，你而家血壓 138/82，我幫你記低咗。', 'zh-CN');
    expect(out).toContain('138/82');
    expect(out).toContain('已帮您记录');
  });

  it('safety 緊急句翻譯成英文', () => {
    const out = localizeFallbackAnswer('胸痛係緊急情況，請即刻坐低休息，馬上聯絡家人或者照顧者幫手。', 'en');
    expect(out).toContain('emergency');
    expect(out).toContain('胸痛');
  });

  it('未覆蓋模板 graceful fallback 保留原句', () => {
    const unknown = '一個完全未覆蓋嘅自訂句子 123。';
    expect(localizeFallbackAnswer(unknown, 'en')).toBe(unknown);
  });

  it('詳細說明翻譯', () => {
    expect(localizeFallbackDetailed('檢測到高風險徵狀，已標記為緊急情況。', 'en')).toContain(
      'High-risk symptoms detected',
    );
    expect(localizeFallbackDetailed('檢測到高風險徵狀，已標記為緊急情況。', 'zh-HK')).toBe(
      '檢測到高風險徵狀，已標記為緊急情況。',
    );
  });
});
