import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';

const immediate = async () => {};

function page(href = null, virtualConsole) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://x.com/home#fake-friend-following', virtualConsole });
  if (href) {
    const link = dom.window.document.createElement('a');
    link.dataset.testid = 'AppTabBar_Profile_Link'; link.href = href;
    dom.window.document.body.append(link);
  }
  return dom;
}

function siteRouter(dom, handle, { delayed = false } = {}) {
  const clicks = [];
  const document = dom.window.document;
  const primary = document.createElement('main'); primary.dataset.testid = 'primaryColumn'; document.body.append(primary);
  const followingURL = `https://x.com/${handle.toLowerCase()}/following`;
  document.addEventListener('click', event => {
    const link = event.target.closest('a');
    if (!link) return;
    event.preventDefault();
    if (link.dataset.testid === 'AppTabBar_Profile_Link') {
      clicks.push('profile');
      dom.window.history.pushState({}, '', link.href);
      const showFollowing = () => { primary.innerHTML = `<a href="${followingURL}">12 正在关注</a>`; };
      if (delayed) queueMicrotask(showFollowing); else showFollowing();
    } else if (link.href === followingURL) {
      clicks.push('following');
      dom.window.history.pushState({}, '', followingURL);
      primary.innerHTML = '<section role="region"><h1>正在关注</h1></section>';
    }
  });
  return { clicks, followingURL };
}

test('通过 X 已有个人资料与关注列表链接切换，不触发第二次整页导航', async () => {
  const { navigateToOwnFollowing } = await import('../extension/src/following-navigation.js');
  const errors = [], virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error.message));
  const dom = page('/Alice_Study', virtualConsole);
  const router = siteRouter(dom, 'Alice_Study');
  try {
    await navigateToOwnFollowing({ document: dom.window.document, timeoutMs: 100, wait: immediate });
    assert.deepEqual(errors, [], '不能调用 location.replace 等整页导航');
    assert.deepEqual(router.clicks, ['profile', 'following']);
    assert.equal(dom.window.location.href, router.followingURL);
  } finally { dom.window.close(); }
});

test('个人资料已打开但关注列表链接稍后出现时，等待该链接后再切换', async () => {
  const { navigateToOwnFollowing } = await import('../extension/src/following-navigation.js');
  const dom = page('/BobQuant', new VirtualConsole());
  const router = siteRouter(dom, 'BobQuant', { delayed: true });
  try {
    await navigateToOwnFollowing({ document: dom.window.document, timeoutMs: 100, wait: immediate });
    assert.deepEqual(router.clicks, ['profile', 'following']);
    assert.equal(dom.window.location.href, router.followingURL);
  } finally { dom.window.close(); }
});

test('主页到个人资料保留短等待，关注列表入口就绪后立即点击', async () => {
  const { navigateToOwnFollowing } = await import('../extension/src/following-navigation.js');
  const dom = page('/Alice_Study');
  const router = siteRouter(dom, 'Alice_Study');
  const waits = [], samples = [0];
  try {
    await navigateToOwnFollowing({ document: dom.window.document, timeoutMs: 100,
      random: () => samples.shift(),
      wait: async ms => waits.push({ ms, path: dom.window.location.pathname, clicks: [...router.clicks] }) });
    assert.deepEqual(waits, [
      { ms: 1500, path: '/home', clicks: [] }
    ]);
    assert.deepEqual(router.clicks, ['profile', 'following']);
  } finally { dom.window.close(); }
});

test('等待期间用户通过站内切换离开时，取消后续跳转', async () => {
  const { navigateToOwnFollowing } = await import('../extension/src/following-navigation.js');
  const dom = page('/Alice_Study');
  const router = siteRouter(dom, 'Alice_Study');
  const waits = [];
  try {
    const result = await navigateToOwnFollowing({ document: dom.window.document, timeoutMs: 100,
      wait: async ms => { waits.push(ms); dom.window.history.pushState({}, '', '/notifications'); } });
    assert.equal(result.status, 'cancelled');
    assert.equal(waits.length, 1);
    assert.deepEqual(router.clicks, []);
    assert.equal(dom.window.location.pathname, '/notifications');
  } finally { dom.window.close(); }
});

test('自动识别脚本只声明在 X 主页运行，不新增其他网站访问范围', async () => {
  const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.content_scripts?.[0].matches, ['https://x.com/home*']);
  assert.deepEqual(manifest.content_scripts[0].js, ['src/following-navigation-entry.js']);
  assert.equal(manifest.content_scripts[0].run_at, 'document_idle');
});

for (const handle of ['Alice_Study', 'BobQuant']) {
  test(`从当前个人资料入口生成 ${handle} 的关注列表地址`, async () => {
    const { navigateToOwnFollowing } = await import('../extension/src/following-navigation.js');
    const dom = page(`/${handle}`);
    const router = siteRouter(dom, handle);
    try {
      const result = await navigateToOwnFollowing({ document: dom.window.document, wait: immediate });
      assert.equal(result.url, `https://x.com/${handle.toLowerCase()}/following`);
      assert.deepEqual(router.clicks, ['profile', 'following']);
    } finally { dom.window.close(); }
  });
}

test('个人资料入口延迟加载时等待 DOM，出现后只跳转一次', async () => {
  const { navigateToOwnFollowing } = await import('../extension/src/following-navigation.js');
  const dom = page();
  const router = siteRouter(dom, 'CarolAI');
  try {
    const task = navigateToOwnFollowing({ document: dom.window.document, timeoutMs: 100, wait: immediate });
    dom.window.document.body.insertAdjacentHTML('beforeend', '<a data-testid="AppTabBar_Profile_Link" href="/CarolAI">个人资料</a>');
    await task;
    assert.deepEqual(router.clicks, ['profile', 'following']);
    assert.equal(dom.window.location.href, 'https://x.com/carolai/following');
  } finally { dom.window.close(); }
});

test('无登录账号入口时明确报错，不猜测用户名', async () => {
  const { navigateToOwnFollowing } = await import('../extension/src/following-navigation.js');
  const dom = page();
  const router = siteRouter(dom, 'UnusedAccount');
  try {
    await assert.rejects(navigateToOwnFollowing({ document: dom.window.document, timeoutMs: 10 }), /登录.*个人资料/);
    assert.deepEqual(router.clicks, []);
  } finally { dom.window.close(); }
});

test('用户离开等待页面时取消识别，不在离开后继续跳转', async () => {
  const { navigateToOwnFollowing } = await import('../extension/src/following-navigation.js');
  const dom = page();
  const router = siteRouter(dom, 'UnusedAccount');
  try {
    const task = navigateToOwnFollowing({ document: dom.window.document });
    dom.window.dispatchEvent(new dom.window.Event('pagehide'));
    assert.equal((await task).status, 'cancelled');
    assert.deepEqual(router.clicks, []);
  } finally { dom.window.close(); }
});

test('拒绝个人资料入口中的外站地址', async () => {
  const { navigateToOwnFollowing } = await import('../extension/src/following-navigation.js');
  const dom = page('https://example.com/Alice');
  const router = siteRouter(dom, 'Alice');
  try {
    await assert.rejects(navigateToOwnFollowing({ document: dom.window.document }), /个人资料入口/);
    assert.deepEqual(router.clicks, []);
  } finally { dom.window.close(); }
});
