// ══════════════════════════════════════════════════════════════════════════
//  src/tools.ts —— 工具户口本（原文 389 行）
//
//  如果说 Tool.ts 定义了"一个工具长什么样"，那这个文件回答的是
//  "**这一版到底有哪几个工具**"。它是整个项目里唯一一份"全部工具"的清单。
//
//  文件结构：
//    ① 58 行 import + 条件 require（1-156）—— 一半的工具是"按开关决定存不存在"
//    ② 预设与解析（158-183）              —— --tools 参数用
//    ③ getAllBaseTools()（193-251）        —— ★ 唯一真相来源，45 个工具
//    ④ 四个过滤/组装函数（262-389）        —— 名字很像，职责必须分清
//
//  ── 先分清四个函数，这是最容易混的地方 ──
//
//    getAllBaseTools()            全量清单，含所有开关分支。**不做任何过滤**。
//    getTools(ctx)                全量 - 特殊工具 - deny 规则 - isEnabled()
//    filterToolsByDenyRules(...)  只做 deny 规则过滤（给 MCP 工具也用）
//    assembleToolPool(ctx, mcp)   内置 + MCP 合并、去重、排序 ← **实际在用的那个**
//    getMergedTools(ctx, mcp)     内置 + MCP 简单拼接 ← **外部调用点数：0（死代码）**
//
//  最后一个是真的没人用。`assembleToolPool` 的注释自称
//  "this is the single source of truth for combining built-in tools with MCP tools"，
//  它确实取代了 getMergedTools，但旧函数没删 —— 读代码时别被它误导。
//
//  ── 另一个必须知道的事实 ──
//
//  这里有**两套**"条件加载"机制，语义完全不同：
//
//    feature('XXX')                  → **构建期**开关。Bun 打包时若关闭，整段代码
//                                      被死代码消除删掉，运行时**根本不存在**。
//    process.env.USER_TYPE === 'ant' → **运行期**开关。代码进了包，靠 env 判断。
//
//  这意味着：你在源码里看到的 `feature('KAIROS')` 分支，在发给普通用户的
//  cli.js 里可能一个字节都没有。而 `USER_TYPE === 'ant'` 的分支是在的，
//  只是对非 Anthropic 员工恒为 false。
// ══════════════════════════════════════════════════════════════════════════

// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
// 译：本文件禁止"按字母序整理 import" —— ANT-ONLY 的 import 标记不能重排。
// 注：**这条 lint 屏蔽不是偷懒，是有硬原因的**。
//     下面那些 `const XxxTool = feature('Y') ? require(...) : null` 必须夹在
//     import 之间，因为它们参与 Bun 的**死代码消除**分析。
//     如果格式化工具把 import 全部提到顶部、把 require 挪到后面，
//     打包时的消除结果就会变 —— 可能把不该删的删了，或者把 ant-only 工具打进公开版。
//     所以这里宁可关掉规则。这也解释了为什么这个文件看起来"import 东一块西一块"。
import { toolMatchesName, type Tool, type Tools } from './Tool.js'
import { AgentTool } from './tools/AgentTool/AgentTool.js'
import { SkillTool } from './tools/SkillTool/SkillTool.js'
import { BashTool } from './tools/BashTool/BashTool.js'
// 注：上一批刚批注完的那个 1143 行的文件，在这里被登记进清单（第 197 行）。
import { FileEditTool } from './tools/FileEditTool/FileEditTool.js'
import { FileReadTool } from './tools/FileReadTool/FileReadTool.js'
import { FileWriteTool } from './tools/FileWriteTool/FileWriteTool.js'
import { GlobTool } from './tools/GlobTool/GlobTool.js'
import { NotebookEditTool } from './tools/NotebookEditTool/NotebookEditTool.js'
import { WebFetchTool } from './tools/WebFetchTool/WebFetchTool.js'
import { TaskStopTool } from './tools/TaskStopTool/TaskStopTool.js'
import { BriefTool } from './tools/BriefTool/BriefTool.js'
// Dead code elimination: conditional import for ant-only tools
// 译：死代码消除 —— ant 专属工具的条件导入。
/* eslint-disable custom-rules/no-process-env-top-level, @typescript-eslint/no-require-imports */
// 注：一次性关掉两条规则，覆盖下面这一整段。配对的是第 53 行的 eslint-enable。
//     `no-require-imports` 是因为这里故意用 CommonJS 的 require ——
//     要的就是"条件成立才加载"这个运行时行为，ESM 的 import 做不到。
const REPLTool =
  process.env.USER_TYPE === 'ant'
    ? require('./tools/REPLTool/REPLTool.js').REPLTool
    : null
// 注：**三元 + require 的组合是有讲究的**：
//     `if (cond) { const x = require(...) }` 无法在顶层声明变量，
//     而 `cond && require(...)` 会让变量声明变成布尔类型。
//     三元是唯一能"左边声明、右边条件加载"的写法。
const SuggestBackgroundPRTool =
  process.env.USER_TYPE === 'ant'
    ? require('./tools/SuggestBackgroundPRTool/SuggestBackgroundPRTool.js')
        .SuggestBackgroundPRTool
    : null
const SleepTool =
  feature('PROACTIVE') || feature('KAIROS')
    ? require('./tools/SleepTool/SleepTool.js').SleepTool
    : null
// 注：`feature('A') || feature('B')` —— **两个构建开关任一开启**就带这个工具。
//     注意这不是运行时判断：Bun 会在打包时把这两个 feature 调用替换成常量
//     true/false，然后对整个三元表达式做常量折叠。若都为 false，
//     连 require 那一段都被删掉（所以那个工具模块根本不进包）。
const cronTools = feature('AGENT_TRIGGERS')
  ? [
      require('./tools/ScheduleCronTool/CronCreateTool.js').CronCreateTool,
      require('./tools/ScheduleCronTool/CronDeleteTool.js').CronDeleteTool,
      require('./tools/ScheduleCronTool/CronListTool.js').CronListTool,
    ]
  : []
// 注：这次是"要么一个数组、要么空数组"，而不是 null。因为定时任务永远是**一组三个**
//     （增/删/查），不存在"只有其中一个"的情况。后面用 `...cronTools` 展开（235 行），
//     空数组展开就是什么都没加 —— 比 `...(x ? [x] : [])` 更干净。
const RemoteTriggerTool = feature('AGENT_TRIGGERS_REMOTE')
  ? require('./tools/RemoteTriggerTool/RemoteTriggerTool.js').RemoteTriggerTool
  : null
const MonitorTool = feature('MONITOR_TOOL')
  ? require('./tools/MonitorTool/MonitorTool.js').MonitorTool
  : null
// 注：Monitor 就是 BashTool 里那个 `sleep N` 报错话术推荐的替代品
//     （"For streaming events, use the Monitor tool"）。
const SendUserFileTool = feature('KAIROS')
  ? require('./tools/SendUserFileTool/SendUserFileTool.js').SendUserFileTool
  : null
const PushNotificationTool =
  feature('KAIROS') || feature('KAIROS_PUSH_NOTIFICATION')
    ? require('./tools/PushNotificationTool/PushNotificationTool.js')
        .PushNotificationTool
    : null
const SubscribePRTool = feature('KAIROS_GITHUB_WEBHOOKS')
  ? require('./tools/SubscribePRTool/SubscribePRTool.js').SubscribePRTool
  : null
/* eslint-enable custom-rules/no-process-env-top-level, @typescript-eslint/no-require-imports */
import { TaskOutputTool } from './tools/TaskOutputTool/TaskOutputTool.js'
import { WebSearchTool } from './tools/WebSearchTool/WebSearchTool.js'
import { TodoWriteTool } from './tools/TodoWriteTool/TodoWriteTool.js'
import { ExitPlanModeV2Tool } from './tools/ExitPlanModeTool/ExitPlanModeV2Tool.js'
import { TestingPermissionTool } from './tools/testing/TestingPermissionTool.js'
import { GrepTool } from './tools/GrepTool/GrepTool.js'
import { TungstenTool } from './tools/TungstenTool/TungstenTool.js'
// Lazy require to break circular dependency: tools.ts -> TeamCreateTool/TeamDeleteTool -> ... -> tools.ts
// 译：延迟 require 以打破循环依赖：tools.ts → TeamCreateTool/TeamDeleteTool → … → tools.ts
// 注：**这是"用函数包装 require"的经典解法**。
//     如果这里直接 `import { TeamCreateTool } from ...`，模块加载顺序会变成
//     tools.ts 加载中 → 去加载 TeamCreateTool → 它又要 import tools.ts（还没加载完）
//     → 拿到半个模块 → undefined。改成"用的时候才 require"就绕开了。
//     注意这些不是 `feature()` 的条件加载，是纯粹的循环依赖问题 —— 两种动机，同一种写法。
/* eslint-disable @typescript-eslint/no-require-imports */
const getTeamCreateTool = () =>
  require('./tools/TeamCreateTool/TeamCreateTool.js')
    .TeamCreateTool as typeof import('./tools/TeamCreateTool/TeamCreateTool.js').TeamCreateTool
// 注：`as typeof import(...)` 这个类型断言是**为了拿回类型信息**。
//     require 返回 any，直接返回就丢类型了。`typeof import(...)` 能在不实际加载模块的
//     前提下引用它的类型 —— TypeScript 的 import type 机制。
const getTeamDeleteTool = () =>
  require('./tools/TeamDeleteTool/TeamDeleteTool.js')
    .TeamDeleteTool as typeof import('./tools/TeamDeleteTool/TeamDeleteTool.js').TeamDeleteTool
const getSendMessageTool = () =>
  require('./tools/SendMessageTool/SendMessageTool.js')
    .SendMessageTool as typeof import('./tools/SendMessageTool/SendMessageTool.js').SendMessageTool
/* eslint-enable @typescript-eslint/no-require-imports */
import { AskUserQuestionTool } from './tools/AskUserQuestionTool/AskUserQuestionTool.js'
import { LSPTool } from './tools/LSPTool/LSPTool.js'
import { ListMcpResourcesTool } from './tools/ListMcpResourcesTool/ListMcpResourcesTool.js'
import { ReadMcpResourceTool } from './tools/ReadMcpResourceTool/ReadMcpResourceTool.js'
import { ToolSearchTool } from './tools/ToolSearchTool/ToolSearchTool.js'
import { EnterPlanModeTool } from './tools/EnterPlanModeTool/EnterPlanModeTool.js'
import { EnterWorktreeTool } from './tools/EnterWorktreeTool/EnterWorktreeTool.js'
import { ExitWorktreeTool } from './tools/ExitWorktreeTool/ExitWorktreeTool.js'
import { ConfigTool } from './tools/ConfigTool/ConfigTool.js'
import { TaskCreateTool } from './tools/TaskCreateTool/TaskCreateTool.js'
import { TaskGetTool } from './tools/TaskGetTool/TaskGetTool.js'
import { TaskUpdateTool } from './tools/TaskUpdateTool/TaskUpdateTool.js'
import { TaskListTool } from './tools/TaskListTool/TaskListTool.js'
// 注：Task 四件套（Create/Get/Update/List）是 v2 的待办工具，
//     和老的 TodoWriteTool 并存（见第 218 行的 isTodoV2Enabled 分支）。
import uniqBy from 'lodash-es/uniqBy.js'
// 注：唯一一个第三方工具库 —— 只在 assembleToolPool 里用一次（去重）。
//     自己写也就三行，但 lodash 的 uniqBy 是"保留首次出现"的语义，
//     正好符合"内置工具优先于 MCP 同名工具"的需求。
import { isToolSearchEnabledOptimistic } from './utils/toolSearch.js'
import { isTodoV2Enabled } from './utils/tasks.js'
// Dead code elimination: conditional import for CLAUDE_CODE_VERIFY_PLAN
// 译：死代码消除 —— CLAUDE_CODE_VERIFY_PLAN 的条件导入。
/* eslint-disable custom-rules/no-process-env-top-level, @typescript-eslint/no-require-imports */
const VerifyPlanExecutionTool =
  process.env.CLAUDE_CODE_VERIFY_PLAN === 'true'
    ? require('./tools/VerifyPlanExecutionTool/VerifyPlanExecutionTool.js')
        .VerifyPlanExecutionTool
    : null
/* eslint-enable custom-rules/no-process-env-top-level, @typescript-eslint/no-require-imports */
import { SYNTHETIC_OUTPUT_TOOL_NAME } from './tools/SyntheticOutputTool/SyntheticOutputTool.js'
export {
  ALL_AGENT_DISALLOWED_TOOLS,
  CUSTOM_AGENT_DISALLOWED_TOOLS,
  ASYNC_AGENT_ALLOWED_TOOLS,
  COORDINATOR_MODE_ALLOWED_TOOLS,
} from './constants/tools.js'
// 注：**这个文件只做再导出，自己不定义**。四个常量都是"哪些工具允许/禁止"的名单，
//     真正的内容在 `constants/tools.ts` 里（那里还有多智能体的权限矩阵）。
//     再导出是为了让调用方只 import 一个模块就够。
import { feature } from 'bun:bundle'
// 注：`feature` 的 import 出现在**文件中间**（第 104 行），而不是顶部 ——
//     这就是开头那条 biome-ignore 要保护的东西。别以为这是手滑。
// Dead code elimination: conditional import for OVERFLOW_TEST_TOOL
/* eslint-disable custom-rules/no-process-env-top-level, @typescript-eslint/no-require-imports */
const OverflowTestTool = feature('OVERFLOW_TEST_TOOL')
  ? require('./tools/OverflowTestTool/OverflowTestTool.js').OverflowTestTool
  : null
const CtxInspectTool = feature('CONTEXT_COLLAPSE')
  ? require('./tools/CtxInspectTool/CtxInspectTool.js').CtxInspectTool
  : null
const TerminalCaptureTool = feature('TERMINAL_PANEL')
  ? require('./tools/TerminalCaptureTool/TerminalCaptureTool.js')
      .TerminalCaptureTool
  : null
const WebBrowserTool = feature('WEB_BROWSER_TOOL')
  ? require('./tools/WebBrowserTool/WebBrowserTool.js').WebBrowserTool
  : null
const coordinatorModeModule = feature('COORDINATOR_MODE')
  ? (require('./coordinator/coordinatorMode.js') as typeof import('./coordinator/coordinatorMode.js'))
  : null
// 注：这里载入的不是工具，而是**协调器模式的判定模块**（第 282、293 行要用）。
const SnipTool = feature('HISTORY_SNIP')
  ? require('./tools/SnipTool/SnipTool.js').SnipTool
  : null
const ListPeersTool = feature('UDS_INBOX')
  ? require('./tools/ListPeersTool/ListPeersTool.js').ListPeersTool
  : null
const WorkflowTool = feature('WORKFLOW_SCRIPTS')
  ? (() => {
      require('./tools/WorkflowTool/bundled/index.js').initBundledWorkflows()
      return require('./tools/WorkflowTool/WorkflowTool.js').WorkflowTool
    })()
  : null
// 注：**唯一一个 IIFE（立即执行函数）形式的条件加载**。
//     因为它除了加载工具，还要先调一次 `initBundledWorkflows()` 做初始化。
//     如果只用三元表达式，就没地方放那个副作用调用。
//     注意初始化**发生在模块加载期**，不是第一次调用工具时。
/* eslint-enable custom-rules/no-process-env-top-level, @typescript-eslint/no-require-imports */
import type { ToolPermissionContext } from './Tool.js'
import { getDenyRuleForTool } from './utils/permissions/permissions.js'
import { hasEmbeddedSearchTools } from './utils/embeddedTools.js'
import { isEnvTruthy } from './utils/envUtils.js'
import { isPowerShellToolEnabled } from './utils/shell/shellToolUtils.js'
import { isAgentSwarmsEnabled } from './utils/agentSwarmsEnabled.js'
import { isWorktreeModeEnabled } from './utils/worktreeModeEnabled.js'
import {
  REPL_TOOL_NAME,
  REPL_ONLY_TOOLS,
  isReplModeEnabled,
} from './tools/REPLTool/constants.js'
export { REPL_ONLY_TOOLS }
/* eslint-disable @typescript-eslint/no-require-imports */
const getPowerShellTool = () => {
  if (!isPowerShellToolEnabled()) return null
  return (
    require('./tools/PowerShellTool/PowerShellTool.js') as typeof import('./tools/PowerShellTool/PowerShellTool.js')
  ).PowerShellTool
}
/* eslint-enable @typescript-eslint/no-require-imports */
// 注：和上面 Team 那三个一样是"函数包装 require"，但动机不同 ——
//     这里是因为 `isPowerShellToolEnabled()` 要**运行时**判断（读环境变量/配置），
//     而模块加载期的环境变量可能还没被 --shell 参数覆盖。
//     所以必须延迟到真正要用的时候。

// ── ② 预设（--tools 参数）──

/**
 * Predefined tool presets that can be used with --tools flag
 */
// 译：可与 --tools 参数配合使用的预定义工具预设。
export const TOOL_PRESETS = ['default'] as const
// 注：**只有一个预设 `'default'`**。这个"预设系统"目前是空壳 ——
//     设计上要留扩展点，实现上还没做第二个。`as const` 让类型变成字面量 `'default'`，
//     以后加 `'minimal'` 时类型自动跟着变，不用改两处。

export type ToolPreset = (typeof TOOL_PRESETS)[number]
// 注：这是从值推导类型的标准写法 —— **改数组就等于改类型**，永远同步。
//     等价于手写 `type ToolPreset = 'default'`，但后者会和数组脱节。

export function parseToolPreset(preset: string): ToolPreset | null {
  const presetString = preset.toLowerCase()
  // 注：先小写化 → `--tools DEFAULT` 也能认。
  if (!TOOL_PRESETS.includes(presetString as ToolPreset)) {
    return null
  }
  return presetString as ToolPreset
  // 注：`as` 断言是必要的 —— `includes` 对字面量元组的类型收窄支持有限，
  //     TS 不知道 presetString 一定是那三个之一，只能断言。
  //     返回 `null` 而不是抛错，让调用方自己决定怎么处理非法输入。
}

/**
 * Get the list of tool names for a given preset
 * Filters out tools that are disabled via isEnabled() check
 * @param preset The preset name
 * @returns Array of tool names
 */
// 译：取某个预设下的工具名列表。会过滤掉 isEnabled() 为 false 的工具。
// 注：文档注释里写了 `@param preset`，但**函数没有 preset 参数** ——
//     这是复制粘贴留下的过时注释。属于无害但会误导读代码人的小瑕疵。
export function getToolsForDefaultPreset(): string[] {
  const tools = getAllBaseTools()
  const isEnabled = tools.map(tool => tool.isEnabled())
  return tools.filter((_, i) => isEnabled[i]).map(tool => tool.name)
  // 注：**先批量算 isEnabled 再按下标过滤**，而不是 `filter(t => t.isEnabled())`。
  //     两种写法结果一样，但前者保证每个工具的 isEnabled 只调用一次 ——
  //     有些工具的 isEnabled 会读环境变量或文件（有开销）。
  //     这是"不要在 filter 回调里做有副作用/有开销的事"的实践。
}

// ── ③ getAllBaseTools：唯一真相来源 ──

/**
 * Get the complete exhaustive list of all tools that could be available
 * in the current environment (respecting process.env flags).
 * This is the source of truth for ALL tools.
 */
// 译：取"当前环境下可能存在的全部工具"的完整清单（尊重环境变量开关）。
//     这是**所有工具**的真相来源。
// 注："exhaustive（穷尽）"和"could be available（可能可用）"两个词都很关键 ——
//     它返回的是**候选集**，不是最终发给模型的集合。过滤在下面的 getTools 里做。
/**
 * NOTE: This MUST stay in sync with https://console.statsig.com/4aF3Ewatb6xPVpCwxb5nA3/dynamic_configs/claude_code_global_system_caching, in order to cache the system prompt across users.
 */
// 译：注意！这个列表**必须**与 Statsig 上的某个动态配置保持同步，
//     才能让系统提示词在用户之间共享缓存。
// 注：**这是全文件最"内部"的一条注释** —— 它泄露了一个关键机制：
//     工具的**名称和顺序**会进入系统提示词，而系统提示词要跨用户命中 prompt cache。
//     如果服务端的缓存策略认为"A 版本的工具列表"是一个缓存键，
//     那么客户端工具列表一变，缓存全失效，成本暴涨。
//     所以这个数组的顺序**不能随便调整**，加工具要同步改服务端配置。
//     这也解释了 assembleToolPool 里那段关于排序的详细注释。
export function getAllBaseTools(): Tools {
  return [
    AgentTool,
    TaskOutputTool,
    BashTool,
    // Ant-native builds have bfs/ugrep embedded in the bun binary (same ARGV0
    // trick as ripgrep). When available, find/grep in Claude's shell are aliased
    // to these fast tools, so the dedicated Glob/Grep tools are unnecessary.
    // 译：Ant 原生构建把 bfs/ugrep 内嵌进了 bun 二进制（和 ripgrep 用同一套
    //     ARGV0 技巧）。内嵌可用时，Claude 的 shell 里 find/grep 会被别名到
    //     这些更快的工具，所以专门的 Glob/Grep 工具就多余了。
    // 注：**"ARGV0 技巧"** 是指：根据 argv[0]（程序名）决定行为 ——
    //     同一个二进制，叫它 `rg` 就当 ripgrep 用，叫它 `bfs` 就当 find 用。
    //     busybox 是这个套路的鼻祖。
    //     这里的推论很漂亮：既然 shell 里的 grep 已经是超快版本，
    //     再给模型一个单独的 GrepTool 反而占工具名额、增加选择成本。
    ...(hasEmbeddedSearchTools() ? [] : [GlobTool, GrepTool]),
    ExitPlanModeV2Tool,
    FileReadTool,
    FileEditTool,
    FileWriteTool,
    NotebookEditTool,
    WebFetchTool,
    TodoWriteTool,
    WebSearchTool,
    TaskStopTool,
    AskUserQuestionTool,
    SkillTool,
    EnterPlanModeTool,
    ...(process.env.USER_TYPE === 'ant' ? [ConfigTool] : []),
    // 注：ConfigTool 和下面的 TungstenTool 都是 ant 专属（运行期判断）。
    //     注意这里用的是 env 判断，不是 feature() —— 意味着**代码在包里**，
    //     只是非员工拿不到。而上面那些 feature() 的，打包时就没了。
    ...(process.env.USER_TYPE === 'ant' ? [TungstenTool] : []),
    ...(SuggestBackgroundPRTool ? [SuggestBackgroundPRTool] : []),
    ...(WebBrowserTool ? [WebBrowserTool] : []),
    ...(isTodoV2Enabled()
      ? [TaskCreateTool, TaskGetTool, TaskUpdateTool, TaskListTool]
      : []),
    // 注：v2 待办四件套 vs 老的 TodoWriteTool（第 208 行）。**两者同时存在**：
    //     TodoWriteTool 永远在，v2 四件套在开关打开时额外追加。
    //     这不是 bug —— 见第 301 行的 specialTools 过滤和后续的 getTools 逻辑，
    //     上层可能有"v2 开启则隐藏 TodoWrite"的处理（在别处）。
    ...(OverflowTestTool ? [OverflowTestTool] : []),
    ...(CtxInspectTool ? [CtxInspectTool] : []),
    ...(TerminalCaptureTool ? [TerminalCaptureTool] : []),
    ...(isEnvTruthy(process.env.ENABLE_LSP_TOOL) ? [LSPTool] : []),
    ...(isWorktreeModeEnabled() ? [EnterWorktreeTool, ExitWorktreeTool] : []),
    getSendMessageTool(),
    // 注：**直接调用函数**，不是 `...(x ? [x] : [])`。意味着 SendMessageTool
    //     是**无条件**存在的（函数内部必有返回）。
    //     对比下面 isAgentSwarmsEnabled() 那段 —— 有条件的都用展开写法。
    ...(ListPeersTool ? [ListPeersTool] : []),
    ...(isAgentSwarmsEnabled()
      ? [getTeamCreateTool(), getTeamDeleteTool()]
      : []),
    ...(VerifyPlanExecutionTool ? [VerifyPlanExecutionTool] : []),
    ...(process.env.USER_TYPE === 'ant' && REPLTool ? [REPLTool] : []),
    ...(WorkflowTool ? [WorkflowTool] : []),
    ...(SleepTool ? [SleepTool] : []),
    ...cronTools,
    // 注：cronTools 已经是数组（空或三个），所以直接展开，不需要三元。
    ...(RemoteTriggerTool ? [RemoteTriggerTool] : []),
    ...(MonitorTool ? [MonitorTool] : []),
    BriefTool,
    ...(SendUserFileTool ? [SendUserFileTool] : []),
    ...(PushNotificationTool ? [PushNotificationTool] : []),
    ...(SubscribePRTool ? [SubscribePRTool] : []),
    ...(getPowerShellTool() ? [getPowerShellTool()] : []),
    // 注：**同一个函数调了两次**。每次都会跑 `isPowerShellToolEnabled()` 和
    //     `require(...)`（后者被模块缓存，开销很小，但仍然多一次调用）。
    //     理论上可以提取成变量，但这里为了保持"清单是纯表达式"的风格没提取。
    ...(SnipTool ? [SnipTool] : []),
    ...(process.env.NODE_ENV === 'test' ? [TestingPermissionTool] : []),
    // 注：**只在测试环境存在的工具** —— 用来在测试里模拟权限弹窗。
    ListMcpResourcesTool,
    ReadMcpResourceTool,
    // Include ToolSearchTool when tool search might be enabled (optimistic check)
    // The actual decision to defer tools happens at request time in claude.ts
    // 译：工具搜索可能启用时就把 ToolSearchTool 加进来（乐观检查）。
    //     真正"要不要延迟这些工具"的决定发生在请求时，在 claude.ts 里。
    // 注：**"optimistic"（乐观）在这里是个重要的设计选择**。
    //     它不确定工具搜索最终会不会开（那取决于工具数量和配置，要到请求时才知道），
    //     但只要"可能开"就先把这个工具放进清单。
    //     代价：多一个工具占名额。收益：切换时不用重建清单（清单是缓存的一部分）。
    ...(isToolSearchEnabledOptimistic() ? [ToolSearchTool] : []),
  ]
}

// ── ④ 四个过滤/组装函数 ──

/**
 * Filters out tools that are blanket-denied by the permission context.
 * A tool is filtered out if there's a deny rule matching its name with no
 * ruleContent (i.e., a blanket deny for that tool).
 *
 * Uses the same matcher as the runtime permission check (step 1a), so MCP
 * server-prefix rules like `mcp__server` strip all tools from that server
 * before the model sees them — not just at call time.
 */
// 译：过滤掉被权限上下文"整体拒绝"的工具。
//     判定条件：有一条匹配该工具名、且**没有 ruleContent** 的 deny 规则
//     （也就是对这个工具的整体拒绝）。
//     用的是与运行时权限检查（第 1a 步）**同一个匹配器**，所以像 `mcp__server`
//     这种服务器前缀规则会在模型看到之前就把那个服务器的所有工具全剥掉 ——
//     而不是等到调用时才拦。
// 注：**"模型看到之前"和"调用时才拦"是两种完全不同的策略**，这条注释点明了选择：
//     前者省 token（工具清单本身就变短），也避免模型反复尝试一个注定失败的工具。
//     这也是为什么这个函数单独抽出来、还被 print.ts 直接调用（MCP 工具也要过一遍）。
export function filterToolsByDenyRules<
  T extends {
    name: string
    mcpInfo?: { serverName: string; toolName: string }
  },
>(tools: readonly T[], permissionContext: ToolPermissionContext): T[] {
  // 注：泛型约束里带 `mcpInfo?` —— 因为这个函数**同时服务内置工具和 MCP 工具**。
  //     内置工具没有 mcpInfo，MCP 工具有。用结构化类型约束而不是联合类型，
  //     让两种工具都能传进来。
  return tools.filter(tool => !getDenyRuleForTool(permissionContext, tool))
  // 注：`!getDenyRuleForTool(...)` —— 返回"有任何 deny 规则命中"就滤掉。
  //     注意是"任何"，不是"全部"：一条 deny 就够。
}

export const getTools = (permissionContext: ToolPermissionContext): Tools => {
  // Simple mode: only Bash, Read, and Edit tools
  // 译：简单模式 —— 只有 Bash、Read、Edit 三个工具。
  if (isEnvTruthy(process.env.CLAUDE_CODE_SIMPLE)) {
    // --bare + REPL mode: REPL wraps Bash/Read/Edit/etc inside the VM, so
    // return REPL instead of the raw primitives. Matches the non-bare path
    // below which also hides REPL_ONLY_TOOLS when REPL is enabled.
    // 译：--bare 加 REPL 模式：REPL 在 VM 里包装了 Bash/Read/Edit 等，
    //     所以返回 REPL 而不是那些原始工具。与下面非 bare 路径的行为一致 ——
    //     那条路径在 REPL 启用时也会隐藏 REPL_ONLY_TOOLS。
    if (isReplModeEnabled() && REPLTool) {
      const replSimple: Tool[] = [REPLTool]
      if (
        feature('COORDINATOR_MODE') &&
        coordinatorModeModule?.isCoordinatorMode()
      ) {
        replSimple.push(TaskStopTool, getSendMessageTool())
        // 注：协调器模式下要多给两个：停任务、发消息。
        //     协调器自己不干活，只调度 —— 所以它不需要 Bash/Read/Edit，
        //     但必须有"叫停"和"传话"的能力。
      }
      return filterToolsByDenyRules(replSimple, permissionContext)
    }
    const simpleTools: Tool[] = [BashTool, FileReadTool, FileEditTool]
    // 注：**简单模式只有三个工具**。注意没有 FileWriteTool —— 写文件要通过 Edit。
    //     这是"最保守的工具集"：能读、能改、能跑命令，但不能创建新文件。
    // When coordinator mode is also active, include AgentTool and TaskStopTool
    // so the coordinator gets Task+TaskStop (via useMergedTools filtering) and
    // workers get Bash/Read/Edit (via filterToolsForAgent filtering).
    // 译：协调器模式也激活时，加入 AgentTool 和 TaskStopTool，
    //     这样协调器能拿到 Task+TaskStop（经 useMergedTools 过滤），
    //     而 worker 拿到 Bash/Read/Edit（经 filterToolsForAgent 过滤）。
    // 注：**"同一份清单，两种角色各取所需"** —— 这是多智能体系统的常见模式。
    //     注意注释里提到的 `useMergedTools` 是 React hook（hooks/useMergedTools.ts），
    //     它调的是 assembleToolPool，不是下面那个死掉的 getMergedTools。
    if (
      feature('COORDINATOR_MODE') &&
      coordinatorModeModule?.isCoordinatorMode()
    ) {
      simpleTools.push(AgentTool, TaskStopTool, getSendMessageTool())
    }
    return filterToolsByDenyRules(simpleTools, permissionContext)
  }

  // Get all base tools and filter out special tools that get added conditionally
  // 译：取全部基础工具，滤掉那些会被"按条件单独加入"的特殊工具。
  const specialTools = new Set([
    ListMcpResourcesTool.name,
    ReadMcpResourceTool.name,
    SYNTHETIC_OUTPUT_TOOL_NAME,
  ])
  // 注：这三个被排除的理由是"它们由别的路径按需加入"：
  //     - ListMcpResourcesTool / ReadMcpResourceTool：只在有 MCP 服务器时才给
  //     - SYNTHETIC_OUTPUT_TOOL_NAME：用于结构化输出，按需注入
  //     **顺带发现一个小瑕疵**：`SYNTHETIC_OUTPUT_TOOL_NAME` 其实**不在**
  //     getAllBaseTools() 的清单里（搜一下就知道）。所以这一行是**冗余的** ——
  //     它过滤的是"本来就不存在的东西"。无害，但说明这段代码是从
  //     "曾经把 SyntheticOutputTool 放进清单"的版本演变来的，清理时漏了一条。

  const tools = getAllBaseTools().filter(tool => !specialTools.has(tool.name))

  // Filter out tools that are denied by the deny rules
  // 译：滤掉被 deny 规则拒绝的工具。
  let allowedTools = filterToolsByDenyRules(tools, permissionContext)

  // When REPL mode is enabled, hide primitive tools from direct use.
  // They're still accessible inside REPL via the VM context.
  // 译：REPL 模式启用时，把原始工具从"直接使用"里隐藏。
  //     它们在 REPL 内部通过 VM 上下文仍然可用。
  if (isReplModeEnabled()) {
    const replEnabled = allowedTools.some(tool =>
      toolMatchesName(tool, REPL_TOOL_NAME),
    )
    // 注：**判断 REPL 是否真的在清单里**，而不是只看 `isReplModeEnabled()`。
    //     因为 REPL 可能是 ant-only 的（REPLTool 为 null），或者被 deny 规则滤掉了。
    //     如果只看开关状态，就会出现"REPL 没启用但原始工具全被隐藏"的灾难 ——
    //     模型一个工具都没有了。
    if (replEnabled) {
      allowedTools = allowedTools.filter(
        tool => !REPL_ONLY_TOOLS.has(tool.name),
      )
      // 注：`REPL_ONLY_TOOLS` 是"只能通过 REPL 用、不该直接暴露"的工具集合
      //     （Bash/Read/Edit 这些）。名字有歧义：读成"REPL 专用的工具"更准确。
    }
  }

  const isEnabled = allowedTools.map(_ => _.isEnabled())
  return allowedTools.filter((_, i) => isEnabled[i])
  // 注：和 getToolsForDefaultPreset 同样的手法 —— 先批量求值再按下标过滤。
  //     **顺序很重要**：isEnabled 放在 deny 过滤之后，意味着被 deny 的工具
  //     连 isEnabled() 都不会被调用。省掉不必要的文件/环境检查。
}

/**
 * Assemble the full tool pool for a given permission context and MCP tools.
 *
 * This is the single source of truth for combining built-in tools with MCP tools.
 * Both REPL.tsx (via useMergedTools hook) and runAgent.ts (for coordinator workers)
 * use this function to ensure consistent tool pool assembly.
 *
 * The function:
 * 1. Gets built-in tools via getTools() (respects mode filtering)
 * 2. Filters MCP tools by deny rules
 * 3. Deduplicates by tool name (built-in tools take precedence)
 *
 * @param permissionContext - Permission context for filtering built-in tools
 * @param mcpTools - MCP tools from appState.mcp.tools
 * @returns Combined, deduplicated array of built-in and MCP tools
 */
// 译：为给定的权限上下文和 MCP 工具组装完整工具池。
//     这是"内置工具 + MCP 工具"合并的**唯一真相来源**。
//     REPL.tsx（通过 useMergedTools hook）和 runAgent.ts（协调器 worker）都用它，
//     以保证工具池组装的一致性。
//     步骤：1) 用 getTools() 取内置工具（尊重模式过滤）
//          2) 用 deny 规则过滤 MCP 工具
//          3) 按工具名去重（内置工具优先）
// 注：**注意注释里那句 "Both REPL.tsx and runAgent.ts use this function"** ——
//     这句话正是 getMergedTools 变成死代码的证据：两个调用方都改用这里了。
export function assembleToolPool(
  permissionContext: ToolPermissionContext,
  mcpTools: Tools,
): Tools {
  const builtInTools = getTools(permissionContext)

  // Filter out MCP tools that are in the deny list
  // 译：滤掉在 deny 列表里的 MCP 工具。
  const allowedMcpTools = filterToolsByDenyRules(mcpTools, permissionContext)

  // Sort each partition for prompt-cache stability, keeping built-ins as a
  // contiguous prefix. The server's claude_code_system_cache_policy places a
  // global cache breakpoint after the last prefix-matched built-in tool; a flat
  // sort would interleave MCP tools into built-ins and invalidate all downstream
  // cache keys whenever an MCP tool sorts between existing built-ins. uniqBy
  // preserves insertion order, so built-ins win on name conflict.
  // Avoid Array.toSorted (Node 20+) — we support Node 18. builtInTools is
  // readonly so copy-then-sort; allowedMcpTools is a fresh .filter() result.
  // 译：**分别排序**（两个分区各排各的）以保证 prompt 缓存稳定，让内置工具
  //     保持为一个连续的前缀。服务端的 claude_code_system_cache_policy 在
  //     "最后一个前缀匹配的内置工具"之后放置一个全局缓存断点；
  //     如果混在一起整体排序，MCP 工具就会插进内置工具之间，
  //     只要有 MCP 工具排到某两个内置工具中间，之后所有缓存键都失效。
  //     uniqBy 保留插入顺序，所以名字冲突时内置工具胜出。
  //     不用 Array.toSorted（Node 20+）—— 我们要支持 Node 18。
  //     builtInTools 是 readonly 所以复制后再排；allowedMcpTools 是
  //     .filter() 的新数组，可以直接排。
  // 注：★★★ **这段注释是整个文件最有价值的 20 行** ★★★
  //     它解释了一个"看起来毫无必要"的细节：为什么不直接 sort 一次？
  //
  //     答案是 **prompt cache 的断点位置**。系统提示词的结构是：
  //       [前缀：内置工具 A、B、C...] ← 缓存断点
  //       [MCP 工具 D、E...]
  //     缓存是按"前缀完全一致"命中的。如果整体排序，MCP 工具 `filesystem__read`
  //     可能排到 `Bash` 和 `Edit` 中间，那么断点之前的序列就变了 →
  //     整个缓存失效 → 每次请求都按全价计费。
  //
  //     这也是为什么工具清单的**顺序**被当成契约（见第 191 行那条 Statsig 注释）。
  //     一个排序细节，直接关系到运营成本。
  const byName = (a: Tool, b: Tool) => a.name.localeCompare(b.name)
  return uniqBy(
    [...builtInTools].sort(byName).concat(allowedMcpTools.sort(byName)),
    'name',
  )
  // 注：`[...builtInTools]` 复制是为了 sort —— sort 是原地操作，
  //     而 builtInTools 的类型是 readonly 数组。
  //     `allowedMcpTools` 直接 sort 是安全的：它是 filter 出来的新数组。
  //     `concat` 之后再 uniqBy('name')：同名时保留**先出现的**（内置工具）。
}

/**
 * Get all tools including both built-in tools and MCP tools.
 *
 * This is the preferred function when you need the complete tools list for:
 * - Tool search threshold calculations (isToolSearchEnabled)
 * - Token counting that includes MCP tools
 * - Any context where MCP tools should be considered
 *
 * Use getTools() only when you specifically need just built-in tools.
 *
 * @param permissionContext - Permission context for filtering built-in tools
 * @param mcpTools - MCP tools from appState.mcp.tools
 * @returns Combined array of built-in and MCP tools
 */
// 译：取全部工具，包括内置工具和 MCP 工具。
//     需要完整工具清单时优先用这个函数：
//     - 工具搜索阈值计算（isToolSearchEnabled）
//     - 包含 MCP 工具的 token 计数
//     - 任何应该考虑 MCP 工具的场景
//     只在明确只要内置工具时才用 getTools()。
// 注：**这段文档注释是"理想"，不是"现状"** —— 见下面函数体的批注。
export function getMergedTools(
  permissionContext: ToolPermissionContext,
  mcpTools: Tools,
): Tools {
  const builtInTools = getTools(permissionContext)
  return [...builtInTools, ...mcpTools]
}

// 注：★★★ **这个函数是死代码** ★★★
//
//   实测外部调用点：**0 个**（`grep -rn "getMergedTools" src` 只命中本文件）。
//   真正在用的是 `assembleToolPool` —— 它比这个函数多做三件事：
//     1) 也过 deny 规则过滤 MCP 工具
//     2) 按名字去重（这里不去重，同名工具会重复出现）
//     3) 分两段排序以保住 prompt cache 断点
//
//   如果你按文档注释去找"哪里用了 getMergedTools"，会一无所获；
//   这属于**注释还在描述旧世界的典型例子**。
//   保留它的原因大概是"怕外部 SDK 或其他分支还在引用"，但在这个打包版里确实没人用。
