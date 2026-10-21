// ═══════════════════════════════════════════════════════════════
//  useSwarmBanner：输入框上方那条横幅，六种身份抢一个位置
// ═══════════════════════════════════════════════════════════════
//
//  这个 hook **不返回 JSX**，返回一个「视图模型」：
//
//      { text: string, bgColor: keyof Theme } | null
//
//  这比在 hook 里拼 JSX 好在哪：颜色是主题里的键名（字符串），
//  不是渲染后的 ANSI —— 调用方可以自由决定用背景色、前景色、还是只取文字。
//  PromptInput 里就是拿 `bgColor` 同时又当文字色又当背景色用的（第 2251-2258 行）。
//
//  六档优先级（注释第 36-42 行列了全表）：
//    1. teammate 进程本身          → @名字 + 自己的颜色
//    2. leader 且不在 tmux 内      → 「去 tmux 里看队友」的 attach 命令
//    3. leader 在 tmux 内 / 原生分屏 / 进程内 → 正在看的那个队友的 @名字
//    4. 正在看后台 agent           → 从注册表反查名字
//    5. 独立 agent（/rename、/color）→ 名字 + 自定义颜色
//    6. --agent 命令行参数         → agent 名 + 它的颜色
import * as React from 'react'
import { useAppState, useAppStateStore } from '../../state/AppState.js'
import {
  getActiveAgentForInput,
  getViewedTeammateTask,
} from '../../state/selectors.js'
import {
  AGENT_COLOR_TO_THEME_COLOR,
  AGENT_COLORS,
  type AgentColorName,
  getAgentColor,
} from '../../tools/AgentTool/agentColorManager.js'
import { getStandaloneAgentName } from '../../utils/standaloneAgent.js'
import { isInsideTmux } from '../../utils/swarm/backends/detection.js'
import {
  getCachedDetectionResult,
  isInProcessEnabled,
} from '../../utils/swarm/backends/registry.js'
import { getSwarmSocketName } from '../../utils/swarm/constants.js'
import {
  getAgentName,
  getTeammateColor,
  getTeamName,
  isTeammate,
} from '../../utils/teammate.js'
import { isInProcessTeammate } from '../../utils/teammateContext.js'
import type { Theme } from '../../utils/theme.js'

// 【返回值类型就写明了「要么有文字有颜色，要么什么都没有」】
//
//  `{ text: string; bgColor: keyof Theme } | null` —— 两个字段一起有、一起无。
//  没有「有文字但没颜色」的中间态，所以调用方只需要判 null，不需要判每个字段。
//
//  bgColor 的类型是 `keyof Theme` 而不是 string：主题键名是有限集合，
//  用 keyof 能让 TS 在编译期拦住拼错的颜色名。第 148 行 toThemeColor 就是
//  为了把「来自配置文件的任意字符串」安全地收窄成这个类型而存在的。
type SwarmBannerInfo = {
  text: string
  bgColor: keyof Theme
} | null

/**
 * Hook that returns banner information for swarm, standalone agent, or --agent CLI context.
 * - Leader (not in tmux): Returns "tmux -L ... attach" command with cyan background
 * - Leader (in tmux / in-process): Falls through to standalone-agent check — shows
 *   /rename name + /color background if set, else null
 * - Teammate: Returns "teammate@team" format with their assigned color background
 * - Viewing a background agent (CoordinatorTaskPanel): Returns agent name with its color
 * - Standalone agent: Returns agent name with their color background (no @team)
 * - --agent CLI flag: Returns "@agentName" with cyan background
 */
export function useSwarmBanner(): SwarmBannerInfo {
  const teamContext = useAppState(s => s.teamContext)
  const standaloneAgentContext = useAppState(s => s.standaloneAgentContext)
  const agent = useAppState(s => s.agent)
// 【这一行的返回值没人用，但它是必须的】
//
//      useAppState(s => s.viewingAgentTaskId)
//
//  没有 `const x =` —— 纯粹为了**订阅**。因为下面第 108 行调用的
//  getActiveAgentForInput(state) 是从 store.getState() 里读的，绕过 React；
//  如果本组件不订阅任何相关字段，进入/退出队友视图时它就不会重渲染，
//  横幅会停留在旧内容上。
//
//  这是「命令式读取 + 声明式订阅」混用时的标准补救手法，注释里也写明了原因。
//  读代码时看到「hook 调用结果被丢弃」，先别当成笔误 —— 它多半是订阅用的。
  // Subscribe so the banner updates on enter/exit teammate view even though
  // getActiveAgentForInput reads it from store.getState().
  useAppState(s => s.viewingAgentTaskId)
  const store = useAppStateStore()
  const [insideTmux, setInsideTmux] = React.useState<boolean | null>(null)

// 【isInsideTmux 是异步的，所以初始值是 null 而不是 false】
//
//  三态：true / false / null（还在探测）。三态的意义在第 86 行体现：
//
//      if (insideTmux === false && ...)   ← 只有明确「不在 tmux 里」才显示 attach 提示
//
//  如果初始值写 false，那么开机后的头几毫秒会闪一下「去 tmux attach」，
//  然后在探测完成后消失。用一个 null 把「不知道」和「不在」分开，
//  就消灭了这个闪烁。第 101 行还专门写了注释：null 就往下走（fall through）。
//
//  可推广：**异步探测出来的布尔值，初始态应该是 unknown 而不是 false**。
  React.useEffect(() => {
    void isInsideTmux().then(setInsideTmux)
  }, [])

  const state = store.getState()

  // Teammate process: show @agentName with assigned color.
  // In-process teammates run headless — their banner shows in the leader UI instead.
// 【进程内 teammate 被排除，因为它是无头的】
//
//  `isTeammate() && !isInProcessTeammate()`：前者判断「我是不是个队友」，
//  后者判断「我是不是跑在 leader 进程里的那种队友」。
//
//  进程内队友没有自己的界面（headless），它的横幅由 leader 的 UI 来显示
//  （就是下面第 92-99 行那一档）。所以这里必须排除，否则两边都会显示，
//  而且进程内那边显示了也没人看得见。
//
//  第 68 行 `teamContext?.selfAgentColor ?? getTeammateColor()` 是两级回落：
//  先用运行时状态里的颜色，没有就查环境变量 —— 因为 teammate 身份可能来自
//  文件配置（见 PromptInput 里对 identity.color 的校验注释）。
  if (isTeammate() && !isInProcessTeammate()) {
    const agentName = getAgentName()
    if (agentName && getTeamName()) {
      return {
        text: `@${agentName}`,
        bgColor: toThemeColor(
          teamContext?.selfAgentColor ?? getTeammateColor(),
        ),
      }
    }
  }

  // Leader with spawned teammates: tmux-attach hint when external, else show
  // the viewed teammate's name when inside tmux / native panes / in-process.
// 【三种「怎么看到队友」的方式，决定了三种提示语】
//
//  hasTeammates 这个三段判断（teamName + teammates 都存在 + 至少一个成员）
//  不是防御性写法，而是三个真实的空态：没建队、队建了但成员表还没同步、队里只有队长。
//
//  然后第 86 / 92 行把运行环境分成两类：
//    · 不在 tmux 且没开进程内模式且没有原生分屏 → 用户看不到队友 → 教他怎么 attach
//    · 在 tmux / 进程内 / 原生分屏            → 用户能切过去 → 只显示当前在看的名字
//
//  注意第 88 行的提示语里带了反引号包住的完整命令：`tmux -L <socket> a`
//  —— socket 名是运行时算的（getSwarmSocketName），不是写死的 tmux 默认 socket，
//  否则用户 attach 到别的会话上会一脸茫然。
  const hasTeammates =
    teamContext?.teamName &&
    teamContext.teammates &&
    Object.keys(teamContext.teammates).length > 0
  if (hasTeammates) {
    const viewedTeammate = getViewedTeammateTask(state)
    const viewedColor = toThemeColor(viewedTeammate?.identity.color)
    const inProcessMode = isInProcessEnabled()
    const nativePanes = getCachedDetectionResult()?.isNative ?? false

    if (insideTmux === false && !inProcessMode && !nativePanes) {
      return {
        text: `View teammates: \`tmux -L ${getSwarmSocketName()} a\``,
        bgColor: viewedColor,
      }
    }
    if (
      (insideTmux === true || inProcessMode || nativePanes) &&
      viewedTeammate
    ) {
      return {
        text: `@${viewedTeammate.identity.agentName}`,
        bgColor: viewedColor,
      }
    }
    // insideTmux === null: still loading — fall through.
    // Not viewing a teammate: fall through so /rename and /color are honored.
  }

  // Viewing a background agent (CoordinatorTaskPanel): local_agent tasks aren't
  // InProcessTeammates, so getViewedTeammateTask misses them. Reverse-lookup the
  // name from agentNameRegistry the same way CoordinatorAgentStatus does.
// 【反查循环：因为注册表是「名字 → id」，而这里手上只有 id】
//
//  第 112-117 行遍历 state.agentNameRegistry 找 id 相等的那一项。
//  O(n) 但 n 是「本次会话出现过的 agent 数」，量级是个位数到几十，
//  换成反向 Map 的收益抵不上多维护一份索引的成本。
//
//  这一档存在的理由写在注释里：local_agent 任务不是 InProcessTeammate，
//  所以上面的 getViewedTeammateTask 找不到它们 —— 两条不同的任务类型，
//  两套不同的查找路径。找不到名字时回落到 task.description
//  （第 119 行），保证横幅永远不会是空的。
  const active = getActiveAgentForInput(state)
  if (active.type === 'named_agent') {
    const task = active.task
    let name: string | undefined
    for (const [n, id] of state.agentNameRegistry) {
      if (id === task.id) {
        name = n
        break
      }
    }
    return {
      text: name ? `@${name}` : task.description,
      bgColor: getAgentColor(task.agentType) ?? 'cyan_FOR_SUBAGENTS_ONLY',
    }
  }

  // Standalone agent (/rename, /color): name and/or custom color, no @team.
  const standaloneName = getStandaloneAgentName(state)
  const standaloneColor = standaloneAgentContext?.color
  if (standaloneName || standaloneColor) {
    return {
      text: standaloneName ?? '',
      bgColor: toThemeColor(standaloneColor),
    }
  }

  // --agent CLI flag (when not handled above).
  if (agent) {
    const agentDef = state.agentDefinitions.activeAgents.find(
      a => a.agentType === agent,
    )
    return {
      text: agent,
      bgColor: toThemeColor(agentDef?.color, 'promptBorder'),
    }
  }

  return null
}

// 【把「配置里的字符串」收窄成「主题键名」的唯一入口】
//
//  colorName 的来源可能是 teamContext、环境变量、agent 定义文件 —— 全是外部输入。
//  直接 `AGENT_COLOR_TO_THEME_COLOR[colorName]` 在 TS 里过不了类型检查，
//  用 as 强转则会在运行期拿到 undefined，然后 Ink 会把 undefined 当默认色，
//  表现为「颜色莫名其妙丢了」。
//
//  所以这里做一次 includes 校验，不认识就回落到 fallback。
//  fallback 的默认值是 `'cyan_FOR_SUBAGENTS_ONLY'` —— 名字里那串大写后缀是
//  内部约定，表示「这个颜色只给子 agent 用」，看着奇怪但含义明确。
//
//  同一个模式在本目录出现三次（这里、PromptInputModeIndicator、PromptInput），
//  说明「外来颜色必须校验」是这个子系统的固定纪律。
function toThemeColor(
  colorName: string | undefined,
  fallback: keyof Theme = 'cyan_FOR_SUBAGENTS_ONLY',
): keyof Theme {
  return colorName && AGENT_COLORS.includes(colorName as AgentColorName)
    ? AGENT_COLOR_TO_THEME_COLOR[colorName as AgentColorName]
    : fallback
}
