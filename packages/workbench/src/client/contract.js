/**
 * The client contract of the workbench (PRD-v6 §3.2 / §3.3).
 *
 * The contract is a plain object - not a class, not a Proxy - and it reaches
 * the consumer as the `contract` PROP of the slot it occupies. There is no
 * global variable and no namespace: the prop is typed, scoped to the Session
 * and gone when the component is unmounted.
 *
 * Its shape is written down in the contract package and may not be renamed:
 *
 *   { version: CONTRACT_VERSION, editor: EditorSeam, host: WorkbenchHostApi }
 *
 * The `host` part is the CLIENT side view of the workbench: the same shape
 * the host provides over the Cordis service bus, implemented here over the
 * routes the core owns. It is what lets a consumer do a text search without
 * knowing anything about the workbench.
 */
import { call } from './api.js'
import { CONTRACT_VERSION } from '../contract/index.js'
import { EditorSeam } from './editor-seam.js'

/**
 * The client side view of the workbench (PRD-v6 §3.2).
 *
 * Every method is implemented over the routes the core owns, so the consumer
 * does not need a second transport of its own.
 *
 * @param {object} store the workbench store behind the contract
 * @returns {object} the host view
 */
export function createHostApi(store) {
  /** The root of the project the workbench shows. */
  const getProjectRoot = () => (typeof store?.state?.root === 'string' ? store.state.root : '')
  return {
    version: CONTRACT_VERSION,
    getProjectRoot,
    /**
     * The root the scope of the workbench covers.
     *
     * The core has no narrower scope than its project root - the scope root
     * of the language servers is a concept of the code intelligence - so the
     * project root is the scope here.
     */
    getScopeRoot: () => getProjectRoot(),
    /**
     * Read one file of the project.
     *
     * The contract answers with the CONTENT of the file, not with the
     * preview object of the route: a consumer wants the text of the file,
     * and the route answers with a preview that also carries the encoding
     * and the size.
     * @param {string} absolutePath
     * @returns {Promise<string>} the content of the file
     */
    readFile: async (absolutePath) => {
      const result = await call('fs.read', { root: getProjectRoot(), path: absolutePath })
      if (result === null || typeof result !== 'object') return ''
      return typeof result.content === 'string' ? result.content : ''
    },
    /**
     * Search the project for a text.
     *
     * The route answers with `matches` and `preview`; the contract answers
     * with `hits` and `text` - the names the consumer of the contract uses.
     * @param {{query: string, caseSensitive?: boolean, wholeWord?: boolean, regexp?: boolean, limit?: number}} options
     * @returns {Promise<{files: Array<object>, truncated?: boolean}>} the hits
     */
    searchFiles: async (options = {}) => {
      const result = await call('fs.search', { root: getProjectRoot(), ...options })
      const files = Array.isArray(result?.files) ? result.files : []
      return {
        files: files.map(file => ({
          path: file?.path ?? '',
          hits: (Array.isArray(file?.matches) ? file.matches : []).map(match => ({
            line: match?.line ?? 0,
            column: match?.column ?? 0,
            text: match?.preview ?? '',
            before: match?.before,
            after: match?.after,
            binary: match?.binary,
          })),
        })),
        truncated: result?.truncated === true,
      }
    },
    /**
     * Subscribe to the changes of the project root.
     * @param {(root: string) => void} cb
     * @returns {() => void} the unsubscribe
     */
    onProjectChanged: (cb) => {
      if (typeof cb !== 'function') return () => {}
      let last = getProjectRoot()
      const unsubscribe = store.subscribe(() => {
        const root = getProjectRoot()
        if (root === last) return
        last = root
        cb(root)
      })
      return unsubscribe
    },
    /** The health of the core. */
    health: () => ({ ok: true }),
  }
}

/**
 * The contract of one workbench session.
 *
 * The editor seam belongs to the store, so the extensions of one session
 * never leak into another one. The contract is therefore built once per
 * store and handed to every occupant of the four slots.
 *
 * @param {object} store the workbench store
 * @returns {object} the contract
 */
export function createContract(store) {
  return {
    version: CONTRACT_VERSION,
    editor: store.editorSeam,
    host: createHostApi(store),
  }
}

/**
 * The editor seam of one store, created on demand.
 *
 * The seam needs the store for two things: the reveal of a position and the
 * document that is on the screen. Both are read through the callbacks below,
 * so the seam itself does not know the store.
 *
 * @param {object} store the workbench store
 * @returns {EditorSeam} the seam
 */
export function createEditorSeamForStore(store) {
  return new EditorSeam({
    reveal: (absolutePath, line, column) => {
      store.openFile(absolutePath, { preview: false, line, column })
    },
    readDocument: () => store.activeDocument(),
    subscribeDocument: (cb) => store.subscribe(cb),
  })
}
