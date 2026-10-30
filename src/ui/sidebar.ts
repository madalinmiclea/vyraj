import { icon, categoryIcon } from './icons';
import { esc, formatInt, lore } from './components';
import type { EveItem, MarketGroups } from '../data/items';
import { fold } from './fold';
import { tx, lang } from '../i18n';

interface Entry { n: string; t?: number; l: string }

interface TreeNode {
  key: string;
  name: string;
  children: TreeNode[];
  items: Entry[];
  total: number;
}

export interface BrowserScope {
  label: string;
  ids: Set<number>;
}

export interface ItemBrowser {
  filter(q: string): void;
  select(name: string): void;
  onCount(fn: (n: number) => void): void;
  setCategories(cats: string[] | null): void;
  setListed(ids: Set<number>): void;
  setScope(scope: BrowserScope | null): void;
  setData(items: EveItem[], groups: MarketGroups): void;
}

const PAGE = 150;

const CATEGORY_RO: Record<string, string> = {
  'Ships': 'Nave', 'Ship Equipment': 'Echipament navă', 'Ship and Module Modifications': 'Modificări navă și module', 'Ammunition & Charges': 'Muniție și încărcături',
  'Drones': 'Drone', 'Implants & Boosters': 'Implanturi și boostere', 'Skills': 'Skill-uri', 'Ship SKINs': 'SKIN-uri nave', 'Blueprints & Reactions': 'Blueprint-uri și reacții',
  'Manufacture & Research': 'Fabricație și cercetare', 'Personalization': 'Personalizare', 'Apparel': 'Îmbrăcăminte', 'Trade Goods': 'Mărfuri',
  'Special Edition Assets': 'Obiecte de ediție specială', 'Structures': 'Structuri', 'Structure Modifications': 'Modificări structuri', 'Structure Equipment': 'Echipament structuri',
  "Pilot's Services": 'Servicii pentru piloți', 'Planetary Infrastructure': 'Infrastructură planetară',
};

const categoryLabel = (name: string) => (lang === 'ro' ? CATEGORY_RO[name] ?? name : name);

function buildTree(items: EveItem[], groups: MarketGroups): TreeNode[] {
  const roots = new Map<string, TreeNode>();
  const nodes = new Map<string, TreeNode>();
  const pathCache = new Map<number, number[]>();
  const pathOf = (id: number) => {
    let path = pathCache.get(id);
    if (path) return path;
    path = [];
    for (let g = id; g && groups[g]; g = groups[g][1]) path.unshift(g);
    path.shift();
    pathCache.set(id, path);
    return path;
  };
  for (const it of items) {
    let node: TreeNode | undefined = roots.get(it.c);
    if (!node) { node = { key: it.c, name: it.c, children: [], items: [], total: 0 }; roots.set(it.c, node); }
    node.total++;
    for (const g of it.m ? pathOf(it.m) : []) {
      const key: string = `${node.key}/${g}`;
      let child = nodes.get(key);
      if (!child) { child = { key, name: groups[g][0], children: [], items: [], total: 0 }; nodes.set(key, child); node.children.push(child); }
      child.total++;
      node = child;
    }
    node.items.push({ n: it.n, t: it.t, l: fold(it.n) });
  }
  const sortNode = (n: TreeNode) => { n.children.sort((a, b) => a.name.localeCompare(b.name)); n.children.forEach(sortNode); };
  const list = [...roots.values()];
  list.forEach(sortNode);
  return list.sort((a, b) => (a.name === 'Ships' ? -1 : b.name === 'Ships' ? 1 : a.name.localeCompare(b.name)));
}

function prune(node: TreeNode, keep: (e: Entry) => boolean): TreeNode | null {
  const children = node.children.map((c) => prune(c, keep)).filter((c): c is TreeNode => c !== null);
  const items = node.items.filter(keep);
  const total = items.length + children.reduce((a, c) => a + c.total, 0);
  return total ? { ...node, children, items, total } : null;
}

function flatten(node: TreeNode, out: Entry[] = []): Entry[] {
  out.push(...node.items);
  node.children.forEach((c) => flatten(c, out));
  return out;
}

export function createItemBrowser(container: HTMLElement, { onSelect, onInfo, onScopeClear }: { onSelect: (name: string, typeId: number | null) => void; onInfo?: (typeId: number) => void; onScopeClear?: () => void }): ItemBrowser {
  let tree: TreeNode[] | null = null;

  let query = '';
  let selected = '';
  let only: string[] | null = null;
  let listed: Set<number> | null = null;
  let scope: BrowserScope | null = null;
  const unlisted = (t?: number) => listed != null && t != null && !listed.has(t);
  const openKeys = new Set<string>();

  function highlight(name: string) {
    if (!query) return esc(name);
    const i = fold(name).indexOf(query);
    if (i < 0) return esc(name);
    return esc(name.slice(0, i)) + '<mark>' + esc(name.slice(i, i + query.length)) + '</mark>' + esc(name.slice(i + query.length));
  }

  function renderItems(list: Entry[], target: HTMLElement, from: number) {
    target.querySelector(':scope > .tree-more')?.remove();
    const frag = document.createDocumentFragment();
    const end = Math.min(from + PAGE, list.length);
    for (let i = from; i < end; i++) {
      const btn = document.createElement('button');
      btn.className = 'tree-item' + (list[i].n === selected ? ' selected' : '') + (unlisted(list[i].t) ? ' unlisted' : '');
      btn.dataset.name = list[i].n;
      if (list[i].t) btn.dataset.type = String(list[i].t);
      btn.title = unlisted(list[i].t) ? `${list[i].n} · ${tx('fără ordine în Jita acum')}` : list[i].n;
      btn.innerHTML = highlight(list[i].n);
      frag.appendChild(btn);
    }
    if (end < list.length) {
      const more = document.createElement('button');
      more.className = 'tree-more';
      more.textContent = tx('+ Arată încă {n} din {rest}', { n: formatInt(Math.min(PAGE, list.length - end)), rest: formatInt(list.length - end) });
      more.onclick = (e) => { e.stopPropagation(); renderItems(list, target, end); };
      frag.appendChild(more);
    }
    target.appendChild(frag);
  }

  function groupEl(node: TreeNode, depth: number, flat: Entry[] | null, autoOpen: boolean) {
    const group = document.createElement('div');
    group.className = 'tree-group' + (depth ? ' sub' : '');
    group.style.setProperty('--depth', String(depth));
    const iconName = depth ? '' : icon(categoryIcon[node.name] || 'module', 'cat-icon');
    group.innerHTML = `<button class="tree-head">${icon('chevron', 'chev')}${iconName}<span>${esc(depth ? node.name : categoryLabel(node.name))}</span><span class="count">${formatInt(flat ? flat.length : node.total)}</span></button><div class="tree-items"></div>`;
    const itemsEl = group.lastElementChild as HTMLElement;
    const open = () => {
      group.classList.add('open');
      if (itemsEl.childElementCount) return;
      if (flat) { renderItems(flat, itemsEl, 0); return; }
      const single = node.children.length === 1 && !node.items.length;
      for (const child of node.children) itemsEl.appendChild(groupEl(child, depth + 1, null, single));
      if (node.items.length) renderItems(node.items, itemsEl, 0);
    };
    (group.firstElementChild as HTMLElement).onclick = () => {
      if (group.classList.toggle('open')) { openKeys.add(node.key); open(); } else openKeys.delete(node.key);
    };
    if (autoOpen || openKeys.has(node.key)) open();
    return group;
  }

  function render() {
    if (!tree) { container.innerHTML = `<div class="tree-empty">${lore(tx('Se încarcă itemele…'), 'Weaving the Flow…')}</div>`; return; }
    container.innerHTML = '';
    let total = 0;
    if (scope) {
      const head = document.createElement('div');
      head.className = 'tree-scope';
      head.innerHTML = `<span>${esc(scope.label)}</span><button class="tree-scope-clear" title="${tx('Arată tot browserul')}">${icon('close')}</button>`;
      (head.lastElementChild as HTMLElement).onclick = () => { scope = null; render(); onScopeClear?.(); };
      container.appendChild(head);
    }
    const ids = scope?.ids;
    const roots = tree
      .filter((r) => !only || only.includes(r.name))
      .map((r) => (ids ? prune(r, (e) => e.t != null && ids.has(e.t)) : r))
      .filter((r): r is TreeNode => r !== null);
    if (query) {
      const rank = (x: Entry) => (x.l === query ? 0 : x.l.startsWith(query) ? 1 : 2);
      const hits = roots
        .map((root) => ({ root, flat: flatten(root).filter((x) => x.l.includes(query)).sort((a, b) => rank(a) - rank(b) || a.n.localeCompare(b.n)) }))
        .filter((h) => h.flat.length)
        .sort((a, b) => rank(a.flat[0]) - rank(b.flat[0]));
      for (const { root, flat } of hits) {
        total += flat.length;
        container.appendChild(groupEl(root, 0, flat, true));
      }
    } else {
      for (const root of roots) {
        total += root.total;
        container.appendChild(groupEl(root, 0, null, !!scope && roots.length === 1));
      }
    }
    if (!container.querySelector('.tree-group')) container.insertAdjacentHTML('beforeend', `<div class="tree-empty">${query ? tx('Niciun item nu conține „{q}”.', { q: esc(query) }) : ''}</div>`);
    onCount?.(total);
  }

  container.addEventListener('contextmenu', (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('.tree-item');
    if (!item || !onInfo || !item.dataset.type) return;
    e.preventDefault();
    onInfo(Number(item.dataset.type));
  });

  container.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('.tree-item');
    if (!item) return;
    select(item.dataset.name!);
    onSelect(item.dataset.name!, Number(item.dataset.type) || null);
  });

  function select(name: string) {
    selected = name;
    container.querySelectorAll('.tree-item.selected').forEach((el) => el.classList.remove('selected'));
    container.querySelectorAll<HTMLElement>('.tree-item').forEach((el) => { if (el.dataset.name === name) el.classList.add('selected'); });
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  function filter(q: string) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const next = fold(q.trim());
      if (next === query) return;
      query = next;
      render();
    }, 120);
  }

  let onCount: ((n: number) => void) | undefined;
  render();
  return {
    filter,
    select,
    onCount: (fn) => { onCount = fn; },
    setListed(ids) {
      listed = ids;
      container.querySelectorAll<HTMLElement>('.tree-item').forEach((el) => {
        const off = unlisted(Number(el.dataset.type) || undefined);
        el.classList.toggle('unlisted', off);
        el.title = off ? `${el.dataset.name} · ${tx('fără ordine în Jita acum')}` : el.dataset.name!;
      });
    },
    setData(items, groups) {
      tree = buildTree(items, groups);
      render();
    },
    setScope(next) {
      if (!next && !scope) return;
      scope = next;
      render();
      container.scrollTop = 0;
    },
    setCategories(cats) {
      if (JSON.stringify(cats) === JSON.stringify(only)) return;
      only = cats;
      render();
    },
  };
}
