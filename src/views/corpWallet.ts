import type { AppContext } from '../app/context';
import { panel, loader, alertBox, esc, formatInt, compactISK, emptyState, badge } from '../ui/components';
import { loadJson, saveJson } from '../storage';
import { universeNames, portraitUrl } from '../character/esi';
import { permissionGate } from '../character/permissions';
import { entryLabel } from '../services/wallet';
import { corpAccess, corpDivisions, corpJournal, memberTaxes, type CorpJournalEntry, type CorpDivision } from '../services/corpWallet';
import { WALLET_ROLES } from '../services/corporation';
import { tx, locale } from '../i18n';

type Span = 1 | 7 | 30;

interface Ui { division: number; span: Span }

const UI_KEY = 'eve-wallet:corp';
const JOURNAL_ROWS = 200;

const isk = (v: number) => `<span class="num">${compactISK(v)}</span>`;
const signed = (v: number) => `<span class="num ${v >= 0 ? 'up' : 'down'}">${v >= 0 ? '+' : '−'}${compactISK(Math.abs(v))}</span>`;
const dateTime = (ms: number) => new Date(ms).toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export async function renderCorpWallet(body: HTMLElement, ctx: AppContext, characterId: number, alive: () => boolean) {
  const ui = loadJson<Ui>(UI_KEY, { division: 1, span: 30 });
  body.innerHTML = panel({ body: loader(tx('Citim walleturile corporației')) });
  const access = await corpAccess(characterId);
  if (!alive()) return;
  if (access.state === 'scope') { body.innerHTML = panel({ body: permissionGate('corporation', characterId, ctx.character.name) }); return; }
  if (access.state === 'npc') {
    body.innerHTML = panel({ body: emptyState({ title: tx('Corporație NPC'), text: tx('Caracterul e într-o corporație NPC, care nu are walleturi vizibile pentru jucători.'), vy: 'No Kin Treasury', vyText: 'An NPC corporation keeps no treasury a capsuleer may read.' }) });
    return;
  }
  if (access.state === 'role') {
    body.innerHTML = panel({ body: emptyState({ title: tx('Lipsește rolul în corporație'), text: tx('Walleturile corporației se văd doar cu unul dintre rolurile: {roles}. Rolurile tale: {mine}.', { roles: WALLET_ROLES.join(', ').replace(/_/g, ' '), mine: access.roles.length ? access.roles.join(', ').replace(/_/g, ' ') : tx('niciunul') }) }) });
    return;
  }
  const corporationId = access.corporationId;
  let divisions: CorpDivision[];
  try {
    divisions = await corpDivisions(characterId, corporationId);
  } catch (err) {
    if (alive()) body.innerHTML = panel({ body: alertBox((err as Error).message) });
    return;
  }
  if (!divisions.some((d) => d.division === ui.division)) ui.division = divisions[0]?.division ?? 1;
  const journals = new Map<number, CorpJournalEntry[]>();
  const names = new Map<number, string>();
  const divName = (d: CorpDivision) => d.name || (d.division === 1 ? tx('Master Wallet') : tx('Diviziunea {n}', { n: d.division }));

  async function journalOf(division: number) {
    let hit = journals.get(division);
    if (!hit) {
      hit = await corpJournal(characterId, corporationId, division);
      journals.set(division, hit);
      const ids = [corporationId, ...hit.flatMap((e) => [e.first_party_id, e.second_party_id])].filter((x): x is number => !!x && !names.has(x));
      const got = await universeNames([...new Set(ids)], characterId).catch(() => new Map<number, string>());
      for (const [id, n] of got) names.set(id, n);
    }
    return hit;
  }

  async function draw() {
    body.innerHTML = panel({ body: loader(tx('Citim jurnalul corporației')) });
    let master: CorpJournalEntry[];
    let journal: CorpJournalEntry[];
    try {
      [master, journal] = await Promise.all([journalOf(1), journalOf(ui.division)]);
    } catch (err) {
      if (alive()) body.innerHTML = panel({ body: alertBox((err as Error).message) });
      return;
    }
    if (!alive()) return;
    const from = Date.now() - ui.span * 86_400_000;
    const taxes = memberTaxes(master, corporationId, from);
    const recent = journal.filter((e) => Date.parse(e.date) >= from);
    const income = recent.reduce((a, e) => a + Math.max(0, e.amount ?? 0), 0);
    const spent = recent.reduce((a, e) => a + Math.min(0, e.amount ?? 0), 0);
    const total = divisions.reduce((a, d) => a + d.balance, 0);
    const corpName = names.get(corporationId) ?? tx('Corporația');
    const span = `<div class="advice-sort">${([1, 7, 30] as Span[]).map((s) => `<button class="chip-btn ${ui.span === s ? 'active' : ''}" data-cw-span="${s}">${s === 1 ? tx('24 h') : tx('{n} zile', { n: s })}</button>`).join('')}</div>`;
    const top = taxes.members.slice(0, 40);
    const party = (id?: number) => (id ? esc(names.get(id) ?? String(id)) : '—');
    body.innerHTML = `<div class="stack">
      ${panel({
        title: corpName,
        count: tx('{n} divizii', { n: divisions.length }),
        actions: span,
        body: `<div class="history-kpis">
            <div><span class="label">${tx('Total în walleturi')}</span><span class="value">${isk(total)}</span></div>
            <div><span class="label">${tx('Taxe de la membri')}</span><span class="value">${isk(taxes.total)}</span></div>
            <div><span class="label">${tx('Membri care au plătit')}</span><span class="value">${formatInt(taxes.members.length)}</span></div>
            <div><span class="label">${tx('Retrageri')}</span><span class="value ${taxes.withdrawn ? 'ord-bad' : ''}">${isk(taxes.withdrawn)}</span></div>
          </div>
          <div class="table-scroll"><table class="table compact cw-div"><thead><tr><th>${tx('Diviziune')}</th><th class="r">${tx('Sold')}</th><th class="r">${tx('Din total')}</th></tr></thead><tbody>
            ${divisions.map((d) => `<tr class="${d.division === ui.division ? 'active' : ''}"><td><button class="link" data-cw-div="${d.division}">${esc(divName(d))}</button>${d.division === ui.division ? ` ${badge(tx('în jurnal'), 'accent')}` : ''}</td><td class="r">${isk(d.balance)}</td><td class="r num dim">${total > 0 ? `${((d.balance / total) * 100).toFixed(1)}%` : '—'}</td></tr>`).join('')}
          </tbody></table></div>`,
      })}
      ${panel({
        title: tx('Taxele plătite de membri'),
        count: taxes.members.length,
        body: top.length ? `<div class="table-scroll"><table class="table compact cw-members"><thead><tr><th>${tx('Membru')}</th><th class="r">${tx('Total')}</th><th class="r">${tx('Bounty')}</th><th class="r">${tx('Misiuni și altele')}</th><th class="r">${tx('Zile active')}</th><th class="r">${tx('Ultima plată')}</th><th>${tx('Pondere')}</th></tr></thead><tbody>
            ${top.map((m) => `<tr><td><span class="cw-who"><img src="${portraitUrl(m.memberId, 32)}" alt="" />${party(m.memberId)}</span></td><td class="r">${isk(m.total)}</td><td class="r">${isk(m.bounties)}</td><td class="r">${isk(m.total - m.bounties)}</td><td class="r num">${m.days}</td><td class="r num dim">${dateTime(m.last)}</td><td><span class="cw-bar"><i style="width:${(m.share * 100).toFixed(1)}%"></i></span><span class="small dim">${(m.share * 100).toFixed(1)}%</span></td></tr>`).join('')}
          </tbody></table></div><p class="small dim">${tx('Din jurnalul Master Wallet: taxele pe bounty, ESS, misiuni și recompense, pe membru. ESI dă doar ultimele 30 de zile.')}</p>`
          : `<p class="dim">${tx('Nicio taxă de la membri în perioada aleasă.')}</p>`,
      })}
      ${taxes.withdrawals.length ? panel({
        title: tx('Retrageri din Master Wallet'),
        count: taxes.withdrawals.length,
        body: `<table class="table compact"><tbody>${taxes.withdrawals.slice(0, 30).map((w) => `<tr><td>${party(w.who)}</td><td class="dim">${esc(w.reason)}</td><td class="r">${isk(w.amount)}</td><td class="r num dim">${dateTime(w.date)}</td></tr>`).join('')}</tbody></table>`,
      }) : ''}
      ${panel({
        title: tx('Jurnal · {div}', { div: divName(divisions.find((d) => d.division === ui.division)!) }),
        count: recent.length,
        body: `<div class="history-kpis"><div><span class="label">${tx('Intrări')}</span><span class="value">${signed(income)}</span></div><div><span class="label">${tx('Ieșiri')}</span><span class="value">${signed(spent)}</span></div><div><span class="label">${tx('Net')}</span><span class="value">${signed(income + spent)}</span></div></div>
          ${recent.length ? `<div class="table-scroll"><table class="table compact"><thead><tr><th>${tx('Data')}</th><th>${tx('Tip')}</th><th>${tx('De la / către')}</th><th class="r">${tx('Sumă')}</th><th class="r">${tx('Sold')}</th></tr></thead><tbody>
            ${recent.slice(0, JOURNAL_ROWS).map((e) => `<tr><td class="num dim nowrap">${dateTime(Date.parse(e.date))}</td><td>${esc(entryLabel(e))}</td><td class="small">${party(e.first_party_id)} → ${party(e.second_party_id)}${e.reason ? `<div class="dim">${esc(e.reason)}</div>` : ''}</td><td class="r">${signed(e.amount ?? 0)}</td><td class="r">${isk(e.balance ?? 0)}</td></tr>`).join('')}
          </tbody></table></div>` : `<p class="dim">${tx('Nicio înregistrare în perioada aleasă.')}</p>`}`,
      })}
    </div>`;
  }

  body.onclick = (e) => {
    const t = e.target as HTMLElement;
    const s = t.closest<HTMLElement>('[data-cw-span]');
    if (s) { ui.span = Number(s.dataset.cwSpan) as Span; saveJson(UI_KEY, ui); draw(); return; }
    const d = t.closest<HTMLElement>('[data-cw-div]');
    if (d) { ui.division = Number(d.dataset.cwDiv); saveJson(UI_KEY, ui); draw(); }
  };
  await draw();
}
