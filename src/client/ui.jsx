/**
 * Small shared UI primitives: context menu, modal confirm, toast, shortcut
 * chip. All of them render inside the workbench root (no document.body
 * append), so theme tokens and stacking stay in one tree.
 */
import React, { useEffect, useRef, useState } from 'react'

/**
 * One floating context menu anchored at a viewport point.
 *
 * Items: `null` for a separator, `{ label }` for a section label, or
 * `{ key, text, shortcut, icon, action, disabled, danger, checked, submenu }`.
 * Shortcut strings are rendered right-aligned in grey — the single most
 * visible JetBrains/VS Code difference in a menu.
 */
export function ContextMenu({ x, y, items, onClose, depth = 0 }) {
  const ref = useRef(null)
  const [openIndex, setOpenIndex] = useState(-1)
  const [subAnchor, setSubAnchor] = useState(null)
  useEffect(() => {
    if (depth !== 0) return undefined
    const onDown = (event) => {
      if (ref.current !== null && !ref.current.contains(event.target)) onClose()
    }
    const onKey = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose, depth])
  const width = 264
  const estimated = items.reduce((total, item) => {
    if (item === null) return total + 9
    if (item.label !== undefined && item.action === undefined) return total + 22
    return total + 26
  }, 10)
  const hasWindow = typeof window !== 'undefined'
  const viewportWidth = hasWindow ? window.innerWidth : 1200
  const viewportHeight = hasWindow ? window.innerHeight : 800
  const anchoredLeft = depth === 0 ? Math.max(6, Math.min(x, viewportWidth - width - 8)) : x
  const anchoredTop = depth === 0 ? Math.max(6, Math.min(y, viewportHeight - estimated - 8)) : y
  const [position, setPosition] = useState({ left: anchoredLeft, top: anchoredTop })
  // The estimate above cannot know the real rendered height (fonts, icons,
  // separators). Re-measure after mount and pull the menu fully on screen.
  useEffect(() => {
    setPosition({ left: anchoredLeft, top: anchoredTop })
  }, [anchoredLeft, anchoredTop])
  useEffect(() => {
    if (!hasWindow || ref.current === null) return
    const rect = ref.current.getBoundingClientRect()
    const nextLeft = Math.max(6, Math.min(position.left, viewportWidth - rect.width - 6))
    const nextTop = Math.max(6, Math.min(position.top, viewportHeight - rect.height - 6))
    if (Math.round(nextLeft) !== Math.round(position.left) || Math.round(nextTop) !== Math.round(position.top)) {
      setPosition({ left: nextLeft, top: nextTop })
    }
  }, [position.left, position.top, viewportWidth, viewportHeight, hasWindow])
  return React.createElement('div', {
    ref,
    className: `iwb-menu ${depth === 0 ? 'iwb-menu-root' : 'iwb-menu-sub'}`,
    style: { left: `${position.left}px`, top: `${position.top}px`, minWidth: `${width}px` },
    onContextMenu: event => event.preventDefault(),
  }, items.map((item, index) => {
    if (item === null) return React.createElement('div', { key: `sep-${index}`, className: 'iwb-menu-sep' })
    if (item.label !== undefined && item.action === undefined) {
      return React.createElement('div', { key: `label-${index}`, className: 'iwb-menu-label' }, item.label)
    }
    const hasSubmenu = Array.isArray(item.submenu) && item.submenu.length > 0
    const open = hasSubmenu && openIndex === index
    const row = React.createElement('button', {
      key: item.key ?? `item-${index}`,
      type: 'button',
      className: `iwb-menu-item ${item.danger === true ? 'iwb-menu-danger' : ''}`,
      disabled: item.disabled === true,
      // A menu item may carry a tooltip: a greyed-out entry has to say *why*
      // it is greyed out, and the label itself is often too narrow for it.
      title: item.title,
      'aria-haspopup': hasSubmenu ? 'menu' : undefined,
      'aria-expanded': hasSubmenu ? open : undefined,
      onClick: () => {
        if (hasSubmenu) { setOpenIndex(open ? -1 : index); return }
        onClose()
        item.action?.()
      },
      onMouseEnter: (event) => {
        if (hasSubmenu) {
          const rect = event.currentTarget.getBoundingClientRect()
          const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1200
          const left = rect.right + 2 + width > viewportWidth
            ? Math.max(6, rect.left - width - 2)
            : rect.right + 2
          setSubAnchor({ x: left, y: rect.top - 5 })
          setOpenIndex(index)
        } else {
          setOpenIndex(-1)
        }
      },
    },
      React.createElement('span', { className: 'iwb-menu-check' }, item.checked === true ? '✓' : ''),
      React.createElement('span', { className: 'iwb-menu-icon' }, item.icon ?? null),
      React.createElement('span', { className: 'iwb-menu-text' }, item.text),
      React.createElement('span', { className: 'iwb-menu-shortcut' }, item.shortcut ?? ''),
      React.createElement('span', { className: 'iwb-menu-arrow' }, hasSubmenu ? '▸' : ''),
    )
    if (!hasSubmenu || !open || subAnchor === null) return row
    return React.createElement(React.Fragment, { key: `group-${index}` },
      row,
      React.createElement(ContextMenu, {
        x: subAnchor.x, y: subAnchor.y, items: item.submenu, onClose, depth: depth + 1,
      }),
    )
  }))
}

/**
 * Confirmation modal (danger actions always go through this).
 *
 * `scope` picks the centering base: the default centers on the workbench
 * root (top bar and status bar included), `editor` centers on the document
 * pane the dialog is rendered in.
 * @param {{dialog: object|null, onClose: Function, scope?: string|null}} props
 */
export function ConfirmModal({ dialog, onClose, scope = null }) {
  const cancelRef = useRef(null)
  useEffect(() => {
    if (dialog === null) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [dialog, onClose])
  useEffect(() => {
    // Focus Cancel, never the destructive action: a stray Enter must not
    // delete a file or discard a buffer.
    if (dialog !== null) cancelRef.current?.focus()
  }, [dialog])
  if (dialog === null) return null
  const actions = Array.isArray(dialog.actions) && dialog.actions.length > 0
    ? dialog.actions
    : [
        { key: 'cancel', label: dialog.cancelLabel ?? 'Cancel', action: () => {} },
        {
          key: 'confirm',
          label: dialog.confirmLabel ?? 'Confirm',
          danger: dialog.danger !== false,
          primary: dialog.danger === false,
          action: () => dialog.onConfirm?.(),
        },
      ]
  // A blocking confirmation is raised while another dialog may still be
  // open (the "unsaved changes" warning above the project picker), so it
  // gets its own layer - otherwise the later backdrop covers it. The
  // editor-scoped variant is the save conflict box of the document pane and
  // keeps its own class.
  const backdropClass = scope === 'editor'
    ? 'iwb-modal-backdrop iwb-editor-scoped-backdrop'
    : 'iwb-modal-backdrop iwb-confirm-backdrop'
  return React.createElement('div', { className: backdropClass, onMouseDown: event => { if (event.target === event.currentTarget) onClose() } },
    React.createElement('div', { className: 'iwb-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': dialog.title },
      React.createElement('h2', null, dialog.title),
      // The body can be clamped by the stylesheet (the editor-scoped variant
      // keeps it to three lines), so the full text stays reachable on hover.
      React.createElement('p', { title: dialog.body }, dialog.body),
      React.createElement('div', { className: 'iwb-modal-actions' },
        actions.map((action, index) => React.createElement('button', {
          key: action.key ?? index,
          ref: index === 0 ? cancelRef : undefined,
          type: 'button',
          className: `iwb-textbtn ${action.primary === true ? 'iwb-primary' : ''} ${action.danger === true ? 'iwb-danger-solid' : ''}`,
          autoFocus: index === 0,
          onClick: () => { onClose(); action.action?.() },
        }, action.label)),
      ),
    ),
  )
}

/** Transient toast pinned above the status bar. */
export function Toast({ toast }) {
  if (toast === null || toast === undefined) return null
  const action = toast.action ?? null
  return React.createElement('div', { className: `iwb-toast iwb-${toast.kind}` },
    React.createElement('div', { className: 'iwb-toast-text' },
      React.createElement('div', null, toast.text),
      toast.detail !== '' && toast.detail !== undefined
        ? React.createElement('div', { className: 'iwb-toast-detail' }, toast.detail)
        : null,
      // An action of the toast: a button that copies a command the user has
      // to type into a terminal.
      action !== null && typeof action.copy === 'string' && action.copy !== ''
        ? React.createElement('button', {
            type: 'button',
            className: 'iwb-textbtn iwb-small iwb-toast-action',
            onClick: () => {
              const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : null
              const written = clipboard === null
                ? Promise.reject(new Error('no clipboard'))
                : clipboard.writeText(action.copy)
              written.then(
                () => { action.onDone?.(true) },
                () => { action.onDone?.(false) },
              )
            },
          }, action.label ?? 'Copy')
        : null,
    ),
  )
}

/** Inline editable keyboard-shortcut chip (captures one combo). */
export function ShortcutCapture({
  value, onCapture, active, onActivate,
  pressText = 'Press keys…', hint = 'Click, then press the new shortcut',
}) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return undefined
    const onKey = (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') { setArmed(false); onActivate?.(false); return }
      const parts = []
      if (event.ctrlKey) parts.push('Ctrl')
      if (event.altKey) parts.push('Alt')
      if (event.shiftKey) parts.push('Shift')
      if (event.metaKey) parts.push('Meta')
      let key = event.key
      if (key === ' ' || key === 'Spacebar') key = 'Space'
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return
      if (key.length === 1) key = key.toUpperCase()
      parts.push(key)
      onCapture(parts.join('+'))
      setArmed(false)
      onActivate?.(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [armed, onCapture, onActivate])
  useEffect(() => {
    if (active === false) setArmed(false)
  }, [active])
  return React.createElement('button', {
    type: 'button',
    className: `iwb-settings-shortcut ${armed ? 'iwb-capturing' : ''}`,
    onClick: () => { setArmed(true); onActivate?.(true) },
    title: hint,
    'aria-label': hint,
  }, armed ? pressText : value)
}

export function Kbd({ children }) {
  return React.createElement('span', { className: 'iwb-kbd' }, children)
}

/* ── icons used across panels (inline, 14px) ─────────────────────────── */
export function ChevronRight({ size = 12 }) {
  return React.createElement('svg', { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true },
    React.createElement('path', { d: 'M6 4l4 4-4 4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }))
}

export function ChevronDown({ size = 12 }) {
  return React.createElement('svg', { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true },
    React.createElement('path', { d: 'M4 6l4 4 4-4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }))
}
