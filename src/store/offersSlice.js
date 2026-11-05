import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { ApiError, fetchGoods, normalizeAnaloguesResponse } from '../api/favoritApi.js'
import { readUrlParam } from '../utils/url.js'

export const PAGE_SIZE = 25

/** Этап 2: аналоги и предложения для пары «артикул + производитель». */
export const loadOffers = createAsyncThunk(
  'offers/load',
  async ({ number, brand, apiKey }, { signal, rejectWithValue }) => {
    try {
      if (!apiKey || !apiKey.trim()) {
        throw new ApiError('Не указан ключ покупателя — заполните поле «Ключ покупателя».', {
          kind: 'auth',
        })
      }
      const data = await fetchGoods({
        key: apiKey.trim(),
        number: number.trim(),
        brand: brand.trim(),
        analogues: true,
        signal,
      })
      const { base, offers } = normalizeAnaloguesResponse(data)
      return { number: number.trim(), brand: brand.trim(), base, offers }
    } catch (err) {
      if (err && err.name === 'AbortError') throw err
      return rejectWithValue({
        message: err?.message || 'Не удалось получить аналоги.',
        kind: err?.kind || 'unknown',
        status: err?.status || 0,
      })
    }
  },
)

const initialState = {
  brand: readUrlParam('brand'),
  /** idle | loading | succeeded | empty | failed */
  status: 'idle',
  base: null,
  items: [],
  error: null,
  /* настройки просмотра результата */
  query: '',
  inStockOnly: false,
  sortKey: 'price', // price | brand | stock
  sortDir: 'asc',
  limit: PAGE_SIZE,
  /** id последнего актуального запроса — защита от ответов «просроченных» запросов */
  pendingRequestId: '',
}

const offersSlice = createSlice({
  name: 'offers',
  initialState,
  reducers: {
    selectBrand(state, action) {
      state.brand = action.payload
      state.status = 'loading'
      state.error = null
      state.base = null
      state.items = []
      state.limit = PAGE_SIZE
      state.pendingRequestId = ''
    },
    resetOffers(state) {
      state.brand = ''
      state.status = 'idle'
      state.base = null
      state.items = []
      state.error = null
      state.query = ''
      state.inStockOnly = false
      state.limit = PAGE_SIZE
      state.pendingRequestId = ''
    },
    setQuery(state, action) {
      state.query = action.payload
      state.limit = PAGE_SIZE
    },
    toggleInStockOnly(state) {
      state.inStockOnly = !state.inStockOnly
      state.limit = PAGE_SIZE
    },
    setSort(state, action) {
      const key = action.payload
      if (state.sortKey === key) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc'
      } else {
        state.sortKey = key
        state.sortDir = 'asc'
      }
      state.limit = PAGE_SIZE
    },
    applySort(state, action) {
      state.sortKey = action.payload.key
      state.sortDir = action.payload.dir === 'desc' ? 'desc' : 'asc'
      state.limit = PAGE_SIZE
    },
    showMore(state) {
      state.limit += PAGE_SIZE
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadOffers.pending, (state, action) => {
        state.status = 'loading'
        state.error = null
        state.base = null
        state.items = []
        state.pendingRequestId = action.meta.requestId
      })
      .addCase(loadOffers.fulfilled, (state, action) => {
        if (action.meta.requestId !== state.pendingRequestId) return
        state.base = action.payload.base
        state.items = action.payload.offers
        state.status = action.payload.offers.length ? 'succeeded' : 'empty'
        state.error = null
        state.limit = PAGE_SIZE
      })
      .addCase(loadOffers.rejected, (state, action) => {
        if (action.meta.aborted) return
        if (action.meta.requestId !== state.pendingRequestId) return
        state.status = 'failed'
        state.base = null
        state.items = []
        state.error = action.payload || {
          message: action.error?.message || 'Не удалось получить аналоги.',
          kind: 'unknown',
        }
      })
  },
})

export const {
  selectBrand,
  resetOffers,
  setQuery,
  toggleInStockOnly,
  setSort,
  applySort,
  showMore,
} = offersSlice.actions
export default offersSlice.reducer