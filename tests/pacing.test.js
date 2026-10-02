import test from 'node:test';
import assert from 'node:assert/strict';
import { randomIntervalMs } from '../extension/src/pacing.js';

test('随机间隔覆盖设定范围且不越界', () => {
  assert.equal(randomIntervalMs(15, 30, () => 0), 15000);
  assert.equal(randomIntervalMs(15, 30, () => 0.999), 30000);
  for (const fraction of [0.1, 0.4, 0.8]) {
    const interval = randomIntervalMs(15, 30, () => fraction);
    assert.ok(interval >= 15000 && interval <= 30000);
  }
});

test('无效范围或无效随机源应明确报错', () => {
  assert.throws(() => randomIntervalMs(0, 30));
  assert.throws(() => randomIntervalMs(30, 15));
  assert.throws(() => randomIntervalMs(15, 15));
  assert.throws(() => randomIntervalMs(15, 30, () => 1));
});
