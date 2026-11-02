/** Minimal xterm stand-in for the SSR render smoke (no effects run). */
export class Terminal {
  constructor() {
    this.cols = 80
    this.rows = 24
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
