import { join } from 'node:path'
import { readdir, stat, appendFile } from 'node:fs/promises'

const output = new URL('../dist/', import.meta.url)
const totals = { JavaScript: 0, CSS: 0, 'Production output': 0 }
for (const entry of await readdir(output, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile()) continue
  const { size } = await stat(join(entry.parentPath, entry.name))
  totals['Production output'] += size
  if (/\.[cm]?js$/.test(entry.name)) totals.JavaScript += size
  if (entry.name.endsWith('.css')) totals.CSS += size
}

const summary = [
  '### Production build size',
  '',
  '| Output | Uncompressed bytes |',
  '| --- | ---: |',
  ...Object.entries(totals).map(([name, bytes]) => `| ${name} | ${bytes.toLocaleString('en-US')} |`),
  '',
].join('\n')
console.log(summary)
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary)
