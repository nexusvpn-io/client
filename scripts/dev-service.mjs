import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const developmentServiceDirectoryEnvironment = 'NEXUS_DEV_SERVICE_DIR'
const developmentServiceInstallerEnvironment = 'NEXUS_DEV_SERVICE_INSTALLER'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptDirectory, '..')
const serviceRepository = resolve(
  repositoryRoot,
  '..',
  'clash-verge-service-ipc',
)
const serviceManifest = join(serviceRepository, 'Cargo.toml')
const developmentReceipt = join(
  repositoryRoot,
  'target',
  'development-service.json',
)

function executable(name, platform) {
  return join(
    serviceRepository,
    'target',
    'debug',
    platform === 'win32' ? `${name}.exe` : name,
  )
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      env: options.env ?? process.env,
      stdio: options.stdio ?? 'inherit',
      windowsHide: true,
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise()
        return
      }
      const error = new Error(
        `${command} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}`,
      )
      error.exitCode = code
      reject(error)
    })
  })
}

async function hashFiles(paths) {
  const hash = createHash('sha256')
  for (const path of paths) {
    hash.update(await readFile(path))
  }
  return hash.digest('hex')
}

async function readInstalledFingerprint() {
  try {
    const parsed = JSON.parse(await readFile(developmentReceipt, 'utf8'))
    return typeof parsed.fingerprint === 'string' ? parsed.fingerprint : null
  } catch {
    return null
  }
}

async function writeInstalledFingerprint(fingerprint) {
  await mkdir(dirname(developmentReceipt), { recursive: true })
  await writeFile(
    developmentReceipt,
    `${JSON.stringify({ fingerprint }, null, 2)}\n`,
    'utf8',
  )
}

function windowsElevationInvocation(installer, environment = process.env) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$installer = [Environment]::GetEnvironmentVariable('${developmentServiceInstallerEnvironment}', 'Process')`,
    "if ([string]::IsNullOrWhiteSpace($installer)) { throw 'Development service installer path is missing' }",
    '$child = Start-Process -FilePath $installer -Verb RunAs -Wait -PassThru -WindowStyle Hidden',
    'exit $child.ExitCode',
  ].join('; ')
  return {
    command: 'powershell.exe',
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    env: {
      ...environment,
      [developmentServiceInstallerEnvironment]: installer,
    },
  }
}

async function elevateInstaller(installer, platform) {
  if (platform === 'win32') {
    const invocation = windowsElevationInvocation(installer)
    return run(invocation.command, invocation.args, { env: invocation.env })
  }

  if (platform === 'darwin') {
    const script =
      'on run argv\nset toolPath to item 1 of argv\nset groupId to item 2 of argv\ndo shell script "NEXUS_SERVICE_GID=" & quoted form of groupId & " " & quoted form of toolPath with administrator privileges\nend run'
    return run('osascript', ['-e', script, installer, String(process.getgid())])
  }

  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    return run(installer, [], {
      env: {
        ...process.env,
        NEXUS_SERVICE_GID: String(process.getgid()),
      },
    })
  }
  try {
    await run('pkexec', [installer])
  } catch (error) {
    if (error.code !== 'ENOENT' && error.exitCode !== 127) throw error
    await run('sudo', [installer])
  }
}

export async function prepareDevelopmentService({
  platform = process.platform,
} = {}) {
  await access(serviceManifest)
  await run('cargo', [
    'build',
    '--manifest-path',
    serviceManifest,
    '--features',
    'standalone,client,development-channel',
    '--bins',
  ])

  const service = executable('nexus-service', platform)
  await access(service)
  if (platform === 'linux') {
    const host = {
      x64: 'x86_64-unknown-linux-gnu',
      arm64: 'aarch64-unknown-linux-gnu',
      arm: 'armv7-unknown-linux-gnueabihf',
      riscv64: 'riscv64gc-unknown-linux-gnu',
      loong64: 'loongarch64-unknown-linux-gnu',
    }[process.arch]
    if (!host) throw new Error('Unable to determine the Rust host target')
    const sidecarDirectory = join(repositoryRoot, 'src-tauri', 'sidecar')
    await mkdir(sidecarDirectory, { recursive: true })
    for (const name of [
      'nexus-service',
      'nexus-service-install',
      'nexus-service-uninstall',
    ]) {
      await copyFile(
        executable(name, platform),
        join(sidecarDirectory, `${name}-${host}`),
      )
    }
  }
  return dirname(service)
}

export async function ensureDevelopmentService({
  platform = process.platform,
} = {}) {
  const serviceDirectory = await prepareDevelopmentService({ platform })
  const service = join(
    serviceDirectory,
    platform === 'win32' ? 'nexus-service.exe' : 'nexus-service',
  )
  const installer = join(
    serviceDirectory,
    platform === 'win32'
      ? 'nexus-service-install.exe'
      : 'nexus-service-install',
  )
  const driver = join(
    serviceDirectory,
    platform === 'win32'
      ? 'service-integration-driver.exe'
      : 'service-integration-driver',
  )
  const fingerprint = await hashFiles([service, installer])
  const installedFingerprint = await readInstalledFingerprint()

  if (installedFingerprint === fingerprint) {
    try {
      await run(driver, ['probe'], { stdio: 'ignore' })
      return serviceDirectory
    } catch {
      // The expected binary is installed but unavailable; the repair tool owns recovery.
    }
  }

  try {
    await elevateInstaller(installer, platform)
  } catch (error) {
    if (error.exitCode !== 75) throw error
  }
  await run(driver, ['ready'])
  await writeInstalledFingerprint(fingerprint)
  return serviceDirectory
}
