type Row = Record<string, any>;

const LORE = /\b(designed by|developed by|modified by|manufactured by|built by|invented|originally|scientists?|researchers?|history|historically|legends?|legendary|rumou?rs?|early days|in use since|centur(y|ies)|decades?|years ago|YC ?\d+|(was|were) (first|once))\b/i;

const ENTITIES: Record<string, string> = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'" };

export function cleanDescription(raw: string): string {
    const text = raw
        .replace(/\r/g, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m] ?? m);
    return text
        .split(/\n+/)
        .map((p) => p.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .map((p) => p.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/).filter((s) => !LORE.test(s)).join(' ').trim())
        .filter(Boolean)
        .join('\n');
}

export function buildDescriptions(types: Row, groups: Row, categories: Set<number>, en: (v: any) => string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [typeId, t] of Object.entries(types)) {
        const group = groups[t.groupID];
        if (!group || !t.published || group.categoryID === 6 || !categories.has(group.categoryID)) continue;
        const text = cleanDescription(en(t.description));
        if (text) out[typeId] = text;
    }
    return out;
}
