import { openModal, closeModal, esc, button, loader, alertBox, toast } from '../ui/components';
import { customHubs, saveCustomHubs, systemStations, allHubs } from '../services/intel';
import { tx } from '../i18n';

export function openHubModal(onChange: (hubId?: string) => void) {
  const modal = openModal(tx('Hub-uri de trade proprii'), `
    <p class="dim small">${tx('Pe lângă Amarr, Dodixie, Rens și Hek poți compara Jita cu orice stație NPC. Scrie sistemul, apoi alege stația.')}</p>
    <div class="inline-form"><input class="input plain" id="hubSystem" placeholder="${esc(tx('Sistem, de ex. Tama'))}" spellcheck="false" />${button(tx('Caută'), { cls: 'sm', attrs: 'data-hub-search' })}</div>
    <div id="hubResults"></div>
    <div id="hubMine"></div>`, { wide: true });
  const results = modal.querySelector<HTMLElement>('#hubResults')!;
  const mine = modal.querySelector<HTMLElement>('#hubMine')!;
  const input = modal.querySelector<HTMLInputElement>('#hubSystem')!;
  let found: { region: number; system: string; stations: { id: number; name: string }[] } | null = null;

  const drawMine = () => {
    const list = customHubs();
    mine.innerHTML = list.length ? `<h4 class="ct-sub">${tx('Hub-urile tale')}</h4><table class="table compact"><tbody>${list.map((h) => `<tr><td><b>${esc(h.name)}</b></td><td class="r">${button(tx('Scoate'), { iconName: 'close', cls: 'ghost sm', attrs: `data-hub-remove="${esc(h.id)}"` })}</td></tr>`).join('')}</tbody></table>` : '';
  };

  const search = async () => {
    const name = input.value.trim();
    if (!name) return;
    results.innerHTML = loader(tx('Caut stațiile'));
    try {
      found = await systemStations(name);
      results.innerHTML = `<table class="table compact"><tbody>${found.stations.map((s) => `<tr><td>${esc(s.name)}</td><td class="r">${allHubs().some((h) => h.station === s.id) ? `<span class="dim small">${tx('adăugat')}</span>` : button(tx('Adaugă'), { iconName: 'plus', cls: 'sm', attrs: `data-hub-pick="${s.id}"` })}</td></tr>`).join('')}</tbody></table>`;
    } catch (err) {
      results.innerHTML = alertBox((err as Error).message);
    }
  };

  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
  modal.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-hub-search]')) { search(); return; }
    const pick = t.closest<HTMLElement>('[data-hub-pick]');
    if (pick && found) {
      const id = Number(pick.dataset.hubPick);
      const station = found.stations.find((s) => s.id === id);
      if (!station) return;
      const others = found.stations.length > 1;
      const hub = { id: `st${id}`, name: others ? `${found.system} ${station.name.replace(found.system, '').split(' - ')[0].trim()}`.trim() : found.system, station: id, region: found.region };
      saveCustomHubs([...customHubs(), hub]);
      toast(tx('{name} adăugat la hub-uri', { name: hub.name }));
      closeModal();
      onChange(hub.id);
      return;
    }
    const rm = t.closest<HTMLElement>('[data-hub-remove]');
    if (rm) {
      saveCustomHubs(customHubs().filter((h) => h.id !== rm.dataset.hubRemove));
      drawMine();
      onChange();
    }
  });
  drawMine();
  input.focus();
}
