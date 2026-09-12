// window.open 补丁（MAIN world / document_start 注入，先于页面 JS 执行）：
// 达人主页跳转改为页面内事件 + DOM 属性回传，不再弹新标签
// 回传用双通道：CustomEvent（快）+ data-ty-profile 属性（跨 JS 环境最稳）
(function () {
  if (window.__tyOpenPatched) return;
  window.__tyOpenPatched = true;
  const fake = { closed: false, focus() {}, close() {}, postMessage() {} };
  const orig = window.open;
  window.open = function (u, ...rest) {
    try {
      const url = u ? String(u) : '';
      if (/douyin\.com/i.test(url)) {
        document.documentElement.setAttribute('data-ty-profile', url);
        document.dispatchEvent(new CustomEvent('__ty_profile', { detail: url }));
        return fake;
      }
    } catch (e) { /* 忽略 */ }
    return orig ? orig.call(window, u, ...rest) : null;
  };
})();
