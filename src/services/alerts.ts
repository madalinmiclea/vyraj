import { loadJson, saveJson } from '../storage';
import { fetchPrices } from './market';
import { repeatAfter } from './esiClient';
import { compactISK, toast } from '../ui/components';
import { tx } from '../i18n';
import { notify } from './pwa';

export interface PriceAlert {
  id: string;
  typeId: number;
  name: string;
  side: 'sell' | 'buy';
  op: 'below' | 'above';
  price: number;
  current?: number;
  checkedAt?: number;
  triggeredAt?: number;
}

const KEY = 'eve-tools:alerts';
export const ALERTS_EVENT = 'eve-alerts-changed';

export const loadAlerts = () => loadJson<PriceAlert[]>(KEY, []);

export function saveAlerts(list: PriceAlert[]) {
  saveJson(KEY, list);
  window.dispatchEvent(new Event(ALERTS_EVENT));
}

export function addAlert(a: Omit<PriceAlert, 'id'>) {
  saveAlerts([...loadAlerts(), { ...a, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }]);
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
}

export const hit = (a: PriceAlert, value: number) => value > 0 && (a.op === 'below' ? value <= a.price : value >= a.price);

async function runCheck() {
  const ids = loadAlerts().map((a) => a.typeId);
  if (!ids.length) return;
  const prices = await fetchPrices(ids, { fresh: true });
  const now = Date.now();
  const list = loadAlerts();
  const fired: PriceAlert[] = [];
  for (const a of list) {
    const p = prices.get(a.typeId);
    if (!p) continue;
    a.current = a.side === 'sell' ? p.sellMin : p.buyMax;
    a.checkedAt = now;
    if (!a.triggeredAt && hit(a, a.current)) { a.triggeredAt = now; fired.push(a); }
    else if (a.triggeredAt && !hit(a, a.current)) a.triggeredAt = undefined;
  }
  saveAlerts(list);
  for (const a of fired) {
    const text = `${a.name}: ${a.side} ${compactISK(a.current ?? 0)} ISK (${a.op === 'below' ? '≤' : '≥'} ${compactISK(a.price)})`;
    toast(text);
    notify(tx('Alertă preț Jita'), { body: text, tag: `vyraj-alert-${a.id}` });
  }
}

export async function checkAlerts() {
  if (navigator.locks) return navigator.locks.request('vyraj-price-alerts', () => runCheck());
  return runCheck();
}

export function startAlertWatcher() {
  const run = () => checkAlerts().catch(() => {});
  run();
  repeatAfter(run, 5 * 60 * 1000);
}
