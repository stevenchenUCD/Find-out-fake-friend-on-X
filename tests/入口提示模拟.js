import { openPopup } from '../extension/src/popup.js';

document.title = 'Fake Friend · 插件入口本地预览';
await openPopup({
  document,
  request: async () => ({ status: 'needs-page', message: '请切换到自己账号的“正在关注”页面。' }),
  goToFollowing: async () => ({ status: 'navigated' }),
  close: () => { document.getElementById('popup-state').textContent = '本地演示：已模拟打开关注列表'; }
});
