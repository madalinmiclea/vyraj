import type { AppContext } from '../app/context';
import { panel, loader, alertBox, esc, formatInt, formatNum, formatISK, dataStamp, button, confirmDialog } from '../ui/components';
import { loadJson, saveJson } from '../storage';
import { loginProblem } from '../character/sso';
import { permissionGate } from '../character/permissions';
import { loadMap, displaySec, secClass, type NavMap } from '../services/navigation';
import { pveOrigin, originBar, bindOrigin, type Origin } from '../services/pveOrigin';
import { loadAgents, type AgentData } from '../services/agents';
import { loadNpcStandings, cachedNpcStandings, canReadNpcStandings, socialSkills, effective } from '../services/npcStandings';
import { fetchPrices, pricesAt, typeIconUrl, type Aggregates } from '../services/market';
import { loadCosmos, loadDone, saveDone, doneKey, WIKI, type CosmosData, type CosmosLine, type CosmosAgent, type CosmosSite, type CosmosItem, type CosmosSec } from '../services/cosmos';
import { fold } from '../ui/fold';
import { openCosmosAgent } from './cosmosAgent';
import { tx } from '../i18n';

const STATE_KEY = 'eve-pve:cosmos';

type Tab = 'agents' | 'sites' | 'items';
interface State { line: string; tab: Tab; sec: CosmosSec | ''; hide: boolean; q: string }

const SEC_LABEL: Record<CosmosSec, string> = { high: 'High-sec', low: 'Low-sec', null: 'Null-sec' };

const wiki = (w: string | undefined, text: string) => (w ? `<a href="${esc(WIKI + w)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>` : esc(text));

export interface CosmosLineSummary { id: string; name: string; kind: 'empire' | 'pirate'; sum: number; total: number }

export function createCosmosPanel(el: HTMLElement, ctx: AppContext, opts: { openGuide: () => void; onRender?: (lines: CosmosLineSummary[], active: string) => void }) {
  const state: State = { line: 'caldari', tab: 'agents', sec: '', hide: false, q: '', ...loadJson<Partial<State>>(STATE_KEY, {}) };
  let visible = false;
  let seq = 0;
  let data: CosmosData | null = null;
  let map: NavMap | null = null;
  let agentsDb: AgentData | null = null;
  let origin: Origin = { system: null, esi: false, needScope: false };
  let prices = new Map<number, Aggregates>();
  let pricing = false;
  const save = () => saveJson(STATE_KEY, state);
  const charKey = () => ctx.character.id;
  let done = loadDone(charKey());
  const logged = () => !loginProblem(ctx.character) && !!ctx.character.characterId;

  async function load() {
    if (!visible) return;
    const mine = ++seq;
    if (!data) el.innerHTML = panel({ title: 'COSMOS', body: loader(tx('Încarc liniile COSMOS')) });
    try {
      const [d, m, a] = await Promise.all([loadCosmos(), loadMap(), loadAgents()]);
      origin = await pveOrigin(ctx, m);
      if (mine !== seq || !visible) return;
      data = d;
      map = m;
      agentsDb = a;
      if (!d.lines.some((l) => l.id === state.line)) state.line = d.lines[0].id;
      render();
      const c = ctx.character;
      if (logged() && canReadNpcStandings(c.characterId!) && !cachedNpcStandings(c.characterId!)) {
        loadNpcStandings(c.characterId!).then(() => { if (mine === seq && visible) render(); }).catch(() => {});
      }
      const types = marketTypes();
      if (types.length && pricesAt(types)) loadPrices(false);
    } catch (err) {
      if (mine === seq) el.innerHTML = panel({ title: 'COSMOS', body: alertBox((err as Error).message, 'danger') });
    }
  }

  const marketTypes = () => [...new Set(data?.lines.flatMap((l) => l.items.filter((i) => i.m && i.t).map((i) => i.t!)) ?? [])];

  async function loadPrices(fresh: boolean) {
    const types = marketTypes();
    if (!types.length || pricing) return;
    pricing = true;
    if (visible) render();
    try {
      prices = await fetchPrices(types, { fresh });
    } catch {
      prices = new Map();
    } finally {
      pricing = false;
      if (visible) render();
    }
  }

  const line = (): CosmosLine => data!.lines.find((l) => l.id === state.line) ?? data!.lines[0];

  function lineStats(l: CosmosLine) {
    const a = l.agents.filter((x) => done.a.has(doneKey(l.id, x.n))).length;
    const s = l.sites.filter((x) => done.s.has(doneKey(l.id, x.n))).length;
    const i = l.items.filter((x) => done.i.has(doneKey(l.id, x.n))).length;
    return { a, s, i, total: l.agents.length + l.sites.length + l.items.length, sum: a + s + i };
  }

  function factionName(a: CosmosAgent) {
    if (a.fn && a.fn !== '—') return a.fn;
    return (a.f && agentsDb?.factions.get(a.f)) || '—';
  }

  function render() {
    if (!data || !map) return;
    const m = map;
    const l = line();
    const c = ctx.character;
    const st = logged() ? cachedNpcStandings(c.characterId!) : null;
    const skills = socialSkills(ctx.sde, c);
    const dist = origin.system ? m.gateDistances(origin.system.id, 80) : null;
    const terms = fold(state.q).split(/\s+/).filter(Boolean);
    const match = (text: string) => !terms.length || terms.every((t) => fold(text).includes(t));
    const secs = (['high', 'low', 'null'] as CosmosSec[]).filter((s) => l.agents.some((a) => a.sec === s) || l.sites.some((x) => x.sec === s));
    if (state.sec && !secs.includes(state.sec)) state.sec = '';
    if (state.tab === 'items' && !l.items.length) state.tab = 'agents';
    const secOk = (s: CosmosSec) => !state.sec || state.sec === s;
    const stats = lineStats(l);

    const sysCell = (id: number, fallback = '') => {
      const s = id ? m.systems.get(id) : undefined;
      if (!s) return fallback ? esc(fallback) : '—';
      return `${esc(s.name)} <span class="sec ${secClass(s.sec)}">${formatNum(displaySec(s.sec), 1)}</span>`;
    };
    const jumps = (id: number) => (dist && id ? (dist.has(id) ? String(dist.get(id)) : '80+') : '—');
    const chk = (kind: 'a' | 's' | 'i', name: string) => `<input type="checkbox" class="cos-chk" data-cos="${kind}" data-cos-name="${esc(name)}" ${done[kind].has(doneKey(l.id, name)) ? 'checked' : ''} aria-label="${esc(tx('{name} terminat', { name }))}" />`;
    const isDone = (kind: 'a' | 's' | 'i', name: string) => done[kind].has(doneKey(l.id, name));

    const myStanding = (a: CosmosAgent) => {
      if (!st || !a.f) return null;
      return effective(st.faction.get(a.f), a.f, skills);
    };

    const agentRow = (a: CosmosAgent) => {
      const mine = myStanding(a);
      const req = a.std ?? null;
      const ok = mine == null ? null : req == null ? true : mine >= req;
      const tags = [
        a.ch ? `<span class="badge accent">${esc(a.ch)}</span>` : '',
        a.rep ? `<span class="badge gold" title="${esc(a.rep === 1 ? tx('Misiune repetabilă') : tx('Misiune repetabilă: {m}', { m: a.rep }))}">${tx('Repetabil')}</span>` : '',
      ].join(' ');
      const portrait = a.id ? `<img class="row-icon round" src="https://images.evetech.net/characters/${a.id}/portrait?size=32" alt="" loading="lazy" />` : '';
      return `<tr class="${isDone('a', a.n) ? 'cos-done' : ''}">
        <td class="cos-chk-cell">${chk('a', a.n)}</td>
        <td><span class="recon-ship">${portrait}<button class="link cos-agent" data-cos-agent="${esc(a.n)}">${esc(a.n)}</button></span> ${tags}</td>
        <td class="r num">${a.lvl ? `L${a.lvl}` : '—'}</td>
        <td class="r num">${a.mc ?? '—'}</td>
        <td class="r num">${req != null ? formatNum(req, 2) : `<span class="dim">${tx('fără')}</span>`}</td>
        ${st ? `<td class="r num">${mine == null ? '—' : `<span class="badge ${ok ? 'ok' : 'warn'}">${formatNum(mine, 2)}</span>`}</td>` : ''}
        <td>${esc(factionName(a))}</td>
        <td>${sysCell(a.s)}${a.site ? `<div class="small dim">${esc(a.site)}</div>` : ''}</td>
        <td class="r num">${jumps(a.s)}</td>
        <td class="small">${a.prev ? esc(a.prev) : '<span class="dim">—</span>'}</td>
      </tr>`;
    };

    const siteRow = (x: CosmosSite) => {
      const here = l.agents.filter((a) => a.site === x.n).length;
      return `<tr class="${isDone('s', x.n) ? 'cos-done' : ''}">
        <td class="cos-chk-cell">${chk('s', x.n)}</td>
        <td>${wiki(x.w, x.n)}</td>
        <td class="r num">${x.ded ? esc(x.ded) : '—'}</td>
        <td>${x.type === 'signature' ? `<span class="badge warn">${tx('Semnătură')}</span>` : x.type === 'beacon' ? `<span class="badge">${tx('Beacon')}</span>` : '—'}</td>
        <td>${sysCell(x.s, x.sn)}</td>
        <td class="r num">${jumps(x.s)}</td>
        <td class="mono">${x.sid ? esc(x.sid) : '—'}</td>
        <td class="r num">${here || '—'}</td>
      </tr>`;
    };

    const itemRow = (i: CosmosItem) => {
      const p = i.t ? prices.get(i.t) : undefined;
      const icon = i.t ? `<img class="row-icon" src="${typeIconUrl(i.t, 32)}" alt="" loading="lazy" />` : '';
      const via = i.via === 'market' || i.m ? `<span class="badge ok">${tx('Piață')}</span>` : i.via === 'contracts' ? `<span class="badge">${tx('Contracte')}</span>` : '';
      const req = i.req.map((r) => `<div>${r.a ? `<b>${esc(r.a)}</b> · ` : ''}${wiki(r.w, r.m)}${r.q ? ` <span class="dim">×${r.q}</span>` : ''}</div>`).join('');
      return `<tr class="${isDone('i', i.n) ? 'cos-done' : ''}">
        <td class="cos-chk-cell">${chk('i', i.n)}</td>
        <td><span class="recon-ship">${icon}<span>${esc(i.n)}</span></span>${i.q > 1 ? ` <span class="num dim">×${formatInt(i.q)}</span>` : ''}</td>
        <td>${via} ${i.src && i.src !== 'Market' ? i.src.split('\n').map((x, n) => (n ? esc(x) : wiki(i.sw, x))).join('<br>') : ''}</td>
        <td class="small">${req || '—'}</td>
        <td class="small dim">${i.note ? esc(i.note).replace(/\n/g, '<br>') : '—'}</td>
        <td class="r num">${p?.sellMin ? formatISK(p.sellMin * i.q, 0) : i.m ? (pricing ? '…' : '—') : ''}</td>
      </tr>`;
    };

    const byName = (x: { n: string }, y: { n: string }) => x.n.localeCompare(y.n);
    const lvlOf = new Map(l.agents.map((a) => [a.n, a.lvl ?? 9]));
    const dedOf = (x: CosmosSite) => (x.ded ? parseInt(x.ded, 10) || 99 : 99);
    const siteLvl = (x: CosmosSite) => Math.min(9, ...l.agents.filter((a) => a.site === x.n).map((a) => a.lvl ?? 9));
    const itemLvl = (i: CosmosItem) => Math.min(9, ...i.req.map((r) => (r.a ? lvlOf.get(r.a) ?? 9 : 9)));
    const agents = l.agents.filter((a) => secOk(a.sec) && (!state.hide || !isDone('a', a.n)) && match(`${a.n} ${a.site ?? ''} ${m.systems.get(a.s)?.name ?? ''} ${factionName(a)}`)).sort((x, y) => (x.lvl ?? 9) - (y.lvl ?? 9) || byName(x, y));
    const sites = l.sites.filter((x) => secOk(x.sec) && (!state.hide || !isDone('s', x.n)) && match(`${x.n} ${m.systems.get(x.s)?.name ?? x.sn ?? ''}`)).sort((x, y) => dedOf(x) - dedOf(y) || siteLvl(x) - siteLvl(y) || byName(x, y));
    const items = l.items.filter((i) => (!state.hide || !isDone('i', i.n)) && match(`${i.n} ${i.src ?? ''} ${i.req.map((r) => `${r.a ?? ''} ${r.m}`).join(' ')}`)).sort((x, y) => itemLvl(x) - itemLvl(y) || byName(x, y));

    opts.onRender?.(data.lines.map((x) => ({ id: x.id, name: x.name, kind: x.kind, ...lineStats(x) })), l.id);

    const where = l.where.map(([sec, cons, reg]) => `<span><b>${SEC_LABEL[sec]}</b> ${esc(cons)} · ${esc(reg)}</span>`).join('');
    const pct = stats.total ? Math.round((stats.sum / stats.total) * 100) : 0;
    const tabs: { id: Tab; label: string; n: number; d: number }[] = [
      { id: 'agents', label: tx('Agenți'), n: l.agents.length, d: stats.a },
      { id: 'sites', label: tx('Site-uri'), n: l.sites.length, d: stats.s },
      ...(l.items.length ? [{ id: 'items' as Tab, label: tx('Cumpărături'), n: l.items.length, d: stats.i }] : []),
    ];

    let table = '';
    if (state.tab === 'agents') {
      table = agents.length ? `<div class="wallet-scroll tall"><table class="table compact cos-table"><thead><tr><th></th><th>${tx('Agent')}</th><th class="r">${tx('Nivel')}</th><th class="r">${tx('Misiuni')}</th><th class="r">${tx('Standing cerut')}</th>${st ? `<th class="r">${tx('Standingul tău')}</th>` : ''}<th>${tx('Facțiune')}</th><th>${tx('Locație')}</th><th class="r">${tx('Salturi')}</th><th>${tx('Înainte în lanț')}</th></tr></thead><tbody>${agents.map(agentRow).join('')}</tbody></table></div>` : `<p class="dim">${tx('Niciun agent nu se potrivește.')}</p>`;
    } else if (state.tab === 'sites') {
      table = sites.length ? `<div class="wallet-scroll tall"><table class="table compact cos-table"><thead><tr><th></th><th>${tx('Site')}</th><th class="r">DED</th><th>${tx('Tip')}</th><th>${tx('Sistem')}</th><th class="r">${tx('Salturi')}</th><th>ID</th><th class="r">${tx('Agenți')}</th></tr></thead><tbody>${sites.map(siteRow).join('')}</tbody></table></div>` : `<p class="dim">${tx('Niciun site nu se potrivește.')}</p>`;
    } else {
      const total = items.reduce((sum, i) => sum + (i.t && !isDone('i', i.n) ? (prices.get(i.t)?.sellMin ?? 0) * i.q : 0), 0);
      table = items.length ? `<div class="wallet-scroll tall"><table class="table compact cos-table"><thead><tr><th></th><th>${tx('Item')}</th><th>${tx('Sursă')}</th><th>${tx('Pentru')}</th><th>${tx('Note')}</th><th class="r">${tx('Jita')}</th></tr></thead><tbody>${items.map(itemRow).join('')}</tbody>${total ? `<tfoot><tr><td></td><td colspan="4">${tx('Rămas de cumpărat din market')}</td><td class="r num"><b>${formatISK(total, 0)}</b></td></tr></tfoot>` : ''}</table></div>` : `<p class="dim">${tx('Niciun item nu se potrivește.')}</p>`;
    }

    const types = marketTypes();
    const priceAt = types.length ? pricesAt(types) : 0;
    const priceAction = state.tab !== 'items' || !l.items.some((i) => i.m) ? '' : priceAt && prices.size ? dataStamp(priceAt, 'data-cos-prices') : button(pricing ? tx('Se încarcă') : tx('Prețuri Jita'), { iconName: 'refresh', cls: 'ghost sm', attrs: 'data-cos-prices' });

    const mainFaction = (x: CosmosLine) => {
      const n = new Map<number, number>();
      for (const a of x.agents) if (a.f) n.set(a.f, (n.get(a.f) ?? 0) + 1);
      return [...n.entries()].sort((p, q) => q[1] - p[1])[0]?.[0] ?? 0;
    };
    const lineLeft = (x: CosmosLine) => x.agents.some((a) => !done.a.has(doneKey(x.id, a.n)));
    const best = st ? data.lines.filter(lineLeft).map((x) => ({ x, f: mainFaction(x), v: effective(st.faction.get(mainFaction(x)), mainFaction(x), skills) })).sort((p, q) => q.v - p.v)[0] : undefined;
    const prevOk = (a: CosmosAgent) => !a.prev || l.agents.filter((o) => o.n !== a.n && a.prev!.includes(o.n)).every((o) => isDone('a', o.n));
    const open = l.agents.filter((a) => !isDone('a', a.n) && prevOk(a));
    const allowed = (a: CosmosAgent) => a.std == null || (myStanding(a) ?? -99) >= a.std;
    const far = (a: CosmosAgent) => (dist && a.s ? dist.get(a.s) ?? 999 : 999);
    const next = open.filter(allowed).sort((p, q) => (st ? (q.lvl ?? 0) - (p.lvl ?? 0) : 0) || far(p) - far(q) || (p.lvl ?? 9) - (q.lvl ?? 9))[0];
    const blocked = !next ? open.filter((a) => a.std != null).sort((p, q) => p.std! - q.std!)[0] : undefined;
    const steps: string[] = [];
    if (!logged()) steps.push(tx('Loghează un caracter ca să vezi ce agenți poți lua.'));
    if (best && best.x.id !== l.id && best.v > (st && mainFaction(l) ? effective(st.faction.get(mainFaction(l)), mainFaction(l), skills) : -99)) {
      steps.push(`${tx('Linia potrivită pentru tine: {line}, ai {v} la {f}.', { line: `<b>${esc(best.x.name)}</b>`, v: formatNum(best.v, 2), f: esc(agentsDb?.factions.get(best.f) ?? '') })} ${button(tx('Treci la {line}', { line: best.x.name }), { cls: 'sm ghost', attrs: `data-cos-line="${best.x.id}"` })}`);
    }
    if (next) {
      const need = l.items.filter((i) => !isDone('i', i.n) && i.req.some((r) => r.a === next.n));
      const s = next.s ? m.systems.get(next.s) : undefined;
      steps.push(tx('Mergi la {agent} în {where}.', { agent: `<button class="link cos-agent" data-cos-agent="${esc(next.n)}"><b>${esc(next.n)}</b></button>${next.lvl ? ` (L${next.lvl})` : ''}`, where: `${s ? `${esc(s.name)} <span class="sec ${secClass(s.sec)}">${formatNum(displaySec(s.sec), 1)}</span>` : '—'}${next.site ? ` · ${esc(next.site)}` : ''}${dist && next.s ? ` · ${tx('{n} salturi', { n: jumps(next.s) })}` : ''}` }));
      if (need.length) steps.push(`${tx('Ia cu tine:')} ${need.map((i) => `${esc(i.n)}${i.q > 1 ? ` ×${formatInt(i.q)}` : ''}`).join(', ')} ${button(tx('Vezi lista'), { cls: 'sm ghost', attrs: 'data-cos-tab="items"' })}`);
      steps.push(`${tx('Citește lanțul pe wiki înainte să vorbești cu agentul.')} ${button(tx('Am terminat lanțul'), { cls: 'sm', attrs: `data-cos-finish="${esc(next.n)}"` })}`);
    } else if (!open.length) {
      steps.push(tx('Ai terminat linia {line}. Alege alta din meniu.', { line: l.name }));
    } else if (blocked) {
      steps.push(tx('Pentru agenții rămași îți trebuie cel puțin {v} standing la {f}.', { v: formatNum(blocked.std!, 2), f: esc(factionName(blocked)) }));
    }
    const gate = logged() && !canReadNpcStandings(c.characterId!) ? permissionGate('npcstandings', c.characterId!, c.name) : '';
    const nextCard = `<div class="cos-next"><div class="cos-next-head"><b>${tx('Pasul următor')}</b>${button(tx('Ghid pas cu pas'), { cls: 'sm ghost', attrs: 'data-cos-guide' })}</div>${steps.length ? `<ol>${steps.map((x) => `<li>${x}</li>`).join('')}</ol>` : ''}${gate}</div>`;

    el.innerHTML = panel({
      title: `COSMOS ${l.name}`,
      count: tx('{d} din {n} gata', { d: formatInt(stats.sum), n: formatInt(stats.total) }),
      actions: `${priceAction}${button(tx('Resetează linia'), { cls: 'ghost sm', attrs: 'data-cos-reset' })}`,
      body: `<div class="cos-where">${where}</div>
        <div class="cos-meter"><span style="width:${pct}%"></span></div>
        <div class="cos-rules"><span>${tx('Oferta expiră în 7 zile')}</span><span>${tx('Misiune eșuată = lanț pierdut')}</span><span>${tx('Standing de facțiune: L2 {a} · L3 {b} · L4 {c}', { a: '2.0', b: '4.0', c: '6.0' })}</span></div>
        ${nextCard}
        ${originBar(m, origin, 'cosOrigin')}
        <div class="pve-filters">
          <div class="chip-row">${tabs.map((t) => `<button class="chip-btn ${t.id === state.tab ? 'active' : ''}" data-cos-tab="${t.id}">${t.label} <span class="cos-prog">${t.d}/${t.n}</span></button>`).join('')}</div>
          ${state.tab !== 'items' && secs.length > 1 ? `<div class="chip-row"><button class="chip-btn ${!state.sec ? 'active' : ''}" data-cos-sec="">${tx('Toate')}</button>${secs.map((s) => `<button class="chip-btn ${state.sec === s ? 'active' : ''}" data-cos-sec="${s}">${SEC_LABEL[s]}</button>`).join('')}</div>` : ''}
          <label class="check"><input type="checkbox" id="cosHide" ${state.hide ? 'checked' : ''} /> ${tx('Ascunde terminate')}</label>
          <label class="field"><input class="input sm" id="cosSearch" placeholder="${esc(tx('Caută agent, site, sistem sau item'))}" value="${esc(state.q)}" /></label>
        </div>
        ${table}
        <p class="small dim cos-src">${tx('Date din EVE University Wiki, CC BY-SA 4.0')}</p>`,
    });
    bindOrigin(el, m, 'cosOrigin', async () => { origin = await pveOrigin(ctx, m); render(); });
    const search = el.querySelector<HTMLInputElement>('#cosSearch');
    let t = 0;
    search?.addEventListener('input', () => {
      clearTimeout(t);
      t = window.setTimeout(() => {
        state.q = search.value;
        save();
        const pos = search.selectionStart;
        render();
        const next = el.querySelector<HTMLInputElement>('#cosSearch');
        next?.focus();
        if (next && pos != null) next.setSelectionRange(pos, pos);
      }, 200);
    });
  }

  function toggle(kind: 'a' | 's' | 'i', name: string, on: boolean) {
    const l = line();
    const k = doneKey(l.id, name);
    if (on) done[kind].add(k); else done[kind].delete(k);
    if (kind === 'a' && on) {
      const a = l.agents.find((x) => x.n === name);
      const siteAgents = a?.site ? l.agents.filter((x) => x.site === a.site) : [];
      if (a?.site && l.sites.some((x) => x.n === a.site) && siteAgents.every((x) => done.a.has(doneKey(l.id, x.n)))) done.s.add(doneKey(l.id, a.site));
      for (const i of l.items) {
        const who = i.req.map((r) => r.a).filter((x): x is string => !!x);
        if (who.includes(name) && who.every((x) => done.a.has(doneKey(l.id, x)))) done.i.add(doneKey(l.id, i.n));
      }
    }
    saveDone(charKey(), done);
    render();
  }

  el.addEventListener('click', async (e) => {
    const t = e.target as HTMLElement;
    const lineBtn = t.closest<HTMLElement>('[data-cos-line]');
    if (lineBtn) { state.line = lineBtn.dataset.cosLine!; state.sec = ''; save(); render(); return; }
    const tab = t.closest<HTMLElement>('[data-cos-tab]');
    if (tab) { state.tab = tab.dataset.cosTab as Tab; save(); render(); return; }
    const sec = t.closest<HTMLElement>('[data-cos-sec]');
    if (sec) { state.sec = (sec.dataset.cosSec || '') as CosmosSec | ''; save(); render(); return; }
    if (t.closest('[data-cos-prices]')) { loadPrices(!!prices.size); return; }
    if (t.closest('[data-cos-guide]')) { opts.openGuide(); return; }
    const ag = t.closest<HTMLElement>('[data-cos-agent]');
    if (ag && data && map) {
      const l = line();
      const a = l.agents.find((x) => x.n === ag.dataset.cosAgent);
      if (!a) return;
      const c = ctx.character;
      const st = logged() ? cachedNpcStandings(c.characterId!) : null;
      const mine = st && a.f ? effective(st.faction.get(a.f), a.f, socialSkills(ctx.sde, c)) : null;
      const dist = origin.system ? map.gateDistances(origin.system.id, 80) : null;
      const jumps = dist && a.s ? (dist.has(a.s) ? String(dist.get(a.s)) : '80+') : '—';
      openCosmosAgent(a, l, { map, faction: factionName(a), mine, jumps });
      return;
    }
    const fin = t.closest<HTMLElement>('[data-cos-finish]');
    if (fin) { toggle('a', fin.dataset.cosFinish!, true); return; }
    if (t.closest('[data-cos-reset]')) {
      const l = line();
      if (!(await confirmDialog(tx('Ștergi progresul pentru COSMOS {name}?', { name: l.name }), { ok: tx('Resetează'), danger: true }))) return;
      const prefix = `${l.id}|`;
      for (const s of [done.a, done.s, done.i]) for (const k of [...s]) if (k.startsWith(prefix)) s.delete(k);
      saveDone(charKey(), done);
      render();
    }
  });
  el.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id === 'cosHide') { state.hide = t.checked; save(); render(); return; }
    if (t.classList.contains('cos-chk')) toggle(t.dataset.cos as 'a' | 's' | 'i', t.dataset.cosName!, t.checked);
  });

  ctx.onCharacterChange(() => { done = loadDone(charKey()); if (visible) load(); });

  return {
    show() { visible = true; done = loadDone(charKey()); load(); },
    setLine(id: string) { state.line = id; state.sec = ''; save(); if (visible) render(); },
    hide() { visible = false; seq++; },
  };
}
