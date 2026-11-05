export default function SearchForm({
  apiKey,
  number,
  onApiKeyChange,
  onNumberChange,
  onSubmit,
  searching,
  canSubmit,
}) {
  const handleSubmit = (event) => {
    event.preventDefault()
    if (searching || !canSubmit) return
    onSubmit()
  }

  return (
    <form className="row g-3 mt-1" onSubmit={handleSubmit} noValidate>
      <div className="col-12 col-xl-6">
        <label htmlFor="part-number-input" className="form-label fw-semibold">
          Артикул (номер детали)
        </label>
        <div className="input-group input-group-lg">
          <input
            id="part-number-input"
            name="number"
            type="text"
            className="form-control font-monospace text-uppercase"
            placeholder="Например, 7160500039S"
            value={number}
            onChange={(event) => onNumberChange(event.target.value)}
            autoFocus
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-describedby="part-number-hint"
            data-testid="part-number-input"
          />
          <button
            type="submit"
            className="btn btn-primary px-4 d-inline-flex align-items-center"
            disabled={searching || !canSubmit}
            data-testid="search-submit"
          >
            {searching ? (
              <>
                <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />
                Ищем…
              </>
            ) : (
              'Найти'
            )}
          </button>
        </div>
        <div id="part-number-hint" className="form-text">
          Поиск запускается автоматически, как только вы перестанете вводить номер (и по кнопке
          «Найти»).
        </div>
      </div>

      <div className="col-12 col-xl-6">
        <label htmlFor="api-key-input" className="form-label fw-semibold">
          Ключ покупателя <span className="text-body-secondary fw-normal">(key)</span>
        </label>
        <input
          id="api-key-input"
          name="key"
          type="text"
          className="form-control font-monospace"
          placeholder="00000000-0000-0000-0000-000000000001"
          value={apiKey}
          onChange={(event) => onApiKeyChange(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          aria-describedby="api-key-hint"
          data-testid="api-key-input"
        />
        <div id="api-key-hint" className="form-text">
          Ключ выдаётся сервисом «Проценка»; хранится только в этом браузере (localStorage). Сейчас
          подставлен демонстрационный ключ из документации. После изменения ключа нажмите «Найти».
        </div>
      </div>
    </form>
  )
}