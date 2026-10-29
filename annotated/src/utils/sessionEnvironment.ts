import { mkdir, readdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { getSessionId } from '../bootstrap/state.js'
import { logForDebugging } from './debug.js'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { errorMessage, getErrnoCode } from './errors.js'
import { getPlatform } from './platform.js'
// 文件入口：会话级环境脚本（env 文件）的读写与聚合，供 shell 命令继承激活的虚拟环境等。

// Cache states:
// undefined = not yet loaded (need to check disk)
// null = checked disk, no files exist (don't check again)
// string = loaded and cached (use cached value)
let sessionEnvScript: string | null | undefined = undefined
// 缓存状态三元组：undefined 未加载、null 已查无文件、string 已缓存。

export async function getSessionEnvDirPath(): Promise<string> {
  const sessionEnvDir = join(
    getClaudeConfigHomeDir(),
    'session-env',
    getSessionId(),
  )
  await mkdir(sessionEnvDir, { recursive: true })
  return sessionEnvDir
}
// getSessionEnvDirPath：创建并返回会话级 env 目录。

export async function getHookEnvFilePath(
  hookEvent: 'Setup' | 'SessionStart' | 'CwdChanged' | 'FileChanged',
  hookIndex: number,
): Promise<string> {
  const prefix = hookEvent.toLowerCase()
  return join(await getSessionEnvDirPath(), `${prefix}-hook-${hookIndex}.sh`)
}
// getHookEnvFilePath：按钩子事件类型与序号生成 .sh 文件名。

export async function clearCwdEnvFiles(): Promise<void> {
  try {
    const dir = await getSessionEnvDirPath()
    const files = await readdir(dir)
    await Promise.all(
      files
        .filter(
          f =>
            (f.startsWith('filechanged-hook-') ||
              f.startsWith('cwdchanged-hook-')) &&
            HOOK_ENV_REGEX.test(f),
        )
        .map(f => writeFile(join(dir, f), '')),
    )
  } catch (e: unknown) {
    const code = getErrnoCode(e)
    if (code !== 'ENOENT') {
      logForDebugging(`Failed to clear cwd env files: ${errorMessage(e)}`)
    }
  }
}
// clearCwdEnvFiles：清空与 cwd 相关的钩子 env 文件内容。

export function invalidateSessionEnvCache(): void {
  logForDebugging('Invalidating session environment cache')
  sessionEnvScript = undefined
}
// invalidateSessionEnvCache：置 undefined，触发下次重新读盘。

export async function getSessionEnvironmentScript(): Promise<string | null> {
  if (getPlatform() === 'windows') {
    logForDebugging('Session environment not yet supported on Windows')
    return null
  }

  if (sessionEnvScript !== undefined) {
    return sessionEnvScript
  }

  const scripts: string[] = []

  // Check for CLAUDE_ENV_FILE passed from parent process (e.g., HFI trajectory runner)
  // This allows venv/conda activation to persist across shell commands
  const envFile = process.env.CLAUDE_ENV_FILE
  if (envFile) {
    try {
      const envScript = (await readFile(envFile, 'utf8')).trim()
      if (envScript) {
        scripts.push(envScript)
        logForDebugging(
          `Session environment loaded from CLAUDE_ENV_FILE: ${envFile} (${envScript.length} chars)`,
        )
      }
    } catch (e: unknown) {
      const code = getErrnoCode(e)
      if (code !== 'ENOENT') {
        logForDebugging(`Failed to read CLAUDE_ENV_FILE: ${errorMessage(e)}`)
      }
    }
  }

  // Load hook environment files from session directory
  const sessionEnvDir = await getSessionEnvDirPath()
  try {
    const files = await readdir(sessionEnvDir)
    // We are sorting the hook env files by the order in which they are listed
    // in the settings.json file so that the resulting env is deterministic
    const hookFiles = files
      .filter(f => HOOK_ENV_REGEX.test(f))
      .sort(sortHookEnvFiles)

    for (const file of hookFiles) {
      const filePath = join(sessionEnvDir, file)
      try {
        const content = (await readFile(filePath, 'utf8')).trim()
        if (content) {
          scripts.push(content)
        }
      } catch (e: unknown) {
        const code = getErrnoCode(e)
        if (code !== 'ENOENT') {
          logForDebugging(
            `Failed to read hook file ${filePath}: ${errorMessage(e)}`,
          )
        }
      }
    }

    if (hookFiles.length > 0) {
      logForDebugging(
        `Session environment loaded from ${hookFiles.length} hook file(s)`,
      )
    }
  } catch (e: unknown) {
    const code = getErrnoCode(e)
    if (code !== 'ENOENT') {
      logForDebugging(
        `Failed to load session environment from hooks: ${errorMessage(e)}`,
      )
    }
  }

  if (scripts.length === 0) {
    logForDebugging('No session environment scripts found')
    sessionEnvScript = null
    return sessionEnvScript
  }
// 无脚本时置 null 并缓存，避免重复读盘。

  sessionEnvScript = scripts.join('\n')
  logForDebugging(
    `Session environment script ready (${sessionEnvScript.length} chars total)`,
  )
  return sessionEnvScript
}
// getSessionEnvironmentScript：聚合 CLAUDE_ENV_FILE 与各钩子 env 脚本，按优先级排序拼接。

const HOOK_ENV_PRIORITY: Record<string, number> = {
  setup: 0,
  sessionstart: 1,
  cwdchanged: 2,
  filechanged: 3,
}
const HOOK_ENV_REGEX =
  /^(setup|sessionstart|cwdchanged|filechanged)-hook-(\d+)\.sh$/
// HOOK_ENV_REGEX：匹配 setup / sessionstart / cwdchanged / filechanged 钩子的 env 文件名。

function sortHookEnvFiles(a: string, b: string): number {
  const aMatch = a.match(HOOK_ENV_REGEX)
  const bMatch = b.match(HOOK_ENV_REGEX)
  const aType = aMatch?.[1] || ''
  const bType = bMatch?.[1] || ''
  if (aType !== bType) {
    return (HOOK_ENV_PRIORITY[aType] ?? 99) - (HOOK_ENV_PRIORITY[bType] ?? 99)
  }
  const aIndex = parseInt(aMatch?.[2] || '0', 10)
  const bIndex = parseInt(bMatch?.[2] || '0', 10)
  return aIndex - bIndex
}
// sortHookEnvFiles：按类型优先级加序号排序，保证拼接顺序确定性。
