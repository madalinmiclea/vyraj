import { defineConfig, type HtmlTagDescriptor, type Plugin } from 'vite';
import { copyFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
    },
  };
}

export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [staticHost()],
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
});
