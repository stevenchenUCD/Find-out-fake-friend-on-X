chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!['open-panel', 'go-to-following'].includes(message?.type)) return false;
  const action = message.type === 'go-to-following' ? goToFollowing : openActivePanel;
  action().then(sendResponse, error => sendResponse({ status: 'error', message: error.message }));
  return true;
});

async function goToFollowing() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (Number.isInteger(tab?.id) && /^https:\/\/x\.com(?:\/|$)/.test(tab.url ?? '')) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async () => {
        const { openOwnFollowing } = await import(chrome.runtime.getURL('src/following-navigation.js'));
        void openOwnFollowing(document);
      }
    });
  } else {
    await chrome.tabs.create({ url: 'https://x.com/home#fake-friend-following' });
  }
  return { status: 'navigated' };
}

async function openActivePanel() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const scopes = Number.isInteger(tab?.id) ? [{}, { tabId: tab.id }] : [{}];
  await Promise.all(scopes.flatMap(scope => [
    chrome.action.setBadgeText({ ...scope, text: '' }),
    chrome.action.setTitle({ ...scope, title: '打开 Fake Friend' })
  ]));
  if (!Number.isInteger(tab?.id) || !/^https:\/\/x\.com(?:\/|$)/.test(tab.url ?? '')) {
    return { status: 'needs-page', message: '请切换到自己账号的“正在关注”页面。' };
  }
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: async () => {
      try {
        const { openPanel } = await import(chrome.runtime.getURL('src/panel.js'));
        return await openPanel();
      } catch (error) {
        return { status: 'error', message: error.message };
      }
    }
  });
  if (results.length !== 1 || !['opened', 'needs-page', 'error'].includes(results[0].result?.status)) {
    throw new Error('未收到清理面板的打开结果，请刷新 X 页面后重新打开插件。');
  }
  return results[0].result;
}
