/**
 * Shortcut parsing/matching and small DOM utilities.
 */

/** Normalize `event.key` to the token used in settings strings. */
function keyToken(event) {
  const key = event.key
  if (typeof key !== 'string' || key === '') return ''
  if (key === ' ') return 'space'
  if (key === '+') return 'plus'
  if (key.length === 1) return key.toLowerCase()
  return key.toLowerCase()
}

/** The canonical combo string of a keyboard event (`ctrl+shift+k`). */
export function comboOf(event) {
  const parts = []
  if (event.ctrlKey) parts.push('ctrl')
  if (event.altKey) parts.push('alt')
  if (event.shiftKey) parts.push('shift')
  if (event.metaKey) parts.push('meta')
  const token = keyToken(event)
  if (token !== '') parts.push(token)
  return parts.join('+')
}

/** Normalize a settings shortcut string to the same canonical form. */
export function normalizeShortcut(value) {
  if (typeof value !== 'string') return ''
  return value
    .split('+')
    .map(part => part.trim().toLowerCase())
    .filter(part => part !== '')
    .map(part => (part === 'del' ? 'delete' : part === 'esc' ? 'escape' : part === 'return' ? 'enter' : part))
    .join('+')
}

/** Whether one event matches one configured shortcut. */
export function matchesShortcut(shortcut, event) {
  const normalized = normalizeShortcut(shortcut)
  return normalized !== '' && normalized === comboOf(event)
}

/** Whether the event target is an editable surface. */
export function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

/** Whether the event target is inside the embedded terminal. */
export function isTerminalTarget(target) {
  if (!(target instanceof HTMLElement)) return false
  return target.closest('.iwb-term-host') !== null
}

/** Format a byte count for display. */
export function formatBytes(size) {
  if (typeof size !== 'number' || !Number.isFinite(size)) return ''
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

/** Short relative path for the breadcrumb. */
export function dirName(path) {
  if (typeof path !== 'string') return ''
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return index < 0 ? '' : path.slice(0, index)
}

/** Basename of a path. */
export function baseName(path) {
  if (typeof path !== 'string') return ''
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return index < 0 ? path : path.slice(index + 1)
}

/**
 * The one-letter spelling of an encoding, for a squeezed toolbar.
 *
 * The toolbar is 30 pixels tall and sits above the document: when the pane is
 * narrow the controls lose their labels and the encoding keeps its first
 * letter (`utf-8` -> `u`, `GBK` -> `G`), with the full value in the tooltip.
 * An unknown or empty value stays empty instead of inventing a letter.
 * @param {unknown} encoding the encoding reported by the host
 * @returns {string} the first character, '' when there is none
 */
export function shortEncoding(encoding) {
  const text = typeof encoding === 'string' ? encoding.trim() : ''
  return text === '' ? '' : [...text][0]
}

/**
 * The text a search field starts with when the user has a selection.
 *
 * This is the IDE behaviour of Ctrl+F / Ctrl+Shift+R: whatever is selected is
 * what you are about to look for, so it is dropped into the field instead of
 * an empty box. Two limits come from the field, not from taste: a search box
 * is one line, and a per-line search cannot look for a block of lines - so a
 * multi-line selection seeds with its first non-empty line. Leading and
 * trailing whitespace go, the spacing inside the line stays (the search is
 * literal). An absurdly long selection is cut: the user is going to edit the
 * seed, and an unbounded line would make the field unusable.
 *
 * @param {string} text the selected text
 * @returns {string} the seed of the search field, '' when there is no selection
 */
export function findSeed(text) {
  if (typeof text !== 'string') return ''
  const trimmed = text.trim()
  if (trimmed === '') return ''
  const line = trimmed.split(/\r?\n/).find(part => part.trim() !== '')
  return line === undefined ? '' : line.trim().slice(0, 400)
}

/**
 * The current page selection, already normalized for a search field.
 *
 * The code editor draws its selection in the DOM like any other text, so one
 * helper answers for both the editor and the rendered Markdown preview - and
 * for a selection outside the document pane, which the global search does not
 * have to ignore.
 * @returns {string} the seed, '' when nothing is selected
 */
export function selectedText() {
  if (typeof window === 'undefined') return ''
  const selection = window.getSelection?.()
  if (selection === null || selection === undefined) return ''
  return findSeed(String(selection.toString()))
}

/** Format an ISO-ish git date (`2026-10-21 10:00:00 +0800`). */
export function formatGitDate(value, compact = false) {
  if (typeof value !== 'string' || value === '') return ''
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(value)
  if (match !== null) {
    return compact
      ? `${match[2]}-${match[3]} ${match[4]}:${match[5]}`
      : `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}`
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

/** Debounce that keeps one trailing call. */
export function debounce(fn, delay) {
  let timer = null
  const wrapped = (...args) => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      fn(...args)
    }, delay)
  }
  wrapped.cancel = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
  return wrapped
}
