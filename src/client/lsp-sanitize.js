/**
 * HTML sanitizer for LSP payloads (PRD-v5 §3.3 / §7.3).
 *
 * A language server answers hover and documentation requests with Markdown
 * that may contain arbitrary HTML. `@codemirror/lsp-client` renders that
 * Markdown to HTML and injects it into the page, so the server (or anyone
 * who can talk to the server) would otherwise have a cross-site scripting
 * channel into the workbench.
 *
 * The library expects a `sanitizeHTML(html) => html` function in the client
 * configuration; this module is that function.
 *
 * Why a hand-written sanitizer instead of DOMPurify: the plugin must not grow
 * a runtime dependency, and the browser build already carries a bundle size
 * budget (PRD §11.3). The surface that matters here is narrow - script-ish
 * elements, event handler attributes and script URLs - and it is covered by
 * `tests/lsp-html-sanitize.test.mjs`.
 *
 * The sanitizer is deliberately conservative: anything it does not understand
 * is kept as text, and the dangerous constructs are removed outright.
 */

/** Elements that are dropped together with their content. */
const DANGEROUS_ELEMENTS = [
  'script', 'iframe', 'object', 'embed', 'applet', 'frame', 'frameset',
  'base', 'meta', 'link', 'style',
]

/** Attributes that may carry a URL. */
const URL_ATTRIBUTES = /\b(href|src|xlink:href|action|formaction|poster|background|ping|data|srcset)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'<>`]+))/gi

/** URL schemes that must never survive. */
const DANGEROUS_SCHEME = /^(?:javascript|vbscript|livescript|mocha|data:text\/html)/i

/**
 * Decode the numeric HTML entities of one attribute value.
 *
 * `&#106;avascript:` is the same attack as `javascript:`, so the scheme
 * check has to run on the decoded text.
 * @param {string} text the raw attribute value
 * @returns {string} the decoded value
 */
function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => {
      const code = Number.parseInt(hex, 16)
      try {
        return Number.isFinite(code) ? String.fromCodePoint(code) : ''
      } catch {
        return ''
      }
    })
    .replace(/&#(\d+);/g, (_match, dec) => {
      const code = Number.parseInt(dec, 10)
      try {
        return Number.isFinite(code) ? String.fromCodePoint(code) : ''
      } catch {
        return ''
      }
    })
}

/**
 * Drop every whitespace and control character.
 *
 * Browsers ignore them inside a URL, so `java\tscript:` is a script URL too.
 * @param {string} text the text
 * @returns {string} the text without whitespace or control characters
 */
function stripInvisible(text) {
  let out = ''
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code > 32) out += char
  }
  return out
}

/**
 * Remove the elements that can execute code or re-point the page.
 * @param {string} html the HTML
 * @returns {string} the HTML without those elements
 */
function removeDangerousElements(html) {
  let out = html
  for (const name of DANGEROUS_ELEMENTS) {
    // The element together with its content.
    out = out.replace(new RegExp(`<\\s*${name}\\b[^>]*>[\\s\\S]*?<\\s*\\/\\s*${name}\\s*>`, 'gi'), '')
    // A stray closing tag, then the opening tag of an unterminated element.
    out = out.replace(new RegExp(`<\\s*\\/\\s*${name}\\s*>`, 'gi'), '')
    out = out.replace(new RegExp(`<\\s*${name}\\b[^>]*\\/?>`, 'gi'), '')
  }
  return out
}

/**
 * Remove the `on*` event handler attributes.
 * @param {string} html the HTML
 * @returns {string} the HTML without event handlers
 */
function removeEventAttributes(html) {
  return html
    .replace(/\s+on[a-z0-9_-]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\s+on[a-z0-9_-]+\s*=\s*'[^']*'/gi, '')
    .replace(/\s+on[a-z0-9_-]+\s*=\s*[^\s"'<>`]+/gi, '')
}

/**
 * Neutralize script URLs.
 *
 * The attribute pass handles `href="javascript:..."`; the final pass is the
 * safety net for the same scheme hiding anywhere else (a style attribute, a
 * text node, an entity-encoded variant).
 * @param {string} html the HTML
 * @returns {string} the HTML without script URLs
 */
function neutralizeScriptUrls(html) {
  const byAttribute = html.replace(URL_ATTRIBUTES, (match, name, _quoted, doubleQuoted, singleQuoted, bare) => {
    const raw = doubleQuoted ?? singleQuoted ?? bare ?? ''
    const decoded = stripInvisible(decodeEntities(raw))
    if (DANGEROUS_SCHEME.test(decoded)) return `${name}="about:blank"`
    return match
  })
  return byAttribute.replace(/javascript\s*:/gi, 'about:blank')
}

/**
 * Strip the dangerous constructs out of one HTML fragment.
 * @param {string} html the HTML as produced by the Markdown renderer
 * @returns {string} the sanitized HTML
 */
export function sanitizeHTML(html) {
  if (typeof html !== 'string' || html === '') return ''
  return neutralizeScriptUrls(removeEventAttributes(removeDangerousElements(html)))
}
