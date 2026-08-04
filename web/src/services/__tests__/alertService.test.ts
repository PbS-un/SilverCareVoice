/**
 * T5 AlertService 測試：事件 → Alert、acknowledge、followUp 全流程。
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import { getProvider } from '../../data/DataProvider';
import { seedData } from '../../data/seed';
import { tableNameOf } from '../../types/entities';
import type { Alert, CaregiverFollowUp, HealthEvent } from '../../types/entities';
import {
  acknowledgeAlert,
  createAlertsForEvent,
  createAlertsForEvents,
  followUpAlert,
  listOpenAlerts,
} from '../AlertService';

const ELDER_ID = 'seed-elder-01';
const CAREGIVER_ID = 'seed-caregiver-01';

function makeEvent(severity: HealthEvent['severity'], summary = '測試事件'): HealthEvent {
  const t = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    elderId: ELDER_ID,
    type: 'bp_high',
    severity,
    summary,
    sourceRecordIds: [],
    createdAt: t,
    updatedAt: t,
  };
}

beforeEach(async () => {
  await getProvider().reset(seedData);
});

describe('AlertService — Alert 建立', () => {
  it('attention 事件 → 為已授權照顧者建 open Alert（粵語 message 含長者名）', async () => {
    const event = makeEvent('attention', '血壓 165/98 mmHg 偏高，建議休息後再量度。');
    await getProvider().put(tableNameOf('HealthEvent'), event);

    const alerts = await createAlertsForEvent(event);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].caregiverId).toBe(CAREGIVER_ID);
    expect(alerts[0].healthEventId).toBe(event.id);
    expect(alerts[0].severity).toBe('attention');
    expect(alerts[0].status).toBe('open');
    expect(alerts[0].message).toContain('陳婆婆');

    const inDb = await getProvider().get<Alert>(tableNameOf('Alert'), alerts[0].id);
    expect(inDb).toBeDefined();
  });

  it('normal 事件唔會建 Alert；createAlertsForEvents 過濾 normal', async () => {
    const normal = makeEvent('normal');
    const attention = makeEvent('attention');
    expect(await createAlertsForEvent(normal)).toHaveLength(0);

    const alerts = await createAlertsForEvents([normal, attention]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].healthEventId).toBe(attention.id);
  });

  it('urgent Alert message 含緊急提示', async () => {
    const event = makeEvent('urgent', '提及高風險症狀：胸口痛。');
    const alerts = await createAlertsForEvent(event);
    expect(alerts[0].severity).toBe('urgent');
    expect(alerts[0].message).toContain('緊急');
  });
});

describe('AlertService — acknowledge / followUp', () => {
  it('acknowledge → acknowledged + seenAt', async () => {
    const event = makeEvent('attention');
    const [alert] = await createAlertsForEvent(event);

    const acked = await acknowledgeAlert(alert.id, CAREGIVER_ID);
    expect(acked.status).toBe('acknowledged');
    expect(acked.seenAt).toBeTruthy();

    const inDb = await getProvider().get<Alert>(tableNameOf('Alert'), alert.id);
    expect(inDb!.status).toBe('acknowledged');
  });

  it('followUp → 建 CaregiverFollowUp 且 Alert 變 resolved', async () => {
    const event = makeEvent('attention');
    const [alert] = await createAlertsForEvent(event);

    const { followUp, alert: resolved } = await followUpAlert(
      alert.id,
      CAREGIVER_ID,
      'phone',
      '打咗電話關心吓，佢話無事。',
    );
    expect(followUp.alertId).toBe(alert.id);
    expect(followUp.type).toBe('phone');
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolvedAt).toBeTruthy();

    const fuInDb = await getProvider().get<CaregiverFollowUp>(
      tableNameOf('CaregiverFollowUp'),
      followUp.id,
    );
    expect(fuInDb).toBeDefined();
  });

  it('其他人嘅 Alert 唔可以 acknowledge', async () => {
    const event = makeEvent('attention');
    const [alert] = await createAlertsForEvent(event);
    await expect(acknowledgeAlert(alert.id, 'someone-else')).rejects.toThrow();
  });

  it('listOpenAlerts 只回傳未完成嘅 Alert', async () => {
    const event = makeEvent('attention');
    const [alert] = await createAlertsForEvent(event);

    // seed-alert-01 已 resolved，唔應該出現
    const open = await listOpenAlerts(ELDER_ID);
    expect(open.map((a) => a.id)).toContain(alert.id);
    expect(open.map((a) => a.id)).not.toContain('seed-alert-01');

    await followUpAlert(alert.id, CAREGIVER_ID, 'visit', '上門睇吓');
    const after = await listOpenAlerts(ELDER_ID);
    expect(after.map((a) => a.id)).not.toContain(alert.id);
  });
});
