import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

async function background(tab, result = { status: 'opened' }, injectionError, message = { type: 'open-panel' }) {
  let listener;
  const badges = [], titles = [], injections = [], created = [];
  const chrome = {
    runtime: { onMessage: { addListener: fn => { listener = fn; } } },
    action: {
      onClicked: { addListener() {} },
      setBadgeText: async value => badges.push(value),
      setTitle: async value => titles.push(value)
    },
    tabs: { query: async () => tab ? [tab] : [], create: async options => { created.push(options); return { id: 11 }; } },
    scripting: { executeScript: async value => {
      injections.push(value);
      if (injectionError) throw new Error(injectionError);
      return [{ frameId: 0, result }];
    } }
  };
  vm.runInNewContext(await readFile(new URL('../extension/background.js', import.meta.url), 'utf8'), { chrome, console });
  assert.equal(typeof listener, 'function', '点击插件的窗口应通过后台获得页面状态');
  const response = await new Promise(resolve => {
    assert.equal(listener(message, {}, resolve), true, '异步响应必须保持消息通道');
  });
  return { response, badges, titles, injections, created };
}

test('工具栏点击始终可以打开扩展自带窗口', async () => {
  const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.action.default_popup, 'popup.html');
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'storage']);
});

for (const url of ['https://x.com/home', 'https://x.com/tester/followers', 'https://example.com/', 'chrome://newtab/', 'https://x.com.evil.test/tester/following', undefined]) {
  test(`当前页面 ${url ?? '未知'} 根据网页检查结果显示切换提示，不显示感叹号`, async () => {
    const onX = /^https:\/\/x\.com(?:\/|$)/.test(url ?? '');
    const { response, badges, injections, titles } = await background({ id: 7, url }, { status: 'needs-page', message: '请切换到自己账号的“正在关注”页面。' });
    assert.equal(response.status, 'needs-page');
    assert.match(response.message, /请切换到.*正在关注/);
    assert.equal(injections.length, onX ? 1 : 0);
    assert.ok(badges.some(value => value.tabId === 7 && value.text === ''));
    assert.ok(badges.every(value => value.text === ''));
    assert.ok(titles.every(value => value.title === '打开 Fake Friend'));
  });
}

test('正确关注页面继续打开原清理面板，不自动扫描', async () => {
  const { response, injections } = await background({ id: 7, url: 'https://x.com/tester/following?lang=zh' });
  assert.equal(response.status, 'opened');
  assert.equal(injections.length, 1);
  assert.equal(injections[0].target.tabId, 7);
});

test('页面校验失败或脚本注入失败，将具体错误送到窗口', async () => {
  const tab = { id: 7, url: 'https://x.com/other/following' };
  const ownerError = await background(tab, { status: 'error', message: '无法确认这是自己的关注列表' });
  assert.equal(ownerError.response.status, 'error');
  assert.match(ownerError.response.message, /自己的关注列表/);
  const injectionError = await background(tab, undefined, '页面无法访问');
  assert.equal(injectionError.response.status, 'error');
  assert.match(injectionError.response.message, /页面无法访问/);
  assert.ok(injectionError.badges.every(value => value.text === ''));
});

async function popup(result, failure, goToFollowing = async () => ({ status: 'navigated' })) {
  const html = await readFile(new URL('../extension/popup.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html);
  let closed = false;
  const { openPopup } = await import('../extension/src/popup.js');
  await openPopup({ document: dom.window.document, request: async () => {
    if (failure) throw new Error(failure);
    return result;
  }, goToFollowing, close: () => { closed = true; } });
  return { dom, get closed() { return closed; } };
}

test('不在关注页面时，窗口显示可点击的前往关注列表按钮', async () => {
  const { dom, closed } = await popup({ status: 'needs-page', message: '请切换到自己账号的“正在关注”页面。' });
  try {
    assert.equal(closed, false);
    assert.match(dom.window.document.querySelector('#popup-message').textContent, /请切换到.*正在关注/);
    assert.equal(dom.window.document.querySelector('#popup-help').hidden, false);
    assert.equal(dom.window.document.querySelector('#go-following').disabled, false);
    assert.equal(dom.window.document.querySelector('#go-following').textContent, '前往我的关注列表');
    assert.match(dom.window.document.querySelector('#popup-state').textContent, /已就绪/);
  } finally { dom.window.close(); }
});

test('正确页面打开清理面板后收起提示窗口', async () => {
  const { dom, closed } = await popup({ status: 'opened' });
  assert.equal(closed, true);
  dom.window.close();
});

test('真实错误直接显示在窗口，保留可读原因', async () => {
  const { dom, closed } = await popup(undefined, '后台暂时无法连接');
  try {
    assert.equal(closed, false);
    assert.match(dom.window.document.querySelector('#popup-detail').textContent, /后台暂时无法连接/);
    assert.equal(dom.window.document.querySelector('#popup-detail').hidden, false);
    assert.equal(dom.window.document.querySelector('#go-following').disabled, false);
  } finally { dom.window.close(); }
});

test('跳转请求创建通用 X 入口，不依赖当前网站或固定用户名', async () => {
  const { response, created, injections } = await background({ id: 7, url: 'https://example.com/' }, undefined, undefined, { type: 'go-to-following' });
  assert.equal(response.status, 'navigated');
  assert.equal(created.length, 1);
  assert.equal(created[0].url, 'https://x.com/home#fake-friend-following');
  assert.equal(injections.length, 0);
});

test('点击前往只发出一次跳转，成功后收起窗口', async () => {
  let calls = 0, release;
  const view = await popup({ status: 'needs-page', message: '请切换到自己的关注列表。' }, undefined,
    () => { calls++; return new Promise(resolve => { release = resolve; }); });
  try {
    const button = view.dom.window.document.querySelector('#go-following');
    button.click(); button.click();
    assert.equal(calls, 1);
    assert.equal(button.disabled, true);
    release({ status: 'navigated' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(view.closed, true);
  } finally { view.dom.window.close(); }
});

test('跳转失败时在窗口显示原因，允许用户重新点击', async () => {
  const view = await popup({ status: 'needs-page', message: '请切换页面' }, undefined,
    async () => ({ status: 'error', message: '新标签页未能打开' }));
  try {
    const button = view.dom.window.document.querySelector('#go-following');
    button.click(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(view.closed, false);
    assert.match(view.dom.window.document.querySelector('#popup-detail').textContent, /新标签页未能打开/);
    assert.equal(button.disabled, false);
  } finally { view.dom.window.close(); }
});
