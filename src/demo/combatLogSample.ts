const QUALITY = ['Wrecks', 'Smashes', 'Penetrates', 'Hits', 'Hits', 'Glances Off', 'Grazes'];

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n: number) => String(n).padStart(2, '0');
const when = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
};

interface Pilot { name: string; corp: string; alliance: string; ship: string }

const tagged = (p: Pilot) => `<font size=12><color=0xFFFFFFFF><b>${p.ship}</b></color></font>${p.alliance ? `<font size=12><color=0xFFFFE900> [${p.alliance}]</color></font>` : ''}<font size=11> [${p.corp}]</font> <font size=11>[${p.name}] -</font>`;
const short = (p: Pilot) => `${p.name}[${p.corp}](${p.ship})`;

export function sampleCombatLog(listener: string): string {
  const r = rng(7331);
  const day = new Date();
  day.setUTCDate(day.getUTCDate() - 1);
  const base = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 19, 12, 4);
  const lines: [number, string][] = [];
  const add = (sec: number, kind: string, text: string) => lines.push([base + Math.round(sec) * 1000, `(${kind}) ${text}`]);
  const dmgOut = (sec: number, n: number, who: string, weapon: string, q: string) => add(sec, 'combat', `<color=0xff00ffff><b>${n}</b> <color=0x77ffffff><font size=10>to</font> <b><color=0xffffffff>${who}</b><font size=10><color=0x77ffffff> - ${weapon} - ${q}`);
  const dmgIn = (sec: number, n: number, who: string, weapon: string, q: string) => add(sec, 'combat', `<color=0xffcc0000><b>${n}</b> <color=0x77ffffff><font size=10>from</font> <b><color=0xffffffff>${who}</b><font size=10><color=0x77ffffff>${weapon ? ` - ${weapon}` : ''} - ${q}`);
  const pick = () => QUALITY[Math.floor(r() * QUALITY.length)];
  const qMul: Record<string, number> = { Wrecks: 2.6, Smashes: 1.35, Penetrates: 1.15, Hits: 1, 'Glances Off': 0.75, Grazes: 0.55 };

  const rat = 'Pithum Nullifier';
  add(-1260, 'None', 'Jumping from Ouelletta to Tama');
  for (let s = -1200; s < -1150; s += 4 + Math.floor(r() * 3)) {
    dmgOut(s, Math.round(1100 + r() * 500), rat, 'Scourge Heavy Assault Missile', 'Hits');
    if (r() < 0.6) dmgIn(s + 1, Math.round(60 + r() * 40), rat, '', pick());
    else add(s + 1, 'combat', `${rat} misses you completely`);
  }
  add(-1146, 'combat', `<color=0xffffffff><b>You're jammed by</b> ${rat} - ${rat}`);
  for (let s = -1144; s < -1128; s += 5) dmgOut(s, Math.round(900 + r() * 400), rat, 'Scourge Heavy Assault Missile', 'Hits');

  add(-12, 'None', 'Jumping from Nourvukaiken to Tama');
  const tackler: Pilot = { name: 'Vex Harrow', corp: 'GRIM', alliance: 'NULL-V', ship: 'Atron' };
  const neuter: Pilot = { name: 'Rook Talvane', corp: 'GRIM', alliance: 'NULL-V', ship: 'Curse' };
  const brawler: Pilot = { name: 'Ila Morrow', corp: 'GRIM', alliance: 'NULL-V', ship: 'Hurricane' };
  const scramble = (sec: number, p: Pilot) => add(sec, 'combat', `<color=0xffffffff><b>Warp scramble attempt</b> <color=0x77ffffff><font size=10>from</font> <color=0xffffffff><b>${tagged(p)}</b> <color=0x77ffffff><font size=10>to <b><color=0xffffffff></font>you!`);
  const myScram = (sec: number, p: Pilot) => add(sec, 'combat', `<color=0xffffffff><b>Warp scramble attempt</b> <color=0x77ffffff><font size=10>from</font> <color=0xffffffff><b>you</b> <color=0x77ffffff><font size=10>to <b><color=0xffffffff></font>${tagged(p)}`);
  const neut = (sec: number, n: number, p: Pilot, mod: string) => add(sec, 'combat', `<color=0xffe57f7f><b>${n} GJ</b><color=0x77ffffff><font size=10> energy neutralized </font><b><color=0xffffffff>${tagged(p)}</b><color=0x77ffffff><font size=10> - ${mod}</font>`);
  const nos = (sec: number, n: number, p: Pilot, mod: string) => add(sec, 'combat', `<color=0xffe57f7f><b>-${n} GJ</b><color=0x77ffffff><font size=10> energy drained to </font><b><color=0xffffffff>${tagged(p)}</b><color=0x77ffffff><font size=10> - ${mod}</font>`);

  scramble(2, tackler);
  for (let s = 2; s < 64; s += 2) {
    if (r() < 0.82) { const q = pick(); dmgIn(s + r(), Math.round(48 * qMul[q] * (0.9 + r() * 0.2)), short(tackler), 'Light Neutron Blaster II', q); }
    else add(s, 'combat', `${short(tackler)} misses you completely - Light Neutron Blaster II`);
    if (s % 6 === 0) scramble(s, tackler);
  }
  for (let s = 6; s < 64; s += 5) for (let d = 0; d < 2; d++) dmgIn(s + d, Math.round(18 + r() * 12), short(tackler), 'Hobgoblin II', pick());

  myScram(5, tackler);
  for (let s = 6; s < 58; s += 5) {
    if (r() < 0.15) add(s, 'combat', `Your Scourge Rage Heavy Assault Missile misses ${short(tackler)} completely - Scourge Rage Heavy Assault Missile`);
    else dmgOut(s, Math.round(780 + r() * 260), short(tackler), 'Scourge Rage Heavy Assault Missile', 'Hits');
  }
  for (let s = 9; s < 58; s += 4) for (let d = 0; d < 4; d++) {
    if (r() < 0.3) add(s, 'combat', `Your Hobgoblin II misses ${short(tackler)} completely - Hobgoblin II`);
    else dmgOut(s, Math.round(10 + r() * 14), short(tackler), 'Hobgoblin II', pick());
  }

  for (let s = 21; s < 170; s += 12) { neut(s, 180, neuter, 'Medium Infectious Scoped Energy Neutralizer'); neut(s, 180, neuter, 'Medium Infectious Scoped Energy Neutralizer'); }
  for (let s = 23; s < 170; s += 6) nos(s, Math.round(18 + r() * 14), neuter, 'Medium Energy Nosferatu II');
  for (let s = 30; s < 170; s += 5) for (let d = 0; d < 3; d++) dmgIn(s + d, Math.round(40 + r() * 30), short(neuter), 'Hammerhead II', pick());

  for (let s = 27; s < 172; s += 3.5) {
    if (r() < 0.12) { add(s, 'combat', `${short(brawler)} misses you completely - 425mm AutoCannon II`); continue; }
    const q = pick();
    dmgIn(s, Math.round(330 * qMul[q] * (0.9 + r() * 0.2) * (s > 120 ? 1.15 : 1)), short(brawler), '425mm AutoCannon II', q);
  }
  myScram(62, brawler);
  for (let s = 62; s < 168; s += 5) {
    if (s >= 92 && s < 104) continue;
    if (r() < 0.08) add(s, 'combat', `Your Scourge Rage Heavy Assault Missile misses ${short(brawler)} completely - Scourge Rage Heavy Assault Missile`);
    else dmgOut(s, Math.round(820 + r() * 280), short(brawler), 'Scourge Rage Heavy Assault Missile', 'Hits');
  }
  for (let s = 64; s < 150; s += 4) for (let d = 0; d < 4; d++) dmgOut(s, Math.round(12 + r() * 16), short(brawler), 'Hobgoblin II', pick());
  add(89, 'notify', 'Heavy Assault Missile Launcher II has run out of charges');
  add(90, 'notify', 'Loading the Scourge Rage Heavy Assault Missile into the Heavy Assault Missile Launcher II; this will take approximately 10 seconds.');

  lines.sort((a, b) => a[0] - b[0]);
  const head = `------------------------------------------------------------\n  Gamelog\n  Listener: ${listener}\n  Session Started: ${when(base - 1300 * 1000)}\n------------------------------------------------------------\n`;
  return head + lines.map(([t, s]) => `[ ${when(t)} ] ${s}`).join('\n') + '\n';
}

export function recordedCombatLog(listener: string, recorded: string, hour = 21): string {
  const day = new Date();
  day.setUTCDate(day.getUTCDate() - 1);
  const base = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, 5, 30);
  const body = recorded.trim().split('\n').map((l) => {
    const [off, channel, ...rest] = l.split('|');
    return `[ ${when(base + Number(off) * 1000)} ] (${channel}) ${rest.join('|')}`;
  });
  return `------------------------------------------------------------\n  Gamelog\n  Listener: ${listener}\n  Session Started: ${when(base - 600 * 1000)}\n------------------------------------------------------------\n${body.join('\n')}\n`;
}
