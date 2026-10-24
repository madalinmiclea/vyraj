const paths: Record<string, string> = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  market: '<path d="M3 20h18"/><path d="M5 16l4-5 4 3 6-8"/><path d="M15 6h4v4"/>',
  fitting: '<path d="M12 2.5 4 7v10l8 4.5 8-4.5V7z"/><path d="M12 7v10M7.5 9.5 12 12l4.5-2.5"/>',
  character: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c1-4 4-6 7-6s6 2 7 6"/>',
  skills: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H19v14H5.5A1.5 1.5 0 0 0 4 19.5z"/><path d="M4 19.5A1.5 1.5 0 0 0 5.5 21H19v-3"/><path d="M8 8h7M8 11h5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  isk: '<circle cx="12" cy="12" r="8.5"/><path d="M14.8 9.2c-.6-.9-1.6-1.4-2.8-1.4-1.7 0-2.8.9-2.8 2.1 0 2.9 5.8 1.5 5.8 4.2 0 1.2-1.2 2.1-3 2.1-1.3 0-2.4-.6-3-1.5M12 6v1.8M12 16.2V18"/>',
  jump: '<path d="M3.5 19c2-8.5 15-8.5 17 0"/><circle cx="3.5" cy="19" r="1.6"/><circle cx="20.5" cy="19" r="1.6"/><path d="M12 3.5v5M9.5 6h5"/>',
  recon: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  intel: '<path d="M4 20V12M9 20V8M14 20v-5M19 20V5"/><path d="M3 20h18"/><path d="m4 9 5-4 5 5 5-6"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
  trinity: '<path d="M12 2.8 21.5 19.6H2.5z"/><path d="M12 2.8V12M2.5 19.6 12 12M21.5 19.6 12 12"/><path d="M12 8.2 15.4 14.4H8.6z" fill="currentColor" stroke="none" opacity="0.55"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/>',
  copy: '<rect x="8" y="8" width="12" height="12"/><path d="M16 8V4H4v12h4"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v6H4V6h6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  mutate: '<path d="M7 3c0 6 10 6 10 9s-10 3-10 9M17 3c0 6-10 6-10 9s10 3 10 9"/><path d="M8.5 6.5h7M8.5 17.5h7"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v4h16v-4"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 16v4h16v-4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  power: '<path d="M12 3v8"/><path d="M6.3 6.3a8 8 0 1 0 11.4 0"/>',
  fire: '<path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 2-7 2 1 3 3 3 5"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  login: '<path d="M10 4h9v16h-9"/><path d="M3 12h11M10 8l4 4-4 4"/>',
  compare: '<path d="M4 6h10M4 12h16M4 18h7"/><path d="M17 3v6M20 15v6"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
  ship: '<path d="M12 2 7 12l-4 3 3 1 6 6 6-6 3-1-4-3z"/><path d="M12 8v8"/>',
  module: '<rect x="4" y="4" width="16" height="16"/><path d="M9 9h6v6H9z"/>',
  ammo: '<path d="M8 21V9l2-5h4l2 5v12z"/><path d="M8 14h8"/>',
  implant: '<circle cx="12" cy="12" r="8"/><path d="M12 4v4M12 16v4M4 12h4M16 12h4"/><circle cx="12" cy="12" r="2"/>',
  blueprint: '<rect x="3" y="4" width="18" height="16"/><path d="M3 9h18M8 4v16"/>',
  skill: '<path d="M12 3 21 8l-9 5-9-5z"/><path d="M6 10v5c2 2 10 2 12 0v-5"/>',
  skin: '<path d="M12 3c4 3 7 3 8 3 0 8-3 12-8 15C7 18 4 14 4 6c1 0 4 0 8-3z"/>',
  structure: '<path d="M4 20V10l8-6 8 6v10z"/><path d="M9 20v-6h6v6"/>',
  drone: '<circle cx="12" cy="12" r="3"/><circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="m7 7 3 3M17 7l-3 3M7 17l3-3M17 17l-3-3"/>',
};

export function icon(name: string, cls = ''): string {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${paths[name] || paths.module}</svg>`;
}

export const logo = `<svg class="brand-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">
  <path d="M12 2.8 21.5 19.6H2.5z"/>
  <path d="M12 2.8V12M2.5 19.6 12 12M21.5 19.6 12 12"/>
  <path d="M12 8.2 15.4 14.4H8.6z" fill="currentColor" stroke="none" opacity="0.55"/>
</svg>`;

export const reticle = `<svg class="reticle" viewBox="0 0 100 100" fill="none" stroke="currentColor" aria-hidden="true">
  <circle cx="50" cy="50" r="44" stroke-width=".8" stroke-dasharray="2 6" opacity=".6"/>
  <circle cx="50" cy="50" r="32" stroke-width="1"/>
  <path d="M50 4v14M50 82v14M4 50h14M82 50h14" stroke-width="1.4"/>
  <path d="M50 26a24 24 0 0 1 24 24" stroke-width="2.4" opacity=".9"/>
  <circle cx="50" cy="50" r="2.5" fill="currentColor"/>
</svg>`;

export const categoryIcon: Record<string, string> = {
  'Ships': 'ship',
  'Ship Equipment & Modules': 'module',
  'Ammunition & Charges': 'ammo',
  'Implants & Boosters': 'implant',
  'Blueprints & Reactions': 'blueprint',
  'Skills': 'skill',
  'Personalization & Apparel': 'skin',
  'Structures & Equipment': 'structure',
  'Drones & Fighters': 'drone',
  'Ship Equipment': 'module',
  'Ship and Module Modifications': 'module',
  'Ship SKINs': 'skin',
  'Personalization': 'skin',
  'Apparel': 'skin',
  'Special Edition Assets': 'skin',
  'Structures': 'structure',
  'Structure Equipment': 'structure',
  'Structure Modifications': 'structure',
  'Planetary Infrastructure': 'structure',
  'Drones': 'drone',
  'Manufacture & Research': 'blueprint',
};
