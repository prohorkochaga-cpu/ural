/**
 * Тонкий клиент web-сервиса «Проценка» (api.favorit-parts.ru).
 *
 * Документация: wsprice.pdf
 *   GET http://api.favorit-parts.ru/hs/hsprice/
 *     key       - уникальный ключ покупателя (обязательный)
 *     number    - номер детали (обязательный)
 *     brand     - производитель (необязательный)
 *     analogues - "on" -> вместе с brand возвращает аналоги выбранной детали
 *     info      - "on" -> в ответе появляется признак невозвратной позиции
 *
 * Особенности сервиса, которые здесь учтены:
 *   - спецсимволы в number/brand обязательны к экранированию (encodeURIComponent);
 *   - деталь не найдена -> массив goods с одной пустой структурой;
 *   - ошибка бизнес-логики -> { "error": "..." };
 *   - неверный/пустой ключ -> HTTP 403;
 *   - поле goods[].price нельзя использовать как цену (берём цены складов).
 */

// import.meta.env есть только в сборке Vite; проверка нужна, чтобы модуль
// можно было тестировать обычным `node --test` без сборщика.
const ENV_API_BASE =
  typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_API_BASE : undefined

export const DEFAULT_API_BASE = (ENV_API_BASE || 'http://api.favorit-parts.ru/hs/hsprice/').trim()

/** Демонстрационный ключ из документации: позволяет сразу увидеть работу приложения. */
export const DEMO_API_KEY = '00000000-0000-0000-0000-000000000001'

const REQUEST_TIMEOUT_MS = 20000

/** Ошибка запроса с машинночитаемым видом (для разных сообщений в UI). */
export class ApiError extends Error {
  constructor(message, { kind = 'unknown', status = 0, details = '' } = {}) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind // 'auth' | 'api' | 'network' | 'timeout' | 'parse' | 'unknown'
    this.status = status
    this.details = details
  }
}

/** Тексты ошибок сервиса -> человеческие сообщения. */
const API_ERROR_MESSAGES = {
  'Empty key!': 'Не указан ключ покупателя — заполните поле «Ключ покупателя».',
  // в документации указано «Invalid key client!», но сервис отвечает
  // «Invalid access key» — поддерживаем оба варианта
  'Invalid key client!': 'Неверный ключ покупателя: покупатель не найден.',
  'Invalid access key': 'Неверный ключ покупателя: покупатель не найден.',
  'Empty number goods!': 'Не указан номер детали.',
  'Request quota exceeded!':
    'Превышен лимит запросов по грузовому ассортименту. Попробуйте позже.',
}

/** Перевод текста ошибки сервиса. Английский токен остаётся только в details. */
function describeApiError(text) {
  const raw = String(text || '').trim()
  if (!raw) return 'Сервис вернул ошибку без описания.'
  const exact = API_ERROR_MESSAGES[raw]
  if (exact) return exact
  // сервис умеет склеивать несколько ошибок в одну строку:
  // "Empty key! Invalid key client!" — переводим каждую известную часть
  const known = Object.keys(API_ERROR_MESSAGES).filter((token) => raw.includes(token))
  if (known.length) return known.map((token) => API_ERROR_MESSAGES[token]).join(' ')
  return `Сервис сообщил об ошибке: ${raw}`
}

/**
 * Вид ошибки по тексту сервиса. Важно: лимит запросов сервис отдаёт с кодом
 * HTTP 403, как и неверный ключ, но лечится это по-разному.
 */
function classifyServiceError(raw) {
  const text = String(raw || '')
  if (text.includes('Request quota exceeded!')) return 'quota'
  if (text.includes('Empty key!') || text.includes('Invalid')) return 'auth'
  return 'api'
}

export function buildUrl({ key, number, brand, analogues = false, info = false, baseUrl = DEFAULT_API_BASE }) {
  const url = new URL(baseUrl)
  const params = url.searchParams
  if (key) params.set('key', key)
  if (number) params.set('number', number)
  if (brand) params.set('brand', brand)
  if (analogues) params.set('analogues', 'on')
  if (info) params.set('info', 'on')
  return url.toString()
}

/**
 * Выполняет GET-запрос к сервису и возвращает РАЗОБРАННЫЙ ответ.
 * Все сетевые/HTTP/бизнес-ошибки приводятся к ApiError.
 *
 * @returns {Promise<{goods: Array}>}
 */
export async function fetchGoods({
  key,
  number,
  brand,
  analogues = false,
  info = false,
  baseUrl = DEFAULT_API_BASE,
  timeoutMs = REQUEST_TIMEOUT_MS,
  signal,
}) {
  const url = buildUrl({ key, number, brand, analogues, info, baseUrl })

  const controller = new AbortController()
  let timedOut = false
  const timeoutId = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const onAbort = () => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }

  let response
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
  } catch (err) {
    if (timedOut) {
      throw new ApiError('Сервис не ответил за отведённое время. Попробуйте ещё раз.', {
        kind: 'timeout',
      })
    }
    if (err && err.name === 'AbortError') throw err // отменил пользователь — пробрасываем как есть
    throw new ApiError(
      'Не удалось связаться с сервисом. Проверьте подключение к интернету и повторите запрос.',
      { kind: 'network', details: String((err && err.message) || err) },
    )
  } finally {
    clearTimeout(timeoutId)
    if (signal) signal.removeEventListener('abort', onAbort)
  }

  let text = ''
  try {
    text = await response.text()
  } catch (err) {
    if (timedOut) {
      throw new ApiError('Сервис не ответил за отведённое время. Попробуйте ещё раз.', {
        kind: 'timeout',
      })
    }
    if (err && err.name === 'AbortError') throw err
    throw new ApiError('Не удалось прочитать ответ сервиса. Попробуйте ещё раз.', {
      kind: 'network',
      details: String((err && err.message) || err),
    })
  }
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }

  if (!response.ok) {
    // 403 сервис тоже сопровождает телом {"error": "Empty key!"} — показываем
    // его перевод, а не только код ответа
    const serviceError =
      data && typeof data === 'object' && typeof data.error === 'string'
        ? describeApiError(data.error)
        : ''
    const rawError = data && typeof data === 'object' && typeof data.error === 'string' ? data.error : ''

    if (response.status === 403) {
      const kind = rawError ? classifyServiceError(rawError) : 'auth'
      throw new ApiError(
        serviceError ||
          'Доступ запрещён (403): проверьте ключ покупателя или лимит запросов.',
        { kind, status: 403, details: rawError || text.slice(0, 300) },
      )
    }
    throw new ApiError(
      `Сервис ответил ошибкой HTTP ${response.status}.${serviceError ? ` ${serviceError}` : ''}`,
      {
        kind: rawError ? classifyServiceError(rawError) : 'api',
        status: response.status,
        details: rawError || text.slice(0, 300),
      },
    )
  }

  if (data == null) {
    throw new ApiError('Сервис вернул ответ в неизвестном формате (ожидался JSON).', {
      kind: 'parse',
      details: text.slice(0, 300),
    })
  }

  if (data && typeof data === 'object' && !Array.isArray(data) && typeof data.error === 'string') {
    throw new ApiError(describeApiError(data.error), {
      kind: classifyServiceError(data.error),
      details: data.error,
    })
  }

  if (!data || !Array.isArray(data.goods)) {
    throw new ApiError('В ответе сервиса отсутствует список деталей (goods).', { kind: 'parse' })
  }

  return data
}

/* ------------------------------------------------------------------ */
/*  Нормализация ответа для UI                                         */
/* ------------------------------------------------------------------ */

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (value == null) return 0
  // терпим и числовые строки: "12", "1 234,5" (пробелы/NBSP — разделители тысяч)
  const cleaned = String(value).replace(/[\s\u00a0\u202f]/g, '').replace(',', '.')
  const num = parseFloat(cleaned)
  return Number.isFinite(num) ? num : 0
}

function toText(value) {
  if (value == null) return ''
  // сервис отдаёт названия с лишними пробелами и пробелом после «(»:
  // «Рычаги задней подвески ( ком кт на 2 е стороны)» — подчищаем для вывода
  return String(value)
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim()
}

/** Пустая структура, которую сервис отдаёт, когда деталь не найдена. */
export function isEmptyGood(raw) {
  if (!raw || typeof raw !== 'object') return true
  return !toText(raw.brand) && !toText(raw.number) && !toText(raw.name)
}

function normalizeWarehouse(raw, fallbackId) {
  const stock = toNumber(raw.stock)
  return {
    id: toText(raw.id) || fallbackId,
    code: toText(raw.code),
    own: Boolean(raw.own),
    price: toNumber(raw.price),
    stock,
    notRefund: Boolean(raw.notRefund),
    // shipmentDate: дата отгрузки + время, до которого можно оформить заказ
    shipmentDate: toText(raw.shipmentDate),
  }
}

/** Приводит «товар» из ответа к удобной для отображения модели. */
export function normalizeGood(raw, index = 0) {
  const warehousesRaw = Array.isArray(raw.warehouses) ? raw.warehouses : []
  const warehouses = warehousesRaw
    .filter((w) => w && typeof w === 'object')
    .map((w, i) => normalizeWarehouse(w, `wh-${index}-${i}`))

  // Только склады, где товар реально есть и у него известна цена:
  // поле goods[].price использовать нельзя, а склад с ценой 0 — это «нет цены»
  const priced = warehouses.filter((w) => w.stock > 0 && w.price > 0)
  const bestOffer = priced.length
    ? priced.reduce((best, w) => (w.price < best.price ? w : best), priced[0])
    : null

  const totalStock = toNumber(raw.count) || warehouses.reduce((sum, w) => sum + w.stock, 0)

  return {
    id: toText(raw.goodsID) || `${toText(raw.brand)}-${toText(raw.number)}-${index}`,
    brand: toText(raw.brand),
    number: toText(raw.number),
    name: toText(raw.name),
    rate: toNumber(raw.rate),
    notRefund: Boolean(raw.notRefund),
    totalStock,
    warehouses,
    bestPrice: bestOffer ? bestOffer.price : null,
    bestOffer,
    hasStock: totalStock > 0 && Boolean(bestOffer),
    // Строка для поиска по результатам (без учёта регистра)
    searchText: `${toText(raw.brand)} ${toText(raw.number)} ${toText(raw.name)}`.toLowerCase(),
  }
}

/** Нормализует массив goods, отбрасывая пустые заглушки. */
export function normalizeGoodsList(rawGoods) {
  if (!Array.isArray(rawGoods)) return []
  return rawGoods
    .filter((raw) => !isEmptyGood(raw))
    .map((raw, index) => normalizeGood(raw, index))
}

/**
 * Разбор ответа на запрос аналогов (number + brand + analogues=on).
 * Сервис кладёт аналоги в goods[0].analogues, а склады/цены самой выбранной
 * детали — в сам goods[0]; в массив analogues она не входит. Поэтому её
 * предложения добавляем первой строкой, иначе склады, цены и даты отгрузки
 * по выбранной детали в таблице не видны.
 */
export function normalizeAnaloguesResponse(data) {
  const rawGoods = Array.isArray(data && data.goods) ? data.goods : []
  const rawBase = rawGoods.find((g) => !isEmptyGood(g)) || null
  const base = rawBase ? normalizeGood(rawBase, 0) : null
  const rawAnalogues = rawBase && Array.isArray(rawBase.analogues) ? rawBase.analogues : []
  const analogues = normalizeGoodsList(rawAnalogues)

  const offers = []
  const seen = new Set()
  if (base && base.warehouses.length > 0) {
    offers.push({ ...base, isBase: true })
    seen.add(base.id)
  }
  for (const item of analogues) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    offers.push(item)
  }

  return { base, offers }
}