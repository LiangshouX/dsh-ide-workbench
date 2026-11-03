/**
 * The inline Git Blame column of the editor (V6, IDE-style annotate).
 *
 * The annotation is a CodeMirror **gutter of its own**, placed to the LEFT of
 * the line numbers: the IDE (and the reference screenshot) shows one row per
 * document line carrying `date author`, not a floating panel. A gutter is the
 * right primitive for that - it scrolls vertically with the document, stays
 * fixed horizontally like the line numbers, and gives one cell per line.
 *
 * Two details are deliberate:
 *
 *   - the cell carries ONLY the date and the author. The hash and the subject
 *     are reachable on hover, and clicking the cell opens the commit in the Git
 *     window - the workbench already knows how to do that (`openBlameCommit`).
 *   - a line that is not committed yet (modified, added, or staged in the
 *     worktree) has NO cell: git reports the all-zero hash for it, and the
 *     reference view leaves that row blank. Writing "Not Committed Yet" would
 *     draw an author that does not exist.
 *
 * The annotation data lives in a StateField fed by an effect, so an annotation
 * that arrives after the editor mounted can be painted without rebuilding the
 * document (and without touching the undo history).
 */
import { Prec, StateEffect, StateField } from '@codemirror/state'
import { GutterMarker, gutter } from '@codemirror/view'

/** Replace the annotation of the whole document. */
export const setBlameAnnotations = StateEffect.define()

/** The annotation of one line, by line number. */
export const blameField = StateField.define({
  create: () => new Map(),
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setBlameAnnotations)) return effect.value
    }
    return value
  },
})

/**
 * `YYYY/M/D` in the reader's own time zone.
 *
 * The annotate view of the IDE prints the day without zero padding
 * (`2026/8/21`), and the commit list of the Git window already shows local
 * days - so the two agree instead of looking like two different commits on the
 * same day.
 * @param {number} seconds epoch seconds
 * @returns {string} the day, or '' when there is no time
 */
export function blameDate(seconds) {
  const value = Number(seconds)
  if (!Number.isFinite(value) || value <= 0) return ''
  const date = new Date(value * 1000)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
}

/**
 * The text of one annotation cell: `date author`.
 *
 * A line that is not committed yet has no cell at all (''): the reference view
 * leaves the row blank, and there is no honest author to print for it.
 * @param {{ author?: string, authorTime?: number, committed?: boolean }|null} entry
 * @returns {string} the label, '' for a line without a commit
 */
export function blameLabel(entry) {
  if (entry === null || typeof entry !== 'object') return ''
  if (entry.committed === false) return ''
  const date = blameDate(entry.authorTime)
  const author = typeof entry.author === 'string' ? entry.author.trim() : ''
  if (author === '') return date
  return date === '' ? author : `${date} ${author}`
}

/**
 * The line → entry map the gutter reads.
 *
 * Lines without a commit (the all-zero hash of a worktree edit) are left out:
 * their cell stays blank. Invalid records are skipped rather than breaking the
 * whole column.
 * @param {Array<{line?: number, hash?: string, committed?: boolean}>} lines
 * @returns {Map<number, object>} the annotation by line number
 */
export function blameMapOf(lines) {
  const map = new Map()
  for (const line of Array.isArray(lines) ? lines : []) {
    if (line === null || typeof line !== 'object' || !Number.isInteger(line.line)) continue
    if (line.committed === false) continue
    if (typeof line.hash !== 'string' || line.hash === '' || /^0+$/.test(line.hash)) continue
    if (blameLabel(line) === '') continue
    map.set(line.line, line)
  }
  return map
}

/** One cell of the annotate column. */
class BlameMarker extends GutterMarker {
  /**
   * @param {string} label the text of the cell
   * @param {object} entry the annotation behind it
   * @param {(hash: string) => void} openCommit opens the commit in Git
   */
  constructor(label, entry, openCommit) {
    super()
    this.label = label
    this.entry = entry
    this.openCommit = openCommit
  }

  /** Two cells with the same text and commit paint the same. */
  eq(other) {
    return other instanceof BlameMarker && other.label === this.label && other.entry?.hash === this.entry?.hash
  }

  toDOM() {
    const span = document.createElement('span')
    span.className = 'iwb-blame-note'
    span.textContent = this.label
    // The row says the two things the reader scans for; the rest is on hover.
    const short = typeof this.entry?.shortHash === 'string' ? this.entry.shortHash : ''
    const summary = typeof this.entry?.summary === 'string' ? this.entry.summary : ''
    span.title = [short, summary].filter(part => part !== '').join(' · ')
    span.dataset.hash = this.entry?.hash ?? ''
    // Keep the editor's own mouse handling out of the way: the click is a jump
    // to the commit, not a caret placement.
    span.addEventListener('mousedown', (event) => { event.preventDefault(); event.stopPropagation() })
    span.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      this.openCommit?.(this.entry?.hash ?? '')
    })
    return span
  }
}

/**
 * The annotate gutter.
 *
 * `Prec.high` puts it LEFT of the line numbers: CodeMirror orders gutters by
 * extension priority, and the reference view puts the annotation outside the
 * numbers.
 * @param {(hash: string) => void} openCommit opens the commit of a cell
 * @returns {object} the CodeMirror extension
 */
export function blameGutter(openCommit) {
  return Prec.high(gutter({
    class: 'iwb-blame-gutter',
    lineMarker(view, line) {
      const map = view.state.field(blameField, false)
      if (map === undefined || map.size === 0) return null
      const number = view.state.doc.lineAt(line.from).number
      const entry = map.get(number)
      if (entry === undefined) return null
      const label = blameLabel(entry)
      if (label === '') return null
      return new BlameMarker(label, entry, openCommit)
    },
    // Reserve the width of a typical cell before the first annotation is
    // measured: the column must not make the text jump sideways when it is
    // switched on.
    initialSpacer: () => new BlameMarker('2026/10/30 LiangshouX', { hash: '', shortHash: '', summary: '' }, null),
  }))
}
