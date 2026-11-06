import { panel, alertBox, esc, formatInt, formatNum, formatISK, compactISK, emptyState, badge, button, copyText, toast } from '../ui/components';
import { loadJson, saveJson } from '../storage';
import { typeIconUrl, type Aggregates } from '../services/market';
import { parseItems } from '../services/appraisal';
import { typeName } from '../services/typeNames';
import { solveOres, type OreOption } from '../services/oreSolver';
import type { MiningData, Ore } from '../services/mining';
import { tx } from '../i18n';

type Basis = 'sell' | 'buy';
type Source = 'ore' | 'moon' | 'ice';

interface Form { need: Record<string, number>; extra: number[]; sources: Source[]; variants: boolean; basis: Basis }

interface Deps {
  data: MiningData;
  yieldOf: (ore: Ore) => number;
  price: (basis: Basis) => (id: number) => number;
  agg: (id: number) => Aggregates | undefined;
  place: string;
}

const KEY = 'eve-mining:compress';
const BASIC = [34, 35, 36, 37, 38, 39, 40, 11399];
const SOURCES = (): { id: Source; label: string }[] => [
  { id: 'ore', label: tx('Asteroizi') },
  { id: 'moon', label: tx('Minereu de lună') },
  { id: 'ice', label: tx('Gheață') },
];

export function createCompressPanel(host: HTMLElement, deps: () => Deps) {
  const form: Form = { need: {}, extra: [], sources: ['ore'], variants: true, basis: 'sell', ...loadJson<Partial<Form>>(KEY, {}) };
  let timer = 0;
  let lastList = '';

  const save = () => saveJson(KEY, form);
  const shown = () => [...BASIC, ...form.extra.filter((id) => !BASIC.includes(id))];

  function render() {
    const d = deps();
    const names = d.data.minerals;
    const others = [...names.keys()].filter((id) => !shown().includes(id)).sort((a, b) => (names.get(a) ?? '').localeCompare(names.get(b) ?? ''));
    host.innerHTML = panel({
      title: tx('Calculator minereu comprimat'),
      body: `<div class="compress-grid">
          ${shown().map((id) => `<label class="compress-need"><span class="nav-ship-name"><img class="row-icon" src="${typeIconUrl(id, 32)}" alt="" />${esc(names.get(id) ?? typeName(id))}</span><input class="input" type="number" min="0" step="1" data-need="${id}" value="${form.need[id] || ''}" placeholder="0" /></label>`).join('')}
        </div>
        <div class="compress-tools">
          <div class="advice-sort">${SOURCES().map((s) => `<button type="button" class="chip-btn ${form.sources.includes(s.id) ? 'active' : ''}" data-source="${s.id}">${s.label}</button>`).join('')}</div>
          <label class="check"><input type="checkbox" data-variants ${form.variants ? 'checked' : ''} /> ${tx('Variante +5% / +10% / +15%')}</label>
          <div class="advice-sort">
            <button type="button" class="chip-btn ${form.basis === 'sell' ? 'active' : ''}" data-cbasis="sell">${tx('Jita vânzare')}</button>
            <button type="button" class="chip-btn ${form.basis === 'buy' ? 'active' : ''}" data-cbasis="buy">${tx('Jita cumpărare')}</button>
          </div>
          ${others.length ? `<select class="input compress-add" data-add><option value="">${tx('Adaugă material')}</option>${others.map((id) => `<option value="${id}">${esc(names.get(id) ?? '')}</option>`).join('')}</select>` : ''}
          ${button(tx('Golește'), { cls: 'ghost sm', attrs: 'data-clear' })}
        </div>
        <details class="compress-paste"><summary>${tx('Lipește o listă de minerale')}</summary>
          <textarea class="input area" rows="5" spellcheck="false" data-paste></textarea>
          <div class="row-actions">${button(tx('Folosește lista'), { cls: 'sm', attrs: 'data-use-paste' })}</div>
        </details>
        <div data-result></div>`,
    });
    compute();
  }

  function compute() {
    const out = host.querySelector<HTMLElement>('[data-result]');
    if (!out) return;
    const d = deps();
    const need = new Map(Object.entries(form.need).map(([k, v]) => [Number(k), Math.max(0, Math.floor(v))] as [number, number]).filter(([, v]) => v > 0));
    if (!need.size) { out.innerHTML = ''; lastList = ''; return; }
    const p = d.price(form.basis);
    const opts: (OreOption & { ore: Ore; unit: number })[] = d.data.ores
      .filter((o) => o.compressedId && o.materials.length && form.sources.includes(o.kind as Source))
      .filter((o) => form.variants || !o.baseId)
      .map((o) => {
        const y = d.yieldOf(o);
        const unit = p(o.compressedId!);
        const mats = o.compressedMaterials ?? o.materials;
        return { id: o.compressedId!, ore: o, unit, cost: unit * o.portion, yields: new Map(mats.map(([id, q]) => [id, q * y] as [number, number])) };
      })
      .filter((o) => o.unit > 0);
    const res = solveOres(need, opts, (o, id, b) => Math.floor((o.yields.get(id) ?? 0) * b + 1e-9));
    const picked = opts.filter((o) => res.batches.has(o.id)).map((o) => {
      const b = res.batches.get(o.id)!;
      const units = b * o.ore.portion;
      const stock = d.agg(o.id)?.[form.basis === 'sell' ? 'sellVolume' : 'buyVolume'] ?? 0;
      return { o, b, units, cost: o.cost * b, m3: units * (o.ore.compressedVolume ?? o.ore.volume), stock };
    }).sort((a, b) => b.cost - a.cost);
    const direct = [...need].reduce((a, [id, q]) => a + q * p(id), 0);
    const priced = [...need].every(([id]) => p(id) > 0);
    const surplus = [...res.produced].reduce((a, [id, q]) => a + Math.max(0, q - (need.get(id) ?? 0)) * d.price('buy')(id), 0);
    const volume = picked.reduce((a, r) => a + r.m3, 0);
    const saving = direct - res.cost;
    const mats = [...new Set([...need.keys(), ...res.produced.keys()])].sort((a, b) => (need.get(b) ?? 0) * p(b) - (need.get(a) ?? 0) * p(a));
    lastList = picked.map((r) => `${typeName(r.o.id)} ${r.units}`).join('\n');
    const nameOf = (id: number) => d.data.minerals.get(id) ?? typeName(id);

    out.innerHTML = `${res.impossible.length ? alertBox(tx('Niciun minereu din sursele alese nu dă: {list}', { list: esc(res.impossible.map(nameOf).join(', ')) })) : ''}
      ${picked.length ? `<div class="history-kpis">
        <div><span class="label">${tx('Cost minereu')}</span><span class="value accent">${compactISK(res.cost)}</span></div>
        ${priced ? `<div><span class="label">${tx('Mineralele direct')}</span><span class="value">${compactISK(direct)}</span></div>
        <div><span class="label">${saving >= 0 ? tx('Economisești') : tx('Pierzi')}</span><span class="value ${saving >= 0 ? 'up' : 'down'}">${compactISK(Math.abs(saving))}${direct > 0 ? ` · ${formatNum((Math.abs(saving) / direct) * 100, 1)}%` : ''}</span></div>` : ''}
        <div><span class="label">${tx('Volum')}</span><span class="value">${formatInt(Math.ceil(volume))} m³</span></div>
        <div><span class="label">${tx('Surplus')}</span><span class="value">${compactISK(surplus)}</span></div>
      </div>
      <div class="compress-result">
        <div class="table-scroll"><table class="table compact compress-ores"><thead><tr><th>${tx('Minereu comprimat')}</th><th class="r">${tx('Unități')}</th><th class="r">m³</th><th class="r">${tx('Preț / unitate')}</th><th class="r">${tx('Cost')}</th><th class="r">${tx('Stoc Jita')}</th></tr></thead><tbody>
          ${picked.map((r) => `<tr><td><span class="nav-ship-name"><img class="row-icon" src="${typeIconUrl(r.o.id, 32)}" alt="" />${esc(typeName(r.o.id))}</span></td><td class="r num">${formatInt(r.units)}</td><td class="r num">${formatInt(Math.ceil(r.m3))}</td><td class="r num">${formatISK(r.o.unit)}</td><td class="r num">${compactISK(r.cost)}</td><td class="r num">${r.stock >= r.units ? formatInt(r.stock) : badge(tx('doar {n}', { n: formatInt(r.stock) }), 'warn')}</td></tr>`).join('')}
        </tbody></table>
        <div class="row-actions">${button(tx('Copiază pentru Multibuy'), { iconName: 'copy', cls: 'sm', attrs: 'data-copy-ore' })}</div></div>
        <div class="table-scroll"><table class="table compact"><thead><tr><th>${tx('Material')}</th><th class="r">${tx('Necesar')}</th><th class="r">${tx('Obținut')}</th><th class="r">${tx('Surplus')}</th></tr></thead><tbody>
          ${mats.map((id) => {
            const want = need.get(id) ?? 0;
            const got = res.produced.get(id) ?? 0;
            return `<tr><td><span class="nav-ship-name"><img class="row-icon" src="${typeIconUrl(id, 32)}" alt="" />${esc(nameOf(id))}</span></td><td class="r num">${want ? formatInt(want) : '<span class="dim">—</span>'}</td><td class="r num ${got < want ? 'down' : ''}">${formatInt(got)}</td><td class="r num dim">${got > want ? `+${formatInt(got - want)}` : '—'}</td></tr>`;
          }).join('')}
        </tbody></table></div>
      </div>
      <p class="dim small">${tx('Randament din tab-ul Reprocesare ({place}).', { place: esc(d.place) })}</p>` : res.impossible.length ? '' : emptyState({ title: tx('Niciun minereu comprimat cu ordine în Jita pentru sursele alese') })}`;
  }

  host.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (!t.dataset.need) return;
    form.need[t.dataset.need] = Math.max(0, Number(t.value) || 0);
    save();
    clearTimeout(timer);
    timer = window.setTimeout(compute, 300);
  });

  host.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    if (t.hasAttribute('data-variants')) { form.variants = (t as HTMLInputElement).checked; save(); compute(); }
    if (t.hasAttribute('data-add') && t.value) { form.extra = [...form.extra, Number(t.value)]; save(); render(); host.querySelector<HTMLInputElement>(`[data-need="${t.value}"]`)?.focus(); }
  });

  host.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const src = t.closest<HTMLElement>('[data-source]');
    if (src) {
      const id = src.dataset.source as Source;
      form.sources = form.sources.includes(id) ? form.sources.filter((s) => s !== id) : [...form.sources, id];
      if (!form.sources.length) form.sources = [id];
      save();
      render();
      return;
    }
    const basis = t.closest<HTMLElement>('[data-cbasis]');
    if (basis) { form.basis = basis.dataset.cbasis as Basis; save(); render(); return; }
    if (t.closest('[data-clear]')) { form.need = {}; form.extra = []; save(); render(); return; }
    if (t.closest('[data-copy-ore]') && lastList) { copyText(lastList, tx('Lista Multibuy e în clipboard. În joc: Piață, Multibuy, Import din clipboard.')); return; }
    if (t.closest('[data-use-paste]')) {
      const area = host.querySelector<HTMLTextAreaElement>('[data-paste]')!;
      const { lines } = parseItems(area.value);
      const minerals = deps().data.minerals;
      const hits = lines.filter((l) => minerals.has(l.typeId));
      if (!hits.length) { toast(tx('Nu am găsit minerale în listă')); return; }
      form.need = {};
      for (const l of hits) form.need[l.typeId] = (form.need[l.typeId] ?? 0) + l.quantity;
      form.extra = hits.map((l) => l.typeId).filter((id) => !BASIC.includes(id));
      save();
      render();
    }
  });

  return { render };
}
