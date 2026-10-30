import { panel, esc, loader } from '../ui/components';
import { notifySettings, saveNotifySettings, browserPermission, upcoming, fireAt, left, NOTIFY_KINDS, LEADS, NOTIFY_EVENT, type Upcoming } from '../services/notify';
import { tx, locale } from '../i18n';

const leadLabel = (h: number) => (h === 0 ? tx('la momentul respectiv') : tx('cu {n} h înainte', { n: h }));
const when = (ms: number) => new Date(ms).toLocaleString(locale, { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

let list: Upcoming[] | null = null;
let loading = false;

export function mountNotifyPanel(el: HTMLElement | null) {
  if (!el) return;
  const draw = () => {
    if (!el.isConnected) return;
    const s = notifySettings();
    const perm = browserPermission();
    const permNote = perm === 'unsupported'
      ? tx('Browserul nu suportă notificări; le arătăm ca mesaje în aplicație.')
      : perm === 'denied'
        ? tx('Browserul a blocat notificările pentru acest site. Le arătăm ca mesaje în aplicație până le permiți din setările browserului.')
        : perm === 'default' && s.enabled ? tx('Browserul încă nu a primit acordul pentru notificări.') : '';
    const next = (list ?? []).filter((e) => s.kinds[e.kind].on && e.at > Date.now()).slice(0, 6);
    el.innerHTML = panel({
      title: tx('Notificări'),
      count: s.enabled ? tx('pornite') : tx('oprite'),
      body: `<label class="ord-toggle nt-master"><input type="checkbox" data-nt-enabled ${s.enabled ? 'checked' : ''} /> <b>${tx('Anunță-mă când se termină ceva în joc')}</b></label>
        <p class="small dim">${tx('Vyraj verifică la 5 minute cât timp e deschis într-un tab, pentru toate caracterele logate.')}${permNote ? ` ${esc(permNote)}` : ''}</p>
        <div class="nt-kinds ${s.enabled ? '' : 'off'}">${NOTIFY_KINDS.map((k) => `<div class="nt-kind">
            <label class="ord-toggle"><input type="checkbox" data-nt-kind="${k.id}" ${s.kinds[k.id].on ? 'checked' : ''} ${s.enabled ? '' : 'disabled'} /> ${esc(k.label)}</label>
            ${k.lead ? `<select class="input plain nt-lead" data-nt-lead="${k.id}" ${s.enabled && s.kinds[k.id].on ? '' : 'disabled'}>${LEADS.map((h) => `<option value="${h}" ${h === s.kinds[k.id].lead ? 'selected' : ''}>${esc(leadLabel(h))}</option>`).join('')}</select>` : ''}
            <div class="small dim">${esc(k.hint)}</div>
          </div>`).join('')}</div>
        ${s.enabled ? `<div class="nt-next"><div class="ord-side-label">${tx('Următoarele')}</div>${list === null || loading ? loader(tx('Adunăm evenimentele')) : next.length ? `<table class="table compact"><tbody>${next.map((e) => `<tr><td>${esc(e.title)}<div class="small dim">${esc(e.body)}</div></td><td class="r num nowrap">${left(e.at - Date.now())}<div class="small dim">${tx('anunț {d}', { d: when(fireAt(e, s)) })}</div></td></tr>`).join('')}</tbody></table>` : `<p class="small dim">${tx('Nimic programat acum.')}</p>`}</div>` : ''}`,
    });
  };
  const refresh = async (force = false) => {
    if (!notifySettings().enabled || loading) { draw(); return; }
    loading = true;
    draw();
    try { list = await upcoming(force); } catch { list = []; } finally { loading = false; draw(); }
  };
  el.onchange = (e) => {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    const s = notifySettings();
    if (t.matches('[data-nt-enabled]')) s.enabled = (t as HTMLInputElement).checked;
    else if (t.matches('[data-nt-kind]')) s.kinds[(t as HTMLElement).dataset.ntKind as keyof typeof s.kinds].on = (t as HTMLInputElement).checked;
    else if (t.matches('[data-nt-lead]')) s.kinds[(t as HTMLElement).dataset.ntLead as keyof typeof s.kinds].lead = Number(t.value);
    else return;
    saveNotifySettings(s);
    refresh();
  };
  window.addEventListener(NOTIFY_EVENT, draw, { once: true });
  if (list === null) refresh(); else draw();
}
