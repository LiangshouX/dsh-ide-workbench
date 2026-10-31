/**
 * The requests that count as *semantic* requests.
 *
 * The module is deliberately free of any import: the host reads it, and the
 * client reads it too. The two sides have to agree on ONE definition of
 * "an answer that says something about the semantic features", because they
 * use it for the same decision:
 *
 *   - the **client** counts only the failures of these requests (a document
 *     that cannot be synced says nothing about the features), and
 *   - the **host** counts only the answers to these requests before it
 *     tightens the request budget.
 *
 * Two copies of the list would drift apart (the day someone enables the
 * formatting or the renaming of the library, the host would tighten the
 * budget while the client still waits - and the host would kill the very
 * server the client is waiting for). One shared list makes that impossible.
 *
 * The list is not "every request the plugin sends": the handshake, the
 * document synchronization and the commands of the workspace are answered as
 * well, but they say nothing about the semantic features and they are fast.
 */
export const SEMANTIC_METHODS = new Set([
  'textDocument/references',
  'textDocument/definition',
  'textDocument/declaration',
  'textDocument/typeDefinition',
  'textDocument/implementation',
  'textDocument/hover',
  'textDocument/completion',
  'textDocument/signatureHelp',
])
