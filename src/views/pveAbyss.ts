import { panel, esc, button } from '../ui/components';
import { NPC_SITES, factionsFor } from '../engine/npc';
import { TIERS, filamentTypeId } from '../services/abyssal';
import { typeIconUrl } from '../services/market';
import { tx } from '../i18n';

const RESIST: Record<string, string> = { em: 'EM', thermal: tx('Termic'), kinetic: tx('Cinetic'), explosive: tx('Exploziv') };

const WEATHER: { id: string; penalty: string; bonus: string; advice: string }[] = [
  { id: 'Electrical', penalty: tx('Rezistență EM mai mică'), bonus: tx('Capacitorul se reîncarcă de două ori mai repede'), advice: tx('Întărește rezistența EM. Fit-urile active pe capacitor se descurcă bine aici.') },
  { id: 'Dark', penalty: tx('Optimal și falloff mai mici pentru turele'), bonus: tx('Viteză maximă +50%'), advice: tx('Rachetele și dronele nu sunt afectate. Cu turele, stai mai aproape de ținte.') },
  { id: 'Exotic', penalty: tx('Rezistență cinetică mai mică'), bonus: tx('Scan resolution +50%'), advice: tx('Întărește rezistența cinetică. Lock-ul se face mai repede.') },
  { id: 'Firestorm', penalty: tx('Rezistență termică mai mică'), bonus: tx('Armor HP +50%'), advice: tx('Întărește rezistența termică. Merge bine cu tank pe armor.') },
  { id: 'Gamma', penalty: tx('Rezistență explozivă mai mică'), bonus: tx('Shield HP +50%'), advice: tx('Întărește rezistența explozivă. Merge bine cu tank pe shield.') },
];

const TIER_LABEL = [tx('T0 Liniștit'), tx('T1 Calm'), tx('T2 Agitat'), tx('T3 Feroce'), tx('T4 Furios'), tx('T5 Haotic'), tx('T6 Cataclismic')];
const SAFE_SEC = ['1.0', '0.8', '0.8', '0.8', '0.7', '0.6', '0.5'];

const OBJECTS: { name: string; text: string }[] = [
  { name: tx('Nor tahionic (alb)'), text: tx('Viteză +300% și inerție -50%. Cu MWD pornit poți zbura necontrolat departe de ținte.') },
  { name: tx('Nor de filamente (portocaliu)'), text: tx('Shield booster-ele repară cu 40% mai puțin și au ciclu mai scurt, deci consumă mai mult capacitor.') },
  { name: tx('Nor bioluminescent (albastru)'), text: tx('Signature radius de patru ori mai mare: încasezi mai mult damage, mai ales de la rachete.') },
  { name: 'Deviant Automata Suppressor', text: tx('Turn triglavian care distruge rachete, drone și fregate de drone în raza lui (15 sau 40 km). Distruge-l primul dacă folosești drone sau rachete.') },
  { name: 'Multibody Tracking Pylon', text: tx('Turn triglavian care crește tracking-ul tuturor navelor din raza lui, inclusiv al NPC-urilor (+60% la 40 km, +80% la 15 km).') },
];

export function createAbyssGuidePanel(el: HTMLElement, opts: { onTank: (site: string, faction: string) => void; openTool: (id: string) => void }) {
  function render() {
    const dps = (t: number) => NPC_SITES.find((s) => s.id === `abyss/t${t}`)?.dps ?? 0;
    const factions = factionsFor('abyss').filter((f) => f.id !== 'mixed');
    el.innerHTML = `<div class="stack">
      ${panel({
        title: tx('Ghid de filamente abisale'),
        body: `<div class="pve-facts">
            <div><span class="label">${tx('Timp')}</span><span class="value">20 min</span><span class="small dim">${tx('la expirare pierzi nava și pod-ul')}</span></div>
            <div><span class="label">${tx('Camere')}</span><span class="value">3</span><span class="small dim">${tx('sub 6 min 40 s pe cameră în medie')}</span></div>
            <div><span class="label">${tx('Nave')}</span><span class="value">${tx('1 cruiser')}</span><span class="small dim">${tx('sau 2 distrugătoare, sau 3 fregate')}</span></div>
          </div>
          <p class="small">${tx('Cu un cruiser folosești un filament. Distrugătoarele intră câte două și fregatele câte trei, fiecare cu filamentul lui, iar urma se activează din flotă. Strategic cruiser-ele nu au voie, distrugătoarele T3 da.')}</p>
          <p class="small">${tx('Filamentul se activează la cel puțin 1000 km de porți, stații și alte urme, fără timer de log-off activ. Poarta din a treia cameră te aduce înapoi unde ai pornit.')}</p>
          <div class="wallet-scroll"><table class="table compact"><thead><tr><th>${tx('Nivel')}</th><th>${tx('Filament')}</th><th>${tx('Penalizare vreme')}</th><th>${tx('Fără suspect în highsec')}</th><th class="r">${tx('DPS tipic primit')}</th><th></th></tr></thead><tbody>
            ${TIERS.map((name, t) => `<tr><td><b>${TIER_LABEL[t]}</b></td><td class="dim">${esc(name)}</td><td>${t <= 3 ? '-30% / -50%' : '-50% / -70%'}</td><td>${t === 0 ? tx('oriunde') : tx('sec {s} sau mai mică', { s: SAFE_SEC[t] })}</td><td class="r num">~${dps(t)}</td><td class="r">${button(tx('Verifică tank-ul'), { cls: 'sm ghost', attrs: `data-ab-tank="abyss/t${t}"` })}</td></tr>`).join('')}
          </tbody></table></div>
          <p class="dim small wallet-note">${tx('Filamentele peste T0 nu se pot deschide în sisteme 1.0 și 0.9. Mai sus de securitatea din tabel primești suspect flag. DPS-ul e o estimare pentru o cameră grea, nu o valoare măsurată.')}</p>`,
      })}
      ${panel({
        title: tx('Vremea'),
        body: `<p class="small">${tx('Fiecare filament are o vreme cu un bonus și o penalizare, care se aplică și ție, și NPC-urilor. Bonusul e mereu 50%.')}</p>
          <div class="pve-weather">${WEATHER.map((w) => {
            const icon = filamentTypeId(3, w.id);
            return `<div class="pve-weather-card">
              <div class="pve-weather-head">${icon ? `<img class="row-icon" src="${typeIconUrl(icon, 32)}" alt="" loading="lazy" />` : ''}<b>${esc(w.id)}</b></div>
              <div class="small"><span class="down">−</span> ${esc(w.penalty)}</div>
              <div class="small"><span class="up">+</span> ${esc(w.bonus)}</div>
              <div class="small dim">${esc(w.advice)}</div>
            </div>`;
          }).join('')}</div>`,
      })}
      <div class="tool-grid even">
        ${panel({
          title: tx('Ce găsești în camere'),
          body: `<ul class="pve-list">${OBJECTS.map((o) => `<li><b>${esc(o.name)}</b> · ${esc(o.text)}</li>`).join('')}</ul>`,
        })}
        ${panel({
          title: tx('Inamici'),
          body: `<table class="table compact"><thead><tr><th>${tx('Facțiune')}</th><th>${tx('Slabi la')}</th></tr></thead><tbody>
            ${factions.map((f) => `<tr><td>${esc(f.name)}</td><td>${f.weak.length ? f.weak.map((d) => `<span class="dmg-tag ${d}">${RESIST[d]}</span>`).join('') : `<span class="dim">${tx('omni')}</span>`}</td></tr>`).join('')}
          </tbody></table>
          <p class="dim small wallet-note">${tx('Kill-urile din Abyss nu îți schimbă standing-ul.')}</p>
          <p>${button(tx('Deschide Jurnalul abisal'), { cls: 'sm', attrs: 'data-ab-open="abyssal"' })}</p>`,
        })}
      </div>
    </div>`;
  }

  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const tank = t.closest<HTMLElement>('[data-ab-tank]');
    if (tank) { opts.onTank(tank.dataset.abTank!, 'mixed'); return; }
    const open = t.closest<HTMLElement>('[data-ab-open]');
    if (open) opts.openTool(open.dataset.abOpen!);
  });

  return {
    show() { render(); },
    hide() {},
  };
}
