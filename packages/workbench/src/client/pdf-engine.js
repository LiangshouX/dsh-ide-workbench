/**
 * The PDF engine: PDF.js and its worker, loaded on demand.
 *
 * The workbench is one CommonJS file, so a real worker cannot be fetched from
 * a separate URL: the worker source travels in the bundle as a string, and
 * the engine turns it into a blob URL. That is also why this module sits
 * behind a dynamic import - a session that never opens a PDF never pays for
 * the parser.
 *
 * The host inlines the PDF bytes as base64 (`fs.read` answers JSON), so the
 * viewer decodes them here and hands the `Uint8Array` to the worker, which
 * takes ownership of the buffer.
 */
import * as pdfjs from 'pdfjs-dist/build/pdf.min.mjs'
import workerSource from 'virtual:pdf-worker'
import { decodePdfBase64 } from './pdf-view.js'

/** How long a worker may take before the viewer gives up on it. */
const WORKER_START_TIMEOUT_MS = 15_000

/** The marker the worker posts once its own module has been evaluated. */
const WORKER_READY = 'iwb-pdf-worker-ready'

/**
 * Start one PDF worker from the bundled source.
 *
 * PDF.js's own `workerSrc` machinery fetches the worker as a module URL and
 * falls back to a same-origin wrapper for blob URLs. The workbench cannot
 * serve that URL, so the worker is created here and handed to
 * `PDFWorker.create({ port })` - the same shape the host's own document
 * preview uses.
 * @returns {Promise<{ worker: Worker, bridge: object, url: string }>} the running worker
 */
async function startWorker() {
  const url = URL.createObjectURL(new Blob([
    workerSource,
    `\nself.postMessage({ type: ${JSON.stringify(WORKER_READY)} });\n`,
  ], { type: 'text/javascript' }))
  let worker
  try {
    worker = new Worker(url, { type: 'module', name: 'iwb-pdf' })
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
  try {
    await new Promise((resolve, reject) => {
      let settled = false
      let timer = null
      const finish = (error) => {
        if (settled) return
        settled = true
        if (timer !== null) clearTimeout(timer)
        worker.removeEventListener('message', onMessage)
        worker.removeEventListener('error', onError)
        worker.removeEventListener('messageerror', onMessageError)
        if (error === undefined) resolve()
        else reject(error)
      }
      const onMessage = (event) => {
        if (event?.data?.type === WORKER_READY) finish()
      }
      const onError = (event) => {
        finish(new Error(event?.message === undefined || event.message === '' ? 'PDF worker failed to start' : event.message))
      }
      const onMessageError = () => finish(new Error('PDF worker could not receive its first message'))
      timer = setTimeout(() => finish(new Error('PDF worker did not start in time')), WORKER_START_TIMEOUT_MS)
      worker.addEventListener('message', onMessage)
      worker.addEventListener('error', onError)
      worker.addEventListener('messageerror', onMessageError)
    })
  } catch (error) {
    worker.terminate()
    URL.revokeObjectURL(url)
    throw error
  }
  const bridge = (() => {
    try {
      return pdfjs.PDFWorker.create({ port: worker })
    } catch (error) {
      worker.terminate()
      URL.revokeObjectURL(url)
      throw error
    }
  })()
  return { worker, bridge, url }
}

/**
 * Open one PDF.
 *
 * The returned object owns everything the document needs; `destroy()` must
 * be called when the tab goes away (or the component unmounts), otherwise the
 * worker and the document stay in memory.
 * @param {string} data base64 bytes of the PDF
 * @param {{ onProgress?: (progress: { loaded: number, total: number }) => void }} [options]
 */
export async function openPdf(data, options = {}) {
  const bytes = decodePdfBase64(data)
  const { worker, bridge, url } = await startWorker()
  let loadingTask
  try {
    loadingTask = pdfjs.getDocument({
      data: bytes,
      worker: bridge,
      // The engine is the host's own code: no `eval` for font programs, and no
      // network fetches (the document is already in memory).
      isEvalSupported: false,
      useWorkerFetch: false,
      enableXfa: false,
      stopAtErrors: false,
      cMapPacked: true,
    })
  } catch (error) {
    try { bridge.destroy() } catch { /* the bridge is already gone */ }
    try { worker.terminate() } catch { /* the worker is already gone */ }
    URL.revokeObjectURL(url)
    throw error
  }
  if (typeof options.onProgress === 'function') {
    loadingTask.onProgress = (progress) => {
      options.onProgress({ loaded: progress?.loaded ?? 0, total: progress?.total ?? 0 })
    }
  }
  let destroyed = false
  const destroy = () => {
    if (destroyed) return
    destroyed = true
    try { Promise.resolve(loadingTask.destroy()).catch(() => {}) } catch { /* the task is already gone */ }
    try { bridge.destroy() } catch { /* the bridge is already gone */ }
    try { worker.terminate() } catch { /* the worker is already gone */ }
    URL.revokeObjectURL(url)
  }
  try {
    const document = await loadingTask.promise
    return { document, destroy, version: pdfjs.version }
  } catch (error) {
    destroy()
    throw error
  }
}
