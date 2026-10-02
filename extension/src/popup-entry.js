import { openPopup } from './popup.js';

await openPopup({
  document,
  request: () => chrome.runtime.sendMessage({ type: 'open-panel' }),
  goToFollowing: () => chrome.runtime.sendMessage({ type: 'go-to-following' }),
  close: () => window.close()
});
