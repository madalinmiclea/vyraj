import type { AppContext } from '../app/context';
import { panel, loader, alertBox, esc, formatInt, compactISK, badge, copyText, loginEmpty } from '../ui/components';
import { icon } from '../ui/icons';
import { loadJson, saveJson } from '../storage';
import { fetchPrices, typeIconUrl } from '../services/market';
import { listAssets, universeNames, type EsiAsset } from '../character/esi';
import { rosterCharacters } from '../character/roster';
import { hasScope, hasTokens } from '../character/sso';
import { permissionButtons } from '../character/permissions';
import { parseItems } from '../services/appraisal';
import { typeName, resolveTypeNames } from '../services/typeNames';
import { loadDoctrines } from '../fitting/doctrines';
import { loadFits } from '../fitting/savedFits';
import { fitContents } from '../engine/fit';
import { exportMultibuy } from '../io/eft';
import { tx } from '../i18n';

interface CheckoutUi { source: string; text: string; copies: number; location: string; who: string }

const UI_KEY = 'eve-orders:checkout';
const ASSETS_SCOPE = 'esi-assets.read_assets.v1';
const HELD_FLAGS = new Set(['Hangar', 'Unlocked', 'Locked', 'AutoFit', 'Deliveries', 'HangarAll', 'CorpDeliveries']);
const CACHE_MS = 10 * 60 * 1000;

interface Holding { characterId: number; location: number; typeId: number; qty: number }

let cache: { at: number; rows: Holding[]; names: Map<number, string>; errors: string[] } | null = null;

async function loadHoldings(force: boolean) {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache;
  const chars = rosterCharacters().filter((c) => hasScope(c.characterId!, ASSETS_SCOPE));
  const rows: Holding[] = [];
  const errors: string[] = [];
  const locIds = new Set<number>();
  const byChar = new Map<number, number[]>();
  await Promise.all(chars.map(async (c) => {
    try {
      const list = await listAssets(c.characterId!);
      const byId = new Map(list.map((a) => [a.item_id, a]));
      const root = (a: EsiAsset) => { let cur = a; for (let i = 0; i < 10 && byId.has(cur.location_id); i++) cur = byId.get(cur.location_id)!; return cur.location_id; };
      const held = (a: EsiAsset) => {
        let cur = a;
        for (let i = 0; i < 10; i++) {
          if (!HELD_FLAGS.has(cur.location_flag)) return false;
          const parent = byId.get(cur.location_id);
          if (!parent) return true;
          cur = parent;
        }
        return true;
      };
      const ids: number[] = [];
      for (const a of list) {
        if (a.is_blueprint_copy || !held(a)) continue;
        const loc = root(a);
        rows.push({ characterId: c.characterId!, location: loc, typeId: a.type_id, qty: a.quantity });
        locIds.add(loc);
        ids.push(loc);
      }
      byChar.set(c.characterId!, ids);
    } catch (e) {
      errors.push(`${c.name}: ${(e as Error).message}`);
    }
  }));
  const names = new Map<number, string>();
  for (const [charId, ids] of byChar) {
    const todo = [...new Set(ids)].filter((id) => !names.has(id));
    if (todo.length) for (const [id, n] of await universeNames(todo, charId).catch(() => new Map<number, string>())) names.set(id, n);
  }
  cache = { at: Date.now(), rows, names, errors };
  return cache;
}

export interface CheckoutPanel { show(): void; hide(): void }

export function createCheckoutPanel(el: HTMLElement, ctx: AppContext): CheckoutPanel {
  const ui = loadJson<CheckoutUi>(UI_KEY, { source: 'paste', text: '', copies: 1, location: '', who: 'all' });
  let visible = false;
  let busy = false;

  const save = () => saveJson(UI_KEY, ui);

  function sources(): { id: string; label: string; need: () => Map<number, number> }[] {
    const out: { id: string; label: string; need: () => Map<number, number> }[] = [{
      id: 'paste',
      label: tx('Listă lipită'),
      need: () => new Map(parseItems(ui.text).lines.map((l) => [l.typeId, l.quantity])),
    }];
    for (const d of loadDoctrines()) {
      out.push({
        id: `doc:${d.id}`,
        label: `${tx('Doctrină')}: ${d.name}`,
        need: () => {
          const all = new Map<number, number>();
          for (const f of d.fits) for (const [id, n] of fitContents(ctx.sde, f.fit, true)) all.set(id, (all.get(id) ?? 0) + n * Math.max(1, f.qty));
          return all;
        },
      });
    }
    for (const f of loadFits()) {
      out.push({ id: `fit:${f.id}`, label: `${tx('Fit')}: ${f.name} · ${ctx.sde.types.get(f.shipId)?.name ?? ''}`, need: () => fitContents(ctx.sde, f, true) });
    }
    return out;
  }

  async function render(force = false) {
    if (!visible) return;
    const logged = rosterCharacters().filter((c) => hasTokens(c.characterId!)).map((c) => ({ characterId: c.characterId!, name: c.name }));
    if (!logged.length) {
      el.innerHTML = loginEmpty(tx('Fă login cu EVE ca să compari lista cu bunurile tale.'));
      return;
    }
    if (!logged.some((c) => hasScope(c.characterId, ASSETS_SCOPE))) {
      el.innerHTML = panel({ body: permissionButtons('assets', logged) });
      return;
    }
    if (busy) return;
    busy = true;
    if (!cache || force) el.innerHTML = panel({ body: loader(tx('Citesc bunurile tuturor caracterelor')) });
    try {
      const h = await loadHoldings(force);
      await draw(h);
    } catch (e) {
      el.innerHTML = panel({ body: alertBox((e as Error).message) });
    } finally {
      busy = false;
    }
  }

  async function draw(h: NonNullable<typeof cache>) {
    const list = sources();
    const src = list.find((s) => s.id === ui.source) ?? list[0];
    ui.source = src.id;
    const copies = Math.max(1, Math.min(999, Math.round(ui.copies) || 1));
    const base = src.need();
    const need = new Map([...base].map(([id, n]) => [id, n * copies]));
    const rows = h.rows.filter((r) => ui.who === 'all' || String(r.characterId) === ui.who);
    const locs = new Map<number, number>();
    for (const r of rows) locs.set(r.location, (locs.get(r.location) ?? 0) + 1);
    const locList = [...locs.entries()].sort((a, b) => b[1] - a[1]);
    if (!locList.some(([id]) => String(id) === ui.location)) ui.location = locList[0] ? String(locList[0][0]) : '';
    const loc = Number(ui.location);
    const have = new Map<number, number>();
    for (const r of rows) if (r.location === loc) have.set(r.typeId, (have.get(r.typeId) ?? 0) + r.qty);
    const ids = [...need.keys()];
    await resolveTypeNames(ids);
    const prices = ids.length ? await fetchPrices(ids).catch(() => null) : null;
    const lines = ids.map((id) => {
      const n = need.get(id)!;
      const got = Math.min(n, have.get(id) ?? 0);
      const unit = prices?.get(id)?.sellMin ?? 0;
      return { id, n, got, miss: n - got, unit };
    }).sort((a, b) => b.miss * b.unit - a.miss * a.unit || typeName(a.id).localeCompare(typeName(b.id)));
    const missing = lines.filter((l) => l.miss > 0);
    const missIsk = missing.reduce((a, l) => a + l.miss * l.unit, 0);
    const owners = rosterCharacters().filter((c) => hasScope(c.characterId!, ASSETS_SCOPE));
    const locName = (id: number) => h.names.get(id) ?? (id > 1e12 ? tx('Structură {id}', { id }) : tx('Locație {id}', { id }));
    const ready = lines.length > 0 && missing.length === 0;
    el.innerHTML = `${h.errors.map((e) => alertBox(e)).join('')}<div class="tool-grid">
      ${panel({
        title: tx('Ce vrei să ai'),
        body: `<div class="form-grid co-form">
            <label>${tx('Listă')}<select class="input" data-co-source>${list.map((s) => `<option value="${esc(s.id)}" ${s.id === src.id ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select></label>
            <label>${tx('Bucăți')}<input class="input" type="number" min="1" max="999" data-co-copies value="${copies}" /></label>
          </div>
          ${src.id === 'paste' ? `<textarea class="input area" rows="12" spellcheck="false" data-co-text placeholder="${tx('Copiază din inventar, contract, EFT sau listă')}">${esc(ui.text)}</textarea>
            <div class="row-actions"><button class="btn sm" data-co-check>${icon('market')}${tx('Verifică')}</button></div>` : ''}
          <div class="form-grid co-form">
            ${owners.length > 1 ? `<label>${tx('Caracter')}<select class="input" data-co-who><option value="all">${tx('Toate caracterele')}</option>${owners.map((c) => `<option value="${c.characterId}" ${String(c.characterId) === ui.who ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>` : ''}
            <label>${tx('Locație')}<select class="input" data-co-location>${locList.map(([id, n]) => `<option value="${id}" ${String(id) === ui.location ? 'selected' : ''}>${esc(locName(id))} (${formatInt(n)})</option>`).join('')}</select></label>
          </div>`,
      })}
      ${panel({
        title: tx('Ce lipsește'),
        count: lines.length ? `${formatInt(missing.length)} / ${formatInt(lines.length)}` : undefined,
        actions: `<button class="btn ghost sm" data-co-refresh>${icon('refresh')}${tx('Recitește bunurile')}</button>`,
        body: lines.length ? `<div class="history-kpis">
              <div><span class="label">${tx('Tipuri lipsă')}</span><span class="value ${missing.length ? 'ord-bad' : 'pos'}">${formatInt(missing.length)}</span></div>
              <div><span class="label">${tx('Cost lipsă la Jita')}</span><span class="value">${compactISK(missIsk)}</span></div>
              <div><span class="label">${tx('Acoperit')}</span><span class="value">${formatInt(Math.round((lines.reduce((a, l) => a + l.got, 0) / Math.max(1, lines.reduce((a, l) => a + l.n, 0))) * 100))}%</span></div>
            </div>
            ${ready ? `<p>${badge(tx('Ai tot în {loc}', { loc: locName(loc) }), 'ok', true)}</p>` : `<div class="row-actions"><button class="btn sm" data-co-copy>${icon('copy')}${tx('Copiază Multibuy cu ce lipsește')}</button></div>`}
            <div class="table-scroll"><table class="table compact"><thead><tr><th>Item</th><th class="r">${tx('Necesar')}</th><th class="r">${tx('Ai')}</th><th class="r">${tx('Lipsă')}</th><th class="r">${tx('Cost Jita')}</th></tr></thead><tbody>
            ${lines.map((l) => `<tr class="${l.miss ? '' : 'dim'}"><td><img class="row-icon" src="${typeIconUrl(l.id, 32)}" alt="" />${esc(typeName(l.id))}</td><td class="r num">${formatInt(l.n)}</td><td class="r num">${formatInt(l.got)}</td><td class="r num ${l.miss ? 'ord-bad' : ''}">${l.miss ? formatInt(l.miss) : '✓'}</td><td class="r num">${l.miss && l.unit ? compactISK(l.miss * l.unit) : '<span class="dim">—</span>'}</td></tr>`).join('')}
            </tbody></table></div>` : `<p class="dim">${tx('Alege o doctrină sau un fit, ori lipește o listă de iteme.')}</p>`,
      })}
    </div>`;
    el.dataset.coMissing = JSON.stringify(missing.map((l) => [l.id, l.miss]));
  }

  el.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches('[data-co-source]')) ui.source = t.value;
    else if (t.matches('[data-co-copies]')) ui.copies = Number(t.value) || 1;
    else if (t.matches('[data-co-location]')) ui.location = t.value;
    else if (t.matches('[data-co-who]')) ui.who = t.value;
    else return;
    save();
    render();
  });

  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-co-refresh]')) { render(true); return; }
    if (t.closest('[data-co-check]')) {
      ui.text = el.querySelector<HTMLTextAreaElement>('[data-co-text]')?.value ?? '';
      save();
      render();
      return;
    }
    if (t.closest('[data-co-copy]')) {
      const missing = JSON.parse(el.dataset.coMissing ?? '[]') as [number, number][];
      copyText(exportMultibuy(ctx.sde, new Map(missing)), tx('Lista Multibuy copiată'));
    }
  });

  return {
    show() { visible = true; render(); },
    hide() { visible = false; },
  };
}
