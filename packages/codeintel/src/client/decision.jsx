/**
 * The dialogs of the semantic analysis (PRD-v5 §2.3).
 *
 * Two questions reach the user:
 *
 *   - **the index decision**: "shall I build the index of this project?";
 *   - **the memory warning**: "the machine is tight - start anyway?".
 *
 * Both belong to the plugin: the core owns the project tree, but the index
 * of a project is the plugin's business (and the keys `index.decision.*`
 * are the plugin's).
 *
 * The dialogs are drawn by the plugin's own surfaces: the status item of
 * the plugin renders them, so they appear wherever the plugin is on the
 * screen.
 */
import React from 'react'
import { languageLabel } from './language-label.js'

/**
 * The dialog of the index decision.
 *
 * @param {{store: object, state: object}} props the store and its snapshot
 * @returns {React.ReactElement | null} the dialog
 */
export function IndexDecision({ store, state }) {
  const t = store.t
  const decision = state?.indexDecision ?? null
  if (decision === null) return null
  const button = (key, label, hint, onClick) => React.createElement('button', {
    key,
    type: 'button',
    className: 'iwb-textbtn iwb-index-decision-button',
    title: hint,
    onClick,
  }, label)
  return React.createElement('div', { className: 'iwb-modal-backdrop iwb-index-decision-backdrop' },
    React.createElement('div', { className: 'iwb-modal iwb-index-decision' },
      React.createElement('div', { className: 'iwb-modal-title' }, t('index.decision.title')),
      React.createElement('div', { className: 'iwb-modal-body' },
        React.createElement('div', null, t('index.decision.body')),
        decision.language === ''
          ? null
          // The host speaks language ids, the user reads names.
          : React.createElement('div', null, languageLabel(decision.language)),
        decision.isRepo === false
          ? React.createElement('div', { className: 'iwb-index-decision-warning' }, t('index.decision.rootWarning'))
          : null),
      React.createElement('div', { className: 'iwb-modal-actions' },
        button('build', t('index.decision.build'), t('index.decision.buildRoot'), () => { store.resolveIndexDecision('build') }),
        button('conservative', t('index.decision.conservative'), t('index.decision.conservativeHint'), () => { store.resolveIndexDecision('conservative') }),
        button('cancel', t('index.decision.cancel'), t('index.decision.cancelHint'), () => { store.resolveIndexDecision('cancel') }))))
}

/**
 * The dialog of the memory warning.
 *
 * @param {{store: object, state: object}} props the store and its snapshot
 * @returns {React.ReactElement | null} the dialog
 */
export function MemoryDecision({ store, state }) {
  const t = store.t
  const decision = state?.memoryDecision ?? null
  if (decision === null) return null
  const button = (key, label, hint, onClick) => React.createElement('button', {
    key,
    type: 'button',
    className: 'iwb-textbtn iwb-index-decision-button',
    title: hint,
    onClick,
  }, label)
  return React.createElement('div', { className: 'iwb-modal-backdrop iwb-index-decision-backdrop' },
    React.createElement('div', { className: 'iwb-modal iwb-index-decision' },
      React.createElement('div', { className: 'iwb-modal-title' }, t('lsp.memoryWarn.title')),
      React.createElement('div', { className: 'iwb-modal-body' },
        React.createElement('div', null, t('lsp.memoryWarn.body')),
        React.createElement('div', null, `${decision.needMB} MB / ${decision.freeMB} MB`)),
      React.createElement('div', { className: 'iwb-modal-actions' },
        button('start', t('lsp.memoryWarn.start'), '', () => { store.resolveMemoryDecision('start') }),
        button('conservative', t('lsp.memoryWarn.conservative'), t('lsp.memoryWarn.conservativeHint'), () => { store.resolveMemoryDecision('conservative') }))))
}
