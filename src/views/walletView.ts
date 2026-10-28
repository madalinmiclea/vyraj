import type { AppContext } from '../app/context';
import { pageHead, panel, alertBox, windowTitle } from '../ui/components';
import { loadJson, saveJson } from '../storage';
import { hasScope, loginProblem } from '../character/sso';
import { permissionGate } from '../character/permissions';
import { renderWallet, WALLET_SECTIONS, type WalletSection, type WalletState } from './wallet';
import { tx } from '../i18n';

const SECTION_KEY = 'eve-wallet:section';
const SCOPE = 'esi-wallet.read_character_wallet.v1';

export interface WalletView { show(section?: string): void }

export function createWalletView(el: HTMLElement, ctx: AppContext, side: HTMLElement): WalletView {
  const saved = loadJson<WalletSection>(SECTION_KEY, 'overview');
  const view: WalletState = { section: WALLET_SECTIONS.some((s) => s.id === saved) ? saved : 'overview' };
  let loadedFor: number | null = null;
  let seq = 0;

  el.innerHTML = `${pageHead(tx('Portofel'), tx('Jurnal, tranzacții de piață, tick-uri de bounty și unde ai vânat'), 'Tithe')}
    <div id="walletBody"></div>`;
  const body = el.querySelector<HTMLElement>('#walletBody')!;

  function renderSide() {
    side.innerHTML = `<div class="sidebar-head">${windowTitle(tx('Portofel'))}</div>
      <div class="side-nav">${WALLET_SECTIONS.map((s) => `<button class="side-link ${s.id === view.section ? 'active' : ''}" data-wallet-section="${s.id}">${s.label}</button>`).join('')}</div>`;
  }

  view.onSection = (section) => { saveJson(SECTION_KEY, section); renderSide(); };

  async function load() {
    renderSide();
    const c = ctx.character;
    const problem = loginProblem(c);
    if (problem || !c.characterId) { loadedFor = null; body.innerHTML = panel({ body: alertBox(problem ?? '') }); return; }
    if (!hasScope(c.characterId, SCOPE)) { loadedFor = null; body.innerHTML = panel({ body: permissionGate('wallet', c.characterId, c.name) }); return; }
    if (loadedFor === c.characterId && view.rerender) { view.rerender(); return; }
    const mine = ++seq;
    const charId = c.characterId;
    loadedFor = charId;
    view.rerender = undefined;
    try {
      await renderWallet(body, ctx, charId, () => mine === seq && ctx.character.characterId === charId, view);
    } catch (err) {
      if (mine === seq) { loadedFor = null; body.innerHTML = panel({ body: alertBox((err as Error).message) }); }
    }
  }

  function setSection(section: WalletSection) {
    view.section = section;
    saveJson(SECTION_KEY, section);
    load();
    el.closest('.main')?.scrollTo({ top: 0 });
  }

  side.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-wallet-section]');
    if (b) setSection(b.dataset.walletSection as WalletSection);
  });

  ctx.onCharacterChange(() => { loadedFor = null; load(); });

  load();

  return {
    show(section) {
      if (section && WALLET_SECTIONS.some((s) => s.id === section)) setSection(section as WalletSection);
    },
  };
}
