/** 扩展后台 worker 注册安装监听以保持扩展身份可发现；实际配对和网络请求由 popup 负责。 */
// The popup owns all network access. This worker keeps the extension identity discoverable.
chrome.runtime.onInstalled.addListener(() => {});
