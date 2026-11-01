/**
 * P11: the confirmed margin in the three cases of the review round 4.
 *
 * Round 3 gave the pressure valve its own number - the CONFIRMED margin of
 * the machine - and round 4 found the two places where that number was
 * still too kind:
 *
 *   A. the confirmed footprint was the drop of the free memory in the spawn
 *      window, and that window is a window of the MACHINE: another program
 *      may allocate in it;
 *   B. a session that is on its way out holds no reservation, but its ceiling
 *      stays until the process is really gone - and it was charged with that
 *      whole ceiling.
 *
 * The probe walks both cases and the third one of the round (the warning of
 * the valve) with the production `LspManager` and a machine that can be
 * squeezed. Nothing in the repository is modified: the probe only imports
 * from it.
 */
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { LspManager, DEFAULT_LSP_SETTINGS, shutdownAll } from '../../src/host/lsp.js'

const MB = 1024 * 1024
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms) })

/**
 * A manager whose machine can be squeezed.
 * @param {object} machine the simulated machine
 * @param {{value: number}} clock the clock of the probe
 * @param {object} [lsp] the `lsp` section of the settings
 * @param {number} [footprintMB] what the server takes while it starts
 * @param {number} [graceMs] how long the host waits for a dying process
 * @returns {{manager: object, warnings: string[]}} the manager and its warnings
 */
function managerFor(machine, clock, lsp = {}, footprintMB = 600, graceMs = 20) {
  const warnings = []
  const manager = new LspManager({
    ctx: { logger: { warn: (...args) => warnings.push(args.map(String).join(' ')), error() {}, info() {} } },
    getSettings: async () => ({ lsp: { ...DEFAULT_LSP_SETTINGS, requestTimeoutMs: 100, ...lsp } }),
    spawnServer: async () => {
      machine.freeMB -= footprintMB
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
    now: () => clock.value,
    readyDelayMs: 1,
    restartBackoffMs: 1,
    graceMs,
  })
  return { manager, warnings }
}

/**
 * The numbers of one root, in megabytes.
 * @param {object} manager the manager
 * @param {string} root the root
 * @returns {Promise<object>} the numbers
 */
async function factsOf(manager, root) {
  const status = await manager.status({ root })
  const r = status.resources ?? {}
  return {
    state: status.state,
    measuredMB: Math.round((r.measuredBytes ?? 0) / MB),
    availableMB: Math.round((r.availableBytes ?? 0) / MB),
    safeMB: Math.round((r.safeAvailableBytes ?? 0) / MB),
    freeMB: Math.round((r.freeBytes ?? 0) / MB),
  }
}

console.log('=== P11a: another program allocated in the spawn window ===')
shutdownAll()
{
  const machine = { totalMB: 16 * 1024, freeMB: 2900 }
  const clock = { value: Date.now() }
  // The server takes 600 MB and another program takes 1400 MB in the same
  // window: the host sees a drop of 2000 MB, and the drop FITS the room of
  // the server - nothing tells the host that it was not its memory.
  const { manager } = managerFor(machine, clock, { pressureYield: false }, 2000)
  const root = join(tmpdir(), 'iwb-p11-spawn')
  await manager.start({ root, languageId: 'typescript' })
  await sleep(80)
  const facts = await factsOf(manager, root)
  console.log(`  the drop of the window : measured=${facts.measuredMB} MB (the account believed it)`)
  console.log(`  the account says       : ${facts.availableMB} MB available, the machine has ${facts.freeMB} MB`)
  console.log(`  the confirmed margin   : ${facts.safeMB} MB   (the typical footprint of the language is 434 MB, not 2000 MB)`)
  console.log(`  >> the margin does not believe the drop: ${facts.safeMB === 0}`)
}

console.log('')
console.log('=== P11b: the same machine, with the valve on ===')
shutdownAll()
{
  const machine = { totalMB: 16 * 1024, freeMB: 2900 }
  const clock = { value: Date.now() }
  const { manager } = managerFor(machine, clock, {}, 2000)
  const root = join(tmpdir(), 'iwb-p11-valve')
  await manager.start({ root, languageId: 'typescript' })
  await sleep(120)
  const facts = await factsOf(manager, root)
  console.log(`  the state of the server: ${facts.state}`)
  console.log(`  >> the valve released it: ${facts.state === 'suspended'}`)
}

console.log('')
console.log('=== P11c: a server that is on its way out ===')
shutdownAll()
{
  const machine = { totalMB: 16 * 1024, freeMB: 3528 }
  const clock = { value: Date.now() }
  // The grace of the production settings: the window in which the ceiling
  // of the dying session is still charged lasts 2.5 seconds.
  const { manager } = managerFor(machine, clock, {}, 0, 2000)
  const healthy = join(tmpdir(), 'iwb-p11-healthy')
  const dying = join(tmpdir(), 'iwb-p11-dying')
  await manager.start({ root: healthy, languageId: 'typescript' })
  await sleep(120)
  await manager.start({ root: dying, languageId: 'typescript' })
  await sleep(120)
  const before = await factsOf(manager, healthy)
  console.log(`  before the shutdown    : confirmed margin=${before.safeMB} MB (the floor is 256 MB)`)
  const closing = manager.shutdown({ root: dying })
  await sleep(1500)
  const during = await factsOf(manager, healthy)
  console.log(`  while the other one dies: confirmed margin=${during.safeMB} MB, state=${during.state}`)
  console.log(`  >> the healthy server was not released: ${during.state !== 'suspended'}`)
  await closing
}
