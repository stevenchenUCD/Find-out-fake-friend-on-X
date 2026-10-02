export function normalizeHandle(value) {
  const handle = String(value).trim().replace(/^@/, '');
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) throw new Error(`无效账号：${value}`);
  return handle.toLowerCase();
}

export function readOwner(document, location) {
  const url = new URL(location.href);
  const match = url.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/following\/?$/);
  if (url.origin !== 'https://x.com' || !match) throw new Error('请打开自己账号的“正在关注”列表。');
  const profile = document.querySelector('[data-testid="AppTabBar_Profile_Link"]');
  const profilePath = profile && new URL(profile.getAttribute('href'), url).pathname;
  if (!profilePath || profilePath.toLowerCase() !== `/${match[1].toLowerCase()}`) {
    throw new Error('无法确认这是当前登录账号自己的关注列表，已停止。');
  }
  return normalizeHandle(match[1]);
}

function readCell(element) {
  const unknown = reason => ({ id: null, handle: '', name: '', status: 'unknown', reason, element });
  if (element.matches('[aria-busy="true"]') || element.querySelector('[role="progressbar"]')) return unknown('账号卡片尚未加载完整');
  const buttons = [...element.querySelectorAll('button[data-testid]')].filter(b => /^\d+-(?:unfollow|follow)$/.test(b.dataset.testid));
  if (buttons.length !== 1) return unknown('账号或关注按钮结构无法确认');
  const button = buttons[0];
  const labelHandle = button.getAttribute('aria-label')?.match(/@([A-Za-z0-9_]{1,15})(?![A-Za-z0-9_])/);
  if (!labelHandle || button.disabled || button.getAttribute('aria-disabled') === 'true') return unknown('关注按钮尚未就绪');
  const handle = normalizeHandle(labelHandle[1]);
  const identityLinks = [...element.querySelectorAll('a[href]')].filter(a => a.textContent.trim().toLowerCase() === `@${handle}`);
  if (!identityLinks.length) return unknown('关注按钮与账号身份不一致');
  if (!identityLinks.every(a => new URL(a.getAttribute('href'), 'https://x.com').pathname.toLowerCase() === `/${handle}`)) {
    return unknown('账号文字与主页链接不一致');
  }
  const [id, action] = button.dataset.testid.split('-');
  const indicator = element.querySelector('[data-testid="userFollowIndicator"]');
  if (indicator && !indicator.textContent.trim()) return unknown('互关标记尚未加载完整');
  const followsYou = Boolean(indicator);
  const following = action === 'unfollow';
  const nameLink = [...element.querySelectorAll('a[href]')].find(a =>
    a.textContent.trim() && !a.textContent.trim().startsWith('@') &&
    new URL(a.getAttribute('href'), 'https://x.com').pathname.toLowerCase() === `/${handle}`);
  const avatarLink = [...element.querySelectorAll('a[href]')].find(a =>
    new URL(a.getAttribute('href'), 'https://x.com').pathname.toLowerCase() === `/${handle}` &&
    a.querySelector('img[src*="/profile_images/"], img[src*="/default_profile_images/"]'));
  const avatar = avatarLink?.querySelector('img[src*="/profile_images/"], img[src*="/default_profile_images/"]');
  return { id, handle, name: nameLink ? nameLink.textContent.trim() : handle, avatarUrl: avatar?.src ?? '', followsYou, following,
    status: !following ? 'not-following' : followsYou ? 'mutual' : 'candidate', element, button };
}

export function readRows(document, location) {
  const owner = readOwner(document, location);
  const primary = document.querySelector('[data-testid="primaryColumn"]');
  const regions = primary?.querySelectorAll('section[role="region"]');
  if (!regions || regions.length !== 1) throw new Error('关注列表尚未加载完整，或页面结构已变化。');
  const region = regions[0];
  // readOwner 已验证本人 /following 路由；区域标题可使用任意 X 界面语言。
  if (!region.querySelector('h1')?.textContent.trim()) {
    throw new Error('无法确认当前显示的是正在关注列表。');
  }
  const rows = [...region.querySelectorAll('[data-testid="UserCell"]')].map(readCell);
  return { owner, rows, region, loading: Boolean(region.querySelector('[role="progressbar"]')) };
}

function assertPage(document, location, owner) {
  if (readOwner(document, location) !== owner) throw new Error('登录账号已变化，已停止。');
  const alerts = [...document.querySelectorAll('[data-testid="toast"], [role="alert"]')]
    .filter(e => !e.hidden && e.getAttribute('aria-hidden') !== 'true' && e.textContent.trim());
  if (alerts.length) throw new Error(`页面提示，已停止：${alerts[0].textContent.trim().slice(0,240)}`);
}

function dialogs(document) {
  return [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')]
    .filter(e => !e.hidden && e.getAttribute('aria-hidden') !== 'true');
}

function targetDialog(document, handle) {
  const open = dialogs(document);
  if (!open.length) return null;
  const identity = new RegExp(`@${handle}(?![a-z0-9_])`, 'i');
  if (open.length !== 1 || !identity.test(open[0].textContent)) throw new Error('确认弹窗中的账号不匹配，已停止。');
  const confirm = open[0].querySelector('[data-testid="confirmationSheetConfirm"]');
  // 调用方仅点击目标账号的 *-unfollow 按钮；弹窗仍须唯一且账号匹配。
  if (!confirm || !confirm.textContent.trim()) throw new Error('无法识别取关确认弹窗，已停止。');
  return { element: open[0], confirm, cancel: open[0].querySelector('[data-testid="confirmationSheetCancel"]') };
}

export function waitForDom(document, predicate, signal, timeoutMs, timeoutMessage) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    let timer;
    const observer = new document.defaultView.MutationObserver(check);
    function finish(error, value) {
      observer.disconnect();
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      error ? reject(error) : resolve(value);
    }
    function abort() { finish(signal.reason); }
    function check() {
      try { signal.throwIfAborted(); const value = predicate(); if (value) finish(null, value); }
      catch (error) { finish(error); }
    }
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
    signal.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => finish(new Error(timeoutMessage)), timeoutMs);
    check();
  });
}

const UNFOLLOW_STEP_DELAY_MS = 2000;

export async function unfollowOne({ document, location, owner, row, signal, onStage, timeoutMs = 10000, check = () => {} }) {
  const inspect = () => {
    signal.throwIfAborted(); check(); assertPage(document, location, owner);
    const current = readRows(document, location).rows.find(r => r.id === row.id);
    if (!current || current.handle !== row.handle) throw new Error('原账号卡片已变化或移出页面，已停止。');
    return current;
  };
  let current = inspect();
  if (current.status !== 'candidate') return { status: 'skipped', reason: '当前已回关或已不再关注' };
  if (dialogs(document).length) throw new Error('页面已有其他弹窗，请先处理后再开始。');
  await onStage('intent', { id: row.id, handle: row.handle, followsYou: false, following: true });
  await abortableDelay(UNFOLLOW_STEP_DELAY_MS, signal);
  current = inspect();
  if (current.status !== 'candidate') return { status: 'skipped', reason: '关系在操作前已变化' };
  if (dialogs(document).length) throw new Error('页面已有其他弹窗，请先处理后再开始。');
  let dialog;
  let confirmClicked = false;
  try {
    current.button.click();
    dialog = await waitForDom(document, () => {
      assertPage(document, location, owner);
      return targetDialog(document, row.handle);
    }, signal, timeoutMs, '取关确认弹窗未出现，已停止。');
    await onStage('confirm', { id: row.id, handle: row.handle });
    await abortableDelay(UNFOLLOW_STEP_DELAY_MS, signal);
    current = inspect();
    if (current.status !== 'candidate') {
      dialog.cancel?.click();
      return { status: 'skipped', reason: '确认前关系已变化' };
    }
    dialog = targetDialog(document, row.handle);
    if (!dialog || dialog.confirm.disabled) throw new Error('确认按钮已变化或不可操作。');
    signal.throwIfAborted(); check();
    confirmClicked = true;
    dialog.confirm.click();
    await waitForDom(document, () => {
      assertPage(document, location, owner);
      const updated = readRows(document, location).rows.find(r => r.id === row.id && r.handle === row.handle);
      return updated?.status === 'not-following';
    }, signal, timeoutMs, '取关结果未确认：请在 X 页面核对，程序已停止且不会重试。');
    return { status: 'removed' };
  } catch (error) {
    if (!confirmClicked && dialog?.element.isConnected) dialog.cancel?.click();
    if (confirmClicked) {
      const uncertain = new Error(`取关请求已点击，结果未确认：${error.message}`);
      uncertain.name = 'OutcomeUnconfirmedError';
      throw uncertain;
    }
    throw error;
  }
}

export function abortableDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    function abort() { clearTimeout(timer); reject(signal.reason); }
    signal.addEventListener('abort', abort, { once: true });
  });
}

function waitForListUpdate(document, changed, signal, timeoutMs) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    let timer;
    const observer = new document.defaultView.MutationObserver(inspect);
    function finish(error, updated) {
      observer.disconnect();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visibilityChanged);
      signal.removeEventListener('abort', abort);
      error ? reject(error) : resolve(updated);
    }
    function abort() { finish(signal.reason); }
    function inspect() {
      try { signal.throwIfAborted(); if (changed()) finish(null, true); }
      catch (error) { finish(error); }
    }
    function visibilityChanged() {
      // 可见性变化后重新读取列表，之前的静止时间不能证明已经到底。
      try { signal.throwIfAborted(); changed(); finish(null, true); }
      catch (error) { finish(error); }
    }
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
    document.addEventListener('visibilitychange', visibilityChanged);
    signal.addEventListener('abort', abort, { once: true });
    // X 在后台可能暂缓渲染下一页；只等待内容更新或切回前台，不判定末尾。
    if (!document.hidden) timer = setTimeout(() => {
      try { signal.throwIfAborted(); const updated = changed(); finish(null, document.hidden || updated); }
      catch (error) { finish(error); }
    }, timeoutMs);
    inspect();
  });
}

export function createXAdapter(document, location, check = () => {}) {
  const window = document.defaultView;
  const scrollPageTo = async (top, signal, timeoutMs) => {
    signal.throwIfAborted();
    check();
    const destination = Math.max(0, Math.min(top, document.documentElement.scrollHeight - window.innerHeight));
    // 已在目标位置时浏览器不会发出 scrollend。
    if (Math.abs(window.scrollY - destination) < 1) return;
    const scrollInstantly = () => {
      check();
      const target = Math.max(0, Math.min(destination, document.documentElement.scrollHeight - window.innerHeight));
      window.scrollTo({ top: target, left: window.scrollX, behavior: 'instant' });
      if (Math.abs(window.scrollY - target) >= 1) throw new Error('页面滚动未完成，已停止。');
    };
    // 后台标签页不依赖动画帧或 scrollend；直接移动并核对实际位置。
    if (document.hidden) { scrollInstantly(); return; }
    await new Promise((resolve, reject) => {
      const finish = error => {
        window.clearTimeout(timer);
        document.removeEventListener('scrollend', ended);
        document.removeEventListener('visibilitychange', visibilityChanged);
        signal.removeEventListener('abort', aborted);
        if (error) {
          // 在当前位置取消动画，暂停和停止不再继续移动页面。
          window.scrollTo({ top: window.scrollY, left: window.scrollX, behavior: 'instant' });
          reject(error);
        } else resolve();
      };
      const ended = event => {
        if (event.target === document) finish();
      };
      const visibilityChanged = () => {
        if (!document.hidden) return;
        // 平滑滚动途中切走，也立即完成本次位移，继续原来的扫描任务。
        try { scrollInstantly(); finish(); }
        catch (error) { finish(error); }
      };
      const aborted = () => finish(signal.reason);
      document.addEventListener('scrollend', ended);
      document.addEventListener('visibilitychange', visibilityChanged);
      signal.addEventListener('abort', aborted, { once: true });
      const timer = window.setTimeout(() => finish(new Error('页面滚动未完成，已停止。')), timeoutMs);
      window.scrollTo({ top: destination, left: window.scrollX, behavior: 'smooth' });
    });
    signal.throwIfAborted();
  };
  const scan = () => {
    check();
    const result = readRows(document, location); assertPage(document, location, result.owner);
    if (!result.rows.length && result.loading) throw new Error('关注列表正在加载，请加载完成后重新开始。');
    const anchor = result.rows.find(row => {
      if (!row.id) return false;
      const bounds = row.element.getBoundingClientRect();
      return bounds.bottom > 0 && bounds.top < window.innerHeight;
    });
    return { ...result, anchor: anchor ? { id: anchor.id, handle: anchor.handle } : null };
  };
  return {
    scan,
    async resetPosition({ signal, owner, timeoutMs = 10000 }) {
      check();
      assertPage(document, location, owner);
      await scrollPageTo(0, signal, timeoutMs);
      await waitForDom(document, () => {
        assertPage(document, location, owner);
        const snapshot = readRows(document, location);
        if (window.scrollY > 1 || snapshot.loading && !snapshot.rows.length) return false;
        if (!snapshot.rows.length) return true;
        const first = snapshot.rows[0].element.getBoundingClientRect();
        return first.top >= 0 && first.top < window.innerHeight && first.bottom > 0;
      }, signal, timeoutMs, '列表回到顶部的结果未确认，请检查页面后重试。');
    },
    async scroll({ signal, owner, minSeconds, maxSeconds, nextInterval = createAlternatingInterval(), onWait = () => {}, timeoutMs = 10000 }) {
      const inspect = () => { signal.throwIfAborted(); check(); assertPage(document, location, owner); return readRows(document, location); };
      const signature = snapshot => JSON.stringify(snapshot.rows.map(row => [row.id, row.handle, row.status]));
      const listBottom = snapshot => snapshot.region.getBoundingClientRect().bottom + window.scrollY;
      for (let confirmation = 1; confirmation <= 2; confirmation++) {
        const before = inspect();
        const beforeY = window.scrollY;
        const beforeBottom = listBottom(before);
        const beforeRows = signature(before);
        // 整页可能被列表外的布局撑长，只滚到关注列表自身的底部。
        if (beforeBottom > beforeY + window.innerHeight + 1) {
          await scrollPageTo(Math.min(beforeY + Math.min(400, window.innerHeight * 0.5), beforeBottom - window.innerHeight), signal, timeoutMs);
        }
        const current = inspect();
        if (window.scrollY > beforeY + 1) return true;
        const changed = () => {
          const after = inspect();
          return after.loading !== before.loading || signature(after) !== beforeRows ||
            Math.abs(listBottom(after) - beforeBottom) > 1 || Math.abs(window.scrollY - beforeY) > 1;
        };
        if (changed()) return true;
        if (document.hidden) {
          onWait(0, '等待 X 更新列表，进度已保留。');
          await waitForListUpdate(document, changed, signal, timeoutMs);
          return true;
        }
        if (current.loading) {
          onWait(0, '等待 X 更新列表，进度已保留。');
          if (!await waitForListUpdate(document, () => !inspect().loading, signal, timeoutMs)) {
            throw new Error('下一段列表加载未完成，扫描已中断，尚未确认到达末尾。');
          }
          return true;
        }
        if (listBottom(current) > window.scrollY + window.innerHeight + 1) {
          throw new Error('页面尚未到达底部，但滚动没有前进，扫描已中断。');
        }
        const ms = nextInterval(minSeconds, maxSeconds);
        onWait(ms, `正在确认列表末尾（${confirmation}/2）。`);
        if (await waitForListUpdate(document, changed, signal, ms)) return true;
        const after = inspect();
        if (after.rows.some(row => !row.id)) throw new Error('列表中仍有未加载完整的账号，无法确认扫描末尾。');
      }
      return false;
    },
    unfollow(row, options) {
      return unfollowOne({ document, location, row, ...options, check: () => { check(); options.check?.(); } });
    },
    async restorePosition(anchor, options) {
      options.signal.throwIfAborted();
      const snapshot = scan();
      if (snapshot.owner !== options.owner) throw new Error('登录账号已变化，已停止。');
      // 当前页面仍载有原账号时直接定位；否则从列表顶部查找同一账号。
      // 查找只恢复位置，不清空本轮结果，也不将途中账号当成新一轮扫描。
      if (!snapshot.rows.some(row => row.id === anchor.id)) await this.resetPosition(options);
      return this.locate(anchor, options);
    },
    async locate(row, { signal, minSeconds, maxSeconds, owner, onWait, nextInterval = createAlternatingInterval(), timeoutMs = 10000 }) {
      while (true) {
        signal.throwIfAborted();
        const snapshot = scan();
        if (snapshot.owner !== owner) throw new Error('登录账号已变化，已停止。');
        const found = snapshot.rows.find(r => r.id === row.id);
        if (found) {
          const bounds = found.element.getBoundingClientRect();
          await scrollPageTo(window.scrollY + bounds.top - (window.innerHeight - bounds.height) / 2, signal, timeoutMs);
          const located = scan();
          if (located.owner !== owner) throw new Error('登录账号已变化，已停止。');
          const current = located.rows.find(r => r.id === row.id);
          if (!current) throw new Error(`滚动后 @${row.handle} 已移出当前列表，请重新扫描。`);
          const visible = current.element.getBoundingClientRect();
          if (visible.bottom <= 0 || visible.top >= window.innerHeight) throw new Error(`未能将 @${row.handle} 滚动到可见区域，定位已停止。`);
          return current;
        }
        if (!await this.scroll({ signal, owner, minSeconds, maxSeconds, onWait, nextInterval, timeoutMs })) throw new Error(`当前已加载列表中找不到 @${row.handle}，请重新扫描。`);
        await abortableDelay(nextInterval(minSeconds, maxSeconds), signal);
      }
    }
  };
}
import { createAlternatingInterval } from './pacing.js';
