export default function Loader({ label = 'Загрузка…' }) {
  return (
    <div
      className="loader d-flex align-items-center gap-2 py-3 text-body-secondary"
      role="status"
      aria-live="polite"
      data-testid="loader"
    >
      <span className="spinner-border spinner-border-sm" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}