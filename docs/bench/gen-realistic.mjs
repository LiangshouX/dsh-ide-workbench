/**
 * Generate a "realistic app repo" shape: many files, but a SHALLOW type graph
 * (each file imports one nearby module, not a shared hub). This brackets the
 * other end of the memory range vs the adversarial hub-import project.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const PROJECT = process.argv[2]
const FILE_COUNT = Number(process.argv[3] ?? 1500)
const LINES = Number(process.argv[4] ?? 150)

mkdirSync(join(PROJECT, 'src'), { recursive: true })
for (let f = 0; f < FILE_COUNT; f++) {
  const body = []
  body.push(`export interface Item${f} { id: string; count: number; label: string }`)
  body.push(`import { format${f} } from './util${f}'`)
  for (let i = 0; i < LINES; i++) {
    body.push(`export function step${f}_${i}(item: Item${f}): string {`)
    body.push(`  const n = item.count * ${i + 1}`)
    body.push(`  return format${f}(item.label) + ':' + n.toString() + item.id`)
    body.push(`}`)
  }
  writeFileSync(join(PROJECT, 'src', `mod${f}.ts`), body.join('\n'), 'utf8')
  writeFileSync(join(PROJECT, 'src', `util${f}.ts`),
    `export function format${f}(v: string): string { return v.trim().toUpperCase() + '${f}' }\n`, 'utf8')
}
writeFileSync(join(PROJECT, 'tsconfig.json'), JSON.stringify({
  compilerOptions: { target: 'ES2020', module: 'ESNext', moduleResolution: 'bundler', strict: false, skipLibCheck: true, noEmit: true },
  include: ['src'],
}, null, 2), 'utf8')
console.log(`generated realistic project: ${FILE_COUNT} modules + ${FILE_COUNT} utils`)
