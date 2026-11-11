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
import { runGit, repoRootOf, status as gitStatus, diff as gitDiff, diffRev as gitDiffRev, diffRefs as gitDiffRefs, stage as gitStage, unstage as gitUnstage, discard as gitDiscard, applyPatch as gitApplyPatch, commit as gitCommit, push as gitPush, log as gitLog, branches as gitBranches, checkout as gitCheckout, revert as gitRevert, commitDetail, commitFileDiff, showFile, recentMessages, blame as gitBlame } from './host/git.js'
import { SettingsStore, setProfileBase, settingsFile } from './host/settings-store.js'
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
import { guardEmitter } from './host/guard.js'
import {
  ApiError, optionalBoolean, optionalInteger, readJsonBody, requireString, stringArray,
  writeError, writeOk,
} from './host/wire.js'
import { CONTRACT_VERSION, HOST_SERVICE } from './contract/index.js'
import { installPluginFaultBoundary } from './contract/fault-registry.js'

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

/** Clamp a numeric query parameter. */
function clamp(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(Math.max(Math.trunc(number), min), max)
}

/**
 * The origin the client used to reach this server.
 *
 * The plugin's route runs inside the host process, so the host's own API is
 * one request away - but only when the address of the server is known. The
 * Host header of the request carries it.
 *
 * @param {any} req the incoming request
 * @returns {string} the origin, '' when the request carries no host
 */
function originOf(req) {
  const host = req?.headers?.host
  if (typeof host !== 'string' || host === '') return ''
  const forwarded = req?.headers?.['x-forwarded-proto']
  const protocol = typeof forwarded === 'string' && forwarded !== '' ? forwarded : 'http'
  return `${protocol}://${host}`
}

/**
 * Mount the plugin.
 * @param {any} ctx cordis host context
 */
export function apply(ctx) {
  // Which profile this process really serves. `DSH_PROFILE_DIR` is inherited
  // from the shell that launched the app, so a DSH booted from another DSH's
  // terminal carries the wrong one; the profileContext service is the truth.
  // Recorded before the settings store can write, and before any route reads
  // the document (PRD-v6 enhancement: the settings must never land in the
  // profile of a different instance).
  setProfileBase(ctx.get?.('profileContext')?.dir ?? '')
  // The store takes the context: a settings document that cannot be written
  // has to leave a trace in the log of the plugin (review R3).
  const settings = new SettingsStore(ctx)
  /** Live terminal handles by session id, for the activity endpoint and unload. */
  const terminals = new Map()

  /**
   * The root of the project the user is working in.
   *
   * The core knows two roots: the workspace root (the DSH workspace the
   * client opened) and the project root (the folder of that workspace the
   * user picked as the IDE project). Both live in the settings document:
   * `lastRoot` is the workspace, `projectRoots[workspace]` is the project.
   *
   * @type {string}
   */
  let projectRoot = ''

  /**
   * The listeners that want to know when the project root changes.
   *
   * @type {Set<(root: string) => void>}
   */
  const projectListeners = new Set()

  /**
   * The project root of a settings document.
   *
   * @param {any} document the settings document
   * @returns {string} the absolute project root, '' when there is none
   */
  function projectRootOf(document) {
    if (document === null || typeof document !== 'object') return ''
    const workspaceRoot = typeof document.lastRoot === 'string' ? document.lastRoot : ''
    if (workspaceRoot === '') return ''
    const selected = document.projectRoots?.[workspaceRoot]
    return typeof selected === 'string' && selected !== '' ? selected : workspaceRoot
  }

  /**
   * Read the settings document and publish a changed project root.
   *
   * The document is the only place the core hears about a project change:
   * the client writes the settings when the user picks another project, and
   * the host reads them.
   *
   * @returns {Promise<string>} the project root
   */
  async function refreshProjectRoot() {
    const document = await settings.get()
    const root = projectRootOf(document)
    if (samePath(root, projectRoot)) return projectRoot
    projectRoot = root
    for (const listener of projectListeners) {
      try {
        listener(projectRoot)
      } catch (error) {
        ctx.logger?.warn?.(
          'dsh-ide-workbench: a listener of the project change failed: %s',
          error instanceof Error ? error.message : String(error),
        )
      }
    }
    return projectRoot
  }

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

  /**
   * Forward one request to the host's own review API.
   *
   * The data of a conversation turn lives in the host, and the host serves it
   * on its own origin (`/api/changes.summary`, `/api/changes.diff`). The
   * client of the workbench cannot always reach that origin itself, so the
   * plugin's own route forwards the request inside the host process - with the
   * credentials of the caller, so the host's fence sees the same client.
   *
   * The document is passed through unchanged: the plugin does not interpret
   * the turn, it only carries the request to the place where the turn is.
   *
   * @param {{ origin?: string, headers?: Record<string, string> }} request the
   *   context of the incoming request
   * @param {'summary' | 'diff'} kind the document to read
   * @param {any} payload the coordinates of the turn
   * @returns {Promise<unknown>} the document of the host
   */
  async function forwardHostChanges(request, kind, payload) {
    const origin = typeof request?.origin === 'string' ? request.origin : ''
    if (origin === '') throw new ApiError('unavailable', 'the origin of the host is unknown', 503)
    const query = new URLSearchParams()
    for (const key of ['sessionId', 'seq', 'turn', 'index', 'path']) {
      const value = payload?.[key]
      if (value === undefined || value === null || value === '') continue
      query.set(key, String(value))
    }
    const headers = { accept: 'application/json' }
    for (const name of ['cookie', 'authorization']) {
      const value = request?.headers?.[name]
      if (typeof value === 'string' && value !== '') headers[name] = value
    }
    let response
    try {
      response = await fetch(`${origin}/api/changes.${kind}?${query.toString()}`, { method: 'GET', headers })
    } catch (error) {
      throw new ApiError(
        'unavailable',
        `the host did not answer: ${error instanceof Error ? error.message : String(error)}`,
        503,
      )
    }
    const text = await response.text()
    if (!response.ok) {
      // A turn that is gone answers 404: the client reads that as "expired"
      // and hands the link back to the host's own review tab.
      throw new ApiError(
        response.status === 404 ? 'not-found' : 'http',
        `the host answered ${response.status}`,
        response.status === 404 ? 404 : 502,
      )
    }
    try {
      return JSON.parse(text)
    } catch {
      throw new ApiError('http', 'the host answered with a document that is not JSON', 502)
    }
  }

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
      return listProjectCandidates(root)
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
      // The ignored entries are always asked for - the client setting only
      // decides whether they are shown - and the per-file line counts are
      // only computed for the Commit window.
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

    /** Annotate one file: the commit of every line of its worktree version. */
    'git.blame': async (payload) => {
      const env = await repoEnv(payload)
      const path = toRepoPath(env, requireString(payload, 'path'))
      return gitBlame(env, path)
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

    // ── the review of a chat turn ─────────────────────────────────────────
    'changes.summary': async (payload, request) => forwardHostChanges(request, 'summary', payload),
    'changes.diff': async (payload, request) => forwardHostChanges(request, 'diff', payload),

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
      await refreshProjectRoot()
      return { value }
    },

  }

  // ── the host service of the contract ───────────────────────────────────
  /**
   * The host service other plugins read (PRD-v6 §3.2).
   *
   * The service is generic: it knows the project the user is working in and
   * the files of that project - nothing about the plugin that consumes it. A
   * consumer reads it with `ctx.get(HOST_SERVICE)` and uses what it needs;
   * the core does not know who that is, and does not have to.
   *
   * @type {import('./contract/host-api.d.ts').WorkbenchHostApi}
   */
  const hostApi = {
    version: CONTRACT_VERSION,

    /**
     * The root of the project the user is working in.
     *
     * @returns {string} the absolute root, '' when no project is open
     */
    getProjectRoot: () => projectRoot,

    /**
     * The root of the scope the core serves.
     *
     * The core knows no scope that is narrower than the project: the scope
     * root is the project root. A plugin that works in a narrower range (an
     * index of a part of the project, for instance) keeps that range to
     * itself.
     *
     * @returns {string} the absolute root, '' when no project is open
     */
    getScopeRoot: () => projectRoot,

    /**
     * Read one file of the project.
     *
     * The path has to be inside the project: a path outside it is refused,
     * exactly as the file routes of the workbench refuse it.
     *
     * @param {string} absolutePath the absolute path of the file
     * @returns {Promise<string>} the content of the file
     */
    readFile: async (absolutePath) => {
      const root = await canonicalRoot(projectRoot)
      const file = await readFileForPreview(root, absolutePath)
      if (file.kind !== 'text') throw new ApiError('bad-request', 'not a text file')
      return file.content
    },

    /**
     * Search the files of the project for a piece of text.
     *
     * The engine is the one of the workbench - the same one the Find in
     * Files window uses, with the same limits.
     *
     * @param {{query: string, caseSensitive?: boolean, wholeWord?: boolean, regexp?: boolean, limit?: number}} options the search
     * @returns {Promise<{files: object[], truncated: boolean}>} the hits, grouped by file
     */
    searchFiles: async (options) => {
      const root = await canonicalRoot(projectRoot)
      const result = await api['fs.search']({
        root,
        query: typeof options?.query === 'string' ? options.query : '',
        caseSensitive: options?.caseSensitive === true,
        wholeWord: options?.wholeWord === true,
        regexp: options?.regexp === true,
        maxResults: Number.isSafeInteger(options?.limit) ? options.limit : undefined,
      })
      return {
        files: (result.files ?? []).map(file => ({
          path: file.path,
          hits: (file.matches ?? []).map(hit => ({
            line: hit.line,
            column: hit.column,
            text: hit.preview,
            before: hit.before,
            after: hit.after,
            binary: hit.binary === true,
          })),
        })),
        truncated: result.truncated === true,
      }
    },

    /**
     * Subscribe to the changes of the project root.
     *
     * @param {(root: string) => void} cb the listener
     * @returns {() => void} the unsubscribe
     */
    onProjectChanged: (cb) => {
      if (typeof cb !== 'function') return () => {}
      projectListeners.add(cb)
      return () => { projectListeners.delete(cb) }
    },

    /**
     * The health of the core.
     *
     * @returns {{ok: boolean}} the health
     */
    health: () => ({ ok: true }),
  }
  ctx.provide(HOST_SERVICE, hostApi)

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
        // The settings document holds the project the client is working in:
        // a consumer of the host service has to see it.
        await refreshProjectRoot()
        const payload = await readJsonBody(req)
        const handler = Object.hasOwn(api, method) ? api[method] : undefined
        if (typeof handler !== 'function') throw new ApiError('not-found', `unknown API method "${method}"`, 404)
        // The context of the request travels with the payload: a method that
        // forwards to the host itself (the review of a chat turn) needs the
        // origin of the server and the credentials of the caller.
        const result = await handler(payload, { origin: originOf(req), headers: req?.headers })
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

  // ── error boundary ─────────────────────────────────────────────────────
  // A broken feature must never take the whole IDE down with it. The
  // boundary is an effect, so it goes away with the plugin and leaves no
  // listener behind in the host.
  //
  // The boundary itself is the one of the contract: there is exactly one
  // handler for `uncaughtException` in the process, and every plugin of the
  // family claims the faults of its own sources through the registry. The
  // core claims the directory of its own sources - a fault of the core is
  // contained, a fault of the host stays the business of the host.
  ctx.effect(() => installPluginFaultBoundary(ctx, PLUGIN_DIR, (error) => {
    // A fault of the core is contained: the feature that broke is lost, the
    // IDE keeps running. There is nothing else to do - the core has no
    // session of its own to degrade.
    ctx.logger?.error?.(
      'dsh-ide-workbench: contained a fault of the core: %s',
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    )
  }), 'dsh-ide-workbench: error boundary')

  // ── teardown ───────────────────────────────────────────────────────────
  ctx.effect(() => () => {
    for (const client of wss.clients) client.close()
    wss.close()
    for (const [id, handle] of terminals) {
      terminals.delete(id)
      void handle.terminate().catch(() => {})
    }
  }, 'dsh-ide-workbench: teardown')

  ctx.effect(() => {
    // The project root is read once at the start, so that a consumer of the
    // host service gets an answer before the first request comes in.
    void refreshProjectRoot()
    return () => {}
  }, 'dsh-ide-workbench: project root')

  ctx.effect(() => {
    ctx.logger?.info?.('dsh-ide-workbench ready (API %s, terminal %s)', API_PREFIX, WS_PATH)
    return () => {}
  }, 'dsh-ide-workbench: announce')
}
