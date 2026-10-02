import { readFile, readdir, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const extensionRoot = new URL('../extension/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', extensionRoot), 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'storage']);
assert.equal(manifest.host_permissions, undefined);
await access(new URL(manifest.background.service_worker, extensionRoot));
const popup = await readFile(new URL(manifest.action.default_popup, extensionRoot), 'utf8');
for (const [, path] of popup.matchAll(/(?:src|href)="([^"]+)"/g)) await access(new URL(path, extensionRoot));
for (const script of manifest.content_scripts) {
  assert.deepEqual(script.matches, ['https://x.com/home*']);
  for (const path of script.js) await access(new URL(path, extensionRoot));
}
const source = await readdir(new URL('src/', extensionRoot));
for (const file of ['background.js', ...source.filter(f => f.endsWith('.js')).map(f => `src/${f}`)]) {
  const result = spawnSync(process.execPath, ['--check', file], { cwd: extensionRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}
console.log('Manifest V3、文件引用、最小权限与 JavaScript 语法检查通过。');
