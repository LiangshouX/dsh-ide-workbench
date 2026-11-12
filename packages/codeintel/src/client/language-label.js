/**
 * The display name of a language id.
 *
 * The host speaks language ids (`typescript`), the user reads names
 * (`TypeScript`).
 *
 * The helper was born in the flat layout of the plugin (where the semantic
 * analysis lived in the core) and moved here with the plugin that owns the
 * language servers. The dialogs of the plugin are the only place that shows
 * the language of a decision - and they show the NAME, not the id.
 */

/** The names of the language ids the plugin knows. */
const NAMES = {
  typescript: 'TypeScript',
  typescriptreact: 'TypeScript React',
  javascript: 'JavaScript',
  javascriptreact: 'JavaScript React',
  python: 'Python',
  yaml: 'YAML',
  java: 'Java',
  go: 'Go',
  rust: 'Rust',
  c: 'C',
  cpp: 'C++',
}

/**
 * The name of a language id.
 *
 * An unknown id is shown as it is: the id of a language the plugin does not
 * know is still better than nothing.
 * @param {string} languageId the language id
 * @returns {string} the name, or the id itself when it is unknown
 */
export function languageLabel(languageId) {
  const id = typeof languageId === 'string' ? languageId : ''
  return NAMES[id] ?? id
}
