import { abortableDelay } from './x-page.js';
import { createAlternatingInterval, validateIntervalRange } from './pacing.js';

export const DEFAULT_SETTINGS = Object.freeze({ skipFirstCount: 0, scanMinSeconds: 3, scanMaxSeconds: 10, unfollowMinSeconds: 3, unfollowMaxSeconds: 10, maxActions: 20, autoScroll: true });

export function validateSettings(input) {
  const result = {};
  if (!Number.isInteger(input.skipFirstCount) || input.skipFirstCount < 0 || input.skipFirstCount > 10000) throw new Error('跳过前 N 人需要填写 0—10000 的整数。');
  result.skipFirstCount = input.skipFirstCount;
  for (const [min, max] of [['scanMinSeconds', 'scanMaxSeconds'], ['unfollowMinSeconds', 'unfollowMaxSeconds']]) {
    validateIntervalRange(input[min], input[max]); result[min] = input[min]; result[max] = input[max];
  }
  if (!Number.isInteger(input.maxActions) || input.maxActions < 1 || input.maxActions > 10000) throw new Error('本轮最多取关需要填写 1—10000 的整数。');
  result.maxActions = input.maxActions;
  if (typeof input.autoScroll !== 'boolean') throw new Error('请明确自动滚动选项。');
  result.autoScroll = input.autoScroll;
  return result;
}

export class CleanupSession {
  constructor({ adapter, audit, onChange = () => {}, now = Date.now, wait = abortableDelay, random = Math.random }) {
    this.adapter = adapter; this.audit = audit; this.onChange = onChange; this.now = now; this.wait = wait;
    this.random = random;
    this.status = 'idle'; this.message = '先扫描，再逐个确认。';
    this.records = new Map(); this.unknownRows = []; this.scans = 0; this.removed = 0;
    this.task = null; this.controller = null;
    this.scanContinuation = null;
  }
  snapshot() {
    return { status: this.status, message: this.message, owner: this.owner, mode: this.mode,
      waitUntil: this.status === 'running' && this.nextCycleAt > this.now() ? this.nextCycleAt : null,
      scans: this.scans, removed: this.removed, records: [...this.records.values(), ...this.unknownRows] };
  }
  notify(message) { if (message) this.message = message; this.onChange(this.snapshot()); }
  async start(mode, input, keep, approved = new Set()) {
    if (this.task) throw new Error('已有任务运行，请先停止。');
    if (!['scan', 'cleanup'].includes(mode)) throw new Error('无效模式。');
    if (mode === 'cleanup' && !approved.size) throw new Error('请先逐个确认需要取关的账号。');
    const settings = validateSettings(input);
    const owner = this.adapter.scan().owner;
    const continuingScan = mode === 'cleanup' && this.mode === 'scan' && this.status === 'paused';
    if (continuingScan && owner !== this.owner) throw new Error('登录账号已变化，已停止。');
    if (continuingScan && [...approved].some(id => !this.records.has(id))) throw new Error('请先逐个确认需要取关的账号。');
    // 同一个任务所有者暂存扫描进度，取关批次只运行自己的处理集合。
    this.scanContinuation = continuingScan ? {
      settings: this.settings, records: this.records, unknownRows: this.unknownRows,
      processed: this.processed, scans: this.scans, removed: this.removed,
      protectedIds: this.protectedIds, order: this.order, anchor: this.anchor,
      nextCycleAt: this.nextCycleAt, nextInterval: this.nextInterval
    } : null;
    this.settings = settings; this.mode = mode;
    this.nextInterval = createAlternatingInterval(this.random);
    this.keep = new Set(keep); this.approved = new Set(approved);
    this.owner = owner;
    this.records = new Map(); this.processed = new Set(); this.scans = 0; this.removed = 0; this.anchor = null;
    this.unknownRows = []; this.protectedIds = new Set(); this.order = new Set(); this.nextCycleAt = this.now();
    this.status = 'running';
    return this.launch();
  }
  async launch() {
    this.controller = new AbortController();
    this.task = this.run(this.controller.signal);
    try { await this.task; }
    finally {
      this.task = null; this.controller = null;
      if (this.mode === 'cleanup' && this.status === 'finished' && this.scanContinuation) this.restorePausedScan();
      this.notify();
    }
  }
  restorePausedScan() {
    const scan = this.scanContinuation;
    for (const id of this.approved) {
      const row = this.records.get(id);
      if (row) scan.records.set(id, row);
      if (this.processed.has(id)) scan.processed.add(id);
    }
    if (this.anchor) {
      const ids = [...scan.order];
      // 被取关的卡片可能已移出列表，用它前面仍保留的账号定位，再按 ID 去重向下扫。
      // 前缀全部移除时，剩余列表的顶部就是继续位置。
      scan.anchor = null;
      for (let i = ids.indexOf(this.anchor.id) - 1; i >= 0; i--) {
        const row = scan.records.get(ids[i]);
        if (['candidate', 'mutual', 'kept', 'protected'].includes(row.status)) {
          scan.anchor = { id: row.id, handle: row.handle };
          break;
        }
      }
    }
    const removed = this.removed;
    Object.assign(this, scan);
    this.removed += removed;
    this.approved = new Set(); this.mode = 'scan'; this.status = 'paused';
    this.scanContinuation = null;
  }
  async pause() {
    if (!this.task) return;
    this.status = 'paused'; this.controller.abort(new Error('已暂停'));
    await this.task;
  }
  async resume() {
    if (this.task || this.status !== 'paused') throw new Error('当前没有可继续的暂停任务。');
    this.status = 'running';
    this.notify('已继续。');
    return this.launch();
  }
  async stop() {
    this.scanContinuation = null;
    this.status = 'stopped';
    this.controller?.abort(new Error('已停止'));
    if (this.task) await this.task;
    if (this.status !== 'error') this.notify('本轮已停止。');
  }
  async run(signal) {
    try {
      await this.audit({ type: 'run', mode: this.mode, owner: this.owner, settings: this.settings, approved: [...this.approved], anchor: this.anchor });
      const scrollOptions = { signal, owner: this.owner, timeoutMs: 10000,
        minSeconds: this.settings.scanMinSeconds, maxSeconds: this.settings.scanMaxSeconds,
        nextInterval: this.nextInterval,
        onWait: (ms, message) => {
          this.nextCycleAt = this.now() + ms;
          this.notify(ms > 0 ? `${message} 下一轮 ${ms / 1000} 秒后。` : message);
        } };
      if (this.mode === 'scan' && this.anchor) {
        this.notify(`正在翻页定位 @${this.anchor.handle}…`);
        await this.adapter.restorePosition(this.anchor, scrollOptions);
        signal.throwIfAborted();
      } else {
        signal.throwIfAborted();
        await this.adapter.resetPosition({ signal, owner: this.owner, timeoutMs: 10000 });
        signal.throwIfAborted();
      }
      while (true) {
        signal.throwIfAborted();
        if (this.mode === 'cleanup' && this.removed >= this.settings.maxActions) return await this.finish('已到本轮取关数量上限。');
        if (this.now() < this.nextCycleAt) {
          await this.wait(this.nextCycleAt - this.now(), signal);
          continue;
        }
        const snapshot = this.adapter.scan();
        if (snapshot.owner !== this.owner) throw new Error('登录账号已变化，已停止。');
        this.scans++;
        this.unknownRows = snapshot.rows.filter(row => !row.id).map(row => ({ id: null, handle: row.handle, name: row.name, status: 'unknown', reason: row.reason }));
        for (const row of snapshot.rows) {
          if (!row.id) {
            if (this.mode === 'scan' && this.order.size < this.settings.skipFirstCount) throw new Error('列表前部有未加载完整的账号，无法确定前 N 人范围，请加载完成后重扫。');
            continue;
          }
          if (!this.order.has(row.id)) {
            this.order.add(row.id);
            if (this.mode === 'scan' && this.order.size <= this.settings.skipFirstCount) this.protectedIds.add(row.id);
          }
          const status = this.keep.has(row.handle) ? 'kept' : this.protectedIds.has(row.id) ? 'protected' :
            this.mode === 'cleanup' && !this.approved.has(row.id) ? 'scope-excluded' : row.status;
          const previous = this.records.get(row.id);
          this.records.set(row.id, { id: row.id, handle: row.handle, name: row.name, avatarUrl: row.avatarUrl,
            status: this.processed.has(row.id) ? previous.status : status, reason: this.processed.has(row.id) ? previous.reason : row.reason });
        }
        // 只记已读取这一段里的可见账号，暂停在滚动途中也不会越过未读取区域。
        if (this.mode === 'scan' && snapshot.anchor) this.anchor = snapshot.anchor;
        this.notify(`已识别 ${this.records.size} 个账号${this.protectedIds.size ? `，前 ${this.protectedIds.size} 人已跳过` : ''}。`);
        const next = this.mode === 'cleanup' && snapshot.rows.find(row => row.status === 'candidate' &&
          this.approved.has(row.id) && !this.keep.has(row.handle) && !this.processed.has(row.id));
        if (next) {
          signal.throwIfAborted();
          this.notify(`正在处理 @${next.handle}…`);
          let result;
          try {
            result = await this.adapter.unfollow(next, { owner: this.owner, signal,
              timeoutMs: 10000,
              onStage: (stage, evidence) => this.audit({ type: stage, owner: this.owner, id: next.id, handle: next.handle, evidence }) });
          } catch (error) {
            if (error.name === 'OutcomeUnconfirmedError') {
              // 已点击但结果未知的账号保留为待检查，不进入后续执行批次。
              this.records.set(next.id, { id: next.id, handle: next.handle, name: next.name, avatarUrl: next.avatarUrl, status: 'unknown', reason: error.message });
            }
            throw error;
          }
          this.processed.add(next.id);
          if (result.status === 'removed') {
            this.removed++;
            this.anchor = { id: next.id, handle: next.handle };
          }
          this.records.set(next.id, { id: next.id, handle: next.handle, name: next.name, avatarUrl: next.avatarUrl, status: result.status, reason: result.reason });
          await this.audit({ type: result.status, id: next.id, handle: next.handle, reason: result.reason });
          this.notify(result.status === 'removed' ? `已取关 @${next.handle}。` : `已跳过 @${next.handle}。`);
          if ([...this.approved].every(id => this.processed.has(id))) return await this.finish('本批已处理完成，可继续选择其他账号。');
        } else {
          if (!this.settings.autoScroll) return await this.finish('当前已加载区域处理完毕。');
          const continued = await this.adapter.scroll(scrollOptions);
          if (!continued) return await this.finish('已到当前可加载列表末尾。本轮结束。');
        }
        const ms = next
          ? this.nextInterval(this.settings.unfollowMinSeconds, this.settings.unfollowMaxSeconds)
          : this.nextInterval(this.settings.scanMinSeconds, this.settings.scanMaxSeconds);
        this.nextCycleAt = this.now() + ms;
        this.notify(`${this.message} 下一轮 ${ms / 1000} 秒后。`);
      }
    } catch (error) {
      if (signal.aborted && error.name !== 'OutcomeUnconfirmedError') {
        this.notify(`${this.status === 'paused' ? '已暂停' : '已停止'}。${error.message.includes('结果未确认') ? error.message : ''}`);
        await this.audit({ type: this.status, message: this.message });
      } else {
        this.status = 'error'; this.notify(error.message);
        try { await this.audit({ type: 'error', message: error.message }); }
        catch (storageError) { this.notify(`${error.message}；记录保存失败：${storageError.message}`); }
      }
    }
  }
  async finish(message) {
    this.status = 'finished'; this.notify(message);
    await this.audit({ type: 'finished', message, scans: this.scans, removed: this.removed });
  }
}
