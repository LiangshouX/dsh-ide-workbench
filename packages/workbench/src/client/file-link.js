/**
 * Handing one chat file link back to DSH's own right Sidebar.
 *
 * The IDE claims `dsh-resource://file/…` links through the tab registry, so
 * when it cannot open a file (outside the workspace, or the user declined to
 * widen the IDE project) the link must be re-opened by the type the registry
 * would have chosen without the IDE. `candidates()` exposes that ranking;
 * naming the winning non-IDE kind through `openResource(address, { kind })`
 * skips the IDE claim without touching the registry.
 *
 * Older hosts may not publish `candidates()`. The fallback then asks the tab
 * type's own `canOpen` to decline this one address while the default open runs
 * synchronously, which reproduces the same ranking without a public probe.
 */

/** Resolve one service from the client context, tolerating a stripped host. */
function serviceOf(ctx, key) {
  try {
    const service = ctx?.get?.(key)
    if (service !== undefined && service !== null) return service
  } catch {
    // `ctx.get` may reject unknown keys on some hosts.
  }
  return ctx?.[key]
}

/**
 * The kind the registry would open for `address` besides the IDE itself.
 * @param {any} ctx client cordis context
 * @param {string} address the `dsh-resource://file/…` address
 * @param {string} ownKind the IDE tab kind to skip
 * @returns {string | undefined} `undefined` when no ranking is published or
 *   the IDE is the only candidate
 */
export function defaultSidebarKind(ctx, address, ownKind) {
  try {
    const tabs = serviceOf(ctx, 'sidebarRightTabs')
    if (typeof tabs?.candidates !== 'function') return undefined
    const candidates = tabs.candidates(address)
    if (!Array.isArray(candidates)) return undefined
    for (const candidate of candidates) {
      if (typeof candidate?.kind === 'string' && candidate.kind !== ownKind) return candidate.kind
    }
  } catch {
    // The probe is best-effort by contract: a missing registry is not fatal.
  }
  return undefined
}

/**
 * Open one file address through DSH's own sidebar instead of the IDE.
 *
 * @param {any} ctx client cordis context
 * @param {string} address the `dsh-resource://file/…` address
 * @param {{
 *   ownKind?: string,
 *   ownKind?: string,
 *   kind?: string,
 *   line?: number,
 *   replaceTab?: string,
 *   suppressSelf?: () => (() => void),
 * }} [options] `kind` names a specific DSH viewer (for example the built-in
 *   `text` document preview); `replaceTab` swaps this link's carrier tab for
 *   the default viewer; `suppressSelf` temporarily makes the IDE decline the
 *   address when no candidate ranking is available
 * @returns {boolean} true when the default sidebar accepted the open
 */
export function openInDefaultSidebar(ctx, address, options = {}) {
  const sidebar = serviceOf(ctx, 'sidebarRight')
  if (typeof sidebar?.openResource !== 'function') return false
  const placement = {
    ...(options.line === undefined ? {} : { params: { line: options.line } }),
    revealIfOpened: true,
    ...(options.replaceTab === undefined ? {} : { replaceTab: options.replaceTab }),
  }
  // Try the explicitly named viewer first, then the registry's best non-IDE
  // candidate. A named type may not exist on every host, and a probed type may
  // refuse the address after the probe.
  const kinds = []
  if (typeof options.kind === 'string' && options.kind !== '') kinds.push(options.kind)
  const probed = defaultSidebarKind(ctx, address, options.ownKind)
  if (probed !== undefined && !kinds.includes(probed)) kinds.push(probed)
  for (const kind of kinds) {
    try {
      sidebar.openResource(address, { ...placement, kind })
      return true
    } catch {
      // Try the next candidate rather than surfacing a dead end.
    }
  }
  if (typeof options.suppressSelf !== 'function') return false
  let release
  try {
    release = options.suppressSelf()
    sidebar.openResource(address, placement)
    return true
  } catch {
    return false
  } finally {
    if (typeof release === 'function') release()
  }
}
