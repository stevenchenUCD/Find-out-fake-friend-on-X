if (location.pathname === '/home' && location.hash === '#fake-friend-following') {
  void (async () => {
    const { openOwnFollowing } = await import(chrome.runtime.getURL('src/following-navigation.js'));
    await openOwnFollowing(document);
  })();
}
