// 配置页：保存飞书凭证并测试连接
const $ = (id) => document.getElementById(id);

const DEFAULT_BASE = 'GlClbxoywa1LDXsGGnccQZ6inGb';
const DEFAULT_TABLE = 'tblUxwg61laLleZh';

async function init() {
  const cfg = await chrome.storage.sync.get(['appId', 'appSecret', 'baseToken', 'tableId', 'defaultRegistrar']);
  $('appId').value = cfg.appId || '';
  $('appSecret').value = cfg.appSecret || '';
  $('baseToken').value = cfg.baseToken || DEFAULT_BASE;
  $('tableId').value = cfg.tableId || DEFAULT_TABLE;
  $('defaultRegistrar').value = cfg.defaultRegistrar || '';
}

$('save').addEventListener('click', async () => {
  const appId = $('appId').value.trim();
  const appSecret = $('appSecret').value.trim();
  const baseToken = $('baseToken').value.trim();
  const tableId = $('tableId').value.trim();
  const defaultRegistrar = $('defaultRegistrar').value.trim();
  const status = $('status');
  status.style.color = '#8f959e';
  status.textContent = '保存中...';

  if (!appId || !appSecret) {
    status.style.color = '#f53f3f';
    status.textContent = 'App ID 和 App Secret 都要填';
    return;
  }

  await chrome.storage.sync.set({ appId, appSecret, baseToken, tableId, defaultRegistrar });

  // 测试连接：清掉旧 token 缓存后请求 schema
  await chrome.storage.local.remove('tokenCache');
  const resp = await chrome.runtime.sendMessage({ type: 'SCHEMA' });
  if (resp && resp.ok) {
    status.style.color = '#00b42a';
    status.textContent = '✓ 连接成功，已获取表格字段配置';
  } else {
    status.style.color = '#f53f3f';
    status.textContent = '连接失败：' + (resp && resp.error ? resp.error : '未知错误');
  }
});

init();
