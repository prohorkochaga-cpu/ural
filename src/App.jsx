import { useEffect, useRef } from 'react'
import { useDispatch, useSelector } from 'react-redux'

import SearchForm from './components/SearchForm.jsx'
import BrandList from './components/BrandList.jsx'
import OfferTable from './components/OfferTable.jsx'
import Loader from './components/Loader.jsx'
import ErrorAlert from './components/ErrorAlert.jsx'
import EmptyState from './components/EmptyState.jsx'

import {
  API_KEY_STORAGE,
  MIN_QUERY_LENGTH,
  SEARCH_DEBOUNCE_MS,
  findBrands,
  resetSearch,
  setApiKey,
  setNumber,
} from './store/searchSlice.js'
import {
  applySort,
  loadOffers,
  resetOffers,
  selectBrand,
  setQuery,
  setSort,
  showMore,
  toggleInStockOnly,
} from './store/offersSlice.js'
import { selectOffersView } from './store/selectors.js'
import { brandsLabel, errorHint, formatInt, offersLabel, positionsLabel } from './utils/format.js'

export default function App() {
  const dispatch = useDispatch()
  const search = useSelector((state) => state.search)
  const offers = useSelector((state) => state.offers)
  const view = useSelector(selectOffersView)

  const trimmedNumber = search.number.trim()

  // актуальный ключ читаем из ref: смена ключа не должна сама по себе
  // запускать новые запросы (иначе каждый символ = запрос)
  const apiKeyRef = useRef(search.apiKey)
  apiKeyRef.current = search.apiKey

  const lastSearchKey = useRef('')
  const stage2Ref = useRef(null)
  const debounceTimer = useRef(null)

  /* --- Этап 1: автопоиск производителей по мере ввода ------------------ */
  useEffect(() => {
    if (trimmedNumber.length < MIN_QUERY_LENGTH) {
      dispatch(resetSearch())
      lastSearchKey.current = ''
      return undefined
    }

    const requestKey = `${trimmedNumber}|${apiKeyRef.current}`
    if (lastSearchKey.current === requestKey) return undefined

    const timer = setTimeout(() => {
      lastSearchKey.current = requestKey
      dispatch(findBrands({ number: trimmedNumber, apiKey: apiKeyRef.current }))
    }, SEARCH_DEBOUNCE_MS)
    debounceTimer.current = timer

    return () => clearTimeout(timer)
  }, [trimmedNumber, dispatch])

  /* --- Смена артикула сбрасывает выбранного производителя --------------
         На первом рендере ничего не сбрасываем: бренд мог прийти из URL. */
  const previousNumber = useRef(trimmedNumber)
  useEffect(() => {
    if (previousNumber.current === trimmedNumber) return
    previousNumber.current = trimmedNumber
    dispatch(resetOffers())
  }, [trimmedNumber, dispatch])

  /* --- Этап 2: аналоги для выбранной пары -------------------------------
         Загружаем по явному выбору производителя (в том числе повторному —
         поэтому нельзя полагаться только на изменение state.offers.brand),
         а на старте — если пара пришла из ссылки. */
  const loadOffersFor = (brand) => {
    if (!brand || !trimmedNumber) return
    dispatch(loadOffers({ number: trimmedNumber, brand, apiKey: apiKeyRef.current }))
  }

  const initialBrand = useRef(offers.brand)
  useEffect(() => {
    if (initialBrand.current && trimmedNumber) {
      dispatch(
        loadOffers({
          number: trimmedNumber,
          brand: initialBrand.current,
          apiKey: apiKeyRef.current,
        }),
      )
    }
    initialBrand.current = ''
  }, [dispatch, trimmedNumber])

  /* --- Ключ покупателя сохраняем между сессиями ------------------------ */
  useEffect(() => {
    try {
      window.localStorage.setItem(API_KEY_STORAGE, search.apiKey)
    } catch {
      /* приватный режим браузера — просто игнорируем */
    }
  }, [search.apiKey])

  /* --- Состояние в URL: ссылкой можно поделиться ----------------------- */
  useEffect(() => {
    const params = new URLSearchParams()
    if (trimmedNumber) params.set('number', trimmedNumber)
    if (offers.brand) params.set('brand', offers.brand)
    const query = params.toString()
    const next = `${window.location.pathname}${query ? `?${query}` : ''}`
    if (next !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, '', next)
    }
  }, [trimmedNumber, offers.brand])

  /* --- Восстановление состояния из URL выполняется в момент создания
         store (см. src/store/*.js): ?number=0189&brand=ZEN сразу запускает
         оба этапа, поэтому отдельный эффект не нужен. --------------------- */

  const retrySearch = () => {
    lastSearchKey.current = ''
    dispatch(findBrands({ number: trimmedNumber, apiKey: apiKeyRef.current }))
  }

  const retryOffers = () => loadOffersFor(offers.brand)

  const clearBrand = () => dispatch(resetOffers())

  const onSubmitSearch = () => {
    if (trimmedNumber.length < MIN_QUERY_LENGTH) return
    // отменяем отложенный автопоиск, чтобы не отправлять тот же запрос дважды
    clearTimeout(debounceTimer.current)
    debounceTimer.current = null
    lastSearchKey.current = `${trimmedNumber}|${search.apiKey}`
    dispatch(findBrands({ number: trimmedNumber, apiKey: search.apiKey }))
  }

  const brandCount = new Set(search.goods.map((good) => good.brand)).size
  const inStockGoods = search.goods.filter((good) => good.hasStock).length

  const stage1Hint =
    trimmedNumber.length === 0
      ? 'Введите артикул детали — например, 7160500039S или 0189.'
      : trimmedNumber.length < MIN_QUERY_LENGTH
        ? `Введите минимум ${MIN_QUERY_LENGTH} символа артикула.`
        : 'Как только вы перестанете вводить номер, отправим запрос в сервис.'

  return (
    <div className="app-shell d-flex flex-column min-vh-100">
      <header className="app-header text-white">
        <div className="container-xl py-3 py-md-4">
          <div className="d-flex flex-wrap align-items-center justify-content-between gap-3">
            <div>
              <h1 className="h4 mb-1">Подбор автозапчастей и аналогов</h1>
              <p className="mb-0 small app-header__subtitle">
                Web-сервис «Проценка» · Favorit Parts
              </p>
            </div>
            {/* Два этапа = два шага; активный ровно один */}
            <ol className="app-steps list-unstyled mb-0 d-none d-md-flex">
              <li className={offers.brand ? 'is-done' : 'is-active'}>
                <span>1</span> Артикул и производитель
              </li>
              <li className={offers.brand ? 'is-active' : ''}>
                <span>2</span> Аналоги и предложения
              </li>
            </ol>
          </div>
        </div>
      </header>

      <main className="container-xl flex-grow-1 py-4">
        {/* -------------------------- Этап 1 --------------------------- */}
        <section className="card step-card shadow-sm mb-4" aria-labelledby="stage1-title">
          <div className="card-body">
            <div className="step-heading">
              <span className="step-heading__num" aria-hidden="true">
                1
              </span>
              <div>
                <h2 id="stage1-title" className="h5 mb-1">
                  Поиск производителей
                </h2>
                <p className="text-body-secondary small mb-0">
                  Введите номер детали — сервис вернёт всех производителей с этим артикулом.
                </p>
              </div>
            </div>

            <SearchForm
              apiKey={search.apiKey}
              number={search.number}
              onApiKeyChange={(value) => dispatch(setApiKey(value))}
              onNumberChange={(value) => dispatch(setNumber(value))}
              onSubmit={onSubmitSearch}
              searching={search.status === 'loading'}
              canSubmit={trimmedNumber.length >= MIN_QUERY_LENGTH}
            />

            {/* Отдельный однострочный статус для скринридера: сам список
                результатов не должен переозвучиваться при каждом изменении. */}
            <p className="visually-hidden" role="status" aria-live="polite">
              {search.status === 'loading'
                ? 'Идёт поиск производителей'
                : search.status === 'failed'
                  ? `Ошибка: ${search.error?.message || ''}`
                  : search.status === 'empty'
                    ? 'Деталь не найдена'
                    : search.status === 'succeeded'
                      ? `Найдено ${positionsLabel(search.goods.length)}, ${brandsLabel(brandCount)}`
                      : ''}
            </p>

            <div className="mt-4">
              {search.status === 'idle' && (
                <p className="text-body-secondary small mb-0">{stage1Hint}</p>
              )}

              {search.status === 'loading' && (
                <div className="loading-block">
                  <Loader label="Ищем производителей по артикулу…" />
                </div>
              )}

              {search.status === 'failed' && (
                <ErrorAlert
                  title="Не удалось получить список производителей"
                  message={search.error?.message}
                  details={errorHint(search.error?.kind)}
                  onRetry={retrySearch}
                />
              )}

              {search.status === 'empty' && (
                <EmptyState
                  title="Деталь не найдена"
                  message={`По артикулу «${search.searchedNumber || trimmedNumber}» в базе нет предложений. Проверьте написание номера или попробуйте другой артикул.`}
                />
              )}

              {search.status === 'succeeded' && (
                <>
                  <div className="result-summary">
                    <span className="badge text-bg-primary">
                      {positionsLabel(search.goods.length)}
                    </span>
                    <span className="badge text-bg-light border">{brandsLabel(brandCount)}</span>
                    <span className="badge text-bg-light border">
                      в наличии: {formatInt(inStockGoods)}
                    </span>
                    <span className="ms-auto small text-body-secondary">
                      Шаг 2: выберите производителя, чтобы увидеть аналоги
                    </span>
                  </div>
                  <BrandList
                    goods={search.goods}
                    selectedBrand={offers.brand}
                    onSelect={(brand) => {
                      if (!brand) return
                      dispatch(selectBrand(brand))
                      loadOffersFor(brand)
                      // на невысоких экранах второй шаг может быть ниже границы окна
                      stage2Ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
                    }}
                  />
                </>
              )}
            </div>
          </div>
        </section>

        {/* -------------------------- Этап 2 --------------------------- */}
        <section ref={stage2Ref} className="card step-card shadow-sm" aria-labelledby="stage2-title">
          <div className="card-body">
            <div className="step-heading">
              <span className="step-heading__num" aria-hidden="true">
                2
              </span>
              <div className="flex-grow-1">
                <h2 id="stage2-title" className="h5 mb-1">
                  Аналоги и предложения
                </h2>
                <p className="text-body-secondary small mb-0">
                  {offers.brand
                    ? `Артикул ${trimmedNumber} · производитель ${offers.brand}`
                    : 'Выберите производителя из шага 1 — сервис вернёт аналоги и предложения поставщиков.'}
                </p>
              </div>
              {offers.brand && (
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary text-nowrap"
                  onClick={clearBrand}
                  title="Снять выбранного производителя и очистить таблицу аналогов"
                >
                  Сбросить производителя
                </button>
              )}
            </div>

            <p className="visually-hidden" role="status" aria-live="polite">
              {offers.status === 'loading'
                ? 'Загружаем аналоги'
                : offers.status === 'failed'
                  ? `Ошибка: ${offers.error?.message || ''}`
                  : offers.status === 'empty'
                    ? 'Аналоги не найдены'
                    : offers.status === 'succeeded'
                      ? `Загружено ${offersLabel(view.totalAll)}, в наличии ${formatInt(view.inStockCount)}`
                      : ''}
            </p>

            <div className="mt-3">
              {/* пустое состояние уже описано подзаголовком карточки — второй
                  строки «Ожидание выбора…» не нужно */}
              {offers.status === 'loading' && (
                <div className="loading-block">
                  <Loader label={`Загружаем аналоги для ${offers.brand}…`} />
                </div>
              )}

              {offers.status === 'failed' && (
                <ErrorAlert
                  title="Не удалось загрузить аналоги"
                  message={offers.error?.message}
                  details={errorHint(offers.error?.kind)}
                  onRetry={retryOffers}
                />
              )}

              {offers.status === 'empty' && (
                <EmptyState
                  title="Аналоги не найдены"
                  message={`Для пары «${trimmedNumber} / ${offers.brand}» сервис не вернул аналогов. Попробуйте другого производителя.`}
                />
              )}

              {offers.status === 'succeeded' && (
                <>
                  {/* «показано N из M» выводит тулбар таблицы — не дублируем */}
                  <div className="result-summary">
                    <span className="badge text-bg-success">{offersLabel(view.totalAll)}</span>
                    <span className="badge text-bg-light border">
                      в наличии: {formatInt(view.inStockCount)}
                    </span>
                  </div>
                  <OfferTable
                    base={offers.base}
                    brand={offers.brand}
                    rows={view.rows}
                    total={view.total}
                    hasMore={view.hasMore}
                    onShowMore={() => dispatch(showMore())}
                    query={offers.query}
                    onQueryChange={(value) => dispatch(setQuery(value))}
                    inStockOnly={offers.inStockOnly}
                    onToggleInStockOnly={() => dispatch(toggleInStockOnly())}
                    sortKey={offers.sortKey}
                    sortDir={offers.sortDir}
                    onSortChange={(key) => dispatch(setSort(key))}
                    onSortApply={(key, dir) => dispatch(applySort({ key, dir }))}
                  />
                </>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="app-footer text-center small py-3">
        Данные предоставлены web-сервисом «Проценка» (api.favorit-parts.ru). Цены и остатки носят
        справочный характер.
      </footer>
    </div>
  )
}