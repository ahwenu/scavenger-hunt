/** プラグイン配下の入力だけでUIとMCPを自己完結バンドルへ変換する。 */
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.join(root, 'dist');
await mkdir(dist, { recursive: true });
const ui = await build({
  absWorkingDir: root,
  entryPoints: ['src/ui/main.tsx'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  write: false,
  outdir: 'dist',
  define: { 'process.env.NODE_ENV': '"production"' },
});
const js = ui.outputFiles.find(file => file.path.endsWith('.js'))?.text;
const css = ui.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '';
if (!js) throw new Error('UIのJavaScriptを生成できませんでした。');
const head = '<!doctype html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>カリモノ | ホスト</title>';
const body = `<style>${css.replaceAll('</style', '<\\/style')}</style></head><body><div id="root"></div>`;
const script = `<script>${js.replaceAll('</script', '<\\/script')}</script></body></html>`;
await writeFile(path.join(dist, 'widget.html'), head + body + script);
// preview.htmlだけが開発用HTTPブリッジを有効にする。配布UIはMCPブリッジのみ。
await writeFile(path.join(dist, 'preview.html'), head + body + '<script>window.__KARIMONO_PREVIEW__=true;</script>' + script);
await build({
  absWorkingDir: root,
  entryPoints: ['src/server/stdio.ts'],
  outfile: 'dist/server.mjs',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
  sourcemap: false,
});
// 空や不完全な成果物を配布しない。
for (const name of ['server.mjs', 'widget.html']) {
  if (!(await readFile(path.join(dist, name))).length) throw new Error(`生成物が空です: ${name}`);
}
console.log('Built dist/server.mjs + widget.html (and local preview.html).');
