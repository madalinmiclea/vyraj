import { openModal, esc, formatNum } from '../ui/components';
import { displaySec, secClass, type NavMap } from '../services/navigation';
import { loadCosmosMissions, WIKI, type CosmosAgent, type CosmosLine, type CosmosMission, type Txt } from '../services/cosmos';
import { lang, tx } from '../i18n';

const KIND: Record<string, string> = {
  courier: tx('Curier'),
  combat: tx('Luptă'),
  fetch: tx('Aduci iteme'),
  explore: tx('Explorare'),
  talk: tx('Discuție'),
  trade: tx('Comerț'),
  mining: tx('Minerit'),
};

const DMG: Record<string, [string, string]> = { em: ['EM', 'em'], th: [tx('Termic'), 'thermal'], kin: [tx('Cinetic'), 'kinetic'], exp: [tx('Exploziv'), 'explosive'] };

const t = (x: Txt | undefined) => (x ? esc(lang === 'en' ? x[1] : x[0]) : '');
const dmg = (list: string[] | undefined) => (list ?? []).filter((d) => DMG[d]).map((d) => `<span class="badge mis-dmg ${DMG[d][1]}">${DMG[d][0]}</span>`).join(' ');

function missionCard(m: CosmosMission, i: number, total: number) {
  const line = (label: string, body: string) => (body ? `<div class="cam-row"><span class="label">${label}</span><div>${body}</div></div>` : '');
  return `<li class="cam-mission">
    <div class="cam-dot">${i + 1}</div>
    <div class="cam-card">
      <div class="cam-head"><span class="cam-part">${tx('Misiunea {i} din {n}', { i: i + 1, n: total })}</span>${m.k ? `<span class="badge">${KIND[m.k] ?? esc(m.k)}</span>` : ''}${m.l ? `<span class="badge accent">L${m.l}</span>` : ''}</div>
      <h3 class="cam-title">${esc(m.t)}</h3>
      ${m.goal ? `<p class="cam-goal">${t(m.goal)}</p>` : ''}
      ${m.steps?.length ? `<ol class="cam-steps">${m.steps.map((s) => `<li>${t(s)}</li>`).join('')}</ol>` : ''}
      ${line(tx('Inamici'), m.foes ? esc(m.foes) : '')}
      ${line(tx('Tragi cu'), dmg(m.deal))}
      ${line(tx('Te protejezi de'), dmg(m.resist))}
      ${line(tx('Iteme necesare'), m.need?.length ? m.need.map((n) => `<span class="cam-item">${esc(n)}</span>`).join(' ') : '')}
      ${line(tx('Recompensă'), t(m.reward))}
      ${m.tip ? `<div class="cam-tip">${t(m.tip)}</div>` : ''}
      ${m.brief ? `<details class="cam-brief"><summary>${tx('Briefing-ul agentului')}</summary><p>${esc(m.brief).replace(/\n+/g, '</p><p>')}</p></details>` : ''}
    </div>
  </li>`;
}

export async function openCosmosAgent(a: CosmosAgent, line: CosmosLine, opts: { map: NavMap; faction: string; mine: number | null; jumps: string }) {
  const s = a.s ? opts.map.systems.get(a.s) : undefined;
  const portrait = a.id ? `<img class="cam-portrait" src="https://images.evetech.net/characters/${a.id}/portrait?size=128" alt="" />` : '';
  const ok = opts.mine == null || a.std == null ? null : opts.mine >= a.std;
  const head = `<div class="cam-agent">
      ${portrait}
      <div class="cam-agent-info">
        <div class="cam-agent-name">${esc(a.n)}</div>
        <div class="cam-agent-tags">${a.lvl ? `<span class="badge accent">L${a.lvl}</span>` : ''}<span class="badge">${esc(opts.faction)}</span>${a.ch ? `<span class="badge accent">${esc(a.ch)}</span>` : ''}${a.rep ? `<span class="badge gold">${tx('Repetabil')}</span>` : ''}</div>
        <div class="cam-agent-meta">
          <span>${s ? `${esc(s.name)} <span class="sec ${secClass(s.sec)}">${formatNum(displaySec(s.sec), 1)}</span>` : '—'}${a.site ? ` · ${esc(a.site)}` : ''}${opts.jumps !== '—' ? ` · ${tx('{n} salturi', { n: opts.jumps })}` : ''}</span>
          <span>${tx('Standing cerut')}: <b>${a.std != null ? formatNum(a.std, 2) : tx('fără')}</b>${opts.mine != null ? ` · ${tx('Standingul tău')}: <span class="badge ${ok === false ? 'warn' : 'ok'}">${formatNum(opts.mine, 2)}</span>` : ''}</span>
          ${a.prev ? `<span>${tx('Înainte în lanț')}: <b>${esc(a.prev)}</b></span>` : ''}
        </div>
      </div>
    </div>
    <div class="cam-rule">${tx('Nu vorbi cu agentul până nu ești gata: oferta expiră în 7 zile, iar o misiune pierdută închide tot lanțul.')}</div>`;
  const el = openModal(`${a.n} · COSMOS ${line.name}`, `${head}<div class="cam-body">${`<p class="dim">${tx('Se încarcă')}…</p>`}</div>`, { wide: true });
  el.querySelector('.modal')?.classList.add('cam-modal');
  const body = el.querySelector<HTMLElement>('.cam-body')!;
  const wiki = a.w ? `<a class="btn ghost sm" href="${esc(WIKI + a.w)}" target="_blank" rel="noopener noreferrer">${tx('Pagina agentului pe EVE University Wiki')}</a>` : '';
  try {
    const all = await loadCosmosMissions();
    const d = all[`${line.id}|${a.n}`];
    if (!d?.m.length) {
      body.innerHTML = `<p class="dim">${tx('Nu există încă informații despre misiunile acestui agent.')}</p>${wiki}`;
      return;
    }
    body.innerHTML = `${d.story ? `<p class="cam-story">${t(d.story)}</p>` : ''}<ol class="cam-list">${d.m.map((m, i) => missionCard(m, i, d.m.length)).join('')}</ol><div class="cam-foot">${wiki}</div>`;
  } catch (err) {
    body.innerHTML = `<p class="dim">${esc((err as Error).message)}</p>${wiki}`;
  }
}
