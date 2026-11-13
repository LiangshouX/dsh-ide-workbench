/**
 * Handing one chat file link back to DSH's own right Sidebar - and the
 * lifetime of the carrier tab that carried it there.
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
 *
 * The carrier tab is the tab the host created for the address; the plugin
 * replaces it with the IDE page tab (or with the default viewer). The host
 * only replaces it when the target tab does not exist yet: when it does, the
 * host focuses the target and LEAVES the carrier alive. A carrier that stays
 * alive is stuck on "Loading…" and swallows the next click of the same link
 * (the host deduplicates by content id), so the fate of the carrier has to be
 * decided by the plugin: replaced by the host, or closed by the plugin.
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
 * The carrier tab in the layout, when it is still there.
 *
 * The host replaces a carrier tab only when the target page tab does not
 * exist yet; when it does, the host focuses it and leaves the carrier alive.
 * The carrier therefore has to be LOOKED UP, never assumed: `openTabs` is the
 * inventory of the layout, and the active tab is the fallback for a host that
 * publishes no inventory.
 *
 * @param {any} ctx client cordis context
 * @param {string} tabId the id of the carrier tab
 * @param {{ contentId?: string, kind?: string }} [options] the carrier's own
 *   content id and kind - the host deduplicates by content id, so a carrier
 *   that is not found by its id is still found by them
 * @returns {object | null | undefined} the tab of the layout, null when the
 *   carrier is gone, undefined when the host publishes no inventory at all
 */
export function findCarrierTab(ctx, tabId, options = {}) {
  const sidebar = serviceOf(ctx, 'sidebarRight')
  let inventory
  try {
    inventory = sidebar?.openTabs?.getSnapshot?.()
  } catch {
    inventory = undefined
  }
  if (Array.isArray(inventory)) {
    const byId = inventory.find(tab => tab?.id === tabId)
    if (byId !== undefined) return byId
    const contentId = options.contentId
    if (typeof contentId === 'string' && contentId !== '') {
      // The carrier of the IDE carries the address as its content id; the
      // default viewer of the same address has another kind, so it is not
      // the carrier and must not be closed.
      return inventory.find(tab => tab?.contentId === contentId && tab?.kind === options.kind) ?? null
    }
    return null
  }
  // No inventory: the active tab is the only evidence there is.
  try {
    const active = sidebar?.active?.()
    if (active !== undefined && active !== null) return active.id === tabId ? active : null
  } catch {
    // A host without an active tab tells nothing.
  }
  return undefined
}

/**
 * Whether one carrier tab is still part of the sidebar layout.
 *
 * @param {any} ctx client cordis context
 * @param {string} tabId the id of the carrier tab
 * @param {{ contentId?: string, kind?: string }} [options] the carrier's own
 *   content id and kind
 * @returns {boolean | null} true when the carrier is still there, false when
 *   it is gone, null when the host publishes no inventory at all
 */
export function carrierTabAlive(ctx, tabId, options = {}) {
  const tab = findCarrierTab(ctx, tabId, options)
  if (tab === undefined) return null
  return tab !== null
}

/**
 * Close one carrier tab that survived an open.
 *
 * A double close is not an error: the host may have removed the tab already
 * (it replaced the carrier), and a close of an unknown id is a no-op. The
 * call is wrapped so that a host that throws on an unknown id cannot break
 * the plugin.
 *
 * @param {any} ctx client cordis context
 * @param {string} tabId the id of the carrier tab
 * @param {{ contentId?: string, kind?: string }} [options] the carrier's own
 *   content id and kind
 * @returns {{ closed: boolean, error?: unknown }} `closed` is true when the
 *   carrier is gone afterwards; `error` carries the failure of the host
 */
export function closeCarrierTab(ctx, tabId, options = {}) {
  const sidebar = serviceOf(ctx, 'sidebarRight')
  if (typeof sidebar?.close !== 'function') return { closed: false }
  // The tab of the layout is closed by ITS id: the id the caller knows may
  // not be the one the layout holds.
  const tab = findCarrierTab(ctx, tabId, options)
  const target = tab !== undefined && tab !== null && typeof tab.id === 'string' ? tab.id : tabId
  try {
    sidebar.close(target)
  } catch (error) {
    // The layout owns the tab: a carrier the host already removed is gone.
    return { closed: carrierTabAlive(ctx, tabId, options) !== true, error }
  }
  return { closed: carrierTabAlive(ctx, tabId, options) !== true }
}

/**
 * Replace the carrier tab with the IDE page tab and decide the carrier's fate.
 *
 * The host performs the replacement only when the IDE page tab does not
 * exist yet. When it does, the host focuses that tab and leaves the carrier
 * alive - which is what left a tab stuck on "Loading…" and swallowed the next
 * click of the same link. The plugin therefore verifies the fate of the
 * carrier after the open and closes it when the host did not replace it.
 *
 * @param {any} ctx client cordis context
 * @param {string} tabId the id of the carrier tab
 * @param {{ kind?: string, contentId?: string }} [options] `kind` is the tab
 *   type of the IDE (the page tab), `contentId` the address of the carrier
 * @returns {{ ok: boolean, fate: 'replaced' | 'closed' | 'unknown', error?: unknown }}
 *   `ok` is true when the carrier is gone - replaced by the host or closed by
 *   the plugin; the two are the only acceptable fates.
 */
export function replaceCarrierTab(ctx, tabId, options = {}) {
  const sidebar = serviceOf(ctx, 'sidebarRight')
  const kind = typeof options.kind === 'string' && options.kind !== '' ? options.kind : 'ide-workbench'
  try {
    sidebar.openTab(kind, { replaceTab: tabId })
  } catch (error) {
    return { ok: false, fate: 'unknown', error }
  }
  const alive = carrierTabAlive(ctx, tabId, { ...options, kind })
  if (alive === false) return { ok: true, fate: 'replaced' }
  if (alive === null) return { ok: false, fate: 'unknown' }
  // The host did not replace the carrier (the target page tab was already
  // there): the plugin closes it, so the fate of the tab is decided.
  const closed = closeCarrierTab(ctx, tabId, { ...options, kind })
  if (closed.closed === true) return { ok: true, fate: 'closed' }
  return { ok: false, fate: 'unknown', error: closed.error }
}

/**
 * Open one file address through DSH's own sidebar instead of the IDE.
 *
 * @param {any} ctx client cordis context
 * @param {string} address the `dsh-resource://file/…` address
 * @param {{
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
  // The carrier of this link: it must not survive the open, whatever the
  // host did with it.
  const carrier = options.replaceTab === undefined
    ? {}
    : { contentId: address, kind: options.ownKind }
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
      if (options.replaceTab !== undefined) closeCarrierTab(ctx, options.replaceTab, carrier)
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
    if (options.replaceTab !== undefined) closeCarrierTab(ctx, options.replaceTab, carrier)
    return true
  } catch {
    return false
  } finally {
    if (typeof release === 'function') release()
  }
}
