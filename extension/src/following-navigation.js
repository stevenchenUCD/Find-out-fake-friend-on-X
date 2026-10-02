import { abortableDelay, normalizeHandle, readRows, waitForDom } from './x-page.js';
import { randomIntervalMs } from './pacing.js';
import { createI18n } from './localization/index.js';
import { assertExtensionActive } from './extension-runtime.js';

export async function openOwnFollowing(document) {
  let presentation;
  try {
    const { prepareFollowingPanel } = await import('./panel.js');
    const result = await navigateToOwnFollowing({ document, check: assertExtensionActive, onAccount: async account => {
      presentation = await prepareFollowingPanel({ document, owner: account.handle });
      return presentation !== null;
    } });
    presentation?.finish(result);
  } catch (error) {
    if (presentation) presentation.fail(error);
    else showNavigationError(document, error.message, chrome.runtime.getURL('src/following-navigation.css'));
  }
}

export async function navigateToOwnFollowing({ document, timeoutMs = 10000, wait = abortableDelay, random = Math.random, onAccount = async () => {}, check = () => {} }) {
  const window = document.defaultView;
  if (window.location.origin !== 'https://x.com') throw new Error('请在 X 页面识别个人资料入口。');
  const controller = new window.AbortController();
  const entryURL = window.location.href;
  const cancel = () => controller.abort(new Error('已离开识别页面。'));
  window.addEventListener('pagehide', cancel, { once: true });
  const readAccount = () => {
    check();
    const link = document.querySelector('[data-testid="AppTabBar_Profile_Link"]');
    const href = link?.getAttribute('href');
    if (!href) return false;
    const profile = new URL(href, window.location.href);
    const match = profile.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/?$/);
    if (profile.origin !== 'https://x.com' || !match) throw new Error('个人资料入口无法识别，请检查 X 页面后重新点击。');
    return { link, handle: normalizeHandle(match[1]) };
  };
  try {
    const account = await waitForDom(document, readAccount, controller.signal, timeoutMs,
      '未找到当前登录账号的个人资料入口。请先登录 X，等待页面加载后，再点击插件里的“前往我的关注列表”。');
    if (window.location.href !== entryURL) return { status: 'cancelled' };
    if (await onAccount(account) === false) return { status: 'cancelled' };
    controller.signal.throwIfAborted();
    if (window.location.href !== entryURL) return { status: 'cancelled' };
    const profilePath = `/${account.handle}`;
    const followingPath = `${profilePath}/following`;
    const followingEntryPages = new Set([profilePath, `${profilePath}/followers`, `${profilePath}/verified_followers`]);
    const clickAfterWait = async (expectedURL, readLink, waitMs) => {
      if (waitMs > 0) await wait(waitMs, controller.signal);
      controller.signal.throwIfAborted();
      if (window.location.href !== expectedURL) return false;
      const current = readAccount();
      if (!current || current.handle !== account.handle) throw new Error('当前登录账号已变化，自动跳转已停止。');
      const link = readLink(current);
      if (!link?.isConnected) throw new Error('页面入口已变化，自动跳转已停止。');
      link.click();
      return true;
    };
    const readFollowing = () => {
      check();
      if (!followingEntryPages.has(window.location.pathname.replace(/\/$/, '').toLowerCase())) return false;
      return [...document.querySelectorAll('[data-testid="primaryColumn"] a[href]')].find(link => {
        const url = new URL(link.getAttribute('href'), window.location.href);
        return url.origin === 'https://x.com' && url.pathname.replace(/\/$/, '').toLowerCase() === followingPath && (!link.target || link.target === '_self');
      });
    };
    const currentPath = window.location.pathname.replace(/\/$/, '').toLowerCase();
    if (currentPath !== followingPath) {
      if (!followingEntryPages.has(currentPath)) {
        if (!await clickAfterWait(entryURL, current => current.link, randomIntervalMs(3, 5, random) / 2)) return { status: 'cancelled' };
      }
      await waitForDom(document, readFollowing, controller.signal, timeoutMs, '当前页面的“正在关注”入口尚未出现，请等待页面加载后再试。');
      if (!await clickAfterWait(window.location.href, readFollowing, 0)) return { status: 'cancelled' };
    }
    await waitForDom(document, () => {
      check();
      if (window.location.pathname.replace(/\/$/, '').toLowerCase() !== followingPath) return false;
      const regions = document.querySelectorAll('[data-testid="primaryColumn"] section[role="region"]');
      if (!regions.length || regions.length === 1 && !regions[0].querySelector('h1')?.textContent.trim()) return false;
      return !readRows(document, window.location).loading;
    }, controller.signal, timeoutMs, '关注列表尚未打开，请检查 X 页面后再试。');
    const url = `https://x.com${followingPath}`;
    return { status: 'navigated', url };
  } catch (error) {
    if (controller.signal.aborted) return { status: 'cancelled' };
    throw error;
  } finally {
    window.removeEventListener('pagehide', cancel);
  }
}

export function showNavigationError(document, message, cssURL) {
  const i18n = createI18n(document.defaultView.navigator);
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = cssURL;
  const card = document.createElement('section'); card.className = 'navigation-error'; card.setAttribute('role', 'alert'); card.lang = i18n.locale; card.dir = i18n.dir;
  const title = document.createElement('strong'); title.textContent = `Fake Friend · ${i18n.t('navigationError')}`;
  const reason = document.createElement('p'); reason.textContent = i18n.message(message);
  const close = document.createElement('button'); close.textContent = i18n.t('acknowledge'); close.addEventListener('click', () => host.remove(), { once: true });
  card.append(title, reason, close); root.append(style, card); document.body.append(host);
}
