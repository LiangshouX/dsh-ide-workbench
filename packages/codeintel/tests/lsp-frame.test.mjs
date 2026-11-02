import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeFrame, FrameDecoder } from '../src/host/lsp-frame.js'

/**
 * Split one buffer in the middle, to simulate a half packet.
 * @param {Buffer} buffer
 * @returns {[Buffer, Buffer]}
 */
function split(buffer) {
  const middle = Math.floor(buffer.length / 2)
  return [buffer.subarray(0, middle), buffer.subarray(middle)]
}

test('a frame announces the byte length of its body', () => {
  const payload = '{"jsonrpc":"2.0"}'
  const frame = encodeFrame(payload)
  const header = frame.subarray(0, frame.indexOf('\r\n\r\n') + 4).toString('ascii')
  assert.equal(header, `Content-Length: ${payload.length}\r\n\r\n`)
  assert.equal(frame.length, header.length + payload.length)
})

test('the length counts bytes, not characters', () => {
  const payload = JSON.stringify({ text: '中文' })
  const frame = encodeFrame(payload)
  const header = frame.subarray(0, frame.indexOf('\r\n\r\n') + 4).toString('ascii')
  assert.equal(header, `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n`)
  // The character count is smaller than the byte count, which is exactly the
  // bug a character-counting decoder has.
  assert.ok(Buffer.byteLength(payload, 'utf8') > payload.length)
})

test('a frame that arrives in two halves is decoded once it is complete', () => {
  const decoder = new FrameDecoder()
  const frame = encodeFrame('{"id":1}')
  const [head, tail] = split(frame)
  assert.deepEqual(decoder.push(head), [])
  assert.deepEqual(decoder.push(tail), ['{"id":1}'])
})

test('two frames in one chunk are decoded separately', () => {
  const decoder = new FrameDecoder()
  const chunk = Buffer.concat([encodeFrame('{"id":1}'), encodeFrame('{"id":2}')])
  assert.deepEqual(decoder.push(chunk), ['{"id":1}', '{"id":2}'])
})

test('a frame that is split inside a multi-byte character survives the split', () => {
  const payload = JSON.stringify({ text: '中文注释' })
  const frame = encodeFrame(payload)
  const bytes = Buffer.from(payload, 'utf8')
  // Cut in the middle of the first multi-byte character.
  const cut = Buffer.from('Content-Length: ' + bytes.length + '\r\n\r\n', 'ascii').length + 2
  const decoder = new FrameDecoder()
  assert.deepEqual(decoder.push(frame.subarray(0, cut)), [])
  assert.deepEqual(decoder.push(frame.subarray(cut)), [payload])
})

test('a header without a Content-Length is dropped and the stream continues', () => {
  const decoder = new FrameDecoder()
  const broken = Buffer.from('Content-Type: application/vscode-jsonrpc\r\n\r\n', 'ascii')
  const good = encodeFrame('{"id":3}')
  assert.deepEqual(decoder.push(Buffer.concat([broken, good])), ['{"id":3}'])
  assert.equal(decoder.dropped, 1)
})

test('an illegal Content-Length is dropped and the stream continues', () => {
  const decoder = new FrameDecoder()
  const broken = Buffer.from('Content-Length: not-a-number\r\n\r\n', 'ascii')
  const good = encodeFrame('{"id":4}')
  assert.deepEqual(decoder.push(Buffer.concat([broken, good])), ['{"id":4}'])
  assert.equal(decoder.dropped, 1)
})

test('a body larger than the limit is refused', () => {
  const decoder = new FrameDecoder({ maxBodyBytes: 4 })
  assert.deepEqual(decoder.push(encodeFrame('{"id":5}')), [])
  assert.equal(decoder.dropped, 1)
  assert.equal(decoder.buffered, 0)
})

test('garbage without a separator is dropped instead of growing the buffer', () => {
  const decoder = new FrameDecoder({ maxHeaderBytes: 32 })
  assert.deepEqual(decoder.push(Buffer.from('x'.repeat(64), 'ascii')), [])
  assert.equal(decoder.buffered, 0)
  assert.equal(decoder.dropped, 1)
})

test('the decoder accepts a header that uses bare line feeds', () => {
  const decoder = new FrameDecoder()
  const payload = '{"id":6}'
  const frame = Buffer.concat([
    Buffer.from(`Content-Length: ${payload.length}\n\n`, 'ascii'),
    Buffer.from(payload, 'utf8'),
  ])
  assert.deepEqual(decoder.push(frame), [payload])
})

test('a reset drops everything that was buffered', () => {
  const decoder = new FrameDecoder()
  const [head] = split(encodeFrame('{"id":7}'))
  decoder.push(head)
  assert.ok(decoder.buffered > 0)
  decoder.reset()
  assert.equal(decoder.buffered, 0)
})
