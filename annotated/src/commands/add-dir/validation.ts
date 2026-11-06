// 给 /add-dir 用的目录校验与文案：把能不能加进工作目录拆成可判别的结果类型
import chalk from 'chalk'
import { stat } from 'fs/promises'
import { dirname, resolve } from 'path'
import type { ToolPermissionContext } from '../../Tool.js'
import { getErrnoCode } from '../../utils/errors.js'
import { expandPath } from '../../utils/path.js'
import {
  allWorkingDirectories,
  pathInWorkingPath,
} from '../../utils/permissions/filesystem.js'

// 六种结果用联合类型表达：成功、空路径、找不到、不是目录、已在目录内
export type AddDirectoryResult =
  | {
      resultType: 'success'
      absolutePath: string
    }
  | {
      resultType: 'emptyPath'
    }
  | {
      resultType: 'pathNotFound' | 'notADirectory'
      directoryPath: string
      absolutePath: string
    }
  | {
      resultType: 'alreadyInWorkingDirectory'
      directoryPath: string
      workingDir: string
    }

// 校验主函数：空路径直接返回，再解析绝对路径、查存在性、查是否已在目录内
export async function validateDirectoryForWorkspace(
  directoryPath: string,
  permissionContext: ToolPermissionContext,
): Promise<AddDirectoryResult> {
  if (!directoryPath) {
    return {
      resultType: 'emptyPath',
    }
  }

// resolve 去掉 expandPath 可能留的尾斜杠，让 /foo 与 /foo/ 落到同一存储键（CC-33）
  // resolve() strips the trailing slash expandPath can leave on absolute
  // inputs, so /foo and /foo/ map to the same storage key (CC-33).
// 解析后统一成绝对路径，后面所有判断都基于它
  const absolutePath = resolve(expandPath(directoryPath))

  // Check if path exists and is a directory (single syscall)
// 单系统调用同时确认存在且是目录；不是目录立即返回
  try {
    const stats = await stat(absolutePath)
    if (!stats.isDirectory()) {
      return {
        resultType: 'notADirectory',
        directoryPath,
        absolutePath,
      }
    }
// 访问错误按 errno 码归类：ENOENT / ENOTDIR / EACCES / EPERM 都算找不到，不抛错（避免启动崩）
  } catch (e: unknown) {
    const code = getErrnoCode(e)
    // Match prior existsSync() semantics: treat any of these as "not found"
    // rather than re-throwing. EACCES/EPERM in particular must not crash
    // startup when a settings-configured additional directory is inaccessible.
    if (
      code === 'ENOENT' ||
      code === 'ENOTDIR' ||
      code === 'EACCES' ||
      code === 'EPERM'
    ) {
      return {
        resultType: 'pathNotFound',
        directoryPath,
        absolutePath,
      }
    }
    throw e
  }

// 拿当前权限上下文里所有工作目录，逐个判断是否已覆盖
  // Get current permission context
  const currentWorkingDirs = allWorkingDirectories(permissionContext)

  // Check if already within an existing working directory
// 遍历现有工作目录：绝对路径落在某个之内就返回已在目录内
  for (const workingDir of currentWorkingDirs) {
    if (pathInWorkingPath(absolutePath, workingDir)) {
      return {
        resultType: 'alreadyInWorkingDirectory',
        directoryPath,
        workingDir,
      }
    }
  }

// 成功路径：所有检查通过，返回绝对路径与 success
  return {
    resultType: 'success',
    absolutePath,
  }
}

// 把结果类型翻译成用户文案：每种失败给对应提示，找不到时建议改用父目录
export function addDirHelpMessage(result: AddDirectoryResult): string {
  switch (result.resultType) {
    case 'emptyPath':
      return 'Please provide a directory path.'
    case 'pathNotFound':
      return `Path ${chalk.bold(result.absolutePath)} was not found.`
// 不是目录时贴心提示是不是想加父目录，减少误操作
    case 'notADirectory': {
      const parentDir = dirname(result.absolutePath)
      return `${chalk.bold(result.directoryPath)} is not a directory. Did you mean to add the parent directory ${chalk.bold(parentDir)}?`
    }
    case 'alreadyInWorkingDirectory':
      return `${chalk.bold(result.directoryPath)} is already accessible within the existing working directory ${chalk.bold(result.workingDir)}.`
    case 'success':
      return `Added ${chalk.bold(result.absolutePath)} as a working directory.`
  }
}
