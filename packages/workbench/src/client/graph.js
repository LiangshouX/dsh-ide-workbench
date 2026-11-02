/**
 * Commit-graph lane layout.
 *
 * Classic lane tracking over a topologically ordered commit list:
 * `lanes[i]` is the hash lane i is waiting to draw next. A commit either
 * continues its lane with its first parent, forks a new lane per extra parent,
 * or converges into an already-waiting lane (the merge-row shape). The renderer
 * only needs `before`, `after`, `primary`, `mergeLanes` and `edges`.
 */

export const GRAPH_COLORS = ['#4c9aff', '#f5a623', '#8b7bff', '#36b37e', '#ff6b81', '#00b8d9', '#c678dd', '#e0a458']

/** Index of the lane currently waiting for `hash` (skipping `except`), or -1. */
function laneWith(lanes, hash, except = -1) {
  for (let index = 0; index < lanes.length; index += 1) {
    if (index !== except && lanes[index] === hash) return index
  }
  return -1
}

/**
 * Lay out one topologically ordered commit page.
 * @param {Array<{ hash: string, parents: string[] }>} commits newest first
 * @returns {{ rows: object[], maxLanes: number }}
 */
export function layoutGraph(commits) {
  const lanes = []
  const rows = []
  let maxLanes = 0

  for (const commit of commits) {
    const hash = commit.hash
    let matches = []
    for (let index = 0; index < lanes.length; index += 1) {
      if (lanes[index] === hash) matches.push(index)
    }
    if (matches.length === 0) {
      let lane = lanes.indexOf(undefined)
      if (lane === -1) {
        lane = lanes.length
        lanes.push(hash)
      } else {
        lanes[lane] = hash
      }
      matches = [lane]
    }
    const primary = matches[0]
    const before = lanes.slice()
    const mergeLanes = matches.slice(1)
    const after = lanes.slice()
    for (const lane of mergeLanes) after[lane] = undefined

    const parents = Array.isArray(commit.parents) ? commit.parents : []
    const edges = []
    if (parents.length === 0) {
      after[primary] = undefined
    } else {
      const first = parents[0]
      const waiting = laneWith(after, first, primary)
      if (waiting !== -1) {
        after[primary] = undefined
        edges.push({ from: primary, to: waiting })
      } else {
        after[primary] = first
        edges.push({ from: primary, to: primary })
      }
      for (const parent of parents.slice(1)) {
        const existing = laneWith(after, parent, -1)
        if (existing !== -1) {
          edges.push({ from: primary, to: existing })
          continue
        }
        let lane = after.indexOf(undefined)
        if (lane === -1) {
          lane = after.length
          after.push(parent)
        } else {
          after[lane] = parent
        }
        edges.push({ from: primary, to: lane })
      }
    }
    while (after.length > 0 && after[after.length - 1] === undefined) after.pop()

    const width = Math.max(before.length, after.length, primary + 1, mergeLanes.length > 0 ? Math.max(...mergeLanes) + 1 : 0)
    maxLanes = Math.max(maxLanes, width)
    rows.push({
      commit,
      primary,
      before,
      after,
      mergeLanes,
      edges,
      width,
    })
    lanes.length = 0
    lanes.push(...after)
  }
  return { rows, maxLanes }
}

/**
 * SVG geometry for one row (coordinates inside a `width * cell` by `1` box).
 * The renderer multiplies by the cell size.
 * @param {object} row
 * @returns {{ vertical: number[], incoming: Array<{ lane: number }>, outgoing: Array<{ to: number }>, node: number }}
 */
export function rowGeometry(row) {
  const vertical = []
  const max = Math.max(row.before.length, row.after.length)
  for (let lane = 0; lane < max; lane += 1) {
    if (lane === row.primary) continue
    const beforeHash = row.before[lane]
    const afterHash = row.after[lane]
    if (beforeHash !== undefined && afterHash === beforeHash) vertical.push(lane)
  }
  return {
    vertical,
    incoming: row.mergeLanes.map(lane => ({ lane })),
    outgoing: row.edges.map(edge => ({ to: edge.to })),
    node: row.primary,
  }
}
