import http from 'node:http';
import { readFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const types = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8' };
const server = http.createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    if (path === '/tests/插件入口预览.html') {
      const popup = await readFile(new URL('extension/popup.html', root), 'utf8');
      response.writeHead(200, { 'Content-Type': types.html, 'Cache-Control': 'no-store' });
      response.end(popup.replace('href="src/popup.css"', 'href="/extension/src/popup.css"').replace('src="src/popup-entry.js"', 'src="/tests/入口提示模拟.js"'));
      return;
    }
    if (!/^\/(?:extension\/src\/(?:[a-z-]+\.(?:js|css)|localization\/[A-Za-z-]+\.js)|tests\/(?:网页模拟\.html|demo\.js|入口提示模拟\.js))$/.test(path)) {
      response.writeHead(404); response.end('Not found'); return;
    }
    const content = await readFile(new URL(`.${path}`, root));
    response.writeHead(200, { 'Content-Type': types[path.split('.').pop()], 'Cache-Control': 'no-store' });
    response.end(content);
  } catch (error) { response.writeHead(500); response.end(error.message); }
});
server.listen(0, '127.0.0.1', () => console.log(`本地模拟页面：http://127.0.0.1:${server.address().port}/tests/网页模拟.html`));
process.on('SIGINT', () => server.close());
process.on('SIGTERM', () => server.close());
