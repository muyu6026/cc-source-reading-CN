// 跨项目恢复会话的判定。用户在会话列表里选了一条属于别的项目目录的记录时，要先分清三种情况：同目录无需处理、同仓库的另一个工作树可以直接恢复、完全不同的项目则必须先切目录。返回值用可辨识联合表达这三种结果，让调用方在类型层面被强制分支处理。
import { sep } from 'path'
import { getOriginalCwd } from '../bootstrap/state.js'
import type { LogOption } from '../types/logs.js'
import { quote } from './bash/shellQuote.js'
import { getSessionIdFromLog } from './sessionStorage.js'

export type CrossProjectResumeResult =
  | {
      isCrossProject: false
    }
  | {
      isCrossProject: true
      isSameRepoWorktree: true
      projectPath: string
    }
  | {
      isCrossProject: true
      isSameRepoWorktree: false
      command: string
      projectPath: string
    }
// 联合的三个成员把信息量控制在必要范围：完全同项目只给一个布尔；同仓库工作树额外带目标路径，好让调用方知道落在哪；跨仓库则再带上一条完整的切换并恢复命令。这样调用方不需要自己拼命令行。

/**
 * Check if a log is from a different project directory and determine
 * whether it's a related worktree or a completely different project.
 *
 * For same-repo worktrees, we can resume directly without requiring cd.
 * For different projects, we generate the cd command.
 */
export function checkCrossProjectResume(
  log: LogOption,
  showAllProjects: boolean,
  worktreePaths: string[],
): CrossProjectResumeResult {
  const currentCwd = getOriginalCwd()

  if (!showAllProjects || !log.projectPath || log.projectPath === currentCwd) {
    return { isCrossProject: false }
  }
// 第一道闸是「没开启全项目视图、没有记录项目路径、或者路径就是当前目录」，三种都当作同项目处理，直接返回否定结果，后续逻辑一律不执行。

  // Gate worktree detection to ants only for staged rollout
  if (process.env.USER_TYPE !== 'ant') {
    const sessionId = getSessionIdFromLog(log)
    const command = `cd ${quote([log.projectPath])} && claude --resume ${sessionId}`
    return {
      isCrossProject: true,
      isSameRepoWorktree: false,
      command,
      projectPath: log.projectPath,
    }
  }
// 工作树识别先做了灰度限制：非内部账号直接走「生成切换命令」这条保守路径。这一步把新能力的暴露面收在一个开关后面，同时对普通用户保持行为不变。生成命令时路径经过反引号内的转义函数处理，避免带空格或特殊字符的目录名把命令拼坏。

  // Check if log.projectPath is under a worktree of the same repo
  const isSameRepo = worktreePaths.some(
    wt => log.projectPath === wt || log.projectPath!.startsWith(wt + sep),
  )

  if (isSameRepo) {
    return {
      isCrossProject: true,
      isSameRepoWorktree: true,
      projectPath: log.projectPath,
    }
  }
// 同仓库判定是「路径等于工作树根，或者以工作树根加路径分隔符开头」。第二个条件必须带分隔符，否则前缀相同的兄弟目录会被误判成本仓库工作树。

  // Different repo - generate cd command
  const sessionId = getSessionIdFromLog(log)
  const command = `cd ${quote([log.projectPath])} && claude --resume ${sessionId}`
  return {
    isCrossProject: true,
    isSameRepoWorktree: false,
    command,
    projectPath: log.projectPath,
  }
}
// 跨仓库分支与前面的保守路径生成同一条命令，唯一差别是它只在内部账号的工作树判定失败后才会走到。会话标识从日志记录里取，取法封装在会话存储模块里，这里不关心它存在哪个字段。
