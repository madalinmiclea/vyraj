import type { AppContext } from '../app/context';
import { importCharacter, portraitUrl } from '../character/esi';
import { PERMISSIONS, hasPermission, scopeList } from '../character/permissions';
import { BASE_SCOPES, BUILT_IN_CLIENT_ID, callbackUrl, forgetTokens, getSettings, hasTokens, saveSettings, SCOPES, startLogin } from '../character/sso';
import { loadStoredCharacters, removeStoredCharacter, upsertStoredCharacter, type StoredCharacter } from '../character/characters';
import { formatDuration } from '../character/training';
import { forgetPlan } from '../character/skillPlan';
import { forgetRoster } from '../character/roster';
import { forgetSkins } from '../services/skins';
import { forgetWallet } from '../services/wallet';
import { loadJson, saveJson } from '../storage';
import { icon } from '../ui/icons';
import { showItemInfo } from '../ui/itemInfo';
import { alertBox, badge, button, confirmDialog, copyText, esc, formatInt, pageHead, toast } from '../ui/components';
import { theme } from '../theme';
import { roman } from '../ui/itemInfo';
import { backupPanel } from '../io/backup';
import { tx, locale } from '../i18n';
import { characterPublic, loadActivities } from '../services/operations';
import { loreText } from '../i18n/lore';

const COLLAPSED_KEY = 'eve-fit:ui:collapsed';

export function createCharacterView(el: HTMLElement, ctx: AppContext, head: HTMLElement, aside: HTMLElement) {
  const sde = ctx.sde;

  const collapsed = new Set(loadJson<string[]>(COLLAPSED_KEY, []));
  const toggleCollapsed = (key: string) => {
    if (collapsed.has(key)) collapsed.delete(key); else collapsed.add(key);
    saveJson(COLLAPSED_KEY, [...collapsed]);
  };

  function collapsible(key: string, title: string, count: string | number, body: string, defaultCollapsed = false) {
    const isCollapsed = collapsed.has(key) !== defaultCollapsed;
    return `<section class="panel collapsible ${isCollapsed ? 'collapsed' : ''}">
      <button class="panel-head collapse-head" data-collapse="${key}" data-default="${defaultCollapsed ? 1 : 0}">
        ${icon('chevron', 'chev')}<div class="window-title">${esc(title)}<span class="count">${esc(String(count))}</span></div>
      </button>
      ${isCollapsed ? '' : `<div class="panel-body">${body}</div>`}
    </section>`;
  }

  function render(error = '') {
    const settings = getSettings();
    const stored = loadStoredCharacters();
    const active = ctx.character;

    const setup = BUILT_IN_CLIENT_ID ? '' : collapsible('setup', tx('Aplicația EVE (o singură dată)'), settings.clientId ? tx('configurată') : '', `
        <ol class="steps">
          <li>${tx('Intră pe <a href="https://developers.eveonline.com/applications" target="_blank" rel="noopener">developers.eveonline.com/applications</a> și loghează-te cu contul EVE.')}</li>
          <li>${tx('Apasă <b>Create new application</b>. Nume: ce vrei (ex: Vyraj). Descriere: „uz personal”.')}</li>
          <li>${tx('La <b>Connection type</b> alege <b>Authentication &amp; API Access</b> și bifează scope-urile de mai jos.')}</li>
          <li>${tx('La <b>Callback URL</b> pune exact:')} <code>${esc(callbackUrl())}</code> ${button(tx('Copiază'), { cls: 'ghost sm', attrs: 'data-copy-callback' })}</li>
          <li>${tx('Salvează, copiază <b>Client ID</b> și lipește-l aici. Nu ai nevoie de Secret Key (folosim PKCE).')}</li>
        </ol>
        <div class="scopes">${SCOPES.map((s) => `<code>${s}</code>`).join('')}</div>
        <div class="inline-form">
          <input class="input plain" id="ssoClientId" placeholder="Client ID" value="${esc(settings.clientId)}" spellcheck="false" />
          ${button(tx('Salvează'), { cls: 'sm', attrs: 'data-save-client' })}
        </div>`, stored.length > 0);

    const activeStored = stored.find((c) => c.id === active.id);
    const summary = activeStored
      ? characterCard(activeStored, true)
      : stored.length ? '' : `<div class="panel char-empty">
          <span class="char-empty-ico">${icon('character')}</span>
          <div><h3>${tx('Niciun caracter importat')}</h3><p>${tx('Fă login cu EVE ca să-ți imporți skill-urile, implanturile și coada de antrenament. Până atunci, statisticile folosesc un caracter teoretic cu toate skill-urile la V.')}</p><p class="dim small">${tx('Login-ul cere doar skill-urile, coada și implanturile. Portofelul, bunurile, ordinele și restul le aprobi separat, abia când deschizi ecranul care are nevoie de ele.')}</p></div>
          ${BUILT_IN_CLIENT_ID || settings.clientId ? button(tx('Login cu EVE'), { iconName: 'login', attrs: 'data-login' }) : ''}
        </div>`;

    head.innerHTML = pageHead(tx('Caracter'), tx('Dosar de capsuleer · New Eden'), 'Narodnya');
    el.innerHTML = `${error ? alertBox(error) : ''}${summary}`;
    aside.innerHTML = `${queuePanel()}${permissionsPanel()}${setup}${backupPanel()}`;
    fillPublic();
  }

  async function fillPublic() {
    for (const node of el.querySelectorAll<HTMLElement>('[data-char-public]')) {
      const info = await characterPublic(Number(node.dataset.charPublic));
      if (!info) continue;
      const titles = info.character_title_id ? (await loadActivities().catch(() => null))?.titles : null;
      const parts = [
        info.character_title_id ? tx('Titlu: {t}', { t: titles?.[info.character_title_id] ?? '—' }) : '',
        info.achievement_score != null ? tx('Scor realizări: {n}', { n: formatInt(info.achievement_score) }) : '',
        info.security_status != null ? tx('Securitate: {n}', { n: info.security_status.toFixed(1) }) : '',
        info.corporation_title ? tx('Rol în corporație: {t}', { t: info.corporation_title }) : '',
      ].filter(Boolean);
      if (node.isConnected) node.textContent = parts.join(' · ');
    }
  }

  function characterCard(c: StoredCharacter, isActive: boolean) {
    const logged = c.characterId != null && hasTokens(c.characterId);
    return `<div class="panel char-card ${isActive ? 'active' : ''}">
      ${c.characterId ? `<img src="${portraitUrl(c.characterId, 128)}" alt="" />` : '<div class="char-placeholder"></div>'}
      <div class="char-body">
        <h3>${esc(c.name)}</h3>
        <div class="meta">
          ${c.kind === 'esi' ? badge(logged ? 'ESI' : tx('ESI · delogat'), logged ? 'accent' : 'warn') : badge(tx('Personalizat'))}
          ${isActive ? badge(tx('Activ'), 'ok', true) : ''}
        </div>
        ${c.characterId ? `<div class="dim small" data-char-public="${c.characterId}"></div>` : ''}
        <div class="dim small">${c.totalSp ? formatInt(c.totalSp) + ' SP · ' : ''}${tx('{n} skill-uri', { n: Object.keys(c.skills).length })}${c.updated ? ' · ' + new Date(c.updated).toLocaleString(locale) : ''}</div>
        <div class="row-actions">
          ${isActive ? '' : button(tx('Folosește'), { cls: 'sm', attrs: `data-use="${esc(c.id)}"` })}
          ${c.kind === 'esi' && logged ? button(tx('Actualizează'), { iconName: 'refresh', cls: 'ghost sm', attrs: `data-refresh="${esc(c.id)}"` }) : ''}
          ${button(tx('Copie editabilă'), { cls: 'ghost sm', attrs: `data-clone="${esc(c.id)}"` })}
          <button class="btn ghost sm icon-only" data-remove="${esc(c.id)}" title="${tx('Șterge')}">✕</button>
        </div>
      </div>
    </div>`;
  }

  function permissionsPanel() {
    const c = ctx.character;
    if (c.kind !== 'esi' || !c.characterId || !hasTokens(c.characterId)) return '';
    const id = c.characterId;
    const missing = PERMISSIONS.filter((p) => !hasPermission(id, p.id));
    const rows = [`<div class="perm-row">
        <div class="perm-row-text"><b>${esc(tx('Login'))}</b><span class="dim small">${esc(tx('Skill-urile, coada de antrenament și implanturile. Vin cu login-ul, ca fitting-ul și planul de skill-uri să folosească caracterul tău.'))}</span>${scopeList(BASE_SCOPES)}</div>
        ${badge(tx('Aprobată'), 'ok', true)}
      </div>`, ...PERMISSIONS.map((p) => `<div class="perm-row">
        <div class="perm-row-text"><b>${esc(p.label)}</b><span class="dim small">${esc(p.why)}</span>${scopeList(p.scopes)}</div>
        ${hasPermission(id, p.id) ? badge(tx('Aprobată'), 'ok', true) : button(tx('Permite'), { cls: 'ghost sm', attrs: `data-grant="${p.id}" data-grant-char="${id}"` })}
      </div>`)].join('');
    return collapsible('perms', tx('Permisiuni EVE'), `${PERMISSIONS.length - missing.length}/${PERMISSIONS.length}`, `
        <p class="dim small">${tx('Skill-urile, coada și implanturile vin cu login-ul. Restul le aprobi doar dacă folosești ecranul respectiv. Le poți revoca oricând din pagina EVE de aplicații.')}</p>
        <div class="perm-list">${rows}</div>
        <div class="row-actions">
          ${missing.length > 1 ? button(tx('Permite tot ce lipsește'), { iconName: 'login', cls: 'sm', attrs: `data-grant="${missing.map((p) => p.id).join(',')}" data-grant-char="${id}"` }) : ''}
          <a class="btn ghost sm" href="https://community.eveonline.com/support/third-party-applications/" target="_blank" rel="noopener">${icon('external')}${tx('Aplicațiile tale EVE')}</a>
        </div>`);
  }

  function queuePanel() {
    const c = ctx.character;
    if (!c.queue.length) return '';
    const now = Date.now();
    const rows = c.queue.map((q) => {
      const left = q.finish ? Math.max(0, (new Date(q.finish).getTime() - now) / 1000) : 0;
      return `<tr><td><button class="link" data-skill-info="${q.skillId}">${esc(sde.types.get(q.skillId)?.name ?? String(q.skillId))}</button></td><td>${roman(q.level)}</td><td class="r num">${q.finish ? formatDuration(left) : tx('pauză')}</td></tr>`;
    }).join('');
    const last = c.queue.at(-1)?.finish;
    return collapsible('queue', tx('Coada de skill-uri'), `${c.queue.length}${last ? ' · ' + formatDuration((new Date(last).getTime() - now) / 1000) : ''}`, `${last ? `<p class="dim small">${tx('Se termină în {time}', { time: formatDuration((new Date(last).getTime() - now) / 1000) })}</p>` : ''}
        <table class="table compact"><thead><tr><th>Skill</th><th>${tx('Nivel')}</th><th class="r">${tx('Rămas')}</th></tr></thead><tbody>${rows}</tbody></table>`);
  }

  async function refresh(c: StoredCharacter) {
    if (!c.characterId) return;
    toast(theme === 'vyraj' ? loreText('Weaving the Flow…') : tx('Se actualizează din EVE…'));
    try {
      upsertStoredCharacter({ ...(await importCharacter(c.characterId, c.name)), id: c.id });
      ctx.reloadCharacters();
      toast(tx('Caracter actualizat'));
    } catch (err) {
      render((err as Error).message);
    }
  }

  const onClick = async (e: Event) => {
    const t = e.target as HTMLElement;
    const at = (sel: string) => t.closest<HTMLElement>(sel);
    const head = at('[data-collapse]');
    if (head) { toggleCollapsed(head.dataset.collapse!); return render(); }
    const info = at('[data-skill-info]');
    if (info) return showItemInfo(ctx, Number(info.dataset.skillInfo));
    if (at('[data-copy-callback]')) return copyText(callbackUrl(), tx('Callback URL copiat'));
    if (at('[data-save-client]')) {
      saveSettings({ clientId: aside.querySelector<HTMLInputElement>('#ssoClientId')!.value.trim() });
      toast(tx('Client ID salvat'));
      return render();
    }
    if (at('[data-login]')) {
      try { await startLogin(); } catch (err) { render((err as Error).message); }
      return;
    }
    const stored = loadStoredCharacters();
    const use = at('[data-use]');
    if (use) return ctx.setCharacter(use.dataset.use!);
    const ref = at('[data-refresh]');
    if (ref) { const c = stored.find((x) => x.id === ref.dataset.refresh); if (c) await refresh(c); return; }
    const clone = at('[data-clone]');
    if (clone) {
      const c = stored.find((x) => x.id === clone.dataset.clone);
      if (!c) return;
      const copy: StoredCharacter = { ...structuredClone(c), id: 'custom-' + Date.now().toString(36), name: `${c.name} (plan)`, kind: 'custom', characterId: undefined, queue: [] };
      upsertStoredCharacter(copy);
      ctx.setCharacter(copy.id);
      toast(tx('Copie creată: îi poți schimba nivelurile skill-urilor mai jos'));
      return;
    }
    const remove = at('[data-remove]');
    if (remove && await confirmDialog(tx('Ștergi caracterul din aplicație, împreună cu datele lui salvate în browser (istoric portofel, plan de skill-uri, SKIN-uri)?'), { ok: tx('Șterge'), danger: true })) {
      const c = stored.find((x) => x.id === remove.dataset.remove);
      if (c) {
        forgetPlan(c.id);
        forgetSkins(c.id);
        forgetRoster(c.id);
        if (c.characterId && !stored.some((x) => x.id !== c.id && x.characterId === c.characterId)) {
          forgetTokens(c.characterId);
          forgetWallet(c.characterId);
        }
      }
      removeStoredCharacter(remove.dataset.remove!);
      if (ctx.character.id === remove.dataset.remove) ctx.setCharacter('all5');
      else ctx.reloadCharacters();
    }
  };

  el.addEventListener('click', onClick);
  aside.addEventListener('click', onClick);

  ctx.onCharacterChange(() => render());
  render();

  return {
    async imported(characterId: number, characterName: string) {
      try {
        const c = await importCharacter(characterId, characterName);
        upsertStoredCharacter(c);
        ctx.setCharacter(c.id);
        toast(tx('{name} importat', { name: characterName }));
      } catch (err) {
        render((err as Error).message);
      }
    },
    showError: (msg: string) => render(msg),
  };
}
