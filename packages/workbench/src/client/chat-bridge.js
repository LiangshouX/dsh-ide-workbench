/**
 * "Send to chat" bridge: put an @-reference into the DSH composer from the IDE.
 *
 * The conversation plugin owns the composer, but it publishes its per-Session
 * input actions (`captureInsertion` / `insertText` / `persistDraft`) as standard
 * props to every Session-scoped slot. A tiny invisible component registered in
 * `conversation.input.dock` captures those actions here, so the workbench can
 * hand over a file or a code selection without reaching into another plugin's
 * internals.
 *
 * The inserted string is the natural `@path` mention grammar the composer's own
 * picker serializes to, so DSH renders it as a file reference in the sent
 * message. For a code selection the reference is followed by the selected code
 * in a fenced block (the mention grammar has no line-range suffix).
 */

/** Session id → the live composer action face for that Session. */
const inputs = new Map()

/**
 * Publish one Session's composer actions.
 * @param {string} sessionId
 * @param {{ captureInsertion: () => any, insertText: (text: string, span: any) => boolean, persistDraft?: () => void }} actions
 * @returns {() => void} disposer
 */
export function registerChatInput(sessionId, actions) {
  if (typeof sessionId !== 'string' || sessionId === '') return () => {}
  if (actions === null || typeof actions !== 'object') return () => {}
  if (typeof actions.captureInsertion !== 'function' || typeof actions.insertText !== 'function') return () => {}
  const entry = { actions }
  inputs.set(sessionId, entry)
  return () => {
    if (inputs.get(sessionId) === entry) inputs.delete(sessionId)
  }
}

/** Whether one Session currently has a live composer. */
export function hasChatInput(sessionId) {
  return inputs.has(sessionId)
}

/**
 * Insert plain text at the composer caret (never replacing a selection).
 * @param {string} sessionId
 * @param {string} text
 * @returns {boolean} whether the insertion applied
 */
export function insertChatText(sessionId, text) {
  if (typeof text !== 'string' || text === '') return false
  const entry = inputs.get(sessionId)
  if (entry === undefined) return false
  const { actions } = entry
  try {
    const span = actions.captureInsertion()
    if (span === null || typeof span !== 'object' || typeof span.draftRev !== 'number') return false
    // A selection in the composer must not be destroyed by a background action:
    // collapse to its end and insert there. A separating space keeps the new
    // reference from gluing onto the word before the caret.
    const target = span.start === span.end ? span : { ...span, start: span.end }
    const insert = target.start > 0 ? ` ${text}` : text
    if (actions.insertText(insert, target) !== true) return false
    try { actions.persistDraft?.() } catch { /* persistence is best effort */ }
    return true
  } catch {
    return false
  }
}

/**
 * Format one path as the composer's natural `@path` mention.
 * Whitespace paths use the quoted grammar; folders keep a trailing slash.
 * @param {string} path workspace- or project-relative path, either separator
 * @param {boolean} [isDirectory]
 * @returns {string | undefined} undefined when the path cannot be represented
 */
export function formatFileMention(path, isDirectory = false) {
  if (typeof path !== 'string' || path === '') return undefined
  let value = path.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '').replace(/\/+$/, '')
  if (value === '') return undefined
  if (isDirectory === true) value = `${value}/`
  if (/[\u0000-\u001f\u007f"]/u.test(value)) return undefined
  return /\s/u.test(value) ? `@"${value}"` : `@${value}`
}

/** Fence language labels for the extensions the editor knows. */
const FENCE_LABELS = {
  '.js': 'js', '.mjs': 'js', '.cjs': 'js', '.jsx': 'jsx',
  '.ts': 'ts', '.mts': 'ts', '.cts': 'ts', '.tsx': 'tsx',
  '.json': 'json', '.jsonc': 'json', '.json5': 'json',
  '.md': 'markdown', '.markdown': 'markdown',
  '.py': 'python', '.java': 'java',
  '.css': 'css', '.scss': 'scss', '.less': 'less',
  '.html': 'html', '.htm': 'html', '.vue': 'vue', '.svelte': 'svelte',
  '.sql': 'sql', '.yml': 'yaml', '.yaml': 'yaml',
  '.xml': 'xml', '.svg': 'xml',
  '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp',
  '.go': 'go', '.rs': 'rust', '.sh': 'bash', '.bash': 'bash', '.ps1': 'powershell',
}

/**
 * Fence label for one file path (plain text when the extension is unknown).
 * @param {string} path
 */
export function fenceLabelForPath(path) {
  const value = String(path ?? '').toLowerCase()
  const dot = value.lastIndexOf('.')
  if (dot < 0) return ''
  return FENCE_LABELS[value.slice(dot)] ?? ''
}

/** Longest selection sent as code, and its line cap. */
const MAX_CODE_CHARS = 16000
const MAX_CODE_LINES = 240

/** Trim one selection to the send caps (with a visible marker when cut). */
function capCode(text) {
  const value = String(text ?? '').replace(/\r\n/g, '\n')
  const lines = value.split('\n')
  let body = lines.length > MAX_CODE_LINES ? lines.slice(0, MAX_CODE_LINES).join('\n') : value
  let truncated = lines.length > MAX_CODE_LINES
  if (body.length > MAX_CODE_CHARS) {
    body = body.slice(0, MAX_CODE_CHARS)
    truncated = true
  }
  if (truncated) body += '\n… (truncated)'
  return body
}

/**
 * Build the message for a selected code range: `@file (L12-L20)` plus a fenced
 * block with the exact lines. The `@` grammar carries no line suffix, so the
 * range and the code travel as text right after the reference.
 * @param {{ mention: string, text: string, fromLine: number, toLine: number, path?: string }} input
 * @returns {string}
 */
export function composeCodeReference({ mention, text, fromLine, toLine, path = '' }) {
  const from = Number.isFinite(fromLine) ? Math.max(1, Math.trunc(fromLine)) : 1
  const to = Number.isFinite(toLine) ? Math.max(from, Math.trunc(toLine)) : from
  const range = from === to ? `L${from}` : `L${from}-L${to}`
  const language = fenceLabelForPath(path)
  const body = capCode(text)
  return `${mention} (${range})\n\n\`\`\`${language}\n${body}\n\`\`\`\n`
}
