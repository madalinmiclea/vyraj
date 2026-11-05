import { button, copyText, esc, openModal } from './components';
import { icon } from './icons';
import { tx } from '../i18n';

type Target = { id: string; label: string; glyph: string; color: string };

const TARGETS: Target[] = [
  { id: 'messenger', label: 'Messenger', color: '#0a7cff', glyph: '<path d="M12 3C7 3 3 6.7 3 11.3c0 2.6 1.3 4.9 3.3 6.4V21l3-1.7c.9.3 1.8.4 2.7.4 5 0 9-3.7 9-8.4S17 3 12 3z"/><path d="m7 13.5 3.3-3.4 2.2 2.2 4-2.3-3.3 3.4-2.2-2.2z" fill="currentColor"/>' },
  { id: 'whatsapp', label: 'WhatsApp', color: '#25d366', glyph: '<path d="M4 20.5 5.2 16A8.5 8.5 0 1 1 8.4 19.3z"/><path d="M9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.5-2-1-1 1c-1-.5-2-1.5-2.5-2.5l1-1-1-2z" fill="currentColor"/>' },
  { id: 'telegram', label: 'Telegram', color: '#26a5e4', glyph: '<path d="M21 4 3 11l5.5 2 2 6 3-4 4.5 3.5z"/><path d="m8.5 13 9-6.5-7 8"/>' },
  { id: 'discord', label: 'Discord', color: '#5865f2', glyph: '<path d="M7 6.5c3-1.3 7-1.3 10 0 1.8 2.6 2.8 5.6 2.8 9.2-1.6 1.3-3.3 2-4.8 2.3l-1-1.6M7 6.5c-1.8 2.6-2.8 5.6-2.8 9.2 1.6 1.3 3.3 2 4.8 2.3l1-1.6M7.5 16c2.9 1.3 6.1 1.3 9 0"/><circle cx="9.3" cy="12.3" r="1.3" fill="currentColor"/><circle cx="14.7" cy="12.3" r="1.3" fill="currentColor"/>' },
  { id: 'reddit', label: 'Reddit', color: '#ff4500', glyph: '<ellipse cx="12" cy="14.5" rx="7.5" ry="5"/><path d="M12 9.5 13.3 4l4 1"/><circle cx="18.5" cy="5" r="1.4"/><circle cx="9.3" cy="14" r="1.1" fill="currentColor"/><circle cx="14.7" cy="14" r="1.1" fill="currentColor"/><path d="M9.5 17c1.6 1 3.4 1 5 0"/>' },
  { id: 'x', label: 'X', color: '#e7e9ea', glyph: '<path d="M4 4h4.5L20 20h-4.5z"/><path d="M19.5 4 13.6 10.6M10.4 13.4 4.5 20"/>' },
  { id: 'facebook', label: 'Facebook', color: '#1877f2', glyph: '<path d="M14.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.5 1.6-1.5h1.6V4.4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v2.2H9v3h2.5V21"/>' },
  { id: 'email', label: 'Email', color: '#9aa7b4', glyph: '<path d="M3 6h18v12H3z"/><path d="m3 6 9 7 9-7"/>' },
];

const glyph = (t: Target) => `<span class="share-glyph" style="--share-color:${t.color}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">${t.glyph}</svg></span>`;

const isMobile = () => matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

function open(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function openShareModal(initial: string, { title, text, hint = '', shorten }: { title: string; text: string; hint?: string; shorten?: () => Promise<string> }) {
  const t = encodeURIComponent(text);
  let url = initial;
  let pending: Promise<string> | null = null;
  const canNative = typeof navigator.share === 'function';
  const modal = openModal(title, `
    <div class="share-modal">
      <label class="share-label">${tx('Link')}</label>
      <div class="share-link">
        <input class="input" type="text" readonly value="${esc(initial)}" spellcheck="false" data-share-input>
        ${button(tx('Copiază'), { iconName: 'copy', cls: 'sm', attrs: 'data-share="copy"' })}
      </div>
      ${hint ? `<p class="dim small">${esc(hint)}</p>` : ''}
      <label class="share-label">${tx('Trimite prin')}</label>
      <div class="share-grid">
        ${TARGETS.map((x) => `<button type="button" class="share-target" data-share="${x.id}" title="${esc(x.label)}">${glyph(x)}<span>${esc(x.label)}</span></button>`).join('')}
        ${canNative ? `<button type="button" class="share-target" data-share="native" title="${esc(tx('Alte aplicații de pe dispozitiv'))}"><span class="share-glyph" style="--share-color:var(--accent)">${icon('external')}</span><span>${tx('Alte aplicații')}</span></button>` : ''}
      </div>
      <p class="dim small">${tx('Discord și Messenger pe desktop nu primesc linkuri din alte site-uri: linkul se copiază și se deschide aplicația, apoi îl lipești în conversație.')}</p>
    </div>`);
  const input = modal.querySelector<HTMLInputElement>('[data-share-input]');
  input?.addEventListener('focus', () => input.select());
  const finalUrl = (): Promise<string> => {
    if (!shorten) return Promise.resolve(url);
    pending ??= shorten().then((short) => {
      url = short;
      if (input) input.value = short;
      return short;
    }).catch(() => url);
    return pending;
  };
  modal.addEventListener('click', async (e) => {
    const kind = (e.target as HTMLElement).closest<HTMLElement>('[data-share]')?.dataset.share;
    if (!kind) return;
    const url = await finalUrl();
    const u = encodeURIComponent(url);
    switch (kind) {
      case 'copy':
        input?.select();
        copyText(url, tx('Link copiat'));
        break;
      case 'messenger':
        if (isMobile()) location.href = `fb-messenger://share/?link=${u}`;
        else copyText(url, tx('Link copiat. Lipește-l în conversația din Messenger.')).then(() => open('https://www.messenger.com/'));
        break;
      case 'whatsapp':
        open(`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`);
        break;
      case 'telegram':
        open(`https://t.me/share/url?url=${u}&text=${t}`);
        break;
      case 'discord':
        copyText(url, tx('Link copiat. Lipește-l în canalul de Discord.')).then(() => open('https://discord.com/channels/@me'));
        break;
      case 'reddit':
        open(`https://www.reddit.com/submit?url=${u}&title=${t}`);
        break;
      case 'x':
        open(`https://x.com/intent/post?text=${t}&url=${u}`);
        break;
      case 'facebook':
        open(`https://www.facebook.com/sharer/sharer.php?u=${u}`);
        break;
      case 'email':
        location.href = `mailto:?subject=${t}&body=${encodeURIComponent(`${text}\n\n${url}`)}`;
        break;
      case 'native':
        navigator.share({ title: text, text, url }).catch(() => undefined);
        break;
    }
  });
  return modal;
}
