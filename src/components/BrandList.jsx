import { formatInt, formatPrice } from '../utils/format.js'

export default function BrandList({ goods, selectedBrand, onSelect }) {
  return (
    <div className="brand-list" data-testid="brand-list">
      <div className="brand-list__head" aria-hidden="true">
        <span>Производитель</span>
        <span>Артикул</span>
        <span>Наименование</span>
        <span className="text-end">Цена</span>
        <span className="text-end">Остаток</span>
        <span />
      </div>
      <ul className="brand-list__items list-unstyled mb-0">
        {goods.map((good) => {
          const selected = Boolean(selectedBrand) && good.brand === selectedBrand
          return (
            <li key={good.id} className="brand-list__item">
              <button
                type="button"
                className={`brand-list__button${selected ? ' is-selected' : ''}`}
                onClick={() => onSelect(good.brand)}
                aria-pressed={selected}
                disabled={!good.brand}
                title={good.brand ? undefined : 'У позиции нет названия производителя'}
                aria-label={`Показать аналоги: ${good.brand || 'без производителя'}, артикул ${good.number}`}
              >
                <span className="brand-list__brand">
                  {good.brand || 'Без производителя'}
                  {selected ? <span className="brand-list__check" aria-hidden="true">✓</span> : null}
                </span>
                <span className="brand-list__number font-monospace text-body-secondary">
                  {good.number || '—'}
                </span>
                <span className="brand-list__name" title={good.name}>
                  {good.name || '—'}
                </span>
                <span className="brand-list__price">{formatPrice(good.bestPrice)}</span>
                <span className="brand-list__stock">
                  {good.hasStock ? (
                    <span>
                      {formatInt(good.totalStock)}
                      <span className="brand-list__stock-unit"> шт.</span>
                    </span>
                  ) : (
                    <span className="badge text-bg-secondary">нет в наличии</span>
                  )}
                </span>
                <span className="brand-list__cta">
                  Аналоги
                  <span aria-hidden="true"> →</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}