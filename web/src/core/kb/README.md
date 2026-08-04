# T9 知識庫模組（core/kb）

澳門長者知識庫（policy / health / service，共 31 條，見
`src/data/knowledgeBase.ts`）＋ Fuse.js 模糊檢索（`search.ts`）。

## API 摘要

```ts
import { searchKnowledge, ensureKnowledgeLoaded } from './core/kb/search';

// 檢索（自動確保知識庫已導入 IndexedDB，冪等）
const hits = await searchKnowledge('有冇老人津貼');            // KnowledgeDocument[]（≤3）
const policyHits = await searchKnowledge('津貼', 'policy', 5); // 限定 category / limit

// App 啟動時可預先載入（可選；searchKnowledge 內部亦會自動調用）
await ensureKnowledgeLoaded();
```

- `searchKnowledge(query, category?, limit=3): Promise<KnowledgeDocument[]>`
  空查詢／無結果回傳 `[]`，不拋錯。支援粵語口語（去虛詞＋2-gram 展開＋覆蓋率排序）。
- `ensureKnowledgeLoaded(): Promise<void>`
  若 `knowledgeDocuments` 表為空，以 `KNOWLEDGE_BASE` bulkPut 導入（seed 合併、冪等）。
- `category` 取值：`'policy'`（津貼／政策）、`'health'`（健康護理）、`'service'`（醫療／社區服務）。

## T5 intent 接入方式（供 intent/AssistantService 任務參考）

1. intent 判定為 `service_query`／健康諮詢類時，以長者原句（ASR 轉寫文本）
   直接呼叫 `searchKnowledge(query)`，不需要預先正規化。
2. 可依 intent 細分傳入 `category`：政策／津貼問題 → `'policy'`；
   健康症狀問題 → `'health'`；機構／服務查詢 → `'service'`；不確定時留空。
3. 回覆組裝：取 `hits[i].title`＋`summary`（長者易懂繁體中文），
   有 `phone`／`location` 可一併唸出；結尾附 `source` 提醒以官方公佈為準。
4. 命中為空時走一般 fallback 回應，勿硬編碼問答。
5. 嚴禁改動本模組以外的語音／assistant 既有檔案；接入只在
   `LocalHybridEngine`／`AssistantService` 的 intent 分支內 import 本模組。

## 資料維護

- 新增條目：加入 `KNOWLEDGE_BASE`，ID 用 `kb-<category>-NN`，`updatedAt` 用編輯日期。
- Demo 重置路徑：`seed.ts` 已把 `KNOWLEDGE_BASE` 併入 `seedData.knowledgeDocuments`，
  `provider.reset(seedData)` 會一併還原；未走 seed 的既有 DB 由
  `ensureKnowledgeLoaded()` 補導。
