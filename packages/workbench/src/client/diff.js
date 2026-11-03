/**
 * Unified diff parsing, row models for the two diff modes, and the
 * line-selection patch builder used by Stage/Unstage Selection.
 *
 * The builder rebuilds one file's patch from a hunk: selected changes keep
 * their `+`/`-` marker, unselected additions are dropped (the index never had
 * them) and unselected deletions become context (the index still has them).
 * `git apply --cached --unidiff-zero --recount` then applies exactly the
 * selected lines.
 */

/** Parse one file's unified diff text. */
export function parseUnifiedDiff(text) {
  const raw = typeof text === 'string' ? text : ''
  const files = []
  let current = null
  let hunk = null
  let lineIndex = 0
  const lines = raw.split('\n')

  const flushFile = () => {
    if (current !== null) files.push(current)
    current = null
    hunk = null
  }

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      flushFile()
      current = {
        header: [line],
        oldPath: '',
        newPath: '',
        isNew: false,
        isDeleted: false,
        isBinary: false,
        hunks: [],
        additions: 0,
        deletions: 0,
      }
      continue
    }
    if (current === null) continue
    if (line.startsWith('--- ')) {
      current.header.push(line)
      const path = line.slice(4).trim()
      current.oldPath = path === '/dev/null' ? '' : path.replace(/^[ab]\//, '')
      if (path === '/dev/null') current.isNew = true
      continue
    }
    if (line.startsWith('+++ ')) {
      current.header.push(line)
      const path = line.slice(4).trim()
      current.newPath = path === '/dev/null' ? '' : path.replace(/^[ab]\//, '')
      if (path === '/dev/null') current.isDeleted = true
      continue
    }
    if (line.startsWith('@@')) {
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(line)
      if (match === null) continue
      hunk = {
        header: line,
        oldStart: Number(match[1]),
        oldCount: match[2] === undefined ? 1 : Number(match[2]),
        newStart: Number(match[3]),
        newCount: match[4] === undefined ? 1 : Number(match[4]),
        heading: match[5] ?? '',
        lines: [],
      }
      current.hunks.push(hunk)
      continue
    }
    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      current.isBinary = true
      continue
    }
    if (hunk !== null) {
      const marker = line.charAt(0)
      if (marker === ' ' || marker === '+' || marker === '-' || marker === '\\') {
        const type = marker === '\\' ? 'note' : marker
        const entry = {
          type,
          text: line.slice(1),
          index: lineIndex,
          oldNo: null,
          newNo: null,
        }
        lineIndex += 1
        hunk.lines.push(entry)
        if (type === '+') { current.additions += 1 }
        if (type === '-') { current.deletions += 1 }
        continue
      }
      // Anything else ends the hunk.
      hunk = null
    }
    // Blank separators (including the trailing newline's empty record) are
    // not patch header lines: keeping one makes `git apply` reject the rebuilt
    // patch as garbage.
    if (line !== '') current.header.push(line)
  }
  flushFile()

  // Assign old/new line numbers per hunk (context advances both sides).
  for (const file of files) {
    for (const item of file.hunks) {
      let oldNo = item.oldStart
      let newNo = item.newStart
      for (const entry of item.lines) {
        if (entry.type === ' ') {
          entry.oldNo = oldNo
          entry.newNo = newNo
          oldNo += 1
          newNo += 1
        } else if (entry.type === '-') {
          entry.oldNo = oldNo
          oldNo += 1
        } else if (entry.type === '+') {
          entry.newNo = newNo
          newNo += 1
        }
      }
    }
  }
  return { files, raw }
}

/** The first file of a per-file diff (the API always scopes one path). */
export function firstFile(parsed) {
  return parsed.files.length > 0 ? parsed.files[0] : null
}

/** Flatten one file's hunks into unified-view rows. */
export function unifiedRows(file) {
  const rows = []
  if (file === null) return rows
  for (const hunk of file.hunks) {
    rows.push({ kind: 'hunk', text: hunk.header, hunk, hunkIndex: file.hunks.indexOf(hunk) })
    for (const entry of hunk.lines) {
      if (entry.type === 'note') continue
      rows.push({
        kind: entry.type === ' ' ? 'context' : entry.type === '+' ? 'add' : 'del',
        text: entry.text,
        oldNo: entry.oldNo,
        newNo: entry.newNo,
        index: entry.index,
        hunkIndex: file.hunks.indexOf(hunk),
      })
    }
  }
  return rows
}

/**
 * Pair one hunk's deletions and additions into side-by-side rows.
 * Runs of `-` and `+` are paired line-by-line; the longer side keeps blanks.
 */
export function sideBySideRows(file) {
  const rows = []
  if (file === null) return rows
  for (let hunkIndex = 0; hunkIndex < file.hunks.length; hunkIndex += 1) {
    const hunk = file.hunks[hunkIndex]
    rows.push({ kind: 'hunk', text: hunk.header, hunk, hunkIndex })
    let pendingDels = []
    let pendingAdds = []
    const flush = () => {
      const count = Math.max(pendingDels.length, pendingAdds.length)
      for (let index = 0; index < count; index += 1) {
        const left = pendingDels[index]
        const right = pendingAdds[index]
        rows.push({
          kind: 'change',
          left: left === undefined ? null : { text: left.text, no: left.oldNo, index: left.index },
          right: right === undefined ? null : { text: right.text, no: right.newNo, index: right.index },
          hunkIndex,
        })
      }
      pendingDels = []
      pendingAdds = []
    }
    for (const entry of hunk.lines) {
      if (entry.type === 'note') continue
      if (entry.type === '-') {
        if (pendingAdds.length > 0) flush()
        pendingDels.push(entry)
      } else if (entry.type === '+') {
        pendingAdds.push(entry)
      } else {
        flush()
        rows.push({
          kind: 'context',
          left: { text: entry.text, no: entry.oldNo, index: entry.index },
          right: { text: entry.text, no: entry.newNo, index: entry.index },
          hunkIndex,
        })
      }
    }
    flush()
  }
  return rows
}

/**
 * Token-level diff between one deleted and one added line (word-level
 * highlighting). Tokens are words, whitespace runs and single punctuation
 * marks; very long lines fall back to whole-line changes.
 * @param {string} leftText
 * @param {string} rightText
 * @returns {{ left: Array<{text: string, changed: boolean}>,
 *   right: Array<{text: string, changed: boolean}> }}
 */
export function wordSegments(leftText, rightText) {
  const tokenize = text => String(text ?? '').match(/\s+|[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/gu) ?? []
  const a = tokenize(leftText)
  const b = tokenize(rightText)
  if (a.length === 0 && b.length === 0) return { left: [], right: [] }
  if (a.length > 200 || b.length > 200) {
    return {
      left: a.length === 0 ? [] : [{ text: leftText, changed: true }],
      right: b.length === 0 ? [] : [{ text: rightText, changed: true }],
    }
  }
  const n = a.length
  const m = b.length
  const table = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  const left = []
  const right = []
  const push = (list, token, changed) => {
    const last = list[list.length - 1]
    if (last !== undefined && last.changed === changed) last.text += token
    else list.push({ text: token, changed })
  }
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push(left, a[i], false)
      push(right, b[j], false)
      i += 1
      j += 1
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      push(left, a[i], true)
      i += 1
    } else {
      push(right, b[j], true)
      j += 1
    }
  }
  while (i < n) { push(left, a[i], true); i += 1 }
  while (j < m) { push(right, b[j], true); j += 1 }
  return { left, right }
}

/**
 * Word-level highlighting starts enabled unless the settings say otherwise.
 *
 * The viewer reads the saved choice as the initial state. An unloaded settings
 * document (`undefined`/`null`) and an old document without the key both start
 * enabled: only the explicit boolean `false` of a user who turned the feature
 * off disables it. The host keeps the same default in
 * `DEFAULT_SETTINGS.git.wordLevel`, and the 'Aa' button writes the decision
 * back through `settings.update`.
 * @param {any} settings the settings document of the store (may be null)
 * @returns {boolean} whether 'Aa' highlighting starts enabled
 */
export function wordLevelDefault(settings) {
  return settings?.git?.wordLevel !== false
}

/** Every change (add or delete) index of one hunk. */
export function hunkChangeIndexes(file, hunkIndex) {
  const hunk = file?.hunks[hunkIndex]
  if (hunk === undefined) return []
  return hunk.lines.filter(entry => entry.type === '+' || entry.type === '-').map(entry => entry.index)
}

/**
 * Rebuild a one-file patch containing only the selected change lines.
 * @param {object} file parsed file entry
 * @param {Set<number>} selection selected line indexes
 * @returns {string} patch text ('' when the selection changes nothing)
 */
export function buildPatch(file, selection) {
  if (file === null || selection.size === 0) return ''
  const output = [...file.header]
  let changedHunks = 0
  for (const hunk of file.hunks) {
    const body = []
    let oldCount = 0
    let newCount = 0
    let changed = false
    for (const entry of hunk.lines) {
      if (entry.type === ' ') {
        body.push(` ${entry.text}`)
        oldCount += 1
        newCount += 1
      } else if (entry.type === '-') {
        oldCount += 1
        if (selection.has(entry.index)) {
          body.push(`-${entry.text}`)
          changed = true
        } else {
          body.push(` ${entry.text}`)
          newCount += 1
        }
      } else if (entry.type === '+') {
        if (selection.has(entry.index)) {
          body.push(`+${entry.text}`)
          newCount += 1
          changed = true
        }
        // Unselected additions are absent from both sides.
      }
    }
    if (!changed) continue
    changedHunks += 1
    const newStart = hunk.oldStart === 0 ? 1 : hunk.oldStart
    output.push(`@@ -${hunk.oldStart},${oldCount} +${newStart},${newCount} @@${hunk.heading}`)
    output.push(...body)
  }
  if (changedHunks === 0) return ''
  return `${output.join('\n')}\n`
}

/** Human-readable one-line summary of a change type marker. */
export function changeLabel(xy) {
  if (typeof xy !== 'string' || xy.length < 2) return ''
  const x = xy[0]
  const y = xy[1]
  if (xy === '??') return 'untracked'
  if (xy === '!!') return 'ignored'
  if (xy[0] === 'U' || xy[1] === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) return 'conflict'
  if (x === 'R') return 'renamed'
  if (x === 'D' || y === 'D') return 'deleted'
  if (x === 'A') return 'added'
  return 'modified'
}

/* ── the horizontal measure of the shared diff surface ─────────────────────
   Rows of BOTH layouts are absolutely positioned in one scroll surface
   (`left: 0; right: 0`), so the surface has no intrinsic width of its own: a
   long line would be clipped by the panel and there would be nothing to pan.
   The viewer measures the widest visible line and writes it onto
   `.iwb-diff-inner`; these constants are the chrome widths that are not text.
   Every number mirrors a rule of styles.js, and tests/diff-view.test.mjs
   reads the stylesheet and fails when the two drift apart. */

/** `.iwb-diff-gutter` (width: 22px). */
export const DIFF_GUTTER_WIDTH = 22
/** One `.iwb-diff-num` column (width: 44px); the unified view shows two. */
export const DIFF_LINE_NUMBER_WIDTH = 44
/** The `.iwb-diff-sign` column of the unified view (width: 16px). */
export const DIFF_SIGN_WIDTH = 16
/** The right padding of `.iwb-diff-text` (padding-right: 24px). */
export const DIFF_TEXT_PADDING = 24
/** The border between the two cells of the side-by-side view (1px). */
export const DIFF_SIDE_BORDER = 1
/** The `tab-size` of the scroll surface: a tab advances to this column. */
export const DIFF_TAB_SIZE = 4

/**
 * The fixed width one visible row spends on chrome, in CSS pixels.
 *
 * unified: [gutter][old number][new number][sign][text + padding]
 *          = 22 + 44 + 44 + 16 + 24 = 150
 * side: two equal columns (minmax(0, 1fr) each), every column is
 *       [gutter][number][text + padding][border] = 22 + 44 + 24 + 1 = 91,
 *       so the row spends 2 * 91 = 182 on chrome
 *
 * The side view splits the measured inner width into two deterministic equal
 * columns, so this is the chrome of the whole row, not of one column.
 *
 * @param {'unified'|'side'} [mode] the layout of the viewer
 * @returns {number} the CSS pixels that are not line text
 */
export function diffChromeWidth(mode) {
  if (mode === 'side') {
    return 2 * (DIFF_GUTTER_WIDTH + DIFF_LINE_NUMBER_WIDTH + DIFF_TEXT_PADDING + DIFF_SIDE_BORDER)
  }
  return DIFF_GUTTER_WIDTH + 2 * DIFF_LINE_NUMBER_WIDTH + DIFF_SIGN_WIDTH + DIFF_TEXT_PADDING
}

/**
 * Whether a code point paints as a full-width glyph.
 *
 * A monospace font gives CJK, Hangul and emoji an advance of about two Latin
 * cells, so a line of them needs twice the `ch` width a raw code-point count
 * would reserve. The ranges below are the common East Asian Wide/Fullwidth
 * blocks of UAX #11 - an approximation (the font owns the real advance), but
 * the safe direction: it keeps full-width text from running past the measured
 * surface, which is exactly the failure the user sees as a cut line.
 * @param {number} code the code point
 * @returns {boolean} true when the glyph is about two columns wide
 */
function isFullWidth(code) {
  return (
    (code >= 0x1100 && code <= 0x115f) // Hangul Jamo
    || (code >= 0x2e80 && code <= 0xa4cf) // CJK radicals .. Yi
    || (code >= 0xac00 && code <= 0xd7a3) // Hangul syllables
    || (code >= 0xf900 && code <= 0xfaff) // CJK compatibility ideographs
    || (code >= 0xfe30 && code <= 0xfe4f) // CJK compatibility forms
    || (code >= 0xff00 && code <= 0xff60) // full-width forms
    || (code >= 0xffe0 && code <= 0xffe6)
    || (code >= 0x1f300 && code <= 0x1faff) // emoji
    || (code >= 0x20000 && code <= 0x3fffd) // CJK extensions
  )
}

/**
 * The width of one line in `ch` columns.
 *
 * A tab advances to the next `tab-size` stop (the stylesheet sets
 * `tab-size: 4`, and `DIFF_TAB_SIZE` mirrors it) instead of counting as one
 * column; every other code point counts one or two columns (see
 * `isFullWidth`). This is a character-count approximation: the browser knows
 * the real advances, but `ch` follows the font and the estimate only has to
 * be good enough to expose the horizontal scrollbar at the right width.
 * @param {string} text the line text
 * @returns {number} the approximate column count
 */
export function diffLineWidth(text) {
  if (typeof text !== 'string' || text === '') return 0
  let columns = 0
  for (const char of text) {
    const code = char.codePointAt(0)
    if (code === 0x09) columns += DIFF_TAB_SIZE - (columns % DIFF_TAB_SIZE)
    else columns += isFullWidth(code) ? 2 : 1
  }
  return columns
}

/**
 * The width of the ONE horizontal scroll surface of the diff.
 *
 * `width` is the CSS `min-width` for `.iwb-diff-inner`: never narrower than
 * the panel (`100%`), and always wide enough for the widest visible line plus
 * the chrome of its layout. Rows are absolutely positioned with
 * `left: 0; right: 0`, so this value is also what makes their backgrounds,
 * selection and find outlines cover the whole surface and pan with it.
 *
 * The side-by-side view splits the inner into two equal columns (`1fr 1fr`),
 * so both columns get the width of the wider side: the surface reserves the
 * widest line twice, not once.
 *
 * Only line rows are measured. A file label or a hunk header is chrome - it
 * carries `text-overflow: ellipsis` and must not push the whole surface wide.
 *
 * `chars` is the widest line in `ch` columns. That unit answers to the font,
 * not to the exact glyphs, so the result is an approximation; it errs on the
 * wide side (full-width glyphs count two), which keeps the tail of a line
 * reachable by the scrollbar.
 *
 * @param {Array<object>} rows the visible rows of the viewer
 * @param {'unified'|'side'} [mode] the layout of the viewer
 * @returns {{ chars: number, chromePx: number, width: string }} the measure
 */
export function diffInnerWidth(rows, mode = 'unified') {
  const side = mode === 'side'
  const list = Array.isArray(rows) ? rows : []
  let chars = 0
  let measured = false
  for (const row of list) {
    if (row === null || typeof row !== 'object') continue
    if (side) {
      if (row.kind !== 'change' && row.kind !== 'context') continue
      measured = true
      chars = Math.max(chars, diffLineWidth(row.left?.text), diffLineWidth(row.right?.text))
    } else {
      if (row.kind !== 'context' && row.kind !== 'add' && row.kind !== 'del') continue
      measured = true
      chars = Math.max(chars, diffLineWidth(row.text))
    }
  }
  const chromePx = diffChromeWidth(mode)
  // No line row at all (empty diff): stay at the width of the panel instead
  // of reserving the chrome of a line that is not there.
  if (!measured) return { chars: 0, chromePx, width: '100%' }
  // Two columns need room for both cells; a context line is drawn on both
  // sides, so the widest line is what each of the two columns has to hold.
  const columns = side ? 2 : 1
  return {
    chars,
    chromePx,
    width: `max(100%, calc(${chars * columns}ch + ${chromePx}px))`,
  }
}
