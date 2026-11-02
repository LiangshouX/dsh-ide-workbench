/**
 * The host-side contract of PRD-v6 §3.2.
 *
 * The core PROVIDES this service on the Cordis bus; the codeintel CONSUMES it
 * with a soft `ctx.get` (a hard `inject` would keep the codeintel from
 * applying at all when the core is missing, and the user would see nothing
 * instead of the guidance of DEG-01).
 */

export interface WorkbenchHostApi {
  /** The major version of the contract (= CONTRACT_VERSION). */
  readonly version: number

  /** The root of the current IDE project (absolute path). '' when there is none. */
  getProjectRoot(): string

  /** The scope root (the range of the index). '' when there is none. */
  getScopeRoot(): string

  /** Read one file of an absolute path. Throws when the path is outside the project. */
  readFile(absolutePath: string): Promise<string>

  /** Search the files of the project for a piece of text. */
  searchFiles(options: {
    query: string
    caseSensitive?: boolean
    wholeWord?: boolean
    regexp?: boolean
    limit?: number
  }): Promise<{
    files: Array<{
      path: string
      hits: Array<{
        line: number
        column: number
        text: string
        before?: string[]
        after?: string[]
        binary?: boolean
      }>
    }>
    truncated?: boolean
  }>

  /** Subscribe to the changes of the project root. Returns the unsubscribe. */
  onProjectChanged(cb: (root: string) => void): () => void

  /** The health of the core itself. */
  health(): { ok: boolean; reason?: string }
}
