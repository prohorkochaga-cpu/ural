/**
 * Дополнительные проверки: debounce, экранирование бренда со «/», позиция без
 * остатка, планшетная вёрстка, состояние загрузки.
 * Запуск: node _docs/e2e-edge.mjs  (нужен `npm run dev`)
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const SHOTS = path.join(process.cwd(), '_docs', 'screens')
mkdirSync(SHOTS, { recursive: true })
const BROWSER =
  process.env.E2E_BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9334
const APP = 'http://localhost:5173/'

const browser = spawn(
  BROWSER,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--hide-scrollbars',
    `--user-data-dir=${path.join(process.env.TEMP || '.', 'fp-e2e-edge-' + Date.now())}`,
    `--remote-debugging-port=${PORT}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)

let ws
let nextId = 0
const pending = new Map()
const apiRequests = []
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
    if (msg.method === 'Network.requestWillBeSent' && msg.params.request.url.includes('hsprice')) {
      apiRequests.push(decodeURIComponent(msg.params.request.url))
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
      resolve: (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      reject: (error) => {
        clearTimeout(timer)
        reject(error)
      },
    })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) {
    const details = result.exceptionDetails
    throw new Error(
      `JS-ошибка: ${details.exception?.description || details.text} :: ${expression.slice(0, 80)}`,
    )
  }
  return result.result.value
}

const setInput = (selector, value) =>
  evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return el.value;
  })()`)

async function waitFor(check, { timeout = 25000, label = 'условие' } = {}) {
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
  await send('Network.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })

  /* 1. Debounce: посимвольный ввод даёт один запрос */
  await send('Page.navigate', { url: APP })
  await sleep(1800)
  apiRequests.length = 0
  for (const value of ['0', '01', '018', '0189']) {
    await setInput('[data-testid="part-number-input"]', value)
    await sleep(90)
  }
  await waitFor(`!!document.querySelector('[data-testid="brand-list"]')`, { label: 'список брендов' })
  check('debounce: посимвольный ввод -> один запрос к API', apiRequests.length === 1, JSON.stringify(apiRequests))

  /* 2. Бренд со «/» (NGK/NTK), позиция без остатка */
  const clicked = await evaluate(`(() => {
    const b = [...document.querySelectorAll('.brand-list__button')]
      .find((x) => x.innerText.includes('NGK/NTK'));
    if (!b) return false;
    b.click();
    return true;
  })()`)
  await waitFor(
    `!!document.querySelector('[data-testid="offer-table"]') || !!document.querySelector('[data-testid="empty-state"]')`,
    { timeout: 30000, label: 'ответ по бренду NGK/NTK' },
  )
  await sleep(400)
  const lastUrl = apiRequests[apiRequests.length - 1] || ''
  const outcome = await evaluate(`(() => ({
    table: !!document.querySelector('[data-testid="offer-table"]'),
    empty: !!document.querySelector('[data-testid="empty-state"]'),
    rows: document.querySelectorAll('tr.offer-row').length,
    text: (document.querySelector('[data-testid="empty-state"]')?.innerText || '').replace(/\\s+/g, ' ').trim(),
  }))()`)
  check(
    'бренд со «/» уходит корректно, позиция без остатка обрабатывается',
    clicked && /brand=NGK%2FNTK|brand=NGK\/NTK/.test(lastUrl) && (outcome.table || outcome.empty),
    `${lastUrl.split('?')[1] || ''} | ${JSON.stringify(outcome)}`,
  )
  await screenshot('e2e-edge-01-slash-brand.png', 1440, 900)

  /* 3. Планшет 768px */
  await send('Page.navigate', { url: `${APP}?number=7160500039S&brand=MEYLE` })
  await waitFor(`!!document.querySelector('[data-testid="offer-table"]')`, {
    timeout: 30000,
    label: 'таблица на планшете',
  })
  await sleep(600)
  await send('Emulation.setDeviceMetricsOverride', { width: 768, height: 1200, deviceScaleFactor: 1, mobile: false })
  await sleep(500)
  const tabletOverflow = await evaluate(
    `document.documentElement.scrollWidth - document.documentElement.clientWidth`,
  )
  check('на ширине 768px нет горизонтального переполнения', tabletOverflow <= 1, `overflow=${tabletOverflow}px`)
  await screenshot('e2e-edge-02-tablet.png', 768, 1200)

  /* 4. Состояние загрузки: искусственно замедляем сеть, чтобы поймать лоадер
        (перезагружать страницу не нужно — просто запускаем новый поиск) */
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 1600,
    downloadThroughput: 256 * 1024,
    uploadThroughput: 128 * 1024,
    connectionType: 'cellular3g',
  })
  await setInput('[data-testid="part-number-input"]', '0189')
  await waitFor(`!!document.querySelector('[data-testid="loader"]')`, { timeout: 8000, label: 'лоадер' })
  const loaderText = await evaluate(
    `document.querySelector('[data-testid="loader"]')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''`,
  )
  await screenshot('e2e-edge-03-loading.png', 1440, 900)
  check('состояние загрузки отображается с подписью', /Ищем|Загружаем/.test(loaderText), loaderText)
  await send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
    connectionType: 'none',
  })
  await waitFor(`!!document.querySelector('[data-testid="brand-list"]')`, {
    timeout: 30000,
    label: 'бренды после загрузки',
  })

  /* 5. Консоль */
  check(
    'нет предупреждений/ошибок React',
    consoleProblems.length === 0,
    consoleProblems.join(' || ') || 'чисто',
  )

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