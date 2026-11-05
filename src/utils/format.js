/** Форматирование значений для интерфейса. */

const priceFormatter = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const intFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })

/** Цена в рублях. Для отсутствующего значения возвращает прочерк. */
export function formatPrice(value) {
  if (value == null || !Number.isFinite(Number(value)) || Number(value) <= 0) return '—'
  return `${priceFormatter.format(Number(value))} ₽`
}

export function formatInt(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return '0'
  return intFormatter.format(num)
}

/** Дата/время отгрузки склада: "07.11.2026, до 13:30". */
export function formatShipmentDate(iso) {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return String(iso)
  const d = date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const t = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  return `${d}, до ${t}`
}

/** Склонение: pluralize(5, ['позиция','позиции','позиций']) -> 'позиций'. */
export function pluralize(count, forms) {
  const n = Math.abs(Number(count) || 0) % 100
  const n1 = n % 10
  if (n > 10 && n < 20) return forms[2]
  if (n1 > 1 && n1 < 5) return forms[1]
  if (n1 === 1) return forms[0]
  return forms[2]
}

export function positionsLabel(count) {
  return `${formatInt(count)} ${pluralize(count, ['позиция', 'позиции', 'позиций'])}`
}

export function offersLabel(count) {
  return `${formatInt(count)} ${pluralize(count, ['предложение', 'предложения', 'предложений'])}`
}

export function brandsLabel(count) {
  return `${formatInt(count)} ${pluralize(count, ['производитель', 'производителя', 'производителей'])}`
}

/** Подсказка под сообщением об ошибке — зависит от вида сбоя. */
const ERROR_HINTS = {
  auth: 'Проверьте ключ покупателя.',
  quota:
    'У ключа исчерпан лимит запросов по грузовому ассортименту. Попробуйте позже или используйте другой ключ.',
  network: 'Проверьте подключение к интернету.',
  timeout: 'Сервис не ответил вовремя — повторите запрос.',
  parse: 'Сервис вернул неожиданный ответ. Повторите запрос; если не помогает — проверьте адрес сервиса.',
}

export function errorHint(kind) {
  return ERROR_HINTS[kind] || ''
}