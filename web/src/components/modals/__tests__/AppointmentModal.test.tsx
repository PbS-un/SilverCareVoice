/**
 * AppointmentModal（新增覆診表單）整合測試（fake-indexeddb 實存）。
 * 涵蓋：有時間存儲、timeTbd 存儲、必填校驗、specialty/doctor/note、quick chips 預填。
 */
import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import AppointmentModal from '../AppointmentModal';
import { getProvider } from '../../../data/DataProvider';
import { seedData } from '../../../data/seed';
import { tableNameOf } from '../../../types/entities';
import type { Appointment } from '../../../types/entities';

const ELDER_ID = 'elder-modal-test';
const TABLE = tableNameOf('Appointment');

beforeAll(async () => {
  // 種入資源目錄（地點候選來源之一）
  await getProvider().bulkPut(
    seedData.resourceDirectory.map((entity) => ({
      table: tableNameOf('ResourceDirectory'),
      entity,
    })),
  );
});

async function listAppts(): Promise<Appointment[]> {
  return getProvider().list<Appointment>(TABLE, { elderId: ELDER_ID });
}

function renderModal(props: { appointments?: Appointment[]; onClose?: () => void; onDone?: () => void } = {}) {
  return render(
    <AppointmentModal
      elderId={ELDER_ID}
      appointments={props.appointments ?? []}
      onClose={props.onClose ?? vi.fn()}
      onDone={props.onDone ?? vi.fn()}
    />,
  );
}

beforeEach(async () => {
  const existing = await listAppts();
  await Promise.all(existing.map((a) => getProvider().remove(TABLE, a.id)));
});

describe('AppointmentModal', () => {
  it('有時間：date + time → 存儲 `T${time}:00`，無 timeTbd', async () => {
    const onDone = vi.fn();
    const onClose = vi.fn();
    renderModal({ onDone, onClose });

    fireEvent.change(screen.getByTestId('appt-date'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByTestId('appt-time'), { target: { value: '15:30' } });
    fireEvent.change(screen.getByTestId('appt-location-input'), { target: { value: '鏡湖醫院' } });
    fireEvent.click(screen.getByRole('button', { name: '記低覆診' }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
    const rows = await listAppts();
    expect(rows).toHaveLength(1);
    expect(rows[0].date).toBe(new Date('2026-09-01T15:30:00').toISOString());
    expect(rows[0].timeTbd).toBeUndefined();
    expect(rows[0].location).toBe('鏡湖醫院');
  });

  it('時間未定：toggle 後 date 存儲當日午夜，timeTbd: true', async () => {
    const onDone = vi.fn();
    renderModal({ onDone });

    fireEvent.change(screen.getByTestId('appt-date'), { target: { value: '2026-09-01' } });
    fireEvent.click(screen.getByTestId('appt-time-tbd'));
    fireEvent.change(screen.getByTestId('appt-location-input'), { target: { value: '山頂醫院' } });
    fireEvent.click(screen.getByRole('button', { name: '記低覆診' }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const rows = await listAppts();
    expect(rows).toHaveLength(1);
    expect(rows[0].timeTbd).toBe(true);
    expect(rows[0].date).toBe(new Date('2026-09-01T00:00:00').toISOString());
  });

  it('必填校驗：缺日期或地點 → 錯誤提示，不寫入', async () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: '記低覆診' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('請填寫日期同地點');
    expect(await listAppts()).toHaveLength(0);
  });

  it('未剔時間未定又無時間 → 錯誤提示', async () => {
    renderModal();
    fireEvent.change(screen.getByTestId('appt-date'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByTestId('appt-location-input'), { target: { value: '鏡湖醫院' } });
    fireEvent.click(screen.getByRole('button', { name: '記低覆診' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('請填寫時間');
    expect(await listAppts()).toHaveLength(0);
  });

  it('專科「其他」自填 + 醫生 + 備註一併存儲', async () => {
    const onDone = vi.fn();
    renderModal({ onDone });

    fireEvent.change(screen.getByTestId('appt-date'), { target: { value: '2026-09-02' } });
    fireEvent.change(screen.getByTestId('appt-time'), { target: { value: '09:15' } });
    fireEvent.change(screen.getByTestId('appt-location-input'), { target: { value: '黑沙環衛生中心' } });
    fireEvent.click(screen.getByTestId('appt-specialty-其他'));
    fireEvent.change(screen.getByTestId('appt-specialty-other-input'), { target: { value: '皮膚科' } });
    fireEvent.change(screen.getByTestId('appt-doctor'), { target: { value: '陳醫生' } });
    fireEvent.change(screen.getByTestId('appt-note'), { target: { value: '帶驗血報告' } });
    fireEvent.click(screen.getByRole('button', { name: '記低覆診' }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const rows = await listAppts();
    expect(rows).toHaveLength(1);
    expect(rows[0].specialty).toBe('皮膚科');
    expect(rows[0].doctor).toBe('陳醫生');
    expect(rows[0].note).toBe('帶驗血報告');
  });

  it('quick chips 只預填不提交', async () => {
    renderModal();
    fireEvent.click(screen.getByTestId('appt-chip-hospital'));
    expect(screen.getByTestId('appt-location-input')).toHaveValue('醫院覆診');
    fireEvent.click(screen.getByTestId('appt-chip-family'));
    expect(screen.getByTestId('appt-location-input')).toHaveValue('家庭醫生');

    const expected = new Date(Date.now() + 7 * 86_400_000);
    const expectedStr = `${expected.getFullYear()}-${String(expected.getMonth() + 1).padStart(2, '0')}-${String(expected.getDate()).padStart(2, '0')}`;
    fireEvent.click(screen.getByTestId('appt-chip-week'));
    expect(screen.getByTestId('appt-date')).toHaveValue(expectedStr);

    // 未提交：DB 仍然空
    expect(await listAppts()).toHaveLength(0);
  });

  it('地點候選包含歷史地點與資源目錄（去重）', async () => {
    const history: Appointment = {
      id: 'appt-hist-1',
      elderId: ELDER_ID,
      date: new Date('2026-08-01T10:00:00').toISOString(),
      location: '鏡湖醫院',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    };
    renderModal({ appointments: [history] });

    // 資源目錄異步載入後，聚焦輸入框打開下拉
    await waitFor(async () => {
      const resources = await getProvider().list(tableNameOf('ResourceDirectory'));
      expect(resources.length).toBeGreaterThan(0);
    });
    fireEvent.focus(screen.getByTestId('appt-location-input'));

    expect(await screen.findByText('鏡湖醫院', { selector: 'span' })).toBeInTheDocument();
    // 歷史地點「鏡湖醫院」與資源目錄同名 → 去重後只出現一次
    expect(screen.getAllByText('鏡湖醫院', { selector: 'span' })).toHaveLength(1);
    expect(screen.getByText('仁伯爵綜合醫院（山頂醫院）')).toBeInTheDocument();
  });
});
