import { createI18n, localizeElements } from './localization/index.js';

export async function openPopup({ document, request, goToFollowing, close }) {
  const i18n = createI18n(document.defaultView.navigator);
  const t = i18n.t;
  document.documentElement.lang = i18n.locale;
  document.documentElement.dir = i18n.dir;
  localizeElements(document, i18n);
  const field = id => document.getElementById(id);
  const button = field('go-following');
  const showError = error => {
    field('popup-state').textContent = t('popupState');
    field('popup-title').textContent = t('popupErrorTitle');
    field('popup-message').textContent = t('popupErrorMessage');
    field('popup-detail').textContent = i18n.message(error.message);
    field('popup-detail').hidden = false;
    field('popup-help').hidden = false;
  };
  button.addEventListener('click', async () => {
    button.disabled = true; button.textContent = t('opening');
    try {
      const result = await goToFollowing();
      if (result?.status === 'error') throw new Error(result.message);
      if (result?.status !== 'navigated') throw new Error('未收到跳转结果，请重新点击。');
      close();
    } catch (error) {
      showError(error); button.textContent = t('goFollowing'); button.disabled = false;
    }
  });
  try {
    const result = await request();
    if (result?.status === 'opened') { close(); return; }
    if (result?.status === 'error') throw new Error(result.message);
    if (result?.status !== 'needs-page') throw new Error('插件没有收到页面状态，请重新打开插件。');
    field('popup-state').textContent = t('popupReady');
    field('popup-title').textContent = t('popupTitle');
    field('popup-message').textContent = i18n.message(result.message);
    field('popup-help').hidden = false;
    button.disabled = false;
  } catch (error) {
    showError(error); button.disabled = false;
  }
}
