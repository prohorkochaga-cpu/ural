/** Чтение параметров из адресной строки (для ссылок вида ?number=0189&brand=ZEN). */
export function readUrlParam(name) {
  try {
    const value = new URLSearchParams(window.location.search).get(name)
    return value == null ? '' : value.trim()
  } catch {
    return ''
  }
}