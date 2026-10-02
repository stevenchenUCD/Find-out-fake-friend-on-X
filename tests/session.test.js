import test from 'node:test';
import assert from 'node:assert/strict';
import { CleanupSession, validateSettings } from '../extension/src/cleanup-session.js';

const settings = { skipFirstCount: 0, scanMinSeconds: 15, scanMaxSeconds: 30, unfollowMinSeconds: 30, unfollowMaxSeconds: 60, maxActions: 2, autoScroll: true };
const candidate = (id, handle = `user${id}`) => ({ id, handle, name: handle, status: 'candidate' });

function scenario(rows = [candidate('1'), candidate('2'), candidate('3')]) {
  const events = [], clicks = [], times = [];
  let clock = 0;
  const adapter = {
    scan: () => ({ owner: 'tester', rows: rows.map(r => ({ ...r })) }),
    resetPosition: () => {},
    scroll: () => false,
    unfollow: async (row, { onStage }) => { await onStage('intent'); clicks.push(row.handle); times.push(clock); rows.find(r => r.id === row.id).status = 'not-following'; return { status: 'removed' }; }
  };
  const session = new CleanupSession({ adapter, audit: async event => events.push(event), now: () => clock, wait: async ms => { clock += ms; }, random: () => 0, onChange: () => {} });
  return { session, adapter, events, clicks, times, setTime: n => { clock = n; } };
}

test('按设定间隔逐个清理，到达本轮数量上限即停止', async () => {
  const s = scenario();
  await s.session.start('cleanup', settings, new Set(), new Set(['1', '2', '3']));
  assert.deepEqual(s.clicks, ['user1', 'user2']);
  assert.ok(s.times[1] - s.times[0] >= 30000);
  assert.equal(s.session.snapshot().removed, 2);
  assert.match(s.session.snapshot().message, /上限/);
});

test('只扫描模式绝不触发取关', async () => {
  const s = scenario();
  await s.session.start('scan', settings, new Set());
  assert.equal(s.clicks.length, 0);
  assert.equal(s.session.snapshot().records.length, 3);
});

test('保留名单中的账号不会取关', async () => {
  const s = scenario();
  await s.session.start('cleanup', settings, new Set(['user1']), new Set(['1', '2', '3']));
  assert.deepEqual(s.clicks, ['user2', 'user3']);
});

test('一旦操作失败立即终止，不重试也不继续其他账号', async () => {
  const s = scenario();
  s.adapter.unfollow = async () => { throw new Error('页面拒绝操作'); };
  await s.session.start('cleanup', settings, new Set(), new Set(['1', '2', '3']));
  assert.equal(s.session.snapshot().status, 'error');
  assert.equal(s.clicks.length, 0);
  assert.ok(s.events.some(e => e.type === 'error'));
});

test('扫描持续到列表末尾，不被原来的时长或轮数截断', async () => {
  const s = scenario();
  let scrolls = 0;
  s.adapter.scroll = () => ++scrolls < 251;
  await s.session.start('scan', { ...settings, maxMinutes: 30, maxScans: 200 }, new Set());
  assert.equal(s.session.snapshot().scans, 251);
  assert.equal(scrolls, 251);
  assert.match(s.session.snapshot().message, /末尾/);
  assert.equal(s.clicks.length, 0);
});

test('运行设置只要求操作范围和随机间隔，无需时长或轮数', () => {
  assert.deepEqual(validateSettings(settings), settings);
});

test('账号在运行过程中切换，必须停止', async () => {
  const s = scenario();
  const scan = s.adapter.scan;
  let count = 0;
  s.adapter.scan = () => ({ ...scan(), owner: count++ ? 'other' : 'tester' });
  await s.session.start('cleanup', settings, new Set(), new Set(['1', '2', '3']));
  assert.equal(s.session.snapshot().status, 'error');
  assert.ok(s.clicks.length <= 1);
});

test('设置缺失、负数、小数不能默默替换为默认值', () => {
  assert.throws(() => validateSettings({ ...settings, unfollowMinSeconds: 0 }));
  assert.throws(() => validateSettings({ ...settings, maxActions: 1.5 }));
  assert.throws(() => validateSettings({}));
  assert.deepEqual(validateSettings(settings), settings);
});

test('每个操作周期重新抽取间隔，范围设置必须有效', async () => {
  const s = scenario();
  const sequence = [0, 0.999];
  s.session.random = () => sequence.shift();
  await s.session.start('cleanup', { ...settings, maxActions: 3 }, new Set(), new Set(['1', '2', '3']));
  assert.deepEqual(s.times, [0, 30000, 90000]);
  assert.throws(() => validateSettings({ ...settings, scanMinSeconds: 40, scanMaxSeconds: 30 }));
  assert.throws(() => validateSettings({ ...settings, scanMinSeconds: 15, scanMaxSeconds: 15 }));
});

test('没有逐个确认的名单时，不能开始清理', async () => {
  const s = scenario();
  await assert.rejects(s.session.start('cleanup', settings, new Set(), new Set()), /确认/);
  assert.equal(s.clicks.length, 0);
});

test('执行时新发现的未回关账号不能自动加入清理范围', async () => {
  const s = scenario();
  await s.session.start('cleanup', settings, new Set(), new Set(['2']));
  assert.deepEqual(s.clicks, ['user2']);
});

test('扫描时按顶部顺序排除前 N 个唯一账号，重复卡片不重复计数', async () => {
  const rows = [candidate('1'), candidate('1'), candidate('2'), candidate('3')];
  const s = scenario(rows);
  await s.session.start('scan', { ...settings, skipFirstCount: 2 }, new Set());
  assert.deepEqual(s.session.snapshot().records.map(r => [r.id, r.status]), [['1', 'protected'], ['2', 'protected'], ['3', 'candidate']]);
});

test('执行按确认名单处理，不因列表变短重新计算前 N 个', async () => {
  const s = scenario([candidate('3')]);
  await s.session.start('cleanup', { ...settings, skipFirstCount: 2 }, new Set(), new Set(['3']));
  assert.deepEqual(s.clicks, ['user3']);
});

test('跳过数量允许零，负数和小数必须报错', () => {
  assert.equal(validateSettings(settings).skipFirstCount, 0);
  assert.throws(() => validateSettings({ ...settings, skipFirstCount: -1 }));
  assert.throws(() => validateSettings({ ...settings, skipFirstCount: 1.5 }));
});

test('暂停后立即继续，也不能缩短已设定的取关间隔', async () => {
  const s = scenario();
  const advance = s.session.wait;
  let first = true;
  let entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  s.session.wait = async (ms, signal) => {
    if (!first) return advance(ms, signal);
    first = false; entered();
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  };
  const run = s.session.start('cleanup', settings, new Set(), new Set(['1', '2']));
  await waiting;
  await s.session.pause(); await run;
  s.setTime(1000);
  await s.session.resume();
  assert.deepEqual(s.times, [0, 30000]);
});

test('结束记录写入失败必须显示错误状态', async () => {
  const s = scenario();
  s.session.audit = async event => { if (event.type === 'finished') throw new Error('本地记录写入失败'); };
  await s.session.start('scan', settings, new Set());
  assert.equal(s.session.snapshot().status, 'error');
  assert.match(s.session.snapshot().message, /写入失败/);
});

test('身份未识别的重复卡片不会累积成虚假的新增账号', async () => {
  const s = scenario([{ id: null, handle: '', status: 'unknown', reason: '加载未完成' }]);
  let scrolls = 0;
  s.adapter.scroll = () => scrolls++ === 0;
  await s.session.start('scan', settings, new Set());
  assert.equal(s.session.snapshot().records.length, 1);
});

test('点击确认后结果未知时，暂停不能变成可以直接重试的状态', async () => {
  const s = scenario();
  s.adapter.unfollow = async () => {
    void s.session.pause();
    throw Object.assign(new Error('取关结果未确认'), { name: 'OutcomeUnconfirmedError' });
  };
  await s.session.start('cleanup', settings, new Set(), new Set(['1']));
  assert.equal(s.session.snapshot().status, 'error');
  await assert.rejects(s.session.resume(), /暂停/);
});

test('前 N 人编号必须等待列表真正回到顶部', async () => {
  const rows = [candidate('99')];
  const s = scenario(rows);
  let release, entered;
  const atReset = new Promise(resolve => { entered = resolve; });
  s.adapter.resetPosition = () => { entered(); return new Promise(resolve => { release = resolve; }); };
  const run = s.session.start('scan', { ...settings, skipFirstCount: 1 }, new Set());
  await atReset; await new Promise(resolve => setImmediate(resolve));
  const beforeReady = s.session.snapshot().records;
  rows.splice(0, rows.length, candidate('1'), candidate('2'));
  release(); await run;
  assert.equal(beforeReady.length, 0);
  assert.deepEqual(s.session.snapshot().records.map(r => [r.id, r.status]), [['1', 'protected'], ['2', 'candidate']]);
});
