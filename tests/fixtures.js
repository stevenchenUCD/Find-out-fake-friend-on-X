import { JSDOM } from 'jsdom';

export function fixture(rows = []) {
  const dom = new JSDOM(`<!doctype html><html><body>
    <a data-testid="AppTabBar_Profile_Link" href="/Tester">个人资料</a>
    <main><div data-testid="primaryColumn"><section role="region">
    <h1>正在关注</h1><div id="rows"></div></section></div></main>
    <aside id="recommendations"></aside>
  </body></html>`, { url: 'https://x.com/Tester/following', pretendToBeVisual: true });
  for (const row of rows) appendRow(dom.window.document, row);
  return dom;
}

export function appendRow(doc, { id = '101', handle = 'alice', name = 'Alice', mutual = false, following = true } = {}) {
  const row = doc.createElement('div');
  row.dataset.testid = 'UserCell';
  row.innerHTML = `<a href="/${handle}">${name}</a><a href="/${handle}">@${handle}</a>
    ${mutual ? '<div data-testid="userFollowIndicator">关注了你</div>' : ''}
    <button data-testid="${id}-${following ? 'unfollow' : 'follow'}" aria-label="${following ? '正在关注' : '关注'} @${handle}">${following ? '正在关注' : '关注'}</button>
    <p>普通个人简介</p>`;
  doc.querySelector('#rows').append(row);
  return row;
}

export function installDialog(doc, row, { target = 'alice', confirm = true } = {}) {
  const button = row.querySelector('button');
  const clicks = { open: 0, confirm: 0, cancel: 0 };
  button.addEventListener('click', () => {
    clicks.open++;
    const dialog = doc.createElement('div');
    dialog.setAttribute('role', 'alertdialog');
    dialog.innerHTML = `<h2>取消关注 @${target}？</h2>
      <button data-testid="confirmationSheetConfirm">取消关注</button>
      <button data-testid="confirmationSheetCancel">取消</button>`;
    dialog.querySelector('[data-testid="confirmationSheetCancel"]').onclick = () => { clicks.cancel++; dialog.remove(); };
    dialog.querySelector('[data-testid="confirmationSheetConfirm"]').onclick = () => {
      clicks.confirm++;
      dialog.remove();
      if (confirm) {
        button.dataset.testid = button.dataset.testid.replace(/-unfollow$/, '-follow');
        button.setAttribute('aria-label', `关注 @${target}`);
        button.textContent = '关注';
      }
    };
    doc.body.append(dialog);
  });
  return clicks;
}
