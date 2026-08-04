/**
 * T6 UI 格式化小工具（粵語語境、本地時區）。
 */
import type { VitalType } from '../types/entities';

/** 按時段問候：早晨／午安／晚安。 */
export function greetingByHour(now = new Date()): string {
  const h = now.getHours();
  if (h < 12) return '早晨';
  if (h < 18) return '午安';
  return '晚安';
}

/** ISO → '8月5號 14:30'（本地時區）。 */
export function fmtDate(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}號 ${hh}:${mm}`;
}

/** ISO → '14:30'。 */
export function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** ISO → 'M/D'（圖表 x 軸用）。 */
export function fmtShortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 是否今日（本地時區）。 */
export function isToday(iso: string): boolean {
  return new Date(iso).toDateString() === new Date().toDateString();
}

export const VITAL_LABELS: Record<VitalType, string> = {
  blood_pressure: '血壓',
  blood_glucose: '血糖',
  heart_rate: '心率',
  weight: '體重',
};

export const SEVERITY_LABELS: Record<'normal' | 'attention' | 'urgent', string> = {
  normal: '正常',
  attention: '要留意',
  urgent: '緊急',
};

export const MED_STATUS_LABELS: Record<'taken' | 'missed' | 'late' | 'pending', string> = {
  taken: '已服',
  missed: '漏服',
  late: '延遲',
  pending: '未服',
};

export const FOLLOWUP_TYPE_LABELS: Record<'phone' | 'message' | 'visit' | 'other', string> = {
  phone: '電話',
  message: '訊息',
  visit: '上門',
  other: '其他',
};

export const CONDITION_LABELS: Record<string, string> = {
  hypertension: '高血壓',
  diabetes: '糖尿病',
  heart_disease: '心臟病',
  respiratory: '呼吸道',
  other: '其他',
};
