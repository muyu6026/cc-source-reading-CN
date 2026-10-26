// 文件级：本文件定义了一套简化的文件系统操作抽象 `FsOperations`，把 Node `fs` 常用同步 / 异步操作收口成统一接口，便于替换实现（mock、虚拟盘）。同时提供符号链接感知的路径解析、权限检查路径收集、文件区间与尾部读取、反向逐行读取等工具。
import * as fs from 'fs'
import {
  mkdir as mkdirPromise,
  open,
  readdir as readdirPromise,
  readFile as readFilePromise,
  rename as renamePromise,
  rmdir as rmdirPromise,
  rm as rmPromise,
  stat as statPromise,
  unlink as unlinkPromise,
} from 'fs/promises'
import { homedir } from 'os'
import * as nodePath from 'path'
import { getErrnoCode } from './errors.js'
import { slowLogging } from './slowOperations.js'

/**
 * Simplified filesystem operations interface based on Node.js fs module.
 * Provides a subset of commonly used sync operations with type safety.
 * Allows abstraction for alternative implementations (e.g., mock, virtual).
 */
export type FsOperations = {
// `FsOperations` 类型：文件系统操作接口，覆盖访问信息、内容读写、链接、目录等一系列常用方法，全部带类型约束。
  // File access and information operations
  /** Gets the current working directory */
  cwd(): string
  /** Checks if a file or directory exists */
  existsSync(path: string): boolean
  /** Gets file stats asynchronously */
  stat(path: string): Promise<fs.Stats>
  /** Lists directory contents with file type information asynchronously */
  readdir(path: string): Promise<fs.Dirent[]>
  /** Deletes file asynchronously */
  unlink(path: string): Promise<void>
  /** Removes an empty directory asynchronously */
  rmdir(path: string): Promise<void>
  /** Removes files and directories asynchronously (with recursive option) */
  rm(
    path: string,
    options?: { recursive?: boolean; force?: boolean },
  ): Promise<void>
  /** Creates directory recursively asynchronously. */
  mkdir(path: string, options?: { mode?: number }): Promise<void>
  /** Reads file content as string asynchronously */
  readFile(path: string, options: { encoding: BufferEncoding }): Promise<string>
  /** Renames/moves file asynchronously */
  rename(oldPath: string, newPath: string): Promise<void>
  /** Gets file stats */
  statSync(path: string): fs.Stats
  /** Gets file stats without following symlinks */
  lstatSync(path: string): fs.Stats

  // File content operations
  /** Reads file content as string with specified encoding */
  readFileSync(
    path: string,
    options: {
      encoding: BufferEncoding
    },
  ): string
  /** Reads raw file bytes as Buffer */
  readFileBytesSync(path: string): Buffer
  /** Reads specified number of bytes from file start */
  readSync(
    path: string,
    options: {
      length: number
    },
  ): {
    buffer: Buffer
    bytesRead: number
  }
  /** Appends string to file */
  appendFileSync(path: string, data: string, options?: { mode?: number }): void
  /** Copies file from source to destination */
  copyFileSync(src: string, dest: string): void
  /** Deletes file */
  unlinkSync(path: string): void
  /** Renames/moves file */
  renameSync(oldPath: string, newPath: string): void
  /** Creates hard link */
  linkSync(target: string, path: string): void
  /** Creates symbolic link */
  symlinkSync(
    target: string,
    path: string,
    type?: 'dir' | 'file' | 'junction',
  ): void
  /** Reads symbolic link */
  readlinkSync(path: string): string
  /** Resolves symbolic links and returns the canonical pathname */
  realpathSync(path: string): string

  // Directory operations
  /** Creates directory recursively. Mode defaults to 0o777 & ~umask if not specified. */
  mkdirSync(
    path: string,
    options?: {
      mode?: number
    },
  ): void
  /** Lists directory contents with file type information */
  readdirSync(path: string): fs.Dirent[]
  /** Lists directory contents as strings */
  readdirStringSync(path: string): string[]
  /** Checks if the directory is empty */
  isDirEmptySync(path: string): boolean
  /** Removes an empty directory */
  rmdirSync(path: string): void
  /** Removes files and directories (with recursive option) */
  rmSync(
    path: string,
    options?: {
      recursive?: boolean
      force?: boolean
    },
  ): void
  /** Create a writable stream for writing data to a file. */
  createWriteStream(path: string): fs.WriteStream
  /** Reads raw file bytes as Buffer asynchronously.
   *  When maxBytes is set, only reads up to that many bytes. */
  readFileBytes(path: string, maxBytes?: number): Promise<Buffer>
}

/**
 * Safely resolves a file path, handling symlinks and errors gracefully.
 *
 * Error handling strategy:
 * - If the file doesn't exist, returns the original path (allows for file creation)
 * - If symlink resolution fails (broken symlink, permission denied, circular links),
 *   returns the original path and marks it as not a symlink
 * - This ensures operations can continue with the original path rather than failing
 *
 * @param fs The filesystem implementation to use
 * @param filePath The path to resolve
 * @returns Object containing the resolved path and whether it was a symlink
 */
export function safeResolvePath(
// `safeResolvePath`：安全地解析路径并解析符号链接；先做 UNC 拦截，再用 lstat 识别 FIFO / 套接字 / 设备等特殊文件（realpath 会卡在这些上面），最后 realpath 求规范路径，任何失败都退回原路径以允许后续创建。
  fs: FsOperations,
  filePath: string,
): { resolvedPath: string; isSymlink: boolean; isCanonical: boolean } {
  // Block UNC paths before any filesystem access to prevent network
  // requests (DNS/SMB) during validation on Windows
  if (filePath.startsWith('//') || filePath.startsWith('\\\\')) {
// 先拦截 UNC 路径（以 // 或两个反斜杠开头），避免 Windows 校验阶段发起 DNS / SMB 网络请求。
    return { resolvedPath: filePath, isSymlink: false, isCanonical: false }
  }

  try {
    // Check for special file types (FIFOs, sockets, devices) before calling realpathSync.
    // realpathSync can block on FIFOs waiting for a writer, causing hangs.
    // If the file doesn't exist, lstatSync throws ENOENT which the catch
    // below handles by returning the original path (allows file creation).
    const stats = fs.lstatSync(filePath)
// 用 lstat（不跟随符号链接）探查文件类型，特殊设备文件直接退回原路径，避免 realpath 阻塞。
    if (
      stats.isFIFO() ||
      stats.isSocket() ||
      stats.isCharacterDevice() ||
      stats.isBlockDevice()
    ) {
      return { resolvedPath: filePath, isSymlink: false, isCanonical: false }
    }

    const resolvedPath = fs.realpathSync(filePath)
    return {
      resolvedPath,
      isSymlink: resolvedPath !== filePath,
      // realpathSync returned: resolvedPath is canonical (all symlinks in
      // all path components resolved). Callers can skip further symlink
      // resolution on this path.
      isCanonical: true,
    }
  } catch (_error) {
    // If lstat/realpath fails for any reason (ENOENT, broken symlink,
    // EACCES, ELOOP, etc.), return the original path to allow operations
    // to proceed
    return { resolvedPath: filePath, isSymlink: false, isCanonical: false }
  }
}

/**
 * Check if a file path is a duplicate and should be skipped.
 * Resolves symlinks to detect duplicates pointing to the same file.
 * If not a duplicate, adds the resolved path to loadedPaths.
 *
 * @returns true if the file should be skipped (is duplicate)
 */
export function isDuplicatePath(
// `isDuplicatePath`：通过解析符号链接检测指向同一文件的重复路径；非重复则把解析后的路径记入集合并返回 false。
  fs: FsOperations,
  filePath: string,
  loadedPaths: Set<string>,
): boolean {
  const { resolvedPath } = safeResolvePath(fs, filePath)
  if (loadedPaths.has(resolvedPath)) {
    return true
  }
  loadedPaths.add(resolvedPath)
  return false
}

/**
 * Resolve the deepest existing ancestor of a path via realpathSync, walking
 * up until it succeeds. Detects dangling symlinks (link entry exists, target
 * doesn't) via lstat and resolves them via readlink.
 *
 * Use when the input path may not exist (new file writes) and you need to
 * know where the write would ACTUALLY land after the OS follows symlinks.
 *
 * Returns the resolved absolute path with non-existent tail segments
 * rejoined, or undefined if no symlink was found in any existing ancestor
 * (the path's existing ancestors all resolve to themselves).
 *
 * Handles: live parent symlinks, dangling file symlinks, dangling parent
 * symlinks. Same core algorithm as teamMemPaths.ts:realpathDeepestExisting.
 */
export function resolveDeepestExistingAncestorSync(
// `resolveDeepestExistingAncestorSync`：沿路径向上走，找到最深已存在的祖先并解析其中的符号链接（含悬空链接），返回写入实际落点的绝对路径；用于路径可能尚不存在、但需预知真实落点的情况。
  fs: FsOperations,
  absolutePath: string,
): string | undefined {
  let dir = absolutePath
  const segments: string[] = []
  // Walk up using lstat (cheap, O(1)) to find the first existing component.
  // lstat does not follow symlinks, so dangling symlinks are detected here.
  // Only call realpathSync (expensive, O(depth)) once at the end.
  while (dir !== nodePath.dirname(dir)) {
    let st: fs.Stats
    try {
      st = fs.lstatSync(dir)
    } catch {
      // lstat failed: truly non-existent. Walk up.
      segments.unshift(nodePath.basename(dir))
      dir = nodePath.dirname(dir)
      continue
    }
    if (st.isSymbolicLink()) {
      // Found a symlink (live or dangling). Try realpath first (resolves
      // chained symlinks); fall back to readlink for dangling symlinks.
      try {
        const resolved = fs.realpathSync(dir)
        return segments.length === 0
          ? resolved
          : nodePath.join(resolved, ...segments)
      } catch {
        // Dangling: realpath failed but lstat saw the link entry.
        const target = fs.readlinkSync(dir)
        const absTarget = nodePath.isAbsolute(target)
          ? target
          : nodePath.resolve(nodePath.dirname(dir), target)
        return segments.length === 0
          ? absTarget
          : nodePath.join(absTarget, ...segments)
      }
    }
    // Existing non-symlink component. One realpath call resolves any
    // symlinks in its ancestors. If none, return undefined (no symlink).
    try {
      const resolved = fs.realpathSync(dir)
      if (resolved !== dir) {
        return segments.length === 0
          ? resolved
          : nodePath.join(resolved, ...segments)
      }
    } catch {
      // realpath can still fail (e.g. EACCES in ancestors). Return
      // undefined — we can't resolve, and the logical path is already
      // in pathSet for the caller.
    }
    return undefined
  }
  return undefined
}

/**
 * Gets all paths that should be checked for permissions.
 * This includes the original path, all intermediate symlink targets in the chain,
 * and the final resolved path.
 *
 * For example, if test.txt -> /etc/passwd -> /private/etc/passwd:
 * - test.txt (original path)
 * - /etc/passwd (intermediate symlink target)
 * - /private/etc/passwd (final resolved path)
 *
 * This is important for security: a deny rule for /etc/passwd should block
 * access even if the file is actually at /private/etc/passwd (as on macOS).
 *
 * @param path - The path to check (will be converted to absolute)
 * @returns An array of absolute paths to check permissions for
 */
export function getPathsForPermissionCheck(inputPath: string): string[] {
// `getPathsForPermissionCheck`：收集权限检查要覆盖的全部路径——原始路径、符号链接链上所有中间目标、最终解析路径。关键安全意义：对 passwd 文件的拒绝规则也该拦住其真实路径（macOS 上），否则可借符号链接越权。
  // Expand tilde notation defensively - tools should do this in getPath(),
  // but we normalize here as defense in depth for permission checking
  let path = inputPath
  if (path === '~') {
    path = homedir().normalize('NFC')
  } else if (path.startsWith('~/')) {
    path = nodePath.join(homedir().normalize('NFC'), path.slice(2))
  }

  const pathSet = new Set<string>()
  const fsImpl = getFsImplementation()

  // Always check the original path
  pathSet.add(path)

  // Block UNC paths before any filesystem access to prevent network
  // requests (DNS/SMB) during validation on Windows
  if (path.startsWith('//') || path.startsWith('\\\\')) {
    return Array.from(pathSet)
  }

  // Follow the symlink chain, collecting ALL intermediate targets
  // This handles cases like: test.txt -> /etc/passwd -> /private/etc/passwd
  // We want to check all three paths, not just test.txt and /private/etc/passwd
  try {
    let currentPath = path
    const visited = new Set<string>()
    const maxDepth = 40 // Prevent runaway loops, matches typical SYMLOOP_MAX
// 符号链接链遍历设最大深度 40，防止循环链接导致死循环，与典型 SYMLOOP_MAX 对齐。

    for (let depth = 0; depth < maxDepth; depth++) {
      // Prevent infinite loops from circular symlinks
      if (visited.has(currentPath)) {
        break
      }
      visited.add(currentPath)

      if (!fsImpl.existsSync(currentPath)) {
        // Path doesn't exist (new file case). existsSync follows symlinks,
        // so this is also reached for DANGLING symlinks (link entry exists,
        // target doesn't). Resolve symlinks in the path and its ancestors
        // so permission checks see the real destination. Without this,
        // `./data -> /etc/cron.d/` (live parent symlink) or
        // `./evil.txt -> ~/.ssh/authorized_keys2` (dangling file symlink)
        // would allow writes that escape the working directory.
// 注释举例：悬空文件符号链接（如 evil.txt 指向 ssh 授权文件）若不解析真实目标，会绕过工作目录约束写出越权文件。
        if (currentPath === path) {
          const resolved = resolveDeepestExistingAncestorSync(fsImpl, path)
          if (resolved !== undefined) {
            pathSet.add(resolved)
          }
        }
        break
      }

      const stats = fsImpl.lstatSync(currentPath)

      // Skip special file types that can cause issues
      if (
        stats.isFIFO() ||
        stats.isSocket() ||
        stats.isCharacterDevice() ||
        stats.isBlockDevice()
      ) {
        break
      }

      if (!stats.isSymbolicLink()) {
        break
      }

      // Get the immediate symlink target
      const target = fsImpl.readlinkSync(currentPath)

      // If target is relative, resolve it relative to the symlink's directory
      const absoluteTarget = nodePath.isAbsolute(target)
        ? target
        : nodePath.resolve(nodePath.dirname(currentPath), target)

      // Add this intermediate target to the set
      pathSet.add(absoluteTarget)
      currentPath = absoluteTarget
    }
  } catch {
    // If anything fails during chain traversal, continue with what we have
  }

  // Also add the final resolved path using realpathSync for completeness
  // This handles any remaining symlinks in directory components
  const { resolvedPath, isSymlink } = safeResolvePath(fsImpl, path)
  if (isSymlink && resolvedPath !== path) {
    pathSet.add(resolvedPath)
  }

  return Array.from(pathSet)
}

export const NodeFsOperations: FsOperations = {
// `NodeFsOperations`：基于真实 Node `fs` 的默认实现，逐项包了一层 slowLogging 以便把慢操作计入日志。
  cwd() {
    return process.cwd()
  },

  existsSync(fsPath) {
// `existsSync` 等同步方法都包了 `slowLogging` 模板标签，自动记录耗时偏长的文件系统调用。
    using _ = slowLogging`fs.existsSync(${fsPath})`
    return fs.existsSync(fsPath)
  },

  async stat(fsPath) {
    return statPromise(fsPath)
  },

  async readdir(fsPath) {
    return readdirPromise(fsPath, { withFileTypes: true })
  },

  async unlink(fsPath) {
    return unlinkPromise(fsPath)
  },

  async rmdir(fsPath) {
    return rmdirPromise(fsPath)
  },

  async rm(fsPath, options) {
    return rmPromise(fsPath, options)
  },

  async mkdir(dirPath, options) {
    try {
      await mkdirPromise(dirPath, { recursive: true, ...options })
    } catch (e) {
      // Bun/Windows: recursive:true throws EEXIST on directories with the
      // FILE_ATTRIBUTE_READONLY bit set (Group Policy, OneDrive, desktop.ini).
      // Bun's directoryExistsAt misclassifies DIRECTORY+READONLY as not-a-dir
      // (bun-internal src/sys.zig existsAtType). The dir exists; ignore.
      // https://github.com/anthropics/claude-code/issues/30924
      if (getErrnoCode(e) !== 'EEXIST') throw e
    }
  },

  async readFile(fsPath, options) {
    return readFilePromise(fsPath, { encoding: options.encoding })
  },

  async rename(oldPath, newPath) {
    return renamePromise(oldPath, newPath)
  },

  statSync(fsPath) {
    using _ = slowLogging`fs.statSync(${fsPath})`
    return fs.statSync(fsPath)
  },

  lstatSync(fsPath) {
    using _ = slowLogging`fs.lstatSync(${fsPath})`
    return fs.lstatSync(fsPath)
  },

  readFileSync(fsPath, options) {
    using _ = slowLogging`fs.readFileSync(${fsPath})`
    return fs.readFileSync(fsPath, { encoding: options.encoding })
  },

  readFileBytesSync(fsPath) {
    using _ = slowLogging`fs.readFileBytesSync(${fsPath})`
    return fs.readFileSync(fsPath)
  },

  readSync(fsPath, options) {
// `readSync`：以 fd 方式读取指定长度的字节，用 finally 保证文件描述符关闭。
    using _ = slowLogging`fs.readSync(${fsPath}, ${options.length} bytes)`
    let fd: number | undefined = undefined
    try {
      fd = fs.openSync(fsPath, 'r')
      const buffer = Buffer.alloc(options.length)
      const bytesRead = fs.readSync(fd, buffer, 0, options.length, 0)
      return { buffer, bytesRead }
    } finally {
      if (fd) fs.closeSync(fd)
    }
  },

  appendFileSync(path, data, options) {
// `appendFileSync`：指定 mode 的新文件用 ax（原子创建带权限）打开，规避存在性检查与打开之间的 TOCTOU 竞态；已存在则退回普通追加。
    using _ = slowLogging`fs.appendFileSync(${path}, ${data.length} chars)`
    // For new files with explicit mode, use 'ax' (atomic create-with-mode) to avoid
    // TOCTOU race between existence check and open. Fall back to normal append if exists.
    if (options?.mode !== undefined) {
      try {
        const fd = fs.openSync(path, 'ax', options.mode)
        try {
          fs.appendFileSync(fd, data)
        } finally {
          fs.closeSync(fd)
        }
        return
      } catch (e) {
        if (getErrnoCode(e) !== 'EEXIST') throw e
        // File exists — fall through to normal append
      }
    }
    fs.appendFileSync(path, data)
  },

  copyFileSync(src, dest) {
    using _ = slowLogging`fs.copyFileSync(${src} → ${dest})`
    fs.copyFileSync(src, dest)
  },

  unlinkSync(path: string) {
    using _ = slowLogging`fs.unlinkSync(${path})`
    fs.unlinkSync(path)
  },

  renameSync(oldPath: string, newPath: string) {
    using _ = slowLogging`fs.renameSync(${oldPath} → ${newPath})`
    fs.renameSync(oldPath, newPath)
  },

  linkSync(target: string, path: string) {
    using _ = slowLogging`fs.linkSync(${target} → ${path})`
    fs.linkSync(target, path)
  },

  symlinkSync(
// `symlinkSync` / `readlinkSync` / `realpathSync` 等链接相关方法，realpath 结果统一做 NFC 归一化。
    target: string,
    path: string,
    type?: 'dir' | 'file' | 'junction',
  ) {
    using _ = slowLogging`fs.symlinkSync(${target} → ${path})`
    fs.symlinkSync(target, path, type)
  },

  readlinkSync(path: string) {
    using _ = slowLogging`fs.readlinkSync(${path})`
    return fs.readlinkSync(path)
  },

  realpathSync(path: string) {
// `realpathSync` 返回结果统一做 NFC 归一化，保证组合字符形式一致（macOS 尤其重要）。
    using _ = slowLogging`fs.realpathSync(${path})`
    return fs.realpathSync(path).normalize('NFC')
  },

  mkdirSync(dirPath, options) {
    using _ = slowLogging`fs.mkdirSync(${dirPath})`
    const mkdirOptions: { recursive: boolean; mode?: number } = {
      recursive: true,
    }
    if (options?.mode !== undefined) {
      mkdirOptions.mode = options.mode
    }
    try {
      fs.mkdirSync(dirPath, mkdirOptions)
    } catch (e) {
      // Bun/Windows: recursive:true throws EEXIST on directories with the
      // FILE_ATTRIBUTE_READONLY bit set (Group Policy, OneDrive, desktop.ini).
      // Bun's directoryExistsAt misclassifies DIRECTORY+READONLY as not-a-dir
      // (bun-internal src/sys.zig existsAtType). The dir exists; ignore.
      // https://github.com/anthropics/claude-code/issues/30924
      if (getErrnoCode(e) !== 'EEXIST') throw e
    }
  },

  readdirSync(dirPath) {
    using _ = slowLogging`fs.readdirSync(${dirPath})`
    return fs.readdirSync(dirPath, { withFileTypes: true })
  },

  readdirStringSync(dirPath) {
    using _ = slowLogging`fs.readdirStringSync(${dirPath})`
    return fs.readdirSync(dirPath)
  },

  isDirEmptySync(dirPath) {
    using _ = slowLogging`fs.isDirEmptySync(${dirPath})`
    const files = this.readdirSync(dirPath)
    return files.length === 0
  },

  rmdirSync(dirPath) {
    using _ = slowLogging`fs.rmdirSync(${dirPath})`
    fs.rmdirSync(dirPath)
  },

  rmSync(path, options) {
    using _ = slowLogging`fs.rmSync(${path})`
    fs.rmSync(path, options)
  },

  createWriteStream(path: string) {
    return fs.createWriteStream(path)
  },

  async readFileBytes(fsPath: string, maxBytes?: number) {
    if (maxBytes === undefined) {
      return readFilePromise(fsPath)
    }
    const handle = await open(fsPath, 'r')
    try {
      const { size } = await handle.stat()
      const readSize = Math.min(size, maxBytes)
      const buffer = Buffer.allocUnsafe(readSize)
      let offset = 0
      while (offset < readSize) {
        const { bytesRead } = await handle.read(
          buffer,
          offset,
          readSize - offset,
          offset,
        )
        if (bytesRead === 0) break
        offset += bytesRead
      }
      return offset < readSize ? buffer.subarray(0, offset) : buffer
    } finally {
      await handle.close()
    }
  },
}

// The currently active filesystem implementation
// 模块级当前生效的文件系统实现，默认是 `NodeFsOperations`。
let activeFs: FsOperations = NodeFsOperations

/**
 * Overrides the filesystem implementation. Note: This function does not
 * automatically update cwd.
 * @param implementation The filesystem implementation to use
 */
export function setFsImplementation(implementation: FsOperations): void {
// `setFsImplementation`：替换当前生效的文件系统实现（注意不会自动更新 cwd）。
  activeFs = implementation
}

/**
 * Gets the currently active filesystem implementation
 * @returns The currently active filesystem implementation
 */
export function getFsImplementation(): FsOperations {
// `getFsImplementation`：取当前生效的文件系统实现。
  return activeFs
}

/**
 * Resets the filesystem implementation to the default Node.js implementation.
 * Note: This function does not automatically update cwd.
 */
export function setOriginalFsImplementation(): void {
// `setOriginalFsImplementation`：把实现重置回默认 Node 版本。
  activeFs = NodeFsOperations
}

export type ReadFileRangeResult = {
// `ReadFileRangeResult` 类型：区间读取的结果，含内容、本次读取字节与文件总字节。
  content: string
  bytesRead: number
  bytesTotal: number
}

/**
 * Read up to `maxBytes` from a file starting at `offset`.
 * Returns a flat string from Buffer — no sliced string references to a
 * larger parent. Returns null if the file is smaller than the offset.
 */
export async function readFileRange(
// `readFileRange`：从指定偏移读取至多 maxBytes，返回从 Buffer 解码的扁平字符串（不持有父串切片）；文件小于偏移则返回 null。
  path: string,
  offset: number,
  maxBytes: number,
): Promise<ReadFileRangeResult | null> {
  await using fh = await open(path, 'r')
  const size = (await fh.stat()).size
  if (size <= offset) {
    return null
  }
  const bytesToRead = Math.min(size - offset, maxBytes)
  const buffer = Buffer.allocUnsafe(bytesToRead)

  let totalRead = 0
  while (totalRead < bytesToRead) {
    const { bytesRead } = await fh.read(
      buffer,
      totalRead,
      bytesToRead - totalRead,
      offset + totalRead,
    )
    if (bytesRead === 0) {
      break
    }
    totalRead += bytesRead
  }

  return {
    content: buffer.toString('utf8', 0, totalRead),
    bytesRead: totalRead,
    bytesTotal: size,
  }
}

/**
 * Read the last `maxBytes` of a file.
 * Returns the whole file if it's smaller than maxBytes.
 */
export async function tailFile(
// `tailFile`：读文件末尾 maxBytes，文件更小时返回整文件。
  path: string,
  maxBytes: number,
): Promise<ReadFileRangeResult> {
  await using fh = await open(path, 'r')
  const size = (await fh.stat()).size
  if (size === 0) {
    return { content: '', bytesRead: 0, bytesTotal: 0 }
  }
  const offset = Math.max(0, size - maxBytes)
  const bytesToRead = size - offset
  const buffer = Buffer.allocUnsafe(bytesToRead)

  let totalRead = 0
  while (totalRead < bytesToRead) {
    const { bytesRead } = await fh.read(
      buffer,
      totalRead,
      bytesToRead - totalRead,
      offset + totalRead,
    )
    if (bytesRead === 0) {
      break
    }
    totalRead += bytesRead
  }

  return {
    content: buffer.toString('utf8', 0, totalRead),
    bytesRead: totalRead,
    bytesTotal: size,
  }
}

/**
 * Async generator that yields lines from a file in reverse order.
 * Reads the file backwards in chunks to avoid loading the entire file into memory.
 * @param path - The path to the file to read
 * @returns An async generator that yields lines in reverse order
 */
export async function* readLinesReverse(
// `readLinesReverse`：异步生成器，从文件末尾分块反向读，按行倒序产出；跨块保留原始字节以保证多字节 UTF-8 不被截断（history.jsonl 解析安全）。
  path: string,
): AsyncGenerator<string, void, undefined> {
  const CHUNK_SIZE = 1024 * 4
  const fileHandle = await open(path, 'r')
  try {
    const stats = await fileHandle.stat()
    let position = stats.size
    // Carry raw bytes (not a decoded string) across chunk boundaries so that
    // multi-byte UTF-8 sequences split by the 4KB boundary are not corrupted.
    // Decoding per-chunk would turn a split sequence into U+FFFD on both sides,
    // which for history.jsonl means JSON.parse throws and the entry is dropped.
    let remainder = Buffer.alloc(0)
    const buffer = Buffer.alloc(CHUNK_SIZE)

    while (position > 0) {
      const currentChunkSize = Math.min(CHUNK_SIZE, position)
      position -= currentChunkSize

      await fileHandle.read(buffer, 0, currentChunkSize, position)
      const combined = Buffer.concat([
        buffer.subarray(0, currentChunkSize),
        remainder,
      ])

      const firstNewline = combined.indexOf(0x0a)
      if (firstNewline === -1) {
        remainder = combined
        continue
      }

      remainder = Buffer.from(combined.subarray(0, firstNewline))
      const lines = combined.toString('utf8', firstNewline + 1).split('\n')

      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i]!
        if (line) {
          yield line
        }
      }
    }

    if (remainder.length > 0) {
      yield remainder.toString('utf8')
    }
  } finally {
    await fileHandle.close()
  }
}
