/**
 * The contract bridge of the code intelligence plugin.
 *
 * The core renders this component in its `editorBridge` slot and hands it the
 * contract as a prop (PRD-v6 §3.2). The bridge is the ONLY place where the
 * plugin meets the editor of the core:
 *
 *   - the extensions are registered through `contract.editor.registerExtensions`
 *     (the three slots of the implementation contract §4.1);
 *   - the key bindings and the commands are registered through the two other
 *     methods of the seam;
 *   - the documents are read through `contract.editor.onDocument(...)`;
 *   - the session of the browser is started when the contract arrives and
 *     released when it goes away.
 *
 * The component renders nothing: it is a seam, not a surface.
 */
import React, { useEffect, useMemo } from 'react'
import { codeintelCommands, codeintelExtensionSlots, codeintelKeymap } from './extensions.js'
import { bindCodemirror } from './cm-runtime.js'
import { loadLspLibrary } from './lsp-lib.js'
import { configureLsp, lspSessionVersion } from './lsp-session.js'
import { storeOf } from './registry.js'

/**
 * The bridge of one session of the IDE workbench.
 *
 * @param {{contract: any, t?: (key: string) => string, onContract?: (contract: any) => void}} props
 *   the contract of the core, the translator of the plugin and the callback
 *   that tells the entry that the core is there
 * @returns {React.ReactElement} nothing at all
 */
export function CodeIntelBridge({ contract, t, onContract }) {
  const store = useMemo(() => storeOf(contract, t ?? (key => key)), [contract, t])

  useEffect(() => {
    if (store === null || store === undefined || contract === null || contract === undefined) return undefined
    // The core is there: the plugin is not degraded any more.
    onContract?.(contract)
    // The contract is the only channel to the core: the project root, the
    // documents and the files all come from it.
    store.attachContract(contract)
    void store.init()
    // The extensions are a PROVIDER: the core asks for them on every
    // refresh, so the semantic extensions appear as soon as the client
    // session exists.
    const extensions = contract.editor.registerExtensions(() => codeintelExtensionSlots())
    const offCommands = contract.editor.registerCommands(codeintelCommands(store))
    const offDocument = contract.editor.onDocument(document => { store.setDocument(document) })
    // The session of the browser belongs to the contract: it starts with it
    // and ends with it.
    //
    // The library of the language-server client needs the CodeMirror runtime
    // of the core, so it is loaded HERE - after the contract arrived, and
    // after the runtime was published (the contract carries it).
    bindCodemirror(contract.editor?.codemirror)
    /** The undo of the key bindings, once they were registered. */
    let offKeymap = null
    void loadLspLibrary().then(() => {
      // The semantic keys are bound after the library: `jumpToDefinition` and
      // `findReferences` belong to it.
      offKeymap = contract.editor.registerKeymap(codeintelKeymap())
      configureLsp(store)
      extensions.refresh()
    }, error => {
      console.warn('[codeintel] the client library could not be loaded:', error instanceof Error ? error.message : error)
    })
    // The semantic extensions are empty while there is no client, so the
    // editor has to be reconfigured when the session comes up.
    let version = lspSessionVersion()
    const unsubscribe = store.subscribe(() => {
      const next = lspSessionVersion()
      if (next === version) return
      version = next
      extensions.refresh()
    })
    return () => {
      unsubscribe()
      offDocument()
      offCommands()
      if (offKeymap !== null) offKeymap()
      extensions.dispose()
      store.detachContract()
    }
  }, [contract, store, onContract])

  return null
}
