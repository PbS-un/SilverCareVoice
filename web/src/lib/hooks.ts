/**
 * T6 UI 共享 hooks —— 資料層訂閱與非同步載入。
 *
 * 所有數據一律由 DataProvider 實算；subscribe 觸發時自動刷新，
 * 嚴禁寫死陣列、嚴禁 demo-only 分支。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { getProvider } from '../data/DataProvider';
import { tableNameOf } from '../types/entities';
import type { Caregiver, CaregiverLink, ElderProfile } from '../types/entities';
import { getDemoSession } from './demoAuth';

/**
 * 訂閱資料層寫入／同步事件：任何表有變更即回傳新版本號，
 * 供元件依賴刷新（另一裝置經 sync 寫入同樣會觸發）。
 */
export function useDbVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const provider = getProvider();
    if (!provider.subscribe) return undefined;
    return provider.subscribe(() => setVersion((v) => v + 1));
  }, []);
  return version;
}

/**
 * 通用非同步載入 hook：deps 變動（含 dbVersion）即重跑 loader。
 * 舊請求回傳時自動作廢（live flag），避免競態覆蓋新數據。
 */
export function useAsyncData<T>(
  loader: () => Promise<T>,
  deps: readonly unknown[],
): { data: T | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [tick, setTick] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let live = true;
    loaderRef
      .current()
      .then((d) => {
        if (live) setData(d);
      })
      .catch(() => {
        /* 載入失敗保持 null，由 UI 呈現空態 */
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, reload };
}

export interface ElderContextData {
  elderId: string;
  elderName: string;
  elder: ElderProfile;
  /** 首位已授權照顧者（無則 null） */
  caregiver: Caregiver | null;
}

/** 首位長者與其授權照顧者（demo 場景為陳婆婆／阿美）。 */
export function useElderContext(dbVersion: number): ElderContextData | null {
  const { data } = useAsyncData(async () => {
    const provider = getProvider();
    const elders = await provider.list<ElderProfile>(tableNameOf('ElderProfile'));
    // T2/T3：Account → Elder 綁定 —— 優先取登入 session 指定嘅長者；
    // 冇 session（向後兼容測試／未登入直接渲染）先 fallback 第一筆。
    const session = getDemoSession();
    const elder =
      (session ? elders.find((e) => e.id === session.elderId) : undefined) ?? elders[0];
    if (!elder) return null;
    const links = (
      await provider.list<CaregiverLink>(tableNameOf('CaregiverLink'), { elderId: elder.id })
    ).filter((l) => l.consentGiven);
    const caregiver =
      links.length > 0
        ? (await provider.get<Caregiver>(tableNameOf('Caregiver'), links[0].caregiverId)) ?? null
        : null;
    return { elderId: elder.id, elderName: elder.name, elder, caregiver };
  }, [dbVersion]);
  return data;
}
