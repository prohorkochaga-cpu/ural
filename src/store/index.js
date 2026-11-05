import { configureStore } from '@reduxjs/toolkit'
import searchReducer from './searchSlice.js'
import offersReducer from './offersSlice.js'

export const store = configureStore({
  reducer: {
    search: searchReducer,
    offers: offersReducer,
  },
})