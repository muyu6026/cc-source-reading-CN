/**
 * Native Installer Implementation
 *
 * This module implements the file-based native installer system described in
 * docs/native-installer.md. It provides:
 * - Directory structure management with symlinks
 * - Version installation and activation
 * - Multi-process safety with locking
 * - Simple fallback mechanism using modification time
 * - Support for both JS and native builds
 */

import { constants as fsConstants, type Stats } from 'fs'
import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdir,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'fs/promises'
import { homedir } from 'os'
import { basename, delimiter, dirname, join, resolve } from 'path'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { getMaxVersion, shouldSkipVersion } from '../autoUpdater.js'
import { registerCleanup } from '../cleanupRegistry.js'
import { getGlobalConfig, saveGlobalConfig } from '../config.js'
import { logForDebugging } from '../debug.js'
import { getCurrentInstallationType } from '../doctorDiagnostic.js'
import { env } from '../env.js'
import { envDynamic } from '../envDynamic.js'
import { isEnvTruthy } from '../envUtils.js'
import { errorMessage, getErrnoCode, isENOENT, toError } from '../errors.js'
import { execFileNoThrowWithCwd } from '../execFileNoThrow.js'
import { getShellType } from '../localInstaller.js'
import * as lockfile from '../lockfile.js'
import { logError } from '../log.js'
import { gt, gte } from '../semver.js'
import {
  filterClaudeAliases,
  getShellConfigPaths,
  readFileLines,
  writeFileLines,
} from '../shellConfig.js'
import { sleep } from '../sleep.js'
import {
  getUserBinDir,
  getXDGCacheHome,
  getXDGDataHome,
  getXDGStateHome,
} from '../xdg.js'
import { downloadVersion, getLatestVersion } from './download.js'
import {
  acquireProcessLifetimeLock,
  cleanupStaleLocks,
  isLockActive,
  isPidBasedLockingEnabled,
  readLockContent,
  withLock,
} from './pidLock.js'
// 原生安装器的全部实现（1,708 行）。它只做一件事——把下载下来的可执行文件放进版本目录、再让用户 bin 下的入口指向它——但要同时满足三个约束：多进程同时更新不打架、更新时正在运行的进程不被删掉、失败时不留半截安装。目录分三层：版本（永久）、暂存（可删）、锁（状态），全部走 XDG 规范。核心手法只有两个：原子 rename，以及「给正在运行的版本上锁」。文件里几乎没有业务逻辑，全是文件系统语义的细节，读它的价值在于看一份跨平台安装器究竟要处理多少种失败模式。

export const VERSION_RETENTION_COUNT = 2
// 保留两个版本（当前 + 上一个）。这不是为了「方便回滚」这种模糊理由，而是给清理逻辑留余量：正在运行的二进制必须留、符号链接指向的必须留，剩下还能删的才删。只留一个意味着更新瞬间就可能把用户唯一能用的版本删掉。

// 7 days in milliseconds - used for mtime-based lock stale timeout.
// This is long enough to survive laptop sleep durations while still
// allowing cleanup of abandoned locks from crashed processes within a reasonable time.
const LOCK_STALE_MS = 7 * 24 * 60 * 60 * 1000
// 注释说「7 天」，但下面两处内联注释都写「30 天」，正文里也反复出现 30 天——这是文档与常量漂移的痕迹，实际生效的是 7 天。7 天的理由本身是成立的：要熬过笔记本睡眠（进程被挂起、mtime 心跳停止），又要在合理时间内清掉崩溃进程留下的锁。读这段别被那几处 30 天误导。

export type SetupMessage = {
  message: string
  userActionRequired: boolean
  type: 'path' | 'alias' | 'info' | 'error'
}

export function getPlatform(): string {
  // Use env.platform which already handles platform detection and defaults to 'linux'
  const os = env.platform

  const arch =
    process.arch === 'x64' ? 'x64' : process.arch === 'arm64' ? 'arm64' : null

  if (!arch) {
    const error = new Error(`Unsupported architecture: ${process.arch}`)
    logForDebugging(
      `Native installer does not support architecture: ${process.arch}`,
      { level: 'error' },
    )
    throw error
  }

  // Check for musl on Linux and adjust platform accordingly
  if (os === 'linux' && envDynamic.isMuslEnvironment()) {
    return `linux-${arch}-musl`
  }

  return `${os}-${arch}`
}
// 平台标识决定下载哪个二进制包。三件事：只支持 x64 与 arm64（其它架构直接抛，因为根本没有对应产物）；Linux 上还要探 musl 与 glibc——阿尔卑斯这类发行版用 musl，二进制不兼容，所以平台串要带 musl 后缀；其余平台拼成系统加架构。不支持时**抛错而不是降级**，因为装一个跑不起来的二进制比装失败更糟。

export function getBinaryName(platform: string): string {
  return platform.startsWith('win32') ? 'claude.exe' : 'claude'
}
// Windows 上叫带 exe 后缀的名字，其它平台无后缀。这个差异在后面每个涉及可执行性的判断里都会再出现一次——Windows 靠扩展名决定能否执行，Unix 靠权限位。

function getBaseDirectories() {
  const platform = getPlatform()
  const executableName = getBinaryName(platform)

  return {
    // Data directories (permanent storage)
    versions: join(getXDGDataHome(), 'claude', 'versions'),

    // Cache directories (can be deleted)
    staging: join(getXDGCacheHome(), 'claude', 'staging'),

    // State directories
    locks: join(getXDGStateHome(), 'claude', 'locks'),

    // User bin
    executable: join(getUserBinDir(), executableName),
  }
}
// 四个目录按生命周期分：版本目录是永久存储（XDG data）、暂存目录可随时删（XDG cache）、锁目录放状态（XDG state）、用户 bin 是最终入口。分开放的实质意义是「用户清缓存不会删掉已装版本」，因为 cache 目录是各类清理工具的默认目标。

async function isPossibleClaudeBinary(filePath: string): Promise<boolean> {
  try {
    const stats = await stat(filePath)
    // before download, the version lock file (located at the same filePath) will be size 0
    // also, we allow small sizes because we want to treat small wrapper scripts as valid
    if (!stats.isFile() || stats.size === 0) {
      return false
    }

    // Check if file is executable. Note: On Windows, this relies on file extensions
    // (.exe, .bat, .cmd) and ACL permissions rather than Unix permission bits,
    // so it may not work perfectly for all executable files on Windows.
    await access(filePath, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}
// 「这个路径像不像一个能跑的二进制」只有三条判据：是普通文件、非空、可执行。注释交代了两个细节：下载前同路径会先放一个 0 字节的锁文件占位，所以要排除空文件；允许小体积是为了把小体积包装脚本也当合法。Windows 上可执行位这条实际不起作用（靠扩展名与 ACL），注释坦白承认「可能不完美」——这里是纵深防御，不是精确判断。

async function getVersionPaths(version: string) {
  const dirs = getBaseDirectories()

  // Create directories, but not the executable path (which is a file)
  const dirsToCreate = [dirs.versions, dirs.staging, dirs.locks]
  await Promise.all(dirsToCreate.map(dir => mkdir(dir, { recursive: true })))

  // Ensure parent directory of executable exists
  const executableParentDir = dirname(dirs.executable)
  await mkdir(executableParentDir, { recursive: true })

  const installPath = join(dirs.versions, version)

  // Create an empty file if it doesn't exist
  try {
    await stat(installPath)
  } catch {
    await writeFile(installPath, '', { encoding: 'utf8' })
  }

  return {
    stagingPath: join(dirs.staging, version),
    installPath,
  }
}
// 建齐三个目录并返回「暂存路径 + 安装路径」。有个容易被忽略的写操作：安装路径那个文件（版本目录里放的是**文件**不是子目录）若不存在就先创建 0 字节文件——因为后续要把它当锁的目标，而锁要求目标存在。注释特意点出「不创建可执行文件那个路径，它是文件不是目录」。

// Execute a callback while holding a lock on a version file
// Returns false if the file is already locked, true if callback executed
async function tryWithVersionLock(
  versionFilePath: string,
  callback: () => void | Promise<void>,
  retries = 0,
): Promise<boolean> {
  const dirs = getBaseDirectories()

  const lockfilePath = getLockFilePathFromVersionPath(dirs, versionFilePath)

  // Ensure the locks directory exists
  await mkdir(dirs.locks, { recursive: true })

  if (isPidBasedLockingEnabled()) {
    // Use PID-based locking with optional retries
    let attempts = 0
    const maxAttempts = retries + 1
    const minTimeout = retries > 0 ? 1000 : 100
    const maxTimeout = retries > 0 ? 5000 : 500

    while (attempts < maxAttempts) {
      const success = await withLock(
        versionFilePath,
        lockfilePath,
        async () => {
          try {
            await callback()
          } catch (error) {
            logError(error)
            throw error
          }
        },
      )

      if (success) {
        logEvent('tengu_version_lock_acquired', {
          is_pid_based: true,
          is_lifetime_lock: false,
          attempts: attempts + 1,
        })
        return true
      }

      attempts++
      if (attempts < maxAttempts) {
        // Wait before retrying with exponential backoff
        const timeout = Math.min(
          minTimeout * Math.pow(2, attempts - 1),
          maxTimeout,
        )
        await sleep(timeout)
      }
    }

    logEvent('tengu_version_lock_failed', {
      is_pid_based: true,
      is_lifetime_lock: false,
      attempts: maxAttempts,
    })
    logLockAcquisitionError(
      versionFilePath,
      new Error('Lock held by another process'),
    )
    return false
  }
// PID 锁相对 mtime 锁的关键优势写在注释里：能**立即**发现崩溃进程（PID 不存在就是死了），而 mtime 锁只能等超时。重试策略是「有重试时起点 1 秒、上限 5 秒，没有则 100 到 500 毫秒」的指数退避——因为锁竞争通常意味着「另一个进程正在下载几百兆」，短等没用。

  // Use mtime-based locking (proper-lockfile) with 30-day stale timeout
  let release: (() => Promise<void>) | null = null
  try {
    // Lock acquisition phase - catch lock errors and return false
    // Use 30 days for stale to match lockCurrentVersion() - this ensures we never
    // consider a running process's lock as stale during normal usage (including
    // laptop sleep). 30 days allows eventual cleanup of abandoned locks from
    // crashed processes while being long enough for any realistic session.
    try {
      release = await lockfile.lock(versionFilePath, {
        stale: LOCK_STALE_MS,
        retries: {
          retries,
          minTimeout: retries > 0 ? 1000 : 100,
          maxTimeout: retries > 0 ? 5000 : 500,
        },
        lockfilePath,
        // Handle lock compromise gracefully to prevent unhandled rejections
        // This can happen if another process deletes the lock directory while we hold it
        onCompromised: (err: Error) => {
          logForDebugging(
            `NON-FATAL: Version lock was compromised during operation: ${err.message}`,
            { level: 'info' },
          )
        },
      })
    } catch (lockError) {
      logEvent('tengu_version_lock_failed', {
        is_pid_based: false,
        is_lifetime_lock: false,
      })
      logLockAcquisitionError(versionFilePath, lockError)
      return false
    }
// 锁获取失败是**预期路径**而不是异常：埋点名是失败，但函数返回 false 让调用方决定（上层会带着持锁进程 PID 返回一个「别人正在装」的结果）。注意 `onCompromised` 回调——另一个进程删掉锁目录时不能抛未处理拒绝，只能记一条非致命日志：锁被抢走不该让整个进程崩。

    // Operation phase - log errors but let them propagate
    try {
      await callback()
      logEvent('tengu_version_lock_acquired', {
        is_pid_based: false,
        is_lifetime_lock: false,
      })
      return true
    } catch (error) {
      logError(error)
      throw error
    }
  } finally {
    if (release) {
      await release()
    }
  }
}
// 两套锁实现的统一包装。注释里那句「stale 超时与给运行版本加锁时保持一致」是设计约束：两处若不一致，就可能出现「运行中进程的锁被清理逻辑判成陈旧」——那正好是要防的事故。另一个细节：回调抛错时先记日志再重抛，保证错误不被吞掉。

async function atomicMoveToInstallPath(
  stagedBinaryPath: string,
  installPath: string,
) {
  // Create installation directory if it doesn't exist
  await mkdir(dirname(installPath), { recursive: true })

  // Move from staging to final location atomically
  const tempInstallPath = `${installPath}.tmp.${process.pid}.${Date.now()}`

  try {
    // Copy to temp next to install path, then rename. A direct rename from staging
    // would fail with EXDEV if staging and install are on different filesystems.
    await copyFile(stagedBinaryPath, tempInstallPath)
    await chmod(tempInstallPath, 0o755)
    await rename(tempInstallPath, installPath)
    logForDebugging(`Atomically installed binary to ${installPath}`)
  } catch (error) {
    // Clean up temp file if it exists
    try {
      await unlink(tempInstallPath)
    } catch {
      // Ignore cleanup errors
    }
    throw error
  }
}
// 原子安装三步：复制到**安装目录旁边**的临时文件、chmod 755、rename。为什么不直接从暂存目录 rename？注释给了答案：暂存与安装常在不同文件系统（缓存与数据目录经常是不同挂载点），跨设备 rename 会报 EXDEV。所以必须先复制到同一目录内再 rename——只有同目录的 rename 才是原子的。失败时清掉临时文件，不留垃圾。

async function installVersionFromPackage(
  stagingPath: string,
  installPath: string,
) {
  try {
    // Extract binary from npm package structure in staging
    const nodeModulesDir = join(stagingPath, 'node_modules', '@anthropic-ai')
    const entries = await readdir(nodeModulesDir)
    const nativePackage = entries.find((entry: string) =>
      entry.startsWith('claude-cli-native-'),
    )

    if (!nativePackage) {
      logEvent('tengu_native_install_package_failure', {
        stage_find_package: true,
        error_package_not_found: true,
      })
      const error = new Error('Could not find platform-specific native package')
      throw error
    }

    const stagedBinaryPath = join(nodeModulesDir, nativePackage, 'cli')

    try {
      await stat(stagedBinaryPath)
    } catch {
      logEvent('tengu_native_install_package_failure', {
        stage_binary_exists: true,
        error_binary_not_found: true,
      })
      const error = new Error('Native binary not found in staged package')
      throw error
    }

    await atomicMoveToInstallPath(stagedBinaryPath, installPath)

    // Clean up staging directory
    await rm(stagingPath, { recursive: true, force: true })

    logEvent('tengu_native_install_package_success', {})
  } catch (error) {
    // Log if not already logged above
    const msg = errorMessage(error)
    if (
      !msg.includes('Could not find platform-specific') &&
      !msg.includes('Native binary not found')
    ) {
      logEvent('tengu_native_install_package_failure', {
        stage_atomic_move: true,
        error_move_failed: true,
      })
    }
    logError(toError(error))
    throw error
  }
}
// npm 包形态的安装：从暂存目录里翻出平台专用的原生包（按名字前缀匹配），二进制在包内的固定子路径。三步各有独立埋点（找不到包、找不到二进制、原子移动失败），因为这三种失败在统计上要分开看——找不到包是发布侧问题，移动失败是用户环境问题。成功后删掉整个暂存目录。

async function installVersionFromBinary(
  stagingPath: string,
  installPath: string,
) {
  try {
    // For direct binary downloads (GCS, generic bucket), the binary is directly in staging
    const platform = getPlatform()
    const binaryName = getBinaryName(platform)
    const stagedBinaryPath = join(stagingPath, binaryName)

    try {
      await stat(stagedBinaryPath)
    } catch {
      logEvent('tengu_native_install_binary_failure', {
        stage_binary_exists: true,
        error_binary_not_found: true,
      })
      const error = new Error('Staged binary not found')
      throw error
    }

    await atomicMoveToInstallPath(stagedBinaryPath, installPath)

    // Clean up staging directory
    await rm(stagingPath, { recursive: true, force: true })

    logEvent('tengu_native_install_binary_success', {})
  } catch (error) {
    if (!errorMessage(error).includes('Staged binary not found')) {
      logEvent('tengu_native_install_binary_failure', {
        stage_atomic_move: true,
        error_move_failed: true,
      })
    }
    logError(toError(error))
    throw error
  }
}
// 直连下载（对象存储、通用 bucket）的形态：二进制直接在暂存目录根下。与 npm 形态的唯一区别是路径推导，其余（原子移动、清理、埋点）完全对称。这种「两条安装路径共享同一个落盘原语」的结构，是为了让新增下载源不必再写一遍安全逻辑。

async function installVersion(
  stagingPath: string,
  installPath: string,
  downloadType: 'npm' | 'binary',
) {
  // Use the explicit download type instead of guessing
  if (downloadType === 'npm') {
    await installVersionFromPackage(stagingPath, installPath)
  } else {
    await installVersionFromBinary(stagingPath, installPath)
  }
}
// 按下载阶段返回的类型明确分派，而不是「试着找找看」。注释那句「用显式类型而不是猜」有来历：猜路径在两种形态混用时会把 npm 包里的脚本与直下的二进制搞混，装上去的可能是个不可执行的文件。

/**
 * Performs the core update operation: download (if needed), install, and update symlink.
 * Returns whether a new install was performed (vs just updating symlink).
 */
async function performVersionUpdate(
  version: string,
  forceReinstall: boolean,
): Promise<boolean> {
  const { stagingPath: baseStagingPath, installPath } =
    await getVersionPaths(version)
  const { executable: executablePath } = getBaseDirectories()

  // For lockless updates, use a unique staging path to avoid conflicts between concurrent downloads
  const stagingPath = isEnvTruthy(process.env.ENABLE_LOCKLESS_UPDATES)
    ? `${baseStagingPath}.${process.pid}.${Date.now()}`
    : baseStagingPath

  // Only download if not already installed (or if force reinstall)
  const needsInstall = !(await versionIsAvailable(version)) || forceReinstall
  if (needsInstall) {
    logForDebugging(
      forceReinstall
        ? `Force reinstalling native installer version ${version}`
        : `Downloading native installer version ${version}`,
    )
    const downloadType = await downloadVersion(version, stagingPath)
    await installVersion(stagingPath, installPath, downloadType)
  } else {
    logForDebugging(`Version ${version} already installed, updating symlink`)
  }

  // Create direct symlink from ~/.local/bin/claude to the version binary
  await removeDirectoryIfEmpty(executablePath)
  await updateSymlink(executablePath, installPath)

  // Verify the executable was actually created/updated
  if (!(await isPossibleClaudeBinary(executablePath))) {
    let installPathExists = false
    try {
      await stat(installPath)
      installPathExists = true
    } catch {
      // installPath doesn't exist
    }
    throw new Error(
      `Failed to create executable at ${executablePath}. ` +
        `Source file exists: ${installPathExists}. ` +
        `Check write permissions to ${executablePath}.`,
    )
  }
  return needsInstall
}
// 一次更新的完整动作：需要才下载、安装、把用户 bin 的入口指向新版本、再验证入口真的可用。三个细节：① 无锁模式下暂存路径带 PID 与时间戳，避免两个进程写同一个暂存目录；② 更新前先尝试删空目录——历史上入口位置可能被误建成目录；③ 最后一定要回读验证，因为「rename 成功」不等于「用户能执行」，权限不对时要在这一步给出可操作的信息（源文件是否存在、该改哪个路径的权限）。

async function versionIsAvailable(version: string): Promise<boolean> {
  const { installPath } = await getVersionPaths(version)
  return isPossibleClaudeBinary(installPath)
}
// 「这个版本装好了吗」的判据就是「安装路径上是不是一个可执行的非空文件」。它不看锁、也不看符号链接——只回答「磁盘上有没有可用产物」，至于「能不能用」由入口验证负责。

async function updateLatest(
  channelOrVersion: string,
  forceReinstall: boolean = false,
): Promise<{
  success: boolean
  latestVersion: string
  lockFailed?: boolean
  lockHolderPid?: number
}> {
  const startTime = Date.now()
  let version = await getLatestVersion(channelOrVersion)
  const { executable: executablePath } = getBaseDirectories()

  logForDebugging(`Checking for native installer update to version ${version}`)

  // Check if max version is set (server-side kill switch for auto-updates)
  if (!forceReinstall) {
    const maxVersion = await getMaxVersion()
    if (maxVersion && gt(version, maxVersion)) {
      logForDebugging(
        `Native installer: maxVersion ${maxVersion} is set, capping update from ${version} to ${maxVersion}`,
      )
      // If we're already at or above maxVersion, skip the update entirely
      if (gte(MACRO.VERSION, maxVersion)) {
        logForDebugging(
          `Native installer: current version ${MACRO.VERSION} is already at or above maxVersion ${maxVersion}, skipping update`,
        )
        logEvent('tengu_native_update_skipped_max_version', {
          latency_ms: Date.now() - startTime,
          max_version:
            maxVersion as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          available_version:
            version as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        return { success: true, latestVersion: version }
      }
      version = maxVersion
    }
  }
// 服务端 kill switch：若服务端给了最高版本且可用版本更高，就把目标版本压回上限。压在版本号上而不是「拒绝更新」，是为了让仍在旧版本上的用户能被推到上限版本——直接拒绝会让卡在更老版本的人永远上不来。若当前已不低于上限，直接返回成功，什么都不改。

  // Early exit: if we're already running this exact version AND both the version binary
  // and executable exist and are valid. We need to proceed if the executable doesn't exist,
  // is invalid (e.g., empty/corrupted from a failed install), or we're running via npx.
  if (
    !forceReinstall &&
    version === MACRO.VERSION &&
    (await versionIsAvailable(version)) &&
    (await isPossibleClaudeBinary(executablePath))
  ) {
    logForDebugging(`Found ${version} at ${executablePath}, skipping install`)
    logEvent('tengu_native_update_complete', {
      latency_ms: Date.now() - startTime,
      was_new_install: false,
      was_force_reinstall: false,
      was_already_running: true,
    })
    return { success: true, latestVersion: version }
  }
// 三个条件同时成立才跳过：目标版本等于当前版本、版本产物可用、入口可用。注释特意解释了为什么不能只比版本号：入口可能不存在（首次安装被中断）、可能是 0 字节（安装失败留下的）、也可能用户是通过 npx 跑的——这三种都必须继续走安装。

  // Check if this version should be skipped due to minimumVersion setting
  if (!forceReinstall && shouldSkipVersion(version)) {
    logEvent('tengu_native_update_skipped_minimum_version', {
      latency_ms: Date.now() - startTime,
      target_version:
        version as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return { success: true, latestVersion: version }
  }

  // Track if we're actually installing or just symlinking
  let wasNewInstall = false
  let latencyMs: number

  if (isEnvTruthy(process.env.ENABLE_LOCKLESS_UPDATES)) {
    // Lockless: rely on atomic operations, errors propagate
    wasNewInstall = await performVersionUpdate(version, forceReinstall)
    latencyMs = Date.now() - startTime
  } else {
    // Lock-based updates
    const { installPath } = await getVersionPaths(version)
    // If force reinstall, remove any existing lock to bypass stale locks
    if (forceReinstall) {
      await forceRemoveLock(installPath)
    }

    const lockAcquired = await tryWithVersionLock(
      installPath,
      async () => {
        wasNewInstall = await performVersionUpdate(version, forceReinstall)
      },
      3, // retries
    )

    latencyMs = Date.now() - startTime

    // Lock acquisition failed - get lock holder PID for error message
    if (!lockAcquired) {
      const dirs = getBaseDirectories()
      let lockHolderPid: number | undefined
      if (isPidBasedLockingEnabled()) {
        const lockfilePath = getLockFilePathFromVersionPath(dirs, installPath)
        if (isLockActive(lockfilePath)) {
          lockHolderPid = readLockContent(lockfilePath)?.pid
        }
      }
      logEvent('tengu_native_update_lock_failed', {
        latency_ms: latencyMs,
        lock_holder_pid: lockHolderPid,
      })
      return {
        success: false,
        latestVersion: version,
        lockFailed: true,
        lockHolderPid,
      }
    }
  }
// 两条路径的取舍写得很直白：无锁模式完全依赖原子操作，错误直接抛出；有锁模式在锁内做整段更新，拿不到锁就返回「别人在装」并带上持锁 PID——这个 PID 是给用户看的，弹窗能说清「另一个进程正在更新」。强制重装时先强删锁，因为陈旧锁会把用户永久挡在门外。

  logEvent('tengu_native_update_complete', {
    latency_ms: latencyMs,
    was_new_install: wasNewInstall,
    was_force_reinstall: forceReinstall,
  })
  logForDebugging(`Successfully updated to version ${version}`)
  return { success: true, latestVersion: version }
}
// 主干流程：取最新版本 → 服务端上限裁剪 → 同版本早退 → 最低版本跳过 → 锁内或无锁执行 → 埋点。返回值刻意区分「成功」「锁失败」「无更新」三态，因为上层据此决定是提示、重试还是静默。

// Exported for testing
export async function removeDirectoryIfEmpty(path: string): Promise<void> {
  // rmdir alone handles all cases: ENOTDIR if path is a file, ENOTEMPTY if
  // directory is non-empty, ENOENT if missing. No need to stat+readdir first.
  try {
    await rmdir(path)
    logForDebugging(`Removed empty directory at ${path}`)
  } catch (error) {
    const code = getErrnoCode(error)
    // Expected cases (not-a-dir, missing, not-empty) — silently skip.
    // ENOTDIR is the normal path: executablePath is typically a symlink.
    if (code !== 'ENOTDIR' && code !== 'ENOENT' && code !== 'ENOTEMPTY') {
      logForDebugging(`Could not remove directory at ${path}: ${error}`)
    }
  }
}
// 只用一次 rmdir 就把四种情况全处理了，注释把这件事说得很清楚：ENOTDIR 表示路径是文件、ENOTEMPTY 表示目录非空、ENOENT 表示不存在——三种都属「不用管」。这比「先 stat 再 readdir 再 rmdir」少两次系统调用，也少两个竞态窗口。ENOTDIR 是常态，因为入口通常是符号链接。

async function updateSymlink(
  symlinkPath: string,
  targetPath: string,
): Promise<boolean> {
  const platform = getPlatform()
  const isWindows = platform.startsWith('win32')

  // On Windows, directly copy the executable instead of creating a symlink
  if (isWindows) {
    try {
      // Ensure parent directory exists
      const parentDir = dirname(symlinkPath)
      await mkdir(parentDir, { recursive: true })

      // Check if file already exists and has same content
      let existingStats: Stats | undefined
      try {
        existingStats = await stat(symlinkPath)
      } catch {
        // symlinkPath doesn't exist
      }

      if (existingStats) {
        try {
          const targetStats = await stat(targetPath)
          // If sizes match, assume files are the same (avoid reading large files)
          if (existingStats.size === targetStats.size) {
            return false
          }
// Windows 上没有符号链接可用，只能复制整个可执行文件。为免每次复制几百兆，先比尺寸——同尺寸就当相同。这个判断不严谨（同尺寸不同内容会漏判），但注释明说「避免读取大文件」，是有意取舍：可执行文件被同尺寸不同内容替换的概率极低，而每次更新读几百兆的代价是确定的。
        } catch {
          // Continue with copy if we can't compare
        }
        // Use rename strategy to handle file locking on Windows
        // Rename always works even for running executables, unlike delete
        const oldFileName = `${symlinkPath}.old.${Date.now()}`
        await rename(symlinkPath, oldFileName)

        // Try to copy new executable, with rollback on failure
        try {
          await copyFile(targetPath, symlinkPath)
          // Success - try immediate cleanup of old file (non-blocking)
          try {
            await unlink(oldFileName)
          } catch {
            // File still running - ignore, Windows will clean up eventually
          }
        } catch (copyError) {
          // Copy failed - restore the old executable
          try {
            await rename(oldFileName, symlinkPath)
          } catch (restoreError) {
            // Critical: User left without working executable - prioritize restore error
            const errorWithCause = new Error(
              `Failed to restore old executable: ${restoreError}`,
              { cause: copyError },
            )
            logError(errorWithCause)
            throw errorWithCause
          }
          throw copyError
        }
// Windows 更新最危险的一步是「先把旧文件改名、再复制新文件」：复制失败时用户手上就没有可执行文件了。所以复制失败必须把旧文件改回来，且改回来失败要**优先报回滚错误**（注释：用户已经没法用了，这条信息比原始错误更重要），原始错误放进 cause。另一个细节：旧文件删除失败不算错——正在运行的 exe 删不掉是 Windows 的正常行为，启动时的清理逻辑会兜底。
      } else {
        // First-time installation (no existing file to rename)
        // Copy the executable directly; handle ENOENT from copyFile itself
        // rather than a stat() pre-check (avoids TOCTOU + extra syscall)
        try {
          await copyFile(targetPath, symlinkPath)
        } catch (e) {
          if (isENOENT(e)) {
            throw new Error(`Source file does not exist: ${targetPath}`)
          }
          throw e
        }
      }
      // chmod is not needed on Windows - executability is determined by .exe extension
      return true
    } catch (error) {
      logError(
        new Error(
          `Failed to copy executable from ${targetPath} to ${symlinkPath}: ${error}`,
        ),
      )
      return false
    }
  }
// 整个 Windows 分支的返回值语义：true 表示写了新东西，false 表示没变或失败。首装与更新的分支不同——首装没有旧文件可改名，直接复制并靠 copyFile 的 ENOENT 判断源文件缺失，注释特意说明这是为了避免「先 stat 再 copy」的 TOCTOU 与多余系统调用。

  // For non-Windows platforms, use symlinks as before
  // Ensure parent directory exists (same as Windows path above)
  const parentDir = dirname(symlinkPath)
  try {
    await mkdir(parentDir, { recursive: true })
    logForDebugging(`Created directory ${parentDir} for symlink`)
  } catch (mkdirError) {
    logError(
      new Error(`Failed to create directory ${parentDir}: ${mkdirError}`),
    )
    return false
  }

  // Check if symlink already exists and points to the correct target
  try {
    let symlinkExists = false
    try {
      await stat(symlinkPath)
      symlinkExists = true
    } catch {
      // symlinkPath doesn't exist
    }

    if (symlinkExists) {
      try {
        const currentTarget = await readlink(symlinkPath)
        const resolvedCurrentTarget = resolve(
          dirname(symlinkPath),
          currentTarget,
        )
        const resolvedTargetPath = resolve(targetPath)

        if (resolvedCurrentTarget === resolvedTargetPath) {
          return false
        }
      } catch {
        // Path exists but is not a symlink - will remove it below
      }

      // Remove existing file/symlink before creating new one
      await unlink(symlinkPath)
    }
  } catch (error) {
    logError(new Error(`Failed to check/remove existing symlink: ${error}`))
  }
// Unix 分支先判断「已存在且指向正确就什么都不做」，否则删掉旧的。读 readlink 失败的分支含义是「路径存在但不是符号链接」，会在下面删掉。删掉再重建而不是「原地改指向」，因为符号链接本身不可修改，只能换。

  // Use atomic rename to avoid race conditions. Create symlink with temporary name
  // then atomically rename to final name. This ensures the symlink always exists
  // and is always valid, even with concurrent updates.
  const tempSymlink = `${symlinkPath}.tmp.${process.pid}.${Date.now()}`
  try {
    await symlink(targetPath, tempSymlink)

    // Atomically rename to final name (replaces existing)
    await rename(tempSymlink, symlinkPath)
    logForDebugging(
      `Atomically updated symlink ${symlinkPath} -> ${targetPath}`,
    )
    return true
  } catch (error) {
    // Clean up temp symlink if it exists
    try {
      await unlink(tempSymlink)
    } catch {
      // Ignore cleanup errors
    }
    logError(
      new Error(
        `Failed to create symlink from ${symlinkPath} to ${targetPath}: ${error}`,
      ),
    )
    return false
  }
}
// Unix 侧同样用「临时名 + rename」保证原子性：先建带 PID 与时间戳的临时符号链接，再 rename 覆盖正式名。这样任何时刻正式名要么指向旧版本、要么指向新版本，不会出现「符号链接不存在」的空窗——空窗期恰好有人执行就是 command not found。

export async function checkInstall(
  force: boolean = false,
): Promise<SetupMessage[]> {
  // Skip all installation checks if disabled via environment variable
  if (isEnvTruthy(process.env.DISABLE_INSTALLATION_CHECKS)) {
    return []
  }

  // Get the actual installation type and config
  const installationType = await getCurrentInstallationType()

  // Skip checks for development builds - config.installMethod from a previous
  // native installation shouldn't trigger warnings when running dev builds
  if (installationType === 'development') {
    return []
  }

  const config = getGlobalConfig()

  // Only show warnings if:
  // 1. User is actually running from native installation, OR
  // 2. User has explicitly set installMethod to 'native' in config (they're trying to use native)
  // 3. force is true (used during installation process)
  const shouldCheckNative =
    force || installationType === 'native' || config.installMethod === 'native'

  if (!shouldCheckNative) {
    return []
  }

  const dirs = getBaseDirectories()
  const messages: SetupMessage[] = []
  const localBinDir = dirname(dirs.executable)
  const resolvedLocalBinPath = resolve(localBinDir)
  const platform = getPlatform()
  const isWindows = platform.startsWith('win32')

  // Check if bin directory exists
  try {
    await access(localBinDir)
  } catch {
    messages.push({
      message: `installMethod is native, but directory ${localBinDir} does not exist`,
      userActionRequired: true,
      type: 'error',
    })
  }

  // Check if claude executable exists and is valid.
  // On non-Windows, call readlink directly and route errno — ENOENT means
  // the executable is missing, EINVAL means it exists but isn't a symlink.
  // This avoids an access()→readlink() TOCTOU where deletion between the
  // two calls produces a misleading "Not a symlink" diagnostic.
  // isPossibleClaudeBinary stats the path internally, so we don't pre-check
  // with access() — that would be a TOCTOU between access and the stat.
  if (isWindows) {
    // On Windows it's a copied executable, not a symlink
    if (!(await isPossibleClaudeBinary(dirs.executable))) {
      messages.push({
        message: `installMethod is native, but claude command is missing or invalid at ${dirs.executable}`,
        userActionRequired: true,
        type: 'error',
      })
    }
// 诊断逻辑最值得看的是**为什么不用 access 预检**。注释写了两处 TOCTOU：先 access 再 readlink，两步之间文件被删会得到误导性的「不是符号链接」；先 access 再 stat，同样有窗口。所以改成直接 readlink 并按 errno 分流——ENOENT 是「不存在」，EINVAL 是「存在但不是符号链接」，后者再当普通二进制检查。这是「用错误码代替预检查」的样板。
  } else {
    try {
      const target = await readlink(dirs.executable)
      const absoluteTarget = resolve(dirname(dirs.executable), target)
      if (!(await isPossibleClaudeBinary(absoluteTarget))) {
        messages.push({
          message: `Claude symlink points to missing or invalid binary: ${target}`,
          userActionRequired: true,
          type: 'error',
        })
      }
    } catch (e) {
      if (isENOENT(e)) {
        messages.push({
          message: `installMethod is native, but claude command not found at ${dirs.executable}`,
          userActionRequired: true,
          type: 'error',
        })
      } else {
        // EINVAL (not a symlink) or other — check as regular binary
        if (!(await isPossibleClaudeBinary(dirs.executable))) {
          messages.push({
            message: `${dirs.executable} exists but is not a valid Claude binary`,
            userActionRequired: true,
            type: 'error',
          })
        }
      }
    }
  }
// Windows 上检查「复制出来的可执行文件是否有效」，Unix 上检查「符号链接的目标是否有效」——两个平台对「安装成功」的定义不同，诊断必须跟着不同，否则 Windows 用户会看到「符号链接不存在」这种完全不成立的报错。

  // Check if bin directory is in PATH
  const isInCurrentPath = (process.env.PATH || '')
    .split(delimiter)
    .some(entry => {
      try {
        const resolvedEntry = resolve(entry)
        // On Windows, perform case-insensitive comparison for paths
        if (isWindows) {
          return (
            resolvedEntry.toLowerCase() === resolvedLocalBinPath.toLowerCase()
          )
        }
        return resolvedEntry === resolvedLocalBinPath
      } catch {
        return false
      }
    })

  if (!isInCurrentPath) {
    if (isWindows) {
      // Windows-specific PATH instructions
      const windowsBinPath = localBinDir.replace(/\//g, '\\')
      messages.push({
        message: `Native installation exists but ${windowsBinPath} is not in your PATH. Add it by opening: System Properties → Environment Variables → Edit User PATH → New → Add the path above. Then restart your terminal.`,
        userActionRequired: true,
        type: 'path',
      })
    } else {
      // Unix-style PATH instructions
      const shellType = getShellType()
      const configPaths = getShellConfigPaths()
      const configFile = configPaths[shellType as keyof typeof configPaths]
      const displayPath = configFile
        ? configFile.replace(homedir(), '~')
        : 'your shell config file'

      messages.push({
        message: `Native installation exists but ~/.local/bin is not in your PATH. Run:\n\necho 'export PATH="$HOME/.local/bin:$PATH"' >> ${displayPath} && source ${displayPath}`,
        userActionRequired: true,
        type: 'path',
      })
    }
  }
// PATH 判定要把每一条都 resolve 后再比（Windows 上还做大小写无关比较），因为 PATH 里经常是相对路径或带符号链接的形式。不在 PATH 时按平台给**可复制粘贴**的指令：Windows 给图形界面路径，Unix 直接给一行追加到对应 shell 配置文件的命令；展示用的路径会把家目录折成波浪号，让用户看得懂。

  return messages
}
// 消息三元组的设计值得注意：文本、是否需要用户动手、类型（路径/别名/信息/错误）。区分「要不要动手」是因为有的提示只是告知（别名已清理），有的必须用户去做（PATH 没配好等于装完不能用）。函数开头两个早退：环境变量禁用、开发构建——后者是因为开发构建会被上一次原生安装留下的配置误判成需要修。

type InstallLatestResult = {
  latestVersion: string | null
  wasUpdated: boolean
  lockFailed?: boolean
  lockHolderPid?: number
}

// In-process singleflight guard. NativeAutoUpdater remounts whenever the
// prompt suggestions overlay toggles (PromptInput.tsx:2916), and the
// isUpdating guard does not survive the remount. Each remount kicked off a
// fresh 271MB binary download while previous ones were still in flight.
// Telemetry: session 42fed33f saw arrayBuffers climb to 91GB at ~650MB/s.
let inFlightInstall: Promise<InstallLatestResult> | null = null
// 这段注释是一份真实的容量事故记录：自动更新组件在提示建议浮层切换时会被重新挂载，而组件内的「正在更新」标志活不过重挂载，于是每次重挂载都发起一次几百兆的二进制下载。埋点数据显示某次会话的内存缓冲涨到 91GB、速率约每秒 650MB。修法是把单飞状态从组件级挪到模块级。

export function installLatest(
  channelOrVersion: string,
  forceReinstall: boolean = false,
): Promise<InstallLatestResult> {
  if (forceReinstall) {
    return installLatestImpl(channelOrVersion, forceReinstall)
  }
  if (inFlightInstall) {
    logForDebugging('installLatest: joining in-flight call')
    return inFlightInstall
  }
  const promise = installLatestImpl(channelOrVersion, forceReinstall)
  inFlightInstall = promise
  const clear = (): void => {
    inFlightInstall = null
  }
  void promise.then(clear, clear)
  return promise
}
// 单飞守卫：有在途调用就复用同一个 promise，不再发起下载。两个细节：强制重装**绕过**守卫（用户明确要求重下就该重下）；清理时 then 的成功与失败分支挂同一个函数，保证两种结局都会清空——只挂成功分支会让一次失败把所有后续调用永久锁死。

async function installLatestImpl(
  channelOrVersion: string,
  forceReinstall: boolean = false,
): Promise<InstallLatestResult> {
  const updateResult = await updateLatest(channelOrVersion, forceReinstall)

  if (!updateResult.success) {
    return {
      latestVersion: null,
      wasUpdated: false,
      lockFailed: updateResult.lockFailed,
      lockHolderPid: updateResult.lockHolderPid,
    }
  }

  // Installation succeeded (early return above covers failure). Mark as native
  // and disable legacy auto-updater to protect symlinks.
  const config = getGlobalConfig()
  if (config.installMethod !== 'native') {
    saveGlobalConfig(current => ({
      ...current,
      installMethod: 'native',
      // Disable legacy auto-updater to prevent npm sessions from deleting native symlinks.
      // Native installations use NativeAutoUpdater instead, which respects native installation.
      autoUpdates: false,
      // Mark this as protection-based, not user preference
      autoUpdatesProtectedForNative: true,
    }))
    logForDebugging(
      'Native installer: Set installMethod to "native" and disabled legacy auto-updater for protection',
    )
  }

  void cleanupOldVersions()

  return {
    latestVersion: updateResult.latestVersion,
    wasUpdated: updateResult.success,
    lockFailed: false,
  }
}
// 安装成功后顺手改配置：把安装方式标成原生、并关掉旧版自动更新。注释解释了必要性——npm 渠道的自动更新会删掉原生安装建立的符号链接，两者互相拆台。同时把「关自动更新」标记成「为保护而关」而非「用户偏好」，这样以后推断用户意图时不会被这条记录误导。清理旧版本刻意不 await，避免拖慢更新返回。

async function getVersionFromSymlink(
  symlinkPath: string,
): Promise<string | null> {
  try {
    const target = await readlink(symlinkPath)
    const absoluteTarget = resolve(dirname(symlinkPath), target)
    if (await isPossibleClaudeBinary(absoluteTarget)) {
      return absoluteTarget
    }
  } catch {
    // Not a symlink / doesn't exist / target doesn't exist
  }
  return null
}
// 从符号链接反查版本路径，前提是目标仍是可用二进制——这样「链接指向已被删掉的旧版本」会被判成「没有当前版本」，而不是返回一个不存在的路径。这个函数只被清理逻辑使用（判断哪个版本不能删），所以宁严不宽。

function getLockFilePathFromVersionPath(
  dirs: ReturnType<typeof getBaseDirectories>,
  versionPath: string,
) {
  const versionName = basename(versionPath)
  return join(dirs.locks, `${versionName}.lock`)
}
// 锁文件名 = 版本文件名加锁后缀，统一放在锁目录。不放在版本目录旁边，是为了让「版本目录里只有版本文件」这个不变量成立——清理逻辑靠遍历版本目录识别候选，混进锁文件就得特判。

/**
 * Acquire a lock on the current running version to prevent it from being deleted
 * This lock is held for the entire lifetime of the process
 *
 * Uses PID-based locking (when enabled) which can immediately detect crashed processes
 * (unlike mtime-based locking which requires a 30-day timeout)
 */
export async function lockCurrentVersion(): Promise<void> {
  const dirs = getBaseDirectories()

  // Only lock if we're running from the versions directory
  if (!process.execPath.includes(dirs.versions)) {
    return
  }

  const versionPath = resolve(process.execPath)
  try {
    const lockfilePath = getLockFilePathFromVersionPath(dirs, versionPath)

    // Ensure locks directory exists
    await mkdir(dirs.locks, { recursive: true })

    if (isPidBasedLockingEnabled()) {
      // Acquire PID-based lock and hold it for the process lifetime
      // PID-based locking allows immediate detection of crashed processes
      // while still surviving laptop sleep (process is suspended but PID exists)
      const acquired = await acquireProcessLifetimeLock(
        versionPath,
        lockfilePath,
      )

      if (!acquired) {
        logEvent('tengu_version_lock_failed', {
          is_pid_based: true,
          is_lifetime_lock: true,
        })
        logLockAcquisitionError(
          versionPath,
          new Error('Lock already held by another process'),
        )
        return
      }

      logEvent('tengu_version_lock_acquired', {
        is_pid_based: true,
        is_lifetime_lock: true,
      })
      logForDebugging(`Acquired PID lock on running version: ${versionPath}`)
    } else {
      // Acquire mtime-based lock and never release it (until process exits)
      // Use 30 days for stale to prevent the lock from being considered stale during
      // normal usage. This is critical because laptop sleep suspends the process,
      // stopping the mtime heartbeat. 30 days is long enough for any realistic session
      // while still allowing eventual cleanup of abandoned locks.
      let release: (() => Promise<void>) | undefined
      try {
        release = await lockfile.lock(versionPath, {
          stale: LOCK_STALE_MS,
          retries: 0, // Don't retry - if we can't lock, that's fine
          lockfilePath,
          // Handle lock compromise gracefully (e.g., if another process deletes the lock directory)
          onCompromised: (err: Error) => {
            logForDebugging(
              `NON-FATAL: Lock on running version was compromised: ${err.message}`,
              { level: 'info' },
            )
          },
        })
        logEvent('tengu_version_lock_acquired', {
          is_pid_based: false,
          is_lifetime_lock: true,
        })
        logForDebugging(
          `Acquired mtime-based lock on running version: ${versionPath}`,
        )

        // Release lock explicitly; proper-lockfile's cleanup is unreliable with signal-exit v3+v4
        registerCleanup(async () => {
          try {
            await release?.()
          } catch {
            // Lock may already be released
          }
        })
      } catch (lockError) {
        if (isENOENT(lockError)) {
          logForDebugging(
            `Cannot lock current version - file does not exist: ${versionPath}`,
            { level: 'info' },
          )
          return
        }
        logEvent('tengu_version_lock_failed', {
          is_pid_based: false,
          is_lifetime_lock: true,
        })
        logLockAcquisitionError(versionPath, lockError)
        return
      }
    }
// 运行中的进程要给自己占的版本加锁，防止清理逻辑把它删掉。mtime 锁这条路必须显式注册清理回调，注释说明理由：锁库自己的退出清理在信号库版本混用下不可靠，所以在进程退出钩子里手动释放。重试次数是 0——拿不到就算了，因为「给运行版本加锁」是尽力而为的保护，失败只影响清理阶段的选择，不影响当前运行。
  } catch (error) {
    if (isENOENT(error)) {
      logForDebugging(
        `Cannot lock current version - file does not exist: ${versionPath}`,
        { level: 'info' },
      )
      return
    }
    // We fallback to previous behavior where we don't acquire a lock on a running version
    // This ~mostly works but using native binaries like ripgrep will fail
    logForDebugging(
      `NON-FATAL: Failed to lock current version during execution ${errorMessage(error)}`,
      { level: 'info' },
    )
  }
}
// 两个早退值得注意：不从版本目录启动的（npx、开发构建）根本不需要锁；文件不存在也直接返回。最后兜底 catch 里那句注释很实在——「退回到不加锁的旧行为，这基本能用，但调用原生工具如 ripgrep 时会失败」。也就是说锁的价值不只是防删自己，还保证同版本目录里的附属二进制在运行期间不被清理。

function logLockAcquisitionError(versionPath: string, lockError: unknown) {
  logError(
    new Error(
      `NON-FATAL: Lock acquisition failed for ${versionPath} (expected in multi-process scenarios)`,
      { cause: lockError },
    ),
  )
}
// 锁失败统一记成带「非致命」前缀的错误，注释补了一句「多进程场景下属预期」。这条日志的价值在排障：用户报「更新没反应」时，先看它就知是不是另一个进程正占着锁。

/**
 * Force-remove a lock file for a given version path.
 * Used when --force is specified to bypass stale locks.
 */
async function forceRemoveLock(versionFilePath: string): Promise<void> {
  const dirs = getBaseDirectories()
  const lockfilePath = getLockFilePathFromVersionPath(dirs, versionFilePath)

  try {
    await unlink(lockfilePath)
    logForDebugging(`Force-removed lock file at ${lockfilePath}`)
  } catch (error) {
    // Log but don't throw - we'll try to acquire the lock anyway
    logForDebugging(`Failed to force-remove lock file: ${errorMessage(error)}`)
  }
}
// 强制重装时先删锁文件，失败只记日志不抛——因为紧接着还会去正常抢锁，删不掉说明可能是权限问题，让抢锁那一步给出更准确的错误。

export async function cleanupOldVersions(): Promise<void> {
  // Yield to ensure we don't block startup
  await Promise.resolve()

  const dirs = getBaseDirectories()
  const oneHourAgo = Date.now() - 3600000

  // Clean up old renamed executables on Windows (no longer running at startup)
  if (getPlatform().startsWith('win32')) {
    const executableDir = dirname(dirs.executable)
    try {
      const files = await readdir(executableDir)
      let cleanedCount = 0
      for (const file of files) {
        if (!/^claude\.exe\.old\.\d+$/.test(file)) continue
        try {
          await unlink(join(executableDir, file))
          cleanedCount++
        } catch {
          // File might still be in use by another process
        }
      }
      if (cleanedCount > 0) {
        logForDebugging(
          `Cleaned up ${cleanedCount} old Windows executables on startup`,
        )
      }
    } catch (error) {
      if (!isENOENT(error)) {
        logForDebugging(`Failed to clean up old Windows executables: ${error}`)
      }
    }
  }
// 启动时清掉上次更新留下的旧可执行文件（名字带 old 与时间戳）。这个设计必须放在启动时的原因写在注释里：更新当时删不掉（文件正在运行），只能等下次启动。文件名用正则精确匹配，避免误删用户自己的文件。

  // Clean up orphaned staging directories older than 1 hour
  try {
    const stagingEntries = await readdir(dirs.staging)
    let stagingCleanedCount = 0
    for (const entry of stagingEntries) {
      const stagingPath = join(dirs.staging, entry)
      try {
        // stat() is load-bearing here (we need mtime). There is a theoretical
        // TOCTOU where a concurrent installer could freshen a stale staging
        // dir between stat and rm — but the 1-hour threshold makes this
        // vanishingly unlikely, and rm({force:true}) tolerates concurrent
        // deletion.
        const stats = await stat(stagingPath)
        if (stats.mtime.getTime() < oneHourAgo) {
          await rm(stagingPath, { recursive: true, force: true })
          stagingCleanedCount++
          logForDebugging(`Cleaned up old staging directory: ${entry}`)
        }
      } catch {
        // Ignore individual errors
      }
    }
    if (stagingCleanedCount > 0) {
      logForDebugging(
        `Cleaned up ${stagingCleanedCount} orphaned staging directories`,
      )
      logEvent('tengu_native_staging_cleanup', {
        cleaned_count: stagingCleanedCount,
      })
    }
  } catch (error) {
    if (!isENOENT(error)) {
      logForDebugging(`Failed to clean up staging directories: ${error}`)
    }
  }
// 清掉超过一小时的暂存目录——那是上次下载中断留下的。注释里那段关于 TOCTOU 的自我辩解值得记：理论上 stat 与删除之间可能有人「刷新」这个目录，但一小时阈值让概率极低，且强制删除容忍并发删除。这是「承认竞态但论证其无害」的写法。

  // Clean up stale PID locks (crashed processes) — cleanupStaleLocks handles ENOENT
  if (isPidBasedLockingEnabled()) {
    const staleLocksCleaned = cleanupStaleLocks(dirs.locks)
    if (staleLocksCleaned > 0) {
      logForDebugging(`Cleaned up ${staleLocksCleaned} stale version locks`)
      logEvent('tengu_native_stale_locks_cleanup', {
        cleaned_count: staleLocksCleaned,
      })
    }
  }
// PID 锁的清理成本极低（读文件、看 PID 活没活），所以每次启动都做；mtime 锁依赖超时，这里不清理。

  // Single readdir of versions dir. Partition into temp files vs candidate binaries,
  // stat'ing each entry at most once.
  let versionEntries: string[]
  try {
    versionEntries = await readdir(dirs.versions)
  } catch (error) {
    if (!isENOENT(error)) {
      logForDebugging(`Failed to readdir versions directory: ${error}`)
    }
    return
  }

  type VersionInfo = {
    name: string
    path: string
    resolvedPath: string
    mtime: Date
  }
  const versionFiles: VersionInfo[] = []
  let tempFilesCleanedCount = 0

  for (const entry of versionEntries) {
    const entryPath = join(dirs.versions, entry)
    if (/\.tmp\.\d+\.\d+$/.test(entry)) {
      // Orphaned temp install file — pattern: {version}.tmp.{pid}.{timestamp}
      try {
        const stats = await stat(entryPath)
        if (stats.mtime.getTime() < oneHourAgo) {
          await unlink(entryPath)
          tempFilesCleanedCount++
          logForDebugging(`Cleaned up orphaned temp install file: ${entry}`)
        }
      } catch {
        // Ignore individual errors
      }
      continue
    }
    // Candidate version binary — stat once, reuse for isFile/size/mtime/mode
    try {
      const stats = await stat(entryPath)
      if (!stats.isFile()) continue
      if (
        process.platform !== 'win32' &&
        stats.size > 0 &&
        (stats.mode & 0o111) === 0
      ) {
        // Check executability via mode bits from the existing stat result —
        // avoids a second syscall (access(X_OK)) and the TOCTOU window between
        // stat and access. Skip on Windows: libuv only sets execute bits for
        // .exe/.com/.bat/.cmd, but version files are extensionless semver
        // strings (e.g. "1.2.3"), so this check would reject all of them.
        // The previous access(X_OK) passed any readable file on Windows anyway.
        continue
      }
      versionFiles.push({
        name: entry,
        path: entryPath,
        resolvedPath: resolve(entryPath),
        mtime: stats.mtime,
      })
    } catch {
      // Skip files we can't stat
    }
  }

  if (tempFilesCleanedCount > 0) {
    logForDebugging(
      `Cleaned up ${tempFilesCleanedCount} orphaned temp install files`,
    )
    logEvent('tengu_native_temp_files_cleanup', {
      cleaned_count: tempFilesCleanedCount,
    })
  }
// 版本目录里除了版本文件还会有「安装中断留下的临时文件」（名字带 PID 与时间戳），同样按一小时阈值清。注意这里用 continue 跳过后续处理——临时文件绝不能被当成候选版本参与保留数计算，否则可能把真正的旧版本删掉、反而留下垃圾。

  if (versionFiles.length === 0) {
    return
  }

  try {
    // Identify protected versions
    const currentBinaryPath = process.execPath
    const protectedVersions = new Set<string>()
    if (currentBinaryPath && currentBinaryPath.includes(dirs.versions)) {
      protectedVersions.add(resolve(currentBinaryPath))
    }

    const currentSymlinkVersion = await getVersionFromSymlink(dirs.executable)
    if (currentSymlinkVersion) {
      protectedVersions.add(currentSymlinkVersion)
    }

    // Protect versions with active locks (running in other processes)
    for (const v of versionFiles) {
      if (protectedVersions.has(v.resolvedPath)) continue

      const lockFilePath = getLockFilePathFromVersionPath(dirs, v.resolvedPath)
      let hasActiveLock = false
      if (isPidBasedLockingEnabled()) {
        hasActiveLock = isLockActive(lockFilePath)
      } else {
        try {
          hasActiveLock = await lockfile.check(v.resolvedPath, {
            stale: LOCK_STALE_MS,
            lockfilePath: lockFilePath,
          })
        } catch {
          hasActiveLock = false
        }
      }
      if (hasActiveLock) {
        protectedVersions.add(v.resolvedPath)
        logForDebugging(`Protecting locked version from cleanup: ${v.name}`)
      }
    }
// 清理前先算「不能删」的集合，来源有三：正在运行的进程、符号链接当前指向的版本、**任何进程持有活跃锁的版本**。第三条是多进程安全的关键——另一个终端可能正在跑旧版本，它的锁就是「别删我」的声明。这行日志是删除决策的唯一依据。

    // Eligible versions: not protected, sorted newest first (reuse cached mtime)
    const eligibleVersions = versionFiles
      .filter(v => !protectedVersions.has(v.resolvedPath))
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())

    const versionsToDelete = eligibleVersions.slice(VERSION_RETENTION_COUNT)

    if (versionsToDelete.length === 0) {
      logEvent('tengu_native_version_cleanup', {
        total_count: versionFiles.length,
        deleted_count: 0,
        protected_count: protectedVersions.size,
        retained_count: VERSION_RETENTION_COUNT,
        lock_failed_count: 0,
        error_count: 0,
      })
      return
    }
// 候选为空时也要打点（带计数为零的完整字段），这样监控里能区分「清理没触发」与「触发了但无可删」，不会把两种情况混成一个指标。

    let deletedCount = 0
    let lockFailedCount = 0
    let errorCount = 0

    await Promise.all(
      versionsToDelete.map(async version => {
        try {
          const deleted = await tryWithVersionLock(version.path, async () => {
            await unlink(version.path)
          })
          if (deleted) {
            deletedCount++
          } else {
            lockFailedCount++
            logForDebugging(
              `Skipping deletion of ${version.name} - locked by another process`,
            )
          }
        } catch (error) {
          errorCount++
          logError(
            new Error(`Failed to delete version ${version.name}: ${error}`),
          )
        }
      }),
    )
// 删除也走版本锁：抢不到锁就跳过（说明有进程在用），并把「锁失败」单独计数——它和「删除出错」是两回事，前者是正常的多进程现象，后者才需要看日志。

    logEvent('tengu_native_version_cleanup', {
      total_count: versionFiles.length,
      deleted_count: deletedCount,
      protected_count: protectedVersions.size,
      retained_count: VERSION_RETENTION_COUNT,
      lock_failed_count: lockFailedCount,
      error_count: errorCount,
    })
  } catch (error) {
    if (!isENOENT(error)) {
      logError(new Error(`Version cleanup failed: ${error}`))
    }
  }
}
// 整个清理函数的形状是「一次 readdir 版本目录、每项最多 stat 一次」。注释明说这个优化意图：之前分几轮遍历、每轮都 stat，既慢又容易在轮次之间产生不一致。所有子步骤都吞 ENOENT（目录不存在是首次运行的常态），只有真正的 IO 错误才记日志。

/**
 * Check if a given path is managed by npm
 * @param executablePath - The path to check (can be a symlink)
 * @returns true if the path is npm-managed, false otherwise
 */
async function isNpmSymlink(executablePath: string): Promise<boolean> {
  // Resolve symlink to its target if applicable
  let targetPath = executablePath
  const stats = await lstat(executablePath)
  if (stats.isSymbolicLink()) {
    targetPath = await realpath(executablePath)
  }

  // checking npm prefix isn't guaranteed to work, as prefix can change
  // and users may set --prefix manually when installing
  // thus we use this heuristic:
  return targetPath.endsWith('.js') || targetPath.includes('node_modules')
}
// 判断「这个入口是 npm 装的还是原生装的」用启发式而非查 npm prefix。注释解释了为什么：prefix 会变，用户还可能手动指定。判据是「解析后的目标以脚本后缀结尾，或路径里有 node_modules」——npm 装的是 JS 入口，原生装的是二进制。这个判断决定要不要删除入口，判错就会删掉用户的 npm 安装。

/**
 * Remove the claude symlink from the executable directory
 * This is used when switching away from native installation
 * Will only remove if it's a native binary symlink, not npm-managed JS files
 */
export async function removeInstalledSymlink(): Promise<void> {
  const dirs = getBaseDirectories()

  try {
    // Check if this is an npm-managed installation
    if (await isNpmSymlink(dirs.executable)) {
      logForDebugging(
        `Skipping removal of ${dirs.executable} - appears to be npm-managed`,
      )
      return
    }

    // It's a native binary symlink, safe to remove
    await unlink(dirs.executable)
    logForDebugging(`Removed claude symlink at ${dirs.executable}`)
  } catch (error) {
    if (isENOENT(error)) {
      return
    }
    logError(new Error(`Failed to remove claude symlink: ${error}`))
  }
}
// 从原生切走时清理入口。先判 npm 归属，是 npm 的就跳过；ENOENT 直接返回不算错。顺序很重要：先删再判会把 npm 用户的入口删掉。

/**
 * Clean up old claude aliases from shell configuration files
 * Only handles alias removal, not PATH setup
 */
export async function cleanupShellAliases(): Promise<SetupMessage[]> {
  const messages: SetupMessage[] = []
  const configMap = getShellConfigPaths()

  for (const [shellType, configFile] of Object.entries(configMap)) {
    try {
      const lines = await readFileLines(configFile)
      if (!lines) continue

      const { filtered, hadAlias } = filterClaudeAliases(lines)

      if (hadAlias) {
        await writeFileLines(configFile, filtered)
        messages.push({
          message: `Removed claude alias from ${configFile}. Run: unalias claude`,
          userActionRequired: true,
          type: 'alias',
        })
        logForDebugging(`Cleaned up claude alias from ${shellType} config`)
      }
    } catch (error) {
      logError(error)
      messages.push({
        message: `Failed to clean up ${configFile}: ${error}`,
        userActionRequired: false,
        type: 'error',
      })
    }
  }

  return messages
}
// 清理 shell 配置里的 claude 别名（别名会遮蔽新装的二进制，造成「更新了但版本没变」）。逐个文件处理、每个独立 try，一个失败不影响其它。需要用户动手的消息里特意带上解除别名的命令，因为改配置文件不会影响已经打开的终端。

async function manualRemoveNpmPackage(
  packageName: string,
): Promise<{ success: boolean; error?: string; warning?: string }> {
  try {
    // Get npm global prefix
    const prefixResult = await execFileNoThrowWithCwd('npm', [
      'config',
      'get',
      'prefix',
    ])
    if (prefixResult.code !== 0 || !prefixResult.stdout) {
      return {
        success: false,
        error: 'Failed to get npm global prefix',
      }
    }

    const globalPrefix = prefixResult.stdout.trim()
    let manuallyRemoved = false

    // Helper to try removing a file. unlink alone is sufficient — it throws
    // ENOENT if the file is missing, which the catch handles identically.
    // A stat() pre-check would add a syscall and a TOCTOU window where
    // concurrent cleanup causes a false-negative return.
    async function tryRemove(filePath: string, description: string) {
      try {
        await unlink(filePath)
        logForDebugging(`Manually removed ${description}: ${filePath}`)
        return true
      } catch {
        return false
      }
    }

    if (getPlatform().startsWith('win32')) {
      // Windows - only remove executables, not the package directory
      const binCmd = join(globalPrefix, 'claude.cmd')
      const binPs1 = join(globalPrefix, 'claude.ps1')
      const binExe = join(globalPrefix, 'claude')

      if (await tryRemove(binCmd, 'bin script')) {
        manuallyRemoved = true
      }

      if (await tryRemove(binPs1, 'PowerShell script')) {
        manuallyRemoved = true
      }

      if (await tryRemove(binExe, 'bin executable')) {
        manuallyRemoved = true
      }
    } else {
      // Unix/Mac - only remove symlink, not the package directory
      const binSymlink = join(globalPrefix, 'bin', 'claude')

      if (await tryRemove(binSymlink, 'bin symlink')) {
        manuallyRemoved = true
      }
    }
// Windows 要删三个（cmd 脚本、PowerShell 脚本、无扩展名 shim），Unix 只删 bin 下的符号链接。且**只删可执行入口、不删包目录**——注释与返回值里的警告都强调这点：删包目录风险太高（可能是用户共享的全局目录），留给用户自己确认。

    if (manuallyRemoved) {
      logForDebugging(`Successfully removed ${packageName} manually`)
      const nodeModulesPath = getPlatform().startsWith('win32')
        ? join(globalPrefix, 'node_modules', packageName)
        : join(globalPrefix, 'lib', 'node_modules', packageName)

      return {
        success: true,
        warning: `${packageName} executables removed, but node_modules directory was left intact for safety. You may manually delete it later at: ${nodeModulesPath}`,
      }
    } else {
      return { success: false }
    }
  } catch (manualError) {
    logForDebugging(`Manual removal failed: ${manualError}`, {
      level: 'error',
    })
    return {
      success: false,
      error: `Manual removal failed: ${manualError}`,
    }
  }
}
// npm 卸载失败（典型是目录非空的 ENOTEMPTY）时的手工兜底：先问 npm 全局 prefix，再按平台删入口文件。这里的小助手函数也遵循同一原则——只用 unlink 不用 stat 预检，因为 unlink 的 ENOENT 与「预检发现不存在」处理方式完全一样，预检只会多一次系统调用和一个 TOCTOU 窗口。

async function attemptNpmUninstall(
  packageName: string,
): Promise<{ success: boolean; error?: string; warning?: string }> {
  const { code, stderr } = await execFileNoThrowWithCwd(
    'npm',
    ['uninstall', '-g', packageName],
    // eslint-disable-next-line custom-rules/no-process-cwd -- matches original behavior
    { cwd: process.cwd() },
  )

  if (code === 0) {
    logForDebugging(`Removed global npm installation of ${packageName}`)
    return { success: true }
  } else if (stderr && !stderr.includes('npm ERR! code E404')) {
    // Check for ENOTEMPTY error and try manual removal
    if (stderr.includes('npm error code ENOTEMPTY')) {
      logForDebugging(
        `Failed to uninstall global npm package ${packageName}: ${stderr}`,
        { level: 'error' },
      )
      logForDebugging(`Attempting manual removal due to ENOTEMPTY error`)

      const manualResult = await manualRemoveNpmPackage(packageName)
      if (manualResult.success) {
        return { success: true, warning: manualResult.warning }
      } else if (manualResult.error) {
        return {
          success: false,
          error: `Failed to remove global npm installation of ${packageName}: ${stderr}. Manual removal also failed: ${manualResult.error}`,
        }
      }
    }

    // Only report as error if it's not a "package not found" error
    logForDebugging(
      `Failed to uninstall global npm package ${packageName}: ${stderr}`,
      { level: 'error' },
    )
    return {
      success: false,
      error: `Failed to remove global npm installation of ${packageName}: ${stderr}`,
    }
  }

  return { success: false } // Package not found, not an error
}
// 三层结果语义：退出码 0 成功；包不存在不算错误也不算成功；目录非空触发手工兜底。其余情况把标准错误原样带回上层——npm 的报错信息对用户排查最有用，不该被改写。

export async function cleanupNpmInstallations(): Promise<{
  removed: number
  errors: string[]
  warnings: string[]
}> {
  const errors: string[] = []
  const warnings: string[] = []
  let removed = 0

  // Always attempt to remove @anthropic-ai/claude-code
  const codePackageResult = await attemptNpmUninstall(
    '@anthropic-ai/claude-code',
  )
  if (codePackageResult.success) {
    removed++
    if (codePackageResult.warning) {
      warnings.push(codePackageResult.warning)
    }
  } else if (codePackageResult.error) {
    errors.push(codePackageResult.error)
  }

  // Also attempt to remove MACRO.PACKAGE_URL if it's defined and different
  if (MACRO.PACKAGE_URL && MACRO.PACKAGE_URL !== '@anthropic-ai/claude-code') {
    const macroPackageResult = await attemptNpmUninstall(MACRO.PACKAGE_URL)
    if (macroPackageResult.success) {
      removed++
      if (macroPackageResult.warning) {
        warnings.push(macroPackageResult.warning)
      }
    } else if (macroPackageResult.error) {
      errors.push(macroPackageResult.error)
    }
  }
// 除了固定的包名，还会尝试构建时注入的包地址（若存在且不同）。原因是发行渠道可能有多个包名（内部构建、企业分发），清理时要把两条都试一遍，否则切换渠道后会留下一个能覆盖 PATH 的旧入口。

  // Check for local installation at ~/.claude/local
  const localInstallDir = join(homedir(), '.claude', 'local')

  try {
    await rm(localInstallDir, { recursive: true })
    removed++
    logForDebugging(`Removed local installation at ${localInstallDir}`)
  } catch (error) {
    if (!isENOENT(error)) {
      errors.push(`Failed to remove ${localInstallDir}: ${error}`)
      logForDebugging(`Failed to remove local installation: ${error}`, {
        level: 'error',
      })
    }
  }

  return { removed, errors, warnings }
}
// 收尾：清 npm 包、清第二个包名、再删本地安装目录（早期版本把程序装在家目录下的固定位置）。返回「删了几个 + 错误 + 警告」三组信息，因为这三者对用户意义完全不同——警告里会说明「入口删了但模块目录留着」。
