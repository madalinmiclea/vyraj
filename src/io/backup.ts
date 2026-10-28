import { confirmDialog, toast } from '../ui/components';
import { icon } from '../ui/icons';
import { tx } from '../i18n';

const SKIP = [
  /^eve-fit:sso-(tokens|pending)$/,
  /^eve-market:(prices|listed-types)$/,
  /^eve-intel:(hub-prices|scan)$/,
  /^eve-skins:prices$/,
  /^eve-tools:lp-offers$/,
];

const keep = (key: string) => key.startsWith('eve-') && !SKIP.some((re) => re.test(key));

interface Backup { app: 'vyraj'; version: 1; created: string; data: Record<string, string> }

function localKeys(): string[] {
  const out: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && keep(k)) out.push(k);
    }
  } catch {
    return [];
  }
  return out.sort();
}

export function backupSummary(): { keys: number; bytes: number } {
  const keys = localKeys();
  let bytes = 0;
  for (const k of keys) bytes += (localStorage.getItem(k) ?? '').length;
  return { keys: keys.length, bytes };
}

export function downloadBackup() {
  const data: Record<string, string> = {};
  for (const k of localKeys()) data[k] = localStorage.getItem(k) ?? '';
  const backup: Backup = { app: 'vyraj', version: 1, created: new Date().toISOString(), data };
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `vyraj-backup-${backup.created.slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast(tx('Backup descărcat: {n} seturi de date', { n: Object.keys(data).length }));
}

export function pickBackup() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 20_000_000) { toast(tx('Fișierul e prea mare pentru un backup Vyraj.')); return; }
    let backup: Backup;
    try {
      backup = JSON.parse(await file.text()) as Backup;
      if (backup?.app !== 'vyraj' || !backup.data || typeof backup.data !== 'object') throw new Error();
    } catch {
      toast(tx('Fișierul nu e un backup Vyraj valid.'));
      return;
    }
    const entries = Object.entries(backup.data).filter(([k, v]) => keep(k) && typeof v === 'string');
    const when = backup.created ? new Date(backup.created).toLocaleString() : '';
    const ok = await confirmDialog(tx('Restaurezi {n} seturi de date din backup-ul din {date}? Fiturile, doctrinele, setările și jurnalele de acum se înlocuiesc cu cele din fișier. Login-urile EVE rămân cum sunt.', { n: entries.length, date: when }), { title: tx('Restaurează backup'), ok: tx('Restaurează'), danger: true });
    if (!ok) return;
    try {
      for (const [k, v] of entries) localStorage.setItem(k, v);
    } catch {
      toast(tx('Browserul nu are destul spațiu pentru tot backup-ul. O parte s-a restaurat.'));
      return;
    }
    location.reload();
  });
  input.click();
}

export function backupPanel(): string {
  const s = backupSummary();
  return `<section class="panel backup-panel">
    <div class="panel-head"><div class="window-title">${tx('Backup date')}</div></div>
    <div class="panel-body">
      <p class="dim small">${tx('Totul stă doar în browserul ăsta: fituri, doctrine, planuri de skill-uri, caractere custom, jurnale și setări. Descarcă un fișier ca să le muți pe alt calculator sau să nu le pierzi dacă ștergi datele site-ului. Login-urile EVE nu intră în fișier.')}</p>
      <p class="small"><span class="num">${s.keys}</span> ${tx('seturi de date')} · <span class="num">${Math.max(1, Math.round(s.bytes / 1024))} KB</span></p>
      <div class="row-actions">
        <button class="btn sm" data-backup-dl>${icon('download')}${tx('Descarcă backup')}</button>
        <button class="btn ghost sm" data-backup-up>${icon('upload')}${tx('Restaurează')}</button>
      </div>
    </div>
  </section>`;
}
