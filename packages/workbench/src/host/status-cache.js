/**
 * The cache of the git status, and the watch on the work tree.
 *
 * The plugin asks the host for the git status every two seconds. Every tick
 * used to run `git status` in the HOST process - which is the process of DSH
 * itself - and to ship the whole snapshot to the browser. In a repository with
 * a large untracked tree that snapshot is megabytes of JSON, and the browser
 * parses it on its main thread: a long task in the page of the host.
 *
 * The watch answers the question the file system can answer - "did anything in
 * the work tree change?" - so the git process only runs when the answer is
 * yes, and the snapshot only travels when it is new.
 *
 * The watch is an ACCELERATOR, never the only source of truth: a watcher that
 * misses an event must not freeze the status. Every snapshot therefore has a
 * lifetime (`fallbackMs`), and after it the next request takes a new one even
 * when the watcher said nothing.
 */
import { watch } from 'node:fs'

/**
 * How long a snapshot may be reused when the watch says nothing changed (ms).
 *
 * The bound is the price of the accelerator: a change the watcher missed is
 * noticed after this time, not after two seconds. It is short enough to stay
 * invisible in the work of a user (the IDE of the host refreshes its git
 * state on a file event and polls every 45 seconds as a safety net) and long
 * enough that an idle workbench does not run git at all.
 */
export const STATUS_FALLBACK_MS = 15_000

/**
 * How long a work tree stays watched after the last request for it (ms).
 *
 * The client stops polling when the workbench is hidden, so the watch has to
 * close itself: a watcher that is never closed is a handle of the host
 * process that never goes away.
 */
export const STATUS_WATCH_IDLE_MS = 90_000

/**
 * How often the cache looks for the watches nobody asks for any more (ms).
 */
const SWEEP_INTERVAL_MS = 30_000

/**
 * Whether a path of an event belongs to the repository itself.
 *
 * Git writes into `.git` (the index, the locks), and the work tree of the
 * repository contains that directory: without this filter the snapshot would
 * mark its own repository as changed and the refresh would run for ever.
 * @param {string} filename the path of the event, relative to the watch
 * @returns {boolean} true when the path is inside `.git`
 */
function isRepositoryInternal(filename) {
  if (typeof filename !== 'string' || filename === '') return false
  return filename.split(/[\\/]/)[0] === '.git'
}

/**
 * The cached status of the repositories the client asks about.
 */
export class StatusCache {
  /**
   * @param {{ fallbackMs?: number, idleMs?: number, sweepMs?: number, watch?: Function }} [options]
   */
  constructor(options = {}) {
    this.fallbackMs = Number.isFinite(options.fallbackMs) ? options.fallbackMs : STATUS_FALLBACK_MS
    this.idleMs = Number.isFinite(options.idleMs) ? options.idleMs : STATUS_WATCH_IDLE_MS
    this.sweepMs = Number.isFinite(options.sweepMs) ? options.sweepMs : SWEEP_INTERVAL_MS
    // The watch is injectable so that the gates can drive it without a file
    // system and without a clock.
    this.watch = typeof options.watch === 'function' ? options.watch : watch
    /** @type {Map<string, any>} */
    this.entries = new Map()
    this.sweepTimer = null
    /** The number of snapshots the cache has produced; it is the revision. */
    this.revision = 0
  }

  /**
   * The entry of one root.
   *
   * The entry is created on demand and it is touched on every request: the
   * idle sweep uses the touch to know which watches are still wanted.
   * @param {string} key the root the client asked about
   * @returns {any} the entry
   */
  entry(key) {
    const id = typeof key === 'string' ? key : ''
    let entry = this.entries.get(id)
    if (entry === undefined) {
      entry = {
        key: id,
        /** The revision of the last snapshot; 0 means "no snapshot yet". */
        revision: 0,
        /** When the last snapshot was taken. */
        at: 0,
        /**
         * How many changes the watcher has seen.
         *
         * The count is a counter and not a flag: a change that arrives WHILE
         * the snapshot is taken must not be swallowed by it. The snapshot
         * remembers the count it started from, and the entry is stale as long
         * as the two differ.
         */
        changes: 0,
        /** The count the last snapshot started from. */
        seen: -1,
        /** Whether the work tree is watched at all. */
        watched: false,
        /** The options of the last snapshot (the line counts, the levels). */
        options: '',
        /** The watcher of the work tree. */
        watcher: null,
        /** The root the watcher watches. */
        root: '',
        /** When the entry was asked for the last time. */
        touchedAt: Date.now(),
      }
      this.entries.set(id, entry)
    }
    entry.touchedAt = Date.now()
    return entry
  }

  /**
   * Whether the snapshot the client holds is still the one of the host.
   *
   * Three conditions have to hold: the client names the revision of the last
   * snapshot, the work tree did not change since, and the snapshot is not
   * older than the fallback. The last one is the safety net of the watch.
   * @param {any} entry the entry of the root
   * @param {unknown} since the revision the client holds
   * @param {string} options the options the client asks for
   * @param {number} [now] the current time
   * @returns {boolean} true when the client needs no new snapshot
   */
  isCurrent(entry, since, options, now = Date.now()) {
    if (entry === undefined || entry === null) return false
    if (typeof since !== 'number' || since !== entry.revision) return false
    if (entry.revision === 0) return false
    if (entry.watched !== true) return false
    if (entry.changes !== entry.seen) return false
    if (entry.options !== options) return false
    if (now - entry.at >= this.fallbackMs) return false
    return true
  }

  /**
   * How many changes the watcher of an entry has seen.
   *
   * The caller takes the number BEFORE the snapshot is taken and hands it
   * back to `publish`: a change that happens while git reads the work tree
   * then keeps the entry stale, instead of being swallowed by the snapshot
   * that did not see it.
   * @param {any} entry the entry of the root
   * @returns {number} the number of changes
   */
  changesOf(entry) {
    return entry === undefined || entry === null ? 0 : entry.changes
  }

  /**
   * The snapshot of an entry is not usable.
   *
   * A git call that failed leaves the entry without a snapshot: the next
   * request has to try again, or the client would keep the error of a failed
   * call for ever.
   * @param {any} entry the entry of the root
   * @returns {void}
   */
  invalidate(entry) {
    if (entry === undefined || entry === null) return
    entry.changes += 1
  }

  /**
   * A new snapshot was taken: it gets a revision of its own.
   *
   * The revision is unique in the process, so a client that switches to
   * another repository can never mistake the snapshot of the old one for the
   * snapshot of the new one.
   * @param {any} entry the entry of the root
   * @param {string} options the options the snapshot was taken with
   * @param {number} [seen] the number of changes the snapshot started from
   * @param {number} [now] the current time
   * @returns {number} the revision of the snapshot
   */
  publish(entry, options, seen = entry.changes, now = Date.now()) {
    this.revision += 1
    entry.revision = this.revision
    entry.at = now
    entry.seen = seen
    entry.options = options
    return entry.revision
  }

  /**
   * Watch the work tree of one entry.
   *
   * The watch is an accelerator: when it cannot be established (a platform
   * without a recursive watch, a watch limit of the kernel) the entry stays
   * unwatched, and `isCurrent` then never says "current" - the plugin keeps
   * the behaviour it had before the watch, which is correct but slower.
   * @param {any} entry the entry of the root
   * @param {string} root the absolute root of the work tree
   * @param {boolean} [repository] whether the root is the repository itself
   * @returns {boolean} whether the tree is watched
   */
  watchTree(entry, root, repository = true) {
    if (typeof root !== 'string' || root === '') return false
    if (entry.root === root && entry.watcher !== null) return true
    this.closeWatch(entry)
    try {
      entry.watcher = this.watch(root, { recursive: true, persistent: false }, (kind, filename) => {
        // The repository writes into itself (the index, the locks): those
        // events are not a change of the work tree.
        if (repository === true && isRepositoryInternal(filename)) return
        entry.changes += 1
      })
    } catch {
      // A watch that cannot be established is not an error: the status is
      // still correct, it is just taken again on every request.
      entry.watcher = null
      entry.root = ''
      entry.watched = false
      return false
    }
    entry.root = root
    entry.watched = true
    this.#ensureSweep()
    return true
  }

  /**
   * Close the watch of one entry.
   * @param {any} entry the entry of the root
   * @returns {void}
   */
  closeWatch(entry) {
    if (entry.watcher !== null) {
      try { entry.watcher.close() } catch { /* the watcher is already gone */ }
      entry.watcher = null
    }
    entry.root = ''
    entry.watched = false
    this.#stopSweepIfIdle()
  }

  /**
   * Close the watches and drop the entries nobody asks for any more.
   *
   * The client stops polling when the workbench is hidden, and the plugin
   * goes away with its Session: a watch that outlives both is a handle of the
   * host process that never goes away.
   * @param {number} [now] the current time
   * @returns {void}
   */
  sweep(now = Date.now()) {
    for (const entry of [...this.entries.values()]) {
      if (now - entry.touchedAt < this.idleMs) continue
      this.closeWatch(entry)
      this.entries.delete(entry.key)
    }
  }

  /**
   * Drop everything: the plugin is torn down.
   * @returns {void}
   */
  clear() {
    for (const entry of [...this.entries.values()]) this.closeWatch(entry)
    this.entries.clear()
    if (this.sweepTimer !== null) {
      clearInterval(this.sweepTimer)
      this.sweepTimer = null
    }
  }

  /**
   * Start the sweep when the first watch is opened.
   * @returns {void}
   */
  #ensureSweep() {
    if (this.sweepTimer !== null) return
    this.sweepTimer = setInterval(() => { this.sweep() }, this.sweepMs)
    // A timer must not keep the host process alive.
    this.sweepTimer?.unref?.()
  }

  /**
   * Stop the sweep when the last watch is closed.
   * @returns {void}
   */
  #stopSweepIfIdle() {
    if (this.sweepTimer === null) return
    for (const entry of this.entries.values()) {
      if (entry.watcher !== null) return
    }
    clearInterval(this.sweepTimer)
    this.sweepTimer = null
  }
}
