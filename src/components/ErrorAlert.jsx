export default function ErrorAlert({
  title = 'Ошибка',
  message,
  details,
  onRetry,
  retryLabel = 'Повторить',
}) {
  return (
    <div
      className="alert alert-danger d-flex flex-column flex-sm-row align-items-sm-center gap-2 mb-0"
      role="alert"
      data-testid="error-alert"
    >
      <div className="flex-grow-1">
        <div className="fw-semibold">{title}</div>
        <div className="small">{message || 'Неизвестная ошибка сервиса.'}</div>
        {details ? <div className="small text-body-secondary mt-1">{details}</div> : null}
      </div>
      {onRetry ? (
        <button type="button" className="btn btn-sm btn-outline-danger flex-shrink-0" onClick={onRetry}>
          {retryLabel}
        </button>
      ) : null}
    </div>
  )
}