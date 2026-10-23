import { z } from 'zod/v4'
import { getSessionId, setOriginalCwd } from '../../bootstrap/state.js'
import { clearSystemPromptSections } from '../../constants/systemPromptSections.js'
import { logEvent } from '../../services/analytics/index.js'
import type { Tool } from '../../Tool.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { clearMemoryFileCaches } from '../../utils/claudemd.js'
import { getCwd } from '../../utils/cwd.js'
import { findCanonicalGitRoot } from '../../utils/git.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { getPlanSlug, getPlansDirectory } from '../../utils/plans.js'
import { setCwd } from '../../utils/Shell.js'
import { saveWorktreeState } from '../../utils/sessionStorage.js'
import {
  createWorktreeForSession,
  getCurrentWorktreeSession,
  validateWorktreeSlug,
} from '../../utils/worktree.js'
import { ENTER_WORKTREE_TOOL_NAME } from './constants.js'
import { getEnterWorktreeToolPrompt } from './prompt.js'
import { renderToolResultMessage, renderToolUseMessage } from './UI.js'
// UI 渲染函数从同目录 UI.tsx 导入——工具实现与终端展示分离，主文件只留数据流。

// inputSchema 用 lazySchema 包住（懒加载，避免启动时为所有工具付 schema 构建成本）；name 字段的校验不在 schema 层写字面正则，而是 superRefine 里调 validateWorktreeSlug 抛错转 issue——校验规则单点定义，schema 与运行时报错文案永远一致。
const inputSchema = lazySchema(() =>
  z.strictObject({
    name: z
      .string()
      .superRefine((s, ctx) => {
        try {
          validateWorktreeSlug(s)
        } catch (e) {
          ctx.addIssue({ code: 'custom', message: (e as Error).message })
        }
      })
      .optional()
      .describe(
        'Optional name for the worktree. Each "/"-separated segment may contain only letters, digits, dots, underscores, and dashes; max 64 chars total. A random name is generated if not provided.',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    worktreePath: z.string(),
    worktreeBranch: z.string().optional(),
    message: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

// EnterWorktreeTool：会话中途创建 git worktree 并整体切进去。与 BashTool 的 cd 不同，这是进程级 chdir + 全局 cwd 状态一起换。
export const EnterWorktreeTool: Tool<InputSchema, Output> = buildTool({
  name: ENTER_WORKTREE_TOOL_NAME,
  searchHint: 'create an isolated git worktree and switch into it',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Creates an isolated worktree (via git or configured hooks) and switches the session into it'
  },
  async prompt() {
    return getEnterWorktreeToolPrompt()
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return 'Creating worktree'
  },
// shouldDefer: true —— 不进默认工具集，按需延迟加载（见 ToolSearchTool 的六级判定链）。
  shouldDefer: true,
  toAutoClassifierInput(input) {
    return input.name ?? ''
  },
  renderToolUseMessage,
  renderToolResultMessage,
// call() 主流程。
  async call(input) {
    // Validate not already in a worktree created by this session
// 第一道闸：本会话已经建过 worktree 就拒绝——一个会话同时只在一个 worktree 里，嵌套 worktree 的退出路径会变成迷宫。
    if (getCurrentWorktreeSession()) {
      throw new Error('Already in a worktree session')
    }

    // Resolve to main repo root so worktree creation works from within a worktree
// findCanonicalGitRoot 把当前目录解析回主仓库根：如果用户已经在某个 worktree 里，git worktree add 必须在主仓库执行，否则会建出「worktree 的 worktree」。解析成功且与当前不同就 chdir 过去。
    const mainRepoRoot = findCanonicalGitRoot(getCwd())
    if (mainRepoRoot && mainRepoRoot !== getCwd()) {
      process.chdir(mainRepoRoot)
      setCwd(mainRepoRoot)
    }

    const slug = input.name ?? getPlanSlug()
// slug 三选一：用户给的 name、否则 getPlanSlug()（复用计划文件名）。命名规则在 schema 描述里写明：每段只允许字母数字点下划线连字符、总长 64。

    const worktreeSession = await createWorktreeForSession(getSessionId(), slug)

    process.chdir(worktreeSession.worktreePath)
    setCwd(worktreeSession.worktreePath)
    setOriginalCwd(getCwd())
    saveWorktreeState(worktreeSession)
// setOriginalCwd(getCwd()) 这里存的是 **worktree 路径**而不是进 worktree 前的目录——这是有意的（state.ts getProjectRoot 注释），退出时的语义是「回到创建 worktree 时所在的地方」，与 --worktree 启动路径保持同构。
    // Clear cached system prompt sections so env_info_simple recomputes with worktree context
    clearSystemPromptSections()
    // Clear memoized caches that depend on CWD
    clearMemoryFileCaches()
    getPlansDirectory.cache.clear?.()
// 三连清缓存：系统提示词段落、CLAUDE.md 记忆文件、plans 目录 memo——全部依赖 cwd，换了目录不清就会读到旧仓库的内容。

// tengu_worktree_created 遥测带 mid_session: true，与启动时 --worktree 建的是同事件不同来源，看板能分开统计。
    logEvent('tengu_worktree_created', {
      mid_session: true,
    })

    const branchInfo = worktreeSession.worktreeBranch
      ? ` on branch ${worktreeSession.worktreeBranch}`
      : ''

// 返回数据里的 message 同时说给模型和人听：告知 ExitWorktree 可中途离开、会话退出时也会被提示 keep/remove——两条退出路径都交代清楚，模型不会以为卡在里面。
    return {
      data: {
        worktreePath: worktreeSession.worktreePath,
        worktreeBranch: worktreeSession.worktreeBranch,
        message: `Created worktree at ${worktreeSession.worktreePath}${branchInfo}. The session is now working in the worktree. Use ExitWorktree to leave mid-session, or exit the session to be prompted.`,
      },
    }
  },
// mapToolResultToToolResultBlockParam 只把 message 字符串放进 tool_result——路径和分支名已经写在 message 里，再序列化一遍 data 是浪费 context。
  mapToolResultToToolResultBlockParam({ message }, toolUseID) {
    return {
      type: 'tool_result',
      content: message,
      tool_use_id: toolUseID,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
