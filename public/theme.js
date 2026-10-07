/** 首屏主题引导，在应用挂载前读取本地昼夜偏好并同步根元素与浏览器主题色。 */
try {
  const theme = localStorage.getItem('sakura-theme') === 'night' ? 'night' : 'day';
  document.documentElement.dataset.theme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'night' ? '#201b24' : '#faf7f9');
} catch {
  // A fresh session without local storage uses the daytime palette.
}
