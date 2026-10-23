import { z } from 'zod/v4'
import { logEvent } from '../../services/analytics/index.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/metadata.js'
import type { Tool } from '../../Tool.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { isAgentSwarmsEnabled } from '../../utils/agentSwarmsEnabled.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { TEAM_LEAD_NAME } from '../../utils/swarm/constants.js'
import {
  cleanupTeamDirectories,
  readTeamFile,
  unregisterTeamForSessionCleanup,
} from '../../utils/swarm/teamHelpers.js'
import { clearTeammateColors } from '../../utils/swarm/teammateLayoutManager.js'
import { clearLeaderTeamName } from '../../utils/tasks.js'
import { TEAM_DELETE_TOOL_NAME } from './constants.js'
import { getPrompt } from './prompt.js'
import { renderToolResultMessage, renderToolUseMessage } from './UI.js'

// inputSchema 是**空的 strictObject**——TeamDelete 不接收任何参数，队名从会话的 teamContext 里取。空 schema 也是 schema：挡住模型瞎传参。
const inputSchema = lazySchema(() => z.strictObject({}))
type InputSchema = ReturnType<typeof inputSchema>

export type Output = {
  success: boolean
  message: string
  team_name?: string
}

export type Input = z.infer<InputSchema>

// TeamDeleteTool：解散团队并清扫目录，与 TeamCreateTool 成对。
export const TeamDeleteTool: Tool<InputSchema, Output> = buildTool({
  name: TEAM_DELETE_TOOL_NAME,
  searchHint: 'disband a swarm team and clean up',
  maxResultSizeChars: 100_000,
  shouldDefer: true,

  userFacingName() {
    return ''
  },

  get inputSchema(): InputSchema {
    return inputSchema()
  },

// isEnabled 同样挂在 swarm 特性开关上。
  isEnabled() {
    return isAgentSwarmsEnabled()
  },

  async description() {
    return 'Clean up team and task directories when the swarm is complete'
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
  async call(_input, context) {
    const { setAppState, getAppState } = context
    const appState = getAppState()
    const teamName = appState.teamContext?.teamName

// 队名来自 AppState.teamContext——不是参数。
    if (teamName) {
      // Read team config to check for active members
      const teamFile = readTeamFile(teamName)
      if (teamFile) {
        // Filter out the team lead - only count non-lead members
// 数活跃成员前先把队长滤掉：队长自己不算「在干活的队员」，否则永远删不掉队。
        const nonLeadMembers = teamFile.members.filter(
          m => m.name !== TEAM_LEAD_NAME,
        )

        // Separate truly active members from idle/dead ones
        // Members with isActive === false are idle (finished their turn or crashed)
        const activeMembers = nonLeadMembers.filter(m => m.isActive !== false)
// isActive !== false 的判法：undefined（从未标记）算活跃，只有显式 false（跑完回合或崩了）算闲。宁可按活跃挡着，也不错放一个还在跑的队员被清扫。

// 有活跃队员就**返回 success: false 而不抛错**——这是给模型读的结构化结果，附上队员名单并指路 requestShutdown 先 gracefully 关人。抛异常会让模型以为工具坏了；返回数据它才知道下一步该干什么。
        if (activeMembers.length > 0) {
          const memberNames = activeMembers.map(m => m.name).join(', ')
          return {
            data: {
              success: false,
              message: `Cannot cleanup team with ${activeMembers.length} active member(s): ${memberNames}. Use requestShutdown to gracefully terminate teammates first.`,
              team_name: teamName,
            },
          }
        }
      }

// cleanupTeamDirectories：删团队目录与任务目录（具体见 utils/swarm/teamHelpers）。
      await cleanupTeamDirectories(teamName)
      // Already cleaned — don't try again on gracefulShutdown.
      unregisterTeamForSessionCleanup(teamName)
// unregisterTeamForSessionCleanup：从会话清理清单里划掉——已经手动删过了，gracefulShutdown 时不要再删第二次（重复删会报 ENOENT 噪音）。

      // Clear color assignments so new teams start fresh
// 颜色分配表和队长队名一起清——新队从零开始，不继承上一队的颜色映射和任务目录指向。
      clearTeammateColors()

      // Clear leader team name so getTaskListId() falls back to session ID
      clearLeaderTeamName()

// tengu_team_deleted 遥测，team_name 同样过 AnalyticsMetadata 标记类型。
      logEvent('tengu_team_deleted', {
        team_name:
          teamName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    }

    // Clear team context and inbox from app state
// 无论有没有队都执行：清 teamContext + 清空 inbox 队列。没收尾的入站消息不清掉，会在下一个队的上下文里幽灵送达。
    setAppState(prev => ({
      ...prev,
      teamContext: undefined,
      inbox: {
        messages: [], // Clear any queued messages
      },
    }))

    return {
      data: {
        success: true,
// 返回消息分两种：真删了队 vs 本来就没有队——后者也是 success: true（幂等），文案明说「无可清理」。
        message: teamName
          ? `Cleaned up directories and worktrees for team "${teamName}"`
          : 'No team name found, nothing to clean up',
        team_name: teamName,
      },
    }
  },

  renderToolUseMessage,
  renderToolResultMessage,
} satisfies ToolDef<InputSchema, Output>)
