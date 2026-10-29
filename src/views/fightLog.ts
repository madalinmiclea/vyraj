import type { AppContext } from '../app/context';
import { panel, loader, alertBox, esc, formatInt, formatNum, emptyState, badge, button, toast } from '../ui/components';
import { icon } from '../ui/icons';
import { loadJson, saveJson, isDemo } from '../storage';
import { typeIconUrl } from '../services/market';
import { portraitUrl } from '../character/esi';
import { resolveIds } from '../services/recon';
import { tx } from '../i18n';
import {
  parseCombatLog, splitEncounters, analyzeFight, logFileName, QUALITIES,
  type ParsedLog, type Encounter, type FightAnalysis, type ActorStats, type WeaponStats, type Moment, type Actor,
} from '../services/combatLog';
import { sampleCombatLog, recordedCombatLog } from '../demo/combatLogSample';
import { VARGUR_FIGHT, GILA_FIGHT } from '../demo/combatLogRecorded';

const PVE_KEY = 'eve-recon:fight-pve';
const FOLDER_DAYS = 30;
const MAX_ROWS = 60;
const MAX_ACTOR_ROWS = 14;

interface FileLike { kind: 'file'; name: string; getFile(): Promise<File> }
interface DirLike { kind: 'directory'; name: string; values(): AsyncIterable<FileLike | DirLike> }

const folderSupported = () => typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';

async function readText(file: Blob): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf);
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf);
  return new TextDecoder('utf-8').decode(buf);
}

const pad = (n: number) => String(n).padStart(2, '0');
const rel = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
};
const clock = (t: number) => {
  const d = new Date(t);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
};
const dateLabel = (t: number) => {
  const d = new Date(t);
  return `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const compact = (n: number) => (n >= 1e6 ? `${formatNum(n / 1e6, 2)}m` : n >= 1e4 ? `${formatNum(n / 1e3, 1)}k` : formatInt(n));

const QUALITY_CLASS: Record<string, string> = { Wrecks: 'q0', Smashes: 'q1', Penetrates: 'q2', Hits: 'q3', 'Glances Off': 'q4', Grazes: 'q5' };

export function createFightView(el: HTMLElement, ctx: AppContext) {
  let logs: ParsedLog[] = [];
  let encounters: Encounter[] = [];
  let selected = '';
  let showPve = loadJson<boolean>(PVE_KEY, false);
  let sourceLabel = '';
  let sample = false;
  const ids = new Map<string, number>();
  let systemId = 0;
  let zkbState: 'idle' | 'loading' | 'done' | 'error' = 'idle';

  el.innerHTML = `${panel({
    body: `<p class="dim small">${tx('EVE scrie tot ce se întâmplă în luptă în fișierele Gamelogs: damage dat și primit, neut, tackle, ratări și reîncărcări. Vyraj le citește direct în browser, fără să trimită nimic pe vreun server, și reconstruiește lupta din punctul tău de vedere.')}</p>
      <ul class="small dim live-paths"><li>Windows: <code>Documents\\EVE\\logs\\Gamelogs</code></li><li>Mac: <code>Documents/EVE/logs/Gamelogs</code></li></ul>
      <label class="fight-drop" id="fightDrop">${icon('upload')}<span>${tx('Trage aici unul sau mai multe fișiere .txt din Gamelogs sau dă click să le alegi')}</span><input type="file" id="fightFiles" accept=".txt,text/plain" multiple hidden /></label>
      <input type="file" id="fightFolder" webkitdirectory multiple hidden />
      <textarea class="input area" id="fightPaste" rows="4" spellcheck="false" placeholder="${esc(tx('...sau lipește aici conținutul log-ului'))}"></textarea>
      <div class="row-actions">
        ${button(tx('Analizează textul'), { iconName: 'search', attrs: 'data-fight-paste' })}
        ${button(tx('Alege folderul Gamelogs'), { iconName: 'download', cls: 'ghost', attrs: 'data-fight-folder' })}
        ${button(tx('Vezi un exemplu'), { iconName: 'play', cls: 'ghost', attrs: 'data-fight-sample' })}
        ${button(tx('Golește'), { cls: 'ghost', attrs: 'data-fight-clear' })}
      </div>`,
  })}<div id="fightResult"></div>`;

  const drop = el.querySelector<HTMLElement>('#fightDrop')!;
  const fileInput = el.querySelector<HTMLInputElement>('#fightFiles')!;
  const folderInput = el.querySelector<HTMLInputElement>('#fightFolder')!;
  const paste = el.querySelector<HTMLTextAreaElement>('#fightPaste')!;
  const result = el.querySelector<HTMLElement>('#fightResult')!;

  const actorShipId = (a?: Actor) => (a?.ship ? ctx.sde.findType(a.ship)?.id : undefined);
  const itemId = (name: string) => (name ? ctx.sde.findType(name)?.id : undefined);
  const shipIcon = (a?: Actor) => {
    const id = actorShipId(a);
    return id ? `<img class="row-icon" src="${typeIconUrl(id, 32)}" alt="" loading="lazy" />` : `<span class="row-icon fight-noicon">${icon(a?.player ? 'ship' : 'target')}</span>`;
  };
  const actorName = (a?: Actor) => a?.name ?? '—';
  const actorLabel = (key: string | undefined, enc: Encounter) => {
    const a = key ? enc.actors.get(key) : undefined;
    if (!a) return '—';
    return a.player && a.ship ? `${a.name} (${a.ship})` : a.name;
  };

  function load(texts: { name: string; text: string }[], label: string) {
    const parsed = texts.map((t) => parseCombatLog(t.text)).filter((l) => l.events.length);
    logs = parsed;
    encounters = splitEncounters(parsed);
    sourceLabel = label;
    sample = false;
    ids.clear(); systemId = 0; zkbState = 'idle';
    const visible = list();
    selected = (visible[0] ?? encounters[0])?.id ?? '';
    render();
  }

  function list() {
    return showPve ? encounters : encounters.filter((e) => e.pvp);
  }

  async function loadFiles(files: File[]) {
    const txt = files.filter((f) => /\.txt$/i.test(f.name) || f.type.startsWith('text/'));
    if (!txt.length) { toast(tx('Nu am găsit fișiere .txt')); return; }
    result.innerHTML = loader(tx('Citesc {n} fișiere', { n: txt.length }));
    const texts = await Promise.all(txt.map(async (f) => ({ name: f.name, text: await readText(f) })));
    load(texts, txt.length === 1 ? txt[0].name : tx('{n} fișiere', { n: txt.length }));
  }

  async function loadFolder(all: File[], name: string) {
    const since = Date.now() - FOLDER_DAYS * 86400000;
    const files = all.filter((f) => logFileName(f.name) && f.lastModified >= since);
    if (!files.length) { result.innerHTML = alertBox(tx('Nu am găsit log-uri din ultimele {n} zile în acest folder. Verifică dacă e folderul Gamelogs.', { n: FOLDER_DAYS }), 'warn'); return; }
    result.innerHTML = loader(tx('Citesc {n} fișiere', { n: files.length }));
    const texts = await Promise.all(files.map(async (f) => ({ name: f.name, text: await readText(f) })));
    load(texts, `${name} · ${tx('{n} fișiere', { n: files.length })}`);
  }

  async function pickFolder() {
    if (!folderSupported()) { folderInput.click(); return; }
    let dir: DirLike;
    try {
      dir = await (window as unknown as { showDirectoryPicker(o: object): Promise<DirLike> }).showDirectoryPicker({ id: 'vyraj-gamelogs', mode: 'read' });
    } catch { return; }
    result.innerHTML = loader(tx('Caut log-urile din ultimele {n} zile', { n: FOLDER_DAYS }));
    const files: File[] = [];
    try {
      for await (const h of dir.values()) if (h.kind === 'file' && logFileName(h.name)) files.push(await h.getFile());
    } catch (err) { result.innerHTML = alertBox((err as Error).message); return; }
    await loadFolder(files, dir.name);
  }

  function loadSample() {
    paste.value = '';
    load([{ name: 'recorded', text: recordedCombatLog(tx('Pilot demo'), VARGUR_FIGHT) }, { name: 'recorded-2', text: recordedCombatLog(tx('Pilot demo'), GILA_FIGHT, 13) }, { name: 'sample', text: sampleCombatLog(tx('Pilot demo')) }], tx('Exemplu'));
    sample = true;
    render();
  }

  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length) void loadFiles(files);
  });
  folderInput.addEventListener('change', () => {
    const files = [...(folderInput.files ?? [])];
    folderInput.value = '';
    const name = files[0]?.webkitRelativePath.split('/')[0] || 'Gamelogs';
    if (files.length) void loadFolder(files, name);
  });
  fileInput.addEventListener('change', () => {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = '';
    if (files.length) void loadFiles(files);
  });

  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-fight-paste]')) {
      if (!paste.value.trim()) { toast(tx('Lipește mai întâi conținutul log-ului')); return; }
      load([{ name: 'paste', text: paste.value }], tx('Text lipit'));
      return;
    }
    if (t.closest('[data-fight-folder]')) { void pickFolder(); return; }
    if (t.closest('[data-fight-sample]')) { loadSample(); return; }
    if (t.closest('[data-fight-clear]')) { paste.value = ''; logs = []; encounters = []; selected = ''; render(); return; }
    const row = t.closest<HTMLElement>('[data-fight-id]');
    if (row) { selected = row.dataset.fightId!; ids.clear(); systemId = 0; zkbState = 'idle'; render(); result.querySelector('#fightDetail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (t.closest('[data-fight-zkb]')) { void zkbContext(); return; }
  });
  el.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches('[data-fight-pve]')) {
      showPve = t.checked;
      saveJson(PVE_KEY, showPve);
      if (!list().some((x) => x.id === selected)) selected = list()[0]?.id ?? '';
      render();
    }
  });

  async function zkbContext() {
    const enc = encounters.find((e) => e.id === selected);
    if (!enc) return;
    zkbState = 'loading';
    render();
    try {
      const names = [...enc.actors.values()].filter((a) => a.player && a.name !== a.ship).map((a) => a.name);
      const r = await resolveIds([...names, ...(enc.system ? [enc.system] : [])]);
      for (const c of r.characters) ids.set(c.name.toLowerCase(), c.id);
      systemId = r.systems.find((s) => s.name.toLowerCase() === enc.system.toLowerCase())?.id ?? 0;
      zkbState = 'done';
    } catch {
      zkbState = 'error';
    }
    render();
  }

  function render() {
    if (!logs.length && !encounters.length) {
      result.innerHTML = sourceLabel
        ? panel({ body: emptyState({ title: tx('Nicio luptă găsită'), text: tx('Log-ul nu conține linii de luptă. Verifică dacă ai ales fișierele din Gamelogs, nu din Chatlogs.') }) })
        : '';
      return;
    }
    if (!encounters.length) {
      result.innerHTML = panel({ body: emptyState({ title: tx('Nicio luptă găsită'), text: tx('Log-ul nu conține linii de luptă. Verifică dacă ai ales fișierele din Gamelogs, nu din Chatlogs.') }) });
      return;
    }
    const enc = encounters.find((e) => e.id === selected);
    const a = enc ? analyzeFight(enc) : null;
    result.innerHTML = `${renderList()}${enc && a ? `<div id="fightDetail">${renderFight(enc, a)}</div>` : ''}`;
    if (enc && a) bindCharts(enc, a);
  }

  function renderList() {
    const rows = list();
    const pvpCount = encounters.filter((e) => e.pvp).length;
    const body = rows.length
      ? `<div class="table-scroll"><table class="table compact fight-list"><thead><tr>
          <th>${tx('Când (EVE)')}</th><th>${tx('Sistem')}</th><th class="r">${tx('Durată')}</th><th>${tx('Adversari')}</th><th class="r">${tx('Damage dat')}</th><th class="r">${tx('Damage primit')}</th><th></th>
        </tr></thead><tbody>${rows.slice(0, MAX_ROWS).map((e) => {
          const foes = [...e.actors.values()];
          const players = foes.filter((a) => a.player);
          const shown = (players.length ? players : foes).slice(0, 3).map((a) => esc(a.player && a.ship ? `${a.name} (${a.ship})` : a.name)).join(', ');
          const more = (players.length ? players : foes).length - 3;
          return `<tr class="clickable ${e.id === selected ? 'selected' : ''}" data-fight-id="${esc(e.id)}">
            <td class="num">${dateLabel(e.start)}</td>
            <td>${esc(e.system || '—')}</td>
            <td class="r num">${rel(e.end - e.start + 1000)}</td>
            <td class="fight-foes">${shown}${more > 0 ? ` <span class="dim">+${more}</span>` : ''}</td>
            <td class="r num fight-out">${formatInt(e.dmgOut)}</td>
            <td class="r num fight-in">${formatInt(e.dmgIn)}</td>
            <td>${e.pvp ? badge('PvP', 'danger') : badge('PvE')}</td>
          </tr>`;
        }).join('')}</tbody></table></div>`
      : `<p class="dim small">${tx('Nicio luptă cu jucători în log-urile încărcate. Bifează „Arată și luptele PvE” ca să vezi luptele cu NPC-uri.')}</p>`;
    return panel({
      title: tx('Lupte găsite'),
      count: `${rows.length}`,
      actions: `<label class="check small"><input type="checkbox" data-fight-pve ${showPve ? 'checked' : ''} /> ${tx('Arată și luptele PvE')}</label>`,
      body: `<p class="dim small">${esc(sourceLabel)} · ${tx('{all} lupte, din care {pvp} cu jucători. O pauză de peste un minut fără focuri separă luptele.', { all: encounters.length, pvp: pvpCount })}</p>${body}`,
    });
  }

  function statTile(label: string, value: string, meta: string, tone: string) {
    return `<div class="panel stat fight-stat ${tone}"><div class="stat-label"><i></i>${esc(label)}</div><div class="stat-value">${value}</div><div class="stat-meta">${meta}</div></div>`;
  }

  function renderFight(enc: Encounter, a: FightAnalysis) {
    const dur = a.duration;
    const players = a.actors.filter((s) => s.actor.player);
    const npcs = a.actors.length - players.length;
    const total = enc.dmgOut + enc.dmgIn;
    const share = pct(enc.dmgOut, total);
    const accOut = pct(a.hitsOut, a.hitsOut + a.missOut);
    const accIn = pct(a.hitsIn, a.hitsIn + a.missIn);
    const head = `<div class="fight-head">
      <div><h2>${esc(enc.system || tx('Sistem necunoscut'))} <span class="dim">· ${dateLabel(enc.start)} EVE</span></h2>
      <p class="dim small">${enc.listener ? `${tx('Log-ul lui {name}', { name: esc(enc.listener) })} · ` : ''}${tx('{p} jucători, {n} NPC', { p: players.length, n: npcs })} · ${tx('durată {d}', { d: rel(dur * 1000) })}</p></div>
      ${enc.pvp ? badge('PvP', 'danger', true) : badge('PvE', '', true)}
    </div>
    <div class="fight-share" title="${esc(tx('Partea ta din tot damage-ul schimbat în luptă'))}">
      <span class="fight-share-out" style="width:${share}%"></span><span class="fight-share-in" style="width:${100 - share}%"></span>
    </div>
    <p class="small fight-share-legend"><span class="fight-out">${tx('Tu: {pct}% din damage', { pct: share })}</span><span class="fight-in">${tx('Ei: {pct}%', { pct: 100 - share })}</span></p>`;

    const stats = `<div class="stats fight-stats">
      ${statTile(tx('Damage dat'), formatInt(enc.dmgOut), tx('{dps} DPS mediu · vârf {peak}', { dps: formatInt(enc.dmgOut / dur), peak: formatInt(a.peakOut.dps) }), 'fight-tone-out')}
      ${statTile(tx('Damage primit'), formatInt(enc.dmgIn), tx('{dps} DPS mediu · vârf {peak}', { dps: formatInt(enc.dmgIn / dur), peak: formatInt(a.peakIn.dps) }), 'fight-tone-in')}
      ${statTile(tx('Capacitor pierdut'), `${formatInt(a.capIn)}<small>GJ</small>`, a.capIn ? tx('{rate} GJ/s în medie prin neut și nos', { rate: formatNum(a.capIn / dur, 1) }) : tx('Nimeni nu ți-a neutralizat capacitorul'), 'fight-tone-cap')}
      ${statTile(tx('Precizie'), `${accOut}%`, tx('lovituri reușite; ale lor: {pct}%', { pct: accIn }), 'fight-tone-acc')}
      ${a.repIn ? statTile(tx('Reparații primite'), formatInt(a.repIn), tx('de la flotă, prin module remote'), 'fight-tone-rep') : ''}
    </div>`;

    const timeline = panel({
      title: tx('Desfășurarea luptei'),
      actions: `<span class="fight-legend"><span class="li"><span class="k out"></span>${tx('DPS dat')}</span><span class="li"><span class="k in"></span>${tx('DPS primit')}</span>${a.capIn ? `<span class="li"><span class="k cap"></span>${tx('Neut primit')}</span>` : ''}</span>`,
      body: `${timelineChart(enc, a)}<p class="dim small fight-legend fight-marks"><span class="li"><span class="m tackle"></span>${tx('tackle / warp blocat')}</span><span class="li"><span class="m neut"></span>${tx('neut / capacitor gol')}</span><span class="li"><span class="m arrive"></span>${tx('intră un adversar')}</span><span class="li"><span class="m silent"></span>${tx('dispare un adversar')}</span><span class="li"><span class="m other"></span>${tx('reîncărcare / jam / warp')}</span></p><p class="dim small">${tx('Fiecare bară acoperă {s} s. Treci cu mouse-ul peste marcaje și bare pentru detalii.', { s: a.step })}</p>`,
    });

    const cumul = panel({ title: tx('Cursa damage-ului'), body: `${cumulativeChart(enc, a)}<p class="dim small">${tx('Damage-ul adunat de la începutul luptei. Unde linia roșie urcă mai repede, pierzi cursa.')}</p>` });
    const cap = a.capIn || a.capOut ? panel({ title: tx('Presiune pe capacitor'), body: `${capChart(enc, a)}<p class="dim small">${tx('GJ scoși din capacitorul tău pe secundă de neut-uri și nos-uri, plus totalul adunat.')}</p>` }) : '';

    return `${panel({ body: head })}${stats}${timeline}<div class="fight-two">${cumul}${cap}</div>
      ${panel({ title: tx('Cine a făcut ce și când'), body: activityRows(enc, a) })}
      ${panel({ title: tx('Adversari'), actions: zkbButton(enc), body: actorTable(enc, a) })}
      <div class="fight-two wide">
        ${panel({ title: tx('Armele tale'), body: weaponTable(a.weaponsOut, a.qualityOut, a.missOut, enc, false) })}
        ${panel({ title: tx('Ce te-a lovit'), body: weaponTable(a.weaponsIn, a.qualityIn, a.missIn, enc, true) })}
      </div>
      ${panel({ title: tx('Momente cheie'), body: momentList(enc, a.moments) })}`;
  }

  function zkbButton(enc: Encounter) {
    if (!enc.pvp || sample) return '';
    if (zkbState === 'loading') return `<span class="dim small">${tx('Caut piloții...')}</span>`;
    if (zkbState === 'done') {
      const hour = new Date(enc.start);
      const stampHour = `${hour.getUTCFullYear()}${pad(hour.getUTCMonth() + 1)}${pad(hour.getUTCDate())}${pad(hour.getUTCHours())}00`;
      return systemId ? `<a class="btn ghost sm" href="https://zkillboard.com/related/${systemId}/${stampHour}/" target="_blank" rel="noopener noreferrer">${icon('external')}${tx('Raport de luptă pe zKillboard')}</a>` : '';
    }
    return `${zkbState === 'error' ? `<span class="dim small">${tx('ESI nu a răspuns.')}</span>` : ''}${button(tx('Caută pe zKillboard'), { iconName: 'external', cls: 'ghost sm', attrs: `data-fight-zkb title="${esc(tx('O singură cerere ESI pentru numele piloților și sistemul. Apoi primești link-uri spre zKillboard.'))}"` })}`;
  }

  function timelineChart(enc: Encounter, a: FightAnalysis) {
    const w = 760, h = 300, pl = 52, pr = 10, top = 26, lane = 26, pb = 22;
    const capH = a.capIn ? 34 : 0;
    const plotH = h - top - pb - capH - (capH ? 8 : 0);
    const mid = top + plotH / 2;
    const n = a.buckets.length;
    const step = (w - pl - pr) / n;
    const x = (i: number) => pl + step * i;
    const maxD = Math.max(1, ...a.buckets.map((b) => Math.max(b.dmgOut, b.dmgIn) / a.step));
    const half = plotH / 2 - 2;
    const y = (v: number) => (v / maxD) * half;
    const bw = Math.max(0.8, step * 0.78);
    const bars = a.buckets.map((b, i) => {
      const o = y(b.dmgOut / a.step), d = y(b.dmgIn / a.step);
      const bx = (x(i) + (step - bw) / 2).toFixed(1);
      return `${o ? `<rect class="out" x="${bx}" width="${bw.toFixed(1)}" y="${(mid - o).toFixed(1)}" height="${o.toFixed(1)}" />` : ''}${d ? `<rect class="in" x="${bx}" width="${bw.toFixed(1)}" y="${mid.toFixed(1)}" height="${d.toFixed(1)}" />` : ''}`;
    }).join('');
    const capTop = top + plotH + 8;
    const maxCap = Math.max(1, ...a.buckets.map((b) => b.neutIn + b.nosIn));
    const capBars = capH ? a.buckets.map((b, i) => {
      const v = ((b.neutIn + b.nosIn) / maxCap) * (capH - 4);
      return v ? `<rect class="cap" x="${(x(i) + (step - bw) / 2).toFixed(1)}" width="${bw.toFixed(1)}" y="${(capTop + capH - v).toFixed(1)}" height="${v.toFixed(1)}" />` : '';
    }).join('') : '';
    const span = Math.max(1, enc.end - enc.start + 1000);
    const tx0 = (t: number) => pl + Math.min(1, (t - enc.start) / span) * (w - pl - pr);
    const marks = a.moments.filter((m) => m.kind !== 'start' && m.kind !== 'end' && m.kind !== 'peakIn' && m.kind !== 'peakOut').map((m) => {
      const mx = tx0(m.t).toFixed(1);
      return `<g class="mark ${m.kind}"><line x1="${mx}" x2="${mx}" y1="${top - 4}" y2="${top + plotH}" /><circle cx="${mx}" cy="${top - lane / 2 + 2}" r="4.5"><title>${esc(`${rel(m.t - enc.start)} · ${momentText(enc, m)}`)}</title></circle></g>`;
    }).join('');
    const ticks = [maxD, maxD / 2];
    const every = Math.max(1, Math.ceil(n / 8));
    const labels = a.buckets.map((b, i) => (i % every === 0 ? `<text x="${(x(i) + step / 2).toFixed(1)}" y="${h - 6}" text-anchor="middle">${rel(b.t - enc.start)}</text>` : '')).join('');
    const hits = a.buckets.map((_, i) => `<rect class="hit" data-i="${i}" x="${x(i).toFixed(1)}" width="${step.toFixed(1)}" y="${top}" height="${(plotH + capH + 8).toFixed(1)}" />`).join('');
    return `<div class="series-wrap" data-chart="timeline"><svg class="series-chart fight-chart" viewBox="0 0 ${w} ${h}" role="img">
      ${ticks.map((v) => `<line class="grid" x1="${pl}" x2="${w - pr}" y1="${(mid - y(v)).toFixed(1)}" y2="${(mid - y(v)).toFixed(1)}" /><line class="grid" x1="${pl}" x2="${w - pr}" y1="${(mid + y(v)).toFixed(1)}" y2="${(mid + y(v)).toFixed(1)}" /><text x="${pl - 6}" y="${(mid - y(v) + 4).toFixed(1)}" text-anchor="end">${compact(v)}</text><text x="${pl - 6}" y="${(mid + y(v) + 4).toFixed(1)}" text-anchor="end">${compact(v)}</text>`).join('')}
      ${bars}
      <line class="zero" x1="${pl}" x2="${w - pr}" y1="${mid}" y2="${mid}" />
      ${capH ? `<line class="grid" x1="${pl}" x2="${w - pr}" y1="${capTop + capH}" y2="${capTop + capH}" /><text x="${pl - 6}" y="${capTop + capH - 4}" text-anchor="end">GJ</text>${capBars}` : ''}
      ${labels}
      ${marks}
      <line class="cursor" x1="0" x2="0" y1="${top}" y2="${top + plotH + capH + 8}" style="display:none" />
      ${hits}
    </svg><div class="series-tip" style="display:none"></div></div>`;
  }

  function cumulativeChart(enc: Encounter, a: FightAnalysis) {
    const w = 380, h = 200, pl = 46, pr = 8, pt = 10, pb = 22;
    let o = 0, d = 0;
    const pts = a.buckets.map((b) => ({ t: b.t, o: (o += b.dmgOut), d: (d += b.dmgIn) }));
    const max = Math.max(1, o, d);
    const n = pts.length;
    const x = (i: number) => pl + ((i + 1) / n) * (w - pl - pr);
    const y = (v: number) => pt + (1 - v / max) * (h - pt - pb);
    const path = (k: 'o' | 'd') => `M${pl},${y(0)}` + pts.map((p, i) => `L${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join('');
    const every = Math.max(1, Math.ceil(n / 4));
    return `<div class="series-wrap" data-chart="cumul"><svg class="series-chart fight-chart" viewBox="0 0 ${w} ${h}" role="img">
      ${[0, 0.5, 1].map((f) => `<line class="grid" x1="${pl}" x2="${w - pr}" y1="${y(max * f)}" y2="${y(max * f)}" /><text x="${pl - 6}" y="${y(max * f) + 4}" text-anchor="end">${compact(max * f)}</text>`).join('')}
      ${pts.map((p, i) => (i % every === 0 ? `<text x="${x(i).toFixed(1)}" y="${h - 6}" text-anchor="middle">${rel(p.t - enc.start + a.step * 1000)}</text>` : '')).join('')}
      <path class="line out" d="${path('o')}" /><path class="line in" d="${path('d')}" />
      <line class="cursor" x1="0" x2="0" y1="${pt}" y2="${h - pb}" style="display:none" />
      ${pts.map((_, i) => `<rect class="hit" data-i="${i}" x="${(x(i) - (w - pl - pr) / n).toFixed(1)}" width="${((w - pl - pr) / n).toFixed(1)}" y="${pt}" height="${h - pt - pb}" />`).join('')}
    </svg><div class="series-tip" style="display:none"></div></div>`;
  }

  function capChart(enc: Encounter, a: FightAnalysis) {
    const w = 380, h = 200, pl = 46, pr = 40, pt = 10, pb = 22;
    const n = a.buckets.length;
    const step = (w - pl - pr) / n;
    const rates = a.buckets.map((b) => (b.neutIn + b.nosIn) / a.step);
    const maxR = Math.max(1, ...rates);
    let c = 0;
    const cum = a.buckets.map((b) => (c += b.neutIn + b.nosIn));
    const maxC = Math.max(1, c);
    const plotH = h - pt - pb;
    const bw = Math.max(0.8, step * 0.75);
    const every = Math.max(1, Math.ceil(n / 4));
    return `<div class="series-wrap" data-chart="cap"><svg class="series-chart fight-chart" viewBox="0 0 ${w} ${h}" role="img">
      ${[0, 0.5, 1].map((f) => `<line class="grid" x1="${pl}" x2="${w - pr}" y1="${pt + (1 - f) * plotH}" y2="${pt + (1 - f) * plotH}" /><text x="${pl - 6}" y="${pt + (1 - f) * plotH + 4}" text-anchor="end">${formatInt(maxR * f)}</text><text x="${w - pr + 6}" y="${pt + (1 - f) * plotH + 4}">${compact(maxC * f)}</text>`).join('')}
      ${rates.map((r, i) => { const v = (r / maxR) * plotH; return v ? `<rect class="cap" x="${(pl + step * i + (step - bw) / 2).toFixed(1)}" width="${bw.toFixed(1)}" y="${(pt + plotH - v).toFixed(1)}" height="${v.toFixed(1)}" />` : ''; }).join('')}
      <path class="line cap" d="${cum.map((v, i) => `${i ? 'L' : 'M'}${(pl + step * (i + 1)).toFixed(1)},${(pt + (1 - v / maxC) * plotH).toFixed(1)}`).join('')}" />
      ${a.buckets.map((b, i) => (i % every === 0 ? `<text x="${(pl + step * (i + 0.5)).toFixed(1)}" y="${h - 6}" text-anchor="middle">${rel(b.t - enc.start)}</text>` : '')).join('')}
      <line class="cursor" x1="0" x2="0" y1="${pt}" y2="${h - pb}" style="display:none" />
      ${a.buckets.map((_, i) => `<rect class="hit" data-i="${i}" x="${(pl + step * i).toFixed(1)}" width="${step.toFixed(1)}" y="${pt}" height="${plotH}" />`).join('')}
    </svg><div class="series-tip" style="display:none"></div></div>`;
  }

  function activityRows(enc: Encounter, a: FightAnalysis) {
    const span = Math.max(1, enc.end - enc.start + 1000);
    const rows = a.actors.slice(0, MAX_ACTOR_ROWS).map((s) => {
      const per = new Map<number, Set<string>>();
      for (const m of s.marks) {
        const sec = Math.floor((m.t - enc.start) / 1000);
        const kind = m.kind === 'dmg' || m.kind === 'miss' ? (m.dir === 'out' ? 'out' : 'in') : m.kind === 'neut' || m.kind === 'nos' ? (m.dir === 'in' ? 'cap' : 'out') : m.kind === 'tackle' ? 'tackle' : m.kind === 'jam' ? 'jam' : 'rep';
        let set = per.get(sec);
        if (!set) { set = new Set(); per.set(sec, set); }
        set.add(kind);
      }
      const unit = 1000 / span * 1000;
      const ticks = [...per.entries()].flatMap(([sec, kinds]) => [...kinds].map((k) => {
        const row = k === 'out' ? 0 : k === 'in' ? 1 : 2;
        return `<rect class="${k}" x="${((sec * 1000) / span * 1000).toFixed(1)}" width="${Math.max(2, unit).toFixed(1)}" y="${row * 6}" height="5" />`;
      })).join('');
      const active = `${rel(s.first - enc.start)}–${rel(s.last - enc.start)}`;
      return `<div class="fight-act-row">
        <div class="fight-act-name">${shipIcon(s.actor)}<span><b>${esc(actorName(s.actor))}</b><small>${esc([s.actor.player ? s.actor.ship : '', s.actor.corp ? `[${s.actor.corp}]` : ''].filter(Boolean).join(' ') || (s.actor.player ? '' : 'NPC'))} · ${active}</small></span></div>
        <svg class="fight-act-track" viewBox="0 0 1000 17" preserveAspectRatio="none">${ticks}</svg>
      </div>`;
    }).join('');
    const more = a.actors.length - MAX_ACTOR_ROWS;
    return `<div class="fight-act">${rows}</div>
      <p class="dim small fight-legend"><span class="li"><span class="k out"></span>${tx('tu îl lovești')}</span><span class="li"><span class="k in"></span>${tx('te lovește')}</span><span class="li"><span class="k cap"></span>${tx('neut / nos pe tine')}</span><span class="li"><span class="k tackle"></span>${tx('tackle')}</span>${more > 0 ? ` · ${tx('încă {n} în tabel', { n: more })}` : ''}</p>`;
  }

  function actorTable(enc: Encounter, a: FightAnalysis) {
    const tackleLabel = (s: string) => s.split(', ').map((k) => (k === 'scramble' ? 'scram' : k === 'disruption' ? 'point' : k)).join(', ');
    const rows = a.actors.map((s: ActorStats) => {
      const id = ids.get(s.actor.name.toLowerCase());
      const name = id
        ? `<a class="ext-link" href="https://zkillboard.com/character/${id}/" target="_blank" rel="noopener noreferrer">${esc(s.actor.name)}</a>`
        : esc(actorName(s.actor));
      const avatar = id ? `<img class="row-icon round" src="${portraitUrl(id, 32)}" alt="" loading="lazy" />` : '';
      const tackle = [s.tackledBy ? `<span class="fight-in">${tx('te ține')}: ${esc(tackleLabel(s.tackledBy))}</span>` : '', s.tackled ? `<span class="fight-out">${tx('îl ții')}: ${esc(tackleLabel(s.tackled))}</span>` : ''].filter(Boolean).join('<br>');
      return `<tr>
        <td><span class="recon-ship">${shipIcon(s.actor)}${avatar}<span class="recon-aff">${name}<small>${esc([s.actor.player ? s.actor.ship : 'NPC', s.actor.corp ? `[${s.actor.corp}]` : '', s.actor.alliance ? `<${s.actor.alliance}>` : ''].filter(Boolean).join(' '))}</small></span></span></td>
        <td class="r num fight-in">${s.dmgFrom ? formatInt(s.dmgFrom) : '<span class="dim">—</span>'}</td>
        <td class="r num">${s.maxFrom ? formatInt(s.maxFrom) : '<span class="dim">—</span>'}</td>
        <td class="r num">${s.hitsFrom + s.missFrom ? `${pct(s.hitsFrom, s.hitsFrom + s.missFrom)}%` : '<span class="dim">—</span>'}</td>
        <td class="r num fight-cap">${s.neut + s.nos ? formatInt(s.neut + s.nos) : '<span class="dim">—</span>'}</td>
        <td class="r num fight-out">${s.dmgTo ? formatInt(s.dmgTo) : '<span class="dim">—</span>'}</td>
        <td class="small">${tackle || '<span class="dim">—</span>'}${s.jams ? `<br><span class="fight-in">${tx('jam × {n}', { n: s.jams })}</span>` : ''}</td>
        <td class="r num dim">${rel(s.first - enc.start)}–${rel(s.last - enc.start)}</td>
      </tr>`;
    }).join('');
    return `<div class="table-scroll"><table class="table compact fight-actors"><thead><tr>
      <th>${tx('Pilot / navă')}</th><th class="r">${tx('Damage primit')}</th><th class="r">${tx('Max lovitură')}</th><th class="r" title="${esc(tx('Cât de des te-a lovit din totalul încercărilor'))}">${tx('Precizia lui')}</th><th class="r">${tx('Neut + nos (GJ)')}</th><th class="r">${tx('Damage dat')}</th><th>${tx('Tackle')}</th><th class="r">${tx('Activ')}</th>
    </tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function qualityBar(q: Record<string, number>, misses: number) {
    const total = QUALITIES.reduce((s, k) => s + (q[k] ?? 0), 0) + misses;
    if (!total) return '';
    const seg = (cls: string, n: number, label: string) => (n ? `<span class="${cls}" style="width:${(n / total) * 100}%" title="${esc(`${label}: ${n} (${pct(n, total)}%)`)}"></span>` : '');
    return `<span class="fight-q">${QUALITIES.map((k) => seg(QUALITY_CLASS[k], q[k] ?? 0, k)).join('')}${seg('qm', misses, tx('Ratări'))}</span>`;
  }

  function weaponTable(list: WeaponStats[], quality: Record<string, number>, misses: number, enc: Encounter, incoming: boolean) {
    if (!list.length) return `<p class="dim small">${incoming ? tx('Nimic nu te-a lovit.') : tx('N-ai lovit nimic în această luptă.')}</p>`;
    const rows = list.slice(0, 14).map((w) => {
      const id = itemId(w.weapon);
      const iconHtml = id ? `<img class="row-icon" src="${typeIconUrl(id, 32)}" alt="" loading="lazy" />` : `<span class="row-icon fight-noicon">${icon('fire')}</span>`;
      const label = w.weapon === '—' ? tx('Fără nume de armă') : w.weapon;
      return `<tr>
        <td><span class="recon-ship">${iconHtml}<span class="recon-aff">${esc(label)}${incoming ? `<small>${esc(actorLabel(w.source, enc))}</small>` : ''}</span></span></td>
        <td class="r num">${formatInt(w.hits)}${w.misses ? `<span class="dim"> / ${formatInt(w.misses)}</span>` : ''}</td>
        <td class="r num">${formatInt(w.total)}</td>
        <td class="r num">${w.hits ? formatInt(w.total / w.hits) : '—'}</td>
        <td class="r num">${formatInt(w.max)}</td>
        <td>${qualityBar(w.quality, w.misses)}</td>
      </tr>`;
    }).join('');
    return `<div class="table-scroll"><table class="table compact fight-weapons"><thead><tr>
      <th>${incoming ? tx('Armă / sursă') : tx('Armă')}</th><th class="r" title="${esc(tx('Lovituri / ratări'))}">${tx('Lovituri')}</th><th class="r">${tx('Total')}</th><th class="r">${tx('Medie')}</th><th class="r">Max</th><th>${tx('Calitate')}</th>
    </tr></thead><tbody>${rows}</tbody></table></div>
    <p class="dim small fight-qlegend">${qualityBar(quality, misses)}${QUALITIES.map((k) => `<span><i class="${QUALITY_CLASS[k]}"></i>${k} ${quality[k] ?? 0}</span>`).join('')}<span><i class="qm"></i>${tx('Ratări')} ${misses}</span></p>`;
  }

  function momentText(enc: Encounter, m: Moment): string {
    const who = esc(actorLabel(m.who, enc));
    const kind = m.text === 'scramble' ? 'warp scrambler' : m.text === 'disruption' ? 'warp disruptor' : m.text;
    switch (m.kind) {
      case 'start': return tx('Primul schimb de focuri');
      case 'tackleIn': return tx('{who} te prinde cu {kind}', { who, kind });
      case 'tackleOut': return tx('Îl prinzi pe {who} cu {kind}', { who, kind });
      case 'neutIn': return tx('{who} începe să-ți golească capacitorul', { who });
      case 'arrive': return tx('{who} intră în luptă', { who });
      case 'silent': return tx('{who} dispare din log după ultimele tale lovituri: distrus sau a plecat', { who });
      case 'jam': return tx('Ești bruiat de {who}', { who });
      case 'reload': return tx('Reîncărcare: {weapon}', { weapon: esc(m.text) });
      case 'peakIn': return tx('Cel mai greu moment: {dps} DPS primit timp de 10 s', { dps: formatInt(m.value ?? 0) });
      case 'peakOut': return tx('Cel mai bun moment al tău: {dps} DPS dat timp de 10 s', { dps: formatInt(m.value ?? 0) });
      case 'end': return tx('Ultimul schimb de focuri');
      case 'capEmpty': return tx('Capacitor gol: {module} nu mai pornește ({cap} GJ rămași)', { module: esc(m.text), cap: formatNum(m.value ?? 0, 1) });
      case 'warpBlocked': return tx('Încerci să ieși în warp, dar ești ținut');
      case 'warp': return tx('Ești în warp, ieși din luptă');
    }
  }

  function momentList(enc: Encounter, moments: Moment[]) {
    return `<ol class="fight-moments">${moments.map((m) => `<li class="${m.kind}"><span class="num fight-mt">${rel(m.t - enc.start)}</span><span class="num dim fight-mc">${clock(m.t)}</span><span>${momentText(enc, m)}</span></li>`).join('')}</ol>`;
  }

  function bindTip(root: HTMLElement, name: string, content: (i: number) => string) {
    const wrap = root.querySelector<HTMLElement>(`[data-chart="${name}"]`);
    if (!wrap) return;
    const svg = wrap.querySelector('svg')!, tip = wrap.querySelector<HTMLElement>('.series-tip')!, cursor = wrap.querySelector<SVGLineElement>('.cursor')!;
    svg.addEventListener('mousemove', (e) => {
      const r = (e.target as Element).closest<SVGRectElement>('.hit');
      if (!r) return;
      const cx = Number(r.getAttribute('x')) + Number(r.getAttribute('width')) / 2;
      cursor.setAttribute('x1', String(cx)); cursor.setAttribute('x2', String(cx)); cursor.style.display = '';
      tip.innerHTML = content(Number(r.dataset.i));
      tip.style.display = '';
      const box = wrap.getBoundingClientRect();
      tip.style.left = `${Math.min(box.width - tip.offsetWidth - 4, Math.max(4, e.clientX - box.left + 12))}px`;
    });
    svg.addEventListener('mouseleave', () => { tip.style.display = 'none'; cursor.style.display = 'none'; });
  }

  function bindCharts(enc: Encounter, a: FightAnalysis) {
    const head = (i: number) => {
      const b = a.buckets[i];
      return `<b>${rel(b.t - enc.start)} · ${clock(b.t)}</b>`;
    };
    bindTip(result, 'timeline', (i) => {
      const b = a.buckets[i];
      return `${head(i)}<span class="fight-out">${tx('Dat')}: ${formatInt(b.dmgOut)} (${formatInt(b.dmgOut / a.step)} DPS)</span><span class="fight-in">${tx('Primit')}: ${formatInt(b.dmgIn)} (${formatInt(b.dmgIn / a.step)} DPS)</span>${b.neutIn + b.nosIn ? `<span class="fight-cap">${tx('Neut + nos')}: ${formatInt(b.neutIn + b.nosIn)} GJ</span>` : ''}${b.repIn ? `<span>${tx('Reparat')}: ${formatInt(b.repIn)}</span>` : ''}`;
    });
    let o = 0, d = 0;
    const cum = a.buckets.map((b) => ({ o: (o += b.dmgOut), d: (d += b.dmgIn) }));
    bindTip(result, 'cumul', (i) => `${head(i)}<span class="fight-out">${tx('Dat')}: ${formatInt(cum[i].o)}</span><span class="fight-in">${tx('Primit')}: ${formatInt(cum[i].d)}</span>`);
    let c = 0;
    const capCum = a.buckets.map((b) => (c += b.neutIn + b.nosIn));
    bindTip(result, 'cap', (i) => {
      const b = a.buckets[i];
      return `${head(i)}<span>${tx('Neut')}: ${formatInt(b.neutIn)} GJ</span><span>Nos: ${formatInt(b.nosIn)} GJ</span><span class="fight-cap">${tx('Total')}: ${formatInt(capCum[i])} GJ</span>`;
    });
  }

  if (isDemo()) loadSample();
  else render();
}
