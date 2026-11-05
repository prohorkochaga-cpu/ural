/**
 * E2E-проверка приложения «как пользователь» через Chrome DevTools Protocol.
 * Не часть приложения: лежит в _docs, требует запущенного `npm run dev`
 * на http://localhost:5173/ и установленного Edge/Chrome.
 *
 * Запуск: node _docs/e2e.mjs
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const ROOT = process.cwd()
const SHOTS = path.join(ROOT, '_docs', 'screens')
mkdirSync(SHOTS, { recursive: true })

const BROWSER =
  process.env.E2E_BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9333
const APP = 'http://localhost:5173/'
const userDir = path.join(process.env.TEMP || '.', 'fp-e2e-' + Date.now())

const browser = spawn(
  BROWSER,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    `--user-data-dir=${userDir}`,
    `--remote-debugging-port=${PORT}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)

let ws
let nextId = 0
const pending = new Map()
const consoleMessages = []
const pageErrors = []

async function connect() {
  let wsUrl = null
  for (let i = 0; i < 80 && !wsUrl; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const targets = await res.json()
      const page = targets.find((t) => t.type === 'page')
      wsUrl = page && page.webSocketDebuggerUrl
    } catch {
      /* браузер ещё стартует */
    }
    if (!wsUrl) await sleep(200)
  }
  if (!wsUrl) throw new Error('Не удалось подключиться к CDP')

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
      if (msg.error) reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error.data || {})})`))
      else resolve(msg.result)
      return
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ')
      consoleMessages.push({ type: msg.params.type, text })
    }
    if (msg.method === 'Log.entryAdded') {
      const entry = msg.params.entry
      consoleMessages.push({ type: entry.level, text: entry.text, source: entry.source })
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      pageErrors.push(msg.params.exceptionDetails.text || 'exception')
    }
  })
}

function send(method, params = {}) {
  const id = (nextId += 1)
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    throw new Error(`JS: ${result.exceptionDetails.text} :: ${expression.slice(0, 120)}`)
  }
  return result.result.value
}

const setInput = (selector, value) =>
  evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return el.value;
  })()`)

const clickByTestId = (testId) =>
  evaluate(`(() => {
    const el = document.querySelector('[data-testid="' + ${JSON.stringify(testId)} + '"]');
    if (!el) return false;
    el.click();
    return true;
  })()`)

const clickBrand = (brand) =>
  evaluate(`(() => {
    const buttons = [...document.querySelectorAll('.brand-list__button')];
    const target = buttons.find((b) => b.querySelector('.brand-list__brand')?.textContent.includes(${JSON.stringify(brand)}));
    if (!target) return false;
    target.click();
    return true;
  })()`)

async function waitFor(check, { timeout = 25000, label = 'условие' } = {}) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (await evaluate(check)) return true
    await sleep(200)
  }
  throw new Error(`Таймаут ожидания: ${label}`)
}

async function screenshot(file, width = 1440, height = 1000) {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  })
  const { data } = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
  })
  writeFileSync(path.join(SHOTS, file), Buffer.from(data, 'base64'))
}

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

async function run() {
  await connect()
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Log.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  })

  await send('Page.navigate', { url: APP })
  await sleep(1500)

  check(
    'стартовая страница: оба шага и подсказка о выборе производителя',
    await evaluate(`!!document.querySelector('[data-testid="part-number-input"]') &&
      !!document.querySelector('#stage2-title') &&
      document.body.innerText.includes('Выберите производителя из шага 1')`),
  )
  await screenshot('e2e-00-start.png', 1440, 760)

  /* ---------------- Этап 1: ввод артикула ---------------- */
  await setInput('[data-testid="part-number-input"]', '0189')
  await waitFor(`!!document.querySelector('[data-testid="brand-list"]')`, { label: 'список брендов' })
  const brandInfo = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('.brand-list__item')].map((li) => ({
      brand: li.querySelector('.brand-list__brand')?.innerText.trim(),
      price: li.querySelector('.brand-list__price')?.innerText.trim(),
      stock: li.querySelector('.brand-list__stock')?.innerText.trim(),
    }));
    return { count: rows.length, rows };
  })()`)
  check(
    'этап 1: по артикулу 0189 пришёл список производителей',
    brandInfo.count === 4,
    JSON.stringify(brandInfo.rows),
  )
  await screenshot('e2e-01-stage1.png', 1440, 900)

  /* ---------------- Этап 2: выбор бренда ---------------- */
  // для проверки пагинации берём артикул с большим числом аналогов (741 у MEYLE)
  await setInput('[data-testid="part-number-input"]', '7160500039S')
  await waitFor(
    `[...document.querySelectorAll('.brand-list__brand')].some((el) => el.innerText.includes('MEYLE'))`,
    { label: 'бренд MEYLE в списке' },
  )
  const clicked = await clickBrand('MEYLE')
  check('этап 2: строка производителя кликабельна', clicked)
  await waitFor(`!!document.querySelector('[data-testid="offer-table"]')`, {
    timeout: 30000,
    label: 'таблица аналогов',
  })
  const table = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('tr.offer-row')];
    const first = rows[0];
    return {
      rows: rows.length,
      headers: [...document.querySelectorAll('thead th')].map((th) => th.innerText.replace(/[▲▼↕]/g, '').trim()),
      firstRow: first ? [...first.querySelectorAll('td')].map((td) => td.innerText.trim()) : null,
      hasBase: !!document.querySelector('tr.offer-row.is-base-row'),
      summary: document.querySelectorAll('.result-summary')[1]?.innerText.replace(/\\s+/g, ' ').trim(),
    };
  })()`)
  check(
    'этап 2: таблица заполнена, есть бренд/цена/остаток',
    table.rows > 0 &&
      table.rows <= 26 &&
      table.headers.length === 6 &&
      /₽|под заказ/.test(table.firstRow?.[3] || ''),
    JSON.stringify(table),
  )
  check(
    'выбранная деталь закреплена первой строкой со своими складами',
    table.hasBase && /выбранная/.test(table.firstRow?.[0] || ''),
    JSON.stringify({ hasBase: table.hasBase, first: table.firstRow?.[0] }),
  )
  await screenshot('e2e-02-stage2.png', 1440, 1800)

  /* ---------------- Сортировка ---------------- */
  await evaluate(`(() => {
    const btn = [...document.querySelectorAll('.sort-header')].find((b) => /цена/i.test(b.innerText));
    btn.click();
  })()`)
  await sleep(400)
  // закреплённая строка выбранной детали в проверке сортировки не участвует
  const sorted = await evaluate(
    `[...document.querySelectorAll('tr.offer-row:not(.is-base-row)')].map((tr) => tr.querySelectorAll('td')[3].innerText.trim())`,
  )
  const prices = sorted.map((p) => Number(p.replace(/[^\d,]/g, '').replace(',', '.'))).filter((n) => n > 0)
  const descending = prices.every((p, i) => i === 0 || prices[i - 1] >= p)
  check('сортировка по цене (2-й клик = убывание)', descending, sorted.slice(0, 4).join(' | '))

  /* ---------------- Пагинация ---------------- */
  await clickByTestId('show-more')
  await sleep(500)
  const afterMore = await evaluate(`document.querySelectorAll('tr.offer-row').length`)
  check('«Показать ещё» добавляет позиции', afterMore === 51, `строк: ${afterMore}`)

  /* ---------------- Фильтр и «только в наличии» ---------------- */
  const sampleBrand = await evaluate(
    `document.querySelector('tr.offer-row td .fw-semibold')?.innerText.trim() || ''`,
  )
  await setInput('[data-testid="offers-filter"]', sampleBrand)
  await sleep(500)
  const filtered = await evaluate(
    `[...document.querySelectorAll('tr.offer-row')].map((tr) => tr.querySelectorAll('td')[0].innerText.trim())`,
  )
  check(
    'фильтр по строке сужает выдачу',
    filtered.length > 0 &&
      filtered.length < 50 &&
      filtered.every((b) => b.toUpperCase().includes(sampleBrand.toUpperCase())),
    `бренд=${sampleBrand}, строк: ${filtered.length}`,
  )
  await setInput('[data-testid="offers-filter"]', '')
  await sleep(300)
  await clickByTestId('offers-instock')
  await sleep(500)
  const inStock = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('tr.offer-row')];
    return {
      total: rows.length,
      noStock: rows.filter((tr) => tr.innerText.includes('нет в наличии')).length,
      checked: document.querySelector('[data-testid="offers-instock"]').checked,
    };
  })()`)
  check(
    'фильтр «только в наличии» убирает нулевые остатки',
    inStock.checked && inStock.noStock === 0 && inStock.total > 0,
    JSON.stringify(inStock),
  )
  await clickByTestId('offers-instock')

  /* ---------------- Раскрытие складов ---------------- */
  await evaluate(`(() => {
    const btn = document.querySelector('.offer-details-toggle');
    btn.click();
  })()`)
  await sleep(400)
  const details = await evaluate(`(() => {
    const row = document.querySelector('tr.offer-details-row:not(.d-none)');
    return row ? row.innerText.replace(/\\s+/g, ' ').trim().slice(0, 160) : null;
  })()`)
  check('раскрываются склады с ценой и датой отгрузки', Boolean(details) && /отгрузка/.test(details || ''), details || '')

  /* ---------------- Повторный выбор того же производителя ---------------- */
  await clickBrand('MEYLE')
  let sawLoader = false
  const reloadStarted = Date.now()
  let reloaded = { rows: 0, loading: true }
  while (Date.now() - reloadStarted < 20000) {
    reloaded = await evaluate(`(() => ({
      rows: document.querySelectorAll('tr.offer-row').length,
      loading: !!document.querySelector('[data-testid="loader"]'),
    }))()`)
    if (reloaded.loading) sawLoader = true
    if (reloaded.rows > 0 && !reloaded.loading) break
    await sleep(150)
  }
  check(
    'повторный клик по тому же бренду перезагружает таблицу (без «вечного» лоадера)',
    reloaded.rows > 0 && !reloaded.loading,
    JSON.stringify({ ...reloaded, sawLoader }),
  )

  /* ---------------- Ошибка: неверный ключ (HTTP 403) ---------------- */
  await setInput('[data-testid="api-key-input"]', 'bad-key')
  await setInput('[data-testid="part-number-input"]', '0189')
  await waitFor(`!!document.querySelector('[data-testid="error-alert"]')`, {
    timeout: 20000,
    label: 'сообщение об ошибке 403',
  })
  const errorText = await evaluate(
    `document.querySelector('[data-testid="error-alert"]').innerText.replace(/\\s+/g, ' ').trim()`,
  )
  check(
    'неверный ключ -> понятная ошибка с подсказкой',
    /Неверный ключ покупателя/.test(errorText) && /Проверьте ключ покупателя/.test(errorText),
    errorText,
  )
  await screenshot('e2e-03-error.png', 1440, 900)

  /* ---------------- Ошибка: пустой ключ (валидация до запроса) ---------------- */
  await setInput('[data-testid="api-key-input"]', '')
  await setInput('[data-testid="part-number-input"]', '9999')
  await waitFor(
    `(document.querySelector('[data-testid="error-alert"]')?.innerText || '').includes('Не указан ключ покупателя')`,
    { timeout: 15000, label: 'ошибка про пустой ключ' },
  )
  const keyError = await evaluate(
    `document.querySelector('[data-testid="error-alert"]').innerText.replace(/\\s+/g, ' ').trim()`,
  )
  check('пустой ключ -> подсказка заполнить поле', /Не указан ключ покупателя/.test(keyError), keyError)

  /* ---------------- Пустой ответ: деталь не найдена ---------------- */
  await setInput('[data-testid="api-key-input"]', '00000000-0000-0000-0000-000000000001')
  await setInput('[data-testid="part-number-input"]', '7260500039S')
  await waitFor(`!!document.querySelector('[data-testid="empty-state"]')`, {
    timeout: 20000,
    label: 'пустой результат',
  })
  const emptyText = await evaluate(
    `document.querySelector('[data-testid="empty-state"]').innerText.replace(/\\s+/g, ' ').trim()`,
  )
  check('несуществующий артикул -> «деталь не найдена»', /не найдена/i.test(emptyText), emptyText)
  await screenshot('e2e-04-empty.png', 1440, 760)

  /* ---------------- Мобильная ширина ---------------- */
  await setInput('[data-testid="part-number-input"]', '7160500039S')
  await waitFor(`!!document.querySelector('[data-testid="brand-list"]')`, { label: 'бренды (мобильный)' })
  await clickBrand('MEYLE')
  await waitFor(`!!document.querySelector('[data-testid="offer-table"]')`, {
    timeout: 30000,
    label: 'таблица (мобильный)',
  })
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await sleep(600)
  const overflow = await evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`)
  check('на ширине 390px нет горизонтального переполнения', overflow <= 1, `overflow=${overflow}px`)

  // на телефоне шапка таблицы скрыта — сортировка должна быть доступна селектом
  const sortSelect = await evaluate(
    `(() => {
      const el = document.querySelector('[data-testid="offers-sort"]');
      if (!el) return null;
      Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(el, 'price:desc');
      el.dispatchEvent(new Event('change', { bubbles: true }));
      const visible = getComputedStyle(el).display !== 'none';
      return { value: el.value, visible };
    })()`,
  )
  await sleep(500)
  const mobilePrices = await evaluate(
    `[...document.querySelectorAll('tr.offer-row:not(.is-base-row)')].map((tr) => {
      const t = tr.querySelectorAll('td')[3].innerText.replace(/[^\\d,]/g, '').replace(',', '.');
      return Number(t) || 0;
    })`,
  )
  const mobileSorted = mobilePrices.filter((p) => p > 0).every((p, i, arr) => i === 0 || arr[i - 1] >= p)
  check(
    'на телефоне сортировка доступна селектом',
    Boolean(sortSelect?.visible) && mobileSorted,
    JSON.stringify({ sortSelect, top: mobilePrices.slice(0, 3) }),
  )
  await screenshot('e2e-05-mobile.png', 390, 844)

  /* ---------------- Консоль браузера ---------------- */
  const problems = consoleMessages.filter(
    (m) =>
      m.source !== 'network' &&
      (m.type === 'error' || (m.type === 'warning' && /React|Warning/i.test(m.text))),
  )
  check(
    'нет ошибок/предупреждений React в консоли',
    problems.length === 0 && pageErrors.length === 0,
    problems.map((p) => `${p.type}: ${p.text}`).join(' || ') || 'чисто',
  )

  const failed = results.filter((r) => !r.ok)
  console.log(`\nИтого: ${results.length - failed.length}/${results.length} проверок пройдено`)
  if (failed.length) {
    console.log('Провалено:')
    failed.forEach((f) => console.log(` - ${f.name} ${f.detail}`))
  }
}

try {
  await run()
} catch (error) {
  console.error('E2E упал:', error.message)
  process.exitCode = 1
} finally {
  try {
    ws?.close()
  } catch {
    /* ignore */
  }
  browser.kill()
}