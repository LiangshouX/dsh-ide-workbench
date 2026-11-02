/**
 * Markdown outline extraction (pure): ATX headings outside fenced code,
 * GitHub-ish slugs with duplicate suffixes. Kept free of React so both the
 * preview and the unit tests can use it.
 */

/** Strip inline markdown decorations for outline labels. */
export function plainHeadingText(text) {
  return String(text)
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\*([^*]*)\*/g, '$1')
    .replace(/~~([^~]*)~~/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .trim()
}

/** GitHub-ish slug; duplicates get -1, -2, … */
export function slugifyHeading(text, used = new Map()) {
  const base = plainHeadingText(text)
    .toLowerCase()
    .replace(/[`~!@#$%^&*()+=[\]{};:'",.<>/?\\|]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'section'
  const count = used.get(base) ?? 0
  used.set(base, count + 1)
  return count === 0 ? base : `${base}-${count}`
}

/**
 * Extract the document outline (ATX headings outside fenced code).
 * @param {string} markdown source text
 * @returns {Array<{ level: number, text: string, slug: string }>}
 */
export function extractHeadings(markdown) {
  const headings = []
  const used = new Map()
  let fence = null
  for (const raw of String(markdown ?? '').split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '')
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line)
    if (fence !== null) {
      if (fenceMatch !== null && fenceMatch[1].startsWith(fence)) fence = null
      continue
    }
    if (fenceMatch !== null) {
      fence = fenceMatch[1]
      continue
    }
    const match = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (match === null) continue
    const text = plainHeadingText(match[2])
    if (text === '') continue
    headings.push({ level: match[1].length, text, slug: slugifyHeading(text, used) })
  }
  return headings
}
