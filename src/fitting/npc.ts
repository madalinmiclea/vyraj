import type { Dogma } from '../engine/dogma';
import type { DamageType, FitStats } from '../engine/stats';
import { DAMAGE_TYPES } from '../engine/stats';
import { assessNpc, factionsFor, findFaction, findSite, NPC_KINDS, NPC_SITES, type Ewar, type NpcKind } from '../engine/npc';
import { loadJson, saveJson } from '../storage';
import { badge, esc, formatInt, formatNum, panel } from '../ui/components';
import { tx } from '../i18n';
import { DMG_LABEL, capTime, damageBar, type FitEnv } from './shared';

const NPC_KEY = 'eve-fit:npc';

interface NpcState { site: string; faction: string; dps: number | null; neut: number | null }

const KIND_LABEL: Record<NpcKind, string> = {
  mission: tx('Misiuni'),
  anomaly: tx('Anomalii'),
  ded: 'DED',
  abyss: 'Abyss',
  wormhole: 'Wormhole',
};

const EWAR_LABEL: Record<Ewar, string> = {
  web: 'Stasis webifier',
  scram: 'Warp scrambler',
  jam: 'ECM',
  damp: 'Sensor dampener',
  paint: 'Target painter',
  neut: 'Energy neutralizer',
  rr: 'Remote repair',
};

const EWAR_TEXT: Record<Ewar, string> = {
  web: tx('Viteza scade mult, tank-ul prin viteză nu mai ajută.'),
  scram: tx('Nu poți face warp și MWD-ul se oprește.'),
  jam: tx('Pierzi țintele câteva secunde. Dronele și ECCM ajută.'),
  damp: tx('Raza de țintire și scan resolution scad.'),
  paint: tx('Semnătura crește, deci primești mai mult damage.'),
  neut: tx('Îți golește capacitorul și oprește tank-ul activ.'),
  rr: tx('NPC-urile se repară între ele. Omoară întâi navele de suport.'),
};

export function createNpcPanel(env: FitEnv) {
  const { sde } = env;
  let state = loadJson<NpcState>(NPC_KEY, { site: 'mission/l4', faction: 'guristas', dps: null, neut: null });

  function scenario() {
    const site = findSite(state.site);
    const faction = findFaction(site.kind, state.faction);
    return { site, faction, dps: state.dps ?? site.dps, neut: state.neut ?? site.neut };
  }

  function time(seconds: number) {
    return seconds >= 3600 ? '> 1h' : capTime(seconds);
  }

  function dmgChips(types: DamageType[]) {
    if (!types.length) return `<span class="dim">${tx('Omni: orice tip')}</span>`;
    return types.map((t, i) => `<span class="badge ${t}" style="color:var(--dmg)">${i + 1}. ${DMG_LABEL[t]}</span>`).join(' ');
  }

  function render(s: FitStats, d: Dogma) {
    const sc = scenario();
    const a = assessNpc(sde, d, s, sc);
    const verdict = a.verdict === 'ok'
      ? badge(tx('Tankează nelimitat'), 'ok', true)
      : a.verdict === 'warn'
        ? badge(tx('Rezistă {t}', { t: time(a.timeToDie) }), 'warn', true)
        : badge(tx('Nu rezistă: {t}', { t: time(a.timeToDie) }), 'danger', true);
    const margin = Number.isFinite(a.margin) ? formatNum(a.margin * 100, 0) + '%' : '∞';
    const hasMwd = d.modules.some((m) => (m.state === 'active' || m.state === 'overheated') && sde.hasEffect(m.typeId, 'moduleBonusMicrowarpdrive'));
    const ewarRows = sc.faction.ewar.map((e) => {
      let extra = '';
      if (e === 'scram' && hasMwd) extra = badge(tx('MWD activ'), 'warn');
      if (e === 'jam') extra = `<span class="dim num">${esc(s.targeting.sensorType)} ${formatNum(s.targeting.sensorStrength, 1)}</span>`;
      if (e === 'damp') extra = `<span class="dim num">${formatNum(s.targeting.maxRange / 1000, 1)} km</span>`;
      if (e === 'neut') extra = a.cap.stable
        ? badge(tx('Cap stabil {p}%', { p: formatNum((a.cap.stableAt ?? 1) * 100, 0) }), 'ok')
        : badge(tx('Cap gol în {t}', { t: capTime(a.cap.lastsSeconds ?? 0) }), 'danger');
      return `<tr><td>${EWAR_LABEL[e]}</td><td class="dim small">${EWAR_TEXT[e]}</td><td class="r">${extra}</td></tr>`;
    }).join('');
    const share = a.matchShare;
    const shareBadge = share == null ? '' : badge(tx('{p}% din DPS-ul tău e pe tipurile bune', { p: formatNum(share * 100, 0) }), share >= 0.6 ? 'ok' : share >= 0.3 ? 'warn' : 'danger');
    const incoming = { em: a.profile.em, thermal: a.profile.thermal, kinetic: a.profile.kinetic, explosive: a.profile.explosive };
    const total = DAMAGE_TYPES.reduce((x, t) => x + incoming[t], 0) || 1;
    const custom = state.dps != null || state.neut != null;

    return panel({
      title: tx('Tank PvE'),
      id: 'fitNpc',
      actions: verdict,
      body: `<div class="target-inputs">
          <label>${tx('Conținut')} <select class="input plain sm" id="npcSite">
            ${NPC_KINDS.map((k) => `<optgroup label="${esc(KIND_LABEL[k])}">${NPC_SITES.filter((x) => x.kind === k).map((x) => `<option value="${x.id}" ${x.id === sc.site.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</optgroup>`).join('')}
          </select></label>
          <label>${tx('Facțiune')} <select class="input plain sm" id="npcFaction">
            ${factionsFor(sc.site.kind).map((f) => `<option value="${f.id}" ${f.id === sc.faction.id ? 'selected' : ''}>${esc(f.id === 'mixed' ? tx('Mixt') : f.name)}</option>`).join('')}
          </select></label>
          <label>${tx('DPS primit')} <input class="input plain sm num" type="number" min="0" step="10" data-npc-field="dps" value="${Math.round(sc.dps)}" /></label>
          ${sc.faction.ewar.includes('neut') ? `<label>Neut <input class="input plain sm num" type="number" min="0" step="1" data-npc-field="neut" value="${Math.round(sc.neut)}" /> GJ/s</label>` : ''}
          ${custom ? `<button class="btn ghost sm" data-npc-reset>${tx('Valori tipice')}</button>` : ''}
        </div>
        <div class="big-stats">
          <div><span class="label">${tx('EHP pe profil')}</span><span class="value num">${formatInt(a.ehp)}</span></div>
          <div><span class="label">${tx('Tank sustenabil')} · EHP/s</span><span class="value num">${formatNum(a.sustained, 1)}</span></div>
          <div><span class="label">${tx('DPS primit')}</span><span class="value num">${formatInt(a.incoming)}</span></div>
          <div><span class="label">${tx('Acoperire')}</span><span class="value num">${margin}</span></div>
        </div>
        <div class="dim small">${tx('Damage primit')}: ${DAMAGE_TYPES.filter((t) => incoming[t] / total >= 0.005).map((t) => `${DMG_LABEL[t]} ${formatNum((incoming[t] / total) * 100, 0)}%`).join(' · ')}</div>
        ${damageBar(incoming)}
        <dl class="mini-dl">
          <div><dt>${tx('Tank activ')}</dt><dd class="num">${formatNum(a.active * a.capFraction, 1)} EHP/s${a.active > 0 && a.capFraction < 1 ? ` <span class="dim">(${tx('limitat la {p}% de cap', { p: formatNum(a.capFraction * 100, 0) })})</span>` : ''}</dd></div>
          <div><dt>${tx('Pasiv shield')}</dt><dd class="num">${formatNum(a.passive, 1)} EHP/s</dd></div>
          <div><dt>Shield / Armor / Hull</dt><dd class="num">${formatInt(a.layerEhp.shield)} / ${formatInt(a.layerEhp.armor)} / ${formatInt(a.layerEhp.hull)}</dd></div>
          <div><dt>${tx('Timp până la moarte')}</dt><dd class="num">${Number.isFinite(a.timeToDie) ? time(a.timeToDie) : '∞'}</dd></div>
        </dl>
        <div class="npc-shoot"><span class="label">${tx('Damage de folosit')}</span> ${dmgChips(sc.faction.weak)} ${shareBadge}</div>
        ${ewarRows ? `<table class="table compact"><thead><tr><th>EWAR</th><th></th><th></th></tr></thead><tbody>${ewarRows}</tbody></table>` : `<p class="dim small">${tx('Fără EWAR important.')}</p>`}
        <p class="dim small">${tx('DPS-ul și neut-ul sunt valori tipice pentru o cameră grea. Le poți schimba după site-ul tău.')}</p>`,
    });
  }

  function save() { saveJson(NPC_KEY, state); }

  function handleChange(target: HTMLInputElement | HTMLSelectElement): boolean {
    if (target.id === 'npcSite') {
      const site = findSite(target.value);
      state = { site: site.id, faction: findFaction(site.kind, state.faction).id, dps: null, neut: null };
      save();
      return true;
    }
    if (target.id === 'npcFaction') { state = { ...state, faction: target.value }; save(); return true; }
    const field = target.dataset.npcField as 'dps' | 'neut' | undefined;
    if (field) { state = { ...state, [field]: Math.max(0, Number(target.value) || 0) }; save(); return true; }
    return false;
  }

  function handleClick(t: HTMLElement): boolean {
    if (!t.closest('[data-npc-reset]')) return false;
    state = { ...state, dps: null, neut: null };
    save();
    return true;
  }

  return { render, handleChange, handleClick };
}
