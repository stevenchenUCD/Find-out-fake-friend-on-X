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

test('面板高度跨实例记住，按账号隔离，保存白名单和运行设置不会覆盖高度', async () => {
  const storage = memory();
  const store = new LocalStore(storage, 'Tester');
  assert.equal(await store.loadPanelHeight(), undefined);
  await store.savePanelHeight(760);
  await store.save(DEFAULT_SETTINGS, new Set(['alice']));
  assert.equal(await new LocalStore(storage, 'tester').loadPanelHeight(), 760);
  assert.equal(await new LocalStore(storage, 'other').loadPanelHeight(), undefined);
  await store.savePanelHeight(480);
  assert.equal(await new LocalStore(storage, 'tester').loadPanelHeight(), 480);
  assert.deepEqual([...(await store.load()).keep], ['alice']);
});

test('损坏的高度存储和无效高度必须报错，不能默默当成默认尺寸', async () => {
  const storage = memory();
  const store = new LocalStore(storage, 'tester');
  for (const height of [0, -1, 1.5, '640', null, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(async () => store.savePanelHeight(height), /本地配置格式不正确/);
    await storage.set({ [`${store.prefix}panel-height`]: height });
    await assert.rejects(async () => store.loadPanelHeight(), /本地配置格式不正确/);
  }
});
