import { createSelector } from '@reduxjs/toolkit'
import { PAGE_SIZE } from './offersSlice.js'

const collator = new Intl.Collator('ru', { sensitivity: 'base' })

/** Компаратор с «пустыми» ценами в конце списка при любом направлении сортировки. */
function comparePrice(a, b, dir) {
  const aNull = a.bestPrice == null
  const bNull = b.bestPrice == null
  if (aNull && bNull) return b.totalStock - a.totalStock
  if (aNull) return 1
  if (bNull) return -1
  return (a.bestPrice - b.bestPrice) * dir
}

function compareText(a, b) {
  return collator.compare(String(a), String(b))
}

function buildView(items, query, inStockOnly, sortKey, sortDir, limit) {
  const needle = query.trim().toLowerCase()
  const dir = sortDir === 'desc' ? -1 : 1

  // Выбранная на шаге 1 деталь всегда идёт первой строкой: под сортировкой
  // по цене она иначе уезжает в середину списка и теряется среди аналогов.
  const baseItem = items.find((row) => row.isBase) || null
  const analogues = baseItem ? items.filter((row) => !row.isBase) : items

  let rows = analogues
  if (needle) rows = rows.filter((row) => row.searchText.includes(needle))
  if (inStockOnly) rows = rows.filter((row) => row.hasStock)

  const sorted = [...rows].sort((a, b) => {
    if (sortKey === 'brand') {
      const byBrand = compareText(a.brand, b.brand)
      if (byBrand) return byBrand * dir
    } else if (sortKey === 'stock') {
      const byStock = a.totalStock - b.totalStock
      if (byStock) return byStock * dir
    } else {
      const byPrice = comparePrice(a, b, dir)
      if (byPrice) return byPrice
    }
    return compareText(a.number, b.number) || compareText(a.brand, b.brand)
  })

  const safeLimit = Math.max(limit, PAGE_SIZE)
  const visibleAnalogues = sorted.slice(0, safeLimit)
  const withBase = baseItem ? [baseItem, ...visibleAnalogues] : visibleAnalogues
  const totalWithBase = sorted.length + (baseItem ? 1 : 0)

  return {
    rows: withBase,
    total: totalWithBase,
    totalAll: items.length,
    inStockCount: items.filter((row) => row.hasStock).length,
    hasMore: sorted.length > safeLimit,
  }
}

/**
 * Видимая часть списка аналогов: поиск по строке, фильтр «только в наличии»,
 * сортировка и постраничная выдача. Мемоизирована, чтобы не перерисовывать
 * таблицу на 741 позицию при каждом обновлении стора.
 */
export const selectOffersView = createSelector(
  [
    (state) => state.offers.items,
    (state) => state.offers.query,
    (state) => state.offers.inStockOnly,
    (state) => state.offers.sortKey,
    (state) => state.offers.sortDir,
    (state) => state.offers.limit,
  ],
  buildView,
)