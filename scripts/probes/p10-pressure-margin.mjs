/**
 * P10: the confirmed margin of the machine (review round 3, R1).
 *
 * The difference method of MEM-06 measures the drop of the free memory of
 * the machine. When the drop FITS inside the room the language servers still
 * have, the host books it on them - and the method cannot say whose growth
 * it was. A foreign program that eats 1400 MB in a minute is therefore
 * booked on the servers: their reservation collapses, the available memory
 * of the account stays where it was, and the pressure valve (MEM-12) - which
 * watched that account - never fires while the machine is really out of
 * memory.
 *
 * The fix: the valve counts the CONFIRMED footprint (the one measured in
 * the spawn window, where the server itself was the main cause of the
 * change) and not the measured one. The account stays the number of the
 * gate and of the panel.
 *
 * The probe walks the cases with the production `LspManager` and a machine
 * that can be squeezed. Nothing in the repository is modified: the probe
 * only imports from it.
 */
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { LspManager, DEFAULT_LSP_SETTINGS, shutdownAll } from '../../src/host/lsp.js'

const MB = 1024 * 1024
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms) })

/**
 * A manager whose machine can be squeezed, with a clock that only moves when
 * the probe moves it (the measurement round and the pressure check run on
 * that clock).
 * @param {object} machine the simulated machine
 * @param {{value: number}} clock the clock of the probe
 * @param {object} [lsp] the `lsp` section of the settings
 * @returns {{manager: object, warnings: string[]}} the manager and its warnings
 */
function managerFor(machine, clock, lsp = {}) {
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
    now: () => clock.value,
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
 * @returns {Promise<object>} the numbers
 */
async function factsOf(manager, root) {
  const status = await manager.status({ root })
  const r = status.resources ?? {}
  return {
    state: status.state,
    measuredMB: Math.round((r.measuredBytes ?? 0) / MB),
    reservedMB: Math.round((r.reservedBytes ?? 0) / MB),
    availableMB: Math.round((r.availableBytes ?? 0) / MB),
    safeMB: Math.round((r.safeAvailableBytes ?? 0) / MB),
    freeMB: Math.round((r.freeBytes ?? 0) / MB),
  }
}

/**
 * Let the watchdog tick: the measurement round and the pressure check ride
 * on it, and both of them watch the clock of the probe.
 * @param {{value: number}} clock the clock of the probe
 * @param {number} ms how far the clock moves
 * @returns {Promise<void>}
 */
async function advance(clock, ms) {
  clock.value += ms
  // The watchdog runs every 25 ms of real time in this configuration.
  await sleep(120)
}

console.log('=== P10a: the difference FITS the room, and it was not the server ===')
shutdownAll()
{
  const machine = { totalMB: 16 * 1024, freeMB: 2900 }
  const clock = { value: Date.now() }
  const { manager } = managerFor(machine, clock)
  const root = join(tmpdir(), 'iwb-p10-fit')
  await manager.start({ root, languageId: 'typescript' })
  await sleep(50)
  const afterSpawn = await factsOf(manager, root)
  // Another program takes 1400 MB. It FITS the room of the server
  // (2048 - 600 = 1448), so the host cannot tell it from the server's own
  // growth and books it on the server.
  machine.freeMB -= 1400
  await advance(clock, 61000)
  const afterRound = await factsOf(manager, root)
  console.log(`  after the spawn      : measured=${afterSpawn.measuredMB} MB reserved=${afterSpawn.reservedMB} MB available=${afterSpawn.availableMB} MB free=${afterSpawn.freeMB} MB`)
  console.log(`  after the 1400 MB loss: measured=${afterRound.measuredMB} MB reserved=${afterRound.reservedMB} MB available=${afterRound.availableMB} MB free=${afterRound.freeMB} MB confirmed margin=${afterRound.safeMB} MB`)
  console.log(`  the truth of the room : the server takes 600 MB, so it may still take 1448 MB of a machine with ${afterRound.freeMB} MB free => ${afterRound.freeMB - 1448} MB`)
  console.log(`  the account stayed    : ${afterRound.availableMB === afterSpawn.availableMB} (the foreign growth was booked on the server)`)
  console.log(`  the valve released it : ${afterRound.state === 'suspended'}`)
  console.log(`  >> the valve sees the confirmed margin: ${afterRound.safeMB} MB, the account says ${afterRound.availableMB} MB`)
}

console.log('')
console.log('=== P10b: a machine that leaks 100 MB per minute ===')
shutdownAll()
{
  const machine = { totalMB: 16 * 1024, freeMB: 2900 }
  const clock = { value: Date.now() }
  const { manager } = managerFor(machine, clock)
  const root = join(tmpdir(), 'iwb-p10-leak')
  await manager.start({ root, languageId: 'typescript' })
  await sleep(50)
  let released = false
  let releasedAt = null
  for (let round = 1; round <= 8; round += 1) {
    machine.freeMB -= 100
    await advance(clock, 61000)
    const facts = await factsOf(manager, root)
    const truth = facts.freeMB - 1448
    console.log(`  round ${String(round).padStart(2)}: free=${facts.freeMB} MB account=${facts.availableMB} MB confirmed=${facts.safeMB} MB truth=${truth} MB state=${facts.state}`)
    if (!released && facts.state === 'suspended') {
      released = true
      releasedAt = round
    }
  }
  console.log(`  >> the valve released it in the round ${releasedAt} (the truth crosses the floor in the round 6)`)
  console.log(`  >> it fired exactly when the truth did: ${releasedAt === 6}`)
}

console.log('')
console.log('=== P10c: a healthy machine must not be touched ===')
shutdownAll()
{
  const machine = { totalMB: 16 * 1024, freeMB: 8000 }
  const clock = { value: Date.now() }
  const { manager } = managerFor(machine, clock)
  const root = join(tmpdir(), 'iwb-p10-healthy')
  await manager.start({ root, languageId: 'typescript' })
  await sleep(50)
  machine.freeMB -= 1400
  await advance(clock, 61000)
  const facts = await factsOf(manager, root)
  console.log(`  after the 1400 MB loss: available=${facts.availableMB} MB confirmed=${facts.safeMB} MB free=${facts.freeMB} MB state=${facts.state}`)
  console.log(`  >> the server is still there: ${facts.state !== 'suspended'}`)
  console.log(`  >> the confirmed margin is never bigger than the account: ${facts.safeMB <= facts.availableMB}`)
}
