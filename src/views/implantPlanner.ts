import type { Sde } from '../data/sde';
import type { Character } from '../character/characters';
import { planRows, type PlanEntry } from '../character/skillPlan';
import { formatDuration, type Attributes } from '../character/training';
import { fetchPrices, typeIconUrl } from '../services/market';
import { panel, loader, esc, compactISK, formatNum, copyText } from '../ui/components';
import { icon } from '../ui/icons';
import { exportMultibuy } from '../io/eft';
import { tx } from '../i18n';

const BONUS: [keyof Attributes, string][] = [['perception', 'perceptionBonus'], ['memory', 'memoryBonus'], ['willpower', 'willpowerBonus'], ['intelligence', 'intelligenceBonus'], ['charisma', 'charismaBonus']];
const DAY = 86_400_000;

interface Candidate { id: number; slot: number; attr: keyof Attributes; bonus: number }
interface Accelerator { id: number; bonus: number; ms: number }

let pool: { implants: Candidate[]; accelerators: Accelerator[] } | null = null;

function candidates(sde: Sde) {
  if (pool) return pool;
  const slotAttr = sde.attrId('implantness');
  const boosterAttr = sde.attrId('boosterness');
  const durAttr = sde.attrId('boosterDuration');
  const expAttr = sde.hasAttr('boosterLastInjectionDatetime') ? sde.attrId('boosterLastInjectionDatetime') : 0;
  const ids = BONUS.map(([k, n]) => [k, sde.attrId(n)] as const);
  const implants: Candidate[] = [];
  const accelerators: Accelerator[] = [];
  const today = Date.now() / DAY;
  for (const t of sde.types.values()) {
    if (!t.marketGroupId) continue;
    const bonuses = ids.map(([k, a]) => [k, t.attrs.get(a) ?? 0] as const).filter(([, v]) => v > 0);
    if (!bonuses.length) continue;
    const slot = t.attrs.get(slotAttr) ?? 0;
    if (slot >= 1 && slot <= 5 && bonuses.length === 1) implants.push({ id: t.id, slot, attr: bonuses[0][0], bonus: bonuses[0][1] });
    else if (t.attrs.get(boosterAttr) && bonuses.length === 5) {
      const exp = expAttr ? t.attrs.get(expAttr) ?? 0 : 0;
      if (exp && exp < today) continue;
      accelerators.push({ id: t.id, bonus: bonuses[0][1], ms: t.attrs.get(durAttr) ?? DAY });
    }
  }
  pool = { implants, accelerators };
  return pool;
}

export async function renderImplantPlanner(el: HTMLElement, sde: Sde, character: Character, plan: PlanEntry[]) {
  const seconds = (implants: number[]) => planRows(sde, plan, { ...character, implants }).reduce((a, r) => a + r.seconds, 0);
  const base = seconds(character.implants);
  if (base <= 0 || character.kind === 'all5' || character.kind === 'all0') { el.innerHTML = ''; return; }
  el.innerHTML = panel({ title: tx('Implanturi și acceleratoare pentru plan'), body: loader(tx('Prețuri {name}', { name: 'Jita' })) });
  const { implants, accelerators } = candidates(sde);
  const prices = await fetchPrices([...implants.map((c) => c.id), ...accelerators.map((a) => a.id)]).catch(() => null);
  if (!el.isConnected) return;
  const cost = (id: number) => prices?.get(id)?.sellMin ?? 0;
  const slotOf = (id: number) => implants.find((c) => c.id === id)?.slot ?? sde.baseAttr(id, sde.attrId('implantness'));
  const current = new Map<number, number>();
  for (const id of character.implants) current.set(slotOf(id), id);
  const bonusOf = (id: number | undefined) => (id ? BONUS.reduce((a, [, n]) => a + sde.baseAttr(id, sde.attrId(n)), 0) : 0);
  const tiers = [...new Set(implants.map((c) => c.bonus))].sort((a, b) => a - b);
  const rows: { label: string; buy: number[]; saved: number; isk: number }[] = [];
  for (const tier of tiers) {
    const buy: number[] = [];
    let set = [...character.implants];
    for (let slot = 1; slot <= 5; slot++) {
      if (bonusOf(current.get(slot)) >= tier) continue;
      const best = implants.filter((c) => c.slot === slot && c.bonus === tier && cost(c.id) > 0).sort((a, b) => cost(a.id) - cost(b.id))[0];
      if (!best) continue;
      const trial = [...set.filter((id) => slotOf(id) !== slot), best.id];
      if (seconds(trial) < seconds(set) - 60) { set = trial; buy.push(best.id); }
    }
    if (!buy.length) continue;
    rows.push({ label: tx('Set +{n}', { n: tier }), buy, saved: base - seconds(set), isk: buy.reduce((a, id) => a + cost(id), 0) });
  }
  const accRows = accelerators.filter((a) => cost(a.id) > 0).map((a) => {
    const boosted = seconds([...character.implants, a.id]);
    const d = a.ms / 1000;
    const saved = boosted <= d ? base - boosted : d * (base / boosted - 1);
    return { a, saved, isk: cost(a.id) };
  }).filter((r) => r.saved > 60).sort((x, y) => x.isk / x.saved - y.isk / y.saved);
  const perDay = (isk: number, saved: number) => (saved > 0 ? compactISK(isk / (saved / 86400)) : '—');
  const name = (id: number) => sde.types.get(id)?.name ?? String(id);
  el.innerHTML = panel({
    title: tx('Implanturi și acceleratoare pentru plan'),
    count: formatDuration(base),
    body: `${rows.length ? `<table class="table compact"><thead><tr><th>${tx('Implanturi')}</th><th class="r">${tx('Timp câștigat')}</th><th class="r">${tx('Cost Jita')}</th><th class="r">${tx('ISK / zi câștigată')}</th><th></th></tr></thead><tbody>
        ${rows.map((r, i) => `<tr><td><b>${esc(r.label)}</b><div class="dim small">${r.buy.map((id) => esc(name(id))).join(', ')}</div></td>
          <td class="r num pos">−${formatDuration(r.saved)}</td><td class="r num">${compactISK(r.isk)}</td><td class="r num">${perDay(r.isk, r.saved)}</td>
          <td class="r"><button class="icon-btn" data-impl-copy="${i}" title="${tx('Copiază Multibuy')}">${icon('copy')}</button></td></tr>`).join('')}
      </tbody></table>` : `<p class="dim small">${tx('Implanturile de acum sunt deja cele mai bune pentru plan.')}</p>`}
      ${accRows.length ? `<table class="table compact"><thead><tr><th>${tx('Accelerator cerebral')}</th><th class="r">${tx('Timp câștigat')}</th><th class="r">${tx('Cost Jita')}</th><th class="r">${tx('ISK / zi câștigată')}</th></tr></thead><tbody>
        ${accRows.map((r) => `<tr><td><span class="nav-ship-name"><img class="row-icon" src="${typeIconUrl(r.a.id, 32)}" alt="" />${esc(name(r.a.id))}</span><div class="dim small">+${r.a.bonus} · ${formatNum(r.a.ms / DAY, r.a.ms % DAY ? 1 : 0)} ${tx('zile')}</div></td>
          <td class="r num pos">−${formatDuration(r.saved)}</td><td class="r num">${compactISK(r.isk)}</td><td class="r num">${perDay(r.isk, r.saved)}</td></tr>`).join('')}
      </tbody></table>` : ''}`,
  });
  el.querySelectorAll<HTMLElement>('[data-impl-copy]').forEach((b) => b.addEventListener('click', () => {
    const r = rows[Number(b.dataset.implCopy)];
    copyText(exportMultibuy(sde, new Map(r.buy.map((id) => [id, 1]))), tx('Lista Multibuy copiată'));
  }));
}
