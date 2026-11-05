export default function EmptyState({ title, message, children }) {
  return (
    <div className="empty-state text-center text-body-secondary py-4 px-3" data-testid="empty-state">
      <div className="empty-state__title fw-semibold text-body mb-1">{title}</div>
      {message ? <div className="small mx-auto empty-state__message">{message}</div> : null}
      {children ? <div className="mt-3">{children}</div> : null}
    </div>
  )
}