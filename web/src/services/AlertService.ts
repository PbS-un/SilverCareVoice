/**
 * AlertService —— 照顧者提醒服務（T5）
 *
 * HealthEvent（severity != 'normal'）→ 為 CaregiverLink 上已同意嘅
 * caregiver 建立 Alert（粵語簡述），status 'open'。
 * acknowledgeAlert / followUpAlert 供照顧者端跟進。
 * 所有讀寫一律經 DataProvider（無 demo-only 分支）。
 */
import { getProvider } from '../data/DataProvider';
import { tableNameOf } from '../types/entities';
import type {
  Alert,
  Caregiver,
  CaregiverFollowUp,
  CaregiverLink,
  ElderProfile,
  HealthEvent,
} from '../types/entities';

function newId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isoNow(): string {
  return new Date().toISOString();
}

/** 事件摘要 → 照顧者視角嘅粵語提醒（簡短一句）。 */
function buildAlertMessage(event: HealthEvent, elderName: string): string {
  const prefix = elderName || '長者';
  if (event.severity === 'urgent') {
    return `${prefix}有緊急情況：${event.summary}請盡快聯絡佢。`;
  }
  return `${prefix}的健康狀況需要留意：${event.summary}`;
}

/**
 * 為一個健康事件建立 Alert：
 * 搵出該長者所有 consentGiven 嘅 CaregiverLink，每位 caregiver 建一個 open Alert。
 * 回傳建立咗嘅 Alert（冇授權照顧者時回傳空陣列）。
 */
export async function createAlertsForEvent(event: HealthEvent): Promise<Alert[]> {
  if (event.severity === 'normal') return [];
  const provider = getProvider();

  const links = (
    await provider.list<CaregiverLink>(tableNameOf('CaregiverLink'), { elderId: event.elderId })
  ).filter((l) => l.consentGiven);
  if (links.length === 0) return [];

  const profile = await provider.get<ElderProfile>(tableNameOf('ElderProfile'), event.elderId);
  const elderName = profile?.name ?? '';
  const message = buildAlertMessage(event, elderName);
  const t = isoNow();

  const alerts: Alert[] = [];
  for (const link of links) {
    const alert: Alert = {
      id: newId(),
      elderId: event.elderId,
      caregiverId: link.caregiverId,
      healthEventId: event.id,
      severity: event.severity,
      message,
      status: 'open',
      createdAt: t,
      updatedAt: t,
    };
    alerts.push(await provider.put<Alert>(tableNameOf('Alert'), alert));
  }
  return alerts;
}

/** 為一批健康事件建立 Alert，回傳全部建立咗嘅 Alert。 */
export async function createAlertsForEvents(events: HealthEvent[]): Promise<Alert[]> {
  const all: Alert[] = [];
  for (const event of events.filter((e) => e.severity !== 'normal')) {
    all.push(...(await createAlertsForEvent(event)));
  }
  return all;
}

/**
 * 照顧者確認收到提醒：Alert → 'acknowledged'（記 seenAt）。
 * 回傳更新後嘅 Alert；唔存在時拋錯。
 */
export async function acknowledgeAlert(alertId: string, caregiverId: string): Promise<Alert> {
  const provider = getProvider();
  const alert = await provider.get<Alert>(tableNameOf('Alert'), alertId);
  if (!alert) throw new Error(`acknowledgeAlert: Alert ${alertId} 唔存在`);
  if (alert.caregiverId !== caregiverId) {
    throw new Error(`acknowledgeAlert: caregiver ${caregiverId} 無權操作 Alert ${alertId}`);
  }
  const t = isoNow();
  return provider.put<Alert>(tableNameOf('Alert'), {
    ...alert,
    status: 'acknowledged',
    seenAt: alert.seenAt ?? t,
  });
}

/**
 * 照顧者完成跟進：建立 CaregiverFollowUp，Alert → 'resolved'。
 * 回傳 { followUp, alert }；唔存在時拋錯。
 */
export async function followUpAlert(
  alertId: string,
  caregiverId: string,
  type: CaregiverFollowUp['type'],
  note: string,
): Promise<{ followUp: CaregiverFollowUp; alert: Alert }> {
  const provider = getProvider();
  const alert = await provider.get<Alert>(tableNameOf('Alert'), alertId);
  if (!alert) throw new Error(`followUpAlert: Alert ${alertId} 唔存在`);
  if (alert.caregiverId !== caregiverId) {
    throw new Error(`followUpAlert: caregiver ${caregiverId} 無權操作 Alert ${alertId}`);
  }
  const t = isoNow();

  const followUp: CaregiverFollowUp = {
    id: newId(),
    alertId,
    caregiverId,
    type,
    note,
    createdAt: t,
    updatedAt: t,
  };
  const savedFollowUp = await provider.put<CaregiverFollowUp>(
    tableNameOf('CaregiverFollowUp'),
    followUp,
  );

  const savedAlert = await provider.put<Alert>(tableNameOf('Alert'), {
    ...alert,
    status: 'resolved',
    seenAt: alert.seenAt ?? t,
    resolvedAt: t,
  });

  return { followUp: savedFollowUp, alert: savedAlert };
}

/** 查某長者未完成（open / acknowledged）嘅 Alert，最新排前。 */
export async function listOpenAlerts(elderId: string): Promise<Alert[]> {
  const provider = getProvider();
  const alerts = await provider.list<Alert>(tableNameOf('Alert'), { elderId });
  return alerts
    .filter((a) => a.status !== 'resolved')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** 取照顧者名稱（UI 展示用，唔存在時回傳空字串）。 */
export async function caregiverNameOf(caregiverId: string): Promise<string> {
  const caregiver = await getProvider().get<Caregiver>(tableNameOf('Caregiver'), caregiverId);
  return caregiver?.name ?? '';
}
