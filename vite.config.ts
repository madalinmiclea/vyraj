import { defineConfig, type HtmlTagDescriptor, type Plugin } from 'vite';
import { copyFileSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

function appVersion(): string {
  let count = 0;
  try {
    count = Number(execSync('git rev-list --count HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()) || 0;
  } catch {
    count = 0;
  }
  return `${Math.floor(count / 100) + 1}.${Math.floor(count / 10) % 10}.${count % 10}`;
}

function staticHost(): Plugin {
  let outDir = 'dist';
  return {
    name: 'static-host',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    transformIndexHtml() {
      const proxy = /^https:\/\//.test(process.env.VITE_R2Z2_URL || '') ? new URL(process.env.VITE_R2Z2_URL!).origin : '';
      const csp = readFileSync('public/_headers', 'utf8')
        .match(/Content-Security-Policy:\s*(.+)/)?.[1]
        .replace(/;\s*frame-ancestors[^;]*/, '')
        .replace(/connect-src([^;]*)/, (all) => (proxy ? `${all} ${proxy}` : all))
        .trim();
      const tags: HtmlTagDescriptor[] = csp ? [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: csp }, injectTo: 'head-prepend' }] : [];
      const callback = (process.env.VITE_EVE_CALLBACK_URL || '').trim();
      if (/^https:\/\//.test(callback)) {
        const site = new URL('.', callback).href;
        tags.push(
          { tag: 'link', attrs: { rel: 'canonical', href: site }, injectTo: 'head' },
          { tag: 'meta', attrs: { property: 'og:url', content: site }, injectTo: 'head' },
          { tag: 'meta', attrs: { property: 'og:image', content: `${site}og.png` }, injectTo: 'head' },
          { tag: 'meta', attrs: { name: 'twitter:image', content: `${site}og.png` }, injectTo: 'head' },
        );
      }
      return tags;
    },
    closeBundle() {
      copyFileSync(resolve(outDir, 'index.html'), resolve(outDir, '404.html'));
      const sw = resolve(outDir, 'sw.js');
      if (!existsSync(sw)) return;
      const list = (dir: string, test: RegExp) => (existsSync(resolve(outDir, dir)) ? readdirSync(resolve(outDir, dir)).filter((f) => test.test(f)).map((f) => `${dir}/${f}`) : []);
      const precache = [
        './',
        'index.html',
        'manifest.webmanifest',
        'favicon.svg',
        'icon-192.png',
        'apple-touch-icon.png',
        ...list('assets', /\.(js|css)$/),
        ...list('fonts', /\.woff2$/),
      ];
      const build = createHash('sha256').update(precache.join('|')).update(readFileSync(resolve(outDir, 'index.html'))).digest('hex').slice(0, 12);
      writeFileSync(sw, readFileSync(sw, 'utf8').replace("'__VYRAJ_BUILD__'", JSON.stringify(build)).replace("['__VYRAJ_PRECACHE__']", JSON.stringify(precache)));
    },
  };
}

export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [staticHost()],
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
});
