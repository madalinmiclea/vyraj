export interface CapResult {
  capacity: number;
  rechargeTime: number;
  peakRecharge: number;
  usage: number;
  stable: boolean;
  stableAt?: number;
  lastsSeconds?: number;
}

export function rechargeRate(capacity: number, tau: number, fraction: number): number {
  if (tau <= 0) return 0;
  const c = Math.max(0, Math.min(1, fraction));
  return ((10 * capacity) / tau) * (Math.sqrt(c) - c);
}

export interface CapCycle {
  need: number;
  duration: number;
}

function capAfter(capacity: number, tau: number, cap: number, dt: number): number {
  const root = 1 + (Math.sqrt(Math.max(0, cap) / capacity) - 1) * Math.exp((-5 * dt) / tau);
  return capacity * root * root;
}

function discreteLasts(capacity: number, tau: number, cycles: CapCycle[]): number | undefined {
  const active = cycles.filter((c) => c.duration > 0 && c.need !== 0);
  if (!active.length) return undefined;
  const next = active.map(() => 0);
  let cap = capacity;
  let t = 0;
  while (t < 24 * 3600) {
    let i = 0;
    for (let j = 1; j < active.length; j++) if (next[j] < next[i]) i = j;
    cap = capAfter(capacity, tau, cap, next[i] - t);
    t = next[i];
    if (active[i].need > 0 && cap < active[i].need) return t;
    cap = Math.min(capacity, cap - active[i].need);
    next[i] += active[i].duration;
  }
  return undefined;
}

export function simulateCapacitor(capacity: number, tau: number, usage: number, cycles: CapCycle[] = []): CapResult {
  const peakRecharge = capacity > 0 && tau > 0 ? (2.5 * capacity) / tau : 0;
  const base = { capacity, rechargeTime: tau, peakRecharge, usage };
  if (usage <= 0) return { ...base, stable: true, stableAt: 1 };
  if (capacity <= 0 || tau <= 0) return { ...base, stable: false, lastsSeconds: 0 };

  if (usage <= peakRecharge) {
    const k = (usage * tau) / (10 * capacity);
    const s = (1 + Math.sqrt(Math.max(0, 1 - 4 * k))) / 2;
    return { ...base, stable: true, stableAt: s * s };
  }

  const exact = discreteLasts(capacity, tau, cycles);
  if (exact != null) return { ...base, stable: false, lastsSeconds: exact };

  let c = 1;
  let t = 0;
  const dt = 0.25;
  while (c > 0 && t < 24 * 3600) {
    c += ((rechargeRate(capacity, tau, c) - usage) * dt) / capacity;
    t += dt;
  }
  return { ...base, stable: false, lastsSeconds: t };
}
