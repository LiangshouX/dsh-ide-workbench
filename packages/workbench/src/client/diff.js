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
