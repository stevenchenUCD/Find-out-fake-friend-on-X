import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixtures.js';
import { readRows } from '../extension/src/x-page.js';
import { openPanel } from '../extension/src/panel.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await settle(); }
  throw new Error('界面没有到达预期状态');
}

test('执行准备期间点击停止，存储返回后也不能重新开始取关', async () => {
  const dom = fixture([{}]);
  const originalAbort = globalThis.AbortController;
  globalThis.AbortController = dom.window.AbortController;
  let blockNextSave = false, releaseSave, removed = 0;
  const data = {};
  const storage = {
    get: async key => key === null ? structuredClone(data) : { [key]: structuredClone(data[key]) },
    set: async values => {
      if (blockNextSave) { blockNextSave = false; await new Promise(resolve => { releaseSave = resolve; }); }
      Object.assign(data, structuredClone(values));
    }
  };
  const adapter = {
    scan: () => readRows(dom.window.document, dom.window.location),
    resetPosition: () => {}, scroll: () => false,
    locate: async row => readRows(dom.window.document, dom.window.location).rows.find(r => r.id === row.id),
    unfollow: async () => { removed++; return { status: 'removed' }; }
  };
  try {
    await openPanel({ document: dom.window.document, adapter, storage, cssURL: 'https://example.test/panel.css' });
    const root = dom.window.document.querySelector('#fake-friend-panel').shadowRoot;
    const button = id => root.getElementById(id);
    button('scan').click();
    await until(() => !button('review-start').disabled);
    button('review-start').click();
    await until(() => !button('approve').disabled);
    button('approve').click();
    await until(() => !button('execute').hidden);
    assert.match(button('records').textContent, /已确认/);
    assert.equal(button('candidates').textContent, '0');
    blockNextSave = true;
    button('execute').click();
    await until(() => releaseSave);
    button('stop').click();
    releaseSave();
    await until(() => !button('scan').disabled);
    await settle();
    assert.equal(removed, 0);
  } finally {
    releaseSave?.();
    dom.window.dispatchEvent(new dom.window.Event('pagehide'));
    await settle();
    globalThis.AbortController = originalAbort;
    dom.window.close();
  }
});

test('暂停保留倒计时，隐藏后复用原面板，卸载网页时清理计时', async t => {
  const dom = fixture([{}]);
  const originalAbort = globalThis.AbortController;
  globalThis.AbortController = dom.window.AbortController;
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000000 });
  t.mock.method(Math, 'random', () => 0.8);
  const data = {};
  const storage = {
    get: async key => ({ [key]: structuredClone(data[key]) }),
    set: async values => Object.assign(data, structuredClone(values))
  };
  let scans = 0;
  const adapter = {
    scan: () => { scans++; return readRows(dom.window.document, dom.window.location); },
    resetPosition: () => {}, scroll: () => true
  };
  try {
    await openPanel({ document: dom.window.document, adapter, storage, cssURL: 'https://example.test/panel.css' });
    const root = dom.window.document.querySelector('#fake-friend-panel').shadowRoot;
    const field = id => root.getElementById(id);
    field('scan').click();
    await until(() => /下一轮 9 秒后/.test(field('status').textContent));
    const countdown = field('countdown');
    assert.ok(countdown, '等待提示前应有倒计时');
    assert.equal(countdown.hidden, false);
    assert.equal(field('status').firstElementChild, countdown);
    assert.equal(countdown.getAttribute('role'), 'timer');
    assert.equal(countdown.getAttribute('aria-live'), 'off');
    assert.match(countdown.textContent, /9 秒/);
    const scansAtWait = scans;
    t.mock.timers.tick(1000);
    assert.match(countdown.textContent, /8 秒/);
    t.mock.timers.tick(5000);
    assert.match(countdown.textContent, /3 秒/, '延迟唤醒时按真实截止时间计算');
    assert.equal(scans, scansAtWait, '倒计时更新不能触发扫描');
    field('pause').click();
    await until(() => !field('resume').disabled);
    assert.equal(countdown.hidden, true);
    t.mock.timers.tick(1000);
    field('resume').click();
    await until(() => !countdown.hidden);
    assert.match(countdown.textContent, /2 秒/, '继续后不重置随机间隔');
    t.mock.timers.tick(1000);
    assert.match(countdown.textContent, /1 秒/);
    field('stop').click();
    await until(() => !field('scan').disabled);
    assert.equal(countdown.hidden, true);
    const stoppedText = field('status').textContent;
    t.mock.timers.tick(20000);
    assert.equal(field('status').textContent, stoppedText);
    assert.equal(scans, scansAtWait);
    field('scan').click();
    await until(() => !countdown.hidden);
    const host = dom.window.document.querySelector('#fake-friend-panel');
    field('close').click();
    assert.equal(host.hidden, true);
    assert.equal(countdown.hidden, false, '隐藏面板保留运行中的倒计时');
    await openPanel({ document: dom.window.document, adapter, storage, cssURL: 'https://example.test/panel.css' });
    assert.equal(host.hidden, false);
    assert.equal(dom.window.document.querySelector('#fake-friend-panel'), host);
    assert.equal(dom.window.document.querySelectorAll('#fake-friend-panel').length, 1);
    dom.window.dispatchEvent(new dom.window.Event('pagehide'));
    await until(() => !dom.window.document.querySelector('#fake-friend-panel'));
    const closedText = field('status').textContent;
    t.mock.timers.tick(20000);
    assert.equal(field('status').textContent, closedText);
    assert.equal(countdown.hidden, true);
  } finally {
    dom.window.dispatchEvent(new dom.window.Event('pagehide'));
    await settle();
    t.mock.timers.reset();
    globalThis.AbortController = originalAbort;
    dom.window.close();
  }
});

test('倒计时归零后正常进入下一轮，完成扫描后不保留倒计时', async t => {
  const dom = fixture([{}]);
  const originalAbort = globalThis.AbortController;
  globalThis.AbortController = dom.window.AbortController;
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000000 });
  t.mock.method(Math, 'random', () => 0.8);
  const data = {};
  let scrolls = 0;
  const adapter = {
    scan: () => readRows(dom.window.document, dom.window.location),
    resetPosition: () => {}, scroll: () => ++scrolls === 1
  };
  const storage = {
    get: async key => ({ [key]: structuredClone(data[key]) }),
    set: async values => Object.assign(data, structuredClone(values))
  };
  try {
    await openPanel({ document: dom.window.document, adapter, storage, cssURL: 'https://example.test/panel.css' });
    const root = dom.window.document.querySelector('#fake-friend-panel').shadowRoot;
    const field = id => root.getElementById(id);
    field('scan').click();
    await until(() => /下一轮 9 秒后/.test(field('status').textContent));
    assert.ok(field('countdown'), '等待期间必须显示倒计时');
    t.mock.timers.tick(9000);
    await until(() => !field('scan').disabled);
    assert.equal(scrolls, 2);
    assert.equal(field('countdown').hidden, true);
    assert.match(field('status').textContent, /本轮结束/);
    const finishedText = field('status').textContent;
    t.mock.timers.tick(20000);
    assert.equal(field('status').textContent, finishedText);
  } finally {
    dom.window.dispatchEvent(new dom.window.Event('pagehide'));
    await settle();
    t.mock.timers.reset();
    globalThis.AbortController = originalAbort;
    dom.window.close();
  }
});

test('本轮名单直接选择与逐个确认同步，白名单持久保存，执行只处理最终选择', async () => {
  const dom = fixture([{ id: '101', handle: 'alice' }, { id: '102', handle: 'bob' }, { id: '103', handle: 'carol' }]);
  const originalAbort = globalThis.AbortController;
  globalThis.AbortController = dom.window.AbortController;
  const data = {}, located = [], removed = [];
  const storage = {
    get: async key => ({ [key]: structuredClone(data[key]) }),
    set: async values => Object.assign(data, structuredClone(values))
  };
  const adapter = {
    scan: () => readRows(dom.window.document, dom.window.location),
    resetPosition: () => {}, scroll: () => false,
    locate: async row => { located.push(row.id); return readRows(dom.window.document, dom.window.location).rows.find(r => r.id === row.id); },
    unfollow: async row => { removed.push(row.id); return { status: 'removed' }; }
  };
  try {
    await openPanel({ document: dom.window.document, adapter, storage, cssURL: 'https://example.test/panel.css' });
    const root = dom.window.document.querySelector('#fake-friend-panel').shadowRoot;
    const field = id => root.getElementById(id);
    const choice = (id, kind) => root.querySelector(`button[data-account-id="${id}"][data-choice="${kind}"]`);
    field('scan').click();
    await until(() => !field('scan').disabled);
    assert.ok(choice('101', 'keep'), '每条名单应有白名单按钮');
    assert.equal(choice('102', 'remove').textContent, '假朋友');
    choice('101', 'keep').click();
    await until(() => !field('scan').disabled);
    assert.match(field('whitelist').value, /@alice/);
    assert.deepEqual(data['fake-friend/v0/tester/config'].keep, ['alice']);
    assert.equal(choice('101', 'remove').disabled, true);
    choice('103', 'skip').click();
    await until(() => !field('scan').disabled);
    assert.equal(field('candidates').textContent, '1');
    assert.equal(field('execute').hidden, true);
    assert.deepEqual(located, [], '列表选择不强制翻页');
    assert.deepEqual(removed, [], '选择不直接取关');
    field('review-start').click();
    await until(() => !field('approve').disabled);
    assert.deepEqual(located, ['102'], '逐个确认只定位未选择的人');
    field('approve').click();
    await until(() => !field('execute').hidden && !field('execute').disabled);
    assert.equal(choice('102', 'remove').getAttribute('aria-pressed'), 'true');
    assert.equal(field('candidates').textContent, '0');
    choice('103', 'remove').click();
    await until(() => !field('execute').disabled);
    assert.match(field('execute').textContent, /2 人/);
    choice('102', 'skip').click();
    await until(() => !field('execute').disabled);
    assert.match(field('execute').textContent, /1 人/);
    assert.equal(choice('102', 'skip').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(removed, []);
    field('execute').click();
    await until(() => !field('scan').disabled);
    assert.deepEqual(removed, ['103']);
  } finally {
    dom.window.dispatchEvent(new dom.window.Event('pagehide'));
    await settle();
    globalThis.AbortController = originalAbort;
    dom.window.close();
  }
});
