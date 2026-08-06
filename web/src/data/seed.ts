/**
 * SilverCare Voice — Demo seed（T1：100 名合成澳門長者）
 *
 * 由 ./syntheticDemo 的 deterministic generator 建立（固定 seed 可重現），
 * 第 1 位為原有「陳婆婆」完整示範資料，其餘 99 位為合成長者；
 * 每名長者對應一個 account（User role:'elder'）＋ 一名固定監護人。
 */
export { buildDemoSeed, seedData } from './syntheticDemo';
