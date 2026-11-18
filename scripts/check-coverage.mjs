import { appendFile, readFile } from 'node:fs/promises'
import { relative } from 'node:path'
import { fileURLToPath, URL } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const report = JSON.parse(
  await readFile(new URL('../coverage/coverage-summary.json', import.meta.url), 'utf8'),
)
const modules = Object.entries(report)
  .filter(([file]) => file !== 'total')
  .map(([file, coverage]) => [relative(root, file).replaceAll('\\', '/'), coverage])

const gates = [
  { name: 'Overall domain', pattern: /^src\//, lines: 96, branches: 88 },
  {
    name: 'BOM and crafting',
    pattern: /^src\/(?:bom|crafting-[^/]+|farm-bom)\.ts$/,
    lines: 97,
    branches: 91,
  },
  { name: 'Seasonal crops', pattern: /^src\/crops\//, lines: 97, branches: 90 },
  {
    name: 'Farm layout and optimizer',
    pattern: /^src\/(?:coverage|equipment|model|optimizer|presets)\.ts$/,
    lines: 99,
    branches: 93,
  },
  {
    name: 'Persistence and backups',
    pattern: /^src\/(?:backup|storage|workspace-[^/]+)\.ts$/,
    lines: 91,
    branches: 83,
  },
]

function percentage(group, metric) {
  let covered = 0
  let total = 0
  for (const [file, coverage] of group) {
    const counts = coverage[metric]
    if (
      !Number.isSafeInteger(counts?.covered) ||
      !Number.isSafeInteger(counts.total) ||
      counts.covered < 0 ||
      counts.covered > counts.total
    ) {
      throw new Error(`Invalid ${metric} coverage counts for ${file}`)
    }
    covered += counts.covered
    total += counts.total
  }
  if (!total) throw new Error(`No ${metric} coverage counters found`)
  return (100 * covered) / total
}

const lines = [
  '### Domain coverage',
  '',
  '| Area | Lines (floor) | Branches (floor) | Gate |',
  '| --- | ---: | ---: | --- |',
]
for (const gate of gates) {
  const group = modules.filter(([file]) => gate.pattern.test(file))
  const lineCoverage = percentage(group, 'lines')
  const branchCoverage = percentage(group, 'branches')
  const passed = lineCoverage >= gate.lines && branchCoverage >= gate.branches
  if (!passed) process.exitCode = 1
  lines.push(
    `| ${gate.name} | ${lineCoverage.toFixed(2)}% (${gate.lines}%) | ${branchCoverage.toFixed(2)}% (${gate.branches}%) | ${passed ? 'Pass' : 'Fail'} |`,
  )
}

const summary = lines.join('\n') + '\n'
console.log(summary)
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary)
