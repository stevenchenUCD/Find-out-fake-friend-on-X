import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { LANGUAGES } from '../extension/src/localization/index.js';

async function startPreview(t) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./preview-server.mjs', import.meta.url))], { stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    await once(child, 'exit');
  });
  return new Promise((resolve, reject) => {
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      output += chunk;
      const origin = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      if (origin) resolve(origin);
    });
    child.once('exit', code => reject(new Error(`预览服务器提前退出（${code}）：${output}`)));
  });
}

test('本地预览页能读取面板和插件窗口依赖的全部文件，其他文件仍不可读', async t => {
  const origin = await startPreview(t);
  for (const [path, type] of [['/tests/网页模拟.html', /^text\/html/], ['/tests/插件入口预览.html', /^text\/html/],
    ['/extension/src/panel.css', /^text\/css/], ['/extension/src/popup.css', /^text\/css/]]) {
    const response = await fetch(new URL(path, origin));
    assert.equal(response.status, 200, `${path} 应能读取`);
    assert.match(response.headers.get('content-type'), type, path);
  }
  // 从两个预览入口沿静态导入读取整棵模块树，任何一个模块缺失都会让预览页空白。
  const queue = ['/tests/demo.js', '/tests/入口提示模拟.js'].map(path => new URL(path, origin));
  const loaded = new Set();
  while (queue.length) {
    const url = queue.shift();
    const path = decodeURIComponent(url.pathname);
    if (loaded.has(path)) continue;
    loaded.add(path);
    const response = await fetch(url);
    assert.equal(response.status, 200, `${path} 应能读取`);
    assert.match(response.headers.get('content-type'), /^text\/javascript/, path);
    for (const [, specifier] of (await response.text()).matchAll(/(?:\bfrom|\bimport)\s*\(?\s*'(\.\.?\/[^']+\.js)'/g)) {
      queue.push(new URL(specifier, url));
    }
  }
  for (const { code } of LANGUAGES) assert.ok(loaded.has(`/extension/src/localization/${code}.js`), `应读取 ${code} 语言文件`);
  for (const path of ['/AGENTS.md', '/package.json', '/extension/manifest.json', '/tests/fixtures.js']) {
    assert.equal((await fetch(new URL(path, origin))).status, 404, `${path} 不应由预览服务器提供`);
  }
});
