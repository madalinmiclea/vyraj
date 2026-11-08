import type { AppContext } from '../app/context';
import { panel, loader, alertBox, esc, formatInt, formatNum, button } from '../ui/components';
import { loadJson, saveJson } from '../storage';
import { loginProblem } from '../character/sso';
import { universeNames } from '../character/esi';
import { permissionGate } from '../character/permissions';
import { loadAgents, STANDING_NEEDED, type AgentData } from '../services/agents';
import { loadNpcStandings, canReadNpcStandings, socialSkills, effective, skillFor, corpAccess, type NpcStandings, type SocialSkills, type StandingSkill } from '../services/npcStandings';
import { fold } from '../ui/fold';
import { tx } from '../i18n';

const STATE_KEY = 'eve-pve:standings';

type Tab = 'factions' | 'corps' | 'agents';
interface State { tab: Tab; only: boolean; q: string }

const TABS: { id: Tab; label: string }[] = [
  { id: 'factions', label: tx('Facțiuni') },
  { id: 'corps', label: tx('Corporații') },
  { id: 'agents', label: tx('Agenți') },
];

const SKILL_NAME: Record<Exclude<StandingSkill, ''>, string> = { connections: 'Connections', diplomacy: 'Diplomacy', criminal: 'Criminal Connections' };

const tone = (v: number) => (v <= -2 ? 'danger' : v < 0 ? 'warn' : v >= 5 ? 'ok' : v > 0 ? 'accent' : 'dim');
const num = (v: number | undefined) => (v == null ? `<span class="dim">—</span>` : `<span class="std-val ${tone(v)}">${v > 0 ? '+' : ''}${formatNum(v, 2)}</span>`);
const levelOf = (eff: number) => (eff <= -2 ? 0 : [5, 4, 3, 2].find((l) => eff >= STANDING_NEEDED[l]) ?? 1);
const levelBadge = (l: number) => (l ? `<span class="badge ${l >= 4 ? 'ok' : 'accent'}">L${l}</span>` : `<span class="badge danger">${tx('Blocat')}</span>`);

function baseNeeded(target: number, faction: number, skills: SocialSkills): number {
  const sk = skillFor(Math.max(0, target), faction);
  const kp = sk ? 0.04 * skills[sk] : 0;
  const kd = 0.04 * skills.diplomacy;
  const neg = (target - 10 * kd) / (1 - kd);
  if (neg < 0) return neg;
  return Math.max(0, (target - 10 * kp) / (1 - kp));
}

export function createStandingsPanel(el: HTMLElement, ctx: AppContext, opts: { openAgents: (corp: number, faction: number, level: number) => void }) {
  const state: State = { tab: 'corps', only: true, q: '', ...loadJson<Partial<State>>(STATE_KEY, {}) };
  let visible = false;
  let seq = 0;
  let data: AgentData | null = null;
  let st: NpcStandings | null = null;
  let names = new Map<number, string>();
  const save = () => saveJson(STATE_KEY, state);

  async function load(force = false) {
    if (!visible) return;
    const mine = ++seq;
    const c = ctx.character;
    const title = tx('Standing-uri NPC');
    if (loginProblem(c) || !c.characterId) { el.innerHTML = panel({ title, body: `<p class="dim">${tx('Loghează un caracter EVE ca să vezi standing-urile.')}</p>` }); return; }
    if (!canReadNpcStandings(c.characterId)) { el.innerHTML = panel({ title, body: permissionGate('npcstandings', c.characterId, c.name) }); return; }
    if (!st || force) el.innerHTML = panel({ title, body: loader(tx('Citim standing-urile')) });
    try {
      const [d, s] = await Promise.all([loadAgents(), loadNpcStandings(c.characterId, force)]);
      const missing = [...s.corp.keys(), ...s.faction.keys(), ...s.agent.keys()].filter((id) => !d.corps.has(id) && !d.factions.has(id) && !names.has(id) && !d.agents.some((a) => a.id === id));
      if (missing.length) names = new Map([...names, ...(await universeNames(missing).catch(() => new Map<number, string>()))]);
      if (mine !== seq || !visible) return;
      data = d;
      st = s;
      render();
    } catch (err) {
      if (mine === seq) el.innerHTML = panel({ title, body: alertBox((err as Error).message, 'danger') });
    }
  }

  function render() {
    if (!data || !st) return;
    const d = data;
    const s = st;
    const skills = socialSkills(ctx.sde, ctx.character);
    const terms = fold(state.q).split(/\s+/).filter(Boolean);
    const match = (text: string) => !terms.length || terms.every((t) => fold(text).includes(t));
    const factionName = (id: number) => d.factions.get(id) ?? names.get(id) ?? `#${id}`;
    const corpName = (id: number) => d.corps.get(id)?.name ?? names.get(id) ?? `#${id}`;
    const agentById = new Map(d.agents.map((a) => [a.id, a]));
    const effTip = (base: number | undefined, faction: number) => {
      const sk = skillFor(base ?? 0, faction);
      return sk ? `${SKILL_NAME[sk]} ${skills[sk]}` : '';
    };
    const effCell = (base: number | undefined, faction: number) => `<span title="${esc(effTip(base, faction))}">${num(effective(base, faction, skills))}</span>`;
    const nextCell = (eff: number, faction: number) => {
      const next = [2, 3, 4, 5].find((l) => eff < STANDING_NEEDED[l]);
      if (!next || eff <= -2) return `<span class="dim">—</span>`;
      return `<span class="small">L${next} <span class="dim">${tx('la bază {b}', { b: formatNum(baseNeeded(STANDING_NEEDED[next], faction, skills), 2) })}</span></span>`;
    };

    const agentCorps = new Set(d.agents.filter((a) => a.kind === 0).map((a) => a.corp));
    const factionIds = [...new Set([...d.factions.keys(), ...s.faction.keys()])];
    const factionRows = factionIds
      .filter((f) => match(factionName(f)))
      .map((f) => {
        const eff = effective(s.faction.get(f), f, skills);
        const accs = [...agentCorps].filter((c) => d.corps.get(c)?.faction === f).map((c) => corpAccess(s, skills, c, f)).filter((a) => !a.blocked);
        const top = accs.sort((a, b) => b.level - a.level || b.best - a.best)[0];
        const level = eff <= -2 ? 0 : Math.max(levelOf(eff), top?.level ?? 0);
        const best = eff <= -2 ? eff : Math.max(eff, top?.best ?? eff);
        return { f, eff, level, best };
      })
      .sort((a, b) => b.eff - a.eff || factionName(a.f).localeCompare(factionName(b.f)));

    const corpIds = [...new Set([...agentCorps, ...s.corp.keys()])];
    const corpRows = corpIds.map((c) => {
      const f = d.corps.get(c)?.faction ?? 0;
      return { c, f, acc: corpAccess(s, skills, c, f) };
    }).filter((r) => (!state.only || s.corp.has(r.c) || s.faction.has(r.f)) && match(`${corpName(r.c)} ${factionName(r.f)}`));
    const groups = new Map<number, typeof corpRows>();
    for (const r of corpRows) groups.set(r.f, [...(groups.get(r.f) ?? []), r]);
    const groupOrder = [...groups.keys()].sort((a, b) => effective(s.faction.get(b), b, skills) - effective(s.faction.get(a), a, skills) || factionName(a).localeCompare(factionName(b)));

    const agentRows = [...s.agent.entries()].map(([id, base]) => {
      const a = agentById.get(id);
      const corp = a?.corp ?? 0;
      const f = d.corps.get(corp)?.faction ?? 0;
      return { id, base, a, corp, f, acc: corpAccess(s, skills, corp, f, id) };
    }).filter((r) => match(`${r.a?.name ?? names.get(r.id) ?? ''} ${corpName(r.corp)}`))
      .sort((x, y) => y.base - x.base);

    const logo = (id: number) => `<img class="row-icon" src="https://images.evetech.net/corporations/${id}/logo?size=32" alt="" loading="lazy" />`;
    const agentsBtn = (corp: number, f: number, l: number) => (l && agentCorps.has(corp) ? `<button class="btn ghost sm" data-std-agents="${corp}" data-std-faction="${f}" data-std-level="${l}">${tx('Agenți L{l}', { l })}</button>` : '');

    let table = '';
    if (state.tab === 'factions') {
      table = factionRows.length ? `<div class="wallet-scroll tall"><table class="table compact"><thead><tr><th>${tx('Facțiune')}</th><th class="r">${tx('Standing')}</th><th class="r">${tx('Efectiv')}</th><th class="r">${tx('Agenți deblocați')}</th><th>${tx('Următorul nivel')}</th></tr></thead><tbody>
        ${factionRows.map(({ f, level, best }) => `<tr><td><span class="recon-ship">${logo(f)}<span>${esc(factionName(f))}</span></span></td><td class="r num">${num(s.faction.get(f))}</td><td class="r num">${effCell(s.faction.get(f), f)}</td><td class="r">${levelBadge(level)}</td><td>${nextCell(best, f)}</td></tr>`).join('')}
      </tbody></table></div>` : `<p class="dim">${tx('Nicio facțiune nu se potrivește.')}</p>`;
    } else if (state.tab === 'corps') {
      table = corpRows.length ? `<div class="wallet-scroll tall"><table class="table compact"><thead><tr><th>${tx('Corporație')}</th><th class="r">${tx('Standing')}</th><th class="r">${tx('Efectiv')}</th><th class="r">${tx('Facțiune')}</th><th class="r">${tx('Agenți deblocați')}</th><th>${tx('Următorul nivel')}</th><th></th></tr></thead><tbody>
        ${groupOrder.map((f) => `<tr class="std-group"><td colspan="7">${f ? `${logo(f)}${esc(factionName(f))}` : tx('Fără facțiune')} <span class="dim">${num(effective(s.faction.get(f), f, skills))}</span></td></tr>
          ${groups.get(f)!.sort((a, b) => b.acc.best - a.acc.best || corpName(a.c).localeCompare(corpName(b.c))).map(({ c, acc }) => `<tr><td><span class="recon-ship">${logo(c)}<span>${esc(corpName(c))}</span></span></td><td class="r num">${num(s.corp.get(c))}</td><td class="r num">${effCell(s.corp.get(c), f)}</td><td class="r num">${num(acc.faction)}</td><td class="r">${levelBadge(acc.level)}</td><td>${acc.blocked ? `<span class="small dim">${tx('standing -2 sau mai mic')}</span>` : nextCell(acc.best, f)}</td><td class="r">${agentsBtn(c, f, acc.level)}</td></tr>`).join('')}`).join('')}
      </tbody></table></div>` : `<p class="dim">${tx('Nicio corporație nu se potrivește.')}</p>`;
    } else {
      table = agentRows.length ? `<div class="wallet-scroll tall"><table class="table compact"><thead><tr><th>${tx('Agent')}</th><th>${tx('Corporație')}</th><th class="r">${tx('Nivel')}</th><th class="r">${tx('Standing')}</th><th class="r">${tx('Efectiv')}</th><th class="r">${tx('Acces')}</th></tr></thead><tbody>
        ${agentRows.map(({ id, base, a, corp, f, acc }) => `<tr><td><span class="recon-ship"><img class="row-icon" src="https://images.evetech.net/characters/${id}/portrait?size=32" alt="" loading="lazy" /><span>${esc(a?.name ?? names.get(id) ?? `#${id}`)}</span></span></td><td>${corp ? esc(corpName(corp)) : '—'}</td><td class="r num">${a ? `L${a.level}` : '—'}</td><td class="r num">${num(base)}</td><td class="r num">${effCell(base, f)}</td><td class="r">${a ? (acc.blocked ? levelBadge(0) : acc.level >= a.level ? `<span class="badge ok">${tx('Da')}</span>` : `<span class="badge warn">${tx('Nu')}</span>`) : '—'}</td></tr>`).join('')}
      </tbody></table></div>` : `<p class="dim">${tx('Niciun agent cu standing personal.')}</p>`;
    }

    const unlocked = [5, 4, 3, 2].map((l) => ({ l, n: corpIds.filter((c) => agentCorps.has(c) && corpAccess(s, skills, c, d.corps.get(c)?.faction ?? 0).level >= l).length }));
    el.innerHTML = panel({
      title: tx('Standing-uri NPC'),
      count: tx('{f} facțiuni · {c} corporații · {a} agenți', { f: formatInt(s.faction.size), c: formatInt(s.corp.size), a: formatInt(s.agent.size) }),
      actions: button(tx('Reîncarcă'), { iconName: 'refresh', cls: 'ghost sm', attrs: 'data-std-refresh' }),
      body: `<div class="std-tiles">
          ${(['connections', 'diplomacy', 'criminal'] as const).map((k) => `<div class="std-tile"><span class="label">${SKILL_NAME[k]}</span><span class="value">${skills[k]}</span></div>`).join('')}
          ${unlocked.map(({ l, n }) => `<div class="std-tile ${n ? 'on' : ''}"><span class="label">${tx('Corporații cu L{l}', { l })}</span><span class="value">${formatInt(n)}</span></div>`).join('')}
        </div>
        <div class="pve-filters">
          <div class="chip-row">${TABS.map((t) => `<button class="chip-btn ${t.id === state.tab ? 'active' : ''}" data-std-tab="${t.id}">${t.label}</button>`).join('')}</div>
          ${state.tab !== 'corps' ? '' : `<label class="check"><input type="checkbox" id="stdOnly" ${state.only ? 'checked' : ''} /> ${tx('Doar cu standing')}</label>`}
          <label class="field"><input class="input sm" id="stdSearch" placeholder="${esc(tx('Caută facțiune, corporație sau agent'))}" value="${esc(state.q)}" /></label>
        </div>
        ${table}`,
    });
    const search = el.querySelector<HTMLInputElement>('#stdSearch');
    let t = 0;
    search?.addEventListener('input', () => {
      clearTimeout(t);
      t = window.setTimeout(() => {
        state.q = search.value;
        save();
        const pos = search.selectionStart;
        render();
        const next = el.querySelector<HTMLInputElement>('#stdSearch');
        next?.focus();
        if (next && pos != null) next.setSelectionRange(pos, pos);
      }, 200);
    });
  }

  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const tab = t.closest<HTMLElement>('[data-std-tab]');
    if (tab) { state.tab = tab.dataset.stdTab as Tab; save(); render(); return; }
    if (t.closest('[data-std-refresh]')) { load(true); return; }
    const ag = t.closest<HTMLElement>('[data-std-agents]');
    if (ag) opts.openAgents(Number(ag.dataset.stdAgents), Number(ag.dataset.stdFaction), Number(ag.dataset.stdLevel));
  });
  el.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id !== 'stdOnly') return;
    state.only = t.checked;
    save();
    render();
  });

  ctx.onCharacterChange(() => { st = null; if (visible) load(); });

  return {
    show() { visible = true; load(); },
    hide() { visible = false; seq++; },
  };
}
