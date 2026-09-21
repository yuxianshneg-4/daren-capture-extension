// 后台 Service Worker：直连飞书 OpenAPI（open.feishu.cn 国内直连稳定）
// 凭证保存在扩展配置里，token 带缓存避免频繁请求

const HOST = 'https://open.feishu.cn';

// 只允许写入这些列（面板之外的人工字段不经过接口）
const ALLOWED_FIELDS = [
  '达人昵称', '平台', '粉丝量', '粉丝量级', '省份', '达人等级', '直播or视频',
  '月GMV', '平均单价', '商品数', '店铺数', '一级类目',
  '主页链接', '账号ID', '账号详细', '微信号', '建联日期',
  '合作模式', '合作进度', '建联进度', '登记人'
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

// 字段类型缓存（5 分钟）：写入前按列类型规整值，防止 1254060 TextFieldConvFail（文本列收到数字/数组）
let typesCache = { types: null, expireAt: 0 };
async function getFieldTypes() {
  if (typesCache.types && typesCache.expireAt > Date.now()) return typesCache.types;
  const data = await feishu('/open-apis/bitable/v1/apps/{base}/tables/{table}/fields?page_size=100');
  const types = {};
  for (const f of (data.items || [])) types[f.field_name] = f.type;
  typesCache = { types, expireAt: Date.now() + 300000 };
  return types;
}

// 不可写入的列类型：查找引用/公式/创建时间/最后更新时间/创建人/修改人/自动编号
const UNWRITABLE_TYPES = new Set([19, 20, 1001, 1002, 1003, 1004, 1005]);

// 按飞书列类型把值规整成合法格式；返回 undefined 表示跳过不写
function coerceValue(type, key, v) {
  if (v === undefined || v === null || v === '') return undefined;
  if (UNWRITABLE_TYPES.has(type)) return undefined;
  switch (type) {
    case 2: { // 数字列
      const cleaned = String(v).replace(/[^\d.\-]/g, '');
      const n = Number(cleaned);
      return cleaned && Number.isFinite(n) ? n : undefined;
    }
    case 5: { // 日期列：毫秒时间戳
      if (typeof v === 'number') return v;
      const t = Date.parse(String(v));
      return Number.isNaN(t) ? undefined : t;
    }
    case 3: // 单选列：取字符串（数组取第一个）
      return Array.isArray(v) ? String(v[0] || '') : String(v);
    case 4: // 多选列：字符串数组
      return (Array.isArray(v) ? v : [v]).map((x) => String(x));
    case 1: // 文本列：一律转字符串
    default: {
      if (Array.isArray(v)) return v.map((x) => String(x)).join('、');
      if (typeof v === 'number' && /日期/.test(key)) {
        // 建联日期等日期含义的文本列：时间戳格式化成人看的日期
        const d = new Date(v);
        const p = (x) => String(x).padStart(2, '0');
        return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`;
      }
      return String(v);
    }
  }
}

// —— 人员列（type 11）写入要的是 open_id，而配置里填的是显示名 ——
// 从表里已有记录反查"显示名 → open_id"（人员字段的值形如 [{id:'ou_xxx', name:'张三'}]），
// 这样不用给飞书应用额外开通讯录权限
let userMapCache = null;

async function scanUserMap(name) {
  if (userMapCache && userMapCache.has(name)) return userMapCache.get(name);
  if (!userMapCache) userMapCache = new Map();
  let pageToken = '';
  for (let page = 0; page < 5; page++) { // 最多翻 1000 条记录
    const path = '/open-apis/bitable/v1/apps/{base}/tables/{table}/records?page_size=200' +
      (pageToken ? `&page_token=${pageToken}` : '');
    const data = await feishu(path);
    for (const it of (data.items || [])) {
      for (const v of Object.values(it.fields || {})) {
        if (!Array.isArray(v)) continue;
        for (const u of v) {
          if (u && typeof u === 'object' && u.id && u.name) userMapCache.set(String(u.name), String(u.id));
        }
      }
    }
    if (userMapCache.has(name)) return userMapCache.get(name);
    if (!data.has_more || !data.page_token) break;
    pageToken = data.page_token;
  }
  for (const [n, id] of userMapCache) { // 兜底：显示名带前缀/后缀时按包含匹配
    if (n.includes(name) || name.includes(n)) return id;
  }
  return null;
}

async function sanitizeFields(input) {
  const out = {};
  const warnings = [];
  let types = null;
  try {
    types = await getFieldTypes();
  } catch (e) { /* 拉不到列类型时按原值写入，行为与旧版一致 */ }
  for (const key of ALLOWED_FIELDS) {
    const v = input[key];
    if (v === undefined || v === null || v === '') continue;
    if (types && types[key] === undefined) continue; // 表里没这列（如新列还没建）就跳过，避免写入报错
    const type = types ? types[key] : undefined;
    if (type === 11) { // 人员列：按显示名反查 open_id，查不到就不写这一列（不影响其他列）
      let id = null;
      try { id = await scanUserMap(String(v)); } catch (e) { /* 反查失败按未匹配处理 */ }
      if (id) out[key] = [{ id }];
      else warnings.push(`「${key}」没在表里找到成员「${v}」`);
      continue;
    }
    const coerced = types ? coerceValue(type, key, v) : v;
    if (coerced !== undefined && coerced !== '') out[key] = coerced;
  }
  return { fields: out, warnings };
}

// —— 业务：读取字段选项（给面板渲染下拉框）——
async function getSchema() {
  const data = await feishu('/open-apis/bitable/v1/apps/{base}/tables/{table}/fields?page_size=100');
  const needed = ['平台', '粉丝量级', '省份', '达人等级', '月GMV', '一级类目', '直播or视频',
    '合作模式', '合作进度', '建联进度'];
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
    const { fields, warnings } = await sanitizeFields(payload.fields || {});
    if (!fields['达人昵称']) throw new Error('达人昵称为空');
    const data = await feishu('/open-apis/bitable/v1/apps/{base}/tables/{table}/records', {
      method: 'POST',
      body: { fields }
    });
    return { ok: true, recordId: data.record.record_id, warnings };
  }

  if (action === 'update') {
    if (!payload.recordId) throw new Error('缺少 recordId');
    const { fields, warnings } = await sanitizeFields(payload.fields || {});
    await feishu(`/open-apis/bitable/v1/apps/{base}/tables/{table}/records/${payload.recordId}`, {
      method: 'PUT',
      body: { fields }
    });
    return { ok: true, recordId: payload.recordId, warnings };
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
