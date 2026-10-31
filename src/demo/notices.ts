import { tx } from '../i18n';
import type { Notice } from '../services/notices';
import type { GameNotice } from '../services/gameNotices';

const MIN = 60_000;
const HOUR = 60 * MIN;

export function demoGameNotices(now: number): GameNotice[] {
  const rows: [string, number][] = [
    ['StructureUnderAttack', 25 * MIN],
    ['StructureLostShields', 50 * MIN],
    ['CorpAppNewMsg', 3 * HOUR],
    ['KillReportFinalBlow', 5 * HOUR],
    ['InsurancePayoutMsg', 9 * HOUR],
    ['StructureFuelAlert', 20 * HOUR],
    ['WarDeclared', 30 * HOUR],
    ['BountyClaimMsg', 44 * HOUR],
    ['CharLeftCorpMsg', 60 * HOUR],
    ['SkyhookUnderAttack', 70 * HOUR],
  ];
  return rows.map(([type, ago], i) => ({ notification_id: 2_400_000_100 - i, sender_id: 98000001, sender_type: 'corporation', timestamp: new Date(now - ago).toISOString(), type, is_read: i > 2 }));
}

export function demoNoticeLog(now: number, pilot: string): Notice[] {
  const n = (kind: Notice['kind'], ago: number, title: string, body: string, url: string, read = true): Notice => ({ id: `demo-${kind}-${ago}`, kind, at: now - ago, title, body, url, read });
  return [
    n('nearby', 4 * MIN, tx('Kill PvP în {system}', { system: 'Venal' }), `Vexor Navy Issue · 212M ISK · ${tx('în sistemul tău ({who})', { who: pilot })}`, '#/recon', false),
    n('filled', 18 * MIN, tx('Ți s-a vândut din ordin · {name}', { name: pilot }), `Large Shield Extender II: 4 × 1.739.000,00 ISK = 6,96M ISK`, '#/orders', false),
    n('gStructure', 25 * MIN, `${tx('Structură atacată')} · ${pilot}`, 'Structure Under Attack', '#/notifications', false),
    n('outbid', 2 * HOUR, tx('Ți-a dat cineva outbid'), 'Nanite Repair Paste (buy) 10.910,00 ISK → 10,92K', '#/orders'),
    n('skill', 3 * HOUR, tx('Skill terminat · {name}', { name: pilot }), 'Drones V', '#/character'),
    n('filled', 6 * HOUR, tx('Ordin de cumpărare umplut · {name}', { name: pilot }), `Hammerhead II: 14 × 532.000,00 ISK = 7,45M ISK`, '#/orders'),
    n('mail', 8 * HOUR, tx('Mail nou · {name}', { name: pilot }), 'Rodna Collective: Ops duminică 20:00', '#/mail'),
    n('industry', 26 * HOUR, tx('Job de industrie gata · {name}', { name: pilot }), 'Hobgoblin II × 10', '#/industry'),
    n('expired', 30 * HOUR, tx('Ordin expirat · {name}', { name: pilot }), `Ogre II (sell) · ${tx('rămase {n} la {price}', { n: '3', price: '1.412.000,00 ISK' })}`, '#/orders'),
    n('pi', 40 * HOUR, tx('Extractor PI oprit · {name}', { name: pilot }), tx('{planet}: extractorul de {product} se oprește.', { planet: 'Venal III', product: 'Base Metals' }), '#/pi'),
  ];
}
