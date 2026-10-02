import { openPanel } from '../extension/src/panel.js';
import { createXAdapter } from '../extension/src/x-page.js';
import { DEFAULT_SETTINGS } from '../extension/src/cleanup-session.js';

const data = {};
let removed = 0;
const names = ['林间来信','读书的人','Morning Coffee','山川笔记','量化小记','Amber Chen','午后散步','Paper Plane','研究员阿蓝','River Notes','Quiet Studio','慢慢来'];
for (let i = 1; i <= 12; i++) {
  const handle = `person${String(i).padStart(2, '0')}`, id = String(1000 + i);
  const row = document.createElement('div'); row.dataset.testid = 'UserCell';
  row.innerHTML = `<a href="/${handle}"><strong>${names[i-1]}</strong></a><a class="handle" href="/${handle}">@${handle}</a>
    ${i % 3 === 0 ? '<span data-testid="userFollowIndicator">关注了你</span>' : ''}
    <button class="follow" data-testid="${id}-unfollow" aria-label="正在关注 @${handle}">正在关注</button>
    <p class="bio">虚构账号 ${i} · 用于检查扫描、白名单和逐个确认。</p>`;
  row.querySelector('button').addEventListener('click', () => {
    if (row.querySelector('button').dataset.testid.endsWith('-follow')) return;
    const layer = document.createElement('div'); layer.className = 'backdrop';
    layer.innerHTML = `<div role="alertdialog"><h2>取消关注 @${handle}？</h2><p>仅修改本地模拟状态。</p><button data-testid="confirmationSheetConfirm">取消关注</button> <button data-testid="confirmationSheetCancel">取消</button></div>`;
    layer.querySelector('[data-testid="confirmationSheetCancel"]').onclick = () => layer.remove();
    layer.querySelector('[data-testid="confirmationSheetConfirm"]').onclick = () => {
      const button = row.querySelector('button'); button.dataset.testid = `${id}-follow`;
      button.textContent = '关注'; button.setAttribute('aria-label', `关注 @${handle}`); layer.remove();
      document.querySelector('#mock-counter').textContent = `模拟取关：${++removed}`;
    };
    document.body.append(layer);
  });
  document.querySelector('#rows').append(row);
}
data['fake-friend/v0/tester/config'] = { protocol: 'v0', keep: [], settings: { ...DEFAULT_SETTINGS } };
const storage = {
  get: async key => key === null ? structuredClone(data) : { [key]: structuredClone(data[key]) },
  set: async values => Object.assign(data, structuredClone(values))
};
document.querySelector('#reset').onclick = () => location.reload();
await openPanel({ document, adapter: createXAdapter(document, new URL('https://x.com/tester/following')), storage,
  cssURL: new URL('../extension/src/panel.css', import.meta.url).href });
