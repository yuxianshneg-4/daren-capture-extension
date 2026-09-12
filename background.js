// 后台 Service Worker：直连飞书 OpenAPI（open.feishu.cn 国内直连稳定）
// 凭证保存在扩展配置里，token 带缓存避免频繁请求

const HOST = 'https://open.feishu.cn';

// 只允许写入这些列，合作类人工字段不经过接口
const ALLOWED_FIELDS = [
  '达人昵称', '平台', '粉丝量', '粉丝量级', '省份', '达人等级',
  '月GMV', '平均单价', '商品数', '店铺数', '一级类目',
  '主页链接', '账号ID', '账号详细', '微信号', '建联日期'
];

async function getConfig() {
  const cfg = await chrome.storage.sync.get(['appId', 'appSecret', 'baseToken', 'tableId']);
  if (!cfg.appId || !cfg.appSecret) {
    throw new Error('还没配置飞书凭证，请点扩展图标打开配置页');
  }
  return cfg;
}

// tenant_access_token 获取与缓存（有效期 2 小时，提前 5 分钟刷新）
async function getToken() {
  const { appId, appSecret } = await getConfig();
  const cached = await chrome.storage.local.get(['tokenCache']);
  const c = cached.tokenCache;
  if (c && c.token && c.expireAt - 300000 > Date.now() && c.appId === appId) {
    return c.token;
  }
  const resp = await fetch(`${HOST}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret })
  });
  const data = await resp.json();
  if (data.code !== 0) {
    throw new Error(`获取令牌失败（检查 App ID/Secret）：${data.code} ${data.msg}`);
  }
  await chrome.storage.local.set({
    tokenCache: { token: data.tenant_access_token, expireAt: Date.now() + data.expire * 1000, appId }
  });
  return data.tenant_access_token;
}

async function feishu(path, { method = 'GET', body } = {}) {
  const { baseToken, tableId } = await getConfig();
  const token = await getToken();
  const url = `${HOST}${path.replace('{base}', baseToken).replace('{table}', tableId)}`;
  const resp = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await resp.json();
  if (data.code !== 0) {
    throw new Error(`飞书接口错误：${data.code} ${data.msg}`);
  }
  return data.data;
}

function sanitizeFields(input) {
  const out = {};
  for (const key of ALLOWED_FIELDS) {
    if (input[key] !== undefined && input[key] !== null && input[key] !== '') {
      out[key] = input[key];
    }
  }
  return out;
}

// —— 业务：读取字段选项（给面板渲染下拉框）——
async function getSchema() {
  const data = await feishu('/open-apis/bitable/v1/apps/{base}/tables/{table}/fields?page_size=100');
  const needed = ['平台', '粉丝量级', '省份', '达人等级', '月GMV', '一级类目'];
  const fields = (data.items || [])
    .filter((f) => needed.includes(f.field_name))
    .map((f) => ({
      name: f.field_name,
      type: f.ui_type,
      multiple: !!(f.property && f.property.multiple),
      options: ((f.property && f.property.options) || []).map((o) => o.name)
    }));
  return { ok: true, fields };
}

// —— 业务：查重 / 新增 / 更新 ——
async function talent(payload) {
  const action = payload.action;

  if (action === 'check') {
    const url = (payload.profileUrl || '').trim();
    if (!url) throw new Error('缺少主页链接');
    const data = await feishu('/open-apis/bitable/v1/apps/{base}/tables/{table}/records/search', {
      method: 'POST',
      body: {
        filter: {
          conjunction: 'and',
          conditions: [{ field_name: '主页链接', operator: 'is', value: [url] }]
        },
        page_size: 1
      }
    });
    const hit = (data.items || [])[0] || null;
    return { ok: true, duplicate: !!hit, recordId: hit ? hit.record_id : null, record: hit ? hit.fields : null };
  }

  if (action === 'create') {
    const fields = sanitizeFields(payload.fields || {});
    if (!fields['达人昵称']) throw new Error('达人昵称为空');
    const data = await feishu('/open-apis/bitable/v1/apps/{base}/tables/{table}/records', {
      method: 'POST',
      body: { fields }
    });
    return { ok: true, recordId: data.record.record_id };
  }

  if (action === 'update') {
    if (!payload.recordId) throw new Error('缺少 recordId');
    const fields = sanitizeFields(payload.fields || {});
    await feishu(`/open-apis/bitable/v1/apps/{base}/tables/{table}/records/${payload.recordId}`, {
      method: 'PUT',
      body: { fields }
    });
    return { ok: true, recordId: payload.recordId };
  }

  throw new Error(`未知 action：${action}`);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === 'SCHEMA') sendResponse(await getSchema());
      if (msg.type === 'TALENT') sendResponse(await talent(msg.payload));
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true; // 异步响应
});

// window.open 补丁已改为 manifest 声明式注入（patch_open.js，document_start + 所有 iframe），不再走运行时注入

// 主页链接捕获：用户点“达人抖音主页”会开新标签页，从新标签的 URL 反查回填给来源页（兜底，正常情况下补丁已拦截）
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = changeInfo.url || tab.url || '';
  const isUserPage = /douyin\.com\/user\//.test(url);          // 长链接 www.douyin.com/user/xxx
  const isShortLink = /^https?:\/\/v\.douyin\.com\//.test(url); // 短链接 v.douyin.com/xxx
  if ((isUserPage || isShortLink) && tab.openerTabId) {
    chrome.tabs.sendMessage(tab.openerTabId, { type: 'PROFILE_URL', url }).catch(() => {});
  }
});
