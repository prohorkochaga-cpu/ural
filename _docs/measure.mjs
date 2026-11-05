/**
 * Замер текущей сборки по спорным пунктам визуального ревью:
 * выравнивание шапки таблицы с данными, глифы сортировки, кнопка в состоянии
 * загрузки, чипы шагов, вёрстка на 768px.
 * Запуск: node _docs/measure.mjs (нужен `npm run dev`)
 */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const BROWSER =
  process.env.E2E_BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9337
const APP = 'http://localhost:5173/'

const browser = spawn(
  BROWSER,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--hide-scrollbars',
    `--user-data-dir=${process.env.TEMP || '.'}\\fp-measure-${Date.now()}`,
    `--remote-debugging-port=${PORT}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)

let ws
let nextId = 0
const pending = new Map()

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
  ws = new WebSocket(wsUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
  })
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
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

async function waitFor(expr, label, timeout = 30000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (await evaluate(expr)) return
    await sleep(150)
  }
  throw new Error('Таймаут: ' + label)
}

async function run() {
  await connect()
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: `${APP}?number=7160500039S&brand=MEYLE` })
  await waitFor(`!!document.querySelector('[data-testid="offer-table"]')`, 'таблица')
  await sleep(700)

  const align = await evaluate(`(() => {
    const table = document.querySelector('.offers-table');
    const ths = [...table.querySelectorAll('thead th')];
    const row = table.querySelector('tbody tr.offer-row');
    const tds = [...row.querySelectorAll('td')];
    const headEdges = ths.map((th) => {
      const btn = th.querySelector('.sort-header');
      const target = btn || th;
      const r = target.getBoundingClientRect();
      return { text: th.innerText.replace(/[^А-Яа-я ]/g, '').trim(), left: Math.round(r.left), right: Math.round(r.right) };
    });
    const cellEdges = tds.map((td) => {
      const r = td.getBoundingClientRect();
      return { left: Math.round(r.left), right: Math.round(r.right) };
    });
    // правые края текста внутри ячеек цены и остатка
    const priceText = tds[3].querySelector('.offer-price').getBoundingClientRect();
    const stockText = tds[4].querySelector('span').getBoundingClientRect();
    return {
      headEdges,
      cellEdges,
      priceTextRight: Math.round(priceText.right),
      stockTextRight: Math.round(stockText.right),
    };
  })()`)

  const glyph = await evaluate(`(() => {
    const marks = [...document.querySelectorAll('.sort-header__mark')].map((m) => {
      const r = m.getBoundingClientRect();
      return { text: m.textContent, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };
    });
    return marks;
  })()`)

  const stepper = await evaluate(`(() => {
    return [...document.querySelectorAll('.app-steps li')].map((li) => {
      const cs = getComputedStyle(li);
      return { cls: li.className, color: cs.color, bg: cs.backgroundColor };
    });
  })()`)

  console.log('=== ВЫРАВНИВАНИЕ ШАПКИ И ДАННЫХ ===')
  align.headEdges.forEach((h, i) => {
    console.log(`  th[${i}] "${h.text}" ${h.left}..${h.right}  |  td ${align.cellEdges[i].left}..${align.cellEdges[i].right}`)
  })
  console.log('  правый край цены:', align.priceTextRight, ' шапка ЦЕНА:', align.headEdges[3].right)
  console.log('  правый край остатка:', align.stockTextRight, ' шапка ОСТАТОК:', align.headEdges[4].right)

  console.log('=== ГЛИФЫ СОРТИРОВКИ ===')
  console.log(' ', JSON.stringify(glyph))

  console.log('=== ЧИПЫ ШАГОВ ===')
  stepper.forEach((s) => console.log(`  ${s.cls || 'inactive'}: color=${s.color} bg=${s.bg}`))

  /* кнопка в состоянии загрузки */
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
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, '0189');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await waitFor(`!!document.querySelector('[data-testid="loader"]')`, 'лоадер')
  const btn = await evaluate(`(() => {
    const b = document.querySelector('[data-testid="search-submit"]');
    const cs = getComputedStyle(b);
    const r = b.getBoundingClientRect();
    return { disabled: b.disabled, opacity: cs.opacity, bg: cs.backgroundColor, color: cs.color, width: Math.round(r.width) };
  })()`)
  console.log('=== КНОПКА В ЗАГРУЗКЕ ===')
  console.log(' ', JSON.stringify(btn))
  await send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
    connectionType: 'none',
  })
  await waitFor(`!!document.querySelector('[data-testid="brand-list"]')`, 'бренды')
  const idleBtn = await evaluate(`(() => {
    const b = document.querySelector('[data-testid="search-submit"]');
    const r = b.getBoundingClientRect();
    const cs = getComputedStyle(b);
    return { width: Math.round(r.width), bg: cs.backgroundColor, opacity: cs.opacity };
  })()`)
  console.log('  в покое:', JSON.stringify(idleBtn))

  /* 768px: перезагружаем страницу, чтобы таблица точно была на экране */
  await send('Emulation.setDeviceMetricsOverride', { width: 768, height: 1100, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: `${APP}?number=7160500039S&brand=MEYLE` })
  await waitFor(`!!document.querySelector('[data-testid="offer-table"]')`, 'таблица на 768')
  await sleep(700)
  const tablet = await evaluate(`(() => {
    const wrap = document.querySelector('.offer-table-wrap .table-responsive');
    const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const rows = [...document.querySelectorAll('tr.offer-row')].slice(0, 6).map((tr) => {
      const cells = [...tr.querySelectorAll('td')];
      return {
        h: Math.round(tr.getBoundingClientRect().height),
        art: cells[1].innerText.trim(),
        nameLines: Math.round(cells[2].getBoundingClientRect().height / 18),
        name: cells[2].innerText.trim().slice(0, 40),
      };
    });
    return { overflow, wrapOverflow: wrap ? wrap.scrollWidth - wrap.clientWidth : null, rows };
  })()`)
  console.log('=== 768px ===')
  console.log('  overflow:', tablet.overflow, 'inner-x:', tablet.wrapOverflow)
  tablet.rows.forEach((r) => console.log(`  h=${r.h} art="${r.art}" lines=${r.nameLines} "${r.name}"`))
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