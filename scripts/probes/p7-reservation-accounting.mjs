/**
 * P7: what the memory reservation really costs.
 *
 * The question: the host charges every running language server its CEILING
 * (`session.reservedBytes = memoryLimitMB * 1024 * 1024`, src/host/lsp.js:2316)
 * and subtracts the sum of those charges from the free memory of the machine
 * before it decides (src/host/lsp.js:1864).
 *
 * The suspicion: `os.freemem()` is the memory the machine has left AFTER the
 * running servers already took theirs. Subtracting their ceiling again is a
 * double count: the server is charged 2048 MB for a footprint of ~450 MB, so
 * the gate believes it owes 1598 MB more than the machine actually owes.
 *
 * Three accounting models are compared on the same machine:
 *
 *   A  current   : free - SUM(ceiling)
 *   B  growth    : free - SUM(ceiling - actual)   <- what is still owed
 *   C  actual    : free - SUM(actual)              <- what is already spent
 *
 * Nothing in the repository is modified: the probe only imports from it.
 */
import { freemem, totalmem } from 'node:os'
import { LspManager, DEFAULT_LSP_SETTINGS, LSP_REGISTRY, shutdownAll } from '../../src/host/lsp.js'

const MB = 1024 * 1024

/** The measured cost of one index on this box (perf report 2.1). */
const ACTUAL_INDEX_MB = 606

/**
 * A manager whose memory probe reports a simulated machine.
 *
 * @param {object} machine the simulated machine
 * @param {object[]} spawned the recorded spawns
 * @returns {LspManager}
 */
function managerFor(machine, spawned) {
  return new LspManager({
    ctx: { logger: { warn() {}, error() {}, info() {} } },
    getSettings: async () => ({ lsp: { ...DEFAULT_LSP_SETTINGS } }),
    spawnServer: async (spec) => {
      spawned.push(spec)
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
 * @returns {object} the result of the start
 */
async function start(manager, root) {
  return manager.start({ root, languageId: 'typescript' })
}

/**
 * Run the scenario of the user report: one index is already running, the
 * machine has 2648 MB left, and a second repository wants 621 MB.
 *
 * @returns {object} the report
 */
async function scenarioUserCase() {
  shutdownAll()
  const machine = { totalMB: 16 * 1024, freeMB: 3098 }
  const spawned = []
  const manager = managerFor(machine, spawned)

  // The first index starts on a machine with 3098 MB free.
  const first = await start(manager, 'C:\\probeB\\repo-a')
  // It really consumes its footprint: the machine's free memory drops.
  machine.freeMB = 2648

  // The second repository asks for its index.
  const second = await start(manager, 'C:\\probeB\\repo-b')
  const r = second.resources ?? {}

  // The live snapshot of the first root: what the gate sees right now.
  const live = await manager.status({ root: 'C:\\probeB\\repo-a' })
  const liveReservedMB = Math.round(((live.resources?.reservedBytes) ?? 0) / MB)

  const ceiling = LSP_REGISTRY.typescript.memoryLimitMB
  const modelA = machine.freeMB - ceiling                       // current
  const modelB = machine.freeMB - (ceiling - ACTUAL_INDEX_MB)    // growth
  const modelC = machine.freeMB - ACTUAL_INDEX_MB                // actual

  return {
    firstStarted: first.state === 'starting' || first.state === 'building',
    freeMB: machine.freeMB,
    reservedBytesMB: Math.round((r.reservedBytes ?? 0) / MB),
    liveReservedMB,
    availableBytesMB: Math.round((r.availableBytes ?? 0) / MB),
    needMB: r.needMB ?? null,
    softMB: Math.round((r.softThresholdBytes ?? 0) / MB),
    hardFloorMB: r.hardFloorMB ?? null,
    decision: r.decision ?? null,
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
 * The same machine, but the first index is NOT running yet: the reservation of
 * a server that does not exist must not block the first start.
 *
 * @returns {object} the report
 */
async function scenarioFirstIndex() {
  shutdownAll()
  const machine = { totalMB: 16 * 1024, freeMB: 2648 }
  const spawned = []
  const manager = managerFor(machine, spawned)
  const result = await start(manager, 'C:\\probeA\\repo-a')
  const r = result.resources ?? {}
  return {
    freeMB: machine.freeMB,
    reservedBytesMB: Math.round((r.reservedBytes ?? 0) / MB),
    availableBytesMB: Math.round((r.availableBytes ?? 0) / MB),
    decision: r.decision ?? null,
    state: result.state,
  }
}

/**
 * How many indexes does the PRODUCTION gate allow when the machine really
 * loses its measured footprint per index? The steps of one run, with the
 * numbers the gate used, plus the three accounting models computed on the
 * same machine.
 *
 * @param {number} freeMB the free memory at the start
 * @param {number} totalMB the total memory
 * @param {string} tag a unique root prefix
 * @returns {object} the steps
 */
async function scenarioHowMany(freeMB, totalMB, tag) {
  shutdownAll()
  const machine = { totalMB, freeMB }
  const spawned = []
  const manager = managerFor(machine, spawned)
  const steps = []
  const ceiling = LSP_REGISTRY.typescript.memoryLimitMB
  for (let i = 1; i <= 6; i += 1) {
    const freeBefore = machine.freeMB
    const result = await start(manager, `C:\\${tag}\\repo-${i}`)
    const r = result.resources ?? {}
    const ok = result.state === 'starting' || result.state === 'building'
    steps.push({
      index: i,
      freeBeforeMB: freeBefore,
      reservedMB: Math.round((r.reservedBytes ?? 0) / MB),
      availableMB: Math.round((r.availableBytes ?? 0) / MB),
      needMB: r.needMB ?? null,
      decision: r.decision ?? null,
      started: ok,
      // the three models on the same machine, after the indexes before it
      A_current: freeBefore - (i - 1) * ceiling,
      B_growth: freeBefore - (i - 1) * (ceiling - ACTUAL_INDEX_MB),
      C_actual: freeBefore - (i - 1) * ACTUAL_INDEX_MB,
    })
    if (!ok) break
    // The machine really loses the measured footprint of one index.
    machine.freeMB -= ACTUAL_INDEX_MB
  }
  return steps
}

/**
 * The self-count: a session that is asked to restart while its own
 * reservation is still on the books.
 *
 * @returns {object} the report
 */
async function scenarioSelfCount() {
  shutdownAll()
  const machine = { totalMB: 16 * 1024, freeMB: 2648 }
  const spawned = []
  const manager = managerFor(machine, spawned)
  const first = await start(manager, 'C:\\probeF\\repo-a')
  // The same root is asked again while the first session runs.
  const again = await start(manager, 'C:\\probeF\\repo-a')
  const states = manager.liveStates()
  return {
    firstState: first.state,
    againState: again.state,
    liveStates: [...states.entries()],
    spawnedCount: spawned.length,
  }
}

/**
 * The workspace switch: the client binds a new store to the session module
 * (`configureLsp`, src/client/lsp-session.js:1485) and RESETS `sessionRoot`
 * to ''. The next `refreshLsp()` therefore sees `previousRoot === ''` and does
 * NOT call `shutdownHostLsp(previousRoot)` - the host is never told to stop
 * the server of the workspace that was left.
 *
 * Two runs of the same machine: one without the shutdown (what the code does
 * today) and one with it (what the code should do).
 *
 * @returns {object} the report
 */
async function scenarioWorkspaceSwitch() {
  const run = async (withShutdown) => {
    shutdownAll()
    const machine = { totalMB: 16 * 1024, freeMB: 3098 }
    const spawned = []
    const manager = managerFor(machine, spawned)

    // The first workspace: its project is indexed.
    const a = await start(manager, 'C:\\wsA\\repo')
    machine.freeMB = 2648

    // The workspace switch. The client closes its socket (`stopLsp()`), but
    // the host is only told when `shutdownHostLsp` is called.
    if (withShutdown) await manager.shutdown({ root: 'C:\\wsA\\repo' })

    // The second workspace: its project is indexed.
    const b = await start(manager, 'C:\\wsB\\repo')
    const r = b.resources ?? {}
    return {
      firstState: a.state,
      withShutdown,
      reservedMB: Math.round((r.reservedBytes ?? 0) / MB),
      availableMB: Math.round((r.availableBytes ?? 0) / MB),
      needMB: r.needMB ?? null,
      decision: r.decision ?? null,
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
    probe: 'P7 - the reservation accounting',
    machine: {
      totalMB: Math.round(totalmem() / MB),
      freeMB: Math.round(freemem() / MB),
    },
    actualIndexMB: ACTUAL_INDEX_MB,
    ceilingMB: LSP_REGISTRY.typescript.memoryLimitMB,
  }

  out.firstIndex = await scenarioFirstIndex()
  out.userCase = await scenarioUserCase()
  out.howMany16GB = await scenarioHowMany(3852, 16 * 1024, 'probeC')
  out.howMany8GB = await scenarioHowMany(2048, 8 * 1024, 'probeD')
  out.selfCount = await scenarioSelfCount()
  out.workspaceSwitch = await scenarioWorkspaceSwitch()

  console.log('=== P7a: the first index on a machine with 2648 MB free ===')
  console.log(`  reserved=${out.firstIndex.reservedBytesMB}MB available=${out.firstIndex.availableBytesMB}MB decision=${out.firstIndex.decision} state=${out.firstIndex.state}`)

  console.log('')
  console.log('=== P7b: the user case - one index running, 2648 MB free, a second wants 621 MB ===')
  const u = out.userCase
  console.log(`  first index started : ${u.firstStarted}`)
  console.log(`  free                 : ${u.freeMB} MB`)
  console.log(`  reserved on the books: ${u.reservedBytesMB} MB (live snapshot of the running one: ${u.liveReservedMB} MB)`)
  console.log(`  available (A current): ${u.availableBytesMB} MB   need=${u.needMB}MB soft=${u.softMB}MB floor=${u.hardFloorMB}MB`)
  console.log(`  decision             : ${u.decision}  -> state=${u.secondState}`)
  console.log(`  detail               : ${u.secondDetail}`)
  console.log('  the three models on the same machine:')
  for (const [name, m] of Object.entries(u.models)) {
    console.log(`    ${name.padEnd(12)} available=${String(m.availableMB).padStart(5)} MB  passes(>=${u.needMB}MB)=${m.passes}`)
  }

  console.log('')
  console.log('=== P7c: the production gate on a 16 GB machine with 3852 MB free (the machine really loses 606 MB per index) ===')
  for (const s of out.howMany16GB) {
    console.log(`  #${s.index} free=${String(s.freeBeforeMB).padStart(5)} reserved=${String(s.reservedMB).padStart(4)} available=${String(s.availableMB).padStart(5)} need=${s.needMB} decision=${String(s.decision).padEnd(6)} started=${s.started}`)
    console.log(`      models: A_current=${s.A_current} MB   B_growth=${s.B_growth} MB   C_actual=${s.C_actual} MB`)
  }
  console.log('  === P7d: the same on an 8 GB machine with 2048 MB free ===')
  for (const s of out.howMany8GB) {
    console.log(`  #${s.index} free=${String(s.freeBeforeMB).padStart(5)} reserved=${String(s.reservedMB).padStart(4)} available=${String(s.availableMB).padStart(5)} need=${s.needMB} decision=${String(s.decision).padEnd(6)} started=${s.started}`)
    console.log(`      models: A_current=${s.A_current} MB   B_growth=${s.B_growth} MB   C_actual=${s.C_actual} MB`)
  }

  console.log('')
  console.log('=== P7e: the self count (the same root asked again) ===')
  console.log(`  first=${out.selfCount.firstState} again=${out.selfCount.againState} spawned=${out.selfCount.spawnedCount} live=${JSON.stringify(out.selfCount.liveStates)}`)

  console.log('')
  console.log('=== P7f: the workspace switch (the client never tells the host to stop) ===')
  const w = out.workspaceSwitch
  console.log(`  today (no shutdown of the old workspace): reserved=${w.today.reservedMB}MB available=${w.today.availableMB}MB decision=${w.today.decision} -> ${w.today.secondState}`)
  console.log(`      ${w.today.secondDetail ?? ''}`)
  console.log(`  with the shutdown:                      reserved=${w.withShutdown.reservedMB}MB available=${w.withShutdown.availableMB}MB decision=${w.withShutdown.decision} -> ${w.withShutdown.secondState}`)

  return out
}

const out = await main()
console.log('')
console.log(JSON.stringify(out, null, 2))
