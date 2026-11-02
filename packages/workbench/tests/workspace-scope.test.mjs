import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isPathWithin,
  normalizeScopePath,
  sameScopePath,
  sameWorkspace,
  sessionCwdOf,
  shouldContinueIde,
  workspaceScopeKey,
} from '../src/client/workspace-scope.js'

function ctxWith(byId) {
  return { sessions: { list: { getSnapshot: () => ({ byId }) } } }
}

test('normalizes separators and Windows case for workspace keys', () => {
  assert.equal(normalizeScopePath('C:\\Work\\Demo\\'), 'c:/work/demo')
  assert.equal(normalizeScopePath('C:/Work/Demo'), 'c:/work/demo')
  assert.equal(normalizeScopePath('/Home/Me/'), '/Home/Me')
  assert.equal(normalizeScopePath(''), '')
})

test('compares workspace paths', () => {
  assert.equal(sameScopePath('C:\\Work\\Demo', 'c:/work/demo/'), true)
  assert.equal(sameScopePath('/home/me', '/home/me/'), true)
  assert.equal(sameScopePath('/home/me', '/home/other'), false)
  assert.equal(sameScopePath('', ''), false)
})

test('tests containment without a sibling-prefix false positive', () => {
  assert.equal(isPathWithin('C:\\Work\\Demo', 'c:/work/demo/src/a.ts'), true)
  assert.equal(isPathWithin('C:\\Work\\Demo', 'C:\\Work\\Demo'), true)
  assert.equal(isPathWithin('C:\\Work\\Demo', 'C:\\Work\\Demo2\\a.ts'), false)
  assert.equal(isPathWithin('C:\\Work\\Demo', 'D:\\Work\\Demo\\a.ts'), false)
  assert.equal(isPathWithin('', 'C:\\Work\\Demo\\a.ts'), false)
  assert.equal(isPathWithin('/repo', '/repo2/a.ts'), false)
  assert.equal(isPathWithin('/repo', '/repo/a.ts'), true)
})

test('maps sessions in one workspace to one scope key', () => {
  const ctx = ctxWith({
    a: { cwd: 'C:\\work\\demo' },
    b: { cwd: 'c:/work/demo/' },
    c: { cwd: 'C:\\work\\other' },
    d: {},
  })
  assert.equal(sessionCwdOf(ctx, 'a'), 'C:\\work\\demo')
  assert.equal(workspaceScopeKey(ctx, 'a'), workspaceScopeKey(ctx, 'b'))
  assert.notEqual(workspaceScopeKey(ctx, 'a'), workspaceScopeKey(ctx, 'c'))
  assert.equal(workspaceScopeKey(ctx, 'd'), 'session:d')
  assert.equal(sameWorkspace(ctx, 'a', 'b'), true)
  assert.equal(sameWorkspace(ctx, 'a', 'c'), false)
  assert.equal(sameWorkspace(ctx, 'a', 'd'), false)
})

test('reads the sessions service through ctx.get as well', () => {
  const service = { list: { getSnapshot: () => ({ byId: { s1: { cwd: '/repo' } } }) } }
  const ctx = { get: name => (name === 'sessions' ? service : undefined) }
  assert.equal(sessionCwdOf(ctx, 's1'), '/repo')
})

test('continues the IDE only from a visible same-workspace Session', () => {
  const ctx = ctxWith({
    a: { cwd: 'C:\\work\\demo' },
    b: { cwd: 'C:\\work\\demo' },
    c: { cwd: 'C:\\work\\other' },
  })
  assert.equal(shouldContinueIde(ctx, 'a', 'b', 'a'), true)
  assert.equal(shouldContinueIde(ctx, 'a', 'b', 'b'), false)
  assert.equal(shouldContinueIde(ctx, 'a', 'b', null), false)
  assert.equal(shouldContinueIde(ctx, 'a', 'c', 'a'), false)
  assert.equal(shouldContinueIde(ctx, 'a', 'a', 'a'), false)
  assert.equal(shouldContinueIde(ctx, '', 'b', ''), false)
})
