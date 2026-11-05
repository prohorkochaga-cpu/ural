/**
 * Проверка правок по UI-ревью: sticky-шапка таблицы, контраст маркеров
 * сортировки, отсутствие «прыжка» при загрузке, табличные цифры,
 * выравнивание складов, aria-live вне таблицы.
 * Запуск: node _docs/e2e-ui.mjs (нужен `npm run dev`)
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const SHOTS = path.join(process.cwd(), '_docs', 'screens')
mkdirSync(SHOTS, { recursive: true })
const BROWSER =
  process.env.E2E_BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9336
const APP = 'http://localhost:5173/'

const browser = spawn(
  BROWSER,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--hide-scrollbars',
    `--user-data-dir=${path.join(process.env.TEMP || '.', 'fp-e2e-ui-' + Date.now())}`,
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
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
      return
    }
    if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
      consoleProblems.push((msg.params.args || []).map((a) => a.value ?? a.description).join(' '))
    }
  })
}

function send(method, params = {}) {
  const id = (nextId += 1)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`CDP timeout: ${method}`))
    }, 30000)
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
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) {
    throw new Error(`JS: ${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`)
  }
  return result.result.value
}

async function waitFor(check, { timeout = 30000, label = 'условие' } = {}) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (await evaluate(check)) return true
    await sleep(150)
  }
  throw new Error(`Таймаут: ${label}`)
}

async function screenshot(file, width, height) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
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
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })

  await send('Page.navigate', { url: `${APP}?number=7160500039S&brand=MEYLE` })
  await waitFor(`!!document.querySelector('[data-testid="offer-table"]')`, { label: 'таблица' })
  await sleep(800)

  /* 1. Шапка таблицы остаётся на виду при прокрутке внутри контейнера */
  const sticky = await evaluate(`(() => {
    const wrap = document.querySelector('.offer-table-wrap .table-responsive');
    if (!wrap) return { error: 'нет контейнера' };
    const th = wrap.querySelector('thead th');
    const before = th.getBoundingClientRect().top;
    wrap.scrollTop = 600;
    const after = th.getBoundingClientRect().top;
    const wrapTop = wrap.getBoundingClientRect().top;
    return { before, after, wrapTop, scrollTop: wrap.scrollTop, maxHeight: getComputedStyle(wrap).maxHeight };
  })()`)
  check(
    'шапка таблицы прилипает при прокрутке 741 позиции',
    !sticky.error && sticky.scrollTop > 0 && Math.abs(sticky.after - sticky.wrapTop) <= 2,
    JSON.stringify(sticky),
  )
  await screenshot('e2e-ui-01-sticky.png', 1440, 900)
  await evaluate(`document.querySelector('.offer-table-wrap .table-responsive').scrollTop = 0`)

  /* 2. Маркеры сортировки заметны (непрозрачность и контраст) */
  const marks = await evaluate(`(() => {
    const el = [...document.querySelectorAll('.sort-header__mark')].find((m) => !m.closest('.sort-header').classList.contains('is-active'));
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { opacity: cs.opacity, color: cs.color, fontSize: cs.fontSize };
  })()`)
  check(
    'неактивный маркер сортировки не «растворяется»',
    Boolean(marks) && Number(marks.opacity) >= 0.99 && parseFloat(marks.fontSize) >= 11,
    JSON.stringify(marks),
  )

  /* 3. Фокус на сортировке виден: доходим до кнопки клавишей Tab */
  await evaluate(`document.body.focus()`)
  let focused = null
  for (let i = 0; i < 40; i += 1) {
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 9, key: 'Tab' })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 9, key: 'Tab' })
    focused = await evaluate(`(() => {
      const el = document.activeElement;
      if (!el || !el.classList.contains('sort-header')) return null;
      const cs = getComputedStyle(el);
      return { outlineWidth: cs.outlineWidth, outlineStyle: cs.outlineStyle, outlineColor: cs.outlineColor };
    })()`)
    if (focused) break
  }
  check(
    'у кнопок сортировки есть видимый фокус при переходе с клавиатуры',
    Boolean(focused) && parseFloat(focused.outlineWidth) >= 2 && focused.outlineStyle === 'solid',
    JSON.stringify(focused),
  )

  /* 4. Цифры в ценах табличные */
  const numeric = await evaluate(
    `getComputedStyle(document.querySelector('.offer-price')).fontVariantNumeric`,
  )
  check('цены выводятся табличными цифрами', /tabular-nums/.test(numeric), numeric)

  /* 5. aria-live не охватывает таблицу */
  const live = await evaluate(`(() => {
    const regions = [...document.querySelectorAll('[aria-live]')];
    return regions.map((el) => ({ tag: el.tagName, rows: el.querySelectorAll('tr').length, text: (el.innerText || '').slice(0, 60) }));
  })()`)
  check(
    'aria-live не накрывает сотни строк таблицы',
    live.length > 0 && live.every((r) => r.rows === 0),
    JSON.stringify(live),
  )

  /* 6. Склады выровнены по колонкам */
  await evaluate(`document.querySelector('.offer-details-toggle').click()`)
  await sleep(400)
  const wh = await evaluate(`(() => {
    const row = document.querySelector('tr.offer-details-row:not(.d-none)');
    if (!row) return null;
    const items = [...row.querySelectorAll('.warehouse-list__item')];
    const priceRight = items.map((li) => Math.round(li.querySelector('.warehouse-list__price').getBoundingClientRect().right));
    const stockRight = items.map((li) => Math.round(li.querySelector('.warehouse-list__stock').getBoundingClientRect().right));
    return { count: items.length, priceRight, stockRight, hasHead: !!row.querySelector('.warehouse-list__head') };
  })()`)
  const aligned =
    wh &&
    wh.count > 1 &&
    new Set(wh.priceRight).size === 1 &&
    new Set(wh.stockRight).size === 1
  check('цены и остатки складов выровнены по правому краю', Boolean(aligned), JSON.stringify(wh))
  await screenshot('e2e-ui-02-warehouses.png', 1440, 1200)

  /* 7. Загрузка не схлопывает страницу */
  await waitFor(`!!document.querySelector('.brand-list__button')`, { label: 'список брендов' })
  const beforeHeight = await evaluate(`document.documentElement.scrollHeight`)
  await send('Network.enable')
  await send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 2200,
    downloadThroughput: 256 * 1024,
    uploadThroughput: 128 * 1024,
    connectionType: 'cellular3g',
  })
  await evaluate(`document.querySelectorAll('.brand-list__button')[0].click()`)
  await waitFor(`!!document.querySelector('[data-testid="loader"]')`, { label: 'лоадер этапа 2' })
  const loadingHeight = await evaluate(`document.documentElement.scrollHeight`)
  await waitFor(`!!document.querySelector('[data-testid="offer-table"]')`, {
    timeout: 120000,
    label: 'таблица после загрузки',
  })
  await sleep(600)
  const loadedHeight = await evaluate(`document.documentElement.scrollHeight`)
  check(
    'переход «загрузка → таблица» не дёргает страницу',
    Math.abs(loadedHeight - loadingHeight) < 900,
    `before=${beforeHeight}px loading=${loadingHeight}px loaded=${loadedHeight}px`,
  )
  await send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
    connectionType: 'none',
  })

  /* 8. Мобильные тап-таргеты */
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await sleep(600)
  const targets = await evaluate(`(() => {
    const h = (sel) => { const el = document.querySelector(sel); return el ? Math.round(el.getBoundingClientRect().height) : null; };
    return {
      showMore: h('[data-testid="show-more"]'),
      filter: h('[data-testid="offers-filter"]'),
      sort: h('[data-testid="offers-sort"]'),
      checkbox: h('[data-testid="offers-instock"]'),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  })()`)
  check(
    'на 390px элементы управления не мельче 40px и нет переполнения',
    targets.overflow <= 1 &&
      [targets.showMore, targets.filter, targets.sort].every((v) => v === null || v >= 40) &&
      (targets.checkbox === null || targets.checkbox >= 20),
    JSON.stringify(targets),
  )
  await screenshot('e2e-ui-03-mobile.png', 390, 844)

  check('нет предупреждений React', consoleProblems.length === 0, consoleProblems.join(' || ') || 'чисто')

  const failed = results.filter((r) => !r.ok)
  console.log(`\nИтого: ${results.length - failed.length}/${results.length}`)
  if (failed.length) process.exitCode = 1
}

try {
  await run()
} catch (error) {
  console.error('Упал:', error.message)
  process.exitCode = 1
} finally {
  try {
    ws?.close()
  } catch {
    /* ignore */
  }
  browser.kill()
}