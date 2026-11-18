import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const windows = process.platform === 'win32'
const installHelp =
  'Install a supported Node.js LTS release (npm is included): https://nodejs.org/en/download'
const npm = (args) =>
  spawnSync(windows ? 'npm.cmd' : 'npm', args, {
    cwd: root,
    stdio: 'inherit',
    shell: windows,
  })

function verifyRuntime(version) {
  const [major, minor] = version.split('.').map(Number)
  if (!((major === 22 && minor >= 16) || major >= 24)) {
    throw new Error(`Node.js ${version} is unsupported. Use Node.js 22.16+ (22.x) or 24+.\n${installHelp}`)
  }
  const result = npm(['--version'])
  if (result.error || result.status !== 0) throw new Error('npm is missing or could not run.\n' + installHelp)
}

function ensureDependencies() {
  const lock = new URL('../package-lock.json', import.meta.url)
  if (!existsSync(lock))
    throw new Error('package-lock.json is missing. Extract or download the full project and try again.')
  const stamp = new URL('../node_modules/.farm-planner-install', import.meta.url)
  const installedLock = new URL('../node_modules/.package-lock.json', import.meta.url)
  const metadata = readFileSync(new URL('../package.json', import.meta.url))
  const fingerprint = createHash('sha256')
    .update(readFileSync(lock))
    .update(metadata)
    .update(`${process.platform}:${process.arch}:${process.versions.modules}`)
    .digest('hex')
  const manifest = JSON.parse(metadata)
  const packages = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })
  if (
    existsSync(stamp) &&
    existsSync(installedLock) &&
    readFileSync(stamp, 'utf8') === fingerprint &&
    packages.every((name) =>
      existsSync(new URL('../node_modules/' + name + '/package.json', import.meta.url)),
    )
  )
    return

  console.log('Installing project dependencies from the lockfile. The first run may take a minute…')
  const result = npm(['ci', '--include=dev', '--no-audit', '--no-fund'])
  if (result.error || result.status !== 0) {
    throw new Error(
      'npm ci failed. Check your network connection and the npm message above, then run the launcher again.',
    )
  }
  writeFileSync(stamp, fingerprint)
}

function openBrowser(url) {
  const [command, args] = windows
    ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin'
      ? ['open', [url]]
      : ['xdg-open', [url]]
  const child = spawn(command, args, { stdio: 'ignore', windowsHide: true })
  const warn = () => console.warn('Could not open the browser automatically. Open ' + url)
  child.once('error', warn)
  child.once('exit', (code) => {
    if (code !== 0) warn()
  })
  child.unref()
}

try {
  verifyRuntime(process.versions.node)
  ensureDependencies()
  const { createServer } = await import('vite')
  const server = await createServer({ root, server: { host: '127.0.0.1' } })
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  if (!url) {
    await server.close()
    throw new Error('The server did not provide a local address.')
  }
  console.log(`\nFarm Planner is ready at ${url}\nPress Ctrl+C to stop.\n`)
  if (process.env.FARM_PLANNER_NO_BROWSER !== '1') openBrowser(url)
} catch (error) {
  console.error(
    '\nCould not start Farm Planner.\n' + (error instanceof Error ? error.message : String(error)),
  )
  process.exitCode = 1
}
