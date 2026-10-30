import test from 'node:test'
import assert from 'node:assert/strict'
import {
  basenameOfFileAddress,
  fileAddressFor,
  fileUrlForPath,
  isAmbiguousLinkPath,
  isFileAddress,
  isIdeViewableAddress,
  parseFileAddress,
  relativeLinkCandidateEntries,
  relativeLinkCandidates,
  resolveFileAddress,
  sessionFileAddress,
} from '../src/client/file-address.js'

test('parses a session-scoped file address', () => {
  const parsed = parseFileAddress('dsh-resource://file/session/s1/src/main.ts')
  assert.deepEqual(parsed, { scope: 'session', sessionId: 's1', path: 'src/main.ts' })
  assert.equal(isFileAddress('dsh-resource://file/session/s1/src/main.ts'), true)
  assert.equal(isFileAddress('sidebar://ide-workbench'), false)
})

test('decodes encoded segments and ignores query/fragment suffixes', () => {
  const parsed = parseFileAddress('dsh-resource://file/session/s1/src/my%20file.ts#L24')
  assert.deepEqual(parsed, { scope: 'session', sessionId: 's1', path: 'src/my file.ts' })
  assert.equal(basenameOfFileAddress('dsh-resource://file/session/s1/src/my%20file.ts'), 'my file.ts')
})

test('parses absolute and UNC file addresses', () => {
  assert.deepEqual(
    parseFileAddress('dsh-resource://file/absolute/C:/work/a.ts'),
    { scope: 'absolute', path: 'C:/work/a.ts' },
  )
  assert.deepEqual(
    parseFileAddress('dsh-resource://file/absolute//server/share/a.ts'),
    { scope: 'absolute', path: '//server/share/a.ts' },
  )
  assert.deepEqual(
    parseFileAddress('dsh-resource://file/absolute/home/me/a.ts'),
    { scope: 'absolute', path: '/home/me/a.ts' },
  )
})

test('rejects malformed addresses', () => {
  assert.equal(parseFileAddress('dsh-resource://file/other/x'), undefined)
  assert.equal(parseFileAddress('dsh-resource://file/session/'), undefined)
  assert.equal(parseFileAddress('dsh-resource://file/session/s1/%ZZ'), undefined)
  assert.equal(parseFileAddress(''), undefined)
})

test('resolves relative session paths with the workspace separator', () => {
  const parsed = parseFileAddress('dsh-resource://file/session/s1/src/main.ts')
  assert.equal(resolveFileAddress(parsed, 'C:\\work\\demo'), 'C:\\work\\demo\\src\\main.ts')
  assert.equal(resolveFileAddress(parsed, 'C:/work/demo'), 'C:/work/demo/src/main.ts')
  assert.equal(resolveFileAddress(parsed, '/home/me'), '/home/me/src/main.ts')
})

test('resolves dot segments and absolute paths', () => {
  const relative = parseFileAddress('dsh-resource://file/session/s1/src/../lib/a.ts')
  assert.equal(resolveFileAddress(relative, 'C:\\work\\demo'), 'C:\\work\\demo\\lib\\a.ts')
  const absolute = parseFileAddress('dsh-resource://file/session/s1/C:/other/a.ts')
  assert.equal(resolveFileAddress(absolute, 'C:\\work\\demo'), 'C:\\other\\a.ts')
  const outside = parseFileAddress('dsh-resource://file/absolute/D:/outside/a.ts')
  assert.equal(resolveFileAddress(outside, 'C:\\work\\demo'), 'D:\\outside\\a.ts')
})

test('claims text and images but leaves office/binary formats to the sidebar', () => {
  assert.equal(isIdeViewableAddress('dsh-resource://file/session/s1/src/a.ts'), true)
  assert.equal(isIdeViewableAddress('dsh-resource://file/session/s1/README.md'), true)
  assert.equal(isIdeViewableAddress('dsh-resource://file/session/s1/logo.png'), true)
  assert.equal(isIdeViewableAddress('dsh-resource://file/session/s1/report.pdf'), false)
  assert.equal(isIdeViewableAddress('dsh-resource://file/session/s1/sheet.xlsx'), false)
  assert.equal(isIdeViewableAddress('dsh-resource://file/session/s1/spec.docx'), false)
  assert.equal(isIdeViewableAddress('dsh-resource://file/session/s1/LICENSE'), true)
})

test('builds session-scoped addresses for relative, inside and outside paths', () => {
  assert.equal(
    sessionFileAddress('s1', 'src/my file.ts'),
    'dsh-resource://file/session/s1/src/my%20file.ts',
  )
  assert.equal(
    fileAddressFor('s1', 'C:\\work\\demo', 'C:\\work\\demo\\src\\a.ts'),
    'dsh-resource://file/session/s1/src/a.ts',
  )
  assert.equal(
    fileAddressFor('s1', 'C:\\work\\demo', 'C:\\other\\a.ts'),
    'dsh-resource://file/session/s1/C:/other/a.ts',
  )
  assert.equal(
    fileAddressFor('s1', 'C:\\work\\demo', 'D:\\outside\\a.ts'),
    'dsh-resource://file/session/s1/D:/outside/a.ts',
  )
})

test('builds file URLs for drive, POSIX and UNC paths', () => {
  assert.equal(fileUrlForPath('C:\\work\\a.html'), 'file:///C:/work/a.html')
  assert.equal(fileUrlForPath('C:\\work\\a b.html'), 'file:///C:/work/a%20b.html')
  assert.equal(fileUrlForPath('/home/me/a.html'), 'file:///home/me/a.html')
  assert.equal(fileUrlForPath('\\\\server\\share\\a.html'), 'file://server/share/a.html')
})

test('has no link candidates for drive-letter and UNC absolute paths', () => {
  const bases = ['D:/Code/ROOT']
  assert.deepEqual(relativeLinkCandidates('D:/Code/ROOT/docs/a.md', bases), [])
  assert.deepEqual(relativeLinkCandidates('D:\\Code\\ROOT\\docs\\a.md', bases), [])
  assert.deepEqual(relativeLinkCandidates('\\\\server\\share\\a.md', bases), [])
  assert.deepEqual(relativeLinkCandidates('//server/share/a.md', bases), [])
})

test('joins a single leading slash path onto every base', () => {
  assert.deepEqual(
    relativeLinkCandidates('/docs/PRD-v4.md', ['D:/Code/ROOT/dsh-ide-workbench', 'D:/Code/ROOT']),
    [
      'D:/Code/ROOT/dsh-ide-workbench/docs/PRD-v4.md',
      'D:/Code/ROOT/docs/PRD-v4.md',
    ],
  )
})

test('joins a plain relative path onto every base', () => {
  assert.deepEqual(
    relativeLinkCandidates('docs/PRD-v4.md', ['D:/Code/ROOT/dsh-ide-workbench', 'D:/Code/ROOT']),
    [
      'D:/Code/ROOT/dsh-ide-workbench/docs/PRD-v4.md',
      'D:/Code/ROOT/docs/PRD-v4.md',
    ],
  )
  assert.deepEqual(
    relativeLinkCandidates('src\\main.ts', ['D:/Code/ROOT']),
    ['D:/Code/ROOT/src/main.ts'],
  )
})

test('keeps the first position of a repeated base and the project root first', () => {
  const bases = [
    'D:/Code/ROOT/dsh-ide-workbench',
    'D:/Code/ROOT',
    'D:/Code/ROOT',
    'D:/Code/OTHER',
  ]
  assert.deepEqual(
    relativeLinkCandidates('/docs/PRD-v4.md', bases),
    [
      'D:/Code/ROOT/dsh-ide-workbench/docs/PRD-v4.md',
      'D:/Code/ROOT/docs/PRD-v4.md',
      'D:/Code/OTHER/docs/PRD-v4.md',
    ],
  )
  assert.deepEqual(
    relativeLinkCandidates('/docs/PRD-v4.md', ['d:/code/root', 'D:/Code/ROOT']),
    ['d:/code/root/docs/PRD-v4.md'],
  )
})

test('caps the candidate list at three bases', () => {
  assert.deepEqual(
    relativeLinkCandidates('/a.md', ['D:/a', 'D:/b', 'D:/c', 'D:/d']),
    ['D:/a/a.md', 'D:/b/a.md', 'D:/c/a.md'],
  )
})

test('resolves dot segments so an escaping path leaves its base', () => {
  assert.deepEqual(
    relativeLinkCandidates('/../outside/a.md', ['D:/Code/ROOT']),
    ['D:/Code/outside/a.md'],
  )
  assert.deepEqual(
    relativeLinkCandidates('/docs/../a.md', ['D:/Code/ROOT']),
    ['D:/Code/ROOT/a.md'],
  )
})

test('splits every candidate into its base and the relative path', () => {
  assert.deepEqual(
    relativeLinkCandidateEntries('/docs/PRD-v4.md', ['D:/Code/ROOT', 'D:/Code/OTHER']),
    [
      { base: 'D:/Code/ROOT', rel: 'docs/PRD-v4.md', absolute: 'D:/Code/ROOT/docs/PRD-v4.md' },
      { base: 'D:/Code/OTHER', rel: 'docs/PRD-v4.md', absolute: 'D:/Code/OTHER/docs/PRD-v4.md' },
    ],
  )
})

test('flags only the single leading slash shape as ambiguous', () => {
  assert.equal(isAmbiguousLinkPath('/docs/PRD-v4.md'), true)
  assert.equal(isAmbiguousLinkPath('docs/PRD-v4.md'), false)
  assert.equal(isAmbiguousLinkPath('D:/docs/a.md'), false)
  assert.equal(isAmbiguousLinkPath('//server/share/a.md'), false)
  assert.equal(isAmbiguousLinkPath(''), false)
})

test('keeps a POSIX absolute path inside the workspace absolute', () => {
  assert.equal(isAmbiguousLinkPath('/home/me/proj/a.md', '/home/me/proj'), false)
  assert.equal(isAmbiguousLinkPath('/home/me/proj/a.md', '/home/me/other'), true)
  assert.equal(isAmbiguousLinkPath('/docs/PRD-v4.md', 'D:/Code/ROOT'), true)
})
