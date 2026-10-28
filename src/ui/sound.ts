export type SoundKind = 'off' | 'blip' | 'chime' | 'alarm';

let audio: AudioContext | null = null;

export function unlockAudio() {
  audio ??= new AudioContext();
  if (audio.state === 'suspended') audio.resume().catch(() => undefined);
}

function tone(ctx: AudioContext, at: number, freq: number, length: number, volume: number, wave: OscillatorType, to?: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = wave;
  osc.frequency.setValueAtTime(freq, at);
  if (to) osc.frequency.linearRampToValueAtTime(to, at + length);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(volume, at + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(gain).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + length + 0.02);
}

export function playSound(kind: SoundKind, volume = 0.25) {
  if (kind === 'off') return;
  try {
    unlockAudio();
  } catch {
    return;
  }
  const ctx = audio!;
  const t = ctx.currentTime + 0.01;
  if (kind === 'blip') tone(ctx, t, 880, 0.13, volume, 'sine');
  if (kind === 'chime') {
    tone(ctx, t, 660, 0.22, volume, 'triangle');
    tone(ctx, t + 0.16, 990, 0.32, volume, 'triangle');
  }
  if (kind === 'alarm') {
    for (let i = 0; i < 3; i++) tone(ctx, t + i * 0.24, 620, 0.2, Math.min(0.5, volume * 1.6), 'square', 1240);
  }
}
