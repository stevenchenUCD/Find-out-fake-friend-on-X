import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalStore } from '../extension/src/local-store.js';
import { DEFAULT_SETTINGS } from '../extension/src/cleanup-session.js';

function memory() {
  const data = {};
  return { get: async key => key === null ? structuredClone(data) : { [key]: structuredClone(data[key]) },
    set: async values => Object.assign(data, structuredClone(values)) };
}

test('白名单跨实例保存，并按自己的账号隔离', async () => {
  const storage = memory();
  await new LocalStore(storage, 'Tester').save(DEFAULT_SETTINGS, new Set(['Alice']));
  assert.deepEqual([...(await new LocalStore(storage, 'tester').load()).keep], ['alice']);
  assert.equal((await new LocalStore(storage, 'other').load()).keep.size, 0);
});

test('导出记录保留操作顺序，且不混入其他账号数据', async () => {
  const storage = memory();
  const store = new LocalStore(storage, 'tester');
  await store.beginRun('cleanup');
  await store.audit({ type: 'intent', id: '1', handle: 'alice' });
  await store.audit({ type: 'removed', id: '1', handle: 'alice' });
  await new LocalStore(storage, 'other').save(DEFAULT_SETTINGS, new Set(['bob']));
  const result = await store.exportData();
  assert.equal(Object.keys(result).length, 1);
  assert.deepEqual(Object.values(result)[0].events.map(e => e.type), ['intent', 'removed']);
});
