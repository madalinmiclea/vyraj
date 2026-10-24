import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const RAW_DIR = path.join(ROOT, 'data');
const OUT_DIR = path.join(ROOT, 'public', 'data');
const NAMES = ['sde', 'items', 'skins', 'masteries', 'map'];

export function publishData() {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    for (const f of fs.readdirSync(OUT_DIR)) if (f.endsWith('.json')) fs.rmSync(path.join(OUT_DIR, f));
    const manifest = {};
    for (const name of NAMES) {
        const src = path.join(RAW_DIR, `${name}.json`);
        if (!fs.existsSync(src)) continue;
        const body = fs.readFileSync(src);
        const hash = crypto.createHash('sha256').update(body).digest('hex').slice(0, 10);
        const file = `${name}.${hash}.json`;
        fs.writeFileSync(path.join(OUT_DIR, file), body);
        manifest[name] = file;
    }
    fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest));
    return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    console.log('✅ public/data:', publishData());
}
