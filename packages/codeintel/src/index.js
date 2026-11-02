/**
 * dsh-ide-codeintel — Host half.
 *
 * The code intelligence plugin owns everything that talks to a language
 * server: the processes, the state machine, the memory budget and the
 * semantic requests. It is a plugin of its own (PRD-v6), and it mounts its
 * OWN surface:
 *
 *   HTTP      POST /dsh-codeintel/api/<method>   (the `lsp.*` methods)
 *   WebSocket      /dsh-codeintel/ws/lsp         (the browser ⇄ server relay)
 *
 * The routes of the IDE workbench (`/ide-workbench/api/…`) belong to the
 * workbench: the two plugins share the fence of the host, not the routes.
 *
 * The plugin works on its own as far as it can: it reads and writes its own
 * settings document, it starts and stops its own language servers, and it
 * contains its own faults. What it cannot do without the workbench is to
 * serve the editor - and it says so instead of failing (DEG-01).
 */
import { dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LspManager, shutdownAll } from './host/lsp.js'
import { registerLspWebSocket, shutdownLspWebSocket } from './host/lsp-ws.js'
import { SettingsStore, knownRootsOfSettings, settingsFile } from './host/settings-store.js'
import { ApiError, readJsonBody, writeError, writeOk } from './host/wire.js'
import { installPluginFaultBoundary } from './contract/fault-registry.js'
import { CONTRACT_VERSION, HOST_SERVICE } from './contract/index.js'

export const name = 'dsh-ide-codeintel'

/** Services the host half needs before it can mount. */
export const inject = ['webServer', 'connection', 'subprocess', 'workspaceRegistry']

/** The prefix of the JSON API of the plugin. */
export const API_PREFIX = '/dsh-codeintel/api/'

/** The path the JSON API is registered under (without the trailing slash). */
export const API_PATH = '/dsh-codeintel/api'

/**
 * The directory of the plugin's own sources.
 *
 * The error boundary has to tell "an error of this plugin" from "an error of
 * the host", and a stack trace is the only evidence it has. The plugin's own
 * directory is the precise marker: the path of the plugin is part of the
 * stack of every frame of its own code, and of no other.
 */
export const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url)).split(sep).join('/')

/**
 * The service of the IDE workbench, if it is installed.
 *
 * The lookup is SOFT on purpose (PRD-v6 §3.2): a hard `inject: [HOST_SERVICE]`
 * would keep the plugin from ever being applied when the workbench is
 * missing - and then the user would not even see the guidance that says so.
 * @param {any} ctx the cordis host context
 * @returns {any} the service of the workbench, or undefined
 */
function coreOf(ctx) {
  try {
    return ctx.get?.(HOST_SERVICE)
  } catch {
    // A host whose service lookup is strict would throw here; the plugin
    // treats that as "the workbench is not installed".
    return undefined
  }
}

/**
 * How the contract of the workbench compares with the one of this plugin.
 *
 * The contract only knows major versions: an equal version is the normal
 * case, a newer workbench brings capabilities this plugin does not know yet
 * (they are simply not used), and an OLDER workbench cannot be talked to -
 * the plugin refuses to work and says so.
 *
 * @param {any} core the service of the workbench
 * @returns {'ok' | 'newer' | 'older'} the state of the handshake
 */
function contractStateOf(core) {
  const version = Number.isFinite(core?.version) ? core.version : 0
  if (version === CONTRACT_VERSION) return 'ok'
  if (version > CONTRACT_VERSION) return 'newer'
  return 'older'
}

/**
 * Mount the plugin.
 * @param {any} ctx cordis host context
 */
export function apply(ctx) {
  // The store takes the context: a settings document that cannot be written
  // has to leave a trace in the log of the plugin.
  const settings = new SettingsStore(ctx)
  /** The fence of the host: the same check every route of every plugin uses. */
  const fence = (req) => ctx.connection.requestRejection(req) === undefined
  /** The language server surface, once the workbench is there. */
  let surface = null

  // ── error boundary ─────────────────────────────────────────────────────
  // The codeintel owns its own sources: an uncaught exception of this plugin
  // must not kill the DSH host and must not disturb the workbench
  // (PRD-v6 §3.7, acceptance I1/I8). The boundary of the process is shared
  // (there is exactly one `uncaughtException` handler), and the registry
  // decides who owns a fault.
  //
  // The claim of the directory and the boundary of the process belong
  // together: their lifetimes are entangled, and the contract keeps that rule
  // in ONE place - the plugin that mounts first must not take the boundary
  // away while the other plugin is still mounted (it would lose its boundary,
  // and its faults would end the host).
  ctx.effect(() => installPluginFaultBoundary(ctx, PLUGIN_DIR, (error) => {
    // Every fault of this plugin belongs to the language servers: the
    // plugin has nothing else. The sessions are degraded, so the status bar
    // does not keep saying "ready".
    degradeSessions(error)
  }), 'dsh-ide-codeintel: error boundary')

  /**
   * Degrade every language server session of this plugin.
   *
   * The pipe of a language server is broken, so its session is not usable any
   * more and the status bar must not keep saying "ready". The crash handler
   * of the manager deals with the rest.
   * @param {unknown} error the fault that was contained
   */
  function degradeSessions(error) {
    if (surface === null) return
    const states = surface.manager.liveStates()
    const roots = states instanceof Map ? [...states.keys()] : Object.keys(states ?? {})
    for (const root of roots) {
      try {
        surface.manager.transition(root, 'degraded', 'the language server reported a broken pipe')
      } catch {
        /* not every state may be degraded */
      }
    }
    ctx.logger?.error?.('dsh-ide-codeintel: contained a fault of the plugin: %s', error instanceof Error ? (error.stack ?? error.message) : String(error))
  }

  /**
   * Mount the language server surface: the JSON API, the relay and the
   * manager that owns the processes.
   * @param {any} core the service of the workbench
   * @returns {object} the mounted surface
   */
  const mountSurface = (core) => {
    const state = contractStateOf(core)
    if (state === 'older') {
      // The workbench is too old for this plugin: the user is told to update
      // it, and nothing is mounted (PRD-v6 §2, the version negotiation).
      ctx.logger?.error?.(
        'dsh-ide-codeintel: the IDE workbench plugin speaks contract %s, this plugin needs %s - please update the IDE workbench plugin',
        core?.version,
        CONTRACT_VERSION,
      )
      return null
    }
    if (state === 'newer') {
      ctx.logger?.warn?.(
        'dsh-ide-codeintel: the IDE workbench plugin speaks contract %s, this plugin speaks %s - the capabilities of the newer version are not used',
        core?.version,
        CONTRACT_VERSION,
      )
    }

    /**
     * The language server manager.
     *
     * It owns the process lifecycle, the state machine and the memory
     * pre-check; the client only ever reads the state it publishes. The
     * "indexed roots" fact lives in the settings document OF THIS PLUGIN,
     * so the badge of the project picker survives a restart.
     */
    const manager = new LspManager({
      ctx,
      getSettings: async () => settings.get(),
      persistIndexedRoots: async (indexedRoots) => {
        await settings.update({ lsp: { indexedRoots } })
      },
    })

    /**
     * The root of the project the user is working in.
     *
     * The codeintel has no project of its own: the project of the workbench
     * IS the project of the user (PRD-v6 §3.2). The service is read through
     * a guard, because a host that is busy may answer with a wrong value -
     * and a wrong root is worse than no root at all.
     * @returns {string} the absolute root, or '' when there is none
     */
    const projectRoot = () => {
      try {
        const root = core?.getProjectRoot?.()
        return typeof root === 'string' ? root : ''
      } catch {
        return ''
      }
    }

    /**
     * The root of one request: the one the request names, or the project of
     * the workbench.
     *
     * The client names the root of every request it makes; the fallback is
     * for the requests that do not (a status poll of a project that was
     * opened before the client knew its root).
     * @param {any} payload the body of the request
     * @returns {string} the root, or '' when there is none
     */
    const rootOf = (payload) => {
      const requested = payload?.root
      if (typeof requested === 'string' && requested.trim() !== '') return requested
      return projectRoot()
    }

    /**
     * The root of one request that cannot do without one.
     * @param {any} payload the body of the request
     * @returns {string} the absolute root
     */
    const requiredRootOf = (payload) => {
      const root = rootOf(payload)
      if (root === '') throw new ApiError('bad-request', 'the request needs a project root')
      return root
    }

    /** All API methods of the plugin. */
    const api = {
      // ── semantic analysis (PRD-v5 §3.1) ─────────────────────────────────
      'lsp.status': async (payload) => manager.status({
        root: rootOf(payload) || undefined,
      }),

      'lsp.index': async (payload) => manager.index({ root: requiredRootOf(payload) }),

      'lsp.start': async (payload) => manager.start({
        root: requiredRootOf(payload),
        languageId: typeof payload?.languageId === 'string' ? payload.languageId : undefined,
        // The user answered the memory question and asked for the server
        // anyway: the host skips the TIGHT band of its memory pre-check then
        // (PRD §2.3). The hard floor is never skipped - a machine that cannot
        // run the server does not run it with `force` either (review P2-3).
        force: payload?.force === true,
      }),

      'lsp.cancelIndex': async (payload) => manager.cancelIndex({ root: requiredRootOf(payload) }),

      /**
       * Restart the language server of one root.
       *
       * The server is stopped and started again, so its index is built from
       * scratch - that is the price of the way out of a broken session. The
       * start is NOT forced: a machine that cannot hold the server does not
       * get one behind the user's back.
       */
      'lsp.restart': async (payload) => {
        const root = requiredRootOf(payload)
        await manager.shutdown({ root })
        return manager.start({ root })
      },

      'lsp.servers': async () => manager.servers({}),

      'lsp.resources': async (payload) => manager.resources({
        root: rootOf(payload) || undefined,
        // The language the client is ABOUT to start: the memory prompt and the
        // start must judge the same language, or the prompt says "ok" for the
        // TypeScript baseline and the start then refuses with the Java one.
        languageId: typeof payload?.languageId === 'string' ? payload.languageId : undefined,
      }),

      /**
       * The scope root the client has to put into the `rootUri` of its
       * handshake (PRD-v5 §4.2).
       *
       * The client asks for it *before* it starts a session: the `rootUri` of
       * the `initialize` request is what tells the language server which
       * project it is looking at - the working directory of its process does
       * not. The answer must be the one the HOST would use, including the
       * pinned language of the root and a running session: two independent
       * rules would tell the server to build the program of one sub-project
       * while its cwd is another one.
       */
      'lsp.scope': async (payload) => manager.scope({
        root: requiredRootOf(payload),
        languageId: typeof payload?.languageId === 'string' ? payload.languageId : undefined,
      }),

      'lsp.shutdown': async (payload) => manager.shutdown({
        root: rootOf(payload) || undefined,
      }),

      /**
       * The root the user is looking at (PRD-v5.1 §4.4, CONC-03).
       *
       * The host cannot see the focus of the browser: it knows which roots have
       * a language server, but not which one the user is working in. The LRU
       * order of the memory pressure yield needs that fact - the focused root
       * is one of the last to go, because yielding it interrupts the user.
       *
       * The client reports it whenever the editor moves; the host remembers the
       * last one it was told about. An empty root means "no focus" - the LRU
       * order then treats every root the same.
       */
      'lsp.focus': async (payload) => {
        // An empty root means "no focus" - the LRU order then treats every
        // root the same. A request that names no root at all is about the
        // project of the workbench, so it is not an empty root.
        const root = typeof payload?.root === 'string' ? payload.root : projectRoot()
        return manager.setFocus(root)
      },

      /** The stderr of the language server, for the status bar's log link. */
      'lsp.logs': async (payload) => manager.logs({
        root: rootOf(payload) || undefined,
      }),

      /**
       * The roots that completed a first build.
       *
       * The map outlives the process (it lives in the settings document), so
       * the badge of the project picker survives a restart of DSH. Every
       * entry carries the flag `running`, which the host knows and the
       * document does not.
       */
      'lsp.indexedRoots': async () => manager.indexedRoots(),

      // ── settings of this plugin ──────────────────────────────────────────
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
    }

    // ── JSON API route ───────────────────────────────────────────────────
    ctx.effect(() => ctx.webServer.register({
      kind: 'prefix',
      path: API_PATH,
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
    }), 'dsh-ide-codeintel: JSON API')

    // ── Language Server WebSocket ─────────────────────────────────────────
    // A separate path from every other socket: the LSP frames are raw JSON
    // and must never share a connection with another stream.
    // The effect has to hand back a disposer function: Cordis rejects an
    // effect that returns a plain object with "TypeError: Invalid effect",
    // and the whole plugin then fails to activate.
    ctx.effect(() => {
      const relay = registerLspWebSocket(ctx, { manager, fence })
      return () => relay.close()
    }, 'dsh-ide-codeintel: LSP WebSocket')

    return { manager }
  }

  const core = coreOf(ctx)
  if (core === undefined) {
    // ── degraded mode (DEG-01 / DEG-02) ──────────────────────────────────
    // The workbench is not installed (yet). The plugin does not throw and it
    // mounts no language server route: a client that asks for one would get
    // an answer it cannot use, and no server may be started for a project
    // nobody opened.
    ctx.logger?.warn?.(
      'dsh-ide-codeintel: the IDE workbench plugin is not installed - the code intelligence stays switched off (degraded mode)',
    )
    ctx.effect(() => {
      // The workbench may be loaded AFTER this plugin: the service is looked
      // up again for a while, and the surface is mounted as soon as it is
      // there. Without this the load order would decide whether the code
      // intelligence works at all.
      const timer = setInterval(() => {
        const found = coreOf(ctx)
        if (found === undefined) return
        clearInterval(timer)
        surface = mountSurface(found)
        ctx.logger?.info?.('dsh-ide-codeintel: the IDE workbench plugin appeared - the language servers are available')
      }, 1000)
      // The timer may not keep the host alive.
      timer.unref?.()
      return () => clearInterval(timer)
    }, 'dsh-ide-codeintel: deferred mount')
  } else {
    surface = mountSurface(core)
  }

  // ── teardown ───────────────────────────────────────────────────────────
  // The language servers and their relay belong to THIS plugin (ISO-03): the
  // teardown of the workbench knows nothing about them, and the teardown of
  // this plugin is the only place where they are stopped.
  ctx.effect(() => () => {
    shutdownLspWebSocket()
    if (surface !== null) {
      shutdownAll({ knownRoots: knownRootsOfSettings(settings) })
      surface = null
    }
  }, 'dsh-ide-codeintel: teardown')

  ctx.effect(() => {
    ctx.logger?.info?.('dsh-ide-codeintel ready (API %s)', API_PREFIX)
    return () => {}
  }, 'dsh-ide-codeintel: announce')
}
