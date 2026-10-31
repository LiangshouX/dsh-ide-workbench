/**
 * dsh-ide-workbench — Host half.
 *
 * One fenced HTTP surface (`/ide-workbench/api/<method>`) and one WebSocket
 * upgrade (`/ide-workbench/ws/terminal`) back the four tool windows:
 *
 *   Project   fs.tree / fs.read / fs.reveal / git.status
 *   Commit    git.status / diff / stage / unstage / discard / applyPatch / commit
 *   Git       git.log / branches / checkout / revert / detail / push
 *   Terminal  ws terminal + terminal.shells / terminal.activity
 *   Shell     shell.openExternal (validated URL → OS default handler)
 *
 * Git is always the system CLI (argv arrays, never a shell string), so the
 * user's own credential manager, hooks and config apply. Every request is
 * admitted through the public Connection service (the same fence `/api` uses).
 */
import { randomUUID } from 'node:crypto'
import { stat, unlink } from 'node:fs/promises'
import { dirname, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer, WebSocket } from 'ws'
import { runGit, repoRootOf, status as gitStatus, diff as gitDiff, diffRev as gitDiffRev, diffRefs as gitDiffRefs, stage as gitStage, unstage as gitUnstage, discard as gitDiscard, applyPatch as gitApplyPatch, commit as gitCommit, push as gitPush, log as gitLog, branches as gitBranches, checkout as gitCheckout, revert as gitRevert, commitDetail, commitFileDiff, showFile, recentMessages } from './host/git.js'
import { SettingsStore, settingsFile } from './host/settings-store.js'
import { openInIdea, openInIde } from './host/idea.js'
import { openExternalUrl } from './host/shell.js'
import {
  canonicalRoot, listDirectory, listProjectCandidates, readFileForPreview, resolveInside,
  revealInExplorer, runCommand, samePath, shellArgv, shellCandidates, terminalEnv, toRelative, writeFileText,
} from './host/workspace.js'
import {
  appendIgnore, createEntry, deleteEntries, duplicateEntry, moveEntries, renameEntry,
} from './host/fileops.js'
import { listFiles, searchFiles } from './host/search.js'
import { LspManager, shutdownAll } from './host/lsp.js'
import { registerLspWebSocket, shutdownLspWebSocket } from './host/lsp-ws.js'
import { guardEmitter } from './host/guard.js'
import {
  ApiError, optionalBoolean, optionalInteger, readJsonBody, requireString, stringArray,
  writeError, writeOk,
} from './host/wire.js'

export const name = 'dsh-ide-workbench'

/** Services the host half needs before it can mount. */
export const inject = ['webServer', 'connection', 'subprocess', 'workspaceRegistry']

const API_PREFIX = '/ide-workbench/api/'
const WS_PATH = '/ide-workbench/ws/terminal'

/**
 * The directory of the plugin's own sources.
 *
 * The error boundary below has to tell "an error of this plugin" from "an
 * error of the host", and a stack trace is the only evidence it has. The
 * plugin's own directory is the precise marker: the path of the plugin is
 * part of the stack of every frame of its own code, and of no other.
 */
const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url)).split(sep).join('/')

/**
 * The stack of one error, with its causes, normalized to forward slashes.
 *
 * A stack trace prints the source as a `file://` URL on every platform, so
 * the paths are compared in that form; a Windows path with backslashes
 * would never match.
 * @param {unknown} error the error
 * @returns {string} the stack
 */
function stackOf(error) {
  const parts = []
  const seen = new Set()
  let current = error
  while (current !== null && current !== undefined && !seen.has(current)) {
    seen.add(current)
    if (typeof current.stack === 'string') parts.push(current.stack)
    current = current.cause
  }
  return parts.join('\n').split('\\').join('/')
}

/**
 * Whether one error comes from the plugin's own code.
 *
 * The attribution has to be narrow. The DSH host ends its process on an
 * uncaught exception - that is the right policy for the host - and a
 * plugin that took every error away from the host would turn that safety
 * net into a no-op. Only an error whose stack points into this plugin's
 * own sources is the plugin's business.
 * @param {unknown} error the error
 * @returns {boolean} true when the error belongs to the plugin
 */
function isPluginFault(error) {
  if (error === null || typeof error !== 'object') return false
  return stackOf(error).includes(PLUGIN_DIR)
}

/**
 * Make one emitter safe.
 *
 * An 'error' event without a listener is an uncaught exception, and an
 * uncaught exception ends the DSH host process. Every socket and every
 * server of the plugin therefore carries a listener: a terminal that cannot
 * be opened must not take the IDE down with it.
 *
 * The helper lives in `host/guard.js` so that the host half and the plugin
 * entry can share it; it is re-exported here because the plugin entry is
 * the public face of the package.
 */
export { guardEmitter } from './host/guard.js'

/**
 * Install the error boundary of the plugin.
 *
 * The DSH host installs a fail-loud handler: an uncaught exception is
 * written to the log and the process is ended. For the host itself that is
 * the right behaviour, but a plugin must not be able to take the whole IDE
 * down with it - one language server whose pipe breaks has to cost the user
 * the semantic features, not the application (the crash report of the
 * second review round: `Error: write EPIPE` killed the host while the user
 * was switching the project).
 *
 * The plugin therefore TAKES THE EVENT OVER: the handlers that were
 * installed before are remembered and called for every error that is not
 * the plugin's own, so the host keeps its fail-loud policy unchanged. Only
 * an error that comes from the plugin's own sources is contained, and it is
 * reported instead.
 *
 * Taking the event over (instead of adding a listener) is deliberate: Node
 * copies the handler array before it calls the handlers, so a listener that
 * removes the other handlers while it runs cannot stop them from being
 * called in the same turn - the host's handler would end the process before
 * the boundary could do anything about it.
 *
 * @param {any} ctx the cordis host context
 * @param {(error: unknown) => void} onFault what to do with a contained fault
 * @returns {() => void} the uninstaller
 */
function installErrorBoundary(ctx, onFault) {
  /**
   * Take one event over.
   * @param {'uncaughtException' | 'unhandledRejection'} event the event
   * @returns {{ handler: Function, inherited: Function[] }} the new handler and the inherited ones
   */
  const takeover = (event) => {
    const inherited = process.listeners(event)
    const handler = function boundary(error) {
      if (isPluginFault(error)) {
        try {
          ctx.logger?.error?.(
            'dsh-ide-workbench: contained a %s of the plugin: %s',
            event === 'uncaughtException' ? 'fatal exception' : 'rejected promise',
            error instanceof Error ? (error.stack ?? error.message) : String(error),
          )
          onFault(error)
        } catch (fault) {
          ctx.logger?.error?.('dsh-ide-workbench: the fault handler failed: %s', fault instanceof Error ? fault.stack : String(fault))
        }
        return
      }
      // A failure that is not the plugin's own: the handlers that were
      // installed before must see it exactly as before - the fail-loud
      // handler of the host included.
      for (const listener of inherited) {
        try { listener(error) } catch { /* the handler of the host decides what happens next */ }
      }
    }
    process.removeAllListeners(event)
    process.on(event, handler)
    return { handler, inherited }
  }
  const exceptions = takeover('uncaughtException')
  const rejections = takeover('unhandledRejection')
  return () => {
    process.removeListener('uncaughtException', exceptions.handler)
    process.removeListener('unhandledRejection', rejections.handler)
    // The handlers of the host go back where they were.
    for (const listener of exceptions.inherited) {
      if (!process.listeners('uncaughtException').includes(listener)) process.on('uncaughtException', listener)
    }
    for (const listener of rejections.inherited) {
      if (!process.listeners('unhandledRejection').includes(listener)) process.on('unhandledRejection', listener)
    }
  }
}

/** Clamp a numeric query parameter. */
function clamp(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(Math.max(Math.trunc(number), min), max)
}

/**
 * The live state of one project root.
 *
 * The manager keys its map by the normalized path, so the lookup compares the
 * paths themselves: on Windows the drive letter and the folder case do not
 * have to match.
 * @param {Map<string, string>} live the live states
 * @param {string} path the absolute path
 * @returns {string | undefined} the state
 */
function liveStateOf(live, path) {
  if (live === null || live === undefined || typeof live.entries !== 'function') return undefined
  for (const [key, state] of live.entries()) {
    if (samePath(key, path)) return state
  }
  return undefined
}

/**
 * Mount the plugin.
 * @param {any} ctx cordis host context
 */
export function apply(ctx) {
  const settings = new SettingsStore()
  /** Live terminal handles by session id, for the activity endpoint and unload. */
  const terminals = new Map()

  /**
   * The language server manager (PRD-v5 §3.1).
   *
   * It owns the process lifecycle, the state machine and the memory
   * pre-check; the client only ever reads the state it publishes. The
   * "indexed roots" fact lives in the settings document, so the badge in the
   * project picker survives a restart.
   */
  const lsp = new LspManager({
    ctx,
    getSettings: async () => settings.get(),
    persistIndexedRoots: async (indexedRoots) => {
      await settings.update({ lsp: { indexedRoots } })
    },
  })

  const fence = (req) => ctx.connection.requestRejection(req) === undefined

  /**
   * Canonical workspace root + git command environment.
   *
   * A workspace can be a container whose repository lives deeper; git then
   * reports repository-relative paths while the tree/API speak
   * workspace-relative paths. `prefix` is the bridge, and every git call runs
   * at the repository toplevel.
   */
  const repoEnv = async (payload) => {
    const current = await settings.get()
    const workspaceRoot = await canonicalRoot(payload?.root)
    const toplevel = await repoRootOf({ gitPath: current.git.path, root: workspaceRoot })
    const root = toplevel ?? workspaceRoot
    const prefix = toplevel === null || toplevel === workspaceRoot
      ? ''
      : relative(workspaceRoot, toplevel).split(sep).join('/')
    return { root, workspaceRoot, repoRoot: toplevel ?? null, isRepo: toplevel !== null, prefix, gitPath: current.git.path }
  }

  /** Workspace-relative path → repository-relative path. */
  const toRepoPath = (env, path) => {
    const normalized = String(path).split('\\').join('/')
    if (env.prefix === '') return normalized
    const prefix = `${env.prefix}/`
    if (!normalized.startsWith(prefix)) {
      throw new ApiError('forbidden', 'path is outside the repository', 403)
    }
    return normalized.slice(prefix.length)
  }

  /** Prefix a repository-relative path with the workspace prefix. */
  const fromRepoPath = (env, path) => (env.prefix === '' ? path : `${env.prefix}/${path}`)

  /** All tool-window API methods. */
  const api = {
    // ── workspaces ───────────────────────────────────────────────────────
    'workspace.list': async () => {
      const current = await settings.get()
      const items = ctx.workspaceRegistry.list().map(item => ({
        id: item.id,
        path: item.path,
        title: item.title,
        updatedAt: item.updatedAt,
      }))
      let defaultRoot
      const candidates = [current.lastRoot, items.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0]?.path]
      for (const candidate of candidates) {
        if (typeof candidate !== 'string' || candidate === '') continue
        try {
          const info = await stat(candidate)
          if (info.isDirectory()) { defaultRoot = candidate; break }
        } catch { /* try the next candidate */ }
      }
      return {
        items,
        defaultRoot,
        defaultDirectory: ctx.get?.('workingDirectory')?.defaultDirectory ?? undefined,
      }
    },

    'workspace.add': async (payload) => {
      const path = requireString(payload, 'path')
      const workspace = await ctx.workspaceRegistry.create(path)
      return { id: workspace.id, path: workspace.path, title: workspace.title }
    },

    /** Root + first-level folders that can be selected as the IDE project. */
    'workspace.projects': async (payload) => {
      const root = await canonicalRoot(payload?.root)
      const current = await settings.get()
      const indexed = current.lsp?.indexedRoots ?? {}
      const live = typeof lsp.liveStates === 'function' ? lsp.liveStates() : new Map()
      const indexStateOf = (path) => {
        // A folder that once completed a first build stays "indexed": the
        // badge is a historical fact, not a live connection state.
        const key = Object.keys(indexed).find(candidate => samePath(candidate, path))
        if (key !== undefined) {
          const entry = indexed[key]
          return { state: 'indexed', at: Number.isFinite(entry?.at) ? entry.at : null }
        }
        const state = liveStateOf(live, path)
        return state === undefined ? null : { state, at: null }
      }
      return listProjectCandidates(root, { indexStateOf })
    },

    // ── filesystem ───────────────────────────────────────────────────────
    'fs.tree': async (payload) => {
      const current = await settings.get()
      const root = await canonicalRoot(payload.root)
      const path = typeof payload.path === 'string' && payload.path !== '' ? payload.path : root
      const listing = await listDirectory(root, path, { showHidden: current.project.showHidden })
      return { root, ...listing }
    },

    'fs.read': async (payload) => {
      const root = await canonicalRoot(payload.root)
      return readFileForPreview(root, requireString(payload, 'path'))
    },

    'fs.files': async (payload) => {
      const env = await repoEnv(payload)
      return listFiles(env)
    },

    'fs.stat': async (payload) => {
      const root = await canonicalRoot(payload.root)
      const absolute = resolveInside(root, requireString(payload, 'path'))
      try {
        const info = await stat(absolute)
        return { path: toRelative(root, absolute), size: info.size, mtimeMs: info.mtimeMs, isDirectory: info.isDirectory() }
      } catch {
        throw new ApiError('not-found', 'file not found', 404)
      }
    },

    'fs.search': async (payload) => {
      const env = await repoEnv(payload)
      const query = requireString(payload, 'query')
      return searchFiles(env, {
        query,
        caseSensitive: optionalBoolean(payload, 'caseSensitive', false),
        wholeWord: optionalBoolean(payload, 'wholeWord', false),
        regexp: optionalBoolean(payload, 'regexp', false),
        include: stringArray(payload, 'include'),
        exclude: stringArray(payload, 'exclude'),
        maxResults: optionalInteger(payload, 'maxResults', 2000),
      })
    },

    'fs.write': async (payload) => {
      const root = await canonicalRoot(payload.root)
      const path = requireString(payload, 'path')
      const content = requireString(payload, 'content', { allowEmpty: true })
      const encoding = typeof payload.encoding === 'string' ? payload.encoding : 'utf-8'
      const expectedMtimeMs = Number.isFinite(payload.expectedMtimeMs) ? payload.expectedMtimeMs : undefined
      return writeFileText(root, path, content, encoding, { expectedMtimeMs })
    },

    'fs.reveal': async (payload) => {
      const root = await canonicalRoot(payload.root)
      const absolute = resolveInside(root, requireString(payload, 'path'))
      return { revealed: revealInExplorer(absolute), path: toRelative(root, absolute) }
    },

    'fs.openInIde': async (payload) => {
      const ide = requireString(payload, 'ide')
      if (!['idea', 'webstorm', 'vscode'].includes(ide)) throw new ApiError('bad-request', 'Unknown IDE: choose idea, webstorm or vscode')
      const current = await settings.get()
      return openInIde(payload, current[ide].path)
    },

    'fs.openInIdea': async (payload) => {
      const current = await settings.get()
      // Use the selected IDE project root, never repoEnv's git toplevel.
      return openInIdea(payload, current.idea.path)
    },

    'shell.openExternal': async (payload) => openExternalUrl(payload),

    'fs.create': async (payload) => {
      const root = await canonicalRoot(payload.root)
      return createEntry(root, {
        parent: requireString(payload, 'parent'),
        name: requireString(payload, 'name'),
        isDir: optionalBoolean(payload, 'isDir', false),
        content: typeof payload.content === 'string' ? payload.content : '',
      })
    },

    'fs.rename': async (payload) => {
      const root = await canonicalRoot(payload.root)
      return renameEntry(root, {
        path: requireString(payload, 'path'),
        name: requireString(payload, 'name'),
      })
    },

    'fs.duplicate': async (payload) => {
      const root = await canonicalRoot(payload.root)
      return duplicateEntry(root, { path: requireString(payload, 'path') })
    },

    'fs.move': async (payload) => {
      const root = await canonicalRoot(payload.root)
      const conflict = ['error', 'skip', 'rename', 'overwrite'].includes(payload.conflict)
        ? payload.conflict
        : 'error'
      return moveEntries(root, {
        paths: stringArray(payload, 'paths'),
        target: requireString(payload, 'target'),
        copy: optionalBoolean(payload, 'copy', false),
        conflict,
      })
    },

    'fs.delete': async (payload) => {
      const root = await canonicalRoot(payload.root)
      const current = await settings.get()
      return deleteEntries(root, {
        paths: stringArray(payload, 'paths'),
        trash: optionalBoolean(payload, 'trash', current.delete?.useRecycleBin !== false),
        allowPermanent: optionalBoolean(payload, 'allowPermanent', false),
      })
    },

    'git.ignore': async (payload) => {
      // The fence is the workspace root. `path` is the absolute path of the
      // file and `repoRoot` the absolute root of the repository it belongs
      // to: both must name that repository, because the `.gitignore` entry is
      // written relative to it (PRD-v4 review R3).
      const root = await canonicalRoot(payload.root)
      const repoRoot = typeof payload.repoRoot === 'string' ? payload.repoRoot : undefined
      return appendIgnore(root, { path: requireString(payload, 'path'), repoRoot })
    },

    // ── git ──────────────────────────────────────────────────────────────
    'git.status': async (payload) => {
      const env = await repoEnv(payload)
      const current = await settings.get()
      // Ignored entries are only listed when the user enabled that setting,
      // and the per-file line counts are only computed for the Commit window.
      const snapshot = await gitStatus(env, {
        ignored: current.project.showIgnored === true,
        numstat: payload?.numstat === true,
      })
      return {
        ...snapshot,
        root: env.workspaceRoot,
        workspaceRoot: env.workspaceRoot,
        repoRoot: snapshot.root ?? null,
        entries: (snapshot.entries ?? []).map(entry => ({ ...entry, path: fromRepoPath(env, entry.path) })),
        gitPath: env.gitPath,
      }
    },

    'git.diff': async (payload) => {
      const env = await repoEnv(payload)
      const path = requireString(payload, 'path')
      const staged = optionalBoolean(payload, 'staged', false)
      const untracked = optionalBoolean(payload, 'untracked', false)
      if (untracked) {
        const file = await readFileForPreview(env.workspaceRoot, path)
        return { untracked: true, ...file }
      }
      return { untracked: false, diff: await gitDiff(env, toRepoPath(env, path), staged) }
    },

    'git.diff-refs': async (payload) => {
      const env = await repoEnv(payload)
      const a = requireString(payload, 'a')
      const b = requireString(payload, 'b')
      return { diff: await gitDiffRefs(env, a, b) }
    },

    'git.commit-file-diff': async (payload) => {
      const env = await repoEnv(payload)
      const hash = requireString(payload, 'hash')
      const path = toRepoPath(env, requireString(payload, 'path'))
      return { diff: await commitFileDiff(env, hash, path) }
    },

    'git.stage': async (payload) => {
      const env = await repoEnv(payload)
      await gitStage(env, stringArray(payload, 'paths').map(path => toRepoPath(env, path)))
      return { ok: true }
    },

    'git.unstage': async (payload) => {
      const env = await repoEnv(payload)
      await gitUnstage(env, stringArray(payload, 'paths').map(path => toRepoPath(env, path)))
      return { ok: true }
    },

    'git.discard': async (payload) => {
      const env = await repoEnv(payload)
      const paths = stringArray(payload, 'paths').map(path => toRepoPath(env, path))
      const untracked = stringArray(payload, 'untracked')
      for (const path of untracked) {
        await unlink(resolveInside(env.workspaceRoot, path)).catch(() => {})
      }
      if (paths.length > 0) await gitDiscard(env, paths)
      return { ok: true }
    },

    'git.apply-patch': async (payload) => {
      const env = await repoEnv(payload)
      const direction = payload.direction === 'unstage' ? 'unstage' : 'stage'
      await gitApplyPatch(env, requireString(payload, 'patch'), direction)
      return { ok: true }
    },

    'git.diff-rev': async (payload) => {
      const env = await repoEnv(payload)
      const path = toRepoPath(env, requireString(payload, 'path'))
      const rev = requireString(payload, 'rev')
      return { diff: await gitDiffRev(env, path, rev) }
    },

    'run.command': async (payload) => {
      const root = await canonicalRoot(payload.root)
      const command = requireString(payload, 'command')
      const timeoutMs = optionalInteger(payload, 'timeoutMs', 600_000)
      return runCommand(root, command, { timeoutMs })
    },

    'git.commit': async (payload) => {
      const env = await repoEnv(payload)
      return gitCommit(env, requireString(payload, 'message'), optionalBoolean(payload, 'amend', false))
    },

    'git.push': async (payload) => {
      const env = await repoEnv(payload)
      return gitPush(env)
    },

    'git.log': async (payload) => {
      const env = await repoEnv(payload)
      const path = typeof payload.path === 'string' && payload.path !== '' ? toRepoPath(env, payload.path) : undefined
      const commits = await gitLog(env, {
        skip: optionalInteger(payload, 'skip', 0),
        count: optionalInteger(payload, 'count', 200),
        branch: typeof payload.branch === 'string' ? payload.branch : undefined,
        author: typeof payload.author === 'string' ? payload.author : undefined,
        query: typeof payload.query === 'string' ? payload.query : undefined,
        since: typeof payload.since === 'string' ? payload.since : undefined,
        regex: optionalBoolean(payload, 'regex', false),
        path,
      })
      return { commits, hasMore: commits.length > 0 }
    },

    'git.branches': async (payload) => {
      const env = await repoEnv(payload)
      return gitBranches(env)
    },

    'git.checkout': async (payload) => {
      const env = await repoEnv(payload)
      return gitCheckout(env, requireString(payload, 'ref'))
    },

    'git.revert': async (payload) => {
      const env = await repoEnv(payload)
      return gitRevert(env, requireString(payload, 'hash'))
    },

    'git.detail': async (payload) => {
      const env = await repoEnv(payload)
      return commitDetail(env, requireString(payload, 'hash'))
    },

    'git.show': async (payload) => {
      const env = await repoEnv(payload)
      const content = await showFile(env, requireString(payload, 'rev'), requireString(payload, 'path'))
      return { content }
    },

    'git.messages': async (payload) => {
      const env = await repoEnv(payload)
      return { messages: await recentMessages(env, optionalInteger(payload, 'count', 10)) }
    },

    // ── terminal ─────────────────────────────────────────────────────────
    'terminal.shells': async () => ({ shells: shellCandidates() }),

    'terminal.activity': async (payload) => {
      const id = requireString(payload, 'id')
      const handle = terminals.get(id)
      if (handle === undefined) return { state: 'unknown' }
      try {
        return await handle.inspectActivity()
      } catch {
        return { state: 'unknown' }
      }
    },

    // ── settings ─────────────────────────────────────────────────────────
    'settings.get': async () => {
      const value = await settings.get()
      return { value, file: settingsFile() }
    },

    'settings.update': async (payload) => {
      const patch = payload?.patch
      if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new ApiError('bad-request', 'invalid settings patch')
      }
      const value = await settings.update(patch)
      return { value }
    },

    // ── semantic analysis (PRD-v5 §3.1) ─────────────────────────────────
    'lsp.status': async (payload) => lsp.status({
      root: typeof payload?.root === 'string' ? payload.root : undefined,
    }),

    'lsp.index': async (payload) => lsp.index({ root: requireString(payload, 'root') }),

    'lsp.start': async (payload) => lsp.start({
      root: requireString(payload, 'root'),
      languageId: typeof payload?.languageId === 'string' ? payload.languageId : undefined,
      // The user answered the memory question and asked for the server
      // anyway: the host skips its memory pre-check then (PRD §2.3).
      force: payload?.force === true,
    }),

    'lsp.cancelIndex': async (payload) => lsp.cancelIndex({ root: requireString(payload, 'root') }),

    'lsp.servers': async () => lsp.servers({}),

    'lsp.resources': async (payload) => lsp.resources({
      root: typeof payload?.root === 'string' ? payload.root : undefined,
    }),

    'lsp.shutdown': async (payload) => lsp.shutdown({
      root: typeof payload?.root === 'string' ? payload.root : undefined,
    }),

    /** The stderr of the language server, for the status bar's log link. */
    'lsp.logs': async (payload) => lsp.logs({
      root: typeof payload?.root === 'string' ? payload.root : undefined,
    }),
  }

  // ── JSON API route ─────────────────────────────────────────────────────
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/ide-workbench/api',
    handler: async (req, res) => {
      if (!fence(req)) {
        writeError(res, new ApiError('forbidden', 'forbidden', 403))
        return
      }
      if (req.method !== 'POST') {
        writeError(res, new ApiError('method-error', 'method not allowed', 405))
        return
      }
      const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
      const method = pathname.startsWith(API_PREFIX) ? pathname.slice(API_PREFIX.length) : undefined
      if (method === undefined || method === '' || method.includes('/')) {
        writeError(res, new ApiError('not-found', 'unknown API method', 404))
        return
      }
      try {
        const payload = await readJsonBody(req)
        const handler = Object.hasOwn(api, method) ? api[method] : undefined
        if (typeof handler !== 'function') throw new ApiError('not-found', `unknown API method "${method}"`, 404)
        const result = await handler(payload)
        writeOk(res, result)
      } catch (error) {
        writeError(res, error)
      }
    },
  }), 'dsh-ide-workbench: JSON API')

  // ── Terminal WebSocket ─────────────────────────────────────────────────
  const wss = new WebSocketServer({ noServer: true })
  // The WebSocket server is a source of errors of its own. An 'error' event
  // without a listener is an uncaught exception, and an uncaught exception
  // ends the DSH host process - a terminal that cannot be opened must not
  // take the whole IDE with it.
  guardEmitter(ctx, wss, 'WebSocket server')

  /**
   * Serve one terminal socket: allocate a real PTY, stream output, accept
   * input/resize/signal frames, and terminate the process when the socket
   * closes (a closed tab must not leave a shell running).
   */
  const attachTerminal = async (ws, req) => {
    const url = new URL(req.url ?? '/', 'http://dsh.internal')
    // A socket that fails is a closed tab, not a reason to end the IDE: the
    // 'error' event of a socket without a listener is an uncaught exception.
    guardEmitter(ctx, ws, 'terminal socket')
    let handle
    let sessionId = randomUUID()
    try {
      const current = await settings.get()
      const root = await canonicalRoot(url.searchParams.get('root'))
      const requestedCwd = url.searchParams.get('cwd')
      const cwd = requestedCwd !== null && requestedCwd !== '' ? resolveInside(root, requestedCwd) : root
      const shells = shellCandidates()
      const requestedShell = url.searchParams.get('shell') ?? current.terminal.shell
      const shell = shells.find(item => item.id === requestedShell) ?? shells[0]
      if (shell === undefined) throw new ApiError('terminal-unavailable', 'no supported shell was found')
      const cols = clamp(url.searchParams.get('cols'), 20, 400, 80)
      const rows = clamp(url.searchParams.get('rows'), 5, 200, 24)
      handle = await ctx.subprocess.spawnTerminal({
        argv: shellArgv(shell.id, shell.path),
        cwd,
        env: terminalEnv(),
        rows,
        cols,
        terminalType: 'xterm-256color',
        graceMs: 2000,
      })
      terminals.set(sessionId, handle)
      const send = (frame) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame))
      }
      send({ type: 'ready', info: { id: sessionId, shell: { id: shell.id, label: shell.label, path: shell.path }, cwd, root } })
      handle.output.setEncoding('utf8')
      handle.output.on('data', (chunk) => {
        const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
        if (text !== '') send({ type: 'data', data: text })
      })
      handle.output.on('error', (error) => {
        send({ type: 'error', message: error instanceof Error ? error.message : String(error) })
      })
      handle.done.then((outcome) => {
        send({ type: 'exit', exitCode: outcome.exitCode, signal: outcome.signal })
        ws.close()
      }).catch((error) => {
        send({ type: 'error', message: error instanceof Error ? error.message : String(error) })
        ws.close()
      })

      let writeChain = Promise.resolve()
      const write = (data) => {
        if (typeof data !== 'string' || data === '') return
        writeChain = writeChain.then(() => handle.write(data)).catch(() => {})
      }
      ws.on('message', (raw) => {
        let frame
        try {
          frame = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'))
        } catch {
          return
        }
        if (frame === null || typeof frame !== 'object') return
        if (frame.type === 'input') write(frame.data)
        else if (frame.type === 'resize') {
          const resizeCols = clamp(frame.cols, 20, 400, cols)
          const resizeRows = clamp(frame.rows, 5, 200, rows)
          void handle.resize(resizeCols, resizeRows).catch(() => {})
        } else if (frame.type === 'signal') {
          const allowed = new Set(['SIGINT', 'SIGTERM', 'SIGKILL', 'SIGTSTP', 'SIGHUP'])
          if (allowed.has(frame.signal)) void handle.signalForeground(frame.signal).catch(() => {})
        }
      })
      ws.on('close', () => {
        terminals.delete(sessionId)
        void handle.terminate().catch(() => {})
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'error', message }))
      ws.close()
      if (handle !== undefined) {
        terminals.delete(sessionId)
        void handle.terminate().catch(() => {})
      }
    }
  }

  ctx.effect(() => ctx.webServer.registerUpgrade({
    path: WS_PATH,
    handler: (req, socket, head) => {
      if (!fence(req)) {
        socket.destroy()
        return
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        void attachTerminal(ws, req)
      })
    },
  }), 'dsh-ide-workbench: terminal WebSocket')

  // ── Language Server WebSocket ─────────────────────────────────────────
  // A separate path from the terminal socket: the LSP frames are raw JSON
  // and must never share a connection with the PTY byte stream.
  // The effect has to hand back a disposer function: Cordis rejects an
  // effect that returns a plain object with "TypeError: Invalid effect",
  // and the whole plugin then fails to activate.
  ctx.effect(() => {
    const relay = registerLspWebSocket(ctx, { manager: lsp, fence })
    return () => relay.close()
  }, 'dsh-ide-workbench: LSP WebSocket')

  // ── error boundary ─────────────────────────────────────────────────────
  // One language server must never take the whole IDE down with it. The
  // boundary is an effect, so it goes away with the plugin and leaves no
  // listener behind in the host.
  ctx.effect(() => installErrorBoundary(ctx, () => {
    // The semantic features of the running servers are degraded: the pipe of
    // a language server is broken, so its session is not usable any more and
    // the status bar must not keep saying "ready".
    const states = lsp.liveStates()
    const roots = states instanceof Map ? [...states.keys()] : Object.keys(states ?? {})
    for (const root of roots) {
      try {
        lsp.transition(root, 'degraded', 'the language server reported a broken pipe')
      } catch {
        /* not every state may be degraded - the crash handler of the manager
           deals with the rest */
      }
    }
  }), 'dsh-ide-workbench: error boundary')

  // ── teardown ───────────────────────────────────────────────────────────
  ctx.effect(() => () => {
    for (const client of wss.clients) client.close()
    wss.close()
    for (const [id, handle] of terminals) {
      terminals.delete(id)
      void handle.terminate().catch(() => {})
    }
    shutdownLspWebSocket()
    shutdownAll()
  }, 'dsh-ide-workbench: teardown')

  ctx.effect(() => {
    ctx.logger?.info?.('dsh-ide-workbench ready (API %s, terminal %s)', API_PREFIX, WS_PATH)
    return () => {}
  }, 'dsh-ide-workbench: announce')
}
