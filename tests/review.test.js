import test from 'node:test';
import assert from 'node:assert/strict';
import { ReviewQueue } from '../extension/src/review-queue.js';

test('未全部选择时也能取得已确认的执行名单', () => {
  const queue = new ReviewQueue([{ id: '1', handle: 'alice' }, { id: '2', handle: 'bob' }, { id: '3', handle: 'carol' }]);
  assert.equal(queue.current.id, '1');
  assert.deepEqual([...queue.approvedIds()], []);
  queue.decide('1', 'remove');
  assert.deepEqual([...queue.approvedIds()], ['1']);
  assert.equal(queue.pendingCount, 2);
  queue.decide('2', 'keep');
  queue.decide('3', 'skip');
  assert.equal(queue.current, null);
  assert.deepEqual([...queue.approvedIds()], ['1']);
});

test('确认只能作用于当前展示的账号', () => {
  const queue = new ReviewQueue([{ id: '1', handle: 'alice' }, { id: '2', handle: 'bob' }]);
  assert.throws(() => queue.decide('2', 'remove'), /当前/);
  assert.equal(queue.current.id, '1');
});

test('无效选择不能默认为取关', () => {
  const queue = new ReviewQueue([{ id: '1', handle: 'alice' }]);
  assert.throws(() => queue.decide('1', 'yes'), /选择/);
});

test('列表选择与逐个确认共享决定，跳过已选账号，修改选择不会重复计数', () => {
  const queue = new ReviewQueue([{ id: '1', handle: 'alice' }, { id: '2', handle: 'bob' }, { id: '3', handle: 'carol' }]);
  queue.choose('3', 'skip');
  queue.choose('1', 'keep');
  assert.equal(queue.current.id, '2');
  assert.equal(queue.pendingCount, 1);
  assert.deepEqual([...queue.approvedIds()], []);
  queue.decide('2', 'remove');
  assert.equal(queue.complete, true);
  assert.deepEqual([...queue.approvedIds()], ['2']);
  queue.choose('3', 'remove');
  queue.choose('2', 'skip');
  assert.equal(queue.pendingCount, 0);
  assert.deepEqual([...queue.approvedIds()], ['3']);
  assert.throws(() => queue.choose('unknown', 'remove'), /名单/);
});
