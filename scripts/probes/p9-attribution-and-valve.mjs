/**
 * P9: the attribution of the memory difference (review round 2, N1/N2/N3).
 *
 * The difference method measures the machine's free-memory drop and books it
 * on the language servers. When ANOTHER program takes the memory, the whole
 * drop used to be booked on the server: the reservation collapsed, the
 * available memory looked huge - and the memory pressure valve of MEM-12
 * never fired while the machine was really out of memory.
 *
 * The rule of round 2: a difference that is bigger than the room the servers
 * still have cannot be theirs, so the round is VOID and the last valid values
 * stay. This probe walks the cases with the valve OFF (so the numbers can be
 * read before the release) and ON (so the release itself is checked).
 *
 * Nothing in the repository is modified: the probe only imports from it.
 */
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { LspManager, DEFAULT_LSP_SETTINGS, shutdownAll } from '../../src/host/lsp.js'

const MB = 1024 * 1024
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms) })

/**
 * A manager whose machine can be squeezed, and which records the warnings.
 * @param {object} machine the simulated machine
 * @param {object} [lsp] the `lsp` section of the settings
 * @returns {object} the manager and the warnings
 */
function managerFor(machine, lsp = {}) {
  const warnings = []
  const manager = new LspManager({
    ctx: { logger: { warn: (...args) => warnings.push(args.map(String).join(' ')), error() {}, info() {} } },
    getSettings: async () => ({ lsp: { ...DEFAULT_LSP_SETTINGS, requestTimeoutMs: 100, ...lsp } }),
    spawnServer: async () => {
      // The server takes its footprint while it starts: the spawn window
      // measures exactly that (the difference method of MEM-06).
      machine.freeMB -= 600
      const handle = {
        stdin: null, stdout: null, stderr: null,
        done: new Promise(() => {}),
        terminate() { handle.terminated = true },
        waitForExit: async () => true,
        terminated: false,
      }
      return handle
    },
    createWorker: () => ({ on() {}, off() {}, postMessage() {}, terminate() {} }),
    readMemory: () => ({ totalBytes: machine.totalMB * MB, freeBytes: machine.freeMB * MB }),
    readyDelayMs: 1,
    restartBackoffMs: 1,
    graceMs: 1,
  })
  return { manager, warnings }
}

/**
 * The numbers of one root, in megabytes.
 * @param {object} manager the manager
 * @param {string} root the root
 * @returns {Promise<object>}
 */
async function factsOf(manager, root) {
  const status = await manager.status({ root })
  const r = status.resources ?? {}
  return {
    state: status.state,
    measuredMB: Math.round((r.measuredBytes ?? 0) / MB),
    reservedMB: Math.round((r.reservedBytes ?? 0) / MB),
    availableMB: Math.round((r.availableBytes ?? 0) / MB),
    freeMB: Math.round((r.freeBytes ?? 0) / MB),
  }
}

/**
 * One case: a server is running, then the machine loses 7000 MB.
 * @param {{valve?: boolean}} options
 * @returns {Promise<object>} the numbers before and after the round
 */
async function caseOf(options = {}) {
  shutdownAll()
  const valve = options.valve !== false
  const machine = { totalMB: 16 * 1024, freeMB: 8000 }
  const { manager, warnings } = managerFor(machine, valve ? {} : { pressureYield: false })
  const root = join(tmpdir(), `iwb-p9-${valve ? 'valve' : 'quiet'}`)

  await manager.start({ root, languageId: 'typescript' })
  const afterSpawn = await factsOf(manager, root)
  // Another program takes 7000 MB. The server can only take its ceiling
  // (2048 MB), so this difference cannot be its memory.
  machine.freeMB -= 7000
  // The round rides on the watchdog and runs at its own interval.
  await sleep(1600)
  const afterRound = await factsOf(manager, root)
  return {
    afterSpawn,
    afterRound,
    voidLogged: warnings.some(line => line.includes('can only take') || line.includes('cannot take')),
  }
}

console.log('=== P9a: the account, with the valve OFF (the numbers before any release) ===')
const quiet = await caseOf({ valve: false })
console.log(`  right after the spawn : measured=${quiet.afterSpawn.measuredMB} MB reserved=${quiet.afterSpawn.reservedMB} MB available=${quiet.afterSpawn.availableMB} MB free=${quiet.afterSpawn.freeMB} MB`)
console.log(`  after the 7000 MB loss: measured=${quiet.afterRound.measuredMB} MB reserved=${quiet.afterRound.reservedMB} MB available=${quiet.afterRound.availableMB} MB free=${quiet.afterRound.freeMB} MB`)
console.log(`  the round was void    : ${quiet.voidLogged}`)
const honest = quiet.afterRound.measuredMB === quiet.afterSpawn.measuredMB
  && quiet.afterRound.reservedMB === quiet.afterSpawn.reservedMB
  && quiet.afterRound.availableMB <= quiet.afterRound.freeMB
console.log(`  >> the account stayed honest : ${honest}`)

console.log('')
console.log('=== P9b: the same machine, with the valve ON ===')
const loud = await caseOf({ valve: true })
console.log(`  after the 7000 MB loss: state=${loud.afterRound.state}`)
console.log(`  >> the valve released it     : ${loud.afterRound.state === 'suspended'}`)

console.log('')
console.log('=== P9c: a difference that FITS the room is still attributed ===')
shutdownAll()
{
  const machine = { totalMB: 16 * 1024, freeMB: 8000 }
  const { manager, warnings } = managerFor(machine, { pressureYield: false })
  const root = join(tmpdir(), 'iwb-p9-fit')
  await manager.start({ root, languageId: 'typescript' })
  const before = await factsOf(manager, root)
  // 500 MB is well inside the room (2048 - 600 = 1448): this can be the
  // server growing, and it is counted.
  machine.freeMB -= 500
  await sleep(1600)
  const after = await factsOf(manager, root)
  console.log(`  before: measured=${before.measuredMB} MB reserved=${before.reservedMB} MB`)
  console.log(`  after : measured=${after.measuredMB} MB reserved=${after.reservedMB} MB`)
  const grew = after.measuredMB === before.measuredMB + 500
  const shrunk = after.reservedMB === before.reservedMB - 500
  console.log(`  >> counted once, no clamp    : ${grew} / reserved follows: ${shrunk}`)
  console.log(`  >> no void logged            : ${!warnings.some(line => line.includes('can only take'))}`)
}

console.log('')
console.log('=== the verdict ===')
console.log(`  N1 fixed (void + honest account + valve fires) : ${honest && quiet.voidLogged && loud.afterRound.state === 'suspended'}`)
