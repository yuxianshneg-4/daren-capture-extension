// 侧边录入面板：边滑边识别、字段可改、查重确认、提交录入
(function () {
  'use strict';

  // 面板字段定义（顺序即展示顺序）
  const FIELDS = [
    { key: '达人昵称', label: '达人昵称', type: 'text', required: true },
    { key: '平台', label: '平台', type: 'select' },
    { key: '粉丝量', label: '粉丝量', type: 'number' },
    { key: '粉丝量级', label: '粉丝量级', type: 'select' },
    { key: '省份', label: '省份', type: 'select' },
    { key: '达人等级', label: '达人等级', type: 'select' },
    { key: '月GMV', label: '月GMV', type: 'select' },
    { key: '平均单价', label: '平均单价(元)', type: 'number' },
    { key: '商品数', label: '商品数', type: 'number' },
    { key: '店铺数', label: '店铺数', type: 'number' },
    { key: '一级类目', label: '一级类目', type: 'chips' },
    { key: '主推产品', label: '主推产品', type: 'chips' },
    { key: '账号ID', label: '抖音号', type: 'text' },
    { key: '微信号', label: '微信号', type: 'text' },
    { key: '主页链接', label: '主页链接', type: 'text' },
    { key: '账号详细', label: '账号详细(简介)', type: 'text' }
  ];

  let schema = [];                 // 云函数返回的字段选项
  const edited = new Set();        // 手动改过的字段（不被自动识别覆盖）
  let current = {};                // 当前值
  let lastUrl = location.href;
  let armed = false;               // 两段式按钮：false=待捕获，true=已捕获待确认录入
  const SHOW_DEBUG = false;        // 调试行默认隐藏；需要排查问题时改成 true 再刷新页面

  // ---------- Shadow DOM 面板 ----------
  const host = document.createElement('div');
  host.id = '__talent-helper-host';
  host.style.cssText = 'position:fixed;top:80px;right:0;z-index:2147483647;';
  const shadow = host.attachShadow({ mode: 'open' });
  document.documentElement.appendChild(host);

  shadow.innerHTML = `
    <style>
      .wrap { width: 300px; max-height: 82vh; display: flex; flex-direction: column;
        background: #fff; border-radius: 12px 0 0 12px; box-shadow: 0 6px 24px rgba(0,0,0,.15);
        font-family: "Microsoft YaHei", sans-serif; font-size: 13px; color: #1f2329;
        transition: transform .25s; }
      .wrap.collapsed { transform: translateX(286px); }
      .hd { display:flex; align-items:center; justify-content:space-between; padding:10px 12px;
        background:#3370ff; color:#fff; border-radius:12px 0 0 0; cursor:pointer; user-select:none; }
      .hd b { font-size: 13px; }
      .cnt { flex:1; overflow-y:auto; padding:10px 12px; }
      .row { margin-bottom: 8px; }
      .row label { display:flex; align-items:center; gap:5px; font-size:12px; color:#646a73; margin-bottom:3px; }
      .dot { width:7px; height:7px; border-radius:50%; background:#c9cdd4; flex:none; }
      .dot.on { background:#00b42a; }
      .dot.req { background:#f53f3f; }
      input, select, textarea { width:100%; box-sizing:border-box; padding:5px 8px; border:1px solid #d0d3d6;
        border-radius:5px; font-size:12px; font-family:inherit; }
      textarea { resize:vertical; min-height:34px; }
      .chips { display:flex; flex-wrap:wrap; gap:4px; }
      .chip { padding:2px 8px; border:1px solid #d0d3d6; border-radius:10px; font-size:11px; cursor:pointer; background:#f7f8fa; }
      .chip.on { background:#e1eaff; border-color:#3370ff; color:#245bdb; }
      .bar { display:flex; gap:8px; padding:10px 12px; border-top:1px solid #f0f1f2; }
      button { padding:7px 0; flex:1; border:none; border-radius:6px; cursor:pointer; font-size:13px; }
      .btn-primary { background:#3370ff; color:#fff; }
      .btn-primary:disabled { background:#a8bffc; cursor:not-allowed; }
      .btn-ghost { background:#f2f3f5; color:#1f2329; flex:0 0 74px; }
      .summary { font-size:11px; color:#8f959e; padding:0 12px 8px; }
      .warn { background:#fff7e8; color:#d46b08; font-size:11px; padding:6px 8px; border-radius:6px; margin-bottom:8px; }
      .dbg { font-size:10px; color:#8f959e; margin-top:6px; word-break:break-all; }
      .toast { position:fixed; top:16px; left:50%; transform:translateX(-50%); background:#1f2329; color:#fff;
        padding:8px 18px; border-radius:8px; font-size:13px; z-index:9999; opacity:0; transition:opacity .2s; }
      .toast.show { opacity:.95; }
      .modal-mask { position:fixed; inset:0; background:rgba(0,0,0,.35); display:flex; align-items:center; justify-content:center; z-index:9998; }
      .modal { background:#fff; border-radius:12px; padding:18px; width:340px; box-shadow:0 10px 40px rgba(0,0,0,.2); }
      .modal h3 { margin:0 0 10px; font-size:15px; }
      .modal p { font-size:12px; color:#646a73; line-height:1.7; margin:0 0 14px; }
      .modal .bar2 { display:flex; gap:8px; }
      .modal button { padding:8px 0; }
    </style>
    <div class="wrap" id="wrap">
      <div class="hd" id="toggle"><b>🎯 达人录入助手</b><span id="collapse">◀</span></div>
      <div class="cnt" id="cnt"></div>
      <div class="summary" id="summary"></div>
      <div class="bar">
        <button class="btn-ghost" id="rescan">重新识别</button>
        <button class="btn-primary" id="submit">开始捕获录入</button>
      </div>
    </div>
    <div class="toast" id="toast"></div>
    <div id="modalSlot"></div>
  `;

  const $ = (sel) => shadow.querySelector(sel);

  // ---------- 数据 ----------
  function optionsOf(key) {
    const f = schema.find((x) => x.name === key);
    return f ? f.options : [];
  }

  function isEmpty(v) {
    return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
  }

  // 自动识别结果合并：手动改过的不动；抓到新值就更新；
  // 抓不到时，页面专属字段（只在某个标签页出现）保留旧值，头部常显字段清空防残留
  const KEEP_ON_MISSING = new Set([
    '月GMV', '平均单价', '商品数', '店铺数', '一级类目', '主推产品',
    '账号ID', '微信号', '主页链接', '账号详细'
  ]);
  function mergeScraped(values) {
    for (const f of FIELDS) {
      if (edited.has(f.key)) continue;
      const v = values[f.key];
      if (isEmpty(v)) {
        if (!KEEP_ON_MISSING.has(f.key)) delete current[f.key];
      } else {
        current[f.key] = v;
      }
    }
  }

  function runScan() {
    if (typeof window.__talentScrape !== 'function') return;
    try {
      const { values, debug } = window.__talentScrape(schema);
      mergeScraped(values);
      render(debug);
    } catch (e) {
      toast('识别出错：' + e.message);
    }
  }

  // ---------- 渲染 ----------
  function render(debug) {
    const cnt = $('#cnt');
    cnt.innerHTML = '';

    if (!schema.length) {
      cnt.innerHTML = '<div class="warn">还没连上云函数。<br>请右键扩展图标 → 选项，先配置云函数地址。</div>';
    }

    for (const f of FIELDS) {
      const row = document.createElement('div');
      row.className = 'row';
      const val = current[f.key];
      const has = !isEmpty(val);
      row.innerHTML = `<label><span class="dot ${has ? 'on' : f.required ? 'req' : ''}"></span>${f.label}</label>`;

      if (f.type === 'select') {
        const sel = document.createElement('select');
        sel.innerHTML = '<option value="">— 未识别 / 请选择 —</option>' +
          optionsOf(f.key).map((o) => `<option ${o === val ? 'selected' : ''}>${o}</option>`).join('');
        sel.addEventListener('change', () => { current[f.key] = sel.value || null; edited.add(f.key); render(debug); });
        row.appendChild(sel);
      } else if (f.type === 'chips') {
        const box = document.createElement('div');
        box.className = 'chips';
        const arr = Array.isArray(val) ? val : [];
        optionsOf(f.key).forEach((o) => {
          const chip = document.createElement('span');
          chip.className = 'chip' + (arr.includes(o) ? ' on' : '');
          chip.textContent = o;
          chip.addEventListener('click', () => {
            edited.add(f.key);
            const set = new Set(arr);
            set.has(o) ? set.delete(o) : set.add(o);
            current[f.key] = [...set];
            render(debug);
          });
          box.appendChild(chip);
        });
        row.appendChild(box);
      } else {
        const inp = document.createElement(f.key === '账号详细' ? 'textarea' : 'input');
        inp.value = has ? (Array.isArray(val) ? val.join('，') : val) : '';
        inp.placeholder = f.required ? '必填' : '';
        inp.addEventListener('input', () => { current[f.key] = inp.value.trim() || null; edited.add(f.key); });
        row.appendChild(inp);
      }
      cnt.appendChild(row);
    }

    if (SHOW_DEBUG && (debug || autoSteps.length)) {
      const d = document.createElement('div');
      d.className = 'dbg';
      d.textContent = '调试：' + JSON.stringify(debug || {}) +
        (autoSteps.length ? ' | 采集:' + autoSteps.join(' ') : '');
      cnt.appendChild(d);
    }

    const filled = FIELDS.filter((x) => !isEmpty(current[x.key])).length;
    $('#summary').textContent = `已识别 ${filled}/${FIELDS.length} 项（点「开始捕获录入」自动采集全部标签页）`;
  }

  // ---------- 提交 ----------
  function buildPayload() {
    const fields = { 建联日期: Date.now() };
    for (const f of FIELDS) {
      const v = current[f.key];
      if (isEmpty(v)) continue;
      if (f.type === 'number') fields[f.key] = Number(v);
      else fields[f.key] = v;
    }
    return fields;
  }

  // 主按钮文案跟随两段式状态
  function btnLabel() {
    return armed ? '确认录入' : '开始捕获录入';
  }

  async function submit(createOnly) {
    if (!current['达人昵称']) { toast('达人昵称为空，无法提交'); return; }
    const btn = $('#submit');
    btn.disabled = true;
    btn.textContent = '提交中...';
    try {
      const profileUrl = current['主页链接'];
      let dup = null;
      if (!createOnly && profileUrl) {
        const check = await chrome.runtime.sendMessage({
          type: 'TALENT', payload: { action: 'check', profileUrl }
        });
        if (!check.ok) throw new Error(check.error || '查重失败');
        if (check.duplicate) dup = { recordId: check.recordId, record: check.record };
      }

      if (dup) {
        const choice = await confirmDuplicate(dup);
        if (!choice) { btn.disabled = false; btn.textContent = btnLabel(); return; }
        const resp = await chrome.runtime.sendMessage({
          type: 'TALENT',
          payload: choice === 'update'
            ? { action: 'update', recordId: dup.recordId, fields: buildPayload() }
            : { action: 'create', fields: buildPayload() }
        });
        if (!resp.ok) throw new Error(resp.error || '写入失败');
        toast(choice === 'update' ? '✓ 已更新该达人记录' : '✓ 已新建记录');
      } else {
        const resp = await chrome.runtime.sendMessage({
          type: 'TALENT', payload: { action: 'create', fields: buildPayload() }
        });
        if (!resp.ok) throw new Error(resp.error || '写入失败');
        toast('✓ 录入成功');
      }
      armed = false; // 提交成功，回到待捕获状态
    } catch (e) {
      toast('失败：' + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = btnLabel();
    }
  }

  // 重复确认弹窗，resolve: 'update' | 'create' | null
  function confirmDuplicate(dup) {
    return new Promise((resolve) => {
      const name = (dup.record && dup.record['达人昵称']) || '该达人';
      const slot = $('#modalSlot');
      slot.innerHTML = `
        <div class="modal-mask">
          <div class="modal">
            <h3>发现表里已有「${name}」</h3>
            <p>按主页链接匹配到一条已有记录。<br>你可以<b>更新</b>这条记录（用当前页面数据刷新），也可以<b>仍然新建</b>一条。</p>
            <div class="bar2">
              <button class="btn-ghost" id="mCancel">取消</button>
              <button class="btn-ghost" id="mCreate">仍然新建</button>
              <button class="btn-primary" id="mUpdate">更新此记录</button>
            </div>
          </div>
        </div>`;
      slot.querySelector('#mUpdate').onclick = () => { slot.innerHTML = ''; resolve('update'); };
      slot.querySelector('#mCreate').onclick = () => { slot.innerHTML = ''; resolve('create'); };
      slot.querySelector('#mCancel').onclick = () => { slot.innerHTML = ''; resolve(null); };
    });
  }

  let toastTimer;
  function toast(msg) {
    const el = shadow.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  // ---------- 事件 ----------
  $('#toggle').addEventListener('click', (e) => {
    if (e.target.id === 'rescan') return;
    const w = $('#wrap');
    w.classList.toggle('collapsed');
    $('#collapse').textContent = w.classList.contains('collapsed') ? '▶' : '◀';
  });
  $('#rescan').addEventListener('click', () => {
    runScan();
  });
  // 两段式主按钮：`开始捕获录入` → 自动采集序列；`确认录入` → 写进飞书
  $('#submit').addEventListener('click', () => {
    if (!armed) {
      armed = true;
      $('#submit').textContent = '确认录入';
      render();
      toast('⏳ 正在自动捕获（约12秒），稍候可看到各字段填好');
      setTimeout(autoClick, 150);
    } else {
      submit(false);
    }
  });

  // 接收后台捕获的主页链接（用户点击“达人抖音主页”开新标签时）
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'PROFILE_URL' && msg.url) {
      current['主页链接'] = msg.url;
      edited.add('主页链接'); // 视同手动确认，后续重扫不覆盖
      render();
      toast('✓ 已捕获主页链接');
    }
  });

  // 接收页面补丁捕获的主页链接（点“达人抖音主页”时 window.open 被拦截回传）
  // 双通道：CustomEvent（快）+ data-ty-profile 属性（跨 JS 环境最稳）
  function captureProfileUrl(url) {
    url = String(url || '');
    if (/douyin\.com/.test(url) && current['主页链接'] !== url) {
      current['主页链接'] = url;
      render();
      toast('✓ 已捕获主页链接');
    }
  }
  window.addEventListener('__ty_profile', (e) => captureProfileUrl(e.detail));
  document.addEventListener('__ty_profile', (e) => captureProfileUrl(e.detail));

  // ---------- 自动模拟点击：二维码弹窗 + 主页按钮 + 微信号眼睛 + 轮播全部标签页 ----------
  let autoBusy = false;
  let observerPausedUntil = 0;
  let autoSteps = []; // 每步定位结果，显示在面板调试行，方便排查
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function findTextNodeLocal(re) {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    let n;
    while ((n = w.nextNode())) if (re.test(n.textContent)) return n;
    return null;
  }

  function clickableOf(textNode) {
    let el = textNode.parentElement;
    for (let i = 0; i < 4 && el; i++) {
      if (el.tagName === 'A' || el.tagName === 'BUTTON' || (el.getAttribute && el.getAttribute('role') === 'button')) return el;
      el = el.parentElement;
    }
    return textNode.parentElement;
  }

  // SVG 元素没有 .click() 方法（只有 HTMLElement 才有），统一用事件派发模拟点击
  function safeClick(el) {
    if (!el) return false;
    try {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return true;
    } catch (e) {
      return false;
    }
  }

  function clickTab(name) {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    let n;
    while ((n = w.nextNode())) {
      if ((n.textContent || '').trim() === name) return safeClick(clickableOf(n));
    }
    return false;
  }

  // 从锚点文本往外扩圈，找第一个小尺寸图标（微信号眼睛用）
  function findSmallIcon(anchorRe, selector) {
    const label = findTextNodeLocal(anchorRe);
    if (!label) return null;
    let box = label.parentElement;
    for (let i = 0; i < 4 && box; i++) {
      box = box.parentElement;
      if (!box) break;
      for (const c of box.querySelectorAll(selector)) {
        const r = c.getBoundingClientRect();
        if (r.width > 6 && r.width < 60 && r.height > 6 && r.height < 60) return c;
      }
    }
    return null;
  }

  // 二维码图标候选：“达人抖音主页”附近可能混着复制/箭头等其他小图标，收集多个挨个试
  function findQrCandidates() {
    const label = findTextNodeLocal(/达人抖音主页/);
    if (!label) return [];
    const seen = new Set();
    const out = [];
    let box = label.parentElement;
    for (let i = 0; i < 4 && box; i++) {
      box = box.parentElement;
      if (!box) break;
      for (const c of box.querySelectorAll('[class*="qr" i], [class*="erweima" i], [class*="code" i], svg, img')) {
        const r = c.getBoundingClientRect();
        if (r.width > 6 && r.width < 60 && r.height > 6 && r.height < 60 && !seen.has(c)) {
          seen.add(c);
          out.push(c);
        }
      }
      if (out.length >= 5) break;
    }
    return out;
  }

  // 完整指针事件序列：有的组件监听 mousedown/pointerdown/悬停，不只 click
  function fullClick(el) {
    const opts = { bubbles: true, cancelable: true, view: window };
    for (const t of ['pointerover', 'mouseover', 'pointerenter', 'mouseenter', 'pointermove', 'mousemove', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      try {
        el.dispatchEvent(t.startsWith('pointer') ? new PointerEvent(t, opts) : new MouseEvent(t, opts));
      } catch (e) { /* 不支持的事件类型跳过 */ }
    }
  }

  // 轮播顺序：最后停在带货分析（商品数/店铺数/单价都在这页，便于核对）
  const TAB_SEQ = ['概览', '场景分析', '粉丝分析', '评价详情', '带货分析'];

  const pressEsc = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

  async function autoClick() {
    if (autoBusy) return;
    autoBusy = true;
    autoSteps = [];
    observerPausedUntil = Date.now() + 30000; // 整个采集序列期间暂停自动重扫
    try {
      // 等页面渲染出资料区（首次进入最长等 10 秒，避免过早跑空）
      for (let i = 0; i < 20 && !findTextNodeLocal(/达人抖音主页/); i++) await wait(500);
      toast('⏳ 自动采集中（约10秒）...');

      const label = findTextNodeLocal(/达人抖音主页/);

      // 1) 逐个试“达人抖音主页”附近的小图标 -> 打开二维码弹窗抓抖音号
      try {
        const cands = findQrCandidates();
        autoSteps.push('二维码候选' + cands.length);
        for (let i = 0; i < cands.length && !current['账号ID'] && i < 5; i++) {
          fullClick(cands[i]);
          await wait(1100);
          runScan();
          if (!current['账号ID']) { pressEsc(); await wait(400); }
        }
        pressEsc(); // 确保弹窗关闭
        await wait(300);
        if (!current['账号ID']) {
          // 诊断：弹窗开没开？开了但正则没取到，还是压根没开
          autoSteps.push((document.body.innerText || '').includes('抖音号') ? '见抖音号字样未取到' : '弹窗未打开');
        } else {
          autoSteps.push('抖音号✓');
        }
      } catch (e) { autoSteps.push('抖音号✗:' + e.message); }

      // 2) 点主页按钮 -> window.open 被补丁拦截，网址经事件/DOM属性双通道回传
      try {
        if (label) {
          safeClick(clickableOf(label));
          for (let i = 0; i < 6 && !current['主页链接']; i++) {
            await wait(250);
            captureProfileUrl(document.documentElement.getAttribute('data-ty-profile'));
          }
          runScan();
          autoSteps.push(current['主页链接'] ? '主页✓' : '主页✗');
        }
      } catch (e) { autoSteps.push('主页✗:' + e.message); }

      // 3) 点微信号旁的眼睛图标，显出被遮住的明文
      try {
        if (!current['微信号']) {
          const eye = findSmallIcon(/达人微信号/, 'svg, [class*="eye" i], [class*="view" i], img');
          autoSteps.push(eye ? '眼睛✓' : '眼睛✗');
          if (eye) {
            safeClick(eye);
            await wait(700);
            runScan();
            autoSteps.push(current['微信号'] ? '微信号✓' : '微信号✗');
          }
        }
      } catch (e) { autoSteps.push('微信号✗:' + e.message); }

      // 4) 轮播全部标签页，每页渲染后识别一次（页面专属字段跨页保留）
      try {
        for (const tab of TAB_SEQ) {
          toast('⏳ 自动采集：' + tab);
          clickTab(tab);
          await wait(1000);
          runScan();
          await wait(200);
        }
      } catch (e) { autoSteps.push('轮播✗:' + e.message); }

      toast('✓ 自动采集完成');
    } catch (e) {
      autoSteps.push('异常:' + e.message);
      toast('自动采集部分失败，可手动切换标签后点“重新识别”');
    }
    autoBusy = false;
    observerPausedUntil = 0;
    runScan();
  }

  // DOM 变动防抖触发识别（滚动加载、切标签、点微信号眼睛都会触发）
  let timer;
  const observer = new MutationObserver(() => {
    if (Date.now() < observerPausedUntil) return; // 自动点击序列期间暂停
    clearTimeout(timer);
    timer = setTimeout(runScan, 600);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // SPA 内切换达人（URL 变了）-> 清空状态，按钮回到“开始捕获录入”，等人工判断后再采集
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      edited.clear();
      current = {};
      armed = false;
      const btn = $('#submit');
      btn.disabled = false;
      btn.textContent = btnLabel();
      try { document.documentElement.removeAttribute('data-ty-profile'); } catch (e) { /* 清残留主页链接 */ }
      setTimeout(runScan, 1000);
    }
  }, 1000);

  // ---------- 启动 ----------
  (async function init() {
    render();
    const resp = await chrome.runtime.sendMessage({ type: 'SCHEMA' });
    if (resp && resp.ok) {
      schema = resp.fields;
      runScan(); // 只做静默识别，不自动点击；采集由用户点“开始捕获录入”触发
    } else {
      toast('未连接云函数，请先在扩展选项里配置');
    }
  })();
})();
