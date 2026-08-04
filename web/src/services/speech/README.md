# services/speech — 語音層（ASR / TTS）

銀髮一句通的語音層，**只使用瀏覽器內建 API**（Web Speech API），零第三方 SDK。
預設語言為粵語 `zh-HK`，語速為長者友善的 `rate ≈ 0.8`。

核心承諾：**任何一個函式都絕不拋錯**。不支援或失敗一律透過 `onError` 帶明確原因通知，
由 UI 決定 fallback（通常是切回文字輸入），App 永不崩潰。

---

## ASR — `asr.ts`

### 模組級 API（一般 UI 用這個）

```ts
import { isSpeechSupported, startListening, stopListening } from '../services/speech/asr';

if (!isSpeechSupported()) {
  // 直接隱藏語音按鈕，fallback 到文字輸入
}

startListening({
  onInterim: (text) => setDraft(text),          // 中間轉寫（可選）
  onResult: (text) => submit(text),             // 最終轉寫
  onError: (error) => showFallback(error),      // 必帶明確 AsrError
  onEnd: () => setMicOff(),                     // 保證恰好觸發一次
});

stopListening(); // 優雅停止；無聆聽時為 no-op
```

### `AsrError`

```ts
{ code: AsrErrorCode; message: string; raw?: unknown }
```

| code                | 場景                                   | 建議 fallback            |
| ------------------- | -------------------------------------- | ------------------------ |
| `unsupported`       | 瀏覽器不支援 / 語言不支援               | 切文字輸入（隱藏麥克風） |
| `no-speech`         | 聽不到聲音                             | 提示再試一次             |
| `audio-capture`     | 找不到麥克風                           | 提示檢查裝置             |
| `permission-denied` | 麥克風權限被拒                         | 引導開啟權限             |
| `network`           | 辨識服務網路錯誤                       | 提示稍後再試／文字輸入   |
| `aborted`           | 辨識被中止                             | 通常無需處理             |
| `internal`          | 其他                                   | 切文字輸入               |

`message` 為繁體中文、可直接給長者 UI 使用。

### 注入縫隙（測試／外部轉寫引擎）

```ts
import { createAsr } from '../services/speech/asr';

const asr = createAsr({
  injectTranscript: (handle) => {
    handle.interim('你好');      // 中間轉寫
    handle.final('你好世界');    // 最終轉寫 → 自動結束 session
    // handle.error({ code, message }) / handle.end() 亦可用
    return () => {/* 清理函式，stop() 時被呼叫 */};
  },
});
asr.start(callbacks); // 與原生辨識共用同一套 callbacks 合約
```

亦可透過 `createAsr({ getRecognitionCtor })` 覆寫 `SpeechRecognition` 來源。

---

## TTS — `tts.ts`

### 模組級 API

```ts
import { isTtsSupported, speak, stopSpeaking } from '../services/speech/tts';

speak('記得食藥呀', {
  onStart: () => setSpeaking(true),   // 可選
  onEnd: () => setSpeaking(false),    // 可選
  onError: (error) => toast(error),   // 可選，{ code, message, raw }
});

stopSpeaking(); // 立即停止；無播放時為 no-op
```

行為保證：

- **cancel-on-new**：新語句到來立即取消上一句；被取消舊句的事件一律靜默，
  只有「最新一句」的 `onStart/onEnd/onError` 會觸發。
- **語音選擇**：zh-HK 精確 → zh-HK 前綴 → zh-Hant → yue（粵語）→ 其他 zh；
  完全沒有中文語音時僅設定 `lang='zh-HK'` 讓引擎自選，不報錯。
- **voiceschanged**：Chrome 首次 `getVoices()` 常為空，本層已處理非同步載入，
  聲音清單就绪後自動於下一句選中正確語音。
- 預設 `rate = 0.8`、`pitch = 1`、`volume = 1`，皆可經 opts 覆寫。

### 注入縫隙

`createTts({ getSynthesis })` 可覆寫 `speechSynthesis` 來源（測試／客製引擎），
合約與模組級 API 一致。

---

## Fallback 策略總覽

1. 進入頁面先呼叫 `isSpeechSupported()` / `isTtsSupported()` 決定 UI 呈現。
2. ASR `onError` 收到後：**一律提供文字輸入出口**，並用 `error.message` 顯示原因。
3. TTS 失敗時僅為「沒有聲音」，文字內容必須已在畫面上呈現，不阻塞主流程。
4. 所有函式絕不拋錯，無需 try/catch。

## 測試

```bash
npm test -- src/services/speech   # 38 tests（Vitest + jsdom）
```
