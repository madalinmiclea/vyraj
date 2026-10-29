import { Category } from '../data/sde';
import { buildDogma, cloneFit, fitContents, type SlotKind } from '../engine/fit';
import { computeStats } from '../engine/stats';
import { findProfile, profileText } from '../engine/profiles';
import { requirementsFor, fitTypeIds } from '../character/requirements';
import { formatDuration } from '../character/training';
import { listFittings, saveFitting, listAssets, currentShip, assetNames, universeNames, dynamicItem } from '../character/esi';
import { assembledShips, fitFromShipWithAbyssal, type OwnedShip } from '../io/assetFit';
import { hasScope, loginProblem } from '../character/sso';
import { permissionGate, hasPermission } from '../character/permissions';
import { parseEft, exportEft, exportMultibuy, exportDna } from '../io/eft';
import { shareUrl } from '../io/shareLink';
import { fromEsiFitting, toEsiFitting } from '../io/esiFit';
import { typeIconUrl } from '../services/market';
import { loadFits, deleteFit } from './savedFits';
import { icon } from '../ui/icons';
import { alertBox, badge, button, closeModal, confirmDialog, copyText, emptyState, esc, formatInt, formatNum, lore, openModal, toast } from '../ui/components';
import { formatAttribute } from '../ui/attributes';
import { mutate, mutationRows, moduleName, type MutationRow } from '../engine/mutation';
import { tx } from '../i18n';
import type { FitEnv } from './shared';

export function createFitModals(env: FitEnv) {
  const { sde, ctx, name } = env;

  function openSavedFits() {
    const fits = loadFits();
    const body = fits.length
      ? `<div class="fit-list">${fits.map((f) => `<div class="fit-list-row">
          <img src="${typeIconUrl(f.shipId, 32)}" alt="" />
          <div><b>${esc(f.name)}</b><span class="dim small">${esc(name(f.shipId))}</span></div>
          ${button(tx('Deschide'), { cls: 'sm', attrs: `data-open="${esc(f.id)}"` })}
          <button class="btn ghost sm icon-only" data-delete="${esc(f.id)}" title="${tx('Șterge')}">${icon('trash')}</button>
        </div>`).join('')}</div>`
      : emptyState({ title: tx('Niciun fit salvat'), text: tx('Apasă „Salvează” pe un fit ca să apară aici.'), vy: 'No Provings Kept', vyText: 'Press “Save” on a fit and it shall be kept here.' });
    const modal = openModal(tx('Fit-uri salvate'), body);
    modal.addEventListener('click', async (e) => {
      const t = e.target as HTMLElement;
      const open = t.closest<HTMLElement>('[data-open]');
      if (open) {
        const f = loadFits().find((x) => x.id === open.dataset.open);
        if (f) { closeModal(); env.setFit(cloneFit(f)); }
      }
      const del = t.closest<HTMLElement>('[data-delete]');
      if (del && await confirmDialog(tx('Ștergi fit-ul?'), { ok: tx('Șterge'), danger: true })) { deleteFit(del.dataset.delete!); closeModal(); openSavedFits(); }
    });
  }

  function openImport() {
    const modal = openModal(tx('Importă fit (EFT)'), `
      <p class="dim small">${tx('Lipește un fit copiat din joc (Fitting → Copy to clipboard) sau din Pyfa.')}</p>
      <textarea class="input area" id="eftInput" rows="14" spellcheck="false" placeholder="[Drake, PvE]&#10;Ballistic Control System II&#10;..."></textarea>
      <div id="eftError"></div>
      <div class="row-actions">${button(tx('Importă'), { iconName: 'upload', attrs: 'data-do-import' })}</div>`, { wide: true });
    modal.querySelector('[data-do-import]')!.addEventListener('click', () => {
      try {
        const { fit: parsed, unknown } = parseEft(sde, modal.querySelector<HTMLTextAreaElement>('#eftInput')!.value);
        closeModal();
        env.setFit(parsed);
        toast(unknown.length ? tx('Importat; {n} linii necunoscute', { n: unknown.length }) : tx('Fit importat'));
      } catch (err) {
        modal.querySelector('#eftError')!.innerHTML = alertBox((err as Error).message);
      }
    });
  }

  function openExport() {
    const fit = env.getFit();
    if (!fit) return toast(tx('Nu ai niciun fit'));
    const eft = exportEft(sde, fit);
    const dna = exportDna(sde, fit);
    const modal = openModal(tx('Exportă fit'), `
      <textarea class="input area" rows="14" readonly spellcheck="false">${esc(eft)}</textarea>
      <div class="row-actions">
        ${button(tx('Copiază EFT'), { iconName: 'copy', attrs: 'data-copy="eft"' })}
        ${button(tx('Copiază DNA'), { iconName: 'copy', cls: 'ghost', attrs: 'data-copy="dna"' })}
        ${button(tx('Copiază Multibuy'), { iconName: 'copy', cls: 'ghost', attrs: 'data-copy="multibuy"' })}
        ${button(tx('Copiază link'), { iconName: 'link', cls: 'ghost', attrs: 'data-copy="link"' })}
      </div>
      <p class="dim small">${tx('EFT se lipește în joc din Fitting → Import from clipboard și în Pyfa.')}</p>`, { wide: true });
    modal.addEventListener('click', (e) => {
      const kind = (e.target as HTMLElement).closest<HTMLElement>('[data-copy]')?.dataset.copy;
      if (kind === 'eft') copyText(eft, tx('EFT copiat'));
      if (kind === 'dna') copyText(dna, tx('DNA copiat'));
      if (kind === 'multibuy' && fit) copyText(exportMultibuy(sde, fitContents(sde, fit)), tx('Multibuy copiat'));
      if (kind === 'link') shareUrl(fit).then((url) => copyText(url, tx('Link copiat. Cine îl deschide primește fit-ul într-un tab nou.'))).catch(() => toast(tx('Browserul nu poate crea linkul de fit')));
    });
  }

  function openCompare() {
    const current = env.getFit();
    const saved = loadFits();
    const fits = current ? [{ ...cloneFit(current), name: `${current.name} · ${tx('curent')}` }, ...saved.filter((f) => f.id !== current.id)] : saved;
    if (fits.length < 2) return toast(tx('Salvează câteva fit-uri ca să le compari'));
    const profile = findProfile(env.profileId());
    const rows = fits.map((f) => {
      const s = computeStats(sde, f, buildDogma(sde, f, ctx.character), profile);
      const req = requirementsFor(sde, fitTypeIds(f), ctx.character);
      return { f, s, req };
    });
    const best = (vals: number[], high = true) => (high ? Math.max(...vals) : Math.min(...vals));
    const metrics: { label: string; get: (x: (typeof rows)[number]) => number; fmt: (n: number) => string; high?: boolean }[] = [
      { label: 'DPS', get: (x) => x.s.offense.totalDps, fmt: (n) => formatNum(n, 0) },
      { label: tx('Salvă'), get: (x) => x.s.offense.totalVolley, fmt: (n) => formatNum(n, 0) },
      { label: 'EHP', get: (x) => x.s.defense.ehp, fmt: (n) => formatInt(n) },
      { label: `${tx('Tank activ')} (EHP/s)`, get: (x) => x.s.defense.activeTank, fmt: (n) => formatNum(n, 1) },
      { label: tx('Capacitor stabil la'), get: (x) => (x.s.capacitor.stable ? (x.s.capacitor.stableAt ?? 1) * 100 : 0), fmt: (n) => (n ? formatNum(n, 0) + '%' : tx('nu')) },
      { label: tx('Viteză'), get: (x) => x.s.navigation.maxVelocity, fmt: (n) => formatNum(n, 0) + ' m/s' },
      { label: tx('Aliniere'), get: (x) => x.s.navigation.alignTime, fmt: (n) => formatNum(n, 2) + ' s', high: false },
      { label: tx('Rază țintire'), get: (x) => x.s.targeting.maxRange, fmt: (n) => formatNum(n / 1000, 1) + ' km' },
      { label: tx('Antrenament lipsă'), get: (x) => x.req.totalSeconds, fmt: (n) => formatDuration(n), high: false },
    ];
    openModal(tx('Compară fit-uri'), `
      <p class="dim small">${tx('Caracter: {name} · profil {profile}. Cea mai bună valoare e evidențiată.', { name: esc(ctx.character.name), profile: esc(profileText(profile.name)) })}</p>
      <div class="table-scroll"><table class="table compact compare">
        <thead><tr><th></th>${rows.map((x) => `<th>${esc(x.f.name)}<br><span class="dim small">${esc(name(x.f.shipId))}</span></th>`).join('')}</tr></thead>
        <tbody>${metrics.map((m) => {
          const vals = rows.map(m.get);
          const b = best(vals, m.high !== false);
          return `<tr><th>${m.label}</th>${vals.map((v) => `<td class="num ${v === b && rows.length > 1 ? 'best' : ''}">${m.fmt(v)}</td>`).join('')}</tr>`;
        }).join('')}</tbody>
      </table></div>`, { wide: true });
  }

  function openMutation(kind: SlotKind, i: number) {
    const current = env.getFit()?.slots[kind][i];
    if (!current) return;
    const tier = (n: string) => (/^Glorified/.test(n) ? 3 : 0) + (/Decayed/.test(n) ? 0 : /Gravid/.test(n) ? 1 : /Unstable/.test(n) ? 2 : 3);
    const options = [...sde.mutaplasmidsFor(current.typeId)].sort((a, b) => tier(a.name) - tier(b.name) || a.name.localeCompare(b.name));
    const modal = openModal(tx('Mutaplasmid'), '', { wide: true });
    const body = modal.querySelector<HTMLElement>('.panel-body')!;
    const module = () => env.getFit()?.slots[kind][i] ?? null;
    const pct = (v: number, base: number) => ((v - base) / Math.abs(base)) * 100;
    const draw = () => {
      const m = module();
      if (!m) { closeModal(); return; }
      const rows = mutationRows(sde, m);
      body.innerHTML = `
        <div class="mut-head">
          <img src="${typeIconUrl(m.typeId, 64)}" alt="" />
          <div><b>${esc(moduleName(sde, m))}</b><div class="dim small">${esc(name(m.typeId))}</div></div>
        </div>
        <label class="select-field mut-select"><span>${tx('Mutaplasmid')}</span>
          <select class="input plain" data-mut-pick>
            <option value="">— ${tx('fără mutație')} —</option>
            ${options.map((o) => `<option value="${o.id}" ${m.mutation?.mutaplasmidId === o.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}
          </select>
        </label>
        ${rows.length ? `<table class="table compact mut-table"><tbody>${rows.map((r) => {
          const a = sde.attributes.get(r.attrId)!;
          const p = pct(r.value, r.base) * (r.highIsGood ? 1 : -1);
          const good = Math.abs(p) < 0.05 ? '' : p > 0 ? 'good' : 'bad';
          const [worst, best] = r.highIsGood ? [r.min, r.max] : [r.max, r.min];
          return `<tr>
            <td>${esc(r.name)}</td>
            <td class="mut-range"><span class="dim small num">${esc(formatAttribute(sde, a, worst))}</span>
              <input type="range" min="0" max="1000" step="1" value="${Math.round(sliderPos(r) * 1000)}" data-mut-attr="${r.attrId}" />
              <span class="dim small num">${esc(formatAttribute(sde, a, best))}</span></td>
            <td class="r num mut-value" data-mut-show="${r.attrId}">${esc(formatAttribute(sde, a, r.value))}</td>
            <td class="r num ${good}" data-mut-pct="${r.attrId}">${p >= 0 ? '+' : ''}${p.toFixed(1)}%</td>
          </tr>`;
        }).join('')}</tbody></table>
        <div class="row-actions">
          <button class="btn ghost sm" data-mut-preset="base">${tx('Valori de bază')}</button>
          <button class="btn ghost sm" data-mut-preset="best">${tx('Cel mai bun roll')}</button>
          <button class="btn ghost sm" data-mut-preset="worst">${tx('Cel mai slab roll')}</button>
        </div>` : ''}`;
    };
    const sliderPos = (r: MutationRow) => {
      const t = r.max > r.min ? (r.value - r.min) / (r.max - r.min) : 0;
      return r.highIsGood ? t : 1 - t;
    };
    const fromSlider = (r: MutationRow, pos: number) => {
      const t = r.highIsGood ? pos : 1 - pos;
      return r.min + t * (r.max - r.min);
    };
    const setValue = (attrId: number, v: number) => {
      env.change((draft) => {
        const m = draft.slots[kind][i];
        if (!m?.mutation) return;
        const row = mutationRows(sde, m).find((r) => r.attrId === attrId);
        if (row) m.mutation.values[attrId] = Math.min(row.max, Math.max(row.min, v));
      });
    };
    draw();
    body.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.matches('[data-mut-pick]')) {
        const mp = sde.mutaplasmids.get(Number(t.value));
        env.change((draft) => {
          const m = draft.slots[kind][i];
          if (!m) return;
          if (mp) mutate(sde, m, mp); else delete m.mutation;
        });
        draw();
      } else if (t.matches('[data-mut-attr]')) {
        const attrId = Number(t.dataset.mutAttr);
        const row = module() && mutationRows(sde, module()!).find((r) => r.attrId === attrId);
        if (row) setValue(attrId, fromSlider(row, Number(t.value) / 1000));
        draw();
      }
    });
    body.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (!t.matches('[data-mut-attr]')) return;
      const attrId = Number(t.dataset.mutAttr);
      const before = module() && mutationRows(sde, module()!).find((r) => r.attrId === attrId);
      if (!before) return;
      const row = { ...before, value: Math.min(before.max, Math.max(before.min, fromSlider(before, Number(t.value) / 1000))) };
      const a = sde.attributes.get(attrId)!;
      const p = pct(row.value, row.base) * (row.highIsGood ? 1 : -1);
      const tr = t.closest('tr')!;
      tr.querySelector('[data-mut-show]')!.textContent = formatAttribute(sde, a, row.value);
      const pctEl = tr.querySelector<HTMLElement>('[data-mut-pct]')!;
      pctEl.textContent = `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`;
      pctEl.className = `r num ${Math.abs(p) < 0.05 ? '' : p > 0 ? 'good' : 'bad'}`;
    });
    body.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-mut-preset]');
      if (!b) return;
      const preset = b.dataset.mutPreset;
      env.change((draft) => {
        const m = draft.slots[kind][i];
        if (!m?.mutation) return;
        for (const r of mutationRows(sde, m)) {
          m.mutation.values[r.attrId] = preset === 'base' ? Math.min(r.max, Math.max(r.min, r.base))
            : (preset === 'best') === r.highIsGood ? r.max : r.min;
        }
      });
      draw();
    });
  }

  async function openShips() {
    const c = ctx.character;
    const problem = loginProblem(c);
    if (problem || !c.characterId) {
      toast(problem ?? '');
      return;
    }
    const characterId = c.characterId;
    const modal = openModal(`${tx('Navele mele')} · ${c.name}`, `<div class="dim">${lore(tx('Se încarcă asset-urile din joc…'), 'Weaving the Flow…')}</div>`, { wide: true });
    const body = modal.querySelector('.panel-body')!;
    if (!hasScope(characterId, 'esi-assets.read_assets.v1')) {
      body.innerHTML = permissionGate('assets', characterId, c.name);
      return;
    }
    try {
      const [assets, active] = await Promise.all([
        listAssets(characterId),
        hasScope(characterId, 'esi-location.read_ship_type.v1') ? currentShip(characterId).catch(() => null) : Promise.resolve(null),
      ]);
      const ships = assembledShips(sde, assets);
      if (active && !ships.some((s) => s.itemId === active.ship_item_id) && sde.types.has(active.ship_type_id)) {
        ships.push({ itemId: active.ship_item_id, typeId: active.ship_type_id, name: name(active.ship_type_id), locationId: 0, contents: assets.filter((a) => a.location_id === active.ship_item_id) });
      }
      const [names, places] = await Promise.all([
        assetNames(characterId, ships.map((s) => s.itemId)).catch(() => new Map<number, string>()),
        universeNames([...new Set(ships.map((s) => s.locationId).filter(Boolean))], characterId).catch(() => new Map<number, string>()),
      ]);
      const label = (s: OwnedShip) => names.get(s.itemId)?.trim() || s.name;
      const place = (s: OwnedShip) => (s.itemId === active?.ship_item_id ? tx('Nava activă') : places.get(s.locationId) ?? (s.locationId > 1e12 ? tx('Structură de jucător') : tx('Locație {id}', { id: s.locationId })));
      ships.sort((a, b) => Number(b.itemId === active?.ship_item_id) - Number(a.itemId === active?.ship_item_id) || place(a).localeCompare(place(b)) || a.name.localeCompare(b.name));
      body.innerHTML = ships.length
        ? `<div class="fit-list ships">${ships.map((s) => {
            const modules = s.contents.filter((x) => /Slot/.test(x.location_flag) && sde.types.get(x.type_id)?.categoryId !== Category.Charge).length;
            return `<div class="fit-list-row">
              <img src="${typeIconUrl(s.typeId, 32)}" alt="" />
              <div><b>${esc(label(s))}</b><span class="dim small">${esc(s.name)} · ${esc(place(s))} · ${tx('{n} module', { n: modules })}</span></div>
              ${s.itemId === active?.ship_item_id ? badge(tx('Activă'), 'ok', true) : '<span></span>'}
              ${button(tx('Deschide'), { cls: 'sm', attrs: `data-ship="${s.itemId}"` })}
            </div>`;
          }).join('')}</div>`
        : emptyState({ title: tx('Nicio navă asamblată'), text: tx('Nu am găsit nave asamblate în asset-urile tale.'), vy: 'No Hulls Assembled', vyText: 'No assembled vessels were found among your holdings.' });
      body.addEventListener('click', async (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-ship]');
        const ship = btn && ships.find((s) => s.itemId === Number(btn.dataset.ship));
        if (!ship) return;
        const loaded = await fitFromShipWithAbyssal(sde, ship, label(ship), dynamicItem);
        closeModal();
        env.setFit(loaded, true);
        toast(tx('Fit încărcat de pe {name}', { name: label(ship) }));
      });
    } catch (err) {
      body.innerHTML = alertBox((err as Error).message);
    }
  }

  async function openEsi() {
    const c = ctx.character;
    const problem = loginProblem(c);
    if (problem || !c.characterId) {
      toast(problem ?? '');
      return;
    }
    const characterId = c.characterId;
    const modal = openModal(`${tx('Fit-uri EVE')} · ${c.name}`, `<div class="dim">${lore(tx('Se încarcă fit-urile din joc…'), 'Weaving the Flow…')}</div>`, { wide: true });
    const body = modal.querySelector('.panel-body')!;
    if (!hasPermission(characterId, 'fittings')) {
      body.innerHTML = permissionGate('fittings', characterId, c.name);
      return;
    }
    try {
      const list = await listFittings(characterId);
      body.innerHTML = `
        <div class="row-actions">${button(tx('Trimite fit-ul curent în EVE'), { iconName: 'upload', attrs: 'data-send' })}</div>
        <div class="fit-list">${list.map((f) => `<div class="fit-list-row">
          <img src="${typeIconUrl(f.ship_type_id, 32)}" alt="" />
          <div><b>${esc(f.name)}</b><span class="dim small">${esc(name(f.ship_type_id))}</span></div>
          ${button(tx('Deschide'), { cls: 'sm', attrs: `data-esi-open="${f.fitting_id}"` })}
        </div>`).join('') || `<p class="dim">${tx('Nu ai fit-uri salvate în joc.')}</p>`}</div>`;
      body.addEventListener('click', async (e) => {
        const t = e.target as HTMLElement;
        const open = t.closest<HTMLElement>('[data-esi-open]');
        if (open) {
          const f = list.find((x) => x.fitting_id === Number(open.dataset.esiOpen));
          if (f && sde.types.has(f.ship_type_id)) { closeModal(); env.setFit(fromEsiFitting(sde, f), true); toast(tx('Fit importat din EVE')); }
        }
        const send = t.closest<HTMLButtonElement>('[data-send]');
        if (send && !send.disabled) {
          const fit = env.getFit();
          if (!fit) return toast(tx('Nu ai niciun fit'));
          send.disabled = true;
          try {
            await saveFitting(characterId, toEsiFitting(sde, fit));
            toast(tx('Fit trimis în EVE'));
            closeModal();
          } catch (err) {
            send.disabled = false;
            toast((err as Error).message);
          }
        }
      });
    } catch (err) {
      body.innerHTML = alertBox((err as Error).message);
    }
  }

  return { openSavedFits, openImport, openExport, openCompare, openMutation, openShips, openEsi };
}
