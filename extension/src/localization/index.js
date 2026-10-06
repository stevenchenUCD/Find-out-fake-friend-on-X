import en from './en.js';
import zh from './zh.js';
import hi from './hi.js';
import es from './es.js';
import ar from './ar.js';
import fr from './fr.js';
import bn from './bn.js';
import pt from './pt.js';
import id from './id.js';
import ur from './ur.js';
import ru from './ru.js';
import de from './de.js';
import ja from './ja.js';
import pcm from './pcm.js';
import arEG from './ar-EG.js';
import mr from './mr.js';
import vi from './vi.js';
import te from './te.js';
import sw from './sw.js';
import ha from './ha.js';

const catalogs = { en, zh, hi, es, ar, fr, bn, pt, id, ur, ru, de, ja, pcm, 'ar-EG': arEG, mr, vi, te, sw, ha };

export const LANGUAGES = Object.freeze([
  { code: 'en', name: 'English' },
  { code: 'zh', name: '中文' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'es', name: 'Español' },
  { code: 'ar', name: 'العربية', dir: 'rtl' },
  { code: 'fr', name: 'Français' },
  { code: 'bn', name: 'বাংলা' },
  { code: 'pt', name: 'Português' },
  { code: 'id', name: 'Bahasa Indonesia' },
  { code: 'ur', name: 'اردو', dir: 'rtl' },
  { code: 'ru', name: 'Русский' },
  { code: 'de', name: 'Deutsch' },
  { code: 'ja', name: '日本語' },
  { code: 'pcm', name: 'Naijá' },
  { code: 'ar-EG', name: 'مصري', dir: 'rtl' },
  { code: 'mr', name: 'मराठी' },
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'te', name: 'తెలుగు' },
  { code: 'sw', name: 'Kiswahili' },
  { code: 'ha', name: 'Hausa' }
]);

export function detectLocale(navigator) {
  const aliases = { cmn: 'zh', arb: 'ar', arz: 'ar-EG', in: 'id' };
  for (const value of [...navigator.languages, navigator.language]) {
    const tag = value.toLowerCase().replaceAll('_', '-');
    const exact = LANGUAGES.find(language => language.code.toLowerCase() === tag);
    if (exact) return exact.code;
    if (tag.startsWith('ar-eg-')) return 'ar-EG';
    const base = tag.split('-')[0];
    if (Object.hasOwn(aliases, base)) return aliases[base];
    if (Object.hasOwn(catalogs, base)) return base;
  }
  // 浏览器偏好不在支持列表中时，界面明确选择 English，用户可直接改选。
  return 'en';
}

const sourceKeys = new Map(Object.entries(zh).map(([key, value]) => [value, key]));
const aliases = {
  'Fake Friend 关注清理': 'panel',
  '先扫描，再逐个确认。': 'scanFirst',
  '已停止': 'stopped',
  '已暂停': 'paused',
  '已暂停定位': 'locatingPaused',
  '未识别卡片': 'unknown',
  '跳过': 'skip',
  '请等待当前操作结束。': 'errorBusy',
  '已有任务运行，请先停止。': 'errorBusy',
  '无效模式。': 'errorMode',
  '无效的确认选择。': 'errorMode',
  '请先逐个确认需要取关的账号。': 'errorReview',
  '请先结束扫描或当前操作，再选择名单。': 'errorBusy',
  '请等待定位到当前账号。': 'errorCurrent',
  '当前没有需要确认的未回关账号。': 'errorNoCandidates',
  '此人当前不满足取关条件，请保留或跳过。': 'errorChanged',
  '此人当前不在待处理范围内。': 'errorNotListed',
  '此人的关注关系已变化，请重新扫描。': 'errorMoved',
  '当前账号已移出页面，请停止后重新确认。': 'errorMoved',
  '只能确认当前正在展示的账号。': 'errorCurrent',
  '该账号不在本轮确认名单中。': 'errorNotListed',
  '跳过前 N 人需要填写 0—10000 的整数。': 'errorSkipRange',
  '本轮最多取关需要填写 1—10000 的整数。': 'errorActionRange',
  '请明确自动滚动选项。': 'errorAutoScroll',
  '列表前部有未加载完整的账号，无法确定前 N 人范围，请加载完成后重扫。': 'errorLoading',
  '间隔范围需要填写整数，最小值至少 1 秒，最大值必须大于最小值且不超过 10000 秒。': 'errorRange',
  '无法确认这是当前登录账号自己的关注列表，已停止。': 'errorPage',
  '账号卡片尚未加载完整': 'errorLoading',
  '账号或关注按钮结构无法确认': 'errorButton',
  '关注按钮尚未就绪': 'errorLoading',
  '关注按钮与账号身份不一致': 'errorIdentity',
  '账号文字与主页链接不一致': 'errorIdentity',
  '互关标记尚未加载完整': 'errorLoading',
  '关注列表尚未加载完整，或页面结构已变化。': 'errorPageStructure',
  '无法确认当前显示的是正在关注列表。': 'errorPageStructure',
  '确认弹窗中的账号不匹配，已停止。': 'errorIdentity',
  '无法识别取关确认弹窗，已停止。': 'errorDialog',
  '原账号卡片已变化或移出页面，已停止。': 'errorMoved',
  '当前已回关或已不再关注': 'errorChanged',
  '关系在操作前已变化': 'errorChanged',
  '确认前关系已变化': 'errorChanged',
  '取关确认弹窗未出现，已停止。': 'errorDialog',
  '确认按钮已变化或不可操作。': 'errorDialog',
  '取关结果未确认：请在 X 页面核对，程序已停止且不会重试。': 'errorUnconfirmed',
  '关注列表正在加载，请加载完成后重新开始。': 'errorLoading',
  '列表回到顶部的结果未确认，请检查页面后重试。': 'errorTop',
  '下一段列表加载未完成，扫描已中断，尚未确认到达末尾。': 'errorLoadTimeout',
  '页面尚未到达底部，但滚动没有前进，扫描已中断。': 'errorStuck',
  '列表中仍有未加载完整的账号，无法确认扫描末尾。': 'errorLoading',
  '请在 X 页面识别个人资料入口。': 'errorPage',
  '已离开识别页面。': 'errorLeft',
  '个人资料入口无法识别，请检查 X 页面后重新点击。': 'errorNavigation',
  '未找到当前登录账号的个人资料入口。请先登录 X，等待页面加载后，再点击插件里的“前往我的关注列表”。': 'errorLogin',
  '当前登录账号已变化，自动跳转已停止。': 'errorAccount',
  '页面入口已变化，自动跳转已停止。': 'errorNavigation',
  '当前页面的“正在关注”入口尚未出现，请等待页面加载后再试。': 'errorNavigation',
  '关注列表尚未打开，请检查 X 页面后再试。': 'errorNavigation',
  '请切换到自己账号的“正在关注”页面。': 'errorPage',
  '未收到清理面板的打开结果，请刷新 X 页面后重新打开插件。': 'errorNavigation',
  '未收到跳转结果，请重新点击。': 'errorNavigation',
  '插件没有收到页面状态，请重新打开插件。': 'errorNavigation'
};
for (const [text, key] of Object.entries(aliases)) sourceKeys.set(text, key);

const dynamicMessages = [
  [/^面板高度保存失败：([\s\S]*)$/, 'errorPanelHeightSave', ['reason']],
  [/^@([A-Za-z0-9_]+) 已移出白名单，已自动保存。$/, 'keepRemoved', ['handle']],
  [/^白名单已导入，新增 (\d+) 人。确认名单已重置，请重新选择。$/, 'keepImported', ['count']],
  [/^已识别 (\d+) 个账号，前 (\d+) 人已跳过。$/, 'scannedSkip', ['count', 'skip']],
  [/^已识别 (\d+) 个账号。$/, 'scanned', ['count']],
  [/^正在确认列表末尾（(\d+)\/2）。$/, 'waitEnd', ['count']],
  [/^本轮选择已完成：(\d+) 人加入清理名单。点击“开始执行”后才会取关。$/, 'reviewDone', ['count']],
  [/^正在翻页定位 @([A-Za-z0-9_]+)…$/, 'locating', ['handle']],
  [/^已定位 @([A-Za-z0-9_]+)，请在原页面核对。$/, 'located', ['handle']],
  [/^已记录 @([A-Za-z0-9_]+) 的选择，还剩 (\d+) 人待确认。$/, 'decisionSaved', ['handle', 'count']],
  [/^正在处理 @([A-Za-z0-9_]+)…$/, 'processing', ['handle']],
  [/^已取关 @([A-Za-z0-9_]+)。$/, 'removedUser', ['handle']],
  [/^已跳过 @([A-Za-z0-9_]+)。$/, 'skippedUser', ['handle']],
  [/^无效账号：([\s\S]*)$/, 'errorInvalidHandle', ['value']],
  [/^页面提示，已停止：([\s\S]*)$/, 'errorPageAlert', ['reason']],
  [/^取关请求已点击，结果未确认：([\s\S]*)$/, 'errorOutcome', ['reason']],
  [/^滚动后 @([A-Za-z0-9_]+) 已移出当前列表，请重新扫描。$/, 'errorMissingHandle', ['handle']],
  [/^未能将 @([A-Za-z0-9_]+) 滚动到可见区域，定位已停止。$/, 'errorMissingHandle', ['handle']],
  [/^当前已加载列表中找不到 @([A-Za-z0-9_]+)，请重新扫描。$/, 'errorMissingHandle', ['handle']]
];

export function createI18n(navigator) {
  let locale = detectLocale(navigator);
  const direction = () => LANGUAGES.find(language => language.code === locale).dir ?? 'ltr';
  const t = (key, values = {}) => {
    const template = catalogs[locale][key];
    if (typeof template !== 'string') throw new Error(`Missing translation: ${locale}/${key}`);
    return template.replace(/\{(\w+)\}/g, (_, name) => {
      if (!Object.hasOwn(values, name)) throw new Error(`Missing translation value: ${key}/${name}`);
      const value = String(values[name]);
      return direction() === 'rtl' ? `\u2068${value}\u2069` : value;
    });
  };
  const message = text => {
    if (locale === 'zh') return text;
    const key = sourceKeys.get(text);
    if (key) return t(key);
    const wait = text.match(/^([\s\S]*) 下一轮 ([\d.]+) 秒后。$/);
    if (wait) return `${message(wait[1])} ${t('nextRound', { count: wait[2] })}`;
    const save = text.match(/^([\s\S]*)；记录保存失败：([\s\S]*)$/);
    if (save) return `${message(save[1])} ${t('errorSave', { reason: message(save[2]) })}`;
    const stopped = text.match(/^(已暂停|已停止)。([\s\S]*)$/);
    if (stopped) return `${t(stopped[1] === '已暂停' ? 'paused' : 'stopped')}${stopped[2] ? ` ${message(stopped[2])}` : ''}`;
    for (const [pattern, messageKey, names] of dynamicMessages) {
      const match = text.match(pattern);
      if (match) return t(messageKey, Object.fromEntries(names.map((name, index) => [name, name === 'reason' ? message(match[index + 1]) : match[index + 1]])));
    }
    // 浏览器、X 页面和存储返回的外部错误保留其原始内容。
    return text;
  };
  return {
    t, message,
    get locale() { return locale; },
    get dir() { return direction(); },
    setLocale(value) {
      if (!Object.hasOwn(catalogs, value)) throw new Error(`Unsupported language: ${value}`);
      locale = value;
    }
  };
}

export function localizeElements(root, i18n) {
  for (const element of root.querySelectorAll('[data-i18n]')) element.textContent = i18n.t(element.dataset.i18n);
  for (const [marker, attribute] of [['data-i18n-label', 'aria-label'], ['data-i18n-placeholder', 'placeholder']]) {
    for (const element of root.querySelectorAll(`[${marker}]`)) element.setAttribute(attribute, i18n.t(element.getAttribute(marker)));
  }
}
