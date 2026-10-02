import { createXAdapter, normalizeHandle, readOwner } from './x-page.js';
import { CleanupSession, DEFAULT_SETTINGS, validateSettings } from './cleanup-session.js';
import { createAlternatingInterval } from './pacing.js';
import { ReviewQueue } from './review-queue.js';
import { LocalStore } from './local-store.js';
import { createI18n, LANGUAGES, localizeElements } from './localization/index.js';
import { assertExtensionActive } from './extension-runtime.js';

let mounted = null;

export async function openPanel({ document = globalThis.document, adapter, storage, cssURL } = {}) {
  const page = adapter ?? createXAdapter(document, document.defaultView.location, assertExtensionActive);
  let owner;
  if (adapter) {
    owner = page.scan().owner;
  } else {
    try { owner = readOwner(document, document.defaultView.location); }
    catch {
      const panel = mounted;
      if (panel) {
        panel.hide();
        if (panel.session.task || panel.operation) await panel.stop();
      }
      return { status: 'needs-page', message: '请切换到自己账号的“正在关注”页面。' };
    }
  }
  if (!mounted || mounted.document !== document || mounted.owner !== owner) page.scan();
  await mountPanel({ document, adapter: page, storage, cssURL, owner });
  return { status: 'opened' };
}

async function mountPanel({ document, adapter, storage, cssURL, owner }) {
  if (mounted && (mounted.document !== document || mounted.owner !== owner)) await mounted.dispose();
  if (!mounted) {
    for (const host of document.querySelectorAll('#fake-friend-panel')) {
      host.dispatchEvent(new document.defaultView.Event('fake-friend:dispose'));
      if (host.isConnected) throw new Error('页面仍有旧版插件任务，请刷新 X 页面后重新打开插件。');
    }
    const store = new LocalStore(storage ?? chrome.storage.local, owner);
    mounted = new Panel(document, adapter, store, owner, cssURL ?? chrome.runtime.getURL('src/panel.css'));
  }
  const panel = mounted;
  panel.show();
  await panel.initializationTask;
  panel.events.signal.throwIfAborted();
  return panel;
}

export async function prepareFollowingPanel({ document, owner }) {
  const panel = await mountPanel({ document, owner, adapter: createXAdapter(document, document.defaultView.location, assertExtensionActive) });
  if (panel.phase === 'navigating') return null;
  const previousPhase = panel.phase;
  const previousStatus = panel.lastStatus;
  panel.phase = 'navigating'; panel.status('正在打开关注列表…'); panel.render();
  return {
    finish(result) {
      if (panel.events.signal.aborted) return;
      if (result.status === 'navigated') {
        panel.phase = previousPhase;
        panel.status(previousStatus.message, previousStatus.error, previousStatus.waitUntil);
      } else {
        panel.phase = 'stopped'; panel.status('已离开识别页面。');
      }
      panel.render();
    },
    fail(error) {
      if (!panel.events.signal.aborted) panel.fail(error);
    }
  };
}

class Panel {
  constructor(document, adapter, store, owner, cssURL) {
    this.document = document; this.adapter = adapter; this.store = store; this.owner = owner;
    this.i18n = createI18n(document.defaultView.navigator);
    this.lastStatus = { message: '读取本地设置…', error: false, waitUntil: null };
    this.phase = 'loading'; this.keep = new Set(); this.keepProfiles = new Map(); this.records = []; this.review = null; this.operation = null;
    this.countdownTimer = null;
    this.noticeTimer = null;
    this.events = new AbortController();
    this.host = document.createElement('div'); this.host.id = 'fake-friend-panel';
    this.host.addEventListener('fake-friend:dispose', () => {
      this.dispose().catch(error => this.fail(error));
    }, { signal: this.events.signal });
    this.root = this.host.attachShadow({ mode: 'open' });
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = cssURL;
    this.root.append(css);
    const layout = document.createElement('div'); layout.className = 'panel'; layout.setAttribute('role', 'region'); layout.dataset.i18nLabel = 'panel';
    layout.innerHTML = `
      <header class="masthead"><h1 class="brand" dir="ltr">Fake Friend<span>.</span></h1><button class="icon" id="close" data-i18n-label="close">×</button>
        <p class="subtitle" data-i18n="subtitle"></p><span class="account" id="account" dir="ltr"></span></header>
      <div class="body"><div class="stats"><div class="stat"><strong id="seen">0</strong><small data-i18n="seen"></small></div><div class="stat"><strong id="candidates">0</strong><small data-i18n="pending"></small></div><div class="stat"><strong id="removed">0</strong><small data-i18n="removed"></small></div></div>
        <div class="status" id="status"><span class="countdown" id="countdown" role="timer" aria-live="off" hidden><small data-i18n="countdown"></small><strong id="countdown-value"></strong></span><span id="status-message" role="status" aria-live="polite"></span></div>
        <div class="row scan-row"><div class="scan-slot"><button class="button" id="scan" data-i18n="scan"></button><div class="scan-controls" id="scan-controls" role="group" data-i18n-label="controls" hidden><button class="button" id="pause" data-i18n="pause"></button><button class="button" id="resume" data-i18n="resume" hidden></button><button class="button" id="stop" data-i18n="stop"></button></div></div><button class="button primary" id="review-start" data-i18n="review"></button></div>
        <div class="tool-tabs" role="tablist" data-i18n-label="tabs"><button class="tool-tab" id="whitelist-tab" role="tab" aria-controls="whitelist-panel"><span data-i18n="keep"></span> <span id="keep-count">0</span></button><button class="tool-tab" id="records-tab" role="tab" aria-controls="records-panel" data-i18n="list"></button><button class="tool-tab" id="settings-tab" role="tab" aria-controls="settings-panel" data-i18n="settings"></button></div>
        <section class="tool-tab-panel" id="whitelist-panel" role="tabpanel" aria-labelledby="whitelist-tab" hidden><div class="list" id="whitelist-list"></div><div class="keep-add-row"><input type="text" id="keep-input" spellcheck="false" autocomplete="off" autocapitalize="off" dir="ltr" data-i18n-label="addKeep" data-i18n-placeholder="keepPlaceholder"><button class="button secondary" id="add-keep" data-i18n="addKeep"></button></div><p class="caption" data-i18n="keepHint"></p></section>
        <section class="tool-tab-panel" id="settings-panel" role="tabpanel" aria-labelledby="settings-tab" hidden><div class="settings">
          <label><span data-i18n="maxActions"></span><input type="number" id="maxActions" min="1" max="10000"></label>
          <label><span data-i18n="skipFirst"></span><input type="number" id="skipFirstCount" min="0" max="10000"></label>
          <label><span data-i18n="scanMin"></span><input type="number" id="scanMinSeconds" min="1" max="9999"></label>
          <label><span data-i18n="scanMax"></span><input type="number" id="scanMaxSeconds" min="2" max="10000"></label>
          <label><span data-i18n="unfollowMin"></span><input type="number" id="unfollowMinSeconds" min="1" max="9999"></label>
          <label><span data-i18n="unfollowMax"></span><input type="number" id="unfollowMaxSeconds" min="2" max="10000"></label></div>
          <label class="check"><input type="checkbox" id="autoScroll"><span data-i18n="autoScroll"></span></label><p class="caption" data-i18n="pacingHint"></p></section>
        <section class="tool-tab-panel" id="records-panel" role="tabpanel" aria-labelledby="records-tab" hidden>
          <section class="review" id="review-card" hidden><small id="review-position"></small><strong id="review-name" dir="auto"></strong><span class="handle" id="review-handle" dir="ltr"></span><p class="hint" id="review-hint" data-i18n="reviewHint"></p>
            <button class="button primary" id="approve" style="width:100%" data-i18n="approve"></button><div class="row"><button class="button secondary" id="keep-person" data-i18n="addKeep"></button><button class="button secondary" id="skip" data-i18n="skip"></button></div></section>
          <button class="button danger" id="execute" style="width:100%" hidden></button>
          <div class="list" id="records"></div>
        </section>
        <div class="footer"><select class="language-select" id="language" data-i18n-label="language"></select><select class="language-select backup-select" id="backup-menu" data-i18n-label="backupMenu"><option value="" disabled selected data-i18n="backupMenu"></option><option value="export" data-i18n="exportBackup"></option><option value="import" id="import-option" data-i18n="importKeep"></option></select><input type="file" id="import-file" accept=".json,application/json" data-i18n-label="importKeep" hidden></div>
      </div><div class="navigation-notice" id="navigation-notice" role="status" aria-live="polite" data-i18n="stayTitle" hidden></div>`;
    this.root.append(layout); document.body.append(this.host);
    for (const language of LANGUAGES) {
      const option = document.createElement('option');
      option.value = language.code; option.textContent = language.name; option.lang = language.code; option.dir = language.dir ?? 'ltr';
      this.$('language').append(option);
    }
    this.$('language').addEventListener('change', event => this.setLanguage(event.target.value), { signal: this.events.signal });
    this.$('account').textContent = `@${owner}`;
    this.session = new CleanupSession({ adapter, audit: event => store.audit(event), onChange: state => {
      if (state.mode === 'cleanup') {
        // 每批执行只回写本批目标，完整扫描名单继续由面板持有。
        const updates = new Map(state.records.filter(row => this.session.approved.has(row.id)).map(row => [row.id, row]));
        this.records = this.records.map(row => updates.get(row.id) ?? row);
      } else {
        this.records = state.records;
      }
      if (state.mode === 'scan' && this.review) {
        this.review.syncRows(state.records.filter(row => row.status === 'candidate' && !this.keep.has(row.handle)));
      }
      if (['finished', 'error', 'stopped', 'paused'].includes(state.status)) this.phase = state.status;
      if (['finished', 'error', 'stopped'].includes(state.status)) this.hideNavigationNotice();
      this.status(state.message, state.status === 'error', state.waitUntil); this.render();
    } });
    const on = (id, fn) => this.$(id).addEventListener('click', () => { Promise.resolve(fn()).catch(error => this.fail(error)); }, { signal: this.events.signal });
    const command = (id, action) => on(id, () => this.runOperation(action));
    command('scan', signal => this.scan(signal)); command('review-start', signal => this.startReview(signal)); command('approve', signal => this.decide('remove', signal));
    command('keep-person', signal => this.decide('keep', signal)); command('skip', signal => this.decide('skip', signal)); command('execute', signal => this.execute(signal));
    on('pause', () => this.pause()); command('resume', signal => this.resume(signal)); on('stop', () => this.stop());
    on('close', () => { this.hide(); return this.pause(); }); command('add-keep', signal => this.addKeep(signal));
    this.$('keep-input').addEventListener('input', () => this.render(), { signal: this.events.signal });
    this.$('keep-input').addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); this.$('add-keep').click(); }
    }, { signal: this.events.signal });
    this.$('whitelist-list').addEventListener('click', event => {
      const button = event.target.closest('button[data-remove-keep]');
      if (!button || button.disabled) return;
      this.runOperation(signal => this.removeKeep(button.dataset.removeKeep, signal)).catch(error => this.fail(error));
    }, { signal: this.events.signal });
    this.$('backup-menu').addEventListener('change', event => {
      const action = event.target.value;
      event.target.value = '';
      if (action === 'import') {
        this.$('import-file').value = '';
        this.$('import-file').click();
      } else if (action === 'export') {
        this.runOperation(signal => this.export(signal)).catch(error => this.fail(error));
      }
    }, { signal: this.events.signal });
    this.$('import-file').addEventListener('change', event => {
      const file = event.target.files[0];
      event.target.value = '';
      if (file) this.runOperation(signal => this.importKeep(file, signal)).catch(error => this.fail(error));
    }, { signal: this.events.signal });
    const tabs = ['whitelist', 'records', 'settings'];
    for (const [index, name] of tabs.entries()) {
      on(`${name}-tab`, () => this.selectTab(name));
      this.$(`${name}-tab`).addEventListener('keydown', event => {
        const next = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1 }[event.key];
        if (next === undefined) return;
        event.preventDefault(); this.selectTab(tabs[next]); this.$(`${tabs[next]}-tab`).focus();
      }, { signal: this.events.signal });
    }
    this.selectTab('records');
    this.$('records').addEventListener('click', event => {
      const button = event.target.closest('button[data-choice]');
      if (!button || button.disabled) return;
      this.runOperation(signal => this.chooseFromList(button.dataset.accountId, button.dataset.choice, signal)).catch(error => this.fail(error));
    }, { signal: this.events.signal });
    this.$('skipFirstCount').addEventListener('change', () => {
      this.review = null; this.records = []; this.clearHighlight(); this.phase = 'idle';
      this.status('跳过范围已改变，请重新扫描，再逐个确认。'); this.render();
    }, { signal: this.events.signal });
    document.defaultView.addEventListener('pagehide', event => {
      this.hide();
      const closing = event.persisted ? this.stop() : this.dispose();
      closing.catch(error => this.fail(error));
    }, { signal: this.events.signal });
    this.setLanguage(this.i18n.locale);
    this.initializationTask = this.init();
  }
  $(id) { return this.root.getElementById(id); }
  get scanInProgress() {
    return this.session.mode === 'scan' && (Boolean(this.session.task) || this.session.status === 'paused');
  }
  get reviewReady() {
    const pausedScan = this.phase === 'paused' && this.session.mode === 'scan' && this.session.status === 'paused';
    return (!this.scanInProgress || pausedScan) && !this.session.task && this.approvedIds.size > 0 &&
      (pausedScan || ['idle', 'choosing', 'reviewing', 'reviewed', 'finished', 'stopped'].includes(this.phase));
  }
  get approvedIds() {
    const selected = this.review?.approvedIds() ?? new Set();
    return new Set(this.records.filter(row => row.status === 'candidate' && !this.keep.has(row.handle) && selected.has(row.id)).map(row => row.id));
  }
  listChoicesAvailable() {
    if (['scanning', 'paused'].includes(this.phase)) return this.session.mode === 'scan';
    if (this.phase === 'error') return this.session.mode === 'scan' && !this.session.task;
    return ['idle', 'finished', 'stopped', 'choosing', 'reviewing', 'reviewed'].includes(this.phase);
  }
  setLanguage(locale) {
    this.i18n.setLocale(locale);
    const layout = this.root.querySelector('.panel');
    layout.lang = this.i18n.locale; layout.dir = this.i18n.dir;
    this.$('language').value = this.i18n.locale;
    localizeElements(this.root, this.i18n);
    const { message, error, waitUntil } = this.lastStatus;
    this.status(message, error, waitUntil);
    this.render();
  }
  selectTab(selected) {
    for (const name of ['whitelist', 'records', 'settings']) {
      const active = name === selected;
      this.$(`${name}-tab`).setAttribute('aria-selected', String(active));
      this.$(`${name}-tab`).tabIndex = active ? 0 : -1;
      this.$(`${name}-panel`).hidden = !active;
    }
  }
  async runOperation(action) {
    if (this.operation) throw new Error('请等待当前操作结束。');
    const operation = { controller: new AbortController(), task: null };
    this.operation = operation;
    operation.task = (async () => {
      try { await action(operation.controller.signal); }
      catch (error) {
        if (!operation.controller.signal.aborted) {
          if (this.scanInProgress) await this.session.stop();
          this.fail(error);
        }
      }
      finally { this.operation = null; this.render(); }
    })();
    return operation.task;
  }
  async init() {
    try {
      const config = await this.store.load(); this.keep = config.keep; this.keepProfiles = config.keepProfiles;
      for (const [key, value] of Object.entries(config.settings)) {
        if (key === 'autoScroll') this.$(key).checked = value; else this.$(key).value = value;
      }
      this.phase = 'idle'; this.status('先扫描名单，再逐个定位确认。'); this.render();
    } catch (error) { this.fail(error); }
  }
  readSettings() {
    const settings = {};
    for (const key of Object.keys(DEFAULT_SETTINGS)) settings[key] = key === 'autoScroll' ? this.$(key).checked : Number(this.$(key).value);
    return validateSettings(settings);
  }
  clearCountdown() {
    this.document.defaultView.clearTimeout(this.countdownTimer);
    this.countdownTimer = null;
    this.$('countdown').hidden = true;
    this.$('countdown-value').textContent = '';
  }
  hideNavigationNotice() {
    this.document.defaultView.clearTimeout(this.noticeTimer);
    this.noticeTimer = null;
    this.$('navigation-notice').hidden = true;
  }
  showNavigationNotice() {
    this.hideNavigationNotice();
    this.$('navigation-notice').hidden = false;
    this.noticeTimer = this.document.defaultView.setTimeout(() => this.hideNavigationNotice(), 5000);
  }
  status(message, error = false, waitUntil = null) {
    this.lastStatus = { message, error, waitUntil };
    this.clearCountdown();
    this.$('status-message').textContent = this.i18n.message(message);
    this.$('status').dataset.error = String(error);
    if (waitUntil === null) return;
    const tick = () => {
      const remainingMs = waitUntil - Date.now();
      if (remainingMs <= 0) { this.clearCountdown(); return; }
      this.$('countdown-value').textContent = this.i18n.t('seconds', { count: Math.ceil(remainingMs / 1000) });
      this.$('countdown').hidden = false;
      this.countdownTimer = this.document.defaultView.setTimeout(tick, Math.min(1000, remainingMs));
    };
    tick();
  }
  fail(error) { this.hideNavigationNotice(); this.phase = 'error'; this.status(error.message, true); this.render(); }
  clearHighlight() {
    if (this.highlight) { this.highlight.element.style.outline = this.highlight.outline; this.highlight.element.style.outlineOffset = this.highlight.offset; this.highlight = null; }
  }
  profileForKeep(handle, row = this.records.find(record => record.handle === handle)) {
    const saved = this.keepProfiles.get(handle);
    const profile = saved ? { ...saved } : { handle, name: handle, avatarUrl: '' };
    if (row?.name) profile.name = row.name;
    if (row?.avatarUrl) profile.avatarUrl = row.avatarUrl;
    return profile;
  }
  async scan(signal) {
    this.phase = 'scanning'; this.records = []; this.review = new ReviewQueue([]); this.clearHighlight(); this.render();
    this.showNavigationNotice();
    const settings = this.readSettings(); await this.store.save(settings, this.keep); signal.throwIfAborted();
    await this.store.beginRun('scan'); signal.throwIfAborted();
    // 扫描生命周期由 CleanupSession 持有；面板操作只负责启动和保存选择。
    void this.session.start('scan', settings, this.keep).catch(error => this.fail(error));
  }
  async importKeep(file, signal) {
    this.phase = 'saving'; this.render();
    const imported = this.store.readKeepBackup(await file.text());
    signal.throwIfAborted();
    const keep = new Set([...this.keep, ...imported.keep]);
    const added = keep.size - this.keep.size;
    await this.persistKeep(keep, imported.keepProfiles, signal);
    this.status(`白名单已导入，新增 ${added} 人。确认名单已重置，请重新逐个确认。`);
  }
  async addKeep(signal) {
    const handles = this.$('keep-input').value.split(/[\s,，;；]+/).filter(Boolean).map(normalizeHandle);
    if (!handles.length) throw new Error(`无效账号：${this.$('keep-input').value}`);
    const profiles = new Map(handles.map(handle => [handle, this.profileForKeep(handle)]));
    await this.persistKeep(new Set([...this.keep, ...handles]), profiles, signal);
    this.$('keep-input').value = '';
    this.status('白名单已保存。确认名单已重置，请重新逐个确认。');
  }
  async removeKeep(handle, signal) {
    const keep = new Set(this.keep); keep.delete(handle);
    await this.persistKeep(keep, new Map(), signal);
    this.status(`@${handle} 已移出白名单，已自动保存。`);
  }
  async persistKeep(keep, updatedProfiles, signal) {
    this.phase = 'saving'; this.render();
    const profiles = new Map([...this.keepProfiles, ...updatedProfiles].filter(([handle]) => keep.has(handle)));
    await this.store.save(this.readSettings(), keep, profiles);
    this.keep = keep; this.keepProfiles = profiles; this.review = null; this.clearHighlight();
    signal.throwIfAborted();
    this.phase = 'idle';
    this.render();
  }
  async prepareReview(signal) {
    signal.throwIfAborted();
    const rows = this.records.filter(r => r.status === 'candidate' && !this.keep.has(r.handle));
    if (this.review) this.review.syncRows(rows);
    else this.review = new ReviewQueue(rows);
    if (!this.review.totalCount) throw new Error('当前没有需要确认的未回关账号。');
  }
  async startReview(signal) {
    if (this.scanInProgress) throw new Error('请先结束扫描或当前操作，再选择名单。');
    this.selectTab('records');
    this.reviewSettings = this.readSettings();
    this.nextReviewInterval = createAlternatingInterval();
    this.phase = 'locating'; this.render();
    this.showNavigationNotice();
    await this.prepareReview(signal);
    signal.throwIfAborted();
    await this.adapter.resetPosition({ signal, owner: this.owner, timeoutMs: 10000 });
    signal.throwIfAborted();
    await this.locateCurrent(signal);
  }
  async locateCurrent(signal) {
    signal.throwIfAborted();
    if (!this.review.current) {
      this.clearHighlight(); this.phase = 'reviewed';
      const count = this.approvedIds.size;
      this.status(`本轮选择已完成：${count} 人加入清理名单。点击“开始执行”后才会取关。`); this.render(); return;
    }
    // 保存选择期间也可隐藏面板；保存完成后，下一人的定位须等待手动继续。
    if (this.host.hidden) {
      this.clearHighlight(); this.phase = 'review-paused';
      this.status('定位已暂停。'); this.render(); return;
    }
    this.clearHighlight(); this.phase = 'locating'; this.render();
    const current = this.review.current;
    this.status(`正在翻页定位 @${current.handle}…`);
      const found = await this.adapter.locate(current, { signal, owner: this.owner,
        minSeconds: this.reviewSettings.scanMinSeconds, maxSeconds: this.reviewSettings.scanMaxSeconds,
        nextInterval: this.nextReviewInterval,
        onWait: (ms, message) => this.status(ms > 0 ? `${message} 下一轮 ${ms / 1000} 秒后。` : message, false, ms > 0 ? Date.now() + ms : null) });
      signal.throwIfAborted();
      this.highlight = { element: found.element, outline: found.element.style.outline, offset: found.element.style.outlineOffset };
      found.element.style.outline = '3px solid #b35b3f'; found.element.style.outlineOffset = '-4px';
      this.phase = 'reviewing';
      this.status(`已定位 @${current.handle}，请在原页面核对。`);
      this.$('approve').dataset.eligible = String(found.status === 'candidate' && !this.keep.has(found.handle));
      this.$('review-hint').dataset.i18n = found.status === 'candidate' ? 'reviewHint' : 'reviewChanged';
      this.$('review-hint').textContent = this.i18n.t(this.$('review-hint').dataset.i18n);
      this.render();
  }
  async decide(choice, signal) {
    const current = this.review.current;
    if (this.phase !== 'reviewing' || !current) throw new Error('请等待定位到当前账号。');
    const fresh = this.adapter.scan();
    if (fresh.owner !== this.owner) throw new Error('登录账号已变化，已停止。');
    const row = fresh.rows.find(r => r.id === current.id && r.handle === current.handle);
    if (!row) throw new Error('当前账号已移出页面，请停止后重新确认。');
    if (choice === 'remove' && (row.status !== 'candidate' || this.keep.has(row.handle))) throw new Error('此人当前不满足取关条件，请保留或跳过。');
    await this.recordDecision(current, choice, signal);
    await this.locateCurrent(signal);
  }
  async chooseFromList(id, choice, signal) {
    if (!this.listChoicesAvailable()) throw new Error('请先结束扫描或当前操作，再选择名单。');
    const continueReview = this.phase === 'reviewing';
    const clearDecision = choice === 'remove' && this.review?.decisions.get(id) === 'remove';
    const decision = clearDecision ? null : choice;
    const current = this.records.find(row => row.id === id && row.status === 'candidate');
    if (!current || this.keep.has(current.handle)) throw new Error('此人当前不在待处理范围内。');
    const fresh = this.adapter.scan();
    if (fresh.owner !== this.owner) throw new Error('登录账号已变化，已停止。');
    const visible = fresh.rows.find(row => row.id === current.id);
    if (decision === 'remove' && visible && (visible.handle !== current.handle || visible.status !== 'candidate')) throw new Error('此人的关注关系已变化，请重新扫描。');
    if (!this.scanInProgress) this.phase = 'saving';
    this.render();
    await this.prepareReview(signal);
    await this.recordDecision(current, decision, signal);
    if (this.scanInProgress) { this.render(); return; }
    if (!clearDecision && (continueReview || this.review.complete)) return this.locateCurrent(signal);
    if (clearDecision) this.clearHighlight();
    this.phase = 'choosing';
    this.status(`已记录 @${current.handle} 的选择，还剩 ${this.review.pendingCount} 人待确认。可继续在名单中选择，或点击“逐个确认”。`);
    this.render();
  }
  async recordDecision(current, choice, signal) {
    if (![null, 'remove', 'keep', 'skip'].includes(choice)) throw new Error('无效的确认选择。');
    if (!this.scanInProgress) this.phase = 'saving';
    this.render();
    if (choice === 'keep') {
      const keep = new Set([...this.keep, current.handle]);
      const profile = this.profileForKeep(current.handle);
      await this.store.save(this.readSettings(), keep, new Map([[current.handle, profile]]));
      this.keep = keep; this.keepProfiles.set(current.handle, profile);
      this.review.choose(current.id, choice);
      signal.throwIfAborted();
    }
    await this.store.audit({ type: 'review', id: current.id, handle: current.handle, choice });
    this.review.choose(current.id, choice);
    signal.throwIfAborted();
  }
  async execute(signal) {
    const approved = this.approvedIds;
    if (!approved.size) throw new Error('确认名单为空。');
    if (!this.reviewReady) throw new Error('请先结束扫描或当前操作，再选择名单。');
    const settings = this.readSettings();
    this.phase = 'executing'; this.clearHighlight(); this.render();
    this.showNavigationNotice();
    await this.store.save(settings, this.keep); signal.throwIfAborted();
    await this.store.beginRun('cleanup'); signal.throwIfAborted();
    await this.session.start('cleanup', settings, this.keep, approved);
  }
  async pause() {
    this.hideNavigationNotice();
    this.clearCountdown();
    if (this.phase === 'locating') { this.phase = 'review-paused'; this.operation?.controller.abort(new Error('已暂停定位')); this.status('定位已暂停。'); this.render(); }
    // 启动前尚在保存设置时，取消启动，避免隐藏后才开始翻页。
    else if (['scanning', 'executing'].includes(this.phase) && !this.session.task) await this.stop();
    else await this.session.pause();
  }
  async resume(signal) {
    this.showNavigationNotice();
    if (this.phase === 'review-paused') {
      this.phase = 'locating'; this.render();
      if (this.review.current) await this.adapter.restorePosition(this.review.current, { signal, owner: this.owner,
        minSeconds: this.reviewSettings.scanMinSeconds, maxSeconds: this.reviewSettings.scanMaxSeconds,
        nextInterval: this.nextReviewInterval,
        onWait: (ms, message) => this.status(ms > 0 ? `${message} 下一轮 ${ms / 1000} 秒后。` : message, false, ms > 0 ? Date.now() + ms : null) });
      signal.throwIfAborted();
      return this.locateCurrent(signal);
    }
    this.phase = this.session.mode === 'scan' ? 'scanning' : 'executing'; this.render();
    if (this.session.mode === 'scan') {
      if (this.store.run.kind !== 'scan') {
        await this.store.beginRun('scan'); signal.throwIfAborted();
      }
      void this.session.resume().catch(error => this.fail(error));
    } else await this.session.resume();
  }
  async stop() {
    this.hideNavigationNotice();
    this.clearCountdown();
    const operation = this.operation;
    operation?.controller.abort(new Error('已停止'));
    await this.session.stop();
    if (operation) await operation.task;
    this.clearHighlight(); this.phase = this.session.status === 'error' ? 'error' : 'stopped'; this.render();
  }
  hide() {
    this.host.hidden = true;
  }
  show() {
    if (!this.host.isConnected) this.document.body.append(this.host);
    this.host.hidden = false;
  }
  async dispose() {
    this.events.abort(); this.host.remove();
    if (mounted === this) mounted = null;
    await this.stop();
  }
  async export(signal) {
    const data = await this.store.exportData();
    signal.throwIfAborted();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = this.document.createElement('a');
    a.href = url; a.download = `Fake-Friend-${this.owner}-${new Date().toISOString().slice(0,10)}.json`;
    a.click(); URL.revokeObjectURL(url);
  }
  createAccountIdentity(row) {
    const identity = this.document.createElement('div'); identity.className = 'identity';
    if (row.avatarUrl) {
      const avatar = this.document.createElement('img'); avatar.className = 'avatar';
      avatar.src = row.avatarUrl; avatar.alt = ''; avatar.width = 32; avatar.height = 32;
      avatar.loading = 'lazy'; avatar.decoding = 'async';
      identity.append(avatar);
    }
    const text = this.document.createElement('div'); text.className = 'identity-text';
    const name = this.document.createElement('strong'); name.textContent = row.name || this.i18n.t('unknown'); name.dir = 'auto';
    const handle = this.document.createElement('small');
    handle.textContent = row.handle ? `@${row.handle}` : this.i18n.message(row.reason);
    handle.dir = row.handle ? 'ltr' : this.i18n.dir;
    text.append(name, handle); identity.append(text);
    return identity;
  }
  renderKeepList(disabled) {
    const list = this.$('whitelist-list'); list.replaceChildren();
    for (const handle of this.keep) {
      const item = this.document.createElement('div'); item.className = 'item';
      const heading = this.document.createElement('div'); heading.className = 'item-heading';
      const profile = this.keepProfiles.get(handle) ?? { handle, name: handle, avatarUrl: '' };
      const remove = this.document.createElement('button'); remove.className = 'choice keep-remove';
      remove.dataset.removeKeep = handle; remove.textContent = this.i18n.t('removeKeep');
      remove.setAttribute('aria-label', `${this.i18n.t('removeKeep')} @${handle}`); remove.disabled = disabled;
      heading.append(this.createAccountIdentity(profile), remove); item.append(heading); list.append(item);
    }
    if (!this.keep.size) {
      const empty = this.document.createElement('p'); empty.className = 'caption'; empty.textContent = this.i18n.t('keepEmpty'); list.append(empty);
    }
  }
  render() {
    const t = this.i18n.t;
    const active = Boolean(this.operation) || Boolean(this.session.task) || ['loading', 'navigating', 'saving', 'scanning', 'executing', 'locating'].includes(this.phase);
    const reviewing = this.phase === 'reviewing' && !this.operation;
    const paused = ['paused', 'review-paused'].includes(this.phase);
    const showControls = ['scanning', 'executing', 'locating', 'paused', 'review-paused', 'reviewing', 'choosing', 'reviewed'].includes(this.phase);
    this.$('scan').hidden = showControls;
    this.$('scan-controls').hidden = !showControls;
    this.$('pause').hidden = paused;
    this.$('resume').hidden = !paused;
    const candidates = this.records.filter(r => r.status === 'candidate' && !this.keep.has(r.handle));
    this.$('seen').textContent = String(this.records.filter(r => r.id).length);
    this.$('candidates').textContent = String(this.review ? this.review.pendingCount : candidates.length);
    this.$('removed').textContent = String(this.records.filter(row => row.status === 'removed').length);
    this.$('scan').disabled = active || reviewing || paused;
    this.$('review-start').disabled = active || reviewing || paused || !(this.review ? this.review.pendingCount : candidates.length);
    this.$('add-keep').disabled = active || reviewing || paused || !this.$('keep-input').value.trim();
    this.$('backup-menu').disabled = Boolean(this.operation) || ['loading', 'navigating'].includes(this.phase);
    this.$('import-option').disabled = active || reviewing || paused;
    this.$('keep-input').disabled = active || reviewing || paused;
    this.$('keep-count').textContent = String(this.keep.size);
    this.renderKeepList(active || reviewing || paused);
    for (const key of Object.keys(DEFAULT_SETTINGS)) this.$(key).disabled = active || reviewing || paused;
    this.$('pause').disabled = !['scanning', 'executing', 'locating'].includes(this.phase);
    this.$('resume').disabled = !paused || Boolean(this.operation) || Boolean(this.session.task);
    this.$('stop').disabled = ['idle', 'loading', 'navigating', 'stopped'].includes(this.phase);
    this.$('review-card').hidden = !this.review?.current || !['reviewing', 'locating', 'review-paused', 'saving'].includes(this.phase);
    for (const key of ['approve', 'keep-person', 'skip']) this.$(key).disabled = !reviewing;
    if (reviewing && this.$('approve').dataset.eligible !== 'true') this.$('approve').disabled = true;
    if (this.review?.current) {
      this.$('review-position').textContent = t('reviewPosition', { current: this.review.position + 1, total: this.review.totalCount });
      this.$('review-name').textContent = this.review.current.name || this.review.current.handle;
      this.$('review-handle').textContent = `@${this.review.current.handle}`;
    }
    const approved = this.approvedIds.size;
    this.$('execute').hidden = !approved;
    this.$('execute').disabled = !this.reviewReady || active;
    this.$('execute').textContent = t('executeCount', { count: approved });
    const list = this.$('records'); list.replaceChildren();
    const relevant = this.records.filter(r => !this.keep.has(r.handle) && this.review?.decisions.get(r.id) !== 'skip' &&
      ['candidate','removed','skipped','unknown','protected'].includes(r.status));
    const canChoose = !this.operation && this.listChoicesAvailable();
    for (const row of relevant) {
      const item = this.document.createElement('div'); item.className = 'item';
      const heading = this.document.createElement('div'); heading.className = 'item-heading';
      const identity = this.createAccountIdentity(row);
      const tag = this.document.createElement('span'); tag.className = `tag ${row.status === 'removed' ? 'done' : ''}`;
      const decision = this.review?.decisions.get(row.id);
      tag.textContent = t(row.status === 'candidate' ? (decision === 'remove' ? 'confirmed' : 'pending') :
        ({ removed: 'removed', skipped: 'skipped', unknown: 'needsCheck', protected: 'protected' })[row.status]);
      heading.append(identity, tag); item.append(heading);
      if (row.status === 'candidate') {
        const actions = this.document.createElement('div'); actions.className = 'item-actions';
        for (const [choice, label] of [['skip', t('skipShort')], ['keep', t('keep')], ['remove', t('fakeFriend')]]) {
          const button = this.document.createElement('button'); button.className = 'choice'; button.textContent = label;
          button.dataset.accountId = row.id; button.dataset.choice = choice;
          button.setAttribute('aria-pressed', String(this.keep.has(row.handle) ? choice === 'keep' : decision === choice));
          button.disabled = !canChoose || this.keep.has(row.handle);
          actions.append(button);
        }
        item.append(actions);
      }
      list.append(item);
    }
    if (!relevant.length) { const empty = this.document.createElement('p'); empty.className = 'caption'; empty.textContent = t(this.records.length ? 'errorNoCandidates' : 'empty'); list.append(empty); }
  }
}
