/**
 * Проверка в браузере: (1) выбранная деталь присутствует в таблице первой
 * строкой со своими складами; (2) ответ «Request quota exceeded!» показывается
 * как лимит запросов, а не как ошибка ключа.
 * Запуск: node _docs/e2e-base-row.mjs (нужен `npm run dev`)
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const SHOTS = path.join(process.cwd(), '_docs', 'screens')
mkdirSync(SHOTS, { recursive: true })
const BROWSER =
  process.env.E2E_BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9341
const APP = 'http://localhost:5173/'

const browser = spawn(
  BROWSER,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--hide-scrollbars',
    `--user-data-dir=${path.join(process.env.TEMP || '.', 'fp-base-' + Date.now())}`,
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
      /* старт */
    }
    if (!wsUrl) await sleep(200)
  }
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

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = (nextId += 1)
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

async function screenshot(file, w, h) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
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
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })

  /* 1. Выбранная деталь в таблице */
  await send('Page.navigate', { url: `${APP}?number=7160500039S&brand=MEYLE` })
  await waitFor(`!!document.querySelector('[data-testid="offer-table"]')`, 'таблица')
  await sleep(700)

  const baseRow = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('tr.offer-row')];
    const first = rows[0];
    const isBase = first.classList.contains('is-base-row');
    const cells = [...first.querySelectorAll('td')].map((td) => td.innerText.replace(/\\s+/g, ' ').trim());
    return {
      isBase,
      brand: cells[0],
      number: cells[1],
      price: cells[3],
      stock: cells[4],
      warehouses: cells[5],
      rows: rows.length,
      baseRows: document.querySelectorAll('tr.offer-row.is-base-row').length,
      summary: document.querySelector('.result-summary')?.innerText.replace(/\\s+/g, ' ').trim(),
    };
  })()`)
  check(
    'выбранная деталь — первая строка таблицы со своими предложениями',
    baseRow.isBase && /MEYLE/.test(baseRow.brand) && /выбранная/.test(baseRow.brand) && /₽/.test(baseRow.price),
    JSON.stringify(baseRow),
  )
  check(
    'выбранная деталь не дублируется в списке',
    baseRow.baseRows === 1,
    `строк-базовых: ${baseRow.baseRows} из ${baseRow.rows}`,
  )

  // раскрыть склады выбранной детали
  await evaluate(`document.querySelector('tr.offer-row.is-base-row .offer-details-toggle').click()`)
  await sleep(400)
  const wh = await evaluate(`(() => {
    const row = document.querySelector('tr.offer-row.is-base-row + tr.offer-details-row');
    if (!row || row.classList.contains('d-none')) return null;
    return { items: row.querySelectorAll('.warehouse-list__item').length, text: row.innerText.replace(/\\s+/g, ' ').trim().slice(0, 120) };
  })()`)
  check(
    'у выбранной детали раскрываются склады (их не было в списке аналогов)',
    wh && wh.items > 0 && /отгрузка/.test(wh.text),
    JSON.stringify(wh),
  )
  await screenshot('e2e-base-row.png', 1440, 1400)

  /* 2. Квота: подменяем ответ сервиса на 403 Request quota exceeded! */
  await send('Fetch.enable', { patterns: [{ urlPattern: '*hsprice*', requestStage: 'Request' }] })
  const onPaused = async (ev) => {
    const m = JSON.parse(ev.data)
    if (m.method !== 'Fetch.requestPaused') return
    const body = Buffer.from(JSON.stringify({ error: 'Request quota exceeded!' })).toString('base64')
    await send('Fetch.fulfillRequest', {
      requestId: m.params.requestId,
      responseCode: 403,
      responseHeaders: [
        { name: 'Content-Type', value: 'text/plain; charset=utf-8' },
        { name: 'Access-Control-Allow-Origin', value: '*' },
      ],
      body,
    })
  }
  ws.addEventListener('message', onPaused)

  await send('Page.navigate', { url: `${APP}?number=0189` })
  await waitFor(`!!document.querySelector('[data-testid="error-alert"]')`, 'ошибка квоты')
  await sleep(300)
  const quota = await evaluate(
    `document.querySelector('[data-testid="error-alert"]').innerText.replace(/\\s+/g, ' ').trim()`,
  )
  check(
    'лимит запросов: понятный текст и верный совет',
    /лимит запросов/i.test(quota) && /грузовому ассортименту/i.test(quota) && !/Проверьте ключ покупателя/.test(quota),
    quota,
  )
  await screenshot('e2e-quota.png', 1440, 800)
  ws.removeEventListener('message', onPaused)
  await send('Fetch.disable')

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
