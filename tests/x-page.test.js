import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, appendRow, installDialog } from './fixtures.js';
import { readOwner, readRows, unfollowOne, createXAdapter } from '../extension/src/x-page.js';

const options = (dom, row, extra = {}) => ({ document: dom.window.document, location: dom.window.location, owner: 'tester', row,
  signal: new AbortController().signal, onStage: async () => {}, timeoutMs: 40, ...extra });

test('只能处理登录账号自己的正在关注列表', () => {
  const dom = fixture();
  assert.equal(readOwner(dom.window.document, dom.window.location), 'tester');
  assert.throws(() => readOwner(dom.window.document, new URL('https://x.com/Other/following')), /自己/);
  assert.throws(() => readOwner(dom.window.document, new URL('https://x.com/Tester/followers')), /正在关注/);
  dom.window.close();
});

test('准确区分互关、未回关和已经取关；只读取主列表', () => {
  const dom = fixture([{ id: '1', handle: 'one', mutual: true }, { id: '2', handle: 'two' }, { id: '3', handle: 'three', following: false }]);
  const doc = dom.window.document;
  doc.querySelector('#recommendations').append(appendRow(doc, { id: '4', handle: 'recommended' }));
  assert.deepEqual(readRows(doc, dom.window.location).rows.map(r => r.status), ['mutual', 'candidate', 'not-following']);
  dom.window.close();
});

test('简介中的关注了你不能冒充互关标记', () => {
  const dom = fixture([{}]);
  dom.window.document.querySelector('p').textContent = '关注了你 / Follows you';
  assert.equal(readRows(dom.window.document, dom.window.location).rows[0].status, 'candidate');
  dom.window.close();
});

test('按钮缺失、账号不一致、加载未完成均不得成为清理候选', () => {
  const dom = fixture([{ id: '1', handle: 'one' }, { id: '2', handle: 'two' }, { id: '3', handle: 'three' }]);
  const cells = dom.window.document.querySelectorAll('[data-testid="UserCell"]');
  cells[0].querySelector('button').remove();
  cells[1].querySelector('button').setAttribute('aria-label', '正在关注 @someoneElse');
  cells[2].setAttribute('aria-busy', 'true');
  assert.ok(readRows(dom.window.document, dom.window.location).rows.every(r => r.status === 'unknown'));
  dom.window.close();
});

test('只有正确账号的确认弹窗与实际按钮状态变化都出现才记成功', async () => {
  const dom = fixture([{}]);
  const row = readRows(dom.window.document, dom.window.location).rows[0];
  const clicks = installDialog(dom.window.document, row.element);
  const stages = [];
  const result = await unfollowOne(options(dom, row, { onStage: async stage => stages.push(stage) }));
  assert.equal(result.status, 'removed');
  assert.deepEqual(clicks, { open: 1, confirm: 1, cancel: 0 });
  assert.deepEqual(stages, ['intent', 'confirm']);
  dom.window.close();
});

test('弹窗指向别的账号时，不点击确认', async () => {
  const dom = fixture([{}]);
  const row = readRows(dom.window.document, dom.window.location).rows[0];
  const clicks = installDialog(dom.window.document, row.element, { target: 'alice_extra' });
  await assert.rejects(unfollowOne(options(dom, row)), /弹窗/);
  assert.equal(clicks.confirm, 0);
  dom.window.close();
});

test('扫描后对方已回关，则跳过', async () => {
  const dom = fixture([{}]);
  const row = readRows(dom.window.document, dom.window.location).rows[0];
  row.element.insertAdjacentHTML('beforeend', '<span data-testid="userFollowIndicator">关注了你</span>');
  const clicks = installDialog(dom.window.document, row.element);
  assert.equal((await unfollowOne(options(dom, row))).status, 'skipped');
  assert.equal(clicks.open, 0);
  dom.window.close();
});

test('等待确认期间暂停，取消本次弹窗且不再取关', async () => {
  const dom = fixture([{}]);
  const row = readRows(dom.window.document, dom.window.location).rows[0];
  const clicks = installDialog(dom.window.document, row.element);
  const controller = new AbortController();
  await assert.rejects(unfollowOne(options(dom, row, { signal: controller.signal, onStage: async stage => {
    if (stage === 'confirm') controller.abort(new Error('已暂停'));
  } })), /暂停/);
  assert.deepEqual(clicks, { open: 1, confirm: 0, cancel: 1 });
  dom.window.close();
});

test('点击成功但服务器未改变关注状态，结果必须是未确认而非成功', async () => {
  const dom = fixture([{}]);
  const row = readRows(dom.window.document, dom.window.location).rows[0];
  installDialog(dom.window.document, row.element, { confirm: false });
  await assert.rejects(unfollowOne(options(dom, row)), /未确认/);
  dom.window.close();
});

test('保存操作记录失败时不得点击取关', async () => {
  const dom = fixture([{}]);
  const row = readRows(dom.window.document, dom.window.location).rows[0];
  const clicks = installDialog(dom.window.document, row.element);
  await assert.rejects(unfollowOne(options(dom, row, { onStage: async () => { throw new Error('存储已满'); } })), /存储/);
  assert.equal(clicks.open, 0);
  dom.window.close();
});

test('简介中提到其他账号，不影响本人身份识别', () => {
  const dom = fixture([{}]);
  dom.window.document.querySelector('p').innerHTML = '研究员 <a href="/other">@other</a>';
  const row = readRows(dom.window.document, dom.window.location).rows[0];
  assert.equal(row.handle, 'alice');
  assert.equal(row.status, 'candidate');
  dom.window.close();
});

test('确认请求发出后中断，需要明确标记结果未知', async () => {
  const dom = fixture([{}]);
  const row = readRows(dom.window.document, dom.window.location).rows[0];
  const controller = new AbortController();
  installDialog(dom.window.document, row.element, { confirm: false });
  row.button.addEventListener('click', () => {
    dom.window.document.querySelector('[data-testid="confirmationSheetConfirm"]').addEventListener('click', () => controller.abort(new Error('已暂停')));
  });
  await assert.rejects(unfollowOne(options(dom, row, { signal: controller.signal })), error => error.name === 'OutcomeUnconfirmedError');
  dom.window.close();
});

const settle = () => new Promise(resolve => setImmediate(resolve));

function startPacedUnfollow(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const dom = fixture([{}]);
  const row = readRows(dom.window.document, dom.window.location).rows[0];
  const clicks = installDialog(dom.window.document, row.element);
  const controller = new AbortController();
  const result = unfollowOne(options(dom, row, { signal: controller.signal }));
  result.catch(() => {});
  t.after(async () => {
    controller.abort(new Error('测试结束'));
    await result.catch(() => {});
    t.mock.timers.reset();
    dom.window.close();
  });
  return { dom, row, clicks, controller, result };
}

test('取关步骤：打开前等待两秒，确认弹窗完整停留两秒后才点击确认', async t => {
  const { dom, clicks, result } = startPacedUnfollow(t);
  await settle();
  assert.deepEqual(clicks, { open: 0, confirm: 0, cancel: 0 });
  t.mock.timers.tick(1999); await settle();
  assert.equal(clicks.open, 0);
  t.mock.timers.tick(1); await settle();
  assert.deepEqual(clicks, { open: 1, confirm: 0, cancel: 0 });
  assert.ok(dom.window.document.querySelector('[role="alertdialog"]'));
  t.mock.timers.tick(1999); await settle();
  assert.equal(clicks.confirm, 0);
  assert.ok(dom.window.document.querySelector('[role="alertdialog"]'));
  t.mock.timers.tick(1); await settle();
  assert.deepEqual(await result, { status: 'removed' });
  assert.deepEqual(clicks, { open: 1, confirm: 1, cancel: 0 });
});

for (const opened of [false, true]) {
  test(`取关步骤：${opened ? '弹窗停留' : '打开前等待'}期间停止，立即结束且不取关`, async t => {
    const { dom, clicks, controller, result } = startPacedUnfollow(t);
    await settle();
    if (opened) { t.mock.timers.tick(2000); await settle(); }
    assert.deepEqual(clicks, { open: Number(opened), confirm: 0, cancel: 0 });
    const stopped = assert.rejects(result, /已停止/);
    controller.abort(new Error('已停止'));
    await stopped;
    t.mock.timers.tick(10000); await settle();
    assert.deepEqual(clicks, { open: Number(opened), confirm: 0, cancel: Number(opened) });
    assert.equal(dom.window.document.querySelector('[role="alertdialog"]'), null);
    assert.equal(readRows(dom.window.document, dom.window.location).rows[0].following, true);
  });

  test(`取关步骤：${opened ? '弹窗停留' : '打开前等待'}期间对方回关，重新核对后跳过`, async t => {
    const { dom, row, clicks, result } = startPacedUnfollow(t);
    await settle();
    if (opened) { t.mock.timers.tick(2000); await settle(); }
    assert.equal(clicks.confirm, 0);
    row.element.insertAdjacentHTML('beforeend', '<span data-testid="userFollowIndicator">关注了你</span>');
    t.mock.timers.tick(2000); await settle();
    assert.equal((await result).status, 'skipped');
    assert.deepEqual(clicks, { open: Number(opened), confirm: 0, cancel: Number(opened) });
    assert.equal(readRows(dom.window.document, dom.window.location).rows[0].following, true);
  });
}

test('取关步骤：打开前等待期间出现其他弹窗，停止且不点击目标账号', async t => {
  const { dom, clicks, result } = startPacedUnfollow(t);
  await settle();
  assert.equal(clicks.open, 0);
  const other = dom.window.document.createElement('div');
  other.setAttribute('role', 'dialog'); other.textContent = '其他操作';
  dom.window.document.body.append(other);
  const rejected = assert.rejects(result, /页面已有其他弹窗/);
  t.mock.timers.tick(2000);
  await rejected;
  assert.deepEqual(clicks, { open: 0, confirm: 0, cancel: 0 });
});

test('取关步骤：停留期间确认弹窗的账号变化，不确认取关', async t => {
  const { dom, clicks, result } = startPacedUnfollow(t);
  await settle();
  t.mock.timers.tick(2000); await settle();
  assert.deepEqual(clicks, { open: 1, confirm: 0, cancel: 0 });
  dom.window.document.querySelector('[role="alertdialog"] h2').textContent = '取消关注 @someoneelse？';
  const rejected = assert.rejects(result, /账号不匹配/);
  t.mock.timers.tick(2000);
  await rejected;
  assert.equal(clicks.confirm, 0);
  assert.equal(readRows(dom.window.document, dom.window.location).rows[0].following, true);
});

function bottomPage(t) {
  const dom = fixture([{}]);
  Object.defineProperty(dom.window, 'scrollY', { value: 1000, configurable: true });
  Object.defineProperty(dom.window, 'innerHeight', { value: 1000, configurable: true });
  Object.defineProperty(dom.window.document.documentElement, 'scrollHeight', { value: 2000, configurable: true });
  t.mock.method(dom.window, 'scrollBy', () => {});
  t.mock.method(Math, 'random', () => 0);
  return dom;
}

test('到达底部后按正常间隔复核，连续两次无新内容才结束', async t => {
  const dom = bottomPage(t);
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000000 });
  const controller = new AbortController(), waits = [];
  let finished = false;
  try {
    const task = createXAdapter(dom.window.document, dom.window.location).scroll({
      owner: 'tester', signal: controller.signal, minSeconds: 3, maxSeconds: 10,
      onWait: (ms, message) => waits.push({ ms, message })
    }).then(value => { finished = true; return value; });
    await settle();
    assert.equal(finished, false, '不能因为当下滚不动就立即宣告结束');
    for (let i = 0; i < 2; i++) {
      assert.equal(waits.length, i + 1);
      assert.equal(waits[i].ms, [3000, 7000][i]);
      t.mock.timers.tick(waits[i].ms);
      await settle();
      if (i < 1) assert.equal(finished, false);
    }
    assert.equal(await task, false);
  } finally { controller.abort(); t.mock.timers.reset(); dom.window.close(); }
});

test('末尾加载动画延迟出现并增加账号时，继续扫描新内容', async t => {
  const dom = bottomPage(t);
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000000 });
  const controller = new AbortController();
  let result;
  try {
    const task = createXAdapter(dom.window.document, dom.window.location).scroll({
      owner: 'tester', signal: controller.signal, minSeconds: 3, maxSeconds: 10
    }).then(value => { result = value; return value; });
    await settle();
    const loading = dom.window.document.createElement('div'); loading.setAttribute('role', 'progressbar');
    dom.window.document.querySelector('section').append(loading);
    t.mock.timers.tick(3000); await settle();
    assert.equal(result, undefined, '加载过程中不能当成已经结束');
    appendRow(dom.window.document, { id: '102', handle: 'bob' }); loading.remove();
    await settle();
    assert.equal(await task, true);
    assert.equal(readRows(dom.window.document, dom.window.location).rows.length, 2);
  } finally { controller.abort(); t.mock.timers.reset(); dom.window.close(); }
});

test('底部复核期间仍可立即停止', async t => {
  const dom = bottomPage(t), controller = new AbortController();
  try {
    const task = createXAdapter(dom.window.document, dom.window.location).scroll({
      owner: 'tester', signal: controller.signal, minSeconds: 3, maxSeconds: 10
    });
    controller.abort(new Error('用户停止'));
    await assert.rejects(task, /用户停止/);
  } finally { controller.abort(); dom.window.close(); }
});

test('滚动卡住但尚未到页面底部时显示异常，不宣告扫描完成', async t => {
  const dom = bottomPage(t), controller = new AbortController();
  Object.defineProperty(dom.window, 'scrollY', { value: 100, configurable: true });
  try {
    await assert.rejects(createXAdapter(dom.window.document, dom.window.location).scroll({
      owner: 'tester', signal: controller.signal, minSeconds: 3, maxSeconds: 10
    }), /尚未到达.*底部/);
  } finally { controller.abort(); dom.window.close(); }
});

test('底部复核期间同一账号加载出互关标记，返回继续以更新扫描结果', async t => {
  const dom = bottomPage(t), controller = new AbortController();
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000000 });
  try {
    const task = createXAdapter(dom.window.document, dom.window.location).scroll({
      owner: 'tester', signal: controller.signal, minSeconds: 3, maxSeconds: 10
    });
    await settle();
    dom.window.document.querySelector('[data-testid="UserCell"]').insertAdjacentHTML('beforeend', '<span data-testid="userFollowIndicator">关注了你</span>');
    t.mock.timers.tick(3000); await settle();
    t.mock.timers.tick(3000); await settle();
    assert.equal(await task, true, '需要重新读取关系变化，不能使用等待前的旧候选状态');
  } finally { controller.abort(); t.mock.timers.reset(); dom.window.close(); }
});

test('列表持续加载超时时按异常停止，不显示已扫完', async t => {
  const dom = bottomPage(t), controller = new AbortController();
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000000 });
  dom.window.document.querySelector('section').insertAdjacentHTML('beforeend', '<div role="progressbar"></div>');
  try {
    const result = assert.rejects(createXAdapter(dom.window.document, dom.window.location).scroll({
      owner: 'tester', signal: controller.signal, minSeconds: 3, maxSeconds: 10
    }), /加载未完成.*尚未确认到达末尾/);
    t.mock.timers.tick(10000); await result;
  } finally { controller.abort(); t.mock.timers.reset(); dom.window.close(); }
});
