import type { AppContext } from '../app/context';
import { pageHead, panel, loader, alertBox, esc, emptyState, windowTitle, button, toast, openModal, closeModal, confirmDialog, stampTime } from '../ui/components';
import { icon } from '../ui/icons';
import { loadJson, saveJson } from '../storage';
import { loginProblem } from '../character/sso';
import { permissionGate, hasPermission } from '../character/permissions';
import { portraitUrl } from '../character/esi';
import {
  listMail, readMail, updateMail, deleteMail, mailLabels, createLabel, deleteLabel, mailingLists, sendMail, lookupRecipients, nameMap,
  mailHtml, mailText, bodyFromText, canRead, canOrganize, canSend,
  LABEL_INBOX, LABEL_SENT, LABEL_CORP, LABEL_ALLIANCE, LABEL_COLORS,
  type MailHeader, type MailBody, type MailLabel, type MailingList, type MailRecipient,
} from '../services/mail';
import { tx, locale } from '../i18n';

type Folder = { kind: 'all' } | { kind: 'label'; id: number } | { kind: 'list'; id: number };

const UI_KEY = 'eve-mail:ui';
const PAGE = 50;

const DEFAULT_LABELS: Record<number, string> = {
  [LABEL_INBOX]: tx('Primite'),
  [LABEL_SENT]: tx('Trimise'),
  [LABEL_CORP]: tx('Corporație'),
  [LABEL_ALLIANCE]: tx('Alianță'),
};

const labelName = (l: MailLabel) => DEFAULT_LABELS[l.label_id] ?? l.name;

const fullDate = (s?: string) => (s ? new Date(s).toLocaleString(locale, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

const sameFolder = (a: Folder, b: Folder) => a.kind === b.kind && (a.kind === 'all' || (a as { id: number }).id === (b as { id: number }).id);

interface Compose { to: string; list: number; subject: string; body: string }

export function createMailView(el: HTMLElement, ctx: AppContext, side: HTMLElement) {
  const ui = loadJson<{ folder: Folder }>(UI_KEY, { folder: { kind: 'label', id: LABEL_INBOX } });
  let owner = 0;
  let labels: MailLabel[] = [];
  let lists: MailingList[] = [];
  let headers: MailHeader[] = [];
  let more = false;
  let cursor = 0;
  let names = new Map<number, string>();
  const bodies = new Map<number, MailBody>();
  let selected: number | null = null;
  let loading = false;
  let error = '';
  let token = 0;

  el.innerHTML = `${pageHead(tx('Mail'), tx('Mailurile din joc ale caracterului selectat: etichete, liste de mail, citire și trimitere'), 'Vest')}<div id="mailBody"></div>`;
  const body = el.querySelector<HTMLElement>('#mailBody')!;

  const save = () => saveJson(UI_KEY, ui);
  const who = (id?: number) => (id ? names.get(id) ?? '…' : '—');
  const labelById = (id: number) => labels.find((l) => l.label_id === id);
  const listRecipient = (h: MailHeader) => h.recipients?.find((r) => r.recipient_type === 'mailing_list')?.recipient_id;

  function folderTitle(f: Folder) {
    if (f.kind === 'all') return tx('Toate mailurile');
    if (f.kind === 'list') return lists.find((l) => l.mailing_list_id === f.id)?.name ?? tx('Listă de mail');
    const l = labelById(f.id);
    return l ? labelName(l) : DEFAULT_LABELS[f.id] ?? tx('Etichetă');
  }

  function renderSide() {
    if (!owner) { side.innerHTML = `<div class="sidebar-head">${windowTitle(tx('Mail'))}</div>`; return; }
    const sorted = [...labels].sort((a, b) => (a.label_id <= 8 ? a.label_id : 100) - (b.label_id <= 8 ? b.label_id : 100) || a.name.localeCompare(b.name));
    const link = (f: Folder, text: string, extra = '', count?: number) => `<button class="side-link ${sameFolder(ui.folder, f) ? 'active' : ''}" data-mail-folder="${f.kind}:${f.kind === 'all' ? 0 : f.id}">${extra}<span class="mail-folder-name">${esc(text)}</span>${count ? `<span class="count">${count}</span>` : ''}</button>`;
    side.innerHTML = `<div class="sidebar-head">${windowTitle(tx('Mail'))}</div>
      <div class="side-nav">
        ${link({ kind: 'all' }, tx('Toate mailurile'))}
        <div class="ord-side-label">${tx('Etichete')}</div>
        ${sorted.map((l) => link({ kind: 'label', id: l.label_id }, labelName(l), `<i class="mail-dot" style="--mail-c:${esc(l.color ?? 'transparent')}"></i>`, l.unread_count)).join('')}
        ${canOrganize(owner) ? `<button class="side-link mail-side-add" data-mail-new-label>${icon('plus')}<span>${tx('Etichetă nouă')}</span></button>` : ''}
        ${lists.length ? `<div class="ord-side-label">${tx('Liste de mail')}</div>${lists.map((l) => link({ kind: 'list', id: l.mailing_list_id }, l.name)).join('')}` : ''}
      </div>`;
  }

  function row(h: MailHeader) {
    const sentBox = ui.folder.kind === 'label' && ui.folder.id === LABEL_SENT;
    const list = listRecipient(h);
    const party = sentBox ? (h.recipients ?? []).map((r) => who(r.recipient_id)).join(', ') : who(h.from);
    const dots = (h.labels ?? []).filter((id) => id > 8).map((id) => labelById(id)).filter(Boolean).map((l) => `<i class="mail-dot" style="--mail-c:${esc(l!.color ?? 'transparent')}" title="${esc(l!.name)}"></i>`).join('');
    return `<button class="mail-row ${h.is_read ? '' : 'unread'} ${selected === h.mail_id ? 'active' : ''}" data-mail-open="${h.mail_id}">
      <span class="mail-row-top"><span class="mail-row-from">${sentBox ? `<span class="dim">${tx('Către')}</span> ` : ''}${esc(party)}</span><span class="mail-row-date">${h.timestamp ? stampTime(Date.parse(h.timestamp)) : ''}</span></span>
      <span class="mail-row-subject">${esc(h.subject || tx('(fără subiect)'))}</span>
      ${list && ui.folder.kind !== 'list' ? `<span class="mail-row-meta small dim">${icon('mail')}${esc(who(list))}</span>` : ''}${dots ? `<span class="mail-row-dots">${dots}</span>` : ''}
    </button>`;
  }

  function reader() {
    if (selected == null) return `<div class="mail-empty">${emptyState({ title: tx('Niciun mail deschis'), text: tx('Alege un mail din listă ca să-l citești.') })}</div>`;
    const h = headers.find((x) => x.mail_id === selected);
    const b = bodies.get(selected);
    if (!b) return `<div class="mail-empty">${loader(tx('Citim mailul'))}</div>`;
    const recips = (b.recipients ?? h?.recipients ?? []).map((r) => `<span class="mail-to-chip">${esc(who(r.recipient_id))}</span>`).join('');
    const mine = new Set(b.labels ?? h?.labels ?? []);
    const organize = canOrganize(owner);
    const labelChips = labels.filter((l) => l.label_id !== LABEL_SENT).map((l) => `<button class="chip-btn ${mine.has(l.label_id) ? 'active' : ''}" data-mail-label="${l.label_id}" ${organize ? '' : 'disabled'}><i class="mail-dot" style="--mail-c:${esc(l.color ?? 'transparent')}"></i>${esc(labelName(l))}</button>`).join('');
    return `<article class="mail-read">
      <div class="mail-read-actions">
        <button class="btn ghost sm mail-back" data-mail-back>${icon('chevron')}${tx('Înapoi')}</button>
        ${canSend(owner) ? `${button(tx('Răspunde'), { iconName: 'reply', cls: 'sm', attrs: 'data-mail-reply="one"' })}${button(tx('Răspunde tuturor'), { iconName: 'reply', cls: 'ghost sm', attrs: 'data-mail-reply="all"' })}${button(tx('Redirecționează'), { iconName: 'forward', cls: 'ghost sm', attrs: 'data-mail-forward' })}` : ''}
        ${organize ? `${button(tx('Marchează necitit'), { iconName: 'unread', cls: 'ghost sm', attrs: 'data-mail-unread' })}${button(tx('Șterge'), { iconName: 'trash', cls: 'ghost sm', attrs: 'data-mail-delete' })}` : ''}
      </div>
      <h2 class="mail-subject">${esc(b.subject || h?.subject || tx('(fără subiect)'))}</h2>
      <div class="mail-head">
        ${b.from ? `<img class="mail-portrait" src="${portraitUrl(b.from, 64)}" alt="" />` : ''}
        <div class="mail-head-text">
          <div><b>${esc(who(b.from))}</b> <span class="dim small">${fullDate(b.timestamp ?? h?.timestamp)}</span></div>
          <div class="mail-to"><span class="dim small">${tx('Către')}</span>${recips || '<span class="dim">—</span>'}</div>
        </div>
      </div>
      ${labelChips ? `<div class="mail-labels">${labelChips}</div>` : ''}
      <div class="mail-text">${mailHtml(b.body ?? '')}</div>
    </article>`;
  }

  function render() {
    renderSide();
    const c = ctx.character;
    const problem = loginProblem({ kind: c.kind, characterId: c.characterId, name: c.name });
    if (problem) {
      body.innerHTML = panel({ body: emptyState({ title: tx('Niciun caracter EVE selectat'), text: problem }) });
      return;
    }
    if (!canRead(c.characterId!)) {
      body.innerHTML = panel({ body: permissionGate('mail', c.characterId!, c.name) });
      return;
    }
    const gate = hasPermission(c.characterId!, 'mail') ? '' : panel({ body: permissionGate('mail', c.characterId!, c.name) });
    const isCustom = ui.folder.kind === 'label' && ui.folder.id > 8 && canOrganize(owner);
    const actions = `${canSend(owner) ? button(tx('Mail nou'), { iconName: 'plus', cls: 'sm', attrs: 'data-mail-compose' }) : ''}
      ${isCustom ? button(tx('Șterge eticheta'), { iconName: 'trash', cls: 'ghost sm', attrs: 'data-mail-del-label' }) : ''}
      <button class="btn ghost sm" data-mail-refresh ${loading ? 'disabled' : ''}>${icon('refresh')}${loading ? tx('Se încarcă…') : tx('Reîmprospătează')}</button>`;
    const list = error ? alertBox(error) : loading && !headers.length ? loader(tx('Citim mailurile')) : headers.length
      ? `${headers.map(row).join('')}${more ? `<div class="mail-more">${button(tx('Mai vechi'), { cls: 'ghost sm', attrs: `data-mail-more ${loading ? 'disabled' : ''}` })}</div>` : ''}`
      : `<p class="dim mail-none">${tx('Niciun mail aici.')}</p>`;
    body.innerHTML = `${gate}${panel({
      title: folderTitle(ui.folder),
      count: headers.length ? `${headers.length}${more ? '+' : ''}` : undefined,
      actions,
      bodyCls: 'panel-body mail-panel',
      body: `<div class="mail-grid ${selected != null ? 'reading' : ''}"><div class="mail-list">${list}</div><div class="mail-reader">${reader()}</div></div>`,
    })}`;
  }

  async function resolve(ids: number[]) {
    const missing = [...new Set(ids)].filter((id) => id && !names.has(id));
    if (!missing.length) return;
    const found = await nameMap(missing, lists);
    for (const [id, n] of found) names.set(id, n);
  }

  const idsOf = (list: { from?: number; recipients?: MailRecipient[] }[]) => list.flatMap((h) => [h.from ?? 0, ...(h.recipients ?? []).map((r) => r.recipient_id)]);

  async function fetchPage(reset: boolean) {
    const t = token;
    const f = ui.folder;
    let page = await listMail(owner, { labels: f.kind === 'label' ? [f.id] : undefined, lastMailId: reset ? undefined : cursor });
    if (t !== token) return;
    more = page.length >= PAGE;
    if (page.length) cursor = Math.min(...page.map((h) => h.mail_id));
    if (f.kind === 'list') page = page.filter((h) => h.recipients?.some((r) => r.recipient_id === f.id));
    await resolve(idsOf(page));
    if (t !== token) return;
    headers = reset ? page : [...headers, ...page.filter((h) => !headers.some((x) => x.mail_id === h.mail_id))];
  }

  async function loadFolder(reset = true) {
    if (!owner) return;
    loading = true;
    error = '';
    if (reset) { headers = []; selected = null; cursor = 0; }
    render();
    try {
      await fetchPage(reset);
    } catch (err) {
      error = (err as Error).message;
    } finally {
      loading = false;
      render();
    }
  }

  async function refreshLabels() {
    const t = token;
    const [l, m] = await Promise.all([mailLabels(owner).catch(() => null), mailingLists(owner).catch(() => [] as MailingList[])]);
    if (t !== token) return;
    if (l) labels = l.labels ?? [];
    lists = m;
    for (const x of lists) names.set(x.mailing_list_id, x.name);
  }

  async function start() {
    token++;
    const c = ctx.character;
    owner = c.kind === 'esi' && c.characterId && !loginProblem({ kind: c.kind, characterId: c.characterId, name: c.name }) && canRead(c.characterId) ? c.characterId : 0;
    labels = [];
    lists = [];
    headers = [];
    names = new Map();
    bodies.clear();
    selected = null;
    error = '';
    if (!owner) { render(); return; }
    loading = true;
    render();
    await refreshLabels();
    if (ui.folder.kind === 'label' && !labels.some((l) => l.label_id === (ui.folder as { id: number }).id)) ui.folder = { kind: 'label', id: LABEL_INBOX };
    if (ui.folder.kind === 'list' && !lists.some((l) => l.mailing_list_id === (ui.folder as { id: number }).id)) ui.folder = { kind: 'label', id: LABEL_INBOX };
    await loadFolder();
  }

  function adjustUnread(h: MailHeader, delta: number) {
    for (const id of h.labels ?? []) {
      const l = labelById(id);
      if (l) l.unread_count = Math.max(0, (l.unread_count ?? 0) + delta);
    }
  }

  async function open(id: number) {
    selected = id;
    render();
    const h = headers.find((x) => x.mail_id === id);
    try {
      if (!bodies.has(id)) {
        const b = await readMail(owner, id);
        await resolve(idsOf([b]));
        bodies.set(id, b);
      }
      if (selected !== id) return;
      render();
      if (h && !h.is_read && canOrganize(owner)) {
        await updateMail(owner, id, { read: true });
        h.is_read = true;
        adjustUnread(h, -1);
        render();
      }
    } catch (err) {
      if (selected === id) { selected = null; toast((err as Error).message, 3500); render(); }
    }
  }

  async function markUnread() {
    if (selected == null) return;
    const h = headers.find((x) => x.mail_id === selected);
    try {
      await updateMail(owner, selected, { read: false });
      if (h && h.is_read) { h.is_read = false; adjustUnread(h, 1); }
      selected = null;
      render();
    } catch (err) { toast((err as Error).message, 3500); }
  }

  async function toggleLabel(labelId: number) {
    if (selected == null) return;
    const id = selected;
    const h = headers.find((x) => x.mail_id === id);
    const b = bodies.get(id);
    const current = new Set(b?.labels ?? h?.labels ?? []);
    if (current.has(labelId)) current.delete(labelId); else current.add(labelId);
    if (!current.size) { toast(tx('Un mail trebuie să aibă cel puțin o etichetă.')); return; }
    const next = [...current];
    try {
      await updateMail(owner, id, { labels: next });
      if (b) b.labels = next;
      if (h) h.labels = next;
      if (ui.folder.kind === 'label' && !current.has(ui.folder.id)) { headers = headers.filter((x) => x.mail_id !== id); selected = null; }
      render();
      refreshLabels().then(render);
    } catch (err) { toast((err as Error).message, 3500); }
  }

  async function remove() {
    if (selected == null) return;
    const id = selected;
    const h = headers.find((x) => x.mail_id === id);
    if (!(await confirmDialog(tx('Ștergi definitiv mailul „{s}”? Dispare și din joc.', { s: h?.subject || tx('(fără subiect)') }), { title: tx('Șterge mailul'), ok: tx('Șterge'), danger: true }))) return;
    try {
      await deleteMail(owner, id);
      headers = headers.filter((x) => x.mail_id !== id);
      bodies.delete(id);
      selected = null;
      render();
      refreshLabels().then(render);
      toast(tx('Mail șters'));
    } catch (err) { toast((err as Error).message, 3500); }
  }

  function labelModal() {
    const modal = openModal(tx('Etichetă nouă'), `
      <div class="stack">
        <label class="mail-field"><span>${tx('Nume')}</span><input class="input" id="mailLabelName" maxlength="40" /></label>
        <div class="mail-field"><span>${tx('Culoare')}</span><div class="mail-swatches">${LABEL_COLORS.map((c, i) => `<button class="mail-swatch ${i === 0 ? 'active' : ''}" data-swatch="${c}" style="--mail-c:${c}" aria-label="${c}"></button>`).join('')}</div></div>
        <div class="row-actions">${button(tx('Creează'), { iconName: 'plus', attrs: 'data-label-create' })}</div>
      </div>`);
    let color = LABEL_COLORS[0];
    const input = modal.querySelector<HTMLInputElement>('#mailLabelName')!;
    input.focus();
    modal.addEventListener('click', async (e) => {
      const t = e.target as HTMLElement;
      const sw = t.closest<HTMLElement>('[data-swatch]');
      if (sw) { color = sw.dataset.swatch!; modal.querySelectorAll('.mail-swatch').forEach((x) => x.classList.toggle('active', x === sw)); return; }
      if (!t.closest('[data-label-create]')) return;
      const name = input.value.trim();
      if (!name) { input.classList.add('invalid'); return; }
      try {
        await createLabel(owner, name, color);
        closeModal();
        await refreshLabels();
        render();
        toast(tx('Etichetă creată'));
      } catch (err) { toast((err as Error).message, 3500); }
    });
  }

  async function removeLabel() {
    if (ui.folder.kind !== 'label' || ui.folder.id <= 8) return;
    const l = labelById(ui.folder.id);
    if (!(await confirmDialog(tx('Ștergi eticheta „{n}”? Mailurile rămân, doar fără ea.', { n: l?.name ?? '' }), { title: tx('Șterge eticheta'), ok: tx('Șterge'), danger: true }))) return;
    try {
      await deleteLabel(owner, ui.folder.id);
      ui.folder = { kind: 'label', id: LABEL_INBOX };
      save();
      await refreshLabels();
      await loadFolder();
    } catch (err) { toast((err as Error).message, 3500); }
  }

  function quote(b: MailBody) {
    const text = mailText(b.body ?? '');
    return `\n\n--------------------------------\n${b.subject ?? ''}\n${tx('De la')}: ${who(b.from)}\n${tx('Trimis')}: ${fullDate(b.timestamp)}\n\n${text}`;
  }

  function compose(seed: Partial<Compose> = {}) {
    const draft: Compose = { to: '', list: 0, subject: '', body: '', ...seed };
    const modal = openModal(tx('Mail nou'), `
      <div class="stack mail-compose">
        <label class="mail-field"><span>${tx('Către')}</span><input class="input" id="mailTo" value="${esc(draft.to)}" placeholder="${esc(tx('Nume de caractere, corporații sau alianțe, despărțite prin virgulă'))}" /></label>
        ${lists.length ? `<label class="mail-field"><span>${tx('Listă de mail')}</span><select class="input" id="mailList"><option value="0">—</option>${lists.map((l) => `<option value="${l.mailing_list_id}" ${draft.list === l.mailing_list_id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label>` : ''}
        <label class="mail-field"><span>${tx('Subiect')}</span><input class="input" id="mailSubject" maxlength="150" value="${esc(draft.subject)}" /></label>
        <label class="mail-field"><span>${tx('Mesaj')}</span><textarea class="input area mail-area" id="mailText" rows="12" maxlength="9000">${esc(draft.body)}</textarea></label>
        <p class="small dim">${tx('Mailul pleacă din contul caracterului {name} și apare în joc. Destinatarii cu taxă CSPA nu pot primi mail de aici.', { name: ctx.character.name })}</p>
        <div class="row-actions">${button(tx('Trimite'), { iconName: 'mail', attrs: 'data-mail-send' })}</div>
      </div>`, { wide: true });
    const to = modal.querySelector<HTMLInputElement>('#mailTo')!;
    const subject = modal.querySelector<HTMLInputElement>('#mailSubject')!;
    const text = modal.querySelector<HTMLTextAreaElement>('#mailText')!;
    const list = modal.querySelector<HTMLSelectElement>('#mailList');
    (draft.to ? text : to).focus();
    if (draft.to) text.setSelectionRange(0, 0);
    let sending = false;
    modal.addEventListener('click', async (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-mail-send]');
      if (!btn || sending) return;
      const listId = Number(list?.value) || 0;
      const wanted = to.value.split(',').map((x) => x.trim()).filter(Boolean);
      if (!wanted.length && !listId) { to.classList.add('invalid'); toast(tx('Adaugă cel puțin un destinatar.')); return; }
      if (!subject.value.trim()) { subject.classList.add('invalid'); toast(tx('Subiectul nu poate fi gol.')); return; }
      sending = true;
      btn.disabled = true;
      try {
        const { found, missing } = await lookupRecipients(wanted);
        if (missing.length) throw new Error(tx('Nu am găsit în EVE: {names}', { names: missing.join(', ') }));
        const recipients: MailRecipient[] = found.map(({ recipient_id, recipient_type }) => ({ recipient_id, recipient_type }));
        if (listId) recipients.push({ recipient_id: listId, recipient_type: 'mailing_list' });
        if (recipients.length > 50) throw new Error(tx('Un mail poate avea cel mult 50 de destinatari.'));
        for (const f of found) names.set(f.recipient_id, f.name);
        await sendMail(owner, { recipients, subject: subject.value.trim(), body: bodyFromText(text.value) });
        closeModal();
        toast(tx('Mail trimis'));
        if (ui.folder.kind === 'label' && ui.folder.id === LABEL_SENT) loadFolder();
      } catch (err) {
        toast((err as Error).message, 4000);
        sending = false;
        btn.disabled = false;
      }
    });
  }

  function reply(all: boolean) {
    const b = selected != null ? bodies.get(selected) : null;
    if (!b) return;
    const people = new Set<number>([b.from ?? 0]);
    let listId = 0;
    if (all) for (const r of b.recipients ?? []) {
      if (r.recipient_type === 'mailing_list') listId = r.recipient_id;
      else if (r.recipient_id !== owner) people.add(r.recipient_id);
    }
    if (b.from === owner && !all) for (const r of b.recipients ?? []) if (r.recipient_type !== 'mailing_list') people.add(r.recipient_id);
    people.delete(0);
    if (people.size > 1) people.delete(owner);
    const subject = b.subject ?? '';
    compose({
      to: [...people].map((id) => names.get(id) ?? '').filter(Boolean).join(', '),
      list: listId,
      subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`,
      body: quote(b),
    });
  }

  function forward() {
    const b = selected != null ? bodies.get(selected) : null;
    if (!b) return;
    const subject = b.subject ?? '';
    compose({ subject: /^fw:/i.test(subject) ? subject : `Fw: ${subject}`, body: quote(b) });
  }

  side.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-mail-new-label]')) { labelModal(); return; }
    const f = t.closest<HTMLElement>('[data-mail-folder]');
    if (!f) return;
    const [kind, id] = f.dataset.mailFolder!.split(':');
    const next: Folder = kind === 'all' ? { kind: 'all' } : { kind: kind as 'label' | 'list', id: Number(id) };
    if (sameFolder(next, ui.folder) && headers.length) return;
    ui.folder = next;
    save();
    loadFolder();
  });

  body.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const row = t.closest<HTMLElement>('[data-mail-open]');
    if (row) { open(Number(row.dataset.mailOpen)); return; }
    if (t.closest('[data-mail-back]')) { selected = null; render(); return; }
    if (t.closest('[data-mail-refresh]')) { refreshLabels().then(() => loadFolder()); return; }
    if (t.closest('[data-mail-more]')) { loadFolder(false); return; }
    if (t.closest('[data-mail-compose]')) { compose(); return; }
    if (t.closest('[data-mail-del-label]')) { removeLabel(); return; }
    const r = t.closest<HTMLElement>('[data-mail-reply]');
    if (r) { reply(r.dataset.mailReply === 'all'); return; }
    if (t.closest('[data-mail-forward]')) { forward(); return; }
    if (t.closest('[data-mail-unread]')) { markUnread(); return; }
    if (t.closest('[data-mail-delete]')) { remove(); return; }
    const l = t.closest<HTMLElement>('[data-mail-label]');
    if (l) toggleLabel(Number(l.dataset.mailLabel));
  });

  ctx.onCharacterChange(() => { start(); });
  start();
}
