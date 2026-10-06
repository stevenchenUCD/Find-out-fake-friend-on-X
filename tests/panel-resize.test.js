import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixtures.js';
import { readRows } from '../extension/src/x-page.js';
import { openPanel } from '../extension/src/panel.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await settle(); }
  throw new Error('尺寸没有到达预期状态');
}

function resizeSurface(dom) {
  const root = dom.window.document.querySelector('#fake-friend-panel').shadowRoot;
  const grip = root.getElementById('panel-resize');
  assert.ok(grip, '面板底部应有上下拖动的位置');
  const layout = root.querySelector('.panel');
  // jsdom 不绘制布局；真实像素、窗口限制和鼠标拖动另由浏览器验证。
  layout.getBoundingClientRect = () => ({ top: 18, bottom: 18 + height(), width: 376, height: height() });
  const height = () => Number.parseFloat(layout.style.height || '640');
  const captured = new Set();
  grip.setPointerCapture = id => captured.add(id);
  grip.hasPointerCapture = id => captured.has(id);
  grip.releasePointerCapture = id => captured.delete(id);
  const pointer = (type, clientY) => grip.dispatchEvent(new dom.window.PointerEvent(type,
    { pointerId: 1, isPrimary: true, button: 0, clientY, bubbles: true, cancelable: true }));
  const drag = delta => { pointer('pointerdown', 600); pointer('pointermove', 600 + delta); pointer('pointerup', 600 + delta); };
  return { root, grip, layout, height, pointer, drag, captured };
}

test('拖动结束保存高度，取消或隐藏中断拖动，重新建立面板时恢复上次高度', async () => {
  const dom = fixture([{}]);
  Object.defineProperty(dom.window.navigator, 'languages', { value: ['zh-CN'] });
  const originalAbort = globalThis.AbortController;
  globalThis.AbortController = dom.window.AbortController;
  const key = 'fake-friend/v0/tester/panel-height';
  const data = { [key]: 700 }, writes = [];
  const storage = {
    get: async name => ({ [name]: structuredClone(data[name]) }),
    set: async values => { writes.push(structuredClone(values)); Object.assign(data, structuredClone(values)); }
  };
  const adapter = { scan: () => readRows(dom.window.document, dom.window.location) };
  try {
    await openPanel({ document: dom.window.document, adapter, storage, cssURL: 'https://example.test/panel.css' });
    let surface = resizeSurface(dom);
    assert.equal(surface.height(), 700, '打开时应读取已保存的高度');
    surface.pointer('pointerdown', 600);
    surface.pointer('pointermove', 680);
    assert.equal(surface.height(), 780);
    assert.equal(writes.length, 0, '拖动期间应只改变显示尺寸');
    surface.pointer('pointerup', 680);
    await until(() => data[key] === 780);
    assert.equal(writes.length, 1);
    assert.equal(surface.captured.size, 0);
    surface.pointer('pointermove', 800);
    assert.equal(surface.height(), 780, '松开后移动鼠标不能继续改变尺寸');
    surface.pointer('pointerdown', 600);
    surface.pointer('pointermove', 400);
    surface.pointer('pointercancel', 400);
    assert.equal(surface.height(), 780);
    assert.equal(writes.length, 1, '取消拖动不能保存临时尺寸');
    surface.pointer('pointerdown', 600);
    surface.pointer('pointermove', 500);
    surface.root.getElementById('close').click();
    assert.equal(surface.height(), 780);
    assert.equal(surface.captured.size, 0, '隐藏面板应释放拖动');
    await openPanel({ document: dom.window.document, adapter, storage, cssURL: 'https://example.test/panel.css' });
    assert.equal(surface.height(), 780);
    dom.window.dispatchEvent(new dom.window.Event('pagehide'));
    await until(() => !dom.window.document.querySelector('#fake-friend-panel'));
    await settle();
    await openPanel({ document: dom.window.document, adapter, storage, cssURL: 'https://example.test/panel.css' });
    surface = resizeSurface(dom);
    assert.equal(surface.height(), 780, '新的面板实例应恢复上次保存的高度');
  } finally {
    dom.window.dispatchEvent(new dom.window.Event('pagehide'));
    await settle();
    globalThis.AbortController = originalAbort;
    dom.window.close();
  }
});

test('存储较慢时多次调整仍保存最后一次高度，箭头键也能调整', async () => {
  const dom = fixture([{}]);
  const originalAbort = globalThis.AbortController;
  globalThis.AbortController = dom.window.AbortController;
  const key = 'fake-friend/v0/tester/panel-height';
  const data = {}, saved = [];
  let release;
  const storage = {
    get: async name => ({ [name]: structuredClone(data[name]) }),
    set: async values => {
      if (saved.length === 0) await new Promise(resolve => { release = resolve; });
      saved.push(values[key]); Object.assign(data, structuredClone(values));
    }
  };
  try {
    await openPanel({ document: dom.window.document, adapter: { scan: () => readRows(dom.window.document, dom.window.location) },
      storage, cssURL: 'https://example.test/panel.css' });
    const surface = resizeSurface(dom);
    surface.drag(100);
    await until(() => release);
    surface.drag(-200);
    release();
    await until(() => data[key] === 540);
    assert.deepEqual(saved, [740, 540], '旧尺寸不能在新尺寸之后覆盖存储');
    surface.grip.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    surface.grip.dispatchEvent(new dom.window.KeyboardEvent('keyup', { key: 'ArrowDown', bubbles: true }));
    await until(() => data[key] === 560);
    assert.equal(surface.height(), 560);
  } finally {
    release?.();
    dom.window.dispatchEvent(new dom.window.Event('pagehide'));
    await settle();
    globalThis.AbortController = originalAbort;
    dom.window.close();
  }
});

test('高度保存失败时明确提示，仍可使用扫描按钮', async () => {
  const dom = fixture([{}]);
  Object.defineProperty(dom.window.navigator, 'languages', { value: ['zh-CN'] });
  const originalAbort = globalThis.AbortController;
  globalThis.AbortController = dom.window.AbortController;
  const storage = { get: async () => ({}), set: async () => { throw new Error('disk full'); } };
  try {
    await openPanel({ document: dom.window.document, adapter: { scan: () => readRows(dom.window.document, dom.window.location) },
      storage, cssURL: 'https://example.test/panel.css' });
    const surface = resizeSurface(dom);
    surface.drag(60);
    await until(() => /高度保存失败.*disk full/.test(surface.root.getElementById('status-message').textContent));
    assert.equal(surface.root.getElementById('status').dataset.error, 'true');
    assert.equal(surface.root.getElementById('scan').disabled, false);
    const language = surface.root.getElementById('language');
    language.value = 'en'; language.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.match(surface.root.getElementById('status-message').textContent, /Panel height could not be saved.*disk full/,
      '切换语言后，保存失败提示也应跟着切换');
  } finally {
    dom.window.dispatchEvent(new dom.window.Event('pagehide'));
    await settle();
    globalThis.AbortController = originalAbort;
    dom.window.close();
  }
});
