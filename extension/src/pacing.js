export function validateIntervalRange(minSeconds, maxSeconds) {
  if (!Number.isInteger(minSeconds) || !Number.isInteger(maxSeconds) || minSeconds < 1 || maxSeconds > 10000 || maxSeconds <= minSeconds) {
    throw new Error('间隔范围需要填写整数，最小值至少 1 秒，最大值必须大于最小值且不超过 10000 秒。');
  }
}

export function randomIntervalMs(minSeconds, maxSeconds, random = Math.random) {
  validateIntervalRange(minSeconds, maxSeconds);
  return sampleIntervalMs(minSeconds, maxSeconds, random);
}

export function createAlternatingInterval(random = Math.random) {
  let nextHalf = null;
  return (minSeconds, maxSeconds) => {
    validateIntervalRange(minSeconds, maxSeconds);
    const midpoint = Math.floor((minSeconds + maxSeconds) / 2);
    const lower = nextHalf === 'high' ? midpoint + 1 : minSeconds;
    const upper = nextHalf === 'low' ? midpoint : maxSeconds;
    const ms = sampleIntervalMs(lower, upper, random);
    nextHalf = ms > midpoint * 1000 ? 'low' : 'high';
    return ms;
  };
}

function sampleIntervalMs(minSeconds, maxSeconds, random) {
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) throw new Error('随机间隔取值失败，已停止。');
  return (minSeconds + Math.floor(sample * (maxSeconds - minSeconds + 1))) * 1000;
}
