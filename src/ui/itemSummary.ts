import { Category, type Sde, type TypeInfo, type RawModifier, type EffectInfo } from '../data/sde';
import { Op, type DogmaItem } from '../engine/dogma';
import { formatAttribute } from './attributes';
import { esc } from './components';
import { tx } from '../i18n';

interface Change { who: string; attr: string; value: string; heat: boolean }

interface Special {
  text: () => string;
  who?: () => string;
  attrs?: [string, string][];
  vars?: Record<string, string>;
  targeted?: boolean;
}

const SPECIAL: Record<string, Special> = {
  shipModuleTrackingDisruptor: {
    text: () => tx('Se activează pe o navă inamică și îi slăbește turelele: raza optimă, falloff-ul și tracking-ul scad. Nu afectează rachetele, dronele sau smartbomb-urile.'),
    who: () => tx('Turelele țintei'),
    attrs: [['maxRangeBonus', 'maxRange'], ['falloffBonus', 'falloff'], ['trackingSpeedBonus', 'trackingSpeed']],
    targeted: true,
  },
  shipModuleRemoteTrackingComputer: {
    text: () => tx('Se activează pe o navă prietenă și îi îmbunătățește turelele: raza optimă, falloff-ul și tracking-ul.'),
    who: () => tx('Turelele țintei'),
    attrs: [['maxRangeBonus', 'maxRange'], ['falloffBonus', 'falloff'], ['trackingSpeedBonus', 'trackingSpeed']],
    targeted: true,
  },
  shipModuleGuidanceDisruptor: {
    text: () => tx('Se activează pe o navă inamică și îi slăbește rachetele: raza exploziei crește, viteza exploziei și raza de zbor scad. Nu afectează turelele sau dronele.'),
    who: () => tx('Rachetele țintei'),
    attrs: [['aoeCloudSizeBonus', 'aoeCloudSize'], ['aoeVelocityBonus', 'aoeVelocity'], ['missileVelocityBonus', 'maxVelocity'], ['explosionDelayBonus', 'explosionDelay']],
    targeted: true,
  },
  remoteWebifierFalloff: {
    text: () => tx('Se activează pe o țintă și îi reduce viteza maximă.'),
    who: () => tx('Ținta'),
    attrs: [['speedFactor', 'maxVelocity']],
    targeted: true,
  },
  remoteTargetPaintFalloff: {
    text: () => tx('Se activează pe o țintă și îi mărește semnătura, ca armele (mai ales rachetele) să o lovească mai tare.'),
    who: () => tx('Ținta'),
    attrs: [['signatureRadiusBonus', 'signatureRadius']],
    targeted: true,
  },
  remoteSensorDampFalloff: {
    text: () => tx('Se activează pe o țintă și îi reduce raza de țintire și viteza de blocare a țintelor (rezoluția de scanare).'),
    who: () => tx('Ținta'),
    attrs: [['maxTargetRangeBonus', 'maxTargetRange'], ['scanResolutionBonus', 'scanResolution']],
    targeted: true,
  },
  remoteSensorBoostFalloff: {
    text: () => tx('Se activează pe o navă prietenă și îi mărește raza de țintire și viteza de blocare a țintelor.'),
    who: () => tx('Ținta'),
    attrs: [['maxTargetRangeBonus', 'maxTargetRange'], ['scanResolutionBonus', 'scanResolution']],
    targeted: true,
  },
  warpScrambleBlockMWDWithNPCEffect: {
    text: () => tx('Se activează pe o țintă: n-o lasă să intre în warp sau să sară prin porți și îi oprește microwarpdrive-ul și micro jump drive-ul.'),
    who: () => tx('Ținta'),
    attrs: [['warpScrambleStrength', 'warpScrambleStatus']],
    targeted: true,
  },
  warpDisrupt: {
    text: () => tx('Se activează pe o țintă și n-o lasă să intre în warp sau să sară prin porți. Are rază mai mare decât un warp scrambler, dar nu oprește microwarpdrive-ul.'),
    who: () => tx('Ținta'),
    attrs: [['warpScrambleStrength', 'warpScrambleStatus']],
    targeted: true,
  },
  energyNeutralizerFalloff: { text: () => tx('Se activează pe o țintă și îi golește capacitorul cu {amount} pe ciclu.'), vars: { amount: 'energyNeutralizerAmount' }, targeted: true },
  energyNosferatuFalloff: { text: () => tx('Se activează pe o țintă și îi ia până la {amount} capacitor pe ciclu, doar cât timp ținta are procentual mai mult capacitor decât tine.'), vars: { amount: 'powerTransferAmount' }, targeted: true },
  shipModuleRemoteCapacitorTransmitter: { text: () => tx('Se activează pe o navă prietenă și îi transferă {amount} capacitor pe ciclu.'), vars: { amount: 'powerTransferAmount' }, targeted: true },
  shipModuleRemoteShieldBooster: { text: () => tx('Se activează pe o navă prietenă și îi repară {amount} scut pe ciclu.'), vars: { amount: 'shieldBonus' }, targeted: true },
  shipModuleAncillaryRemoteShieldBooster: { text: () => tx('Se activează pe o navă prietenă și îi repară {amount} scut pe ciclu.'), vars: { amount: 'shieldBonus' }, targeted: true },
  shipModuleRemoteArmorRepairer: { text: () => tx('Se activează pe o navă prietenă și îi repară {amount} armură pe ciclu.'), vars: { amount: 'armorDamageAmount' }, targeted: true },
  shipModuleAncillaryRemoteArmorRepairer: { text: () => tx('Se activează pe o navă prietenă și îi repară {amount} armură pe ciclu.'), vars: { amount: 'armorDamageAmount' }, targeted: true },
  ShipModuleRemoteArmorMutadaptiveRepairer: { text: () => tx('Se activează pe o navă prietenă și îi repară armura; reparația crește cu fiecare ciclu pe aceeași țintă.'), targeted: true },
  shipModuleRemoteHullRepairer: { text: () => tx('Se activează pe o navă prietenă și îi repară {amount} structură pe ciclu.'), vars: { amount: 'structureDamageAmount' }, targeted: true },
  shieldBoosting: { text: () => tx('Repară scutul navei tale cu {amount} pe ciclu.'), vars: { amount: 'shieldBonus' } },
  fueledShieldBoosting: { text: () => tx('Repară scutul navei tale cu {amount} pe ciclu; cu cap booster-e încărcate nu consumă capacitor.'), vars: { amount: 'shieldBonus' } },
  armorRepair: { text: () => tx('Repară armura navei tale cu {amount} pe ciclu.'), vars: { amount: 'armorDamageAmount' } },
  fueledArmorRepair: { text: () => tx('Repară armura navei tale cu {amount} pe ciclu; cu Nanite Repair Paste reparația crește.'), vars: { amount: 'armorDamageAmount' } },
  structureRepair: { text: () => tx('Repară structura navei tale cu {amount} pe ciclu.'), vars: { amount: 'structureDamageAmount' } },
  moduleBonusAfterburner: { text: () => tx('Cât timp e activ, crește viteza maximă a navei cu {speed}; pe nave mai grele bonusul e mai mic.'), vars: { speed: 'speedFactor' } },
  moduleBonusMicrowarpdrive: { text: () => tx('Cât timp e activ, crește viteza maximă a navei cu {speed} (mai mic pe nave grele) și mărește semnătura cu {sig}, deci nava e lovită mai ușor.'), vars: { speed: 'speedFactor', sig: 'signatureRadiusBonus' } },
  powerBooster: { text: () => tx('Consumă un cap booster încărcat și adaugă instant capacitorul lui în capacitorul navei tale.') },
  targetAttack: { text: () => tx('Trage în ținta blocată. Daunele apar în panoul de arme și în DPS-ul aplicat.'), targeted: false },
  useMissiles: { text: () => tx('Lansează rachetele încărcate spre ținta blocată. Daunele apar în panoul de arme și în DPS-ul aplicat.') },
  missileLaunching: { text: () => tx('Rachetă: se încarcă într-un lansator potrivit; daunele ei intră în DPS-ul lansatorului.') },
  miningLaser: { text: () => tx('Minează din asteroidul țintă {amount} pe ciclu.'), vars: { amount: 'miningAmount' } },
  empWave: { text: () => tx('Lovește toate navele și dronele din jurul tău pe o rază de {range}, inclusiv pe cele prietene; nu are nevoie de țintă.'), vars: { range: 'empFieldRange' } },
  salvaging: { text: () => tx('Recuperează piese din epave.') },
  tractorBeamCan: { text: () => tx('Trage epave și containere spre navă.') },
};

const num = (n: number, digits = 2) => new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(n);
const pct = (v: number) => `${v > 0 ? '+' : ''}${num(v)}\u00a0%`;
const INVERSE_UNITS = new Set([108, 111]);

function kindLabel(sde: Sde, t: TypeInfo, effects: EffectInfo[], value: (name: string) => number): string {
  const has = (cat: number) => effects.some((e) => e.category === cat && e.name !== 'online');
  switch (t.categoryId) {
    case Category.Module:
      if (has(2)) return tx('Modul activ · se folosește pe o țintă');
      if (has(1)) return tx('Modul activ · acționează pe nava ta');
      return tx('Modul pasiv · merge cât timp e pornit');
    case Category.Charge: return tx('Încărcătură');
    case Category.Drone: return tx('Dronă');
    case Category.Fighter: return tx('Fighter');
    case Category.Skill: return tx('Skill');
    case Category.Subsystem: return tx('Subsistem Tech III');
    case Category.Implant: {
      if (sde.hasAttr('boosterness') && value('boosterness')) return tx('Booster · slot {n}', { n: value('boosterness') });
      if (sde.hasAttr('implantness') && value('implantness')) return tx('Implant · slot {n}', { n: value('implantness') });
      return tx('Implant');
    }
    default: return t.groupName;
  }
}

function whoLabel(sde: Sde, t: TypeInfo, m: RawModifier): string | null {
  const skill = (id?: number) => (id ? sde.types.get(id)?.name : undefined) ?? tx('skill-ul');
  switch (m.f) {
    case 'ItemModifier':
      if (m.d === 'shipID') return tx('Nava');
      if (m.d === 'charID') return tx('Pilotul');
      if (m.d === 'targetID') return tx('Ținta');
      if (m.d === 'otherID') return t.categoryId === Category.Charge ? tx('Modulul în care e încărcat') : tx('Încărcătura din modul');
      if (m.d === 'itemID') return tx('Modulul însuși');
      return null;
    case 'LocationModifier': return tx('Tot ce e montat pe navă');
    case 'LocationGroupModifier': return tx('Modulele de tip {group}', { group: sde.groups.get(m.g ?? 0)?.name ?? '?' });
    case 'LocationRequiredSkillModifier': return tx('Modulele care cer {skill}', { skill: skill(m.s) });
    case 'OwnerRequiredSkillModifier': return tx('Încărcăturile și dronele care cer {skill}', { skill: skill(m.s) });
    default: return null;
  }
}

function changeValue(sde: Sde, m: RawModifier, v: number): string | null {
  const to = sde.attributes.get(m.to);
  if (!to) return null;
  const flip = INVERSE_UNITS.has(to.unitId ?? 0) ? -1 : 1;
  switch (m.op) {
    case Op.PostPercent: return v ? pct(v * flip) : null;
    case Op.PreMul:
    case Op.PostMul: return v !== 1 ? pct((v - 1) * 100 * flip) : null;
    case Op.PreDiv:
    case Op.PostDiv: return v && v !== 1 ? pct((1 / v - 1) * 100 * flip) : null;
    case Op.ModAdd: return v ? `+${formatAttribute(sde, to, v)}` : null;
    case Op.ModSub: return v ? `−${formatAttribute(sde, to, v)}` : null;
    case Op.PreAssign:
    case Op.PostAssign: return `= ${formatAttribute(sde, to, v)}`;
    default: return null;
  }
}

const attrLabel = (sde: Sde, id: number) => {
  const a = sde.attributes.get(id);
  return a?.displayName || a?.name || String(id);
};

export function itemSummaryHtml(sde: Sde, typeId: number, item?: DogmaItem): string {
  const t = sde.types.get(typeId);
  if (!t) return '';
  const value = (name: string) => {
    if (!sde.hasAttr(name)) return 0;
    const id = sde.attrId(name);
    return item ? item.attr(id) : sde.baseAttr(typeId, id);
  };
  const shown = (name: string) => {
    if (!sde.hasAttr(name)) return '';
    const a = sde.attributes.get(sde.attrId(name))!;
    return a.unitId === 124 || a.unitId === 105 ? `${num(Math.abs(value(name)))}\u00a0%` : formatAttribute(sde, a, value(name));
  };
  const effects = t.effects.map((id) => sde.effects.get(id)).filter((e): e is EffectInfo => !!e);
  const sentences: string[] = [];
  const changes: Change[] = [];
  let targeted = false;
  let penalized = false;
  const perLevel = t.categoryId === Category.Skill;

  for (const e of effects) {
    const special = SPECIAL[e.name];
    if (special) {
      const vars = Object.fromEntries(Object.entries(special.vars ?? {}).map(([k, attr]) => [k, shown(attr)]));
      if (t.categoryId !== Category.Charge || e.name === 'missileLaunching') sentences.push(tx(special.text(), vars));
      if (special.targeted) targeted = true;
      for (const [src, tgt] of special.attrs ?? []) {
        if (!sde.hasAttr(src) || !value(src)) continue;
        const target = sde.hasAttr(tgt) ? attrLabel(sde, sde.attrId(tgt)) : tgt;
        const v = value(src);
        changes.push({ who: special.who?.() ?? tx('Ținta'), attr: target, value: src === 'warpScrambleStrength' ? tx('putere {n}', { n: num(v) }) : pct(v), heat: false });
      }
      continue;
    }
    const heat = e.category === 5;
    for (const m of e.modifiers) {
      if (m.d === 'itemID' && !heat) continue;
      if (m.d === 'itemID' && t.categoryId === Category.Skill) continue;
      const to = sde.attributes.get(m.to);
      if (!to?.displayName) continue;
      const who = whoLabel(sde, t, m);
      if (!who) continue;
      const v = item ? item.attr(m.from) : sde.baseAttr(typeId, m.from);
      const text = changeValue(sde, m, v);
      if (!text) continue;
      if (m.d === 'targetID') targeted = true;
      if (t.categoryId === Category.Module && !to.stackable && m.d !== 'itemID' && [Op.PreMul, Op.PostMul, Op.PostPercent, Op.PreDiv, Op.PostDiv].includes(m.op as never)) penalized = true;
      changes.push({ who, attr: attrLabel(sde, m.to), value: perLevel ? tx('{v} pe nivel', { v: text }) : text, heat });
    }
  }

  const unique = changes.filter((c, i) => changes.findIndex((x) => x.who === c.who && x.attr === c.attr && x.value === c.value && x.heat === c.heat) === i);
  const normal = unique.filter((c) => !c.heat);
  const heat = unique.filter((c) => c.heat);
  const scripted = t.categoryId === Category.Module && sde.hasAttr('chargeGroup1') && value('chargeGroup1') > 0 && effects.some((e) => SPECIAL[e.name]?.attrs) && sde.groups.get(value('chargeGroup1'))?.name.includes('Script');
  const active = effects.some((e) => (e.category === 1 || e.category === 2) && e.name !== 'online') && t.categoryId === Category.Module;
  const cycle = active && value('duration') ? tx('Ciclu {dur}, consumă {cap} capacitor pe ciclu.', { dur: shown('duration'), cap: shown('capacitorNeed') }) : '';
  const row = (c: Change) => `<tr><td>${esc(c.who)}</td><td>${esc(c.attr)}</td><td class="r num">${esc(c.value)}</td></tr>`;
  const table = (rows: Change[]) => `<table class="table compact attrs desc-changes"><tbody>${rows.map(row).join('')}</tbody></table>`;

  return `<div class="desc-kind">${esc(kindLabel(sde, t, effects, value))}</div>
    ${sentences.length || cycle ? `<div class="desc-what">${sentences.map((s) => `<p>${esc(s)}</p>`).join('')}${cycle ? `<p class="dim">${esc(cycle)}</p>` : ''}</div>` : ''}
    ${normal.length ? `<h3 class="section-title">${tx('Ce modifică')}</h3>${table(normal)}` : ''}
    ${heat.length ? `<h3 class="section-title">${tx('La supraîncălzire')}</h3>${table(heat)}` : ''}
    ${targeted ? `<p class="desc-note">${tx('Efectul se aplică pe nava țintă, nu pe nava ta: nu schimbă statisticile, tank-ul sau DPS-ul (nici DPS-ul aplicat) fitului tău. Ca să vezi efectul, adaugă modulul în tab-ul Proiectate al fitului țintă.')}</p>` : ''}
    ${scripted ? `<p class="desc-note">${tx('Acceptă scripturi: fiecare script dublează o parte din efecte și o anulează pe cealaltă. Fără script, toate efectele merg la valoarea de bază.')}</p>` : ''}
    ${penalized ? `<p class="desc-note">${tx('Mai multe module care schimbă același atribut se penalizează între ele (penalizare de cumulare).')}</p>` : ''}`;
}
