import type { AppContext } from '../app/context';
import { panel, loader, alertBox, esc, button, confirmDialog } from '../ui/components';
import { loginProblem } from '../character/sso';
import { loadMap, displaySec, secClass, type NavMap } from '../services/navigation';
import { loadEscalations, saveEscalations, expiresAt, type Escalation } from '../services/escalations';
import { pveOrigin, type Origin } from '../services/pveOrigin';
import { tx, locale } from '../i18n';

const HOURS = [12, 24, 48, 72];

const dateTime = (ms: number) => new Date(ms).toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const toLocalInput = (ms: number) => {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
};
function left(ms: number) {
  const m = Math.round((ms - Date.now()) / 60000);
  if (m <= 0) return null;
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h ${String(m % 60).padStart(2, '0')} min` : tx('{n} zile', { n: Math.floor(h / 24) });
}

export function createEscalationsPanel(el: HTMLElement, ctx: AppContext, opts: { dedNames: () => string[]; openMission: (name: string) => void }) {
  let visible = false;
  let seq = 0;
  let map: NavMap | null = null;
  let origin: Origin = { system: null, esi: false, needScope: false };
  let timer = 0;
  let showDone = false;

  const charId = () => (!loginProblem(ctx.character) && ctx.character.characterId) || 0;

  async function load() {
    if (!visible) return;
    const mine = ++seq;
    if (!map) el.innerHTML = panel({ body: loader(tx('Încarc harta')) });
    try {
      map = await loadMap();
      origin = await pveOrigin(ctx, map);
      if (mine !== seq || !visible) return;
      render();
    } catch (err) {
      if (mine === seq) el.innerHTML = panel({ body: alertBox((err as Error).message, 'danger') });
    }
  }

  function render() {
    if (!map) return;
    const m = map;
    const me = charId();
    const all = loadEscalations().filter((e) => e.char === me);
    const list = all.filter((e) => showDone || !e.done).sort((a, b) => Number(a.done) - Number(b.done) || expiresAt(a) - expiresAt(b));
    const dist = origin.system ? m.gateDistances(origin.system.id, 80) : null;
    const names = opts.dedNames();
    const row = (e: Escalation) => {
      const sys = m.systems.get(e.system);
      const rest = left(expiresAt(e));
      const known = names.some((n) => n.toLowerCase() === e.name.toLowerCase());
      const state = e.done ? `<span class="badge ok">${tx('Făcută')}</span>` : rest ? `<span class="num ${expiresAt(e) - Date.now() < 3 * 3600000 ? 'down' : ''}">${rest}</span>` : `<span class="badge danger">${tx('Expirată')}</span>`;
      return `<tr class="${e.done || !rest ? 'dim' : ''}">
        <td><b>${esc(e.name)}</b>${e.note ? `<div class="small dim">${esc(e.note)}</div>` : ''}</td>
        <td>${sys ? `${esc(sys.name)} <span class="sec ${secClass(sys.sec)}">${displaySec(sys.sec).toFixed(1)}</span><div class="small dim">${esc(m.region(sys))}</div>` : '—'}</td>
        <td class="r num">${dist && sys ? dist.get(sys.id) ?? '80+' : '—'}</td>
        <td class="num dim">${dateTime(e.at)}</td>
        <td class="nowrap">${state}<div class="small dim">${dateTime(expiresAt(e))}</div></td>
        <td class="r nowrap">${known ? button(tx('Ghid'), { cls: 'sm ghost', attrs: `data-esc-guide="${esc(e.name)}"` }) : ''} ${e.done ? '' : button(tx('Făcută'), { cls: 'sm', attrs: `data-esc-done="${e.id}"` })} ${button(tx('Șterge'), { cls: 'sm ghost', attrs: `data-esc-del="${e.id}"` })}</td>
      </tr>`;
    };
    el.innerHTML = `<div class="stack">
      ${panel({
        title: tx('Escaladări DED'),
        count: all.length ? tx('{n} active', { n: all.filter((e) => !e.done && expiresAt(e) > Date.now()).length }) : '',
        body: `${me ? '' : `<p class="dim small wallet-note">${tx('Escaladările se salvează pe caracter. Fără caracter logat le ții într-o listă comună.')}</p>`}
          <form class="pve-esc-form" id="escForm">
            <label>${tx('Complex DED')} <input class="input sm" name="name" list="escNames" required autocomplete="off" placeholder="${esc(tx('Numele din Journal'))}" /></label>
            <datalist id="escNames">${names.map((n) => `<option value="${esc(n)}"></option>`).join('')}</datalist>
            <label>${tx('Sistem')} <input class="input sm" name="system" list="escSystems" autocomplete="off" /></label>
            <datalist id="escSystems"></datalist>
            <label>${tx('Primită')} <input class="input sm" type="datetime-local" name="at" value="${toLocalInput(Date.now())}" /></label>
            <label>${tx('Expiră după')} <select class="input sm" name="hours">${HOURS.map((h) => `<option value="${h}" ${h === 24 ? 'selected' : ''}>${tx('{n} ore', { n: h })}</option>`).join('')}</select></label>
            <label>${tx('Notă')} <input class="input sm" name="note" autocomplete="off" /></label>
            ${button(tx('Adaugă'), { cls: 'sm', attrs: 'type="submit"' })}
          </form>
          <p class="dim small wallet-note">${tx('Timpul exact până expiră îl vezi în joc, în Journal, la Expeditions. Dacă diferă, alege durata potrivită sau corectează ora primirii.')}</p>
          ${list.length ? `<div class="wallet-scroll tall"><table class="table compact"><thead><tr><th>${tx('Complex')}</th><th>${tx('Sistem')}</th><th class="r">${tx('Salturi')}</th><th>${tx('Primită')}</th><th>${tx('Rămas')}</th><th></th></tr></thead><tbody>${list.map(row).join('')}</tbody></table></div>` : `<p class="dim">${tx('Nicio escaladare salvată. Când primești una dintr-o anomalie, adaug-o aici ca să nu-ți expire.')}</p>`}
          ${all.some((e) => e.done) ? `<label class="check small"><input type="checkbox" id="escShowDone" ${showDone ? 'checked' : ''} /> ${tx('Arată și escaladările făcute')}</label>` : ''}`,
      })}
    </div>`;
    const sysInput = el.querySelector<HTMLInputElement>('[name="system"]')!;
    const sysList = el.querySelector<HTMLDataListElement>('#escSystems')!;
    sysInput.addEventListener('input', () => {
      sysList.innerHTML = m.suggest(sysInput.value, 10).map((s) => `<option value="${esc(s.name)}">${esc(m.region(s))}</option>`).join('');
    });
    el.querySelector<HTMLFormElement>('#escForm')!.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(e.target as HTMLFormElement);
      const name = String(f.get('name') ?? '').trim();
      if (!name) return;
      const sys = m.find(String(f.get('system') ?? ''));
      const at = Date.parse(String(f.get('at') ?? '')) || Date.now();
      const item: Escalation = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, char: me, name, system: sys?.id ?? 0, at, hours: Number(f.get('hours')) || 24, note: String(f.get('note') ?? '').trim(), done: false };
      saveEscalations([...loadEscalations(), item]);
      render();
    });
  }

  const update = (fn: (list: Escalation[]) => Escalation[]) => { saveEscalations(fn(loadEscalations())); render(); };

  el.addEventListener('click', async (e) => {
    const t = e.target as HTMLElement;
    const done = t.closest<HTMLElement>('[data-esc-done]');
    if (done) { update((l) => l.map((x) => (x.id === done.dataset.escDone ? { ...x, done: true } : x))); return; }
    const del = t.closest<HTMLElement>('[data-esc-del]');
    if (del) {
      if (await confirmDialog(tx('Ștergi escaladarea din listă?'), { ok: tx('Șterge'), danger: true })) update((l) => l.filter((x) => x.id !== del.dataset.escDel));
      return;
    }
    const guide = t.closest<HTMLElement>('[data-esc-guide]');
    if (guide) opts.openMission(guide.dataset.escGuide!);
  });
  el.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id === 'escShowDone') { showDone = t.checked; render(); }
  });

  ctx.onCharacterChange(() => { if (visible) load(); });

  return {
    show() { visible = true; load(); clearInterval(timer); timer = window.setInterval(() => { if (visible && !el.querySelector(':focus')) render(); }, 60000); },
    hide() { visible = false; seq++; clearInterval(timer); },
  };
}
