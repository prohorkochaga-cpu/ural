/**
 * Юнит-тесты на разбор ответов web-сервиса «Проценка».
 * Запуск: npm test  (node --test, без установки дополнительных зависимостей)
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'

import {
  ApiError,
  buildUrl,
  fetchGoods,
  isEmptyGood,
  normalizeAnaloguesResponse,
  normalizeGood,
  normalizeGoodsList,
} from '../src/api/favoritApi.js'

const warehouse = (over = {}) => ({
  code: 'МСК РС',
  id: 'wh-1',
  own: false,
  price: 1000,
  stock: 5,
  shipmentDate: '2026-11-07T13:30:00+03:00',
  ...over,
})

const good = (over = {}) => ({
  goodsID: 'ID-1',
  brand: 'MEYLE',
  number: '7160500039/S',
  name: 'Рычаги задней подвески',
  count: 61,
  price: 23250.07,
  rate: 1,
  warehouses: [warehouse()],
  ...over,
})

test('buildUrl экранирует спецсимволы в артикуле и бренде', () => {
  const url = buildUrl({
    key: 'KEY',
    number: '0189#1',
    brand: 'J+P Group',
    analogues: true,
    baseUrl: 'http://example.test/hs/hsprice/',
  })
  assert.match(url, /number=0189%231/)
  assert.match(url, /brand=J%2BP\+Group/)
  assert.match(url, /analogues=on/)
  assert.ok(!url.includes('#'))
})

test('buildUrl без brand и analogues не добавляет лишних параметров', () => {
  const url = buildUrl({ key: 'KEY', number: '0189', baseUrl: 'http://example.test/hs/hsprice/' })
  const params = new URL(url).searchParams
  assert.equal(params.get('key'), 'KEY')
  assert.equal(params.get('number'), '0189')
  assert.equal(params.has('brand'), false)
  assert.equal(params.has('analogues'), false)
})

test('пустая заглушка «деталь не найдена» распознаётся', () => {
  assert.equal(
    isEmptyGood({ brand: '', number: '', name: '', count: 0, price: 0, rate: 0, warehouses: [] }),
    true,
  )
  assert.equal(isEmptyGood(good()), false)
  assert.equal(isEmptyGood(null), true)
})

test('normalizeGoodsList отбрасывает заглушку и сохраняет товар', () => {
  const list = normalizeGoodsList([
    { brand: '', count: 0, goodsID: '00000000-0000-0000-0000-000000000000', name: '', number: '', price: 0, rate: 0, warehouses: [] },
    good(),
  ])
  assert.equal(list.length, 1)
  assert.equal(list[0].brand, 'MEYLE')
})

test('цена берётся из складов: минимальная среди складов с остатком', () => {
  const item = normalizeGood(
    good({
      price: 999999, // поле price верхнего уровня игнорируется
      warehouses: [
        warehouse({ price: 3000, stock: 2 }),
        warehouse({ id: 'wh-2', price: 1500, stock: 4 }),
        warehouse({ id: 'wh-3', price: 900, stock: 0 }), // нет остатка — не участвует
      ],
    }),
  )
  assert.equal(item.bestPrice, 1500)
  assert.equal(item.bestOffer.id, 'wh-2')
  assert.equal(item.totalStock, 61)
  assert.equal(item.hasStock, true)
  assert.equal(item.warehouses.length, 3)
})

test('позиция без остатка и без складов не считается доступной', () => {
  const item = normalizeGood(good({ count: 0, warehouses: [] }), 2)
  assert.equal(item.totalStock, 0)
  assert.equal(item.bestPrice, null)
  assert.equal(item.hasStock, false)
  assert.equal(item.warehouses.length, 0)
  assert.ok(item.id, 'id генерируется, если goodsID пустой')
})

test('count пересчитывается по складам, если сервис вернул 0', () => {
  const item = normalizeGood(good({ count: 0, warehouses: [warehouse({ stock: 3 }), warehouse({ id: 'wh-2', stock: 4 })] }))
  assert.equal(item.totalStock, 7)
})

test('searchText позволяет искать по бренду, артикулу и названию', () => {
  const item = normalizeGood(good())
  assert.ok(item.searchText.includes('meyle'))
  assert.ok(item.searchText.includes('7160500039/s'))
  assert.ok(item.searchText.includes('рычаги'))
})

test('normalizeAnaloguesResponse: аналоги + предложения самой выбранной детали', () => {
  const { base, offers } = normalizeAnaloguesResponse({
    goods: [good({ analogues: [good({ goodsID: 'A-1', brand: 'OSSCA', number: '12571' }), good({ goodsID: 'A-2', brand: 'FEBI', number: '32582' })] })],
  })
  assert.equal(base.brand, 'MEYLE')
  // первая строка — сама выбранная деталь (её склады сервис в analogues не кладёт)
  assert.equal(offers.length, 3)
  assert.equal(offers[0].isBase, true)
  assert.equal(offers[0].id, base.id)
  assert.deepEqual(offers.slice(1).map((o) => o.brand), ['OSSCA', 'FEBI'])
})

test('normalizeAnaloguesResponse: выбранная деталь без складов не добавляется', () => {
  const { offers } = normalizeAnaloguesResponse({
    goods: [good({ warehouses: [], count: 0, analogues: [good({ goodsID: 'A-1', brand: 'OSSCA' })] })],
  })
  assert.equal(offers.length, 1)
  assert.equal(offers[0].isBase, undefined)
})

test('normalizeAnaloguesResponse: дубликат выбранной детали в аналогах не дублируется', () => {
  const baseGood = good({ analogues: [good(), good({ goodsID: 'A-2', brand: 'FEBI' })] })
  const { offers } = normalizeAnaloguesResponse({ goods: [baseGood] })
  assert.equal(offers.length, 2)
  assert.equal(new Set(offers.map((o) => o.id)).size, 2)
})

test('normalizeAnaloguesResponse: пустой ответ не ломает разбор', () => {
  assert.deepEqual(normalizeAnaloguesResponse({ goods: [] }), { base: null, offers: [] })
  assert.deepEqual(normalizeAnaloguesResponse({}), { base: null, offers: [] })
  assert.deepEqual(
    normalizeAnaloguesResponse({ goods: [{ brand: '', number: '', name: '', warehouses: [] }] }),
    { base: null, offers: [] },
  )
})

test('ApiError сохраняет вид ошибки для разных сообщений в UI', () => {
  const err = new ApiError('нет доступа', { kind: 'auth', status: 403 })
  assert.equal(err.kind, 'auth')
  assert.equal(err.status, 403)
  assert.ok(err instanceof Error)
})

test('лимит запросов (тоже HTTP 403) отличается от ошибки ключа', async () => {
  await withServer(respond(403, '{"error":"Request quota exceeded!"}'), async (baseUrl) => {
    await assert.rejects(
      () => fetchGoods({ key: 'k', number: '0189', brand: 'HAFFEN', baseUrl }),
      (err) => {
        assert.equal(err.status, 403)
        assert.equal(err.kind, 'quota', 'это не ошибка ключа — иначе UI даст неверный совет')
        assert.match(err.message, /лимит запросов/)
        return true
      },
    )
  })
})

test('бизнес-ошибка в теле 200 тоже классифицируется', async () => {
  await withServer(respond(200, '{"error":"Request quota exceeded!"}'), async (baseUrl) => {
    await assert.rejects(
      () => fetchGoods({ key: 'k', number: '1', baseUrl }),
      (err) => err.kind === 'quota',
    )
  })
})

/* ---------- Ответы сервиса об ошибках (локальный сервер) ---------- */

async function withServer(handler, fn) {
  const server = http.createServer(handler)
  await new Promise((resolve) => server.listen(0, resolve))
  const base = `http://127.0.0.1:${server.address().port}/hs/hsprice/`
  try {
    return await fn(base)
  } finally {
    server.close()
  }
}

const respond = (status, body) => (req, res) => {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(body)
}

test('403 с телом {"error": ...}: показываем перевод, а не только код', async () => {
  await withServer(respond(403, '{"error":"Empty key!"}'), async (baseUrl) => {
    await assert.rejects(
      () => fetchGoods({ key: '', number: '0189', baseUrl }),
      (err) => {
        assert.equal(err.kind, 'auth')
        assert.equal(err.status, 403)
        assert.match(err.message, /Не указан ключ покупателя/)
        assert.doesNotMatch(err.message, /Empty key/, 'английский токен не показываем пользователю')
        return true
      },
    )
  })
})

test('неверный ключ: реальный текст сервиса "Invalid access key" переводится', async () => {
  await withServer(respond(403, '{"error":"Invalid access key"}'), async (baseUrl) => {
    await assert.rejects(
      () => fetchGoods({ key: 'bad-key', number: '0189', baseUrl }),
      (err) => {
        assert.equal(err.kind, 'auth')
        assert.match(err.message, /Неверный ключ покупателя/)
        return true
      },
    )
  })
})

test('несколько ошибок в одной строке переводятся вместе', async () => {
  await withServer(respond(200, '{"error":"Empty key! Invalid key client!"}'), async (baseUrl) => {
    await assert.rejects(
      () => fetchGoods({ key: 'k', number: '1', baseUrl }),
      (err) => {
        assert.match(err.message, /Не указан ключ покупателя/)
        assert.match(err.message, /Неверный ключ покупателя/)
        return true
      },
    )
  })
})

test('HTTP 500 и не-JSON приводятся к разным видам ошибок', async () => {
  await withServer(respond(500, 'boom'), async (baseUrl) => {
    await assert.rejects(
      () => fetchGoods({ key: 'k', number: '1', baseUrl }),
      (err) => err.kind === 'api' && err.status === 500,
    )
  })
  await withServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end('<html></html>')
  }, async (baseUrl) => {
    await assert.rejects(
      () => fetchGoods({ key: 'k', number: '1', baseUrl }),
      (err) => err.kind === 'parse',
    )
  })
})

test('числовые строки с разделителями тысяч разбираются корректно', () => {
  const item = normalizeGood({
    brand: 'X',
    number: '1',
    name: 'N',
    count: '1 234',
    warehouses: [{ id: 'w', price: '1 234,50', stock: '2', code: 'Склад' }],
  })
  assert.equal(item.bestPrice, 1234.5)
  assert.equal(item.totalStock, 1234)
  assert.equal(item.hasStock, true)
})