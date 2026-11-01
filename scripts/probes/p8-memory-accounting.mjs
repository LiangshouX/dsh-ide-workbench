/**
 * P8: the memory accounting AFTER PRD-v5.1.
 *
 * P7 (`p7-reservation-accounting.mjs`) showed that the gate charged every
 * running language server its CEILING on top of the real footprint that
 * `os.freemem()` had already subtracted: the same server was counted twice.
 * The user saw it as "2648 MB free, the index needs 621 MB, and the gate says
 * the machine cannot afford it".
 *
 * PRD-v5.1 fixes the books:
 *
 *   A  before  : free - SUM(ceiling)              <- the double count
 *   B  now     : free - SUM(ceiling - measured)   <- what is still owed
 *   C  measured: free - SUM(measured)             <- what is already spent
 *
 * The probe walks the same scenarios as P7 and reports the new numbers, so
 * the two probes can be compared line by line.
 *
 * Nothing in the repository is modified: the probe only imports from it.
 *
 * The difference method of MEM-06 is exercised for real here: the simulated
 * machine really loses the footprint of every server that is spawned, so the
 * `freemem()` delta the host measures is the real delta.
 */
import { freemem, totalmem } from 'node:os'
import { LspManager, DEFAULT_LSP_SETTINGS, LSP_REGISTRY, shutdownAll } from '../../src/host/lsp.js'

const MB = 1024 * 1024

/** The measured cost of one index on this box (perf report 2.1). */
const ACTUAL_INDEX_MB = 606

/**
 * A manager whose memory probe reports a simulated machine.
 *
 * The simulated machine really loses the footprint of every server that is
 * spawned - that is what makes the difference method of MEM-06 measure the
 * real thing instead of a noise band.
 *
 * @param {object} machine the simulated machine
 * @param {object[]} spawned the recorded spawns
 * @param {number} [footprintMB] the footprint one server takes
 * @returns {LspManager}
 */
function managerFor(machine, spawned, footprintMB = ACTUAL_INDEX_MB) {
  return new LspManager({
    ctx: { logger: { warn() {}, error() {}, info() {} } },
    getSettings: async () => ({ lsp: { ...DEFAULT_LSP_SETTINGS } }),
    spawnServer: async (spec) => {
      spawned.push(spec)
      // The server takes its memory now: the free memory of the machine
      // drops by its measured footprint.
      machine.freeMB -= footprintMB
      return {
        stdin: null, stdout: null, stderr: null,
        done: new Promise(() => {}),
        terminate() {}, waitForExit: async () => true,
      }
    },
    createWorker: () => ({ on() {}, off() {}, postMessage() {}, terminate() {} }),
    readMemory: () => ({
      totalBytes: machine.totalMB * MB,
      freeBytes: machine.freeMB * MB,
    }),
    readyDelayMs: 1,
    restartBackoffMs: 1,
    graceMs: 1,
  })
}

/**
 * Start one root and report what the host decided.
 *
 * @param {LspManager} manager the manager
 * @param {string} root the root
 * @param {object} [extra] extra start options
 * @returns {object} the result of the start
 */
async function start(manager, root, extra = {}) {
  return manager.start({ root, languageId: 'typescript', ...extra })
}

/**
 * The rows of the snapshot that the probe reports.
 * @param {object} resources the snapshot
 * @returns {object}
 */
function facts(resources) {
  const r = resources ?? {}
  return {
    reservedMB: Math.round((r.reservedBytes ?? 0) / MB),
    measuredMB: Math.round((r.measuredBytes ?? 0) / MB),
    availableMB: Math.round((r.availableBytes ?? 0) / MB),
    freeMB: Math.round((r.freeBytes ?? 0) / MB),
    needMB: r.needMB ?? null,
    ceilingMB: r.ceilingMB ?? null,
    softMB: Math.round((r.softThresholdBytes ?? 0) / MB),
    hardFloorMB: r.hardFloorMB ?? null,
    worstCaseMB: Math.round((r.worstCaseBytes ?? 0) / MB),
    worstCase: r.worstCase ?? null,
    budgetMB: Math.round((r.budgetBytes ?? 0) / MB),
    budgetUsedMB: Math.round((r.budgetUsedBytes ?? 0) / MB),
    decision: r.decision ?? null,
  }
}

/**
 * The first index on a machine that has enough memory.
 * @returns {object} the report
 */
async function scenarioFirstIndex() {
  shutdownAll()
  const machine = { totalMB: 16 * 1024, freeMB: 2648 }
  const spawned = []
  const manager = managerFor(machine, spawned)
  const result = await start(manager, 'C:\\probeA\\repo-a')
  return { state: result.state, ...facts(result.resources), machineFreeMB: machine.freeMB }
}

/**
 * The user case of the bug report: one index is running, the machine has
 * 2648 MB left, and a second repository wants 621 MB.
 *
 * The acceptance of MEM-05: available = 1206 MB and the gate lets it start.
 * @returns {object} the report
 */
async function scenarioUserCase() {
  shutdownAll()
  // The machine has 3254 MB before the first index starts: the index takes
  // its measured footprint (606 MB) while it comes up, so the machine is
  // left with the 2648 MB of the bug report.
  const machine = { totalMB: 16 * 1024, freeMB: 3254 }
  const spawned = []
  const manager = managerFor(machine, spawned)

  const first = await start(manager, 'C:\\probeB\\repo-a')
  // The machine has really lost the footprint of the first index.
  const freeAfterFirst = machine.freeMB

  const second = await start(manager, 'C:\\probeB\\repo-b')
  const r = second.resources ?? {}

  const ceiling = LSP_REGISTRY.typescript.memoryLimitMB
  const modelA = freeAfterFirst - ceiling
  const modelB = freeAfterFirst - (ceiling - ACTUAL_INDEX_MB)
  const modelC = freeAfterFirst - ACTUAL_INDEX_MB

  return {
    firstStarted: first.state === 'starting' || first.state === 'building',
    freeMB: freeAfterFirst,
    ...facts(r),
    secondState: second.state,
    secondDetail: second.detail,
    models: {
      A_current: { availableMB: modelA, passes: modelA >= (r.needMB ?? 0) },
      B_growth: { availableMB: modelB, passes: modelB >= (r.needMB ?? 0) },
      C_actual: { availableMB: modelC, passes: modelC >= (r.needMB ?? 0) },
    },
  }
}

/**
 * How many indexes the production gate allows when the machine really loses
 * its measured footprint per index.
 * @param {number} freeMB the free memory at the start
 * @param {number} totalMB the total memory
 * @param {string} tag a unique root prefix
 * @returns {object[]} the steps
 */
async function scenarioHowMany(freeMB, totalMB, tag) {
  shutdownAll()
  const machine = { totalMB, freeMB }
  const spawned = []
  const manager = managerFor(machine, spawned)
  const steps = []
  for (let i = 1; i <= 8; i += 1) {
    const freeBefore = machine.freeMB
    const result = await start(manager, `C:\\${tag}\\repo-${i}`)
    const r = result.resources ?? {}
    const ok = result.state === 'starting' || result.state === 'building'
    steps.push({
      index: i,
      freeBeforeMB: freeBefore,
      ...facts(r),
      started: ok,
    })
    if (!ok) break
  }
  return steps
}

/**
 * The machine-level budget of MEM-08: the sum of the ceilings of the running
 * servers may not exceed the budget of the machine.
 * @returns {object} the report
 */
async function scenarioBudget() {
  shutdownAll()
  const machine = { totalMB: 16 * 1024, freeMB: 8000 }
  const spawned = []
  const manager = managerFor(machine, spawned)
  const steps = []
  for (let i = 1; i <= 8; i += 1) {
    const result = await start(manager, `C:\\probeE\\repo-${i}`)
    const r = result.resources ?? {}
    const ok = result.state === 'starting' || result.state === 'building'
    steps.push({
      index: i,
      ...facts(r),
      started: ok,
      detail: result.detail ?? null,
    })
    if (!ok) break
  }
  return steps
}

/**
 * The workspace switch of WS-01/WS-02: the host is told to stop the server of
 * the workspace that was left, so the second workspace does not pay for it.
 * @returns {object} the report
 */
async function scenarioWorkspaceSwitch() {
  const run = async (withShutdown) => {
    shutdownAll()
    // 3254 MB before the first index: 2648 MB after it took its footprint.
    const machine = { totalMB: 16 * 1024, freeMB: 3254 }
    const spawned = []
    const manager = managerFor(machine, spawned)

    const a = await start(manager, 'C:\\wsA\\repo')
    if (withShutdown) await manager.shutdown({ root: 'C:\\wsA\\repo' })
    const b = await start(manager, 'C:\\wsB\\repo')
    const r = b.resources ?? {}
    return {
      firstState: a.state,
      withShutdown,
      ...facts(r),
      secondState: b.state,
      secondDetail: b.detail,
    }
  }
  return {
    today: await run(false),
    withShutdown: await run(true),
  }
}

async function main() {
  const out = {
    probe: 'P8 - the memory accounting after PRD-v5.1',
    machine: {
      totalMB: Math.round(totalmem() / MB),
      freeMB: Math.round(freemem() / MB),
    },
    actualIndexMB: ACTUAL_INDEX_MB,
    registryCeilingMB: LSP_REGISTRY.typescript.memoryLimitMB,
  }

  out.firstIndex = await scenarioFirstIndex()
  out.userCase = await scenarioUserCase()
  out.howMany16GB = await scenarioHowMany(3852, 16 * 1024, 'probeC')
  out.howMany8GB = await scenarioHowMany(2048, 8 * 1024, 'probeD')
  out.budget = await scenarioBudget()
  out.workspaceSwitch = await scenarioWorkspaceSwitch()

  console.log('=== P8a: the first index on a machine with 2648 MB free ===')
  console.log(`  reserved=${out.firstIndex.reservedMB}MB measured=${out.firstIndex.measuredMB}MB available=${out.firstIndex.availableMB}MB decision=${out.firstIndex.decision} state=${out.firstIndex.state}`)

  console.log('')
  console.log('=== P8b: the user case - one index running, 2648 MB free, a second wants 621 MB ===')
  const u = out.userCase
  console.log(`  first index started : ${u.firstStarted}`)
  console.log(`  free                 : ${u.freeMB} MB`)
  console.log(`  reserved on the books: ${u.reservedMB} MB   measured: ${u.measuredMB} MB   ceiling: ${u.ceilingMB} MB`)
  console.log(`  available            : ${u.availableMB} MB   need=${u.needMB}MB soft=${u.softMB}MB floor=${u.hardFloorMB}MB`)
  console.log(`  worst case           : ${u.worstCaseMB} MB (breached: ${u.worstCase})`)
  console.log(`  decision             : ${u.decision}  -> state=${u.secondState}`)
  console.log(`  detail               : ${u.secondDetail}`)
  console.log('  the three models on the same machine:')
  for (const [name, m] of Object.entries(u.models)) {
    console.log(`    ${name.padEnd(12)} available=${String(m.availableMB).padStart(5)} MB  passes(>=${u.needMB}MB)=${m.passes}`)
  }

  console.log('')
  console.log('=== P8c: the production gate on a 16 GB machine with 3852 MB free ===')
  for (const s of out.howMany16GB) {
    console.log(`  #${s.index} free=${String(s.freeBeforeMB).padStart(5)} reserved=${String(s.reservedMB).padStart(4)} measured=${String(s.measuredMB).padStart(4)} available=${String(s.availableMB).padStart(5)} need=${s.needMB} decision=${String(s.decision).padEnd(6)} started=${s.started}`)
  }
  console.log('  === P8d: the same on an 8 GB machine with 2048 MB free ===')
  for (const s of out.howMany8GB) {
    console.log(`  #${s.index} free=${String(s.freeBeforeMB).padStart(5)} reserved=${String(s.reservedMB).padStart(4)} measured=${String(s.measuredMB).padStart(4)} available=${String(s.availableMB).padStart(5)} need=${s.needMB} decision=${String(s.decision).padEnd(6)} started=${s.started}`)
  }

  console.log('')
  console.log('=== P8e: the machine-level budget (MEM-08) on a 16 GB machine with 8000 MB free ===')
  for (const s of out.budget) {
    console.log(`  #${s.index} budget=${String(s.budgetMB).padStart(5)}MB used=${String(s.budgetUsedMB).padStart(5)}MB available=${String(s.availableMB).padStart(5)}MB decision=${String(s.decision).padEnd(6)} started=${s.started}`)
    if (!s.started) console.log(`      ${s.detail ?? ''}`)
  }

  console.log('')
  console.log('=== P8f: the workspace switch (the host is told to stop the old server) ===')
  const w = out.workspaceSwitch
  console.log(`  today (no shutdown of the old workspace): reserved=${w.today.reservedMB}MB available=${w.today.availableMB}MB decision=${w.today.decision} -> ${w.today.secondState}`)
  console.log(`      ${w.today.secondDetail ?? ''}`)
  console.log(`  with the shutdown:                      reserved=${w.withShutdown.reservedMB}MB available=${w.withShutdown.availableMB}MB decision=${w.withShutdown.decision} -> ${w.withShutdown.secondState}`)

  return out
}

const out = await main()
console.log('')
console.log(JSON.stringify(out, null, 2))
