import test from 'node:test';
import assert from 'node:assert/strict';
import { CleanupSession } from '../extension/src/cleanup-session.js';
import { openPanel } from '../extension/src/panel.js';
import { readRows } from '../extension/src/x-page.js';
import { fixture } from './fixtures.js';

const settings = { skipFirstCount: 1, scanMinSeconds: 1, scanMaxSeconds: 2,
  unfollowMinSeconds: 1, unfollowMaxSeconds: 2, maxActions: 5, autoScroll: true };
const pages = [['1', '2', '3'], ['3', '4', '5'], ['5', '6', '7'], ['7', '8', '9']];
const settle = () => new Promise(resolve => setImmediate(resolve));

function scanScenario(input = settings) {
  const rows = new Map(Array.from({ length: 9 }, (_, i) => {
    const id = String(i + 1);
    return [id, { id, handle: `user${id}`, name: `User ${id}`, status: 'candidate' }];
  }));
  const removed = [], restored = [], events = [];
  let page = 0, clock = 0, owner = 'tester', resetCount = 0, pauseFirstScan = true;
  let hook = () => {};
  const adapter = {
    scan() {
      const visible = pages[page].map(id => rows.get(id)).filter(row => row.status !== 'not-following');
      return { owner, rows: visible.map(row => ({ ...row })),
        anchor: visible.length ? { id: visible[0].id, handle: visible[0].handle } : null };
    },
    resetPosition({ signal }) { signal.throwIfAborted(); resetCount++; page = 0; },
    restorePosition(anchor, { signal }) {
      signal.throwIfAborted();
      if (rows.get(anchor.id)?.status === 'not-following') throw new Error('原账号已不在关注列表');
      restored.push(anchor.id);
      page = pages.findLastIndex(ids => ids.includes(anchor.id));
      if (page < 0) throw new Error('找不到继续位置');
    },
    scroll({ signal }) { signal.throwIfAborted(); if (page === pages.length - 1) return false; page++; return true; },
    async unfollow(row) { removed.push(row.id); rows.get(row.id).status = 'not-following'; return { status: 'removed' }; }
  };
  const session = new CleanupSession({ adapter, audit: async event => events.push(event),
    now: () => clock, wait: async (ms, signal) => { signal.throwIfAborted(); clock += ms; }, random: () => 0,
    onChange(state) {
      if (pauseFirstScan && state.mode === 'scan' && state.status === 'running' && state.scans === 3) {
        pauseFirstScan = false; void session.pause();
      }
      hook(state);
    } });
  return { session, adapter, rows, removed, restored, events, input,
    pauseScan: () => session.start('scan', input, new Set()),
    cleanup: ids => session.start('cleanup', input, new Set(), new Set(ids)),
    setHook: callback => { hook = callback; }, setOwner: value => { owner = value; },
    get resetCount() { return resetCount; } };
}

test('暂停扫描后分批取关：保留全部记录与保护范围，从最后取关附近继续去重扫描', async () => {
  const s = scanScenario();
  await s.pauseScan();
  assert.equal(s.session.status, 'paused');
  assert.equal(s.session.records.size, 7);
  assert.equal(s.session.anchor.id, '5');
  await s.cleanup(['2', '4']);
  assert.deepEqual(s.removed, ['2', '4']);
  assert.equal(s.session.mode, 'scan');
  assert.equal(s.session.status, 'paused');
  assert.equal(s.session.records.size, 7);
  assert.equal(s.session.records.get('1').status, 'protected');
  assert.equal(s.session.records.get('2').status, 'removed');
  assert.equal(s.session.records.get('4').status, 'removed');
  assert.equal(s.session.scans, 3, '取关结束后等待用户点击继续');
  const resets = s.resetCount;
  await s.session.resume();
  assert.deepEqual(s.restored, ['3'], '最后取关的 4 已移出列表，从前面的保留账号 3 接着向下扫');
  assert.equal(s.resetCount, resets);
  assert.equal(s.session.status, 'finished');
  assert.deepEqual([...s.session.records.keys()], ['1', '2', '3', '4', '5', '6', '7', '8', '9']);
  assert.equal(s.session.removed, 2);
  assert.deepEqual([...s.session.protectedIds], ['1']);
  assert.deepEqual(s.removed, ['2', '4']);
});

test('暂停扫描后分批取关：每批遵守上限，下一批保留累计结果与扫描进度', async () => {
  const s = scanScenario({ ...settings, maxActions: 1 });
  await s.pauseScan();
  await s.cleanup(['2', '4']);
  assert.equal(s.session.mode, 'scan');
  assert.equal(s.session.status, 'paused');
  assert.deepEqual(s.removed, ['2']);
  assert.equal(s.session.records.get('4').status, 'candidate');
  await s.cleanup(['4']);
  assert.equal(s.session.records.size, 7);
  assert.equal(s.session.removed, 2);
  assert.deepEqual(s.removed, ['2', '4']);
  await s.session.resume();
  assert.deepEqual(s.restored, ['3']);
  assert.equal(s.session.records.size, 9);
});

test('暂停扫描后分批取关：取关中暂停后继续本批，已完成的账号不重复取关', async () => {
  const s = scanScenario();
  await s.pauseScan();
  let pauseCleanup = true;
  s.setHook(state => {
    if (pauseCleanup && state.mode === 'cleanup' && state.status === 'running' && state.removed === 1) {
      pauseCleanup = false; void s.session.pause();
    }
  });
  await s.cleanup(['2', '4']);
  assert.equal(s.session.mode, 'cleanup');
  assert.equal(s.session.status, 'paused');
  await s.session.resume();
  assert.deepEqual(s.removed, ['2', '4']);
  assert.equal(s.session.mode, 'scan');
  assert.equal(s.session.status, 'paused');
  assert.equal(s.session.records.size, 7);
});

test('暂停扫描后分批取关：停止本批也终止扫描续接，随后不能继续旧任务', async () => {
  const s = scanScenario();
  await s.pauseScan();
  let stopCleanup = true;
  s.setHook(state => {
    if (stopCleanup && state.mode === 'cleanup' && state.status === 'running' && state.removed === 1) {
      stopCleanup = false; void s.session.stop();
    }
  });
  await s.cleanup(['2', '4']);
  assert.deepEqual(s.removed, ['2']);
  assert.equal(s.session.status, 'stopped');
  await assert.rejects(s.session.resume(), /暂停/);
});

test('暂停扫描后分批取关：取关结果未知时保留待检查并停止，不能自动恢复扫描', async () => {
  const s = scanScenario();
  await s.pauseScan();
  s.adapter.unfollow = async () => { throw Object.assign(new Error('结果未确认'), { name: 'OutcomeUnconfirmedError' }); };
  await s.cleanup(['2']);
  assert.equal(s.session.status, 'error');
  assert.equal(s.session.records.get('2').status, 'unknown');
  await assert.rejects(s.session.resume(), /暂停/);
});

test('暂停扫描后分批取关：登录身份改变时不能把旧选择用于新账号', async () => {
  const s = scanScenario();
  await s.pauseScan();
  s.setOwner('other');
  await assert.rejects(s.cleanup(['2']), /账号已变化/);
  assert.deepEqual(s.removed, []);
  assert.equal(s.session.records.size, 7);
});

test('暂停扫描后分批取关：列表前缀全部取关后，从剩余列表顶端继续且不丢旧记录', async () => {
  const s = scanScenario({ ...settings, skipFirstCount: 0 });
  await s.pauseScan();
  await s.cleanup(['1', '2', '3']);
  assert.equal(s.session.mode, 'scan');
  assert.equal(s.session.status, 'paused');
  assert.equal(s.session.anchor, null);
  await s.session.resume();
  assert.equal(s.session.records.size, 9);
  assert.equal(s.session.removed, 3);
  assert.deepEqual(s.removed, ['1', '2', '3']);
});

test('暂停扫描后分批取关：本批没有取关成功时，继续原扫描位置', async () => {
  const s = scanScenario();
  await s.pauseScan();
  s.rows.get('2').status = 'mutual';
  await s.cleanup(['2']);
  assert.equal(s.session.mode, 'scan');
  assert.equal(s.session.status, 'paused');
  assert.equal(s.session.anchor.id, '5');
  await s.session.resume();
  assert.deepEqual(s.restored, ['5']);
  assert.deepEqual(s.removed, []);
  assert.equal(s.session.records.size, 9);
});

test('面板暂停扫描后分批取关：暂停即可执行，完成后继续扫描且保留名单选择', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000000 });
  const dom = fixture(Array.from({ length: 9 }, (_, i) => ({ id: String(i + 1), handle: `user${i + 1}` })));
  const originalAbort = globalThis.AbortController;
  globalThis.AbortController = dom.window.AbortController;
  const data = {}, removed = [], restored = [];
  let page = 0;
  const storage = {
    get: async key => key === null ? structuredClone(data) : { [key]: structuredClone(data[key]) },
    set: async values => { Object.assign(data, structuredClone(values)); }
  };
  const adapter = {
    scan() {
      const snapshot = readRows(dom.window.document, dom.window.location);
      const rows = snapshot.rows.filter(row => pages[page].includes(row.id) && row.following);
      return { ...snapshot, rows, anchor: rows.length ? { id: rows[0].id, handle: rows[0].handle } : null };
    },
    resetPosition({ signal }) { signal.throwIfAborted(); page = 0; },
    restorePosition(anchor, { signal }) { signal.throwIfAborted(); restored.push(anchor.id); page = pages.findLastIndex(ids => ids.includes(anchor.id)); },
    scroll({ signal }) { signal.throwIfAborted(); if (page === pages.length - 1) return false; page++; return true; },
    async unfollow(row) {
      removed.push(row.id);
      row.button.dataset.testid = `${row.id}-follow`;
      row.button.setAttribute('aria-label', `关注 @${row.handle}`);
      row.button.textContent = '关注';
      return { status: 'removed' };
    }
  };
  t.after(async () => {
    dom.window.dispatchEvent(new dom.window.Event('pagehide'));
    await settle();
    globalThis.AbortController = originalAbort;
    t.mock.timers.reset();
    dom.window.close();
  });
  await openPanel({ document: dom.window.document, adapter, storage, cssURL: 'https://example.test/panel.css' });
  const root = dom.window.document.querySelector('#fake-friend-panel').shadowRoot;
  const field = id => root.getElementById(id);
  const choice = (id, value) => root.querySelector(`button[data-account-id="${id}"][data-choice="${value}"]`);
  field('language').value = 'zh';
  field('language').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  for (const [key, value] of Object.entries(settings)) {
    if (key === 'autoScroll') field(key).checked = value; else field(key).value = value;
  }
  field('scan').click(); await settle();
  t.mock.timers.tick(2000); await settle();
  t.mock.timers.tick(2000); await settle();
  assert.equal(field('seen').textContent, '7');
  choice('2', 'remove').click(); await settle();
  choice('4', 'remove').click(); await settle();
  choice('3', 'skip').click(); await settle();
  assert.equal(field('execute').disabled, true);
  field('pause').click(); await settle();
  assert.equal(field('resume').hidden, false);
  assert.equal(field('execute').disabled, false, '暂停后应能执行已确认的账号');
  assert.match(field('execute').textContent, /2 人/);
  field('execute').click(); await settle();
  for (let i = 0; i < 6 && (field('resume').hidden || field('resume').disabled); i++) {
    t.mock.timers.tick(2000); await settle();
  }
  assert.deepEqual(removed, ['2', '4']);
  assert.equal(field('resume').hidden, false);
  assert.equal(field('resume').disabled, false);
  assert.equal(field('seen').textContent, '7');
  assert.equal(field('removed').textContent, '2');
  assert.equal(choice('3', 'remove'), null, '之前跳过的账号继续隐藏');
  field('resume').click(); await settle();
  for (let i = 0; i < 6 && field('scan').disabled; i++) {
    t.mock.timers.tick(2000); await settle();
  }
  assert.deepEqual(restored, ['3']);
  assert.equal(field('seen').textContent, '9');
  assert.equal(field('removed').textContent, '2');
  assert.equal(field('candidates').textContent, '5');
  assert.equal(choice('3', 'remove'), null);
  assert.deepEqual(removed, ['2', '4']);
  const runs = Object.values(data).filter(value => Array.isArray(value?.events));
  assert.deepEqual(runs.map(run => run.kind), ['scan', 'cleanup', 'scan']);
});
