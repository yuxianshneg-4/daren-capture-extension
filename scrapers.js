// 精选联盟达人详情页抓取规则 v2
// 原则：先定位“XX万粉丝”这类锚点文本，再向上找资料卡片取值；GMV 等指标按“标签+值同容器”匹配
(function () {
  'use strict';

  // 页面内容可能嵌在 iframe 里：收集本页 + 可访问的同源 iframe 文档
  function getDocs() {
    const docs = [document];
    try {
      document.querySelectorAll('iframe').forEach((f) => {
        try {
          if (f.contentDocument && f.contentDocument.body) docs.push(f.contentDocument);
        } catch (e) { /* 跨域 iframe 不可访问，跳过 */ }
      });
    } catch (e) { /* ignore */ }
    return docs;
  }

  const bodyText = () => getDocs().map((d) => d.body.innerText || '').join('\n');

  function findTextNode(regex) {
    for (const doc of getDocs()) {
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null);
      let node;
      while ((node = walker.nextNode())) {
        if (regex.test(node.textContent)) return node.parentElement;
      }
    }
    return null;
  }

  // ---------- 头部资料卡：昵称/等级/粉丝/省份 ----------
  // 直接对全文正则定位（页面里“昵称 LvX 982粉丝河南·商丘”连成一行）

  function scrapeHeader(schema) {
    const result = { name: null, level: null, fansRaw: null, region: null };
    const bt = bodyText().replace(/\s+/g, ' ');

    // 粉丝量原文（如 982 或 98.2万）
    const fm = bt.match(/([\d.]+\s*万?)\s*粉丝/);
    if (fm) result.fansRaw = fm[1].replace(/\s+/g, '') + (fm[0].includes('万') ? '万' : '');

    // 昵称：紧跟在粉丝数前面的那段文字
    const nm = bt.match(/([^\s]{1,30})\s*[\d.]+\s*万?\s*粉丝/);
    if (nm) {
      const cand = nm[1].trim();
      if (cand && !cand.includes('粉丝') && !/^\d+(\.\d+)?$/.test(cand)) result.name = cand;
    }

    // 等级识别：昵称、LV徽章、粉丝数在同一行（如"毛球球 LV5 1.2万粉丝 河南南阳"）
    // 策略：匹配"LVX 后面紧邻粉丝数"，避免抓到页面别处的 LV 说明文字
    let lm = null;
    // 方案1：全文匹配 LVX + 粉丝数（中间允许少量字符）
    lm = bt.match(/LV\s*([1-6]).{0,30}?[\d.]+\s*万?\s*粉丝/i);
    // 方案2：兜底——找独立的 LVX 文本节点（整段就是等级徽章，前后只有空白）
    if (!lm) {
      for (const doc of getDocs()) {
        const w = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null);
        let n;
        while ((n = w.nextNode())) {
          const t = (n.textContent || '').trim();
          const m = t.match(/^LV\s*([1-6])$/i);
          if (m) { lm = m; break; }
        }
        if (lm) break;
      }
    }
    // 方案3：最后兜底——alt/title/aria-label 属性
    if (!lm) {
      for (const doc of getDocs()) {
        for (const el of doc.querySelectorAll('[alt],[title],[aria-label]')) {
          const s = (el.getAttribute('alt') || '') + ' ' + (el.getAttribute('title') || '') + ' ' + (el.getAttribute('aria-label') || '');
          const m = s.match(/LV\s*([1-6])/i);
          if (m) { lm = m; break; }
        }
        if (lm) break;
      }
    }
    if (lm) result.level = 'Lv' + lm[1];
    console.log('[达人抓取] 等级识别结果:', result.level, '| 原始匹配:', lm ? lm[0] : '未匹配到');
    // 调试：找头部区域（含"粉丝"的容器）里的小尺寸 img，等级徽章通常很小
    const headerImgs = [];
    const fansEl = findTextNode(/粉丝/);
    if (fansEl) {
      let box = fansEl.parentElement;
      for (let i = 0; i < 6 && box; i++) {
        box.querySelectorAll('img').forEach((img) => {
          const r = img.getBoundingClientRect();
          if (r.width > 0 && r.width < 80 && r.height > 0 && r.height < 80) {
            headerImgs.push({
              w: Math.round(r.width), h: Math.round(r.height),
              src: (img.src || '').slice(0, 150),
              alt: img.alt || '',
              cls: (img.className || '').slice(0, 80),
              title: img.title || '',
              aria: img.getAttribute('aria-label') || '',
              dataAttrs: (() => { const d = {}; for (const a of img.attributes) if (a.name.startsWith('data-')) d[a.name] = a.value; return d; })()
            });
          }
        });
        if (headerImgs.length) break;
        box = box.parentElement;
      }
    }
    console.log('[达人抓取] 头部小尺寸img:', JSON.stringify(headerImgs));

    // 省份：粉丝数后面跟的地区文字（如“河南·商丘”），按表格选项匹配
    const rm = bt.match(/粉丝\s*([^\s]{2,12})/);
    if (rm) {
      const raw = rm[1];
      const provOpt = (schema.find((f) => f.name === '省份') || {}).options || [];
      for (const opt of provOpt) {
        if (raw.startsWith(opt) || raw.includes(opt)) { result.region = opt; break; }
      }
    }
    return result;
  }

  // ---------- 指标类：找“标签+值”共存的最小容器，容器内取数值 ----------

  function valueByLabel(label, valueRegex) {
    const labelEl = findTextNode(new RegExp(label));
    if (!labelEl) return null;
    // 从标签往外扩一圈：小容器里只有“标签+值”才算命中；一旦内容超出界限立即放弃，绝不抓错
    let box = labelEl.parentElement;
    for (let i = 0; i < 6 && box; i++) {
      const clean = (box.innerText || '').replace(/[①-⑳]/g, '').replace(/\s+/g, '');
      if (clean === label) { box = box.parentElement; continue; }
      if (clean.length > label.length + 16) return null;
      const rest = clean.slice(clean.indexOf(label) + label.length);
      const m = rest.match(valueRegex);
      if (m) return m[0].trim();
      box = box.parentElement;
    }
    return null;
  }

  // “19.8万” -> 198000
  function fansToNumber(raw) {
    if (!raw) return null;
    const m = String(raw).match(/([\d.]+)\s*(万|w|W)?/);
    if (!m) return null;
    const n = parseFloat(m[1]);
    if (isNaN(n)) return null;
    return m[2] ? Math.round(n * 10000) : n;
  }

  function deriveFanLevel(n, options) {
    const rules = [[500000, '50万以上'], [100000, '10-50万'], [50000, '5-10万'], [10000, '1-5万'], [0, '1万以下']];
    for (const [min, label] of rules) {
      if (n >= min && options.includes(label)) return label;
    }
    return null;
  }

  function canonicalRange(s) {
    return String(s).replace(/[¥￥\s]/g, '').replace(/万/g, '').replace(/[~～至]/g, '-');
  }

  function matchRange(raw, options) {
    if (!raw) return null;
    const target = canonicalRange(raw);
    for (const opt of options) {
      if (canonicalRange(opt) === target) return opt;
    }
    return null;
  }

  // ---------- 主页链接：从页面源码找 ----------

  function scrapeProfileUrl() {
    // 补丁写入的 DOM 属性（点主页按钮时 window.open 被拦截后回传），最可靠
    const attr = document.documentElement.getAttribute('data-ty-profile');
    if (attr && /douyin\.com/.test(attr)) return attr;
    for (const doc of getDocs()) {
      const a = doc.querySelector('a[href*="douyin.com/user/"]');
      if (a && a.href) return a.href;
    }
    for (const doc of getDocs()) {
      const m = (doc.documentElement.innerHTML || '').match(
        /https?:(?:\\\/|\/){2}[a-zA-Z.]*douyin\.com(?:\\\/|\/)user(?:\\\/|\/)[A-Za-z0-9_-]+/
      );
      if (m) return m[0].replace(/\\\//g, '/');
    }
    return null;
  }

  // ---------- 其他 ----------

  function scrapeByRegex(re) {
    const m = bodyText().match(re);
    return m ? m[1].trim() : null;
  }

  function scrapeWechat() {
    const raw = scrapeByRegex(/达人微信号\s*[:：]?\s*([A-Za-z0-9_\-*]{4,})/);
    if (!raw || raw.includes('*')) return null;
    return raw;
  }

  // 抖音号：二维码弹窗里“抖音号: M641081598”（支持字母开头、下划线、短横）
  function scrapeAccountId() {
    return scrapeByRegex(/抖音号\s*[:：]?\s*([A-Za-z0-9_\-]{4,20})/);
  }

  function categoryCardText() {
    const scopeEl = findTextNode(/带货商品最多品类TOP5/);
    if (!scopeEl) return '';
    let scope = scopeEl;
    for (let i = 0; i < 4 && scope.parentElement; i++) {
      scope = scope.parentElement;
      const t = scope.innerText || '';
      if (t.includes('%') && t.length < 500) break;
    }
    return scope.innerText || '';
  }

  // 从TOP5卡片解析出按占比排序的类目名（去掉“其他”和占比数字）
  function topCategories() {
    const text = categoryCardText().replace(/占比最高/g, ' ');
    const names = [];
    const re = /([\u4e00-\u9fa5A-Za-z0-9&]{2,10})\s*\d{1,3}(?:\.\d+)?%/g;
    let m;
    while ((m = re.exec(text))) {
      const n = m[1].trim();
      if (n && n !== '其他' && !names.includes(n)) names.push(n);
    }
    return names;
  }

  function scrapeCategories(options) {
    return topCategories().filter((n) => options.includes(n));
  }

  // ---------- 主入口 ----------

  function scrape(schema) {
    const getOptions = (name) => {
      const f = (schema || []).find((x) => x.name === name);
      return f ? f.options : [];
    };

    const header = scrapeHeader(schema);
    const fans = fansToNumber(header.fansRaw);

    const gmvRaw = valueByLabel('结算总额', /¥?\s*[\d.]+\s*万?\s*[-~～至]\s*[\d.]+\s*万?/);
    const goodsCount = valueByLabel('带货商品数', /\d{1,7}/); // 带货分析页核心数据（概览页的“带货商品总数”不用）
    const shopCount = valueByLabel('合作店铺数', /\d{1,7}/);
    const avgPriceRaw = valueByLabel('平均件单价', /¥\s*[\d.]+/);

    const gmv = matchRange(gmvRaw, getOptions('月GMV'));
    let level = header.level || 'Lv1'; // 识别到等级就用识别到的，不再用飞书选项过滤（避免 Lv5 被误改成 Lv1）；没识别到才兜底 Lv1

    const values = {
      达人昵称: header.name,
      平台: getOptions('平台').includes('抖音') ? '抖音' : null,
      达人等级: level,
      粉丝量: fans,
      粉丝量级: fans != null ? deriveFanLevel(fans, getOptions('粉丝量级')) : null,
      省份: header.region,
      月GMV: gmv,
      商品数: goodsCount ? parseInt(goodsCount, 10) : null,
      店铺数: shopCount ? parseInt(shopCount, 10) : null,
      平均单价: avgPriceRaw ? avgPriceRaw.replace(/[¥\s]/g, '') : null,
      一级类目: scrapeCategories(getOptions('一级类目')),
      账号ID: scrapeAccountId(),
      主页链接: scrapeProfileUrl(),
      账号详细: scrapeByRegex(/达人简介\s*[:：]?\s*([^\n]+)/),
      微信号: scrapeWechat()
    };

    const debug = { bodyLen: 0, sample: '', gmvRaw, goodsCount, shopCount, avgPriceRaw };
    try {
      const bt = bodyText();
      debug.bodyLen = bt.length;
      debug.sample = bt.replace(/\s+/g, ' ').slice(0, 150);
    } catch (e) { /* 调试信息不影响主流程 */ }
    return { values, debug };
  }

  window.__talentScrape = scrape;
})();
