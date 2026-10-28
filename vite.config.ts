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
      const csp = readFileSync('public/_headers', 'utf8')
        .match(/Content-Security-Policy:\s*(.+)/)?.[1]
        .replace(/;\s*frame-ancestors[^;]*/, '')
        .trim();
      const gc = (process.env.VITE_GOATCOUNTER_CODE || '').trim().toLowerCase();
      const policy = csp && /^[a-z0-9-]+$/.test(gc)
        ? csp
          .replace(/script-src ([^;]*)/, '$& https://gc.zgo.at')
          .replace(/img-src ([^;]*)/, `$& https://${gc}.goatcounter.com`)
          .replace(/connect-src ([^;]*)/, `$& https://${gc}.goatcounter.com`)
        : csp;
      const tags: HtmlTagDescriptor[] = policy ? [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' }] : [];
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
