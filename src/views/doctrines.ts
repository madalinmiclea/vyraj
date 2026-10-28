import type { AppContext } from '../app/context';
import type { Fit } from '../engine/fit';
import { fitContents } from '../engine/fit';
import { fromStored, loadStoredCharacters, type Character } from '../character/characters';
import { alphaRaces, fitTypeIds, requirementsFor } from '../character/requirements';
import { addItemToPlan, loadPlan, savePlan } from '../character/skillPlan';
import { formatDuration } from '../character/training';
import { portraitUrl } from '../character/esi';
import { loadFits } from '../fitting/savedFits';
import { exportEft, exportMultibuy } from '../io/eft';
import { fetchPrices, forgetPrices, pricesAt, typeIconUrl, type Aggregates } from '../services/market';
import {
  ROLES, deleteDoctrine, doctrineFit, doctrineText, doctrineUrl, loadDoctrines, newDoctrine, parseDoctrineText, roleLabel, upsertDoctrine,
  type Doctrine, type DoctrineFit, type Role,
} from '../fitting/doctrines';
import { alertBox, button, closeModal, compactISK, confirmDialog, copyText, dataStamp, emptyState, esc, formatISK, lore, openModal, pageHead, panel, toast, windowTitle } from '../ui/components';
import { icon } from '../ui/icons';
import { loadJson, saveJson } from '../storage';
import { tx } from '../i18n';

export interface DoctrinesView {
  render(): void;
  importShared(d: Doctrine): Promise<void>;
}

const SEL_KEY = 'eve-fit:doctrine-selected';

export function createDoctrinesView(el: HTMLElement, ctx: AppContext, side: HTMLElement, opts: { openFit: (fit: Fit) => void; currentFit: () => Fit | null }): DoctrinesView {
  const sde = ctx.sde;
  let selected = loadJson<string>(SEL_KEY, '');
  let prices: Map<number, Aggregates> | null = null;
  let priceIds: number[] = [];
  let priceFor = '';

  const name = (id: number) => sde.types.get(id)?.name ?? `#${id}`;
  const list = () => loadDoctrines();
  const current = () => list().find((d) => d.id === selected) ?? list()[0] ?? null;
  const pilots = (): Character[] => loadStoredCharacters().map(fromStored);
  const select = (id: string) => { selected = id; saveJson(SEL_KEY, id); render(); };
  const save = (d: Doctrine) => { upsertDoctrine(d); render(); };

  function renderSide() {
    const docs = list();
    const active = current();
    side.innerHTML = `<div class="sidebar-head">${windowTitle(tx('Doctrine'), docs.length || null)}</div>
      ${docs.length ? `<div class="side-nav">${docs.map((d) => `<button class="side-link ${d.id === active?.id ? 'active' : ''}" data-doc="${esc(d.id)}">${esc(d.name)}<span class="count">${d.fits.length}</span></button>`).join('')}</div>` : ''}
      <div class="side-actions">
        ${button(tx('Doctrină nouă'), { iconName: 'plus', cls: 'sm', attrs: 'data-doc-new' })}
        ${button(tx('Importă'), { iconName: 'upload', cls: 'ghost sm', attrs: 'data-doc-import' })}
      </div>`;
  }

  function fitCost(f: DoctrineFit): number | null {
    if (!prices) return null;
    let total = 0;
    for (const [id, n] of fitContents(sde, f.fit, true)) total += (prices.get(id)?.sellMin ?? 0) * n;
    return total;
  }

  function fitRow(f: DoctrineFit) {
    const ship = name(f.fit.shipId);
    const alpha = alphaRaces(sde, fitTypeIds(f.fit)).length > 0;
    const cost = fitCost(f);
    return `<div class="doc-fit ${f.alt ? 'alt' : ''}" data-fit="${esc(f.id)}">
      <img class="doc-fit-ico" src="${typeIconUrl(f.fit.shipId, 64)}" alt="" loading="lazy" />
      <div class="doc-fit-name">
        <b>${esc(f.fit.name)}</b>
        <span class="dim small">${esc(ship)}${alpha ? ` · <span class="doc-tag">${tx('Alpha OK')}</span>` : ''}${f.alt ? ` · <span class="doc-tag alt">${tx('Alternativă')}</span>` : ''}</span>
      </div>
      <div class="doc-fit-cost num">${cost == null ? '<span class="dim">…</span>' : cost ? `${compactISK(cost * f.qty)}${f.qty > 1 ? `<small class="dim">${compactISK(cost)} / ${tx('buc.')}</small>` : ''}` : `<span class="dim">${tx('fără ordine')}</span>`}</div>
      <div class="doc-fit-controls">
        <label class="doc-field"><span>${tx('Rol')}</span><select class="input" data-fit-role>${ROLES.map((r) => `<option value="${r.id}" ${r.id === f.role ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select></label>
        <label class="doc-field qty"><span>${tx('Bucăți')}</span><input class="input" type="number" min="1" max="999" step="1" value="${f.qty}" data-fit-qty /></label>
        <div class="doc-fit-actions">
          ${button(tx('Deschide'), { iconName: 'fitting', cls: 'sm', attrs: 'data-fit-open' })}
          <button class="btn ghost sm icon-only" data-fit-eft data-tip="${tx('Copiază EFT')}" aria-label="${tx('Copiază EFT')}">${icon('copy')}</button>
          <button class="btn ghost sm icon-only" data-fit-alt data-tip="${f.alt ? tx('Marchează ca principal') : tx('Marchează ca alternativă')}" aria-label="${tx('Alternativă')}">${icon('swap')}</button>
          <button class="btn ghost sm icon-only" data-fit-del data-tip="${tx('Scoate din doctrină')}" aria-label="${tx('Scoate din doctrină')}">${icon('trash')}</button>
        </div>
      </div>
    </div>`;
  }

  function fitsPanel(d: Doctrine) {
    const saved = loadFits();
    const groups = ROLES.map((r) => ({ r, fits: d.fits.filter((f) => f.role === r.id) })).filter((g) => g.fits.length);
    const body = d.fits.length
      ? groups.map((g) => `<div class="doc-role">
          <div class="section-title">${esc(g.r.label)}<span class="count">${g.fits.reduce((a, f) => a + f.qty, 0)}</span></div>
          ${g.fits.map((f) => fitRow(f)).join('')}
        </div>`).join('')
      : `<p class="dim">${tx('Doctrina nu are încă fituri. Adaugă unul din fiturile salvate, fitul deschis acum în Fitting sau lipește unul sau mai multe fituri EFT.')}</p>`;
    return `<section class="panel">
      <div class="panel-head">${windowTitle(tx('Fituri'), d.fits.length || null)}</div>
      <div class="panel-body">
        ${body}
        <div class="doc-add">
          ${saved.length ? `<label class="doc-field grow"><span>${tx('Din fiturile salvate')}</span><select class="input" id="docSaved">${saved.map((f) => `<option value="${esc(f.id)}">${esc(f.name)} · ${esc(name(f.shipId))}</option>`).join('')}</select></label>
          ${button(tx('Adaugă'), { iconName: 'plus', cls: 'sm', attrs: 'data-add-saved' })}` : ''}
          ${button(tx('Fitul din Fitting'), { iconName: 'fitting', cls: 'ghost sm', attrs: 'data-add-current' })}
          ${button(tx('Lipește EFT'), { iconName: 'upload', cls: 'ghost sm', attrs: 'data-add-eft' })}
        </div>
      </div>
    </section>`;
  }

  function readinessPanel(d: Doctrine) {
    const chars = pilots();
    if (!d.fits.length) return '';
    if (!chars.length) {
      return panel({ title: tx('Cine poate zbura'), body: `<p class="dim">${tx('Fă login cu caracterele tale în Caracter (sau creează unul custom) și aici vezi pentru fiecare fit cine îl poate zbura acum și cât mai are de antrenat.')}</p>` });
    }
    const req = new Map<string, ReturnType<typeof requirementsFor>>();
    for (const f of d.fits) for (const c of chars) req.set(`${f.id}|${c.id}`, requirementsFor(sde, fitTypeIds(f.fit), c));
    const summary = chars.map((c) => {
      const ready = d.fits.filter((f) => req.get(`${f.id}|${c.id}`)!.canFly);
      const roles = ROLES.filter((r) => ready.some((f) => f.role === r.id)).map((r) => r.label);
      const next = d.fits.filter((f) => !req.get(`${f.id}|${c.id}`)!.canFly).sort((a, b) => req.get(`${a.id}|${c.id}`)!.totalSeconds - req.get(`${b.id}|${c.id}`)!.totalSeconds)[0];
      return `<div class="doc-pilot">
        ${c.characterId ? `<img src="${portraitUrl(c.characterId, 64)}" alt="" />` : `<span class="char-placeholder">${icon('character')}</span>`}
        <div>
          <b>${esc(c.name)}</b>
          <span class="small">${ready.length ? `<span class="ok-text">${tx('{n} din {total} fituri', { n: ready.length, total: d.fits.length })}</span> · ${esc(roles.join(', '))}` : `<span class="dim">${tx('Încă niciun fit')}</span>`}</span>
          ${next ? `<span class="small dim">${tx('Cel mai aproape: {fit} în {time}', { fit: esc(next.fit.name), time: formatDuration(req.get(`${next.id}|${c.id}`)!.totalSeconds) })}</span>` : ''}
        </div>
      </div>`;
    }).join('');
    const cell = (f: DoctrineFit, c: Character) => {
      const r = req.get(`${f.id}|${c.id}`)!;
      if (r.canFly) return `<td class="doc-cell ok">${icon('check')}${tx('Gata')}</td>`;
      return `<td class="doc-cell"><button class="doc-train" data-plan="${esc(f.id)}" data-plan-char="${esc(c.id)}" data-tip="${tx('{n} skill-uri lipsă · click: adaugă-le în planul lui {name}', { n: r.missing.length, name: c.name })}">${formatDuration(r.totalSeconds)}</button></td>`;
    };
    return `<section class="panel">
      <div class="panel-head">${windowTitle(tx('Cine poate zbura'))}</div>
      <div class="panel-body">
        <div class="doc-pilots">${summary}</div>
        <div class="table-scroll"><table class="table compact doc-matrix">
          <thead><tr><th>${tx('Fit')}</th>${chars.map((c) => `<th class="c">${esc(c.name)}</th>`).join('')}</tr></thead>
          <tbody>${d.fits.map((f) => `<tr><td><span class="doc-matrix-fit"><img src="${typeIconUrl(f.fit.shipId, 32)}" alt="" loading="lazy" />${esc(f.fit.name)}<span class="dim small">${esc(roleLabel(f.role))}</span></span></td>${chars.map((c) => cell(f, c)).join('')}</tr>`).join('')}</tbody>
        </table></div>
        <p class="dim small">${tx('Timpul e calculat cu atributele și implanturile fiecărui caracter. Click pe un timp ca să adaugi skill-urile lipsă în planul acelui caracter.')}</p>
      </div>
    </section>`;
  }

  function costPanel(d: Doctrine) {
    if (!d.fits.length) return '';
    if (!prices) return panel({ title: tx('Cost Jita (vânzare minimă)'), body: `<div class="dim small">${lore(tx('Se încarcă prețurile…'), 'Weaving the Flow…')}</div>` });
    const rows = ROLES.map((r) => {
      const fits = d.fits.filter((f) => f.role === r.id);
      return { r, n: fits.reduce((a, f) => a + f.qty, 0), total: fits.reduce((a, f) => a + (fitCost(f) ?? 0) * f.qty, 0) };
    }).filter((x) => x.n);
    const total = rows.reduce((a, x) => a + x.total, 0);
    return `<section class="panel">
      <div class="panel-head">${windowTitle(tx('Cost Jita (vânzare minimă)'))}</div>
      <div class="panel-body">
        <div class="cost-total"><span class="num">${formatISK(total, 0)}</span> ISK <span class="dim">(${compactISK(total)})</span></div>
        <table class="table compact"><tbody>${rows.map((x) => `<tr><td>${esc(x.r.label)} <span class="dim">×${x.n}</span></td><td class="r num">${compactISK(x.total)}</td></tr>`).join('')}</tbody></table>
        <p class="dim small">${tx('Nava, modulele fitate și dronele, înmulțite cu bucățile cerute. Fără muniție, cargo și implanturi.')}</p>
        <div class="row-actions">${button(tx('Copiază Multibuy'), { iconName: 'copy', cls: 'ghost sm', attrs: 'data-doc-multibuy' })}${dataStamp(pricesAt(priceIds), 'data-doc-prices')}</div>
      </div>
    </section>`;
  }

  async function loadPrices(d: Doctrine, fresh = false) {
    const ids = [...new Set(d.fits.flatMap((f) => [...fitContents(sde, f.fit, true).keys()]))];
    const key = ids.sort((a, b) => a - b).join(',');
    if (!fresh && key === priceFor && prices) return;
    priceFor = key;
    priceIds = ids;
    if (fresh) forgetPrices(ids);
    try {
      const p = await fetchPrices(ids);
      if (priceFor !== key) return;
      prices = p;
      render();
    } catch {
      const target = el.querySelector('#docCost');
      if (target) target.innerHTML = alertBox(tx('Nu am putut încărca prețurile din Jita (Fuzzwork).'));
    }
  }

  function render() {
    renderSide();
    const d = current();
    if (!d) {
      el.innerHTML = `${pageHead(tx('Doctrine'), tx('Fituri de flotă pentru corporație: cine poate zbura și cât costă'), 'Druzhina')}
        ${panel({ body: emptyState({
          title: tx('Nicio doctrină încă'),
          text: tx('O doctrină e setul de fituri pe care îl zboară flota: DPS, logistică, tackle și restul. Vyraj îți arată pentru fiecare caracter ce poate zbura și cât mai are de antrenat, cât costă tot în Jita și îți dă un link sau un text de pus pe Discord.'),
          extra: `<div class="home-actions">${button(tx('Doctrină nouă'), { iconName: 'plus', attrs: 'data-doc-new' })}${button(tx('Importă'), { iconName: 'upload', cls: 'ghost', attrs: 'data-doc-import' })}</div>`,
          vy: 'Druzhina',
        }) })}`;
      return;
    }
    el.innerHTML = `${pageHead(tx('Doctrine'), tx('Fituri de flotă pentru corporație: cine poate zbura și cât costă'), 'Druzhina')}
      <section class="panel doc-head">
        <div class="panel-body">
          <input class="input doc-title" id="docName" value="${esc(d.name)}" maxlength="80" aria-label="${tx('Numele doctrinei')}" />
          <textarea class="input area" id="docNotes" rows="3" maxlength="4000" placeholder="${tx('Note pentru flotă: compoziție, ancore, muniție, reguli de broadcast')}">${esc(d.notes)}</textarea>
          <div class="row-actions">
            ${button(tx('Copiază link'), { iconName: 'link', cls: 'sm', attrs: 'data-doc-link' })}
            ${button(tx('Copiază text pentru Discord'), { iconName: 'copy', cls: 'ghost sm', attrs: 'data-doc-text' })}
            ${button(tx('Duplică'), { iconName: 'plus', cls: 'ghost sm', attrs: 'data-doc-dup' })}
            ${button(tx('Șterge'), { iconName: 'trash', cls: 'ghost sm', attrs: 'data-doc-del' })}
            ${button(tx('Doctrină nouă'), { iconName: 'plus', cls: 'ghost sm doc-phone', attrs: 'data-doc-new' })}
            ${button(tx('Importă'), { iconName: 'upload', cls: 'ghost sm doc-phone', attrs: 'data-doc-import' })}
          </div>
        </div>
      </section>
      <div class="doc-layout">
        <div class="stack">${fitsPanel(d)}${readinessPanel(d)}</div>
        <aside class="stack" id="docCost">${costPanel(d)}</aside>
      </div>`;
    loadPrices(d);
  }

  function openImport(target: Doctrine | null) {
    const modal = openModal(target ? tx('Adaugă fituri EFT') : tx('Importă doctrină'), `
      <p class="dim small">${tx('Lipește unul sau mai multe fituri EFT, din joc, Pyfa sau Discord. Un rând cu numele rolului (de exemplu „## logi” sau „Logi:”) pune fiturile de sub el în acel rol. Un link de doctrină Vyraj se deschide direct în browser.')}</p>
      <textarea class="input area" id="docEft" rows="14" spellcheck="false" placeholder="[Ferox, Ferox fleet]&#10;Damage Control II&#10;..."></textarea>
      <div class="row-actions">${button(target ? tx('Adaugă') : tx('Importă'), { iconName: 'upload', attrs: 'data-eft-go' })}</div>
      <div id="docEftMsg"></div>`, { wide: true });
    modal.addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('[data-eft-go]')) return;
      const text = modal.querySelector<HTMLTextAreaElement>('#docEft')!.value;
      const link = text.match(/#doctrine=[A-Za-z0-9_-]+/);
      if (link) { closeModal(); location.hash = link[0]; return; }
      const res = parseDoctrineText(sde, text);
      if (!res.fits.length) {
        modal.querySelector('#docEftMsg')!.innerHTML = alertBox(tx('Nu am găsit niciun fit EFT valid. Fiecare fit începe cu un rând de forma [Navă, Nume fit].'));
        return;
      }
      const d = target ?? newDoctrine(res.name || tx('Doctrină importată'));
      d.fits.push(...res.fits);
      selected = d.id;
      saveJson(SEL_KEY, d.id);
      closeModal();
      save(d);
      const extra = [res.failed.length ? tx('{n} fituri cu nave necunoscute sărite', { n: res.failed.length }) : '', res.unknown.length ? tx('{n} rânduri necunoscute', { n: res.unknown.length }) : ''].filter(Boolean).join(', ');
      toast(tx('{n} fituri adăugate', { n: res.fits.length }) + (extra ? ` (${extra})` : ''));
    });
    modal.querySelector<HTMLTextAreaElement>('#docEft')!.focus();
  }

  const onSide = (e: Event) => {
    const t = e.target as HTMLElement;
    const doc = t.closest<HTMLElement>('[data-doc]');
    if (doc) { select(doc.dataset.doc!); return; }
    if (t.closest('[data-doc-new]')) {
      const d = newDoctrine();
      selected = d.id;
      saveJson(SEL_KEY, d.id);
      save(d);
      el.querySelector<HTMLInputElement>('#docName')?.select();
      return;
    }
    if (t.closest('[data-doc-import]')) openImport(null);
  };
  side.addEventListener('click', onSide);

  el.addEventListener('click', async (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-doc-new], [data-doc-import]')) { onSide(e); return; }
    const d = current();
    if (!d) return;
    const row = t.closest<HTMLElement>('[data-fit]');
    const f = row ? d.fits.find((x) => x.id === row.dataset.fit) : undefined;
    if (f && t.closest('[data-fit-open]')) { opts.openFit(f.fit); return; }
    if (f && t.closest('[data-fit-eft]')) { copyText(exportEft(sde, f.fit), tx('Fit copiat în format EFT')); return; }
    if (f && t.closest('[data-fit-alt]')) { f.alt = !f.alt; save(d); return; }
    if (f && t.closest('[data-fit-del]')) {
      if (!await confirmDialog(tx('Scoți fitul „{name}” din doctrină?', { name: f.fit.name }), { ok: tx('Scoate'), danger: true })) return;
      d.fits = d.fits.filter((x) => x.id !== f.id);
      save(d);
      return;
    }
    const plan = t.closest<HTMLElement>('[data-plan]');
    if (plan) {
      const fit = d.fits.find((x) => x.id === plan.dataset.plan);
      const c = pilots().find((x) => x.id === plan.dataset.planChar);
      if (!fit || !c) return;
      savePlan(c.id, fitTypeIds(fit.fit).reduce((p, id) => addItemToPlan(sde, p, c, id), loadPlan(c.id)));
      toast(tx('Skill-urile pentru {fit} au intrat în planul lui {name}', { fit: fit.fit.name, name: c.name }));
      return;
    }
    if (t.closest('[data-add-saved]')) {
      const id = el.querySelector<HTMLSelectElement>('#docSaved')?.value;
      const fit = loadFits().find((x) => x.id === id);
      if (fit) { d.fits.push(doctrineFit(sde, fit)); save(d); }
      return;
    }
    if (t.closest('[data-add-current]')) {
      const fit = opts.currentFit();
      if (!fit) { toast(tx('Nu ai niciun fit deschis în Fitting')); return; }
      d.fits.push(doctrineFit(sde, fit));
      save(d);
      toast(tx('{name} adăugat în doctrină', { name: fit.name }));
      return;
    }
    if (t.closest('[data-add-eft]')) { openImport(d); return; }
    if (t.closest('[data-doc-link]')) {
      if (!d.fits.length) { toast(tx('Adaugă întâi fituri în doctrină')); return; }
      doctrineUrl(d).then((url) => copyText(url, tx('Link copiat. Cine îl deschide primește doctrina cu toate fiturile.'))).catch(() => toast(tx('Browserul nu poate crea linkul')));
      return;
    }
    if (t.closest('[data-doc-text]')) { copyText(doctrineText(sde, d), tx('Doctrina copiată ca text EFT')); return; }
    if (t.closest('[data-doc-dup]')) {
      const copy: Doctrine = { ...JSON.parse(JSON.stringify(d)) as Doctrine, id: newDoctrine().id, name: `${d.name} (${tx('copie')})` };
      selected = copy.id;
      saveJson(SEL_KEY, copy.id);
      save(copy);
      return;
    }
    if (t.closest('[data-doc-del]')) {
      if (!await confirmDialog(tx('Ștergi doctrina „{name}” cu toate cele {n} fituri? Fiturile salvate în Fitting rămân.', { name: d.name, n: d.fits.length }), { ok: tx('Șterge'), danger: true })) return;
      deleteDoctrine(d.id);
      selected = '';
      render();
      return;
    }
    if (t.closest('[data-doc-multibuy]')) {
      const all = new Map<number, number>();
      for (const x of d.fits) for (const [id, n] of fitContents(sde, x.fit, true)) all.set(id, (all.get(id) ?? 0) + n * x.qty);
      copyText(exportMultibuy(sde, all), tx('Lista Multibuy copiată'));
      return;
    }
    if (t.closest('[data-doc-prices]')) { loadPrices(d, true); }
  });

  el.addEventListener('change', (e) => {
    const t = e.target as HTMLElement;
    const d = current();
    if (!d) return;
    if (t.id === 'docName') { d.name = (t as HTMLInputElement).value.trim() || tx('Doctrină fără nume'); save(d); return; }
    if (t.id === 'docNotes') { d.notes = (t as HTMLTextAreaElement).value; upsertDoctrine(d); return; }
    const row = t.closest<HTMLElement>('[data-fit]');
    const f = row ? d.fits.find((x) => x.id === row.dataset.fit) : undefined;
    if (!f) return;
    if (t.matches('[data-fit-role]')) { f.role = (t as HTMLSelectElement).value as Role; save(d); }
    if (t.matches('[data-fit-qty]')) { f.qty = Math.min(999, Math.max(1, Math.round(Number((t as HTMLInputElement).value)) || 1)); save(d); }
  });
  el.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).id === 'docName' && e.key === 'Enter') (e.target as HTMLInputElement).blur();
  });

  ctx.onCharacterChange(() => { if (el.classList.contains('active')) render(); });
  render();

  return {
    render,
    async importShared(d: Doctrine) {
      const ok = await confirmDialog(tx('Imporți doctrina „{name}” cu {n} fituri? O găsești apoi în Doctrine.', { name: d.name, n: d.fits.length }), { title: tx('Doctrină din link'), ok: tx('Importă') });
      if (!ok) return;
      upsertDoctrine(d);
      select(d.id);
      toast(tx('Doctrina {name} a fost importată', { name: d.name }));
    },
  };
}
