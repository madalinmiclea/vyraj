import { loadSkins, licenseIndex } from '../services/skins';
import { panel, loader, alertBox, esc, formatInt, compactISK, dataStamp } from '../ui/components';
import { loadJson, saveJson, removeKey } from '../storage';
import { fetchPrices, forgetPrices, pricesAt, typeIconUrl } from '../services/market';
import { listAssets, universeNames, dynamicItem, type EsiAsset } from '../character/esi';
import { typeName, resolveTypeNames } from '../services/typeNames';
import { tx } from '../i18n';
import { priceOf, isk, type At, type ToolEnv } from './toolsShared';

const ASSETS_KEY = 'eve-tools:assets:';
const DYN_KEY = 'eve-tools:dynamic-items';
const ROW_PLAIN = 0, ROW_BPC = 1, ROW_MUTATED = 2;
const ASSET_SAFETY = 2004;

interface AssetLine { typeId: number; qty: number; value: number; kind: number }
interface AssetSnapshot { v?: number; at: number; items: number; rows: [number, number, number, number?][]; names: [number, string][]; dyn?: [number, number, number][] }

export function createAssetsTool(env: ToolEnv) {
  const { body, ctx, basisChips, esiCharacter, scopePrompt } = env;

  async function assetSnapshot(characterId: number): Promise<AssetSnapshot> {
    const cached = loadJson<AssetSnapshot | null>(ASSETS_KEY + characterId, null);
    if (cached?.rows && cached.v === 2) return cached;
    const list = await listAssets(characterId);
    const byId = new Map(list.map((a) => [a.item_id, a]));
    const root = (a: EsiAsset) => { let cur = a; for (let i = 0; i < 10 && byId.has(cur.location_id); i++) cur = byId.get(cur.location_id)!; return cur.location_id; };
    const agg = new Map<string, [number, number, number, number]>();
    const dyn: [number, number, number][] = [];
    for (const a of list) {
      const loc = root(a);
      const kind = a.is_blueprint_copy ? ROW_BPC : ctx.sde.isAbyssal(a.type_id) ? ROW_MUTATED : ROW_PLAIN;
      if (kind === ROW_MUTATED) dyn.push([loc, a.type_id, a.item_id]);
      const k = `${loc}:${a.type_id}:${kind}`;
      const row = agg.get(k) ?? [loc, a.type_id, 0, kind];
      row[2] += a.quantity;
      agg.set(k, row);
    }
    const rows = [...agg.values()];
    const names = await universeNames([...new Set(rows.map((r) => r[0]))], characterId).catch(() => new Map<number, string>());
    const snap: AssetSnapshot = { v: 2, at: Date.now(), items: list.length, rows, names: [...names], dyn };
    saveJson(ASSETS_KEY + characterId, snap);
    return snap;
  }

  let assetLines = new Map<number, AssetLine[]>();

  async function dynamicSources(items: [number, number, number][]): Promise<Map<number, [number, number]>> {
    const store = loadJson<Record<string, [number, number]>>(DYN_KEY, {});
    const todo = items.filter(([, , id]) => !store[id]).slice(0, 300);
    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        const [, typeId, itemId] = todo[next++];
        try { const d = await dynamicItem(typeId, itemId); store[itemId] = [d.source_type_id, d.mutator_type_id]; } catch { }
      }
    };
    if (todo.length) {
      await Promise.all(Array.from({ length: 4 }, worker));
      const live = new Set(items.map(([, , id]) => String(id)));
      saveJson(DYN_KEY, Object.fromEntries(Object.entries(store).filter(([id]) => live.has(id))));
    }
    return new Map(items.filter(([, , id]) => store[id]).map(([, , id]) => [id, store[id]]));
  }

  const kindBadge = (kind: number) => kind === ROW_BPC
    ? ` <span class="badge warn" title="${esc(tx('Copie de blueprint. Nu are preț de piață, nu intră în total.'))}">BPC</span>`
    : kind === ROW_MUTATED ? ` <span class="badge" title="${esc(tx('Valoare estimată: itemul de bază plus mutaplasmidul. Itemele mutate nu au preț de piață.'))}">${tx('Mutat')}</span>` : '';
  const openLocs = new Set<number>();

  let skinShip: Map<number, number> | null = null;
  const assetIcon = (id: number) => { const ship = skinShip?.get(id); return ship ? typeIconUrl(ship, 32) : typeIconUrl(id, 32, typeName(id)); };
  const assetItemLink = (id: number) => `<button class="link asset-item" data-asset-info="${id}" title="${esc(tx('Deschide informațiile itemului'))}"><img class="row-icon" src="${assetIcon(id)}" alt="" loading="lazy" />${esc(typeName(id))}</button>`;

  function assetItemsRow(loc: number) {
    const lines = [...(assetLines.get(loc) ?? [])].sort((a, b) => b.value - a.value || typeName(a.typeId).localeCompare(typeName(b.typeId)));
    return `<tr class="asset-items" data-asset-items="${loc}"><td colspan="2"><table class="table compact"><tbody>${lines.map((l) => `<tr><td>${assetItemLink(l.typeId)}${kindBadge(l.kind)}</td><td class="r num">${formatInt(l.qty)}</td><td class="r">${l.value ? isk(l.value) : '<span class="dim">—</span>'}</td></tr>`).join('')}</tbody></table></td></tr>`;
  }

  function toggleLocation(row: HTMLElement) {
    const loc = Number(row.dataset.assetLoc);
    const open = !openLocs.has(loc);
    if (open) { openLocs.add(loc); row.insertAdjacentHTML('afterend', assetItemsRow(loc)); }
    else { openLocs.delete(loc); row.nextElementSibling?.matches('[data-asset-items]') && row.nextElementSibling.remove(); }
    row.setAttribute('aria-expanded', String(open));
  }

  async function assets() {
    const c = esiCharacter('esi-assets.read_assets.v1');
    if (c === 'scope') { body.innerHTML = scopePrompt('assets'); return; }
    if (typeof c === 'string') { body.innerHTML = panel({ body: alertBox(c) }); return; }
    body.innerHTML = panel({ body: loader(tx('Citesc asset-urile și prețurile')) });
    try {
      const snap = await assetSnapshot(c.id);
      const dyn = await dynamicSources(snap.dyn ?? []);
      const dynTypes = [...dyn.values()].flat();
      const typeIds = [...new Set([...snap.rows.map((r) => r[1]), ...dynTypes])];
      const names = new Map(snap.names);
      const unnamed = [...new Set(snap.rows.map((r) => r[0]))].filter((id) => !names.has(id) && id !== ASSET_SAFETY);
      const [prices, found] = await Promise.all([
        fetchPrices(typeIds),
        unnamed.length ? universeNames(unnamed, c.id).catch(() => new Map<number, string>()) : Promise.resolve(new Map<number, string>()),
        resolveTypeNames(typeIds),
      ]);
      if (!skinShip && typeIds.some((id) => / SKIN$/.test(typeName(id)))) {
        skinShip = await loadSkins().then((l) => new Map([...licenseIndex(l)].map(([lic, key]) => [lic, Number(key.slice(key.lastIndexOf('|') + 1))]))).catch(() => new Map<number, number>());
      }
      if (found.size) {
        for (const [id, n] of found) names.set(id, n);
        saveJson(ASSETS_KEY + c.id, { ...snap, names: [...names] });
      }
      const locs = new Map<number, number>();
      const types = new Map<number, { qty: number; value: number; kind: number }>();
      const byLoc = new Map<number, AssetLine[]>();
      const dynValue = new Map<string, number>();
      for (const [loc, typeId, itemId] of snap.dyn ?? []) {
        const src = dyn.get(itemId);
        if (!src) continue;
        const k = `${loc}:${typeId}`;
        dynValue.set(k, (dynValue.get(k) ?? 0) + priceOf(prices.get(src[0]), env.basis) + priceOf(prices.get(src[1]), env.basis));
      }
      for (const [loc, typeId, qty, kind = ROW_PLAIN] of snap.rows) {
        const value = kind === ROW_BPC ? 0 : kind === ROW_MUTATED ? dynValue.get(`${loc}:${typeId}`) ?? 0 : priceOf(prices.get(typeId), env.basis) * qty;
        locs.set(loc, (locs.get(loc) ?? 0) + value);
        if (kind === ROW_BPC) { const list = byLoc.get(loc) ?? []; list.push({ typeId, qty, value, kind }); byLoc.set(loc, list); continue; }
        const t = types.get(typeId) ?? { qty: 0, value: 0, kind };
        t.qty += qty; t.value += value;
        types.set(typeId, t);
        const list = byLoc.get(loc) ?? [];
        list.push({ typeId, qty, value, kind });
        byLoc.set(loc, list);
      }
      assetLines = byLoc;
      if (env.tab !== 'assets') return;
      const total = [...locs.values()].reduce((a, v) => a + v, 0);
      const at = Math.min(snap.at, pricesAt(typeIds) || snap.at);
      const locName = (id: number) => names.get(id) ?? (id === ASSET_SAFETY ? 'Asset Safety' : id > 1e12 ? tx('Structură {id}', { id }) : tx('Locație {id}', { id }));
      const locTitle = (id: number) => (!names.has(id) && id > 1e12 ? ` title="${esc(tx('Niciun caracter logat nu are acces la structură, așa că ESI nu îi dă numele.'))}"` : '');
      body.innerHTML = `${panel({
          title: tx('Valoare bunuri'),
          actions: dataStamp(at, 'data-assets-refresh', { label: tx('Date din {time}'), title: tx('Asset-urile și prețurile Jita sunt păstrate până le reîmprospătezi. Click pentru a le citi din nou.') }) + basisChips(),
          body: `<div class="history-kpis">
              <div><span class="label">Total</span><span class="value">${compactISK(total)}</span></div>
              <div><span class="label">${tx('Iteme')}</span><span class="value">${formatInt(snap.items)}</span></div>
              <div><span class="label">${tx('Locații')}</span><span class="value">${formatInt(locs.size)}</span></div>
            </div>`,
        })}
        <div class="tool-grid">
          ${panel({ title: tx('Pe locație'), body: `<table class="table compact asset-locs"><tbody>${[...locs.entries()].sort((a, b) => b[1] - a[1]).map(([id, v]) => `<tr class="asset-loc" data-asset-loc="${id}" aria-expanded="${openLocs.has(id)}"${locTitle(id)}><td><span class="asset-caret"></span>${esc(locName(id))} <span class="dim small">${formatInt(byLoc.get(id)!.length)}</span></td><td class="r">${isk(v)}</td></tr>${openLocs.has(id) ? assetItemsRow(id) : ''}`).join('')}</tbody></table>` })}
          ${panel({ title: tx('Cele mai valoroase'), body: `<table class="table compact"><tbody>${[...types.entries()].sort((a, b) => b[1].value - a[1].value).slice(0, 40).map(([id, t]) => `<tr><td>${assetItemLink(id)}${kindBadge(t.kind)}</td><td class="r num">${formatInt(t.qty)}</td><td class="r">${isk(t.value)}</td></tr>`).join('')}</tbody></table>` })}
        </div>`;
    } catch (err) {
      body.innerHTML = panel({ body: alertBox((err as Error).message) });
    }
  }

  function refreshAssets() {
    const id = ctx.character.characterId;
    if (!id) return;
    const snap = loadJson<AssetSnapshot | null>(ASSETS_KEY + id, null);
    if (snap?.rows) forgetPrices(snap.rows.map((r) => r[1]));
    removeKey(ASSETS_KEY + id);
    assets();
  }

  function click(at: At) {
    if (at('[data-assets-refresh]')) { refreshAssets(); return true; }
    const loc = at('[data-asset-loc]');
    if (loc) { toggleLocation(loc); return true; }
    return false;
  }

  return { render: assets, click };
}
