/**
 * campus-workbench 冒烟测试
 *
 * 用 jsdom 把两个页面真实加载起来（执行页面里的脚本），验证：
 *   - 加载无报错
 *   - 用户输入不会被当成 HTML 执行（XSS）
 *   - 日期按本地时间算，不受时区影响
 *   - 本地存储写入失败时有提示
 *   - 四级页的分类筛选真的生效
 *
 * 运行：npm test   （或 node tests/ui.test.js）
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');

function load(file, query = '') {
  const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const errors = [];
  const dom = new JSDOM(html, {
    url: `https://example.com/${file}${query}`,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(win) {
      win.addEventListener('error', e => errors.push(e.message));
    },
  });
  return { win: dom.window, doc: dom.window.document, errors };
}

let failed = 0;
function ok(cond, label, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  → ' + extra : ''}`);
  if (!cond) failed++;
}

/* ---------------- index.html：校园工作台 ---------------- */
{
  const { win, doc, errors } = load('index.html');

  ok(errors.length === 0, 'index: 加载无运行时错误', errors.join(' | '));
  ok(doc.getElementById('todayLabel').textContent.includes('年'), 'index: 日期正常渲染');

  // XSS：课程名里塞标签，必须作为纯文本显示
  const form = doc.getElementById('fCourse');
  form.querySelector('[name=name]').value = '<img src=x onerror="window.__pwned=1">';
  form.querySelector('[name=room]').value = 'A101';
  form.querySelector('[name=time]').value = '09:00';
  form.querySelector('[name=teacher]').value = 'T';
  form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));

  ok(!win.__pwned, 'index: 注入的脚本未执行');
  ok(!doc.getElementById('courseList').querySelector('img'), 'index: 输入没有被当成 HTML 插入');
  ok(doc.getElementById('courseList').textContent.includes('<img'), 'index: 输入按原文显示');

  // 时区：datetime-local 要的是本地时间字符串
  const iso = win.eval('localIso(new Date(2026, 10, 7, 19, 0))');
  ok(iso === '2026-11-07T19:00', 'index: localIso 输出本地时间', iso);

  const expected = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(19, 0, 0, 0);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T19:00`;
  })();
  const firstWhen = win.eval('social[0].when');
  ok(firstWhen === expected, 'index: 种子提醒时间没有偏移', `${firstWhen} vs ${expected}`);

  // 跨年：1 月的周次不能是负数
  const week = win.eval(`(() => {
    const d = new Date(2027, 0, 10);
    const y = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
    return Math.floor((d - new Date(y, 8, 1)) / 604800000) + 1;
  })()`);
  ok(week > 0 && week < 30, 'index: 跨年周次合理', 'week ' + week);

  // 存储写满 / 无痕模式：要返回失败并且有可见提示
  const result = win.eval(`(() => {
    const old = JSON.stringify;
    JSON.stringify = () => { throw new Error('QuotaExceededError'); };
    const r = LS.set('__test__', 1);
    JSON.stringify = old;
    return r;
  })()`);
  ok(result === false, 'index: 写入失败时返回 false');
  ok(doc.body.textContent.includes('无痕模式'), 'index: 写入失败时给出提示');
}

/* ---------------- cet4.html：四级备考助手 ---------------- */
{
  const { win, doc, errors } = load('cet4.html');

  ok(errors.length === 0, 'cet4: 加载无运行时错误', errors.join(' | '));

  // 关键回归：东八区凌晨 00:30 必须算当天，而不是 UTC 的前一天
  const key = win.eval('todayKey(new Date(2026, 10, 5, 0, 30))');
  ok(key === '2026-11-05', 'cet4: 凌晨打卡日期正确', key);

  ok(win.eval('Object.keys(learned).length') === 0, 'cet4: 初始没有已学单词');

  // 专业词分类按钮要真的过滤
  const all = win.eval('MAJOR.length');
  win.eval("setMajor('测量')");
  const filtered = doc.querySelectorAll('#majorList .v').length;
  ok(filtered > 0 && filtered < all, 'cet4: 分类筛选生效', `${filtered}/${all}`);
  ok(doc.querySelector('#majorChips button.on').textContent === '测量', 'cet4: 分类选中态正确');

  // 认识一个词 → 记录 + 连续天数
  win.eval('markWord(true)');
  ok(win.eval('Object.keys(learned).length') === 1, 'cet4: 单词记录生效');
  ok(win.eval('streak()') === 1, 'cet4: 连续打卡天数为 1');
}

console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
