/**
 * scripts/_bgm.mjs — 原創舒緩「鋼琴感」背景音樂合成器（180 秒）
 *
 * 純 Node 寫 PCM WAV（無第三方依賴），原創旋律（C–Am–F–G 琶音），
 * 唔涉及任何版權不明嘅商業音樂。音量刻意低（約 -26 dB），唔會蓋過旁白。
 *
 * 用法：node scripts/_bgm.mjs <out.wav> [durationSec]
 */
import { writeFileSync } from 'node:fs';

const SR = 44100;
const durationSec = Number(process.argv[3] ?? 180);
const OUT = process.argv[2] ?? 'bgm.wav';

const NOTE = {
  C3: 130.81, E3: 164.81, G3: 196.0, A3: 220.0, B3: 246.94,
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0,
  C5: 523.25,
};

// 每個和弦：低音 + 兩個琶音音（溫暖、舒緩）
const CHORDS = [
  [NOTE.C3, NOTE.E4, NOTE.G4],
  [NOTE.A3, NOTE.C4, NOTE.E4],
  [NOTE.F3, NOTE.A3, NOTE.C4],
  [NOTE.G3, NOTE.B3, NOTE.D4],
];

const samples = new Float32Array(Math.floor(SR * durationSec));
const barSec = 3.2; // 約 75 BPM，每小節 4 拍

function addNote(startSec, freq, durSec, amp) {
  const start = Math.floor(startSec * SR);
  const len = Math.floor(durSec * SR);
  for (let i = 0; i < len; i += 1) {
    const idx = start + i;
    if (idx >= samples.length) break;
    const t = i / SR;
    // 指數衰減包絡（鋼琴感）+ 柔和起音
    const env = Math.min(1, t / 0.01) * Math.exp(-2.6 * t);
    // 基頻 + 少量二次諧波（溫暖，唔刺耳）
    samples[idx] += amp * env * (Math.sin(2 * Math.PI * freq * t) + 0.18 * Math.sin(4 * Math.PI * freq * t));
  }
}

let cursor = 0;
let chordIdx = 0;
while (cursor < durationSec - 0.5) {
  const chord = CHORDS[chordIdx % CHORDS.length];
  const bass = chord[0];
  const arp = [chord[1], chord[2], chord[1] * 2, chord[2]];
  addNote(cursor, bass, barSec * 0.95, 0.11);
  arp.forEach((f, i) => {
    addNote(cursor + i * (barSec / 4), f, barSec * 0.7, 0.055);
  });
  cursor += barSec;
  chordIdx += 1;
}

// 立體聲 int16 PCM WAV（16-bit, 44100Hz, stereo）
const bytesPerSample = 2;
const dataSize = samples.length * bytesPerSample * 2;
const buf = Buffer.alloc(44 + dataSize);
buf.write('RIFF', 0);
buf.writeUInt32LE(36 + dataSize, 4);
buf.write('WAVE', 8);
buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20); // PCM
buf.writeUInt16LE(2, 22); // stereo
buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * bytesPerSample * 2, 28);
buf.writeUInt16LE(bytesPerSample * 2, 32);
buf.writeUInt16LE(16, 34);
buf.write('data', 36);
buf.writeUInt32LE(dataSize, 40);
for (let i = 0; i < samples.length; i += 1) {
  const v = Math.max(-1, Math.min(1, samples[i]));
  const s = Math.floor(v * 0x7fff);
  const off = 44 + i * 4;
  buf.writeInt16LE(s, off);
  buf.writeInt16LE(s, off + 2);
}
writeFileSync(OUT, buf);
console.log(`[bgm] 已生成原創舒緩背景音樂：${OUT}（${durationSec}s）`);
