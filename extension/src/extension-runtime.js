export function assertExtensionActive() {
  const runtime = globalThis.chrome?.runtime;
  const message = '插件已重新加载或被移除，旧任务已停止。请刷新 X 页面。';
  if (!runtime?.id) throw new Error(message);
  try { runtime.getManifest(); }
  catch (error) { throw new Error(message, { cause: error }); }
}
