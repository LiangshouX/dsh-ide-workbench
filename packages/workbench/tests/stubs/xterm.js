/** Minimal xterm stand-in for the SSR render smoke (no effects run). */
export class Terminal {
  constructor(options = {}) {
    this.cols = 80
    this.rows = 24
    // The panel pushes the palette of the host theme into the live instance
    // (`terminal.options.theme = ...`), so the stub has to carry the options.
    this.options = { theme: options.theme ?? {} }
    this.element = { style: { setProperty() {} } }
  }
  open() {}
  loadAddon() {}
  dispose() {}
  focus() {}
  write() {}
  onData() { return { dispose() {} } }
  onSelectionChange() { return { dispose() {} } }
  getSelection() { return '' }
  hasSelection() { return false }
}
