/**
 * Тесты редьюсеров и троттлинга запросов: важно, чтобы ответ «просроченного»
 * запроса не перетирал актуальный результат и чтобы вид ошибки доезжал до UI.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { configureStore } from '@reduxjs/toolkit'

import searchReducer, {
  findBrands,
  resetSearch,
  setNumber,
} from '../src/store/searchSlice.js'
import offersReducer, {
  applySort,
  loadOffers,
  resetOffers,
  selectBrand,
} from '../src/store/offersSlice.js'

const makeStore = () => configureStore({ reducer: { search: searchReducer, offers: offersReducer } })

const good = (brand, number) => ({
  id: `${brand}-${number}`,
  brand,
  number,
  name: `${brand} ${number}`,
  bestPrice: 100,
  totalStock: 5,
  hasStock: true,
  warehouses: [],
  searchText: `${brand} ${number}`.toLowerCase(),
})

const pending = (actionCreator, requestId, arg) => ({
  type: actionCreator.pending.type,
  meta: { requestId, arg },
})
const fulfilled = (actionCreator, requestId, arg, payload) => ({
  type: actionCreator.fulfilled.type,
  meta: { requestId, arg },
  payload,
})
const rejected = (actionCreator, requestId, arg, payload) => ({
  type: actionCreator.rejected.type,
  meta: { requestId, arg, aborted: false },
  payload,
  error: { message: 'x' },
})

test('search: актуальный ответ принимается', () => {
  let state = searchReducer(undefined, { type: '@@init' })
  state = searchReducer(state, pending(findBrands, 'r1', { number: '0189', apiKey: 'k' }))
  assert.equal(state.status, 'loading')
  state = searchReducer(
    state,
    fulfilled(findBrands, 'r1', { number: '0189', apiKey: 'k' }, { number: '0189', goods: [good('ZEN', '0189')] }),
  )
  assert.equal(state.status, 'succeeded')
  assert.equal(state.goods.length, 1)
})

test('search: ответ устаревшего запроса игнорируется', () => {
  let state = searchReducer(undefined, { type: '@@init' })
  state = searchReducer(state, pending(findBrands, 'r1', { number: '0189', apiKey: 'k' }))
  state = searchReducer(state, setNumber('5555'))
  state = searchReducer(state, pending(findBrands, 'r2', { number: '5555', apiKey: 'k' }))
  // «медленный» ответ по старому артикулу
  state = searchReducer(
    state,
    fulfilled(findBrands, 'r1', { number: '0189', apiKey: 'k' }, { number: '0189', goods: [good('ZEN', '0189')] }),
  )
  assert.equal(state.goods.length, 0, 'данные по старому артикулу не должны появиться')
  assert.equal(state.status, 'loading')

  state = searchReducer(
    state,
    fulfilled(findBrands, 'r2', { number: '5555', apiKey: 'k' }, { number: '5555', goods: [good('FEBI', '5555')] }),
  )
  assert.deepEqual(state.goods.map((g) => g.brand), ['FEBI'])
})

test('search: пустой ответ переводит в состояние empty', () => {
  let state = searchReducer(undefined, { type: '@@init' })
  state = searchReducer(state, pending(findBrands, 'r1', { number: '0189', apiKey: 'k' }))
  state = searchReducer(state, fulfilled(findBrands, 'r1', { number: '0189', apiKey: 'k' }, { number: '0189', goods: [] }))
  assert.equal(state.status, 'empty')
})

test('search: сброс поиска отменяет приём летящего ответа', () => {
  let state = searchReducer(undefined, { type: '@@init' })
  state = searchReducer(state, pending(findBrands, 'r1', { number: '0189', apiKey: 'k' }))
  state = searchReducer(state, resetSearch())
  state = searchReducer(
    state,
    fulfilled(findBrands, 'r1', { number: '0189', apiKey: 'k' }, { number: '0189', goods: [good('ZEN', '0189')] }),
  )
  assert.equal(state.goods.length, 0)
  assert.equal(state.status, 'idle')
})

test('search: ошибка сохраняется вместе с видом (kind) для разных сообщений в UI', () => {
  let state = searchReducer(undefined, { type: '@@init' })
  state = searchReducer(state, pending(findBrands, 'r1', { number: '0189', apiKey: 'bad' }))
  state = searchReducer(
    state,
    rejected(findBrands, 'r1', { number: '0189', apiKey: 'bad' }, { message: 'Доступ запрещён (403)', kind: 'auth' }),
  )
  assert.equal(state.status, 'failed')
  assert.equal(state.error.kind, 'auth')
  assert.match(state.error.message, /403/)
})

test('offers: ответ по старому артикулу не подменяет новую пару', () => {
  let state = offersReducer(undefined, { type: '@@init' })
  state = offersReducer(state, selectBrand('ZEN'))
  state = offersReducer(state, pending(loadOffers, 'r1', { number: '0189', brand: 'ZEN', apiKey: 'k' }))
  state = offersReducer(state, resetOffers())
  state = offersReducer(state, selectBrand('ZEN'))
  state = offersReducer(state, pending(loadOffers, 'r2', { number: '5555', brand: 'ZEN', apiKey: 'k' }))
  state = offersReducer(
    state,
    fulfilled(
      loadOffers,
      'r1',
      { number: '0189', brand: 'ZEN', apiKey: 'k' },
      { number: '0189', brand: 'ZEN', base: null, offers: [good('FROM-0189', '1')] },
    ),
  )
  assert.equal(state.items.length, 0, 'аналоги другого артикула не должны отобразиться')

  state = offersReducer(
    state,
    fulfilled(
      loadOffers,
      'r2',
      { number: '5555', brand: 'ZEN', apiKey: 'k' },
      { number: '5555', brand: 'ZEN', base: null, offers: [good('FROM-5555', '2')] },
    ),
  )
  assert.deepEqual(state.items.map((i) => i.brand), ['FROM-5555'])
  assert.equal(state.status, 'succeeded')
})

test('offers: пустой список аналогов -> empty, сортировка применяется напрямую', () => {
  let state = offersReducer(undefined, { type: '@@init' })
  state = offersReducer(state, selectBrand('ZEN'))
  state = offersReducer(state, pending(loadOffers, 'r1', { number: '0189', brand: 'ZEN', apiKey: 'k' }))
  state = offersReducer(
    state,
    fulfilled(loadOffers, 'r1', { number: '0189', brand: 'ZEN', apiKey: 'k' }, { number: '0189', brand: 'ZEN', base: null, offers: [] }),
  )
  assert.equal(state.status, 'empty')

  state = offersReducer(state, applySort({ key: 'stock', dir: 'desc' }))
  assert.equal(state.sortKey, 'stock')
  assert.equal(state.sortDir, 'desc')
  state = offersReducer(state, applySort({ key: 'price', dir: 'nonsense' }))
  assert.equal(state.sortDir, 'asc')
})

test('thunk: пустой ключ не идёт в сеть и даёт понятную ошибку', async () => {
  const store = makeStore()
  const originalFetch = globalThis.fetch
  let called = false
  globalThis.fetch = async () => {
    called = true
    return new Response('Forbidden', { status: 403 })
  }
  try {
    await store.dispatch(findBrands({ number: '0189', apiKey: '   ' }))
    const state = store.getState().search
    assert.equal(called, false, 'запрос не должен уходить в сеть')
    assert.equal(state.status, 'failed')
    assert.equal(state.error.kind, 'auth')
    assert.match(state.error.message, /Не указан ключ покупателя/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('thunk: HTTP 403 превращается в ошибку вида auth', async () => {
  const store = makeStore()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('Forbidden', { status: 403 })
  try {
    await store.dispatch(findBrands({ number: '0189', apiKey: 'bad-key' }))
    const state = store.getState().search
    assert.equal(state.status, 'failed')
    assert.equal(state.error.kind, 'auth')
    assert.equal(state.error.status, 403)

    await store.dispatch(loadOffers({ number: '0189', brand: 'ZEN', apiKey: 'bad-key' }))
    const offersState = store.getState().offers
    assert.equal(offersState.status, 'failed')
    assert.equal(offersState.error.kind, 'auth')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('thunk: бизнес-ошибка сервиса {"error": ...} доходит до UI текстом', async () => {
  const store = makeStore()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: 'Request quota exceeded!' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  try {
    await store.dispatch(findBrands({ number: '0189', apiKey: 'k' }))
    const state = store.getState().search
    assert.equal(state.error.kind, 'quota', 'лимит запросов — отдельный вид, а не общая ошибка API')
    assert.match(state.error.message, /лимит запросов/)
  } finally {
    globalThis.fetch = originalFetch
  }
})