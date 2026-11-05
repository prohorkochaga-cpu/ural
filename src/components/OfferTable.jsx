import { Fragment, useState } from 'react'
import { formatInt, formatPrice, formatShipmentDate } from '../utils/format.js'

/** Треугольники сортировки рисуем SVG: глиф ↕ в системном шрифте
 *  схлопывается в узкую вертикальную палочку и читается как опечатка. */
function SortIcon({ dir }) {
  return (
    <svg
      className="sort-header__mark"
      width="8"
      height="12"
      viewBox="0 0 8 12"
      aria-hidden="true"
      focusable="false"
    >
      {dir === 'asc' ? (
        <path d="M4 1 7.4 5.6H0.6L4 1Z" fill="currentColor" />
      ) : dir === 'desc' ? (
        <path d="M4 11 0.6 6.4h6.8L4 11Z" fill="currentColor" />
      ) : (
        <>
          <path d="M4 0.6 7.4 4.6H0.6L4 0.6Z" fill="currentColor" opacity="0.45" />
          <path d="M4 11.4 0.6 7.4h6.8L4 11.4Z" fill="currentColor" opacity="0.45" />
        </>
      )}
    </svg>
  )
}

function SortHeader({ label, column, sortKey, sortDir, onSortChange, className = '' }) {
  const active = sortKey === column
  const ariaSort = active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
  return (
    <th scope="col" aria-sort={ariaSort} className={className}>
      <button
        type="button"
        className={`sort-header${active ? ' is-active' : ''}`}
        onClick={() => onSortChange(column)}
      >
        {label}
        <SortIcon dir={active ? sortDir : null} />
      </button>
    </th>
  )
}

export default function OfferTable({
  base,
  brand,
  rows,
  total,
  hasMore,
  onShowMore,
  query,
  onQueryChange,
  inStockOnly,
  onToggleInStockOnly,
  sortKey,
  sortDir,
  onSortChange,
  onSortApply,
}) {
  const [expanded, setExpanded] = useState(() => new Set())

  const toggleRow = (id) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const resetFilters = () => {
    if (query) onQueryChange('')
    if (inStockOnly) onToggleInStockOnly()
  }

  return (
    <div className="offer-table-wrap">
      <div className="offers-toolbar">
        <div className="offers-toolbar__search">
          <label htmlFor="offers-filter" className="visually-hidden">
            Фильтр по аналогам
          </label>
          <input
            id="offers-filter"
            type="search"
            className="form-control form-control-sm"
            placeholder="Бренд, артикул или название…"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            data-testid="offers-filter"
          />
        </div>
        <div className="form-check mb-0">
          <input
            id="offers-instock"
            type="checkbox"
            className="form-check-input"
            checked={inStockOnly}
            onChange={onToggleInStockOnly}
            data-testid="offers-instock"
          />
          <label className="form-check-label small" htmlFor="offers-instock">
            Только в наличии
          </label>
        </div>
        {/* на телефонах шапка таблицы скрыта — сортировка доступна селектом */}
        <select
          className="form-select form-select-sm offers-toolbar__sort d-lg-none"
          value={`${sortKey}:${sortDir}`}
          onChange={(event) => {
            const [key, dir] = event.target.value.split(':')
            onSortApply?.(key, dir)
          }}
          aria-label="Сортировка предложений"
          data-testid="offers-sort"
        >
          <option value="price:asc">Цена: по возрастанию</option>
          <option value="price:desc">Цена: по убыванию</option>
          <option value="brand:asc">Производитель: А–Я</option>
          <option value="brand:desc">Производитель: Я–А</option>
          <option value="stock:desc">Остаток: больше сначала</option>
          <option value="stock:asc">Остаток: меньше сначала</option>
        </select>
        <span
          className="offers-toolbar__count small text-body-secondary"
          role="status"
          aria-live="polite"
        >
          показано {formatInt(rows.length)} из {formatInt(total)}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="alert alert-secondary d-flex flex-column flex-sm-row align-items-sm-center gap-2 mb-0">
          <span className="flex-grow-1 small">
            По фильтру ничего не найдено. Измените условия отбора, чтобы увидеть предложения
            {brand ? ` бренда ${brand}` : ''}.
          </span>
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={resetFilters}>
            Сбросить фильтры
          </button>
        </div>
      ) : (
        <div className="table-responsive">
          <table className="table table-sm table-hover align-middle offers-table mb-0" data-testid="offer-table">
            <caption className="visually-hidden">
              Аналоги и предложения поставщиков для детали {base ? `${base.number}, ${brand}` : brand}
            </caption>
            <thead className="table-light">
              <tr>
                <SortHeader label="Производитель" column="brand" sortKey={sortKey} sortDir={sortDir} onSortChange={onSortChange} />
                <th scope="col">Артикул</th>
                <th scope="col" className="offers-table__name-col">
                  Наименование
                </th>
                <SortHeader label="Цена" column="price" sortKey={sortKey} sortDir={sortDir} onSortChange={onSortChange} className="text-end" />
                <SortHeader label="Остаток" column="stock" sortKey={sortKey} sortDir={sortDir} onSortChange={onSortChange} className="text-end" />
                <th scope="col" className="text-end">
                  Предложения
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isOpen = expanded.has(row.id)
                const detailsId = `offer-details-${row.id}`
                return (
                  <Fragment key={row.id}>
                    <tr
                      className={[
                        'offer-row',
                        row.isBase ? 'is-base-row' : '',
                        isOpen ? 'is-open' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <td data-label="Производитель">
                        <span className="fw-semibold">{row.brand || '—'}</span>
                        {row.isBase ? (
                          <span
                            className="badge text-bg-primary ms-2"
                            title="Деталь, которую вы выбрали на шаге 1"
                          >
                            выбранная
                          </span>
                        ) : null}
                        {row.notRefund ? (
                          <span
                            className="badge text-bg-warning ms-2"
                            title="Нельзя вернуть по причине «Отказ»"
                          >
                            невозвратная
                          </span>
                        ) : null}
                      </td>
                      <td data-label="Артикул" className="font-monospace text-body-secondary">
                        {row.number || '—'}
                      </td>
                      <td data-label="Наименование" className="offers-table__name-col">
                        <span className="offer-name" title={row.name}>
                          {row.name || '—'}
                        </span>
                        {row.rate > 1 ? (
                          <span className="small text-body-secondary">
                            {' '}
                            · кратность {formatInt(row.rate)}
                          </span>
                        ) : null}
                      </td>
                      <td data-label="Цена" className="text-end text-nowrap">
                        {row.bestPrice != null ? (
                          <span className="offer-price">{formatPrice(row.bestPrice)}</span>
                        ) : (
                          <span className="text-body-secondary small">под заказ</span>
                        )}
                      </td>
                      <td data-label="Остаток" className="text-end text-nowrap">
                        {row.hasStock ? (
                          <span>{formatInt(row.totalStock)} шт.</span>
                        ) : (
                          <span className="badge text-bg-secondary">нет в наличии</span>
                        )}
                      </td>
                      <td data-label="Предложения" className="text-end">
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-secondary offer-details-toggle"
                          onClick={() => toggleRow(row.id)}
                          aria-expanded={isOpen}
                          aria-controls={detailsId}
                        >
                          {formatInt(row.warehouses.length)}
                          <span className="offer-details-toggle__label">
                            {row.warehouses.length === 1 ? ' склад' : ' складов'}
                          </span>
                          <span aria-hidden="true"> {isOpen ? '▴' : '▾'}</span>
                        </button>
                      </td>
                    </tr>
                    <tr
                      className={isOpen ? 'offer-details-row' : 'offer-details-row d-none'}
                      id={detailsId}
                    >
                      <td colSpan={6}>
                        {row.warehouses.length ? (
                          <ul className="warehouse-list list-unstyled mb-0">
                            <li className="warehouse-list__head" aria-hidden="true">
                              <span>Склад</span>
                              <span className="text-end">Цена</span>
                              <span className="text-end">Остаток</span>
                              <span>Отгрузка</span>
                              <span />
                            </li>
                            {row.warehouses.map((warehouse) => (
                              <li key={warehouse.id} className="warehouse-list__item">
                                <span className="warehouse-list__code">
                                  {warehouse.code || 'Склад'}
                                  {warehouse.own ? (
                                    <span className="badge text-bg-success ms-2">наш склад</span>
                                  ) : null}
                                </span>
                                <span className="warehouse-list__price">
                                  {formatPrice(warehouse.price)}
                                </span>
                                <span className="warehouse-list__stock">
                                  остаток: {formatInt(warehouse.stock)} шт.
                                </span>
                                <span className="warehouse-list__date">
                                  отгрузка: {formatShipmentDate(warehouse.shipmentDate)}
                                </span>
                                {warehouse.notRefund ? (
                                  <span className="badge text-bg-warning">невозвратная</span>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span className="small text-body-secondary">
                            Предложений по этой позиции нет — товар отсутствует на складах.
                          </span>
                        )}
                      </td>
                    </tr>
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="offers-footer">
        {hasMore ? (
          <button
            type="button"
            className="btn btn-outline-primary btn-sm"
            onClick={onShowMore}
            data-testid="show-more"
          >
            Показать ещё
          </button>
        ) : (
          <span className="small text-body-secondary">
            Показаны все позиции ({formatInt(total)}).
          </span>
        )}
      </div>
    </div>
  )
}