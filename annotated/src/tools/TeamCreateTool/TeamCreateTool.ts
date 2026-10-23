import { z } from 'zod/v4'
import { getSessionId } from '../../bootstrap/state.js'
import { logEvent } from '../../services/analytics/index.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/metadata.js'
import type { Tool } from '../../Tool.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { formatAgentId } from '../../utils/agentId.js'
import { isAgentSwarmsEnabled } from '../../utils/agentSwarmsEnabled.js'
import { getCwd } from '../../utils/cwd.js'
import { lazySchema } from '../../utils/lazySchema.js'
import {
  getDefaultMainLoopModel,
  parseUserSpecifiedModel,
} from '../../utils/model/model.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { getResolvedTeammateMode } from '../../utils/swarm/backends/registry.js'
import { TEAM_LEAD_NAME } from '../../utils/swarm/constants.js'
import type { TeamFile } from '../../utils/swarm/teamHelpers.js'
import {
  getTeamFilePath,
  readTeamFile,
  registerTeamForSessionCleanup,
  sanitizeName,
  writeTeamFileAsync,
} from '../../utils/swarm/teamHelpers.js'
import { assignTeammateColor } from '../../utils/swarm/teammateLayoutManager.js'
import {
  ensureTasksDir,
  resetTaskList,
  setLeaderTeamName,
} from '../../utils/tasks.js'
import { generateWordSlug } from '../../utils/words.js'
import { TEAM_CREATE_TOOL_NAME } from './constants.js'
import { getPrompt } from './prompt.js'
import { renderToolUseMessage } from './UI.js'

// inputSchema：team_name 必填，description 与 agent_type 可选。
const inputSchema = lazySchema(() =>
  z.strictObject({
    team_name: z.string().describe('Name for the new team to create.'),
    description: z.string().optional().describe('Team description/purpose.'),
    agent_type: z
      .string()
      .optional()
      .describe(
        'Type/role of the team lead (e.g., "researcher", "test-runner"). ' +
          'Used for team file and inter-agent coordination.',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

export type Output = {
  team_name: string
  team_file_path: string
  lead_agent_id: string
}

export type Input = z.infer<InputSchema>

/**
 * Generates a unique team name by checking if the provided name already exists.
 * If the name already exists, generates a new word slug.
 */
// generateUniqueTeamName 的重名策略：**撞名不报错，静默换随机词 slug**。团队名是给人看的标签不是主键（主键是 leadAgentId），为一个显示名让整次调用失败不值得。
function generateUniqueTeamName(providedName: string): string {
  // If the team doesn't exist, use the provided name
  if (!readTeamFile(providedName)) {
    return providedName
  }

  // Team exists, generate a new unique name
  return generateWordSlug()
}

// TeamCreateTool：建队入口。isEnabled 挂在 isAgentSwarmsEnabled 上——没开 swarm 特性的构建里这个工具整个不存在，而不是运行时报错。
export const TeamCreateTool: Tool<InputSchema, Output> = buildTool({
  name: TEAM_CREATE_TOOL_NAME,
  searchHint: 'create a multi-agent swarm team',
  maxResultSizeChars: 100_000,
  shouldDefer: true,

  userFacingName() {
    return ''
  },

  get inputSchema(): InputSchema {
    return inputSchema()
  },

// isEnabled 按特性开关整体显隐。
  isEnabled() {
    return isAgentSwarmsEnabled()
  },

  toAutoClassifierInput(input) {
    return input.team_name
  },

// validateInput：team_name 空串/纯空白拒掉，errorCode 9。schema 层已经保证是字符串，这里补的是「trim 后不能为空」的语义校验。
  async validateInput(input, _context) {
    if (!input.team_name || input.team_name.trim().length === 0) {
      return {
        result: false,
        message: 'team_name is required for TeamCreate',
        errorCode: 9,
      }
    }
    return { result: true }
  },

  async description() {
    return 'Create a new team for coordinating multiple agents'
  },

  async prompt() {
    return getPrompt()
  },

  mapToolResultToToolResultBlockParam(data, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result' as const,
      content: [
        {
          type: 'text' as const,
          text: jsonStringify(data),
        },
      ],
    }
  },

// call() 主流程。
  async call(input, context) {
    const { setAppState, getAppState } = context
    const { team_name, description: _description, agent_type } = input

    // Check if already in a team - restrict to one team per leader
// 一个队长同时只能带一个队——已在队中就抛错并指路 TeamDelete。多队并行会让 inbox 路由和任务目录归属全部歧义。
    const appState = getAppState()
    const existingTeam = appState.teamContext?.teamName

    if (existingTeam) {
      throw new Error(
        `Already leading team "${existingTeam}". A leader can only manage one team at a time. Use TeamDelete to end the current team before creating a new one.`,
      )
    }

// 重名走 generateUniqueTeamName 换名，不失败（见上）。
    // If team already exists, generate a unique name instead of failing
    const finalTeamName = generateUniqueTeamName(team_name)

    // Generate a deterministic agent ID for the team lead
// leadAgentId 是**确定性**的：formatAgentId(TEAM_LEAD_NAME, finalTeamName)——同一个队名永远推出同一个队长 ID，队员凭队名就能推出队长地址，不需要额外查表。
    const leadAgentId = formatAgentId(TEAM_LEAD_NAME, finalTeamName)
    const leadAgentType = agent_type || TEAM_LEAD_NAME
    // Get the team lead's current model from AppState (handles session model, settings, CLI override)
// 队长模型三级取值：会话内指定 > 全局 mainLoopModel > 默认值。parseUserSpecifiedModel 兼容用户在界面上选的各种形态。
    const leadModel = parseUserSpecifiedModel(
      appState.mainLoopModelForSession ??
        appState.mainLoopModel ??
        getDefaultMainLoopModel(),
    )

// TeamFile 落盘内容：队长本人作为唯一初始成员入 members 数组（带 agentType、模型、cwd、空订阅列表）。
    const teamFilePath = getTeamFilePath(finalTeamName)

    const teamFile: TeamFile = {
      name: finalTeamName,
      description: _description,
      createdAt: Date.now(),
      leadAgentId,
      leadSessionId: getSessionId(), // Store actual session ID for team discovery
// leadSessionId 存真实会话 ID——队友发现队长的寻址通道，光有 agentId 不够。
      members: [
        {
          agentId: leadAgentId,
          name: TEAM_LEAD_NAME,
          agentType: leadAgentType,
          model: leadModel,
          joinedAt: Date.now(),
          tmuxPaneId: '',
          cwd: getCwd(),
          subscriptions: [],
        },
      ],
    }

    await writeTeamFileAsync(finalTeamName, teamFile)
    // Track for session-end cleanup — teams were left on disk forever
    // unless explicitly TeamDelete'd (gh-32730).
    registerTeamForSessionCleanup(finalTeamName)
// registerTeamForSessionCleanup：把队名登记进会话级清理清单。注释引了 gh-32730——**没有这个登记时，忘了 TeamDelete 的队会把目录永久留在磁盘上**，是真实 Issue 驱动的补丁。

    // Reset and create the corresponding task list directory (Team = Project = TaskList)
    // This ensures task numbering starts fresh at 1 for each new swarm
// Team = Project = TaskList：建队的同时建任务目录并**把编号重置为 1**——每个新 swarm 的任务从 1 开始数，不会继承上个队的任务历史。
    const taskListId = sanitizeName(finalTeamName)
    await resetTaskList(taskListId)
    await ensureTasksDir(taskListId)

    // Register the team name so getTaskListId() returns it for the leader.
    // Without this, the leader falls through to getSessionId() and writes tasks
    // to a different directory than tmux/iTerm2 teammates expect.
    setLeaderTeamName(sanitizeName(finalTeamName))
// setLeaderTeamName 是关键一跳：不设它，队长的 getTaskListId() 会退化成 getSessionId()，于是队长写的任务落在会话目录里，而 tmux/iTerm2 里的队友按队名找任务目录——两边看的不是同一个列表，协作静默失效。

    // Update AppState with team context
// setAppState 把 teamContext 写进全局状态：队名、文件路径、队长 ID、队长自己的颜色与 cwd 快照。
    setAppState(prev => ({
      ...prev,
      teamContext: {
        teamName: finalTeamName,
        teamFilePath,
        leadAgentId,
        teammates: {
          [leadAgentId]: {
            name: TEAM_LEAD_NAME,
            agentType: leadAgentType,
            color: assignTeammateColor(leadAgentId),
// assignTeammateColor 按 agentId 分配终端布局颜色——颜色是身份识别的一部分，IRC 式 @name 之外的第二线索。
            tmuxSessionName: '',
            tmuxPaneId: '',
            cwd: getCwd(),
            spawnedAt: Date.now(),
          },
        },
      },
    }))

// tengu_team_created 遥测带 teammate_count: 1（此刻只有队长）与 teammate_mode。注意三个字段都强转 AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS——这是分析管线的标记类型，向编译器证明「这些值是数据不是代码/路径」，防注入类误报。
    logEvent('tengu_team_created', {
      team_name:
        finalTeamName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      teammate_count: 1,
      lead_agent_type:
        leadAgentType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      teammate_mode:
        getResolvedTeammateMode() as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })

    // Note: We intentionally don't set CLAUDE_CODE_AGENT_ID for the team lead because:
    // 1. The lead is not a "teammate" - isTeammate() should return false for them
    // 2. Their ID is deterministic (team-lead@teamName) and can be derived when needed
    // 3. Setting it would cause isTeammate() to return true, breaking inbox polling
    // Team name is stored in AppState.teamContext, not process.env
// 这段注释解释一个**故意的不设置**：不给队长设 CLAUDE_CODE_AGENT_ID 环境变量。因为 isTeammate() 就是靠它判断的，一旦设上队长会被当成队员，inbox 轮询逻辑跟着错乱。队长身份放 AppState.teamContext，不进进程环境。

// 返回三件套：队名、团队文件路径、队长 agentId——模型拿这三个值就能去 Agent 工具里 spawn 队员。
    return {
      data: {
        team_name: finalTeamName,
        team_file_path: teamFilePath,
        lead_agent_id: leadAgentId,
      },
    }
  },

  renderToolUseMessage,
} satisfies ToolDef<InputSchema, Output>)
