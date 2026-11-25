import type { AppContext } from '../app/context';
import { openModal, loader, alertBox, esc, formatInt, formatNum, compactISK, badge, panel } from '../ui/components';
import { icon } from '../ui/icons';
import { tx, locale } from '../i18n';
import { typeIconUrl } from '../services/market';
import { allEveItems } from '../data/items';
import { portraitUrl } from '../character/esi';
import { killDetail, resolveNames, cachedName, isGateLocation, displaySec, secClass, type EsiKillAttacker, type EsiKillItem } from '../services/recon';
import type { NavMap } from '../services/navigation';

const SLOTS: [string, (f: number) => boolean][] = [
  [tx('Sloturi high'), (f) => f >= 27 && f <= 34],
  [tx('Sloturi medii'), (f) => f >= 19 && f <= 26],
  [tx('Sloturi low'), (f) => f >= 11 && f <= 18],
  [tx('Rig-uri'), (f) => f >= 92 && f <= 99],
  [tx('Subsisteme'), (f) => f >= 125 && f <= 132],
  [tx('Hangar drone'), (f) => f === 87],
  [tx('Hangar fighteri'), (f) => f === 158 || (f >= 159 && f <= 163)],
  [tx('Implanturi'), (f) => f === 89],
  [tx('Cargo'), (f) => f === 5],
  [tx('Altele'), () => true],
];

const logo = (kind: 'corporations' | 'alliances', id: number) => `<img class="row-icon" src="https://images.evetech.net/${kind}/${id}/logo?size=32" alt="" />`;
const zkb = (kind: string, id: number, text: string) => `<a class="ext-link" href="https://zkillboard.com/${kind}/${id}/" target="_blank" rel="noopener noreferrer">${text}</a>`;

export async function openKillDetail(ctx: AppContext, map: NavMap | null, id: number, hash: string) {
  const modal = openModal(tx('Detalii kill'), loader(tx('Încarc kill-ul')), { wide: true });
  modal.querySelector('.modal')!.classList.add('kd-modal');
  const body = modal.querySelector<HTMLElement>('.panel-body')!;
  try {
    const { km, zkb: z } = await killDetail(id, hash);
    const items = km.victim.items ?? [];
    const flat = (list: EsiKillItem[]): EsiKillItem[] => list.flatMap((i) => [i, ...flat(i.items ?? [])]);
    const typeIds = [km.victim.ship_type_id, ...km.attackers.flatMap((a) => [a.ship_type_id ?? 0, a.weapon_type_id ?? 0]), ...flat(items).map((i) => i.item_type_id)].filter(Boolean);
    let names: Map<number, string> | null = null;
    const local = (t: number) => { names ??= new Map(allEveItems.map((i) => [i.t, i.n.trim()])); return ctx.sde.types.get(t)?.name ?? names.get(t); };
    const ids = [km.victim.character_id, km.victim.corporation_id, km.victim.alliance_id, km.victim.faction_id, ...km.attackers.flatMap((a) => [a.character_id, a.corporation_id, a.alliance_id, a.faction_id]), ...typeIds.filter((t) => !local(t))].filter((x): x is number => !!x && !cachedName(x));
    if (ids.length) await resolveNames([...new Set(ids)]).catch(() => null);
    if (!modal.isConnected) return;
    const typeName = (t?: number) => (t ? local(t) ?? (cachedName(t) || `#${t}`) : '—');
    const name = (x?: number) => (x ? cachedName(x) || `#${x}` : '');
    const typeCell = (t?: number) => (t ? `<span class="recon-ship"><img class="row-icon" src="${typeIconUrl(t, 32)}" alt="" /><span>${esc(typeName(t))}</span></span>` : '<span class="dim">—</span>');
    const who = (p: { character_id?: number; corporation_id?: number; alliance_id?: number; faction_id?: number }) => `<div class="kd-who">
        ${p.corporation_id ? `<span>${logo('corporations', p.corporation_id)}${zkb('corporation', p.corporation_id, esc(name(p.corporation_id)))}</span>` : ''}
        ${p.alliance_id ? `<span>${logo('alliances', p.alliance_id)}${zkb('alliance', p.alliance_id, esc(name(p.alliance_id)))}</span>` : ''}
        ${p.faction_id && !p.alliance_id ? `<span class="dim">${esc(name(p.faction_id))}</span>` : ''}
      </div>`;
    const v = km.victim;
    const s = map?.systems.get(km.solar_system_id);
    const time = Date.parse(km.killmail_time);
    const players = km.attackers.filter((a) => a.character_id);
    const total = km.attackers.reduce((n, a) => n + a.damage_done, 0) || 1;
    const attackers = [...km.attackers].sort((a, b) => b.damage_done - a.damage_done);
    const labels = [
      z?.solo ? badge('solo', 'gold') : '',
      z?.npc ? badge(tx('Doar NPC')) : '',
      z?.awox ? badge('awox', 'danger') : '',
      isGateLocation(z?.locationID) ? badge(tx('la poartă'), 'warn') : '',
    ].join('');
    const groups = new Map<string, { id: number; alliance: boolean; n: number; dmg: number }>();
    for (const a of players) {
      const gid = a.alliance_id ?? a.corporation_id ?? 0;
      const key = a.alliance_id ? `a${gid}` : `c${gid}`;
      const g = groups.get(key) ?? { id: gid, alliance: !!a.alliance_id, n: 0, dmg: 0 };
      g.n++;
      g.dmg += a.damage_done;
      groups.set(key, g);
    }
    const shipsUsed = new Map<number, number>();
    for (const a of km.attackers) if (a.ship_type_id) shipsUsed.set(a.ship_type_id, (shipsUsed.get(a.ship_type_id) ?? 0) + 1);
    const attackerRow = (a: EsiKillAttacker) => `<tr class="${a.final_blow ? 'kd-final' : ''}">
        <td>${a.character_id ? `<span class="recon-ship"><img class="row-icon round" src="${portraitUrl(a.character_id, 32)}" alt="" />${zkb('character', a.character_id, esc(name(a.character_id)))}</span>` : `<span class="dim">${esc(a.faction_id ? name(a.faction_id) : 'NPC')}</span>`}${who({ ...a, character_id: undefined })}</td>
        <td>${typeCell(a.ship_type_id)}</td>
        <td>${a.weapon_type_id && a.weapon_type_id !== a.ship_type_id ? typeCell(a.weapon_type_id) : '<span class="dim">—</span>'}</td>
        <td class="r num">${formatInt(a.damage_done)}<span class="kd-bar"><i style="width:${(a.damage_done / total) * 100}%"></i></span></td>
        <td class="r num ${secClass(a.security_status)}">${formatNum(a.security_status, 1)}</td>
        <td>${a.final_blow ? badge(tx('Lovitura finală'), 'danger') : ''}</td>
      </tr>`;
    const used = new Set<EsiKillItem>();
    const slotBlocks = SLOTS.map(([label, test]) => {
      const list = items.filter((i) => !used.has(i) && test(i.flag));
      list.forEach((i) => used.add(i));
      if (!list.length) return '';
      return `<div class="kd-slot"><div class="label">${label}</div>${list.map((i) => {
        const drop = i.quantity_dropped ?? 0, lost = i.quantity_destroyed ?? 0;
        return `<div class="kd-item ${drop ? 'drop' : 'lost'}"><img class="row-icon" src="${typeIconUrl(i.item_type_id, 32)}" alt="" /><span>${esc(typeName(i.item_type_id))}</span>${drop + lost > 1 ? `<span class="num dim">×${formatInt(drop + lost)}</span>` : ''}<span class="small ${drop ? 'ok-text' : 'neg-text'}">${drop ? tx('lăsat') : tx('distrus')}</span></div>`;
      }).join('')}</div>`;
    }).join('');
    body.innerHTML = `<div class="kd-head">
        <img class="kd-render" src="https://images.evetech.net/types/${v.ship_type_id}/render?size=128" alt="" />
        <div class="kd-victim">
          <h3>${esc(typeName(v.ship_type_id))} <span class="dim small">${esc(ctx.sde.types.get(v.ship_type_id)?.groupName ?? '')}</span></h3>
          ${v.character_id ? `<div class="recon-ship"><img class="row-icon round" src="${portraitUrl(v.character_id, 32)}" alt="" />${zkb('character', v.character_id, esc(name(v.character_id)))}</div>` : ''}
          ${who(v)}
        </div>
        <div class="kd-where">
          <div>${s ? `<span class="num ${secClass(s.sec)}">${formatNum(displaySec(s.sec), 1)}</span> ${zkb('system', s.id, esc(s.name))} <span class="dim">· ${esc(map!.region(s))}</span>` : `#${km.solar_system_id}`}</div>
          <div class="dim small">${new Date(time).toLocaleString(locale, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
          <div>${labels}</div>
          <div>${zkb('kill', id, `zKillboard ${icon('external')}`)}</div>
        </div>
      </div>
      <div class="history-kpis">
        <div><span class="label">${tx('Valoare totală')}</span><span class="value">${z ? compactISK(z.totalValue) : '—'}</span></div>
        <div><span class="label">${tx('Distrus')}</span><span class="value neg-text">${z?.destroyedValue != null ? compactISK(z.destroyedValue) : '—'}</span></div>
        <div><span class="label">${tx('Lăsat')}</span><span class="value ok-text">${z?.droppedValue != null ? compactISK(z.droppedValue) : '—'}</span></div>
        <div><span class="label">${tx('Daune primite')}</span><span class="value">${formatInt(v.damage_taken)}</span></div>
        <div><span class="label">${tx('Atacatori')}</span><span class="value">${players.length}${km.attackers.length > players.length ? ` <span class="dim small">+ ${km.attackers.length - players.length} NPC</span>` : ''}</span></div>
        ${z?.points != null ? `<div><span class="label">${tx('Puncte')}</span><span class="value">${formatInt(z.points)}</span></div>` : ''}
      </div>
      <div class="kd-grid">
        ${panel({ title: tx('Grupări atacatori'), body: `<ul class="idea-list">${[...groups.values()].sort((a, b) => b.dmg - a.dmg).map((g) => `<li>${g.id ? logo(g.alliance ? 'alliances' : 'corporations', g.id) : ''}<span class="idea-name">${esc(name(g.id) || '—')}<small class="dim">${g.alliance ? tx('alianță') : tx('corporație')}</small></span><span class="idea-val num">${g.n} <small class="dim">${formatNum((g.dmg / total) * 100, 0)}%</small></span></li>`).join('') || '<li class="dim">—</li>'}</ul>` })}
        ${panel({ title: tx('Nave atacatori'), body: `<ul class="idea-list">${[...shipsUsed].sort((a, b) => b[1] - a[1]).map(([t, n]) => `<li>${typeCell(t)}<span class="idea-val num">${n}</span></li>`).join('') || '<li class="dim">—</li>'}</ul>` })}
      </div>
      ${panel({ title: tx('Atacatori'), count: km.attackers.length, body: `<div class="table-scroll"><table class="table compact kd-attackers"><thead><tr><th>${tx('Pilot')}</th><th>${tx('Navă')}</th><th>${tx('Armă')}</th><th class="r">${tx('Daune')}</th><th class="r">Sec</th><th></th></tr></thead><tbody>${attackers.map(attackerRow).join('')}</tbody></table></div>` })}
      ${slotBlocks ? panel({ title: tx('Fit victimă'), body: `<div class="kd-fit">${slotBlocks}</div>` }) : ''}`;
  } catch (err) {
    if (modal.isConnected) body.innerHTML = alertBox((err as Error).message);
  }
}
