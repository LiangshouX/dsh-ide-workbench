/**
 * The small helpers of the code intelligence plugin.
 *
 * The plugin may not import anything from the IDE workbench (PRD-v6 §5.5,
 * acceptance R5), so the helpers it needs live here. They are the helpers of
 * the core, copied: the rules of a shortcut are the rules of the keyboard,
 * not of a plugin.
 */

/**
 * The token of the key of one event.
 * @param {any} event the keyboard event
 * @returns {string} the token, `''` when the event carries no key
 */
function keyToken(event) {
  const key = event?.key
  if (typeof key !== 'string' || key === '') return ''
  if (key === ' ') return 'space'
  if (key === '+') return 'plus'
  if (key.length === 1) return key.toLowerCase()
  return key.toLowerCase()
}

/**
 * The canonical combo string of a keyboard event (`ctrl+shift+k`).
 * @param {any} event the keyboard event
 * @returns {string} the combo
 */
export function comboOf(event) {
  const parts = []
  if (event?.ctrlKey) parts.push('ctrl')
  if (event?.altKey) parts.push('alt')
  if (event?.shiftKey) parts.push('shift')
  if (event?.metaKey) parts.push('meta')
  const token = keyToken(event)
  if (token !== '') parts.push(token)
  return parts.join('+')
}

/**
 * Normalize a shortcut of the settings to the canonical form.
 * @param {unknown} value the shortcut of the settings
 * @returns {string} the normalized shortcut
 */
export function normalizeShortcut(value) {
  if (typeof value !== 'string') return ''
  return value
    .split('+')
    .map(part => part.trim().toLowerCase())
    .filter(part => part !== '')
    .map(part => (part === 'del' ? 'delete' : part === 'esc' ? 'escape' : part === 'return' ? 'enter' : part))
    .join('+')
}

/**
 * Whether one event matches one configured shortcut.
 * @param {string} shortcut the shortcut of the settings
 * @param {any} event the keyboard event
 * @returns {boolean} true when the event is the shortcut
 */
export function matchesShortcut(shortcut, event) {
  const normalized = normalizeShortcut(shortcut)
  return normalized !== '' && normalized === comboOf(event)
}
