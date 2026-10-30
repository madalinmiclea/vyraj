import { toast, openModal } from '../ui/components';
import { icon } from '../ui/icons';
import { tx } from '../i18n';

const BASE = import.meta.env.BASE_URL;

interface InstallPrompt extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }

export const INSTALL_EVENT = 'vyraj-install-changed';

let deferred: InstallPrompt | null = null;

const changed = () => window.dispatchEvent(new Event(INSTALL_EVENT));

export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const canInstall = () => !isStandalone() && (deferred !== null || isIos());

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e as InstallPrompt;
  changed();
});

window.addEventListener('appinstalled', () => {
  deferred = null;
  changed();
  toast(tx('Vyraj a fost instalat. Îl găsești printre aplicațiile telefonului.'), 5000);
});

window.addEventListener('offline', () => toast(tx('Fără internet. Merg doar datele salvate; prețurile și ESI revin când ai conexiune.'), 6000));
window.addEventListener('online', () => toast(tx('Conexiune restabilită.')));

export async function installApp() {
  if (deferred) {
    const d = deferred;
    deferred = null;
    await d.prompt().catch(() => {});
    await d.userChoice.catch(() => null);
    changed();
    return;
  }
  if (!isIos()) return;
  openModal(tx('Instalează Vyraj'), `<ol class="install-steps">
    <li>${icon('upload')}<span>${tx('Deschide Vyraj în Safari și apasă butonul Share (pătratul cu săgeată în sus).')}</span></li>
    <li>${icon('plus')}<span>${tx('Alege „Add to Home Screen” (Adaugă pe ecranul principal).')}</span></li>
    <li>${icon('check')}<span>${tx('Confirmă cu „Add”. Vyraj pornește apoi pe tot ecranul, ca o aplicație.')}</span></li>
  </ol>
  <p class="dim small">${tx('Pe iPhone, notificările merg doar din aplicația instalată.')}</p>`);
}

export function notify(title: string, options: NotificationOptions & { url?: string } = {}) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const { url, ...rest } = options;
  const opts: NotificationOptions = { icon: `${BASE}icon-192.png`, ...rest, data: { url: url ? new URL(url, location.href).href : undefined } };
  const fallback = () => { try { new Notification(title, opts); } catch { } };
  const sw = navigator.serviceWorker;
  if (!sw) { fallback(); return; }
  sw.getRegistration(BASE).then((reg) => (reg?.active ? reg.showNotification(title, opts) : fallback())).catch(fallback);
}

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) toast(tx('Vyraj s-a actualizat. Reîncarcă pentru noua versiune.'), 6000);
  });
  const run = () => {
    navigator.serviceWorker.register(`${BASE}sw.js`, { scope: BASE }).then((reg) => {
      setInterval(() => { reg.update().catch(() => {}); }, 60 * 60 * 1000);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    }).catch(() => {});
  };
  if (document.readyState === 'complete') run();
  else window.addEventListener('load', run, { once: true });
}
