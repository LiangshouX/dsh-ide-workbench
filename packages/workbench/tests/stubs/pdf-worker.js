/**
 * The worker source of the PDF preview, as the render tests see it.
 *
 * The SSR tests never open a PDF (effects do not run), so the engine module
 * is bundled only to keep the import graph honest; the worker string it
 * carries in the product build would be a megabyte of dead weight here.
 */
export default ''
