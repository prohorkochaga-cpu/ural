import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { ApiError, DEMO_API_KEY, fetchGoods, normalizeGoodsList } from '../api/favoritApi.js'
import { readUrlParam } from '../utils/url.js'

export const API_KEY_STORAGE = 'favorit-parts.apiKey'
export const MIN_QUERY_LENGTH = 3
export const SEARCH_DEBOUNCE_MS = 600

export function readStoredApiKey() {
  try {
    const stored = window.localStorage.getItem(API_KEY_STORAGE)
    return stored == null ? DEMO_API_KEY : stored
  } catch {
    return DEMO_API_KEY
  }
}

function assertCredentials({ apiKey, number }) {
  if (!apiKey || !apiKey.trim()) {
    throw new ApiError('Не указан ключ покупателя — заполните поле «Ключ покупателя».', {
      kind: 'auth',
    })
  }
  if (!number || !number.trim()) {
    throw new ApiError('Укажите артикул (номер) детали.', {
      kind: 'api',
      details: 'Empty number goods!',
    })
  }
}

/**
 * Этап 1: список производителей (брендов) для артикула.
 * Ошибку отдаём через rejectWithValue, потому что RTK сериализует обычный Error
 * в {name, message, stack} и теряет наши поля kind/status.
 */
export const findBrands = createAsyncThunk(
  'search/findBrands',
  async ({ number, apiKey }, { signal, rejectWithValue }) => {
    try {
      assertCredentials({ apiKey, number })
      const data = await fetchGoods({ key: apiKey.trim(), number: number.trim(), signal })
      return { number: number.trim(), goods: normalizeGoodsList(data.goods) }
    } catch (err) {
      if (err && err.name === 'AbortError') throw err
      return rejectWithValue({
        message: err?.message || 'Не удалось получить список производителей.',
        kind: err?.kind || 'unknown',
        status: err?.status || 0,
      })
    }
  },
)

const initialState = {
  apiKey: readStoredApiKey(),
  number: readUrlParam('number'),
  /** idle | loading | succeeded | empty | failed */
  status: 'idle',
  goods: [],
  error: null,
  /** артикул, по которому получен текущий результат */
  searchedNumber: '',
  /** id последнего актуального запроса — защита от ответов «просроченных» запросов */
  pendingRequestId: '',
}

const searchSlice = createSlice({
  name: 'search',
  initialState,
  reducers: {
    setApiKey(state, action) {
      state.apiKey = action.payload
    },
    setNumber(state, action) {
      state.number = action.payload
    },
    resetSearch(state) {
      state.status = 'idle'
      state.goods = []
      state.error = null
      state.searchedNumber = ''
      // всё, что ещё летит в сеть, уже неактуально
      state.pendingRequestId = ''
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(findBrands.pending, (state, action) => {
        state.status = 'loading'
        state.error = null
        state.goods = []
        state.searchedNumber = action.meta.arg.number
        state.pendingRequestId = action.meta.requestId
      })
      .addCase(findBrands.fulfilled, (state, action) => {
        if (action.meta.requestId !== state.pendingRequestId) return
        state.goods = action.payload.goods
        state.status = action.payload.goods.length ? 'succeeded' : 'empty'
        state.error = null
      })
      .addCase(findBrands.rejected, (state, action) => {
        if (action.meta.aborted) return
        if (action.meta.requestId !== state.pendingRequestId) return
        state.status = 'failed'
        state.goods = []
        state.error = action.payload || {
          message: action.error?.message || 'Не удалось получить список производителей.',
          kind: 'unknown',
        }
      })
  },
})

export const { setApiKey, setNumber, resetSearch } = searchSlice.actions
export default searchSlice.reducer