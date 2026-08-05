/**
 * fmtAppointmentDate 單測：timeTbd 分支 + 沿用 fmtDate 邏輯。
 */
import { describe, expect, it } from 'vitest';

import { fmtAppointmentDate, fmtDate } from '../format';
import type { Appointment } from '../../types/entities';

const base = {
  id: 'appt-1',
  elderId: 'elder-1',
  location: '鏡湖醫院',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('fmtAppointmentDate', () => {
  it('timeTbd: true → 「M月D號（時間未定）」（日期唔會丟失）', () => {
    const a: Appointment = { ...base, date: '2026-08-20T09:00:00', timeTbd: true };
    expect(fmtAppointmentDate(a)).toBe('8月20號（時間未定）');
  });

  it('timeTbd: false → 沿用 fmtDate 的 HH:mm 邏輯', () => {
    const d = new Date(2026, 7, 5, 14, 30); // 本地時間 8月5號 14:30
    const a: Appointment = { ...base, date: d.toISOString(), timeTbd: false };
    expect(fmtAppointmentDate(a)).toBe(fmtDate(d.toISOString()));
    expect(fmtAppointmentDate(a)).toBe('8月5號 14:30');
  });

  it('timeTbd 缺省（舊數據）→ 等同 false，向後兼容', () => {
    const d = new Date(2026, 11, 1, 8, 5);
    const a: Appointment = { ...base, date: d.toISOString() };
    expect(fmtAppointmentDate(a)).toBe('12月1號 08:05');
  });

  it('表單 timeTbd 存儲格式（`${date}T00:00:00` → ISO）→ 「9月1號（時間未定）」', () => {
    // 模擬 AppointmentModal：timeTbd=true 時 date = new Date(`${date}T00:00:00`).toISOString()
    const a: Appointment = {
      ...base,
      date: new Date('2026-09-01T00:00:00').toISOString(),
      timeTbd: true,
    };
    expect(fmtAppointmentDate(a)).toBe('9月1號（時間未定）');
  });

  it('表單有時間存儲格式（`${date}T${time}:00` → ISO）→ 顯示 HH:mm', () => {
    // 模擬 AppointmentModal：date = new Date(`${date}T${time}:00`).toISOString()
    const a: Appointment = {
      ...base,
      date: new Date('2026-09-01T15:30:00').toISOString(),
    };
    expect(fmtAppointmentDate(a)).toBe('9月1號 15:30');
  });
});
