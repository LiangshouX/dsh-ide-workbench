/**
 * LSP stdio frame codec.
 *
 * The Language Server Protocol frames every JSON-RPC message as
 *
 *   Content-Length: <bytes>\r\n\r\n<body>
 *
 * The length counts *bytes*, not characters: a payload with CJK text or an
 * emoji is longer in UTF-8 than its JavaScript string length, and a decoder
 * that trusts the character count cuts the frame in half and then loses the
 * rest of the stream.
 *
 * This module is deliberately free of I/O so that three very different callers
 * can share it: the worker thread that owns the real pipe (`lsp-worker.js`),
 * the host main thread that only forwards bytes, and the unit tests.
 */

/** The header/body separator mandated by the LSP base protocol. */
const HEADER_SEPARATOR = Buffer.from('\r\n\r\n', 'ascii')
/** Lenient alternative for servers that emit bare LF line endings. */
const LENIENT_SEPARATOR = Buffer.from('\n\n', 'ascii')

/** A header block longer than this is treated as garbage, not as a frame. */
const DEFAULT_MAX_HEADER_BYTES = 8 * 1024
/** A single body larger than this is refused (protects the host's memory). */
const DEFAULT_MAX_BODY_BYTES = 64 * 1024 * 1024

/**
 * Encode one JSON-RPC payload as an LSP stdio frame.
 * @param {string} text the payload (JSON only, no protocol headers)
 * @returns {Buffer} the framed bytes, ready for the server's stdin
 */
export function encodeFrame(text) {
  const body = Buffer.from(typeof text === 'string' ? text : String(text), 'utf8')
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii')
  return Buffer.concat([header, body])
}

/**
 * Read the byte length out of one header block.
 * @param {string} header the header text (without the trailing separator)
 * @returns {number | null} the length, or null when the header is unusable
 */
function parseContentLength(header) {
  const match = /(?:^|[\r\n])content-length\s*:\s*(\d+)/i.exec(header)
  if (match === null) return null
  const value = Number.parseInt(match[1], 10)
  if (!Number.isSafeInteger(value) || value < 0) return null
  return value
}

/**
 * View one chunk as bytes without copying when possible.
 * @param {Buffer | Uint8Array | string} chunk
 * @returns {Buffer}
 */
function toBytes(chunk) {
  if (Buffer.isBuffer(chunk)) return chunk
  if (chunk instanceof Uint8Array) return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
  return Buffer.from(String(chunk), 'utf8')
}

/**
 * An incremental LSP frame decoder.
 *
 * The decoder is fed whatever the pipe produces and returns the payloads of
 * every frame that completed. It survives half packets (a header split over
 * two reads), sticky packets (two frames in one read) and multi-byte UTF-8
 * (the body is cut on byte boundaries and decoded afterwards). A frame whose
 * `Content-Length` is missing or malformed is dropped; the stream keeps going
 * so one broken frame cannot kill the session.
 */
export class FrameDecoder {
  /**
   * @param {{ maxHeaderBytes?: number, maxBodyBytes?: number }} [options]
   */
  constructor(options = {}) {
    this.maxHeaderBytes = options.maxHeaderBytes ?? DEFAULT_MAX_HEADER_BYTES
    this.maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
    /** Bytes received but not yet part of a complete frame. */
    this.pending = Buffer.alloc(0)
    /** How many bytes of an oversized frame are still to be thrown away. */
    this.skip = 0
    /** How many frames were dropped because their header was unusable. */
    this.dropped = 0
  }

  /**
   * Feed one chunk of server output.
   * @param {Buffer | Uint8Array | string} chunk
   * @returns {string[]} the payloads whose frames completed with this chunk
   */
  push(chunk) {
    const bytes = toBytes(chunk)
    this.pending = this.pending.length === 0 ? bytes : Buffer.concat([this.pending, bytes])
    return this.#drain()
  }

  /** Forget every buffered byte (used when a process is replaced). */
  reset() {
    this.pending = Buffer.alloc(0)
    this.skip = 0
    this.dropped = 0
  }

  /** @returns {number} how many bytes are buffered for the next frame */
  get buffered() {
    return this.pending.length
  }

  #drain() {
    const payloads = []
    // A frame whose body is too large is thrown away byte by byte, so its
    // bytes cannot be mistaken for the header of the next frame.
    if (this.skip > 0) {
      const thrown = Math.min(this.skip, this.pending.length)
      this.pending = this.pending.subarray(thrown)
      this.skip -= thrown
      if (this.skip > 0) return payloads
    }
    for (;;) {
      const header = this.#findHeader()
      if (header === null) {
        // No complete header yet. A buffer that already exceeds the header
        // limit without a separator cannot become a frame: drop it instead
        // of growing without bound.
        if (this.pending.length > this.maxHeaderBytes) {
          this.pending = Buffer.alloc(0)
          this.dropped += 1
        }
        break
      }
      const length = parseContentLength(this.pending.subarray(0, header.end).toString('ascii'))
      if (length === null) {
        // A frame we cannot size is unusable. Drop the header block and keep
        // scanning: the next frame may be perfectly fine.
        this.pending = this.pending.subarray(header.bodyStart)
        this.dropped += 1
        continue
      }
      if (length > this.maxBodyBytes) {
        this.pending = this.pending.subarray(header.bodyStart)
        this.skip = length
        this.dropped += 1
        const thrown = Math.min(this.skip, this.pending.length)
        this.pending = this.pending.subarray(thrown)
        this.skip -= thrown
        continue
      }
      if (this.pending.length < header.bodyStart + length) break
      payloads.push(this.pending.subarray(header.bodyStart, header.bodyStart + length).toString('utf8'))
      this.pending = this.pending.subarray(header.bodyStart + length)
    }
    return payloads
  }

  /**
   * Locate the end of the next header block.
   * @returns {{ end: number, bodyStart: number } | null}
   */
  #findHeader() {
    const strict = this.pending.indexOf(HEADER_SEPARATOR)
    const lenient = this.pending.indexOf(LENIENT_SEPARATOR)
    if (strict === -1 && lenient === -1) return null
    if (strict !== -1 && (lenient === -1 || strict <= lenient)) {
      return { end: strict, bodyStart: strict + HEADER_SEPARATOR.length }
    }
    return { end: lenient, bodyStart: lenient + LENIENT_SEPARATOR.length }
  }
}
