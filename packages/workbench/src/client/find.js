/**
 * Pure text-search helpers shared by the editor FindBar and unit tests.
 * Matching is deliberately independent of CodeMirror so a bad regex is
 * reported to the user instead of throwing inside a transaction.
 */

/** Escape a literal string for a regular expression. */
export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * @param {string} query
 * @param {{ caseSensitive?: boolean, wholeWord?: boolean, regexp?: boolean }} [options]
 * @returns {RegExp}
 */
export function buildFindRegExp(query, options = {}) {
  const source = options.regexp === true ? String(query) : escapeRegExp(query)
  const word = options.wholeWord === true ? `\\b(?:${source})\\b` : source
  return new RegExp(word, options.caseSensitive === true ? 'g' : 'gi')
}

/**
 * All non-overlapping matches of `query` in `text`.
 * @returns {Array<{ from: number, to: number, line: number, column: number, text: string }>}
 */
export function findMatches(text, query, options = {}, limit = 20000) {
  const value = String(query ?? '')
  if (value === '') return []
  const pattern = buildFindRegExp(value, options)
  const source = String(text ?? '')
  const matches = []
  let match
  while ((match = pattern.exec(source)) !== null) {
    matches.push({
      from: match.index,
      to: match.index + match[0].length,
      text: match[0],
      line: lineAt(source, match.index),
      column: columnAt(source, match.index),
    })
    if (matches.length >= limit) break
    if (match[0] === '') pattern.lastIndex += 1
  }
  return matches
}

/** 1-based line number of one character offset. */
export function lineAt(text, offset) {
  let line = 1
  for (let index = 0; index < offset && index < text.length; index += 1) {
    if (text[index] === '\n') line += 1
  }
  return line
}

/** 1-based column of one character offset. */
export function columnAt(text, offset) {
  const last = text.lastIndexOf('\n', Math.max(0, offset - 1))
  return offset - last
}

/**
 * Replace every match. Returns the new text and the number of replacements.
 */
export function replaceAllMatches(text, query, options = {}, replacement = '') {
  const source = String(text ?? '')
  const matches = findMatches(source, query, options)
  if (matches.length === 0) return { text: source, count: 0 }
  const value = String(replacement ?? '')
  if (options.regexp === true) {
    // Keep the familiar `$1` / `$&` group expansion for regex replacement.
    return { text: source.replace(buildFindRegExp(query, options), value), count: matches.length }
  }
  let output = ''
  let cursor = 0
  for (const match of matches) {
    output += source.slice(cursor, match.from) + value
    cursor = match.to
  }
  output += source.slice(cursor)
  return { text: output, count: matches.length }
}
