import { z } from 'zod/v4'
import {
  getOriginalCwd,
  getProjectRoot,
  setOriginalCwd,
  setProjectRoot,
} from '../../bootstrap/state.js'
import { clearSystemPromptSections } from '../../constants/systemPromptSections.js'
import { logEvent } from '../../services/analytics/index.js'
import type { Tool } from '../../Tool.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { count } from '../../utils/array.js'
import { clearMemoryFileCaches } from '../../utils/claudemd.js'
import { execFileNoThrow } from '../../utils/execFileNoThrow.js'
import { updateHooksConfigSnapshot } from '../../utils/hooks/hooksConfigSnapshot.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { getPlansDirectory } from '../../utils/plans.js'
import { setCwd } from '../../utils/Shell.js'
import { saveWorktreeState } from '../../utils/sessionStorage.js'
import {
  cleanupWorktree,
  getCurrentWorktreeSession,
  keepWorktree,
  killTmuxSession,
} from '../../utils/worktree.js'
import { EXIT_WORKTREE_TOOL_NAME } from './constants.js'
import { getExitWorktreeToolPrompt } from './prompt.js'
import { renderToolResultMessage, renderToolUseMessage } from './UI.js'

// inputSchema：action 二选一（keep 保留 / remove 删除），discard_changes 是 remove 时的二次确认开关。
const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z
      .enum(['keep', 'remove'])
      .describe(
        '"keep" leaves the worktree and branch on disk; "remove" deletes both.',
      ),
    discard_changes: z
      .boolean()
      .optional()
      .describe(
        'Required true when action is "remove" and the worktree has uncommitted files or unmerged commits. The tool will refuse and list them otherwise.',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    action: z.enum(['keep', 'remove']),
    originalCwd: z.string(),
    worktreePath: z.string(),
    worktreeBranch: z.string().optional(),
    tmuxSessionName: z.string().optional(),
    discardedFiles: z.number().optional(),
    discardedCommits: z.number().optional(),
    message: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

// ChangeSummary：未提交文件数 + 基线后的提交数，remove 前的安全度量。
type ChangeSummary = {
  changedFiles: number
  commits: number
}

/**
 * Returns null when state cannot be reliably determined — callers that use
 * this as a safety gate must treat null as "unknown, assume unsafe"
 * (fail-closed). A silent 0/0 would let cleanupWorktree destroy real work.
 *
 * Null is returned when:
 * - git status or rev-list exit non-zero (lock file, corrupt index, bad ref)
 * - originalHeadCommit is undefined but git status succeeded — this is the
 *   hook-based-worktree-wrapping-git case (worktree.ts:525-532 doesn't set
 *   originalHeadCommit). We can see the working tree is git, but cannot count
 *   commits without a baseline, so we cannot prove the branch is clean.
 */
// countWorktreeChanges 的 doc 注释把失败语义说死了：**返回 null = 状态不可判定，调用方必须按「未知即不安全」处理（fail-closed）**。静默返回 0/0 会让 cleanupWorktree 销毁真实工作——注释里列了两种 null 成因：git 命令非零退出（锁文件/索引损坏/坏 ref），以及 originalHeadCommit 缺失（hook 创建的 worktree 包着 git 的情况，看得见工作区却数不了提交）。
async function countWorktreeChanges(
  worktreePath: string,
  originalHeadCommit: string | undefined,
): Promise<ChangeSummary | null> {
// git status --porcelain 数改动文件：退出码非零直接 null，不猜。
  const status = await execFileNoThrow('git', [
    '-C',
    worktreePath,
    'status',
    '--porcelain',
  ])
  if (status.code !== 0) {
    return null
  }
  const changedFiles = count(status.stdout.split('\n'), l => l.trim() !== '')

// status 成功但没有基线提交：能确认是 git 仓库，却证明不了分支干净——宁可拒删也不谎报 0。
  if (!originalHeadCommit) {
    // git status succeeded → this is a git repo, but without a baseline
    // commit we cannot count commits. Fail-closed rather than claim 0.
    return null
  }

// git rev-list --count baseline..HEAD 数新提交，两个 git 调用都是 execFileNoThrow（不抛异常，退出码走返回值）。
  const revList = await execFileNoThrow('git', [
    '-C',
    worktreePath,
    'rev-list',
    '--count',
    `${originalHeadCommit}..HEAD`,
  ])
  if (revList.code !== 0) {
    return null
  }
  const commits = parseInt(revList.stdout.trim(), 10) || 0

  return { changedFiles, commits }
}

/**
 * Restore session state to reflect the original directory.
 * This is the inverse of the session-level mutations in EnterWorktreeTool.call().
 *
 * keepWorktree()/cleanupWorktree() handle process.chdir and currentWorktreeSession;
 * this handles everything above the worktree utility layer.
 */
// restoreSessionToOriginalCwd：EnterWorktreeTool.call() 会话级改动的**逆运算**。注释划清了边界——keepWorktree/cleanupWorktree 管进程 chdir 和当前 worktree 会话，这个函数管它们之上的一切（全局 cwd、originalCwd、projectRoot、hooks 快照、各种缓存）。
function restoreSessionToOriginalCwd(
  originalCwd: string,
  projectRootIsWorktree: boolean,
): void {
  setCwd(originalCwd)
// setCwd(originalCwd) 把工作目录换回去；下一行 setOriginalCwd(originalCwd) 同样指向真实原目录——EnterWorktree 那边故意存的是 worktree 路径，这里必须改回来，否则退出后「原始目录」概念一直错位。
  // EnterWorktree sets originalCwd to the *worktree* path (intentional — see
  // state.ts getProjectRoot comment). Reset to the real original.
  setOriginalCwd(originalCwd)
  // --worktree startup sets projectRoot to the worktree; mid-session
  // EnterWorktreeTool does not. Only restore when it was actually changed —
  // otherwise we'd move projectRoot to wherever the user had cd'd before
  // entering the worktree (session.originalCwd), breaking the "stable project
  // identity" contract.
// projectRoot 只在该过的时候才复原：--worktree 启动会把 projectRoot 设成 worktree，会话中途 EnterWorktree 不动它。不判断就直接 setProjectRoot(originalCwd)，会把 projectRoot 挪到用户进 worktree 前随便 cd 到的某个目录，破坏「稳定项目身份」契约。hooks 配置快照同理对称恢复——启动时从 worktree 重读过，退出时就该重读回来。
  if (projectRootIsWorktree) {
    setProjectRoot(originalCwd)
    // setup.ts's --worktree block called updateHooksConfigSnapshot() to re-read
    // hooks from the worktree. Restore symmetrically. (Mid-session
    // EnterWorktreeTool never touched the snapshot, so no-op there.)
    updateHooksConfigSnapshot()
  }
  saveWorktreeState(null)
  clearSystemPromptSections()
  clearMemoryFileCaches()
  getPlansDirectory.cache.clear?.()
}

// ExitWorktreeTool：退出并决定 worktree 去留。
export const ExitWorktreeTool: Tool<InputSchema, Output> = buildTool({
  name: EXIT_WORKTREE_TOOL_NAME,
  searchHint: 'exit a worktree session and return to the original directory',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Exits a worktree session created by EnterWorktree and restores the original working directory'
  },
  async prompt() {
    return getExitWorktreeToolPrompt()
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return 'Exiting worktree'
  },
  shouldDefer: true,
// isDestructive：action 为 remove 时为真——权限分类器据此提高审批档位，keep 则是无害操作。
  isDestructive(input) {
    return input.action === 'remove'
  },
  toAutoClassifierInput(input) {
    return input.action
  },
// validateInput：三道关卡全在这里，call() 只执行。
  async validateInput(input) {
    // Scope guard: getCurrentWorktreeSession() is null unless EnterWorktree
    // (specifically createWorktreeForSession) ran in THIS session. Worktrees
    // created by `git worktree add`, or by EnterWorktree in a previous
    // session, do not populate it. This is the sole entry gate — everything
    // past this point operates on a path EnterWorktree created.
// scope 闸：getCurrentWorktreeSession() 仅当 EnterWorktree（确切说 createWorktreeForSession）在**本会话**跑过才非空。用户手敲 git worktree add 建的、上个会话建的，都不 populated——这是唯一入口闸，过了它后面操作的所有路径都是 EnterWorktree 创建的。
    const session = getCurrentWorktreeSession()
    if (!session) {
      return {
        result: false,
        message:
          'No-op: there is no active EnterWorktree session to exit. This tool only operates on worktrees created by EnterWorktree in the current session — it will not touch worktrees created manually or in a previous session. No filesystem changes were made.',
        errorCode: 1,
      }
    }

// remove 且未显式 discard_changes：先数账再决定放不放行。
    if (input.action === 'remove' && !input.discard_changes) {
      const summary = await countWorktreeChanges(
        session.worktreePath,
        session.originalHeadCommit,
      )
// 数不出账（null）→ errorCode 3 拒绝删除，提示改用 discard_changes: true 强拆或改 keep。
      if (summary === null) {
        return {
          result: false,
          message: `Could not verify worktree state at ${session.worktreePath}. Refusing to remove without explicit confirmation. Re-invoke with discard_changes: true to proceed — or use action: "keep" to preserve the worktree.`,
          errorCode: 3,
        }
      }
      const { changedFiles, commits } = summary
// 有未提交文件或新提交 → errorCode 2 拒绝删除，消息里列明数量和分支名，要求先与用户确认再带 discard_changes: true 重调。删除不可逆，对话框必须让人看见代价。
      if (changedFiles > 0 || commits > 0) {
        const parts: string[] = []
        if (changedFiles > 0) {
          parts.push(
            `${changedFiles} uncommitted ${changedFiles === 1 ? 'file' : 'files'}`,
          )
        }
        if (commits > 0) {
          parts.push(
            `${commits} ${commits === 1 ? 'commit' : 'commits'} on ${session.worktreeBranch ?? 'the worktree branch'}`,
          )
        }
        return {
          result: false,
          message: `Worktree has ${parts.join(' and ')}. Removing will discard this work permanently. Confirm with the user, then re-invoke with discard_changes: true — or use action: "keep" to preserve the worktree.`,
          errorCode: 2,
        }
      }
    }

    return { result: true }
  },
  renderToolUseMessage,
  renderToolResultMessage,
// call() 执行段。
  async call(input) {
    const session = getCurrentWorktreeSession()
    if (!session) {
      // validateInput guards this, but the session is module-level mutable
      // state — defend against a race between validation and execution.
      throw new Error('Not in a worktree session')
    }

    // Capture before keepWorktree/cleanupWorktree null out currentWorktreeSession.
    const {
      originalCwd,
      worktreePath,
      worktreeBranch,
      tmuxSessionName,
      originalHeadCommit,
    } = session

    // --worktree startup calls setOriginalCwd(getCwd()) and
    // setProjectRoot(getCwd()) back-to-back right after setCwd(worktreePath)
    // (setup.ts:235/239), so both hold the same realpath'd value and BashTool
    // cd never touches either. Mid-session EnterWorktreeTool sets originalCwd
    // but NOT projectRoot. (Can't use getCwd() — BashTool mutates it on every
    // cd. Can't use session.worktreePath — it's join()'d, not realpath'd.)
// projectRootIsWorktree 判定：getProjectRoot() === getOriginalCwd() 说明启动时 --worktree 把两者设成了同一值（mid-session EnterWorktree 只设 originalCwd）。不能用 getCwd()——BashTool 每次 cd 都改它；也不能用 session.worktreePath——那是 join 出来的没做过 realpath。
    const projectRootIsWorktree = getProjectRoot() === getOriginalCwd()

    // Re-count at execution time for accurate analytics and output — the
    // worktree state at validateInput time may not match now. Null (git
    // failure) falls back to 0/0; safety gating already happened in
    // validateInput, so this only affects analytics + messaging.
// 执行时重新数账：validateInput 到 call() 之间隔着用户审批，worktree 状态可能变了。这里的数字只用于遥测和结果消息（安全闸门在 validateInput 已经过了），null 退化成 0/0 无安全隐患。
    const { changedFiles, commits } = (await countWorktreeChanges(
      worktreePath,
      originalHeadCommit,
    )) ?? { changedFiles: 0, commits: 0 }

// keep 分支：保留目录和分支，只做状态复原；tmux 会话不杀，把会话名回在消息里教用户 reattach。
    if (input.action === 'keep') {
      await keepWorktree()
      restoreSessionToOriginalCwd(originalCwd, projectRootIsWorktree)

      logEvent('tengu_worktree_kept', {
        mid_session: true,
        commits,
        changed_files: changedFiles,
      })

      const tmuxNote = tmuxSessionName
        ? ` Tmux session ${tmuxSessionName} is still running; reattach with: tmux attach -t ${tmuxSessionName}`
        : ''
      return {
        data: {
          action: 'keep' as const,
          originalCwd,
          worktreePath,
          worktreeBranch,
          tmuxSessionName,
          message: `Exited worktree. Your work is preserved at ${worktreePath}${worktreeBranch ? ` on branch ${worktreeBranch}` : ''}. Session is now back in ${originalCwd}.${tmuxNote}`,
        },
      }
    }

    // action === 'remove'
// remove 分支：先杀 tmux 会话（还挂着一个活 tmux 删目录会留下孤儿窗格），再 cleanupWorktree 删目录和分支。
    if (tmuxSessionName) {
      await killTmuxSession(tmuxSessionName)
    }
    await cleanupWorktree()
    restoreSessionToOriginalCwd(originalCwd, projectRootIsWorktree)

    logEvent('tengu_worktree_removed', {
      mid_session: true,
      commits,
      changed_files: changedFiles,
    })

    const discardParts: string[] = []
    if (commits > 0) {
      discardParts.push(`${commits} ${commits === 1 ? 'commit' : 'commits'}`)
    }
    if (changedFiles > 0) {
      discardParts.push(
        `${changedFiles} uncommitted ${changedFiles === 1 ? 'file' : 'files'}`,
      )
    }
    const discardNote =
      discardParts.length > 0 ? ` Discarded ${discardParts.join(' and ')}.` : ''
    return {
      data: {
        action: 'remove' as const,
        originalCwd,
        worktreePath,
        worktreeBranch,
        discardedFiles: changedFiles,
        discardedCommits: commits,
        message: `Exited and removed worktree at ${worktreePath}.${discardNote} Session is now back in ${originalCwd}.`,
      },
    }
  },
// tool_result 同样只带 message 字符串。
  mapToolResultToToolResultBlockParam({ message }, toolUseID) {
    return {
      type: 'tool_result',
      content: message,
      tool_use_id: toolUseID,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
