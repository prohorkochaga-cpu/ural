/** Юнит-тесты выборки аналогов: поиск, фильтр «в наличии», сортировка, пагинация. */
import test from 'node:test'
import assert from 'node:assert/strict'

import { selectOffersView } from '../src/store/selectors.js'
import { PAGE_SIZE } from '../src/store/offersSlice.js'

const item = (brand, number, bestPrice, totalStock, extra = {}) => ({
  id: `${brand}-${number}`,
  brand,
  number,
  name: `${brand} ${number}`,
  bestPrice,
  totalStock,
  hasStock: bestPrice != null && totalStock > 0,
  searchText: `${brand} ${number} ${brand} ${number}`.toLowerCase(),
  warehouses: [],
  ...extra,
})

const state = (over = {}) => ({
  offers: {
    items: [
      item('OSSCA', '12571', 2136.59, 128),
      item('FEBI', '32582', 5291.77, 32),
      item('MAPCO', '53651', null, 0),
      item('MARSHALL', 'M8081170', 526.85, 160),
    ],
    query: '',
    inStockOnly: false,
    sortKey: 'price',
    sortDir: 'asc',
    limit: PAGE_SIZE,
    ...over,
  },
})

test('по умолчанию сортировка по цене; позиции без предложений — в конце', () => {
  const { rows, total, hasMore } = selectOffersView(state())
  assert.deepEqual(rows.map((r) => r.brand), ['MARSHALL', 'OSSCA', 'FEBI', 'MAPCO'])
  assert.equal(total, 4)
  assert.equal(hasMore, false)
})

test('сортировка по цене по убыванию всё равно оставляет «пустые» позиции в конце', () => {
  const { rows } = selectOffersView(state({ sortDir: 'desc' }))
  assert.deepEqual(rows.map((r) => r.brand), ['FEBI', 'OSSCA', 'MARSHALL', 'MAPCO'])
})

test('sortKey=brand сортирует по названию производителя', () => {
  const { rows } = selectOffersView(state({ sortKey: 'brand' }))
  assert.deepEqual(rows.map((r) => r.brand), ['FEBI', 'MAPCO', 'MARSHALL', 'OSSCA'])
})

test('sortKey=stock сортирует по остатку', () => {
  const { rows } = selectOffersView(state({ sortKey: 'stock', sortDir: 'desc' }))
  assert.deepEqual(rows.map((r) => r.totalStock), [160, 128, 32, 0])
})

test('фильтр «только в наличии» убирает позиции без остатка', () => {
  const view = selectOffersView(state({ inStockOnly: true }))
  assert.equal(view.total, 3)
  assert.equal(view.inStockCount, 3)
  assert.equal(view.totalAll, 4)
  assert.ok(view.rows.every((r) => r.hasStock))
})

test('поиск по строке работает без учёта регистра и по артикулу', () => {
  assert.deepEqual(selectOffersView(state({ query: 'febi' })).rows.map((r) => r.number), ['32582'])
  assert.deepEqual(selectOffersView(state({ query: '12571' })).rows.map((r) => r.brand), ['OSSCA'])
  assert.equal(selectOffersView(state({ query: 'нет-такого' })).rows.length, 0)
})

test('пагинация: limit ограничивает выдачу и hasMore сообщает о продолжении', () => {
  const many = Array.from({ length: PAGE_SIZE + 10 }, (_, i) => item('BRAND', `N${i}`, 100 + i, 1))
  const view = selectOffersView(state({ items: many }))
  assert.equal(view.rows.length, PAGE_SIZE)
  assert.equal(view.total, PAGE_SIZE + 10)
  assert.equal(view.hasMore, true)
  assert.equal(selectOffersView(state({ items: many, limit: PAGE_SIZE * 2 })).hasMore, false)
})

test('выбранная деталь закреплена первой строкой при любой сортировке', () => {
  const base = item('MEYLE', '7160500039/S', 22878.77, 61, { isBase: true })
  const items = [
    item('OSSCA', '12571', 2136.59, 128),
    item('MARSHALL', 'M8081170', 526.85, 160),
    base,
    item('FEBI', '32582', 5291.77, 32),
  ]
  for (const sortKey of ['price', 'brand', 'stock']) {
    for (const sortDir of ['asc', 'desc']) {
      const { rows } = selectOffersView(state({ items, sortKey, sortDir }))
      assert.equal(rows[0].brand, 'MEYLE', `сортировка ${sortKey}/${sortDir}: выбранная деталь должна быть первой`)
      assert.equal(rows.filter((r) => r.isBase).length, 1)
    }
  }
})

test('выбранная деталь не задваивается в счётчиках и не мешает фильтрам', () => {
  const base = item('MEYLE', '7160500039/S', 22878.77, 61, { isBase: true })
  const items = [base, item('OSSCA', '12571', 2136.59, 128), item('MAPCO', '53651', null, 0)]
  const all = selectOffersView(state({ items }))
  assert.equal(all.total, 3)
  assert.equal(all.totalAll, 3)

  const filtered = selectOffersView(state({ items, query: 'ossca' }))
  assert.equal(filtered.rows[0].isBase, true, 'выбранная деталь остаётся видимой как контекст')
  assert.deepEqual(filtered.rows.slice(1).map((r) => r.brand), ['OSSCA'])
})