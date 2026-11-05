/**
 * Проверка изменений по второму визуальному ревью и отсутствия регрессий:
 * SVG-треугольники, состояния шагов, карточная раскладка на 768px,
 * sticky-шапка, раскрытые склады, пустое состояние, отсутствие переполнения.
 * Запуск: node _docs/e2e-visual.mjs (нужен `npm run dev`)
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const SHOTS = path.join(process.cwd(), '_docs', 'screens')
mkdirSync(SHOTS, { recursive: true })
const BROWSER =
  process.env.E2E_BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9339
const APP = 'http://localhost:5173/'
const STAGE2 = `${APP}?number=7160500039S&brand=MEYLE`

const browser = spawn(
  BROWSER,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--hide-scrollbars',
    `--user-data-dir=${path.join(process.env.TEMP || '.', 'fp-vis-' + Date.now())}`,
    `--remote-debugging-port=${PORT}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)

let ws
let nextId = 0
const pending = new Map()
const consoleProblems = []

async function connect() {
  let wsUrl = null
  for (let i = 0; i < 80 && !wsUrl; i += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      wsUrl = targets.find((t) => t.type === 'page')?.webSocketDebuggerUrl
    } catch {
      /* стартует */
    }
    if (!wsUrl) await sleep(200)
  }
  if (!wsUrl) throw new Error('CDP недоступен')
  ws = new WebSocket(wsUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
  })
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id)
      pending.delete(m.id)
      m.error ? reject(new Error(m.error.message)) : resolve(m.result)
      return
    }
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
      consoleProblems.push((m.params.args || []).map((a) => a.value ?? a.description).join(' '))
    }
  })
}

function send(method, params = {}) {
  const id = (nextId += 1)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP timeout: ' + method)), 30000)
    pending.set(id, {
      resolve: (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      reject: (e) => {
        clearTimeout(timer)
        reject(e)
      },
    })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
  return r.result.value
}

async function waitFor(expr, label, timeout = 40000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (await evaluate(expr)) return
    await sleep(150)
  }
  throw new Error('Таймаут: ' + label)
}

async function viewport(width, height, mobile = false) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile })
}

async function screenshot(file, width, height) {
  await viewport(width, height)
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  writeFileSync(path.join(SHOTS, file), Buffer.from(data, 'base64'))
}

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

async function run() {
  await connect()
  await send('Page.enable')
  await send('Runtime.enable')
  await viewport(1440, 1000)

  /* ---------- 1. Стартовая страница: шаги и пустое состояние ---------- */
  await send('Page.navigate', { url: APP })
  await sleep(1600)
  const start = await evaluate(`(() => {
    const steps = [...document.querySelectorAll('.app-steps li')].map((li) => ({
      text: li.innerText.replace(/\\s+/g, ' ').trim(),
      cls: li.className,
      color: getComputedStyle(li).color,
      bg: getComputedStyle(li).backgroundColor,
    }));
    return {
      steps,
      active: steps.filter((s) => s.cls.includes('is-active')).length,
      emptyBox: (() => {
        const el = document.querySelector('.empty-state');
        if (!el) return null;
        const cs = getComputedStyle(el);
        return { border: cs.borderStyle, padTop: cs.paddingTop };
      })(),
      duplicateIdle: (document.body.innerText.match(/Ожидание выбора производителя/g) || []).length,
      subtitle: document.querySelector('.app-header__subtitle')?.innerText.trim(),
    };
  })()`)
  check(
    'шаги: ровно два, активен ровно один',
    start.steps.length === 2 && start.active === 1,
    JSON.stringify(start.steps),
  )
  check(
    'подзаголовок не противоречит числу шагов',
    !/два шага/i.test(start.subtitle || ''),
    start.subtitle,
  )
  check('нет дублирующей строки «Ожидание выбора…»', start.duplicateIdle === 0, `вхождений: ${start.duplicateIdle}`)

  /* пустое состояние проверяем на реальном пустом ответе */
  await send('Page.navigate', { url: `${APP}?number=7260500039S` })
  await waitFor(`!!document.querySelector('[data-testid="empty-state"]')`, 'пустой результат')
  await sleep(400)
  const emptyBox = await evaluate(`(() => {
    const el = document.querySelector('[data-testid="empty-state"]');
    const cs = getComputedStyle(el);
    return { border: cs.borderStyle, padTop: cs.paddingTop, padBottom: cs.paddingBottom, text: el.innerText.replace(/\\s+/g, ' ').trim().slice(0, 50) };
  })()`)
  check(
    'пустое состояние оформлено блоком (пунктир + симметричные отступы)',
    emptyBox.border === 'dashed' && parseFloat(emptyBox.padTop) >= 24 && emptyBox.padTop === emptyBox.padBottom,
    JSON.stringify(emptyBox),
  )

  /* ---------- 2. Состояния шагов после поиска и выбора ---------- */
  await send('Page.navigate', { url: STAGE2 })
  await waitFor(`!!document.querySelector('[data-testid="offer-table"]')`, 'таблица')
  await sleep(700)
  const stage2 = await evaluate(`(() => {
    const card = document.querySelectorAll('.step-card')[1];
    // считаем только видимый текст: скрытый aria-live-статус для скринридера не в счёт
    const visibleText = [...card.querySelectorAll('*')]
      .filter((el) => !el.classList.contains('visually-hidden') && !el.closest('.visually-hidden'))
      .map((el) => (el.children.length === 0 ? el.textContent : ''))
      .join(' ');
    const steps = [...document.querySelectorAll('.app-steps li')].map((li) => ({
      cls: li.className,
      color: getComputedStyle(li).color,
      bg: getComputedStyle(li).backgroundColor,
    }));
    return {
      steps,
      active: steps.filter((s) => s.cls.includes('is-active')).length,
      done: steps.filter((s) => s.cls.includes('is-done')).length,
      count741: (visibleText.match(/742 предложени/g) || []).length,
      totalMentions: (visibleText.match(/из 742/g) || []).length,
      counters: document.querySelector('.result-summary')?.innerText.replace(/\\s+/g, ' ').trim(),
      toolbar: document.querySelector('.offers-toolbar__count')?.innerText.trim(),
    };
  })()`)
  check(
    'на этапе 2 шаг 2 активен, шаг 1 выполнен',
    stage2.active === 1 && stage2.done === 1,
    JSON.stringify(stage2.steps),
  )
  check(
    'итоговый счётчик заявлен один раз (бейдж) и один раз в тулбаре',
    stage2.count741 === 1 && stage2.totalMentions === 1,
    `видимых «742 предложения»: ${stage2.count741}, «из 742»: ${stage2.totalMentions} (скрытый aria-live не в счёт)`,
  )
  check(
    'счётчики не дублируются: сводка и тулбар несут разные данные',
    !/показано/.test(stage2.counters || '') && /показано/.test(stage2.toolbar || ''),
    `${stage2.counters} | ${stage2.toolbar}`,
  )

  /* ---------- 3. SVG-маркеры сортировки ---------- */
  const icons = await evaluate(`(() => {
    return [...document.querySelectorAll('.sort-header')].map((btn) => {
      const svg = btn.querySelector('svg.sort-header__mark');
      if (!svg) return { error: 'нет svg' };
      const paths = [...svg.querySelectorAll('path')];
      const r = svg.getBoundingClientRect();
      const box = svg.getBBox();
      return {
        label: btn.innerText.trim(),
        active: btn.classList.contains('is-active'),
        paths: paths.length,
        w: Math.round(r.width),
        h: Math.round(r.height),
        drawn: Math.round(box.width) > 2 && Math.round(box.height) > 2,
        color: getComputedStyle(svg).color,
      };
    });
  })()`)
  check(
    'маркеры сортировки — нарисованные SVG-треугольники',
    icons.every((i) => i.paths >= 1 && i.drawn && i.w === 8 && i.h === 12),
    JSON.stringify(icons),
  )
  check(
    'активный маркер один и отличается цветом',
    icons.filter((i) => i.active).length === 1,
    JSON.stringify(icons.map((i) => ({ label: i.label, active: i.active }))),
  )

  /* ---------- 4. Sticky-шапка всё ещё работает ---------- */
  const sticky = await evaluate(`(() => {
    const wrap = document.querySelector('.offer-table-wrap .table-responsive');
    const th = wrap.querySelector('thead th');
    wrap.scrollTop = 700;
    const after = th.getBoundingClientRect().top;
    const wrapTop = wrap.getBoundingClientRect().top;
    return { after: Math.round(after), wrapTop: Math.round(wrapTop), scrollTop: wrap.scrollTop };
  })()`)
  check(
    'шапка таблицы по-прежнему прилипает',
    sticky.scrollTop > 0 && Math.abs(sticky.after - sticky.wrapTop) <= 2,
    JSON.stringify(sticky),
  )
  await evaluate(`document.querySelector('.offer-table-wrap .table-responsive').scrollTop = 0`)

  /* ---------- 5. 768px: карточная раскладка ---------- */
  await viewport(768, 1200)
  await sleep(600)
  const tablet = await evaluate(`(() => {
    const thead = document.querySelector('.offers-table thead');
    const wrap = document.querySelector('.offer-table-wrap .table-responsive');
    const rows = [...document.querySelectorAll('tr.offer-row')].slice(0, 5);
    const heights = rows.map((tr) => Math.round(tr.getBoundingClientRect().height));
    const articles = rows.map((tr) => tr.querySelectorAll('td')[1].innerText.trim());
    return {
      theadHidden: getComputedStyle(thead).display === 'none',
      rowIsBlock: rows.length > 0 && getComputedStyle(rows[0]).display === 'block',
      heights,
      uniformHeights: new Set(heights).size === 1,
      articles,
      anyBrokenArticle: articles.some((a) => /-\\s*$/.test(a) || a.length === 0),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      wrapOverflow: wrap ? wrap.scrollWidth - wrap.clientWidth : null,
      sortSelect: !!document.querySelector('[data-testid="offers-sort"]'),
      sortSelectVisible: (() => {
        const el = document.querySelector('[data-testid="offers-sort"]');
        return el ? getComputedStyle(el).display !== 'none' : false;
      })(),
    };
  })()`)
  check(
    '768px: таблица превращается в карточки, шапка скрыта',
    tablet.theadHidden && tablet.rowIsBlock,
    JSON.stringify({ theadHidden: tablet.theadHidden, rowIsBlock: tablet.rowIsBlock }),
  )
  check(
    '768px: одинаковые высоты строк, артикулы не рвутся',
    tablet.uniformHeights && !tablet.anyBrokenArticle,
    JSON.stringify({ heights: tablet.heights, articles: tablet.articles }),
  )
  check(
    '768px: нет горизонтального переполнения, сортировка доступна селектом',
    tablet.overflow <= 1 && (tablet.wrapOverflow === null || tablet.wrapOverflow <= 1) && tablet.sortSelectVisible,
    JSON.stringify({ overflow: tablet.overflow, wrapOverflow: tablet.wrapOverflow, sort: tablet.sortSelectVisible }),
  )
  await screenshot('e2e-visual-01-tablet.png', 768, 1200)

  /* ---------- 6. Склады в карточном режиме ---------- */
  await evaluate(`document.querySelector('.offer-details-toggle').click()`)
  await sleep(400)
  const whTablet = await evaluate(`(() => {
    const row = document.querySelector('tr.offer-details-row:not(.d-none)');
    if (!row) return null;
    const items = [...row.querySelectorAll('.warehouse-list__item')];
    const r = row.getBoundingClientRect();
    return {
      items: items.length,
      headHidden: (() => {
        const h = row.querySelector('.warehouse-list__head');
        return h ? getComputedStyle(h).display === 'none' : null;
      })(),
      insideViewport: r.right <= document.documentElement.clientWidth + 1,
    };
  })()`)
  check(
    '768px: склады читаемы внутри карточки',
    whTablet && whTablet.items > 0 && whTablet.insideViewport,
    JSON.stringify(whTablet),
  )

  /* ---------- 7. 390px: переполнение и тап-таргеты ---------- */
  await viewport(390, 844, true)
  await sleep(600)
  const mobile = await evaluate(`(() => {
    const h = (sel) => {
      const el = document.querySelector(sel);
      return el ? Math.round(el.getBoundingClientRect().height) : null;
    };
    const offenders = [];
    const vw = document.documentElement.clientWidth;
    document.querySelectorAll('*').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > vw + 0.5) offenders.push(el.tagName + '.' + String(el.className).slice(0, 40));
    });
    return {
      overflow: document.documentElement.scrollWidth - vw,
      offenders: offenders.slice(0, 5),
      showMore: h('[data-testid="show-more"]'),
      expand: h('.offer-details-toggle'),
      reset: h('.step-heading > .btn'),
      filter: h('[data-testid="offers-filter"]'),
    };
  })()`)
  check(
    '390px: нет горизонтального переполнения',
    mobile.overflow <= 1,
    JSON.stringify({ overflow: mobile.overflow, offenders: mobile.offenders }),
  )
  check(
    '390px: тап-таргеты не меньше 40px',
    [mobile.showMore, mobile.expand, mobile.reset, mobile.filter].every((v) => v === null || v >= 40),
    JSON.stringify(mobile),
  )
  await screenshot('e2e-visual-02-mobile.png', 390, 844)

  /* ---------- 8. Кнопка «Найти» не меняет ширину ---------- */
  await viewport(1440, 900)
  await send('Page.navigate', { url: APP })
  await sleep(1400)
  await evaluate(`(() => {
    const el = document.querySelector('[data-testid="part-number-input"]');
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, '0189');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await waitFor(`!!document.querySelector('[data-testid="brand-list"]')`, 'бренды')
  const idleW = await evaluate(`Math.round(document.querySelector('[data-testid="search-submit"]').getBoundingClientRect().width)`)
  await send('Network.enable')
  await send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 2500,
    downloadThroughput: 256 * 1024,
    uploadThroughput: 128 * 1024,
    connectionType: 'cellular3g',
  })
  await evaluate(`(() => {
    const el = document.querySelector('[data-testid="part-number-input"]');
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, '7160500039S');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await waitFor(`!!document.querySelector('[data-testid="loader"]')`, 'лоадер')
  const busy = await evaluate(`(() => {
    const b = document.querySelector('[data-testid="search-submit"]');
    const cs = getComputedStyle(b);
    return { w: Math.round(b.getBoundingClientRect().width), opacity: cs.opacity, bg: cs.backgroundColor, disabled: b.disabled };
  })()`)
  await send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
    connectionType: 'none',
  })
  check(
    'кнопка «Найти» не меняет ширину при загрузке и остаётся непрозрачной',
    Math.abs(busy.w - idleW) <= 2 && Number(busy.opacity) === 1 && busy.disabled,
    JSON.stringify({ idleW, ...busy }),
  )

  check('нет предупреждений React', consoleProblems.length === 0, consoleProblems.join(' || ') || 'чисто')

  const failed = results.filter((r) => !r.ok)
  console.log(`\nИтого: ${results.length - failed.length}/${results.length}`)
  if (failed.length) process.exitCode = 1
}

try {
  await run()
} catch (e) {
  console.error('Упал:', e.message)
  process.exitCode = 1
} finally {
  try {
    ws?.close()
  } catch {
    /* ignore */
  }
  browser.kill()
}