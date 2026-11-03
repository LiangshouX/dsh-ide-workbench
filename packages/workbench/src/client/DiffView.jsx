/**
 * Diff viewer with Unified / Side-by-side modes and line-level staging.
 *
 * The patch builder lives in diff.js: selected `+`/`-` lines keep their marker,
 * unselected additions disappear and unselected deletions become context, so
 * `git apply --cached` changes exactly the selected lines.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { buildPatch, diffInnerWidth, diffPaneWidths, firstFile, hunkChangeIndexes, parseUnifiedDiff, sideBySideRows, unifiedRows, wordLevelDefault, wordSegments } from './diff.js'
import { IconRefresh } from './icons.jsx'
import { FindBar } from './FindBar.jsx'
import { buildFindRegExp } from './find.js'
import { shallowEqual, useStoreSlice } from './hooks.js'

const LINE_HEIGHT = 20

/** Build a synthetic all-added diff for an untracked file. */
export function syntheticAddDiff(rel, content) {
  const text = String(content ?? '').replace(/\r\n/g, '\n')
  const lines = text.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  if (lines.length === 0) return ''
  return `diff --git a/${rel} b/${rel}\nnew file mode 100644\n--- /dev/null\n+++ b/${rel}\n@@ -0,0 +1,${lines.length} @@\n${lines.map(line => `+${line}`).join('\n')}\n`
}

/** The diff text behind one tab, plus its stageability. */
function diffSource(tab) {
  if (tab.kind === 'commit') {
    return { text: tab.detail?.diff ?? '', staged: false, stageable: false, path: tab.detail?.subject ?? tab.hash }
  }
  const payload = tab.payload
  // A commit-scoped (or compare) diff is read-only: never offer staging on it.
  const stageable = tab.commitHash === undefined && tab.readOnly !== true
  if (payload === undefined || payload === null) return { text: '', staged: tab.staged === true, stageable, path: tab.rel }
  if (payload.untracked === true) {
    if (payload.kind === 'text') return { text: syntheticAddDiff(tab.rel, payload.content), staged: false, stageable, path: tab.rel }
    return { text: '', staged: false, stageable, path: tab.rel, binary: true }
  }
  return { text: payload.diff ?? '', staged: tab.staged === true, stageable, path: tab.rel }
}

/**
 * The slice of the workbench snapshot the diff viewer reads.
 *
 * Only the diff mode comes from the store: everything else is in the tab.
 * @param {object} state the whole workbench snapshot
 * @returns {{ commitMode: string|undefined }} the diff slice
 */
export function diffSlice(state) {
  return { commitMode: state.commit?.mode }
}

export function DiffView({ store, tab }) {
  const t = store.t
  // The viewer subscribes to its own slice; the whole snapshot is not pushed
  // into it any more.
  const slice = useStoreSlice(store, diffSlice, shallowEqual)
  const source = useMemo(() => diffSource(tab), [tab])
  const parsed = useMemo(() => parseUnifiedDiff(source.text), [source.text])
  const mode = tab.kind === 'commit' ? 'unified' : (slice.commitMode ?? 'side')
  const [selection, setSelection] = useState(() => new Set())
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(400)
  const [applying, setApplying] = useState(false)
  const [openBlocks, setOpenBlocks] = useState(() => new Set())
  // Word-level highlighting is on by default (V6): the viewer starts from the
  // saved choice, and an unloaded settings document leaves it on. The state
  // is local so the button answers a click immediately.
  const [wordLevel, setWordLevel] = useState(() => wordLevelDefault(store.state.settings))
  const [findOpen, setFindOpen] = useState(false)
  const [findRows, setFindRows] = useState(() => new Set())
  const [findActiveRow, setFindActiveRow] = useState(-1)
  const scrollRef = useRef(null)
  // The right pane of the side-by-side view. It is null in unified mode, where
  // one surface holds every row.
  const paneRightRef = useRef(null)
  // What the viewer itself wrote into a pane's scroll box. The browser fires a
  // scroll event for that write too, and without this record the echo would be
  // re-propagated to the source pane - a shorter pane (its own widest line is
  // nearer) would then drag the longer one back to its own end.
  const echoRef = useRef({ left: null, right: null })
  const selecting = useRef(false)
  const findRowsRef = useRef([])
  const findActiveRef = useRef(-1)
  const rowsRef = useRef([])

  useEffect(() => {
    setSelection(new Set())
    setScrollTop(0)
  }, [tab.id, mode])

  useEffect(() => {
    const onUp = () => { selecting.current = false }
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [])

  useEffect(() => {
    const element = scrollRef.current
    if (element === null) return undefined
    const observer = new ResizeObserver(() => setViewport(element.clientHeight))
    observer.observe(element)
    setViewport(element.clientHeight)
    const top = tab.scrollTop ?? 0
    element.scrollTop = top
    if (paneRightRef.current !== null) paneRightRef.current.scrollTop = top
    setScrollTop(top)
    return () => observer.disconnect()
    // The primary scroller is a different element in each layout (the single
    // surface of the unified view, the left pane of the side-by-side view), so
    // a mode switch has to re-measure and re-restore it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id, mode])

  const files = parsed.files
  const singleFile = files.length === 1 ? files[0] : null
  const additions = files.reduce((sum, file) => sum + file.additions, 0)
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0)

  const rows = useMemo(() => {
    const output = []
    for (const file of files) {
      const label = file.newPath !== '' ? file.newPath : file.oldPath
      output.push({ kind: 'file', text: label, additions: file.additions, deletions: file.deletions })
      if (file.isBinary) {
        output.push({ kind: 'binary', text: t('common.binary') })
        continue
      }
      const body = mode === 'side' ? sideBySideRows(file) : unifiedRows(file)
      for (const row of body) output.push({ ...row, file })
    }
    return output
  }, [files, mode, t])

  // Read-only diffs (commit / compare) collapse long unchanged runs; editable
  // diffs keep every line so line/hunk staging indexes stay stable.
  const viewRows = useMemo(() => {
    if (source.stageable) return rows
    const output = []
    let run = []
    let key = ''
    const flush = () => {
      if (run.length === 0) return
      if (run.length > 12 && !openBlocks.has(key)) {
        output.push({ kind: 'collapsed', count: run.length, blockKey: key, file: run[0].file })
      } else {
        output.push(...run)
      }
      run = []
    }
    rows.forEach((row, index) => {
      if (row.kind === 'context') {
        if (run.length === 0) key = `block-${index}`
        run.push(row)
        return
      }
      flush()
      output.push(row)
    })
    flush()
    return output
  }, [rows, source.stageable, openBlocks])

  // Rows are absolutely positioned inside `.iwb-diff-inner`, so the inner has
  // no intrinsic width: without a measurement a long line is clipped by the
  // panel and there is no horizontal scrollbar. The unified view has ONE
  // surface; the side-by-side view has one PER PANE, each measured from its own
  // lines, so a pane can always reach the end of its own longest line. Both are
  // memoized so the scroll handlers do not re-walk the lines on every frame.
  const innerWidth = useMemo(() => diffInnerWidth(viewRows), [viewRows])
  const paneWidths = useMemo(() => diffPaneWidths(viewRows), [viewRows])

  /**
   * Move the other pane to the same scroll position.
   *
   * The two panes are linked by POSITION, not by ratio: both scroll boxes
   * represent the same distance from the left edge (and the same row at the
   * top), which is what keeps the two halves telling the same story. A pane
   * whose own longest line is shorter simply stops at its end - the browser
   * clamps the assignment, and the clamp must never travel back to the pane the
   * user is actually dragging, so the write is recorded in `echoRef` and
   * recognised when its scroll event arrives.
   * @param {'left'|'right'} side the pane the user moved
   * @returns {(event: object) => void} the scroll handler of that pane
   */
  const onPaneScroll = (side) => (event) => {
    const source = event.currentTarget
    const top = source.scrollTop
    const left = source.scrollLeft
    setScrollTop(top)
    const seen = echoRef.current[side]
    if (seen !== null && Math.abs(seen.top - top) <= 1 && Math.abs(seen.left - left) <= 1) {
      echoRef.current[side] = null
      return
    }
    const target = side === 'left' ? paneRightRef.current : scrollRef.current
    if (target === null) return
    const other = side === 'left' ? 'right' : 'left'
    let wrote = false
    if (target.scrollTop !== top) {
      target.scrollTop = top
      wrote = true
    }
    if (target.scrollLeft !== left) {
      target.scrollLeft = left
      wrote = true
    }
    echoRef.current[other] = wrote ? { top, left } : null
  }

  const start = Math.max(0, Math.floor(scrollTop / LINE_HEIGHT) - 8)
  const end = Math.min(viewRows.length, Math.ceil((scrollTop + viewport) / LINE_HEIGHT) + 8)
  rowsRef.current = viewRows

  useEffect(() => {
    const onKey = (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return
      if (event.key.toLowerCase() !== 'f') return
      const target = event.target
      if (!(target instanceof Element) || target.closest('.iwb-root') === null) return
      event.preventDefault()
      event.stopPropagation()
      setFindOpen(true)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  useEffect(() => {
    setFindOpen(false)
    setFindRows(new Set())
    setFindActiveRow(-1)
    findRowsRef.current = []
    findActiveRef.current = -1
  }, [tab.id])

  const findController = useMemo(() => {
    const rowText = (row) => {
      if (row === undefined) return ''
      if (row.kind === 'side') return `${row.left?.text ?? ''}\n${row.right?.text ?? ''}`
      return row.text ?? ''
    }
    const show = (index) => {
      const rows = rowsRef.current
      const target = rows[index]
      if (target === undefined) return
      findActiveRef.current = index
      setFindActiveRow(index)
      const container = scrollRef.current
      if (container !== null) {
        const top = Math.max(0, index * LINE_HEIGHT - container.clientHeight / 3)
        container.scrollTop = top
        // The panes are linked: a jump in one has to land both halves on the
        // same row, or the match would be off screen in the other half.
        if (paneRightRef.current !== null) {
          echoRef.current.right = { top, left: container.scrollLeft }
          paneRightRef.current.scrollTop = top
          paneRightRef.current.scrollLeft = container.scrollLeft
        }
        setScrollTop(top)
      }
    }
    return {
      focus: () => scrollRef.current?.focus?.(),
      find: (query, options = {}) => {
        if (query === '') {
          findRowsRef.current = []
          findActiveRef.current = -1
          setFindRows(new Set())
          setFindActiveRow(-1)
          return { total: 0, active: -1, error: null }
        }
        let pattern
        try {
          pattern = buildFindRegExp(query, options)
        } catch (error) {
          findRowsRef.current = []
          findActiveRef.current = -1
          setFindRows(new Set())
          setFindActiveRow(-1)
          return { total: 0, active: -1, error: error instanceof Error ? error.message : String(error) }
        }
        const matches = []
        const rows = rowsRef.current
        for (let index = 0; index < rows.length; index += 1) {
          const text = rowText(rows[index])
          pattern.lastIndex = 0
          let match
          while ((match = pattern.exec(text)) !== null) {
            matches.push(index)
            if (matches.length >= 5000) break
            if (match[0] === '') pattern.lastIndex += 1
          }
          if (matches.length >= 5000) break
        }
        findRowsRef.current = matches
        const active = matches.length > 0 ? 0 : -1
        setFindRows(new Set(matches))
        if (active >= 0) show(active)
        else {
          findActiveRef.current = -1
          setFindActiveRow(-1)
        }
        return { total: matches.length, active, error: null }
      },
      go: (delta) => {
        const matches = findRowsRef.current
        if (matches.length === 0) return { total: 0, active: -1, error: null }
        const next = (findActiveRef.current + delta + matches.length) % matches.length
        show(next)
        return { total: matches.length, active: next, error: null }
      },
      clear: () => {
        findRowsRef.current = []
        findActiveRef.current = -1
        setFindRows(new Set())
        setFindActiveRow(-1)
      },
    }
  }, [])

  const addIndex = (index) => {
    if (typeof index !== 'number') return
    setSelection(previous => {
      const next = new Set(previous)
      next.add(index)
      return next
    })
  }

  const onGutterDown = (event, index) => {
    event.preventDefault()
    event.stopPropagation()
    selecting.current = true
    addIndex(index)
  }

  const onGutterEnter = (index) => {
    if (selecting.current) addIndex(index)
  }

  const applySelection = async (indexes, label) => {
    if (!Array.isArray(indexes) || indexes.length === 0) {
      store.toast('info', t('commit.noChanges'))
      return
    }
    const file = firstFile(parsed)
    if (file === null) return
    const patch = buildPatch(file, new Set(indexes))
    if (patch === '') {
      store.toast('info', t('commit.noChanges'))
      return
    }
    setApplying(true)
    try {
      await store.stagePatch(patch, source.staged ? 'unstage' : 'stage')
      setSelection(new Set())
      store.toast('success', label ?? (source.staged ? t('commit.unstageSelection') : t('commit.stageSelection')))
    } finally {
      setApplying(false)
    }
  }

  const stageLabel = source.staged ? t('commit.unstageSelection') : t('commit.stageSelection')
  const hunkLabel = source.staged ? t('commit.unstageHunk') : t('commit.stageHunk')

  /**
   * Toggle word-level highlighting and remember the choice.
   *
   * The local state flips first so the highlight answers the click, not the
   * round-trip of the settings write. The write is fire-and-forget: a failed
   * write must not roll the UI back to a state the user did not pick (the
   * store reports the failure itself with a toast), and the catch keeps a
   * store that rejects from becoming an unhandled rejection in the viewer.
   */
  const toggleWordLevel = () => {
    const next = !wordLevel
    setWordLevel(next)
    void store.updateSettings({ git: { wordLevel: next } }).catch(() => {})
  }

  const rowStyle = (offset) => ({ position: 'absolute', top: `${offset * LINE_HEIGHT}px`, left: 0, right: 0, height: `${LINE_HEIGHT}px` })

  /**
   * A band that is not a code line (file label, binary notice, hunk header).
   *
   * The side-by-side view repeats it in both panes: each pane is a full,
   * independent scroll surface, and a band that lived in only one of them would
   * shift the rows of the other out of line with it. The hunk's stage button is
   * the one exception - it acts on the whole file, so showing it twice would
   * offer the same action twice; it renders in the left pane only.
   * @param {object} row the band
   * @param {number} offset its row index
   * @param {'left'|'right'|null} [side] the pane, null on the unified surface
   * @returns {object} the element
   */
  const renderChromeRow = (row, offset, side = null) => {
    if (row.kind === 'file') {
      return React.createElement('div', {
        key: `file:${side ?? 'one'}:${row.text}:${offset}`,
        className: 'iwb-diff-hunk',
        style: { ...rowStyle(offset), background: 'var(--iwb-panel-2)', color: 'var(--iwb-fg)' },
      },
        React.createElement('span', { className: 'iwb-hunk-text', style: { fontWeight: 600 } }, row.text),
        React.createElement('span', { className: 'iwb-additions', style: { marginRight: 10 } }, `+${row.additions}`),
        React.createElement('span', { className: 'iwb-deletions', style: { marginRight: 10 } }, `-${row.deletions}`),
      )
    }
    if (row.kind === 'binary') {
      return React.createElement('div', { key: `bin:${side ?? 'one'}:${offset}`, className: 'iwb-diff-hunk', style: rowStyle(offset) },
        React.createElement('span', { className: 'iwb-hunk-text' }, row.text))
    }
    return React.createElement('div', { key: `hunk:${side ?? 'one'}:${offset}`, className: 'iwb-diff-hunk', style: rowStyle(offset) },
      React.createElement('span', { className: 'iwb-hunk-text' }, row.text),
      source.stageable && side !== 'right'
        ? React.createElement('span', { className: 'iwb-hunk-actions' },
            React.createElement('button', {
              type: 'button', className: 'iwb-textbtn iwb-small', disabled: applying,
              onClick: () => { void applySelection(hunkChangeIndexes(row.file, row.hunkIndex), hunkLabel) },
            }, hunkLabel),
          )
        : null,
    )
  }

  const renderUnifiedRow = (row, offset) => {
    if (row.kind === 'file' || row.kind === 'binary' || row.kind === 'hunk') return renderChromeRow(row, offset)
    const selected = typeof row.index === 'number' && selection.has(row.index)
    const cls = row.kind === 'add' ? 'iwb-add' : row.kind === 'del' ? 'iwb-del' : ''
    return React.createElement('div', {
      key: `line:${row.index}`,
      className: `iwb-diff-row ${cls} ${selected ? 'iwb-selected' : ''} ${findRows.has(offset) ? 'iwb-diff-find' : ''} ${findActiveRow === offset ? 'iwb-diff-find-active' : ''}`,
      style: rowStyle(offset),
    },
      React.createElement('span', {
        className: 'iwb-diff-gutter',
        onMouseDown: event => { if (source.stageable && row.kind !== 'context') onGutterDown(event, row.index) },
        onMouseEnter: () => { if (source.stageable && row.kind !== 'context') onGutterEnter(row.index) },
      }, row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ''),
      React.createElement('span', { className: 'iwb-diff-num' }, row.oldNo ?? ''),
      React.createElement('span', { className: 'iwb-diff-num' }, row.newNo ?? ''),
      React.createElement('span', { className: 'iwb-diff-sign' }, row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ' '),
      React.createElement('span', { className: 'iwb-diff-text' }, row.text === '' ? '\u00a0' : row.text),
    )
  }

  const renderSideCell = (side, isLeft, segments) => {
    if (side === null || side === undefined) {
      return React.createElement('div', { className: 'iwb-diff-side-cell iwb-blank' },
        React.createElement('span', { className: 'iwb-diff-num' }),
        React.createElement('span', { className: 'iwb-diff-text' }),
      )
    }
    const selected = typeof side.index === 'number' && selection.has(side.index)
    return React.createElement('div', {
      className: `iwb-diff-side-cell ${isLeft ? 'iwb-del' : 'iwb-add'} ${selected ? 'iwb-selected' : ''}`,
    },
      React.createElement('span', {
        className: 'iwb-diff-gutter',
        onMouseDown: event => { if (source.stageable) onGutterDown(event, side.index) },
        onMouseEnter: () => { if (source.stageable) onGutterEnter(side.index) },
      }, isLeft ? '−' : '+'),
      React.createElement('span', { className: 'iwb-diff-num' }, side.no ?? ''),
      React.createElement('span', { className: 'iwb-diff-text' },
        segments === null || segments === undefined
          ? (side.text === '' ? '\u00a0' : side.text)
          : segments.map((segment, index) => (segment.changed
              ? React.createElement('span', { key: index, className: isLeft ? 'iwb-word-del' : 'iwb-word-add' }, segment.text)
              : segment.text))),
    )
  }

  /**
   * One row of one pane: the cell of that side, or the blank cell that keeps
   * the two halves on the same line when only the other side has text.
   * @param {object} row the side-by-side row
   * @param {number} offset its row index
   * @param {'left'|'right'} side the pane
   * @returns {object} the element
   */
  const renderSidePaneRow = (row, offset, side) => {
    if (row.kind === 'file' || row.kind === 'binary' || row.kind === 'hunk') return renderChromeRow(row, offset, side)
    const segments = wordLevel && row.kind === 'change'
      ? wordSegments(row.left?.text ?? '', row.right?.text ?? '')
      : null
    return React.createElement('div', {
      key: `${side}:${row.left?.index ?? 'x'}:${row.right?.index ?? 'y'}`,
      className: `iwb-diff-side ${findRows.has(offset) ? 'iwb-diff-find' : ''} ${findActiveRow === offset ? 'iwb-diff-find-active' : ''}`,
      style: rowStyle(offset),
    }, renderSideCell(row[side] ?? null, side === 'left', side === 'left' ? segments?.left : segments?.right))
  }

  const toolbar = React.createElement('div', { className: 'iwb-diff-toolbar' },
    React.createElement(IconRefresh, { width: 13, height: 13 }),
    React.createElement('span', { style: { color: 'var(--iwb-fg)', marginLeft: 2 } }, source.path ?? ''),
    React.createElement('span', { className: 'iwb-additions' }, `+${additions}`),
    React.createElement('span', { className: 'iwb-deletions' }, `-${deletions}`),
    React.createElement('span', { className: 'iwb-spacer' }),
    tab.kind !== 'commit'
      ? React.createElement('div', { className: 'iwb-seg' },
          React.createElement('button', {
            type: 'button', className: mode === 'side' ? 'iwb-on' : '',
            onClick: () => store.setDiffMode('side'),
          }, t('commit.sideBySide')),
          React.createElement('button', {
            type: 'button', className: mode === 'unified' ? 'iwb-on' : '',
            onClick: () => store.setDiffMode('unified'),
          }, t('commit.unified')),
        )
      : null,
    React.createElement('button', {
      type: 'button', className: `iwb-textbtn iwb-small ${wordLevel ? 'iwb-primary' : ''}`,
      title: t('commit.wordLevel'), onClick: toggleWordLevel,
    }, 'Aa'),
    source.stageable && selection.size > 0
      ? React.createElement('button', {
          type: 'button', className: 'iwb-textbtn iwb-primary iwb-small', disabled: applying,
          onClick: () => { void applySelection([...selection], stageLabel) },
        }, `${stageLabel} (${selection.size})`)
      : null,
    source.stageable && singleFile !== null
      ? React.createElement('button', {
          type: 'button', className: 'iwb-textbtn iwb-small',
          onClick: () => { void applySelection(singleFile.hunks.flatMap((_, index) => hunkChangeIndexes(singleFile, index)), hunkLabel) },
        }, source.staged ? t('commit.unstageAll') : t('commit.stageAll'))
      : null,
  )

  /**
   * The rows of one scroll surface.
   *
   * A collapsed band is drawn in every pane too: it stands for the same number
   * of hidden rows on both sides, so a band missing from one pane would shift
   * that pane out of line with the other.
   * @param {'left'|'right'|null} side the pane, null on the unified surface
   * @param {string} width the measured min-width of the surface
   * @returns {object} the element
   */
  const rowsOf = (side, width) => React.createElement('div', {
    className: 'iwb-diff-inner',
    style: { height: `${viewRows.length * LINE_HEIGHT}px`, minWidth: width },
  },
    viewRows.slice(start, end).map((row, index) => {
      const offset = start + index
      if (row.kind === 'collapsed') {
        return React.createElement('div', {
          key: `${side ?? 'one'}:${row.blockKey}`,
          className: 'iwb-diff-collapsed',
          // The band stands for a run of hidden rows, so it has to occupy the
          // slot of those rows: without the offset it would be the one row in
          // normal flow and render on top of the first lines instead.
          style: rowStyle(offset),
          onClick: () => setOpenBlocks(previous => new Set([...previous, row.blockKey])),
        }, `\u22ef ${row.count} ${t('diff.collapsedLines')}`)
      }
      return side === null ? renderUnifiedRow(row, offset) : renderSidePaneRow(row, offset, side)
    }),
  )

  /**
   * One half of the side-by-side view: its own scroll box, its own measured
   * width, its own scrollbars.
   * @param {'left'|'right'} side the pane
   * @returns {object} the element
   */
  const paneOf = (side) => React.createElement('div', {
    className: `iwb-diff-pane iwb-diff-pane-${side}`,
    ref: side === 'left' ? scrollRef : paneRightRef,
    onScroll: onPaneScroll(side),
    'data-pane': side,
  }, rowsOf(side, paneWidths[side].width))

  // Side by side is two panes that split the content area in half whatever its
  // width is, and each scrolls inside its own region; the two are linked (see
  // onPaneScroll). The unified view keeps its single surface.
  const body = viewRows.length === 0
    ? React.createElement('div', { className: 'iwb-diff-scroll' },
        React.createElement('div', { className: 'iwb-empty' }, t('commit.selectFile')))
    : mode === 'side'
      ? React.createElement('div', { className: 'iwb-diff-split' }, paneOf('left'), paneOf('right'))
      // `minWidth` is the measured width of the widest visible line plus the
      // chrome; `max(100%, …)` keeps the surface at least as wide as the panel,
      // so row backgrounds, selection and find outlines cover the whole visible
      // width while one scrollbar pans the long lines.
      : React.createElement('div', {
          className: 'iwb-diff-scroll',
          ref: scrollRef,
          onScroll: event => setScrollTop(event.currentTarget.scrollTop),
        }, rowsOf(null, innerWidth.width))

  // The commit metadata lives in the Git tool window's bottom details pane;
  // the editor area only shows the full diff (no duplicated header block).
  return React.createElement('div', { className: 'iwb-diff' }, toolbar,
    findOpen === true
      ? React.createElement(FindBar, {
          store,
          editor: findController,
          readOnly: true,
          onClose: () => setFindOpen(false),
        })
      : null,
    body)
}
