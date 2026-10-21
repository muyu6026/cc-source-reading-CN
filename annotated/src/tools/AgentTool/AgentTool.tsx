// ═══════════════════════════════════════════════════════════════
// 第 7 步 · 3/4 —— Agent 工具本体（src/tools/AgentTool/AgentTool.tsx，1,397 行）
//
// 前面两个文件都是"文字"（提示词），这个文件是"机制"。
// 它要回答一个具体问题：**当模型说"派一个 agent 去做这件事"，
// 到底会发生什么？**
//
// 【这个文件的四条并行主线，读的时候别混在一起】
//
//   ① Schema 设计（82-190）
//      参数怎么声明、哪些参数在什么条件下对模型**不可见**。
//      这一段的难点全在 Zod 类型推断和 DCE（死代码消除）的夹缝里。
//
//   ② 派活前的十道检查（239-410）
//      teammate 限制、fork 路由、agent 类型解析、MCP 服务器就绪……
//      全是"能不能派"的判定，任何一条不过就 throw。
//
//   ③ 两套执行路径（686-1262）
//      async：注册任务 → 立刻返回 agentId → 后台跑 → 完成时发通知
//      sync：前台跑 → 用 Promise.race 让它在任意时刻可被"转后台"
//      这是全文最复杂的一段，核心是那个 race 循环。
//
//   ④ 结果如何变成 tool_result 文本（1298-1379）
//      四种状态（teammate / remote / async / completed）各一套话术。
//      别跳过这段 —— 这里藏着"为什么模型派完活会立刻结束轮次"的答案。
//
// 【一句话概括这个工具的特殊性】
// 它是一个"会产生另一个 AI"的工具。所以它的所有设计约束都不是
// 关于计算，而是关于**资源和生命周期**：谁的生命周期绑在谁身上、
// 谁能看见谁、谁死了谁会受影响。
// ═══════════════════════════════════════════════════════════════
import { feature } from 'bun:bundle';
import * as React from 'react';
import { buildTool, type ToolDef, toolMatchesName } from 'src/Tool.js';
import type { Message as MessageType, NormalizedUserMessage } from 'src/types/message.js';
import { getQuerySourceForAgent } from 'src/utils/promptCategory.js';
import { z } from 'zod/v4';
import { clearInvokedSkillsForAgent, getSdkAgentProgressSummariesEnabled } from '../../bootstrap/state.js';
import { enhanceSystemPromptWithEnvDetails, getSystemPrompt } from '../../constants/prompts.js';
import { isCoordinatorMode } from '../../coordinator/coordinatorMode.js';
import { startAgentSummarization } from '../../services/AgentSummary/agentSummary.js';
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from '../../services/analytics/index.js';
import { clearDumpState } from '../../services/api/dumpPrompts.js';
import { completeAgentTask as completeAsyncAgent, createActivityDescriptionResolver, createProgressTracker, enqueueAgentNotification, failAgentTask as failAsyncAgent, getProgressUpdate, getTokenCountFromTracker, isLocalAgentTask, killAsyncAgent, registerAgentForeground, registerAsyncAgent, unregisterAgentForeground, updateAgentProgress as updateAsyncAgentProgress, updateProgressFromMessage } from '../../tasks/LocalAgentTask/LocalAgentTask.js';
import { checkRemoteAgentEligibility, formatPreconditionError, getRemoteTaskSessionUrl, registerRemoteAgentTask } from '../../tasks/RemoteAgentTask/RemoteAgentTask.js';
import { assembleToolPool } from '../../tools.js';
import { asAgentId } from '../../types/ids.js';
import { runWithAgentContext } from '../../utils/agentContext.js';
import { isAgentSwarmsEnabled } from '../../utils/agentSwarmsEnabled.js';
import { getCwd, runWithCwdOverride } from '../../utils/cwd.js';
import { logForDebugging } from '../../utils/debug.js';
import { isEnvTruthy } from '../../utils/envUtils.js';
import { AbortError, errorMessage, toError } from '../../utils/errors.js';
import type { CacheSafeParams } from '../../utils/forkedAgent.js';
import { lazySchema } from '../../utils/lazySchema.js';
import { createUserMessage, extractTextContent, isSyntheticMessage, normalizeMessages } from '../../utils/messages.js';
import { getAgentModel } from '../../utils/model/agent.js';
import { permissionModeSchema } from '../../utils/permissions/PermissionMode.js';
import type { PermissionResult } from '../../utils/permissions/PermissionResult.js';
import { filterDeniedAgents, getDenyRuleForAgent } from '../../utils/permissions/permissions.js';
import { enqueueSdkEvent } from '../../utils/sdkEventQueue.js';
import { writeAgentMetadata } from '../../utils/sessionStorage.js';
import { sleep } from '../../utils/sleep.js';
import { buildEffectiveSystemPrompt } from '../../utils/systemPrompt.js';
import { asSystemPrompt } from '../../utils/systemPromptType.js';
import { getTaskOutputPath } from '../../utils/task/diskOutput.js';
import { getParentSessionId, isTeammate } from '../../utils/teammate.js';
import { isInProcessTeammate } from '../../utils/teammateContext.js';
import { teleportToRemote } from '../../utils/teleport.js';
import { getAssistantMessageContentLength } from '../../utils/tokens.js';
import { createAgentId } from '../../utils/uuid.js';
import { createAgentWorktree, hasWorktreeChanges, removeAgentWorktree } from '../../utils/worktree.js';
import { BASH_TOOL_NAME } from '../BashTool/toolName.js';
import { BackgroundHint } from '../BashTool/UI.js';
import { FILE_READ_TOOL_NAME } from '../FileReadTool/prompt.js';
import { spawnTeammate } from '../shared/spawnMultiAgent.js';
import { setAgentColor } from './agentColorManager.js';
import { agentToolResultSchema, classifyHandoffIfNeeded, emitTaskProgress, extractPartialResult, finalizeAgentTool, getLastToolUseName, runAsyncAgentLifecycle } from './agentToolUtils.js';
import { GENERAL_PURPOSE_AGENT } from './built-in/generalPurposeAgent.js';
import { AGENT_TOOL_NAME, LEGACY_AGENT_TOOL_NAME, ONE_SHOT_BUILTIN_AGENT_TYPES } from './constants.js';
import { buildForkedMessages, buildWorktreeNotice, FORK_AGENT, isForkSubagentEnabled, isInForkChild } from './forkSubagent.js';
import type { AgentDefinition } from './loadAgentsDir.js';
import { filterAgentsByMcpRequirements, hasRequiredMcpServers, isBuiltInAgent } from './loadAgentsDir.js';
import { getPrompt } from './prompt.js';
import { runAgent } from './runAgent.js';
import { renderGroupedAgentToolUse, renderToolResultMessage, renderToolUseErrorMessage, renderToolUseMessage, renderToolUseProgressMessage, renderToolUseRejectedMessage, renderToolUseTag, userFacingName, userFacingNameBackgroundColor } from './UI.js';

// feature() 条件 require 的又一次出现（和 claude.ts、prompts.ts 同款）。
//
// 为什么这里用 require 而不是 import：
//   · import 是静态的，打包器会无条件把 proactive/index.js 打进来
//   · require 被 feature() 三元包住时，bun 能在 feature 为 false 时
//     把整个三元删掉，连带这个 require —— 模块根本不进产物
//
// 注意 as typeof import(...) 这个写法：require 的返回是 any，
// 加类型断言之后才能有完整的类型检查。这是"运行时动态加载 + 编译期静态类型"
// 的桥接写法，在需要 DCE 的地方反复出现。
/* eslint-disable @typescript-eslint/no-require-imports */
const proactiveModule = feature('PROACTIVE') || feature('KAIROS') ? require('../../proactive/index.js') as typeof import('../../proactive/index.js') : null;
/* eslint-enable @typescript-eslint/no-require-imports */

// Progress display constants (for showing background hint)
// 2 秒后显示"可以转后台"的提示。这个数字不是随便定的：
// 短任务（查个文件、跑个 grep）通常 1 秒内结束，2 秒的门槛能把它们
// 全部过滤掉，避免界面闪一下提示又消失。
const PROGRESS_THRESHOLD_MS = 2000; // Show background hint after 2 seconds

// ⚠️ 这个变量在**模块加载时**求值，不是在 call() 里。
//
// 作者留了 eslint-disable 并写明理由："Intentional: schema must be defined
// at module load"。
//
// 为什么 schema 必须模块加载期定义？
// 因为第 110 行的 inputSchema 是 lazySchema 包着的 —— 它的**取值**
// 可以推迟，但它依赖的这个布尔值必须在模块初始化时定下来，
// 否则同一次会话里 schema 形状可能变（先有 run_in_background，
// 后来又没了），那模型看到的工具定义就会在会话中途改变 →
// 工具 schema 变化 → 缓存前缀作废。
//
// 【这里体现了一条通用规则】
// 凡是参与"发给 API 的字节"的东西（工具 schema、系统提示词、
// beta header），取值时机必须早且稳定。晚求值 = 可能变 = 可能 bust 缓存。
// Check if background tasks are disabled at module load time
const isBackgroundTasksDisabled =
// eslint-disable-next-line custom-rules/no-process-env-top-level -- Intentional: schema must be defined at module load
isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS);

// 自动转后台：前台 agent 跑满 120 秒还没结束，就自动转到后台，
// 把主线程的控制权还给用户。
//
// 【为什么这件事需要"自动"】
// 想象模型派了一个 agent 去跑全量测试，预计 5 分钟。前台模式下，
// 这 5 分钟里用户**什么都做不了**（输入被锁住），只能按 Esc 取消。
// 而 Esc 会连 agent 一起杀掉 —— 用户为了能用界面，必须放弃正在进行的工作。
//
// 自动转后台解决了这个僵局：跑得久就放手，用户继续用，agent 在后台跑完
// 再通过 task-notification 回报。第 120_000 这个阈值大致对应用户耐心的量级。
//
// 【注意它是 OR 两个来源】
//   环境变量 CLAUDE_AUTO_BACKGROUND_TASKS（手动开）
//   GrowthBook 门 tengu_auto_background_agents（灰度）
// 而且这里**每次调用都重新查**（不像上面的 isBackgroundTasksDisabled 是
// 模块加载期定死）—— 因为"要不要自动转后台"不影响 API 请求的字节，
// 改了也不会 bust 缓存，所以可以宽松求值。
// Auto-background agent tasks after this many ms (0 = disabled)
// Enabled by env var OR GrowthBook gate (checked lazily since GB may not be ready at module load)
function getAutoBackgroundMs(): number {
  if (isEnvTruthy(process.env.CLAUDE_AUTO_BACKGROUND_TASKS) || getFeatureValue_CACHED_MAY_BE_STALE('tengu_auto_background_agents', false)) {
    return 120_000;
  }
  return 0;
}

// 这行注释解释了一个很容易被忽略的工程约束：
// "Multi-agent type constants are defined inline inside gated blocks
//  to enable dead code elimination"
//
// 意思是：多智能体相关的**常量**（比如 'teammate_spawned' 这个状态字符串）
// 不能提到顶层，必须写在 feature() 分支内部。
//
// 为什么？因为如果提到顶层：
//   const TEAMMATE_SPAWNED = 'teammate_spawned'
// 那么这个字符串会出现在产物里，即使外面所有用到它的分支都被删了。
// 打包器不敢删一个顶层 const —— 它可能被别的模块引用。
//
// 而写在分支内部，整个分支被删时字符串跟着消失。省下的不是几个字节，
// 而是一整条**代码路径的所有字符串常量**。外部构建里"团队/远程/
// 进程内 teammate"这些功能完全不存在，它们的错误消息、状态名、
// 提示文案全都不该出现在用户下载的包里。
// Multi-agent type constants are defined inline inside gated blocks to enable dead code elimination

// Base input schema without multi-agent parameters
// ─────────────────────────────────────────────────────────────
// 【为什么基础 schema 和完整 schema 要拆开】
//
// baseInputSchema   五个"永远存在"的参数：description / prompt /
//                   subagent_type / model / run_in_background
// fullInputSchema   base + 三个多智能体参数（name / team_name / mode）
//                   + isolation / cwd
//
// 拆开的目的不是复用，而是**后置裁剪**：第 110-125 行会根据开关
// 用 .omit() 把某些参数删掉，让模型**根本看不到**它们。
//
// 【"看不见"比"看见了被拒绝"好得多】
// 假设 run_in_background 一直存在但被禁用，会发生什么：
//   模型看到参数 → 试着用 → 被忽略或报错 → 浪费一轮 → 再试别的办法
// 而如果 .omit() 掉：
//   模型看不到这个参数 → 压根不会想用它 → 零成本
//
// 这是"用 schema 表达能力边界"而不是"用校验表达"。schema 是
// 模型读到的能力清单，改 schema 等于改它的认知。
const baseInputSchema = lazySchema(() => z.object({
  description: z.string().describe('A short (3-5 word) description of the task'),
  prompt: z.string().describe('The task for the agent to perform'),
  subagent_type: z.string().optional().describe('The type of specialized agent to use for this task'),
  model: z.enum(['sonnet', 'opus', 'haiku']).optional().describe("Optional model override for this agent. Takes precedence over the agent definition's model frontmatter. If omitted, uses the agent definition's model, or inherits from the parent."),
  run_in_background: z.boolean().optional().describe('Set to true to run this agent in the background. You will be notified when it completes.')
}));

// Full schema combining base + multi-agent params + isolation
const fullInputSchema = lazySchema(() => {
  // Multi-agent parameters
  const multiAgentInputSchema = z.object({
    name: z.string().optional().describe('Name for the spawned agent. Makes it addressable via SendMessage({to: name}) while running.'),
    team_name: z.string().optional().describe('Team name for spawning. Uses current team context if omitted.'),
    mode: permissionModeSchema().optional().describe('Permission mode for spawned teammate (e.g., "plan" to require plan approval).')
  });
  return baseInputSchema().merge(multiAgentInputSchema).extend({
    isolation: ("external" === 'ant' ? z.enum(['worktree', 'remote']) : z.enum(['worktree'])).optional().describe("external" === 'ant' ? 'Isolation mode. "worktree" creates a temporary git worktree so the agent works on an isolated copy of the repo. "remote" launches the agent in a remote CCR environment (always runs in background).' : 'Isolation mode. "worktree" creates a temporary git worktree so the agent works on an isolated copy of the repo.'),
    cwd: z.string().optional().describe('Absolute path to run the agent in. Overrides the working directory for all filesystem and shell operations within this agent. Mutually exclusive with isolation: "worktree".')
  });
});

// ─────────────────────────────────────────────────────────────
// 【全文件最"技术"的一段：为什么用 .omit() 而不是条件展开】
//
// 直觉写法应该是这样：
//   z.object({
//     ...(gate ? { cwd: z.string() } : {}),
//     ...
//   })
// 但作者在第 106-109 行明确否掉了：
//   "Done via .omit() rather than conditional spread inside .extend()
//    because the spread-ternary breaks Zod's type inference
//    (field type collapses to `unknown`)."
//
// 展开三元会让字段类型塌成 unknown。原因在 TypeScript 的类型推断机制：
//   { ...cond ? {a: T} : {}, ... } 的类型是 { a?: T } | {}
// 联合类型里的可选字段，在 z.infer 之后无法被可靠地收窄，
// Zod 只好退化成 unknown。于是后面所有 i.cwd 都失去类型保护。
//
// 而 .omit({ cwd: true }) 返回的是**已知的具体类型**（Omit<..., 'cwd'>），
// 类型系统能精确追踪。代价是要写两遍字段名，收益是全程类型安全。
//
// 【这里有一个通用的取舍可以记下来】
// 类型系统跟不上动态构造时，宁可**写两份静态定义**，
// 也不要让类型退化成 any/unknown。因为 any 会往后传播，
// 而"写两份"的代价只发生在写的时候。
// Strip optional fields from the schema when the backing feature is off so
// the model never sees them. Done via .omit() rather than conditional spread
// inside .extend() because the spread-ternary breaks Zod's type inference
// (field type collapses to `unknown`). The ternary return produces a union
// type, but call() destructures via the explicit AgentToolInput type below
// which always includes all optional fields.
export const inputSchema = lazySchema(() => {
  const schema = feature('KAIROS') ? fullInputSchema() : fullInputSchema().omit({
    cwd: true
  });

// 【第 115-121 行这段注释，是全文件最细致的推理】
//
// 它在讨论一个问题：GrowthBook 门在 lazySchema 里读，安全吗？
//
// 结论是"可以"，论证方式是**逐个数清楚最坏情况**：
//   分歧窗口 = 一次门翻转 × 每个会话一次（因为读的是
//   _CACHED_MAY_BE_STALE 的磁盘缓存，不是实时值）
//   最坏情况只有两种：
//     · 门中途打开 → schema 显示了个 no-op 参数（forceAsync 会忽略它）
//     · 门中途关闭 → schema 藏了个本来能用的参数（但所有 spawn 仍然
//       走异步，因为 forceAsync 是 memoize 过的）
//   两种都不会 Zod rejection、不会 crash。
//
// 然后对比了被移除的 subagent_type（commit 906da6c723）：
// 那个参数改的是 **required → optional**，这类改变会让已经按旧 schema
// 发出的请求直接 Zod 校验失败。
//
// 【这段注释的价值不在结论，在方法】
// 它示范了怎么评估"配置可能在会话中途变化"的风险：
//   ① 变更窗口有多大（一次门翻转 vs 每个请求）
//   ② 每个窗口内的后果是什么（降级 / 报错 / 崩溃）
//   ③ 哪些变更形态是"可容忍"的（可选参数增删），
//      哪些是"不可容忍"的（必填变可选、类型改变）
//
// 一句话总结：**可选参数的增删可以容忍，必填性的变化不行。**
  // GrowthBook-in-lazySchema is acceptable here (unlike subagent_type, which
  // was removed in 906da6c723): the divergence window is one-session-per-
  // gate-flip via _CACHED_MAY_BE_STALE disk read, and worst case is either
  // "schema shows a no-op param" (gate flips on mid-session: param ignored
  // by forceAsync) or "schema hides a param that would've worked" (gate
  // flips off mid-session: everything still runs async via memoized
  // forceAsync). No Zod rejection, no crash — unlike required→optional.
  return isBackgroundTasksDisabled || isForkSubagentEnabled() ? schema.omit({
    run_in_background: true
  }) : schema;
});
// ─────────────────────────────────────────────────────────────
// 【为什么要手写一个"比 schema 更宽"的类型】
//
// inputSchema 经过 .omit() 之后，cwd 和 run_in_background 在类型上
// 可能不存在。但 call() 的解构里（第 239-250 行）明明在接这两个字段。
//
// 于是这里手工声明 AgentToolInput = base 类型 + 所有可选字段。
// 注释说得很清楚："Explicit type widens the schema inference to always
// include all optional fields even when .omit() strips them for gating"。
//
// 【这是一种"对外收窄、对内放宽"的双类型策略】
//   对模型（schema）：参数集合随开关变化，最小化认知负担
//   对自己（类型）：永远假定有这些字段，代码不用写 if 分支
//
// 风险是：如果模型真的传了被 omit 掉的参数（不可能，因为它看不见），
// 这里会静默收到 undefined。所以代码里每个可选字段都要能处理 undefined ——
// 实际上它们全都是 `?? 默认值` 或布尔判断，没有一个假设"一定存在"。
type InputSchema = ReturnType<typeof inputSchema>;

// Explicit type widens the schema inference to always include all optional
// fields even when .omit() strips them for gating (cwd, run_in_background).
// subagent_type is optional; call() defaults it to general-purpose when the
// fork gate is off, or routes to the fork path when the gate is on.
type AgentToolInput = z.infer<ReturnType<typeof baseInputSchema>> & {
  name?: string;
  team_name?: string;
  mode?: z.infer<ReturnType<typeof permissionModeSchema>>;
  isolation?: 'worktree' | 'remote';
  cwd?: string;
};

// 输出 schema 是四态的联合：
//   completed       同步跑完（有 content）
//   async_launched  已丢到后台（有 agentId + outputFile）
//   teammate_spawned / remote_launched  内部态，**不在这个 schema 里**
//
// 第 159-190 行专门解释了后两个为什么不进来：
//   "Private type for teammate spawn results - excluded from exported
//    schema for dead code elimination"
//
// 【用类型做什么：控制代码裁剪】
// 这两类状态的字符串（'teammate_spawned' / 'remote_launched'）
// 只在开了对应 feature 时才可能存在。如果它们进了导出 schema，
// 那么 z.literal('teammate_spawned') 这个字符串会永久留在产物里，
// 连带它所在的整个判别分支。
//
// 做法是：内部用一个更宽的类型 InternalOutput（第 191 行），
// 出口处用 as unknown as 强转。这样外部构建里这些字面量
// 只出现在被 feature() 删掉的分支里，打包器能一并清除。
//
// 【这和 claude.ts 里 cache_deleted_input_tokens 不进 NonNullableUsage
//  是同一个手法的另一面】
// 那边是"不进类型 → 字符串被 DCE 删掉"，这边也是。
// 说明这个团队把类型系统当成一个**裁剪工具**在用，不只是检查工具。
// Output schema - multi-agent spawned schema added dynamically at runtime when enabled
export const outputSchema = lazySchema(() => {
  const syncOutputSchema = agentToolResultSchema().extend({
    status: z.literal('completed'),
    prompt: z.string()
  });
  const asyncOutputSchema = z.object({
    status: z.literal('async_launched'),
    agentId: z.string().describe('The ID of the async agent'),
    description: z.string().describe('The description of the task'),
    prompt: z.string().describe('The prompt for the agent'),
    outputFile: z.string().describe('Path to the output file for checking agent progress'),
    canReadOutputFile: z.boolean().optional().describe('Whether the calling agent has Read/Bash tools to check progress')
  });
  return z.union([syncOutputSchema, asyncOutputSchema]);
});
type OutputSchema = ReturnType<typeof outputSchema>;
type Output = z.input<OutputSchema>;

// Private type for teammate spawn results - excluded from exported schema for dead code elimination
// The 'teammate_spawned' status string is only included when ENABLE_AGENT_SWARMS is true
type TeammateSpawnedOutput = {
  status: 'teammate_spawned';
  prompt: string;
  teammate_id: string;
  agent_id: string;
  agent_type?: string;
  model?: string;
  name: string;
  color?: string;
  tmux_session_name: string;
  tmux_window_name: string;
  tmux_pane_id: string;
  team_name?: string;
  is_splitpane?: boolean;
  plan_mode_required?: boolean;
};

// Combined output type including both public and internal types
// Note: TeammateSpawnedOutput type is fine - TypeScript types are erased at compile time
// Private type for remote-launched results — excluded from exported schema
// like TeammateSpawnedOutput for dead code elimination purposes. Exported
// for UI.tsx to do proper discriminated-union narrowing instead of ad-hoc casts.
export type RemoteLaunchedOutput = {
  status: 'remote_launched';
  taskId: string;
  sessionUrl: string;
  description: string;
  prompt: string;
  outputFile: string;
};
type InternalOutput = Output | TeammateSpawnedOutput | RemoteLaunchedOutput;
import type { AgentToolProgress, ShellProgress } from '../../types/tools.js';
// AgentTool forwards both its own progress events and shell progress
// events from the sub-agent so the SDK receives tool_progress updates during bash/powershell runs.
export type Progress = AgentToolProgress | ShellProgress;
// buildTool({...}) 是一个 1,190 行的对象字面量（196-1387）。
// 里面每个方法都是可选的，这个工具实现了其中十几个。分组看：
//
//   元信息    name / aliases / searchHint / description /
//             maxResultSizeChars（100K，比一般工具大得多）
//   输入输出  prompt() / inputSchema / outputSchema
//   执行      call()  ← 主体，1,024 行
//   行为声明  isReadOnly() / isConcurrencySafe() / checkPermissions() /
//             toAutoClassifierInput()
//   UI        userFacingName / render* 系列（来自 UI.tsx）
//
// 【先看三个"行为声明"，它们决定了调度器怎么对待这个工具】
//   1264  isReadOnly()        → true
//   1273  isConcurrencySafe() → true
//   1281  checkPermissions()  → 非 auto 模式直接 allow
//
// 这三行合起来意味着：**一个 Agent 工具可以和别的工具并发执行，
// 而且不需要权限确认**。这看起来极其危险，但成立的理由在 1265 行
// 那半句注释："delegates permission checks to its underlying tools"。
// 也就是：真正的风险由子 agent 内部每一次工具调用各自把关。
// 派 agent 这个动作本身不碰文件、不跑命令，所以它是只读的。
export const AgentTool = buildTool({
  async prompt({
    agents,
    tools,
    getToolPermissionContext,
    allowedAgentTypes
  }) {
    const toolPermissionContext = await getToolPermissionContext();

// 从工具名反推 MCP 服务器名。命名约定是 mcp__<server>__<tool>，
// 所以 split('__')[1] 就是服务器名。
//
// 这个函数看着不起眼，但它是第 217 行那个过滤的前提：
// 有的 agent 定义里写了 requiredMcpServers（比如"我需要 github 服务器"），
// 如果 github 没连上，这个 agent 就不该出现在清单里 ——
// 否则模型会派一个必然失败的任务。
    // Get MCP servers that have tools available
    const mcpServersWithTools: string[] = [];
    for (const tool of tools) {
      if (tool.name?.startsWith('mcp__')) {
        const parts = tool.name.split('__');
        const serverName = parts[1];
        if (serverName && !mcpServersWithTools.includes(serverName)) {
          mcpServersWithTools.push(serverName);
        }
      }
    }

// 两级过滤，顺序重要：
//   ① filterAgentsByMcpRequirements  按"依赖的 MCP 服务器是否就绪"过滤
//   ② filterDeniedAgents             按权限规则过滤（Agent(name) 语法）
//
// 为什么先 MCP 后权限？
// 因为第 347-353 行要靠这个顺序区分两种失败：
//   · agent 存在但被权限拒绝 → 报"被规则拒绝"，附带规则来源
//   · agent 根本不存在       → 报"没这个 agent"，附可用列表
// 如果先滤权限，被拒的 agent 会从列表里消失，"被拒绝"和"不存在"
// 就分不出来了，用户会收到一条误导性的错误。
//
// 【这是一个通用的错误报告原则】
// 先过滤"客观不可用"（依赖缺失），再过滤"主观不允许"（权限），
// 才能对用户说清楚到底为什么不行。
    // Filter agents: first by MCP requirements, then by permission rules
    const agentsWithMcpRequirementsMet = filterAgentsByMcpRequirements(agents, mcpServersWithTools);
    const filteredAgents = filterDeniedAgents(agentsWithMcpRequirementsMet, toolPermissionContext, AGENT_TOOL_NAME);

// 【循环依赖的第二次规避，注释写明了原因】
// "Use inline env check instead of coordinatorModule to avoid circular
//  dependency issues during test module loading."
//
// 注意它说的是**测试期**的模块加载问题。生产环境里 import 可能是通的，
// 但测试框架加载模块的顺序不同，环会以另一种方式爆出来。
//
// 这和 coordinatorMode.ts 第 19-24 行那个"被迫重复"是同一类问题：
//   那边重复了一个两行的布尔判断
//   这边重复了一个三行的布尔表达式
// 共同点：**重复的成本是"两处要保持一致"，而 import 的成本是运行时崩溃**。
// 在这种不对称面前，重复是理性的选择。
    // Use inline env check instead of coordinatorModule to avoid circular
    // dependency issues during test module loading.
    const isCoordinator = feature('COORDINATOR_MODE') ? isEnvTruthy(process.env.CLAUDE_CODE_COORDINATOR_MODE) : false;
    return await getPrompt(filteredAgents, isCoordinator, allowedAgentTypes);
  },
  name: AGENT_TOOL_NAME,
  searchHint: 'delegate work to a subagent',
  aliases: [LEGACY_AGENT_TOOL_NAME],
  maxResultSizeChars: 100_000,
  async description() {
    return 'Launch a new agent';
  },
  get inputSchema(): InputSchema {
    return inputSchema();
  },
  get outputSchema(): OutputSchema {
    return outputSchema();
  },
// ─────────────────────────────────────────────────────────────
// 【call() 的十道关卡 —— 先给你一张清单】
//
// 后面 170 行几乎全是"能不能派"的判定。顺序不能乱，因为
// 后面的判定依赖前面的结果。按出现顺序：
//
//   252  model 参数在协调者模式下被**强制抹掉**
//   257  rootSetAppState 选择（进程内 teammate 的 setAppState 是 no-op）
//   262  team_name 但团队功能未开放 → 报错
//   269  teammate 试图再建团队 → 报错（roster 是扁平的）
//   278  进程内 teammate 试图开后台 → 报错（生命周期绑在 leader 上）
//   284  同时有 teamName 和 name → 走 spawnTeammate 分支（另一套机制）
//   318  fork 路由决策（三级）
//   332  递归 fork 守卫
//   345  agent 类型解析（找不到 / 被拒绝，两种错误分别报）
//   361  agent 定义里 background:true 且是进程内 teammate → 报错
//   371  requiredMcpServers 就绪检查（含最多 30 秒的等待）
//
// 【为什么 262/272/278 这些检查要放在 call() 里而不是 schema 里】
// 因为它们依赖**运行时的身份**（我是 teammate 吗？我在团队里吗？），
// 而 schema 是模块加载期定的。身份不能在 schema 里表达。
// 所以这类限制只能"看到才知道"，也就只能 throw。
//
// 代价是：模型可能踩到这些错误（因为提示词只能尽量告知）。
// 所以 prompt.ts 第 277-283 行才会按身份改口供 —— 两边配合。
  async call({
    prompt,
    subagent_type,
    description,
    model: modelParam,
    run_in_background,
    name,
    team_name,
    mode: spawnMode,
    isolation,
    cwd
  }: AgentToolInput, toolUseContext, canUseTool, assistantMessage, onProgress?) {
    const startTime = Date.now();
// 【一行代码实现的"强制"，比提示词硬得多】
//
// coordinator 模式下 model 直接置 undefined，模型传什么都被丢掉。
//
// 对应 coordinatorMode.ts 提示词里那句 "Do not set the model parameter.
// Workers need the default model for the substantive tasks you delegate."
//
// 【为什么需要两道】
// 提示词是"建议"，模型可以不遵守（尤其在被大量上下文包围时）。
// 而这一行的效果是：即使模型传了 opus，被派活的 worker 还是用默认模型。
//
// 【为什么"用默认模型"这么重要】
// 协调者派的是"实质任务"（写代码、查 bug、验证）。给 worker 降级到
// haiku 会让质量崩塌；升级到 opus 则是浪费钱。而协调者自己判断
// "这个任务值得用强模型"的可靠性很低 —— 它看不到 worker 要面对的
// 实际代码复杂度。所以这里的选择是：**不让它做这个决定**。
//
// 顺带注意：这个抹除**只对 coordinator 生效**。普通模式下模型可以
// 自由指定 model，因为那时没有 agent 定义里的 model 字段做兜底。
    const model = isCoordinatorMode() ? undefined : modelParam;

    // Get app state for permission mode and agent filtering
    const appState = toolUseContext.getAppState();
    const permissionMode = appState.toolPermissionContext.mode;
// 【一个不起眼但关键的差异：用哪个 setAppState】
//
// toolUseContext.setAppState      通常就是根 store 的 setter
// toolUseContext.setAppStateForTasks  专门用于"任务注册/进度/kill"
//
// 对**进程内 teammate** 来说，它的 setAppState 是个 no-op（被刻意换掉的），
// 但 setAppStateForTasks 仍然指向根 store。
//
// 如果这里用错：teammate 派出的子 agent 无法注册到根任务表 →
// 在任务面板里看不见 → 也无法通过 TaskStop 杀掉 → 变成孤儿进程，
// 只能等它自己跑完。而且**不报任何错**。
//
// 所以后面所有涉及任务生命周期的调用（registerAsyncAgent /
// updateAsyncAgentProgress / completeAsyncAgent / killAsyncAgent）
// 传的都是 rootSetAppState，而不是 toolUseContext.setAppState。
    // In-process teammates get a no-op setAppState; setAppStateForTasks
    // reaches the root store so task registration/progress/kill stay visible.
    const rootSetAppState = toolUseContext.setAppStateForTasks ?? toolUseContext.setAppState;

    // Check if user is trying to use agent teams without access
    if (team_name && !isAgentSwarmsEnabled()) {
      throw new Error('Agent Teams is not yet available on your plan.');
    }

// 【teammate 不能建团队 —— 因为团队名册是扁平的】
//
// 第 266-268 行的注释把机制讲清楚了：
//   "TeamFile.members is a flat array with one leadAgentId — nested
//    teammates land in the roster with no provenance and confuse the lead."
//
// 数据结构长这样（概念上）：
//   { leadAgentId: 'xxx', members: [a, b, c, ...] }
// 它是**一层**的。如果一个 teammate 再开一个 teammate，
// 新的成员会被塞进同一个 members 数组 —— 于是：
//   · 它不知道自己是"谁派来的"（没有 parent 字段）
//   · leader 看到名册里多了一个没见过的成员
//   · SendMessage 的拓扑关系彻底乱掉
//
// 【这是"数据结构决定能力边界"的典型案例】
// 不是"不想支持嵌套团队"，而是当前的数据模型表达不了。
// 加一个 parentAgentId 字段就能支持，但那会连带改变：
// 名册渲染、消息路由、kill 的级联规则、任务树的展示……
// 所以选择先限制住，把复杂度留到真正需要时再付。
    // Teammates (in-process or tmux) passing `name` would trigger spawnTeammate()
    // below, but TeamFile.members is a flat array with one leadAgentId — nested
    // teammates land in the roster with no provenance and confuse the lead.
    const teamName = resolveTeamName({
      team_name
    }, appState);
    if (isTeammate() && teamName && name) {
      throw new Error('Teammates cannot spawn other teammates — the team roster is flat. To spawn a subagent instead, omit the `name` parameter.');
    }
// 【进程内 teammate 不能开后台 agent —— 生命周期绑定问题】
//
// 进程内 teammate（InProcessTeammateTask）是**跑在同一个 Node 进程里**的
// 一个异步任务，它没有自己的进程。所以：
//   · 它的"存活"取决于 leader 的进程还活着
//   · 它开的"后台 agent"如果比它活得久，就失去了宿主
//
// 对比 tmux teammate：那是独立进程，能自己管后台 agent（第 276-277 行注释）。
//
// 【这类"能力差异"的根源是部署形态，不是设计喜好】
// 同一个概念（teammate）有两种实现：
//   进程内 —— 便宜、启动快、共享内存，但生命周期绑定、崩溃互相影响
//   tmux   —— 隔离好、能独立存活，但启动慢、需要终端环境
// 于是所有"能不能开后台/能不能再派活"的规则都得按形态分叉。
//
// 第 361 行还有一个更隐蔽的同型检查：agent 定义里有 background: true
// 也算"要开后台"。那一处必须等 selectedAgent 解析出来才能查，
// 所以它不能和这里合并 —— 两处检查看似重复，实际是不同时机。
    // In-process teammates cannot spawn background agents (their lifecycle is
    // tied to the leader's process). Tmux teammates are separate processes and
    // can manage their own background agents.
    if (isInProcessTeammate() && teamName && run_in_background === true) {
      throw new Error('In-process teammates cannot spawn background agents. Use run_in_background=false for synchronous subagents.');
    }

// ─────────────────────────────────────────────────────────────
// 【分岔点：spawnTeammate 还是 runAgent】
//
// 条件是 teamName && name 同时存在。
// 这是 CC 里两套多智能体机制的分界线：
//
//   spawnTeammate（282-316）  → 建一个**长期存在、可反复对话**的团队成员
//                               有 name、有 tmux 面板、走 mailbox 通信
//   runAgent（318 之后）      → 派一个**一次性**的子 agent
//                               干完就退出，结果以 tool_result / 通知返回
//
// 用生活化的类比：
//   前者是"招个员工进团队"，后者是"外包一个活"
//
// 【注意返回值的差别】
// teammate 返回 { status: 'teammate_spawned', teammate_id, tmux_pane_id, ... }
// —— 带终端面板信息，因为它要在界面上占一格
// 子 agent 返回 { status: 'async_launched', agentId, outputFile }
// —— 带输出文件，因为它要通过文件查进度
//
// 两套返回值对应两种"怎么观测它"的方式，这也是它们最本质的区别。
    // Check if this is a multi-agent spawn request
    // Spawn is triggered when team_name is set (from param or context) and name is provided
    if (teamName && name) {
      // Set agent definition color for grouped UI display before spawning
// 派 teammate 之前先把这个 agent 定义的颜色登记下来。
//
// 目的很具体：界面上多个 teammate 同时在跑时，靠颜色区分谁是谁。
// 颜色来自 agent 定义的 color 字段（用户可以在 .claude/agents/*.md
// 的 frontmatter 里写）。
//
// 注意它是在 **spawn 之前** 设的，而不是等 spawn 返回。因为
// spawnTeammate 会立刻开始跑并产生输出，颜色晚设就会有一小段
// 输出用默认颜色渲染，视觉上会闪一下。
      const agentDef = subagent_type ? toolUseContext.options.agentDefinitions.activeAgents.find(a => a.agentType === subagent_type) : undefined;
      if (agentDef?.color) {
        setAgentColor(subagent_type!, agentDef.color);
      }
      const result = await spawnTeammate({
        name,
        prompt,
        description,
        team_name: teamName,
        use_splitpane: true,
        plan_mode_required: spawnMode === 'plan',
        model: model ?? agentDef?.model,
        agent_type: subagent_type,
        invokingRequestId: assistantMessage?.requestId
      }, toolUseContext);

      // Type assertion uses TeammateSpawnedOutput (defined above) instead of any.
      // This type is excluded from the exported outputSchema for dead code elimination.
      // Cast through unknown because TeammateSpawnedOutput is intentionally
      // not part of the exported Output union (for dead code elimination purposes).
      const spawnResult: TeammateSpawnedOutput = {
        status: 'teammate_spawned' as const,
        prompt,
        ...result.data
      };
      return {
        data: spawnResult
      } as unknown as {
        data: Output;
      };
    }

// ─────────────────────────────────────────────────────────────
// 【fork 路由：三行代码，三种语义】
//
//   subagent_type 有值        → 用指定的类型（显式优先）
//   subagent_type 没值 + 门开 → fork（effectiveType = undefined）
//   subagent_type 没值 + 门关 → general-purpose（兜底）
//
// 【注意 "显式优先" 这条】
// 门开着，模型依然可以通过指定 subagent_type 来要一个**全新的** agent
// 而不是 fork。这个设计很重要 —— fork 不是强制的，它只是默认。
// 想拿到"独立意见"时（比如代码评审），必须能要求一个不继承上下文的新 agent。
//
// 这也是 prompt.ts 里第三个例子（141-153）要专门示范的场景：
// "I'll ask the code-reviewer agent — it won't see my analysis,
//  so it can give an independent read."
//
// 【undefined 被用作一个有意义的值】
// 通常 undefined 表示"没有传"。但这里它被赋予了确定语义：
// "走 fork 路径"。代价是代码里到处要写 isForkPath 判断，
// 收益是不用额外造一个 subagent_type: 'fork' 的魔法字符串
// （虽然 FORK_SUBAGENT_TYPE 常量确实存在，但只用于遥测）。
    // Fork subagent experiment routing:
    // - subagent_type set: use it (explicit wins)
    // - subagent_type omitted, gate on: fork path (undefined)
    // - subagent_type omitted, gate off: default general-purpose
    const effectiveType = subagent_type ?? (isForkSubagentEnabled() ? undefined : GENERAL_PURPOSE_AGENT.agentType);
    const isForkPath = effectiveType === undefined;
// ─────────────────────────────────────────────────────────────
// 【递归 fork 守卫 —— 全文件最巧妙的一处判定】
//
// 问题：fork 出来的子 agent，工具池里**仍然有 Agent 工具**。
//
// 为什么不删掉它？
// 因为工具池要字节级一致才能共享 prompt cache（见第 611-616 行注释）。
// 删掉一个工具会让 tools 数组变化 → 缓存前缀作废 → fork 的整个
// 成本优势消失。所以选择"留着工具，但调用时拒绝"。
//
// 【两道判定，主次分明】
//   主：querySource === 'agent:builtin:fork'
//       这个值在 spawn 时写进 context.options，**能扛住自动压缩**
//       （autocompact 会重写 messages，但改不了 options）
//   兜底：isInForkChild(messages) —— 扫历史里有没有 fork 的样板标签
//       只在 querySource 因某条路径没传下来时生效
//
// 【"能扛住压缩"这个性质为什么值钱】
// 这正是前面几个文件反复出现的主题：会话状态在长对话里会被压缩重写。
// 任何"放在 messages 里"的标记都可能在压缩后消失，
// 而任何"放在 options 里"的标记不会。所以关键的身份判定优先用后者。
//
// 【报错信息本身也在教模型】
// "Fork is not available inside a forked worker. Complete your task
//  directly using your tools."
// 不只是说"不行"，还说了"该怎么办"。子 agent 读到这句会转为自己动手，
// 而不是反复重试。
    let selectedAgent: AgentDefinition;
    if (isForkPath) {
      // Recursive fork guard: fork children keep the Agent tool in their
      // pool for cache-identical tool defs, so reject fork attempts at call
      // time. Primary check is querySource (compaction-resistant — set on
      // context.options at spawn time, survives autocompact's message
      // rewrite). Message-scan fallback catches any path where querySource
      // wasn't threaded.
      if (toolUseContext.options.querySource === `agent:builtin:${FORK_AGENT.agentType}` || isInForkChild(toolUseContext.messages)) {
        throw new Error('Fork is not available inside a forked worker. Complete your task directly using your tools.');
      }
      selectedAgent = FORK_AGENT;
// 非 fork 路径：解析 agent 类型。三次查找：
//   ① 在过滤后的列表里找（可能的子集：allowedAgentTypes + 权限过滤）
//   ② 找不到 → 在**全集**里找一遍，判断是不是"存在但被拒"
//   ③ 都不在 → 报"没有这个类型"，附可用列表
//
// 【第 ② 步这个"回去再找一遍"是必要的】
// 因为过滤后的列表已经丢失了"为什么不在"的信息。
// 不回去查的话，用户配了一条 Agent(code-reviewer) 的 deny 规则，
// 得到的是"Agent type 'code-reviewer' not found. Available agents: ..."
// —— 他会去检查目录、检查拼写，而真正的原因在权限配置里。
//
// 加上第 ② 步，错误变成：
//   "Agent type 'code-reviewer' has been denied by permission rule
//    'Agent(code-reviewer)' from <来源>."
// 直接指到规则和它的出处（哪个 settings 文件）。
//
// 【这是一个"错误消息质量"的投入点】
// 这类代码不影响正确性，只影响排障时间。CC 里这类投入相当多
// （比如 mcp/client.ts 里那条 15 分钟 needs-auth 缓存的提示）。
    } else {
      // Filter agents to exclude those denied via Agent(AgentName) syntax
      const allAgents = toolUseContext.options.agentDefinitions.activeAgents;
      const {
        allowedAgentTypes
      } = toolUseContext.options.agentDefinitions;
      const agents = filterDeniedAgents(
      // When allowedAgentTypes is set (from Agent(x,y) tool spec), restrict to those types
      allowedAgentTypes ? allAgents.filter(a => allowedAgentTypes.includes(a.agentType)) : allAgents, appState.toolPermissionContext, AGENT_TOOL_NAME);
      const found = agents.find(agent => agent.agentType === effectiveType);
      if (!found) {
        // Check if the agent exists but is denied by permission rules
        const agentExistsButDenied = allAgents.find(agent => agent.agentType === effectiveType);
        if (agentExistsButDenied) {
          const denyRule = getDenyRuleForAgent(appState.toolPermissionContext, AGENT_TOOL_NAME, effectiveType);
          throw new Error(`Agent type '${effectiveType}' has been denied by permission rule '${AGENT_TOOL_NAME}(${effectiveType})' from ${denyRule?.source ?? 'settings'}.`);
        }
        throw new Error(`Agent type '${effectiveType}' not found. Available agents: ${agents.map(a => a.agentType).join(', ')}`);
      }
      selectedAgent = found;
    }

    // Same lifecycle constraint as the run_in_background guard above, but for
    // agent definitions that force background via `background: true`. Checked
    // here because selectedAgent is only now resolved.
    if (isInProcessTeammate() && teamName && selectedAgent.background === true) {
      throw new Error(`In-process teammates cannot spawn background agents. Agent '${selectedAgent.agentType}' has background: true in its definition.`);
    }

// let selectedAgent 的副作用：TypeScript 无法跨 if-else 收窄属性类型。
// 所以先把必需字段摘出来存成 const，后面用起来才有类型。
//
// 这是个纯粹的编译器妥协 —— 逻辑上 selectedAgent 到这里必然已赋值，
// 但控制流分析做不到。
    // Capture for type narrowing — `let selectedAgent` prevents TS from
    // narrowing property types across the if-else assignment above.
    const requiredMcpServers = selectedAgent.requiredMcpServers;

    // Check if required MCP servers have tools available
    // A server that's connected but not authenticated won't have any tools
// ─────────────────────────────────────────────────────────────
// 【MCP 依赖检查：一个"等 30 秒"的轮询，以及它的早退条件】
//
// agent 定义可以写 requiredMcpServers。检查时有个竞态：
// MCP 服务器是**异步连接**的，模型可能在一个服务器还在 connecting
// 的时候就想派活。直接判失败会误伤（明明 2 秒后就绪了）。
//
// 所以先等：最多 30 秒，每 500ms 查一次。但等待里有个早退条件
// （第 385-388 行）：
//   "if any required server has already failed, no point waiting for
//    other pending servers — the check will fail regardless."
//
// 【这个早退逻辑的价值】
// 假设 agent 依赖三个服务器：两个已经就绪、一个已失败、一个还在连。
// 不早退的话要白等 30 秒，然后报失败。早退后立刻报失败。
// 在"用户已经等了一会儿、界面在转圈"的场景里，30 秒是很长的。
//
// 【第 394 行的注释点破了一个容易搞混的判断】
// "Get servers that actually have tools (meaning they're connected AND
//  authenticated)"
// 也就是：**连上 ≠ 可用**。一个未认证的服务器连接是通的，
// 但 tools 列表是空的。所以判据不能是 "type === 'connected'"，
// 只能是"它的工具出现在 mcp.tools 里了吗"。
//
// 这和 mcp/client.ts 里那条规则呼应：401 不抛异常，而是变成
// needs-auth 状态并塞一个 createMcpAuthTool —— 那种服务器就是
// "连上了但没工具"的典型。
    if (requiredMcpServers?.length) {
      // If any required servers are still pending (connecting), wait for them
      // before checking tool availability. This avoids a race condition where
      // the agent is invoked before MCP servers finish connecting.
      const hasPendingRequiredServers = appState.mcp.clients.some(c => c.type === 'pending' && requiredMcpServers.some(pattern => c.name.toLowerCase().includes(pattern.toLowerCase())));
      let currentAppState = appState;
      if (hasPendingRequiredServers) {
        const MAX_WAIT_MS = 30_000;
        const POLL_INTERVAL_MS = 500;
        const deadline = Date.now() + MAX_WAIT_MS;
        while (Date.now() < deadline) {
          await sleep(POLL_INTERVAL_MS);
          currentAppState = toolUseContext.getAppState();

          // Early exit: if any required server has already failed, no point
          // waiting for other pending servers — the check will fail regardless.
          const hasFailedRequiredServer = currentAppState.mcp.clients.some(c => c.type === 'failed' && requiredMcpServers.some(pattern => c.name.toLowerCase().includes(pattern.toLowerCase())));
          if (hasFailedRequiredServer) break;
          const stillPending = currentAppState.mcp.clients.some(c => c.type === 'pending' && requiredMcpServers.some(pattern => c.name.toLowerCase().includes(pattern.toLowerCase())));
          if (!stillPending) break;
        }
      }

      // Get servers that actually have tools (meaning they're connected AND authenticated)
      const serversWithTools: string[] = [];
      for (const tool of currentAppState.mcp.tools) {
        if (tool.name?.startsWith('mcp__')) {
          // Extract server name from tool name (format: mcp__serverName__toolName)
          const parts = tool.name.split('__');
          const serverName = parts[1];
          if (serverName && !serversWithTools.includes(serverName)) {
            serversWithTools.push(serverName);
          }
        }
      }
      if (!hasRequiredMcpServers(selectedAgent, serversWithTools)) {
        const missing = requiredMcpServers.filter(pattern => !serversWithTools.some(server => server.toLowerCase().includes(pattern.toLowerCase())));
        throw new Error(`Agent '${selectedAgent.agentType}' requires MCP servers matching: ${missing.join(', ')}. ` + `MCP servers with tools: ${serversWithTools.length > 0 ? serversWithTools.join(', ') : 'none'}. ` + `Use /mcp to configure and authenticate the required MCP servers.`);
      }
    }

// 登记 agent 颜色。和上面 teammate 分支的 setAgentColor 是同一件事，
// 区别是这里用的是 agent 定义里的 color，而 teammate 那边多了一步
// "从 subagent_type 反查定义"。
    // Initialize the color for this agent if it has a predefined one
    if (selectedAgent.color) {
      setAgentColor(selectedAgent.agentType, selectedAgent.color);
    }

// 解析出最终模型，然后打点。注意 resolvedAgentModel 用的是**和 runAgent
// 内部同一套**解析逻辑（getAgentModel），而不是简单取 model 参数。
//
// 为什么遥测要和运行逻辑用同一个函数？
// 因为如果遥测自己算一遍，两处一旦不一致，你会看到"日志说用的 opus，
// 实际跑的是 sonnet"—— 这种数据比没有数据更糟，它会让你得出错误结论。
//
// 【is_resume: false 是硬编码的】
// 这个字段是为 resumeAgent.ts 准备的：那边同样是这个工具的入口，
// 但走的是恢复已有 agent 的路径。同一份遥测 schema 两处填，
// 靠这个字段区分。
    // Resolve agent params for logging (these are already resolved in runAgent)
    const resolvedAgentModel = getAgentModel(selectedAgent.model, toolUseContext.options.mainLoopModel, isForkPath ? undefined : model, permissionMode);
    logEvent('tengu_agent_tool_selected', {
      agent_type: selectedAgent.agentType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      model: resolvedAgentModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      source: selectedAgent.source as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      color: selectedAgent.color as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      is_built_in_agent: isBuiltInAgent(selectedAgent),
      is_resume: false,
      is_async: (run_in_background === true || selectedAgent.background === true) && !isBackgroundTasksDisabled,
      is_fork: isForkPath
    });

// 隔离模式：参数优先，其次 agent 定义。
//
// worktree  = 建一个临时 git worktree，agent 在独立副本里改文件
// remote    = 丢到远程 CCR 环境跑（仅内部构建）
//
// 【worktree 隔离解决的是一个真实冲突】
// 主线程和子 agent 同时改同一个文件 → 谁后写谁赢，且不会报错。
// 有了 worktree，子 agent 在独立目录里改、独立分支上提交，
// 主线程完全不受影响，最后由人决定要不要合并。
//
// 第 643-685 行的清理逻辑对应一句话：
//   **没改动就自动删，有改动就保留并告知路径**。
// 因为"没改动"说明这次隔离白做了（没人需要那些文件），
// 而"有改动"说明它是工作成果，不能删。
    // Resolve effective isolation mode (explicit param overrides agent def)
    const effectiveIsolation = isolation ?? selectedAgent.isolation;

// 远程隔离整块包在 "external" === 'ant' 的条件里。
//
// 这是一个**编译期恒假**的条件（外部构建里 'external' 不等于 'ant'），
// 所以整个块会被彻底删掉 —— 连 teleportToRemote 的 import 一起。
//
// 【为什么写成 "external" === 'ant' 而不是 feature('X')】
// 因为这是"构建目标"而不是"功能开关"。构建目标在打包时就是个字面量，
// 不需要 feature() 那套运行时的东西。写成恒假比较的好处是：
//   · 类型检查仍然会跑这段代码（能在内部构建里发现类型错误）
//   · 打包器能确定地删掉（因为是字面量比较，不是函数调用）
//
// 代价是可读性差 —— 第一次看到 "external" === 'ant' 会愣一下。
// CC 里到处用这个写法（claude.ts、prompts.ts、AgentTool 都有），
// 认出来之后就是一回事：**"这段只在内部构建里存在"**。
    // Remote isolation: delegate to CCR. Gated ant-only — the guard enables
    // dead code elimination of the entire block for external builds.
    if ("external" === 'ant' && effectiveIsolation === 'remote') {
      const eligibility = await checkRemoteAgentEligibility();
      if (!eligibility.eligible) {
        const reasons = eligibility.errors.map(formatPreconditionError).join('\n');
        throw new Error(`Cannot launch remote agent:\n${reasons}`);
      }
      let bundleFailHint: string | undefined;
      const session = await teleportToRemote({
        initialMessage: prompt,
        description,
        signal: toolUseContext.abortController.signal,
        onBundleFail: msg => {
          bundleFailHint = msg;
        }
      });
      if (!session) {
        throw new Error(bundleFailHint ?? 'Failed to create remote session');
      }
      const {
        taskId,
        sessionId
      } = registerRemoteAgentTask({
        remoteTaskType: 'remote-agent',
        session: {
          id: session.id,
          title: session.title || description
        },
        command: prompt,
        context: toolUseContext,
        toolUseId: toolUseContext.toolUseId
      });
      logEvent('tengu_agent_tool_remote_launched', {
        agent_type: selectedAgent.agentType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
      const remoteResult: RemoteLaunchedOutput = {
        status: 'remote_launched',
        taskId,
        sessionUrl: getRemoteTaskSessionUrl(sessionId),
        description,
        prompt,
        outputFile: getTaskOutputPath(taskId)
      };
      return {
        data: remoteResult
      } as unknown as {
        data: Output;
      };
    }
// ─────────────────────────────────────────────────────────────
// 【系统提示词的两条路：fork 继承，普通自建】
//
//   普通路径（513-541）
//     用 selectedAgent.getSystemPrompt() 生成这个 agent **自己的**提示词，
//     再加环境细节（enhanceSystemPromptWithEnvDetails）。
//     最后发出去的消息是 [user(prompt)] —— 一条干净的用户消息。
//
//   fork 路径（495-512）
//     systemPrompt 用**父进程的**（不是 FORK_AGENT 的）。
//     messages 用 buildForkedMessages() 造：克隆父的完整 assistant 消息
//     + 一堆占位 tool_result + 一句自己的指令。
//
// 【fork 路径最反直觉的地方：子 agent 不换系统提示词】
// 常识上"换个角色就该换提示词"，但 fork 刻意不换。理由只有一个：
// **系统提示词在请求的最前面，换一个字，后面全部缓存作废**。
// fork 的全部价值就是"共享父的缓存"，换提示词等于把这个价值清零。
//
// 代价是子 agent 的系统提示词里写着"你应该 fork 子 agent"，
// 而它自己就是子 agent。这个矛盾没法靠改提示词解决（改了就 bust），
// 只能在**用户消息里**用一段大写的话强行覆盖 ——
// 见 forkSubagent.ts 第 173 行的 "STOP. READ THIS FIRST."。
//
// 【第 496-511 行的两条路说明了一件事】
// 优先用 toolUseContext.renderedSystemPrompt（父进程**已经渲染好**的字符串），
// 只有在它不存在时才重算。注释解释了为什么：
//   "Recomputing may diverge from parent's cached bytes if GrowthBook state
//    changed between parent turn-start and fork spawn."
// 也就是：重算可能得到不一样的字节（GrowthBook 从冷变热），
// 那就不是"同一份提示词"了，缓存照样 bust。所以宁可传字节，不要传"配方"。
//
// 【这条经验很通用】
// 任何"必须字节一致"的东西，都应该传递**渲染结果**而不是**渲染参数**。
// 因为参数的求值时机一旦不同，结果就可能不同。
    // System prompt + prompt messages: branch on fork path.
    //
    // Fork path: child inherits the PARENT's system prompt (not FORK_AGENT's)
    // for cache-identical API request prefixes. Prompt messages are built via
    // buildForkedMessages() which clones the parent's full assistant message
    // (all tool_use blocks) + placeholder tool_results + per-child directive.
    //
    // Normal path: build the selected agent's own system prompt with env
    // details, and use a simple user message for the prompt.
    let enhancedSystemPrompt: string[] | undefined;
    let forkParentSystemPrompt: ReturnType<typeof buildEffectiveSystemPrompt> | undefined;
    let promptMessages: MessageType[];
    if (isForkPath) {
      if (toolUseContext.renderedSystemPrompt) {
        forkParentSystemPrompt = toolUseContext.renderedSystemPrompt;
      } else {
        // Fallback: recompute. May diverge from parent's cached bytes if
        // GrowthBook state changed between parent turn-start and fork spawn.
        const mainThreadAgentDefinition = appState.agent ? appState.agentDefinitions.activeAgents.find(a => a.agentType === appState.agent) : undefined;
        const additionalWorkingDirectories = Array.from(appState.toolPermissionContext.additionalWorkingDirectories.keys());
        const defaultSystemPrompt = await getSystemPrompt(toolUseContext.options.tools, toolUseContext.options.mainLoopModel, additionalWorkingDirectories, toolUseContext.options.mcpClients);
        forkParentSystemPrompt = buildEffectiveSystemPrompt({
          mainThreadAgentDefinition,
          toolUseContext,
          customSystemPrompt: toolUseContext.options.customSystemPrompt,
          defaultSystemPrompt,
          appendSystemPrompt: toolUseContext.options.appendSystemPrompt
        });
      }
      promptMessages = buildForkedMessages(prompt, assistantMessage);
// 普通路径的系统提示词构建。
//
// 注意 try-catch 只打了 debug 日志、**没有中断执行**（第 535-537 行）。
// 于是 enhancedSystemPrompt 可能是 undefined，后面的 override 会传
// undefined，runAgent 会自己再构建一次。
//
// 【为什么吞掉这个错误】
// 生成系统提示词失败（比如某个 agent 定义的 getSystemPrompt 抛了）
// 不该让整个派活操作失败 —— 子 agent 用一个降级的默认提示词
// 仍然能干活。这类"降级优于失败"的判断在 AgentTool 里反复出现
// （第 1223-1234 行的部分结果返回也是同一思路）。
    } else {
      try {
        const additionalWorkingDirectories = Array.from(appState.toolPermissionContext.additionalWorkingDirectories.keys());

        // All agents have getSystemPrompt - pass toolUseContext to all
        const agentPrompt = selectedAgent.getSystemPrompt({
          toolUseContext
        });

        // Log agent memory loaded event for subagents
        if (selectedAgent.memory) {
          logEvent('tengu_agent_memory_loaded', {
            ...("external" === 'ant' && {
              agent_type: selectedAgent.agentType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
            }),
            scope: selectedAgent.memory as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            source: 'subagent' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
          });
        }

        // Apply environment details enhancement
        enhancedSystemPrompt = await enhanceSystemPromptWithEnvDetails([agentPrompt], resolvedAgentModel, additionalWorkingDirectories);
      } catch (error) {
        logForDebugging(`Failed to get system prompt for agent ${selectedAgent.agentType}: ${errorMessage(error)}`);
      }
      promptMessages = [createUserMessage({
        content: prompt
      })];
    }
// metadata 是个"跨函数传递的上下文包"，会被带进：
//   runAgent（决定行为）
//   finalizeAgentTool（组装最终结果）
//   各处 logEvent（遥测）
//   后台转正时的通知（第 978 行）
//
// 【isAsync 的表达式值得记下来】
//   (run_in_background === true || selectedAgent.background === true)
//   && !isBackgroundTasksDisabled
// 两个来源 OR，一个总开关 AND。这个形状在第 548、567 行各出现一次
// （567 还多了三个来源）。三处必须一致，否则会出现
// "metadata 说是异步，但实际同步跑了"这类数据污染。
    const metadata = {
      prompt,
      resolvedAgentModel,
      isBuiltInAgent: isBuiltInAgent(selectedAgent),
      startTime,
      agentType: selectedAgent.agentType,
      isAsync: (run_in_background === true || selectedAgent.background === true) && !isBackgroundTasksDisabled
    };

// 第三次出现同样的内联环境检查（第 223 行、这里，还有后面）。
//
// 【重复三次不抽函数，是有意的】
// 抽成一个 isCoordinator() 会引入 coordinatorModule 的 import，
// 而那个 import 会带进循环依赖。三次重复的代价是"改的时候要改三处"，
// 抽函数的代价是"模块加载可能崩"。
//
// 实际上这三处写的表达式完全一致（连 feature() 的判断都一样），
// 复制粘贴带来的风险被压到很低。
    // Use inline env check instead of coordinatorModule to avoid circular
    // dependency issues during test module loading.
    const isCoordinator = feature('COORDINATOR_MODE') ? isEnvTruthy(process.env.CLAUDE_CODE_COORDINATOR_MODE) : false;

// ─────────────────────────────────────────────────────────────
// 【forceAsync：fork 模式下**所有** spawn 都异步，不只是 fork】
//
// 为什么？为了交互模型统一。
// 如果一部分 spawn 同步（阻塞主线程等结果）、一部分异步（发通知），
// 模型需要掌握两套节奏：
//   同步 → 结果直接在 tool_result 里，可以立刻接着做
//   异步 → 结果晚点到，必须"说完就走"
// 两套混在一起时，模型会在该走的时候等、该等的时候瞎编。
//
// 统一成异步之后，提示词可以把"派完活就结束这一轮"教成唯一节奏。
// 这就是 prompt.ts 里那三个示例（尤其是"用户中途追问"那个）
// 存在的意义 —— 教一套节奏，比教两套省很多事。
//
// 【代价也很明确】
// 明明 3 秒就能返回的查询，现在也要等一个通知轮次。所以这个门
// 只对 fork 实验开，且与 coordinator 模式互斥（coordinator 有自己的节奏）。
    // Fork subagent experiment: force ALL spawns async for a unified
    // <task-notification> interaction model (not just fork spawns — all of them).
    const forceAsync = isForkSubagentEnabled();

// 【assistant 模式（KAIROS）的强制异步，理由完全不同】
//
// 原注释（第 559-565 行）：
//   "Synchronous subagents hold the main loop's turn open until they
//    complete — the daemon's inputQueue backs up, and the first overdue
//    cron catch-up on spawn becomes N serial subagent turns blocking
//    all user input."
//
// 拆开这个因果链：
//   ① assistant 模式是个常驻 daemon，用户随时可能发消息（进 inputQueue）
//   ② 同步子 agent 会占住主循环的一整个 turn
//   ③ 如果一个 cron 任务错过了几次，启动时要"补跑"
//   ④ 补跑时派出的子 agent 是**串行**的（因为每个都同步）
//   ⑤ 结果：用户发消息后要等 N 个子 agent 全部跑完才被处理
//
// 这不是"慢一点"，是**界面完全无响应**。所以这里必须强制异步。
//
// 【和第 555 行的区别】
// 555 是为了**统一交互模型**（教一套节奏）
// 559 是为了**避免输入饥饿**（不改就卡死）
// 同一个开关（forceAsync），两个完全不同的动机。
    // Assistant mode: force all agents async. Synchronous subagents hold the
    // main loop's turn open until they complete — the daemon's inputQueue
    // backs up, and the first overdue cron catch-up on spawn becomes N
    // serial subagent turns blocking all user input. Same gate as
    // executeForkedSlashCommand's fire-and-forget path; the
    // <task-notification> re-entry there is handled by the else branch
    // below (registerAsyncAgentTask + notifyOnCompletion).
    const assistantForceAsync = feature('KAIROS') ? appState.kairosEnabled : false;
    const shouldRunAsync = (run_in_background === true || selectedAgent.background === true || isCoordinator || forceAsync || assistantForceAsync || (proactiveModule?.isProactiveActive() ?? false)) && !isBackgroundTasksDisabled;
// ─────────────────────────────────────────────────────────────
// 【worker 的工具池是**独立组装**的，不受父进程限制】
//
// 关键点：worker 用自己的权限模式（selectedAgent.permissionMode，
// 默认 'acceptEdits'）重新跑一遍 assembleToolPool，而不是继承父进程的
// 工具数组。
//
// 【为什么这样是对的】
// 父进程可能处在一个很窄的权限模式里（比如 plan 模式，只能读）。
// 如果 worker 继承这个工具池，那它什么也干不了 —— 派活就失去意义了。
// 每个 agent 定义里写了自己的 permissionMode，应该按它自己的来。
//
// 【第 571-572 行还解释了一个架构妥协】
// "This is computed here so that runAgent doesn't need to import from
//  tools.ts (which would create a circular dependency)."
// 又是循环依赖 —— 这个文件里已经第三次见到了。
// runAgent → tools.ts → tools/AgentTool → runAgent 就成环了。
// 所以把组装动作放在 AgentTool 里，runAgent 只接收现成的数组。
//
// 【注意 fork 路径是例外】
// 第 627 行：fork 用 toolUseContext.options.tools（父的原始数组），
// 不用这个 workerTools。原因见 611-616 行 —— workerTools 是按
// 'bubble' 模式组的，序列化结果和父不同，缓存会在第一个不同的工具处断掉。
    // Assemble the worker's tool pool independently of the parent's.
    // Workers always get their tools from assembleToolPool with their own
    // permission mode, so they aren't affected by the parent's tool
    // restrictions. This is computed here so that runAgent doesn't need to
    // import from tools.ts (which would create a circular dependency).
    const workerPermissionContext = {
      ...appState.toolPermissionContext,
      mode: selectedAgent.permissionMode ?? 'acceptEdits'
    };
    const workerTools = assembleToolPool(workerPermissionContext, appState.mcp.tools);

// earlyAgentId 在一个很靠前的位置就生成，用途是给 worktree 起 slug
// （agent-<前8位>）。这也是为什么它叫 "early" —— 后面还有正式的
// syncAgentId / asyncAgentId，但那两个要等分支确定。
//
// 【worktree slug 用 agentId 前缀的理由】
// 多个 agent 同时开 worktree 时，slug 必须唯一。用 UUID 前 8 位既短
// 又几乎不冲突，而且**可追溯** —— 看到目录名就知道是哪个 agent 的。
    // Create a stable agent ID early so it can be used for worktree slug
    const earlyAgentId = createAgentId();

    // Set up worktree isolation if requested
    let worktreeInfo: {
      worktreePath: string;
      worktreeBranch?: string;
      headCommit?: string;
      gitRoot?: string;
      hookBased?: boolean;
    } | null = null;
    if (effectiveIsolation === 'worktree') {
      const slug = `agent-${earlyAgentId.slice(0, 8)}`;
      worktreeInfo = await createAgentWorktree(slug);
    }

// fork + worktree 的组合有个独特问题：子 agent 继承的上下文里
// 全是**父进程的路径**，但它实际工作在另一个目录。
//
// 所以追加一条 notice（buildWorktreeNotice）：告诉它路径要翻译、
// 文件可能已经过时（父可能改过）、改动只留在 worktree 里。
//
// 【注意 push 的位置很讲究】
// 它被 append 到 promptMessages **最后**，注释说
// "so it appears as the most recent guidance the child sees"。
// 模型对越靠后的指令服从度越高（尤其是和前面内容冲突时）。
// 所以"最需要注意的纠正"要放最后。
//
// 这和 forkSubagent.ts 里那段 "STOP. READ THIS FIRST." 的处理是
// 同一个原理的两种用法：一个放在消息最开头（抢注意力），
// 一个放在消息最末尾（做最后纠正）。
    // Fork + worktree: inject a notice telling the child to translate paths
    // and re-read potentially stale files. Appended after the fork directive
    // so it appears as the most recent guidance the child sees.
    if (isForkPath && worktreeInfo) {
      promptMessages.push(createUserMessage({
        content: buildWorktreeNotice(getCwd(), worktreeInfo.worktreePath)
      }));
    }
// ─────────────────────────────────────────────────────────────
// 【runAgentParams：传什么、为什么这么传】
//
// 这是 call() 里最需要精读的一段，因为每个字段都有明确的取舍。
//
//   agentDefinition   选定的定义（fork 时是 FORK_AGENT 这个合成定义）
//   promptMessages    fork = 父的完整历史 + 指令；普通 = 一条用户消息
//   isAsync           shouldRunAsync（上面那个五来源 OR）
//   querySource       传给子 agent 的身份标记，**递归 fork 守卫靠它**
//   model             fork 时不传（继承）；普通时传模型解析结果
//   override          fork = 父的系统提示词；普通 = 刚构建的那个
//   availableTools    fork = 父的原始工具数组；普通 = workerTools
//   forkContextMessages  fork 时传父的完整消息（第 630 行）
//   useExactTools     fork 专用（第 632 行）
//   worktreePath      有些情况要绕开 override 让 runAgent 自己建提示词
//
// 【第 618-626 行那个三选一需要单独解释】
//   isForkPath                          → 用父的提示词
//   enhancedSystemPrompt && !worktree && !cwd  → 用刚构建的
//   其他                                → 传 undefined，让 runAgent 自己建
//
// 第三种情况的理由是：有 cwd 覆盖时，系统提示词里的**工作目录信息
// 会变**（要写 worktree 的路径而不是原来的）。而这里构建的
// enhancedSystemPrompt 是在**切 cwd 之前**算的，里面的路径是错的。
// 所以宁可不给，让 runAgent 在 runWithCwdOverride 内部重新构建 ——
// 那时 getCwd() 返回的已经是新路径了。
    const runAgentParams: Parameters<typeof runAgent>[0] = {
      agentDefinition: selectedAgent,
      promptMessages,
      toolUseContext,
      canUseTool,
      isAsync: shouldRunAsync,
      querySource: toolUseContext.options.querySource ?? getQuerySourceForAgent(selectedAgent.agentType, isBuiltInAgent(selectedAgent)),
      model: isForkPath ? undefined : model,
      // Fork path: pass parent's system prompt AND parent's exact tool
      // array (cache-identical prefix). workerTools is rebuilt under
      // permissionMode 'bubble' which differs from the parent's mode, so
      // its tool-def serialization diverges and breaks cache at the first
      // differing tool. useExactTools also inherits the parent's
      // thinkingConfig and isNonInteractiveSession (see runAgent.ts).
      //
      // Normal path: when a cwd override is in effect (worktree isolation
      // or explicit cwd), skip the pre-built system prompt so runAgent's
      // buildAgentSystemPrompt() runs inside wrapWithCwd where getCwd()
      // returns the override path.
      override: isForkPath ? {
        systemPrompt: forkParentSystemPrompt
      } : enhancedSystemPrompt && !worktreeInfo && !cwd ? {
        systemPrompt: asSystemPrompt(enhancedSystemPrompt)
      } : undefined,
      availableTools: isForkPath ? toolUseContext.options.tools : workerTools,
      // Pass parent conversation when the fork-subagent path needs full
      // context. useExactTools inherits thinkingConfig (runAgent.ts:624).
      forkContextMessages: isForkPath ? toolUseContext.messages : undefined,
      ...(isForkPath && {
        useExactTools: true
      }),
      worktreePath: worktreeInfo?.worktreePath,
      description
    };

// 两个辅助闭包，把"要不要切 cwd"和"要不要清 worktree"包起来，
// 让后面 async / sync 两条路径都能复用。
//
// cwdOverridePath 的优先级：显式 cwd 参数 > worktree 路径。
// 因为显式传 cwd 意味着调用方有更具体的意图（KAIROS 模式下会传）。
    // Helper to wrap execution with a cwd override: explicit cwd arg (KAIROS)
    // takes precedence over worktree isolation path.
    const cwdOverridePath = cwd ?? worktreeInfo?.worktreePath;
    const wrapWithCwd = <T,>(fn: () => T): T => cwdOverridePath ? runWithCwdOverride(cwdOverridePath, fn) : fn();

// ─────────────────────────────────────────────────────────────
// 【worktree 清理的三个分支，每个都防一种"删错"】
//
//   ① hookBased    → 永远保留
//      因为这种 worktree 不是标准 git worktree，无法检测 VCS 变化。
//      "不知道有没有改动"时选择保留 —— 宁可留垃圾，不可删成果。
//
//   ② 无改动       → 删掉，并且清掉 metadata 里的 worktreePath
//      不清 metadata 的话，下次 resume 会指向一个已删除的目录，
//      agent 一启动就报 ENOENT，而且原因很难查。
//
//   ③ 有改动       → 保留，把路径和分支名返回上去
//      返回值会被塞进最终结果的 worktreePath / worktreeBranch 字段，
//      模型和用户都能看到"东西在哪儿"。
//
// 【第 656-658 行那个 worktreeInfo = null 是幂等保护】
// 注释写得很直白："Null out to make idempotent — guards against
// double-call if code between cleanup and end of try throws into catch"
//
// 场景：try 块里先调了一次 cleanup（返回"已删除"），然后后面某行
// 抛异常进 catch，catch 里又调一次 cleanup。第二次会拿到 null，
// 直接返回 {} —— 不会去删一个已经删过的目录（那会报错，
// 而且错误会掩盖真正的异常）。
    // Helper to clean up worktree after agent completes
    const cleanupWorktreeIfNeeded = async (): Promise<{
      worktreePath?: string;
      worktreeBranch?: string;
    }> => {
      if (!worktreeInfo) return {};
      const {
        worktreePath,
        worktreeBranch,
        headCommit,
        gitRoot,
        hookBased
      } = worktreeInfo;
      // Null out to make idempotent — guards against double-call if code
      // between cleanup and end of try throws into catch
      worktreeInfo = null;
      if (hookBased) {
        // Hook-based worktrees are always kept since we can't detect VCS changes
        logForDebugging(`Hook-based agent worktree kept at: ${worktreePath}`);
        return {
          worktreePath
        };
      }
      if (headCommit) {
        const changed = await hasWorktreeChanges(worktreePath, headCommit);
        if (!changed) {
          await removeAgentWorktree(worktreePath, worktreeBranch, gitRoot);
          // Clear worktreePath from metadata so resume doesn't try to use
          // a deleted directory. Fire-and-forget to match runAgent's
          // writeAgentMetadata handling.
          void writeAgentMetadata(asAgentId(earlyAgentId), {
            agentType: selectedAgent.agentType,
            description
          }).catch(_err => logForDebugging(`Failed to clear worktree metadata: ${_err}`));
          return {};
        }
      }
      logForDebugging(`Agent worktree has changes, keeping: ${worktreePath}`);
      return {
        worktreePath,
        worktreeBranch
      };
    };
// ============================================================
// 【从这里开始分两条执行路径，一直到 1262 行】
//
// 建议的读法：**先读完 async 分支（686-764，只有 78 行），再读 sync。**
// async 是"简单情况"，sync 是这个文件全部复杂度的来源。
//
//   async（686-764）
//     注册任务 → void 启动 → 立刻返回 async_launched。78 行搞定。
//
//   sync（765-1262）
//     前台跑，但**随时可以转后台**。所以它必须：
//       · 维护一个 race（下一条消息 vs 转后台信号）
//       · 转后台时把前台迭代器优雅关闭（释放 MCP 连接等）
//       · 用同一个 taskId 在后台继续，且进度不丢
//       · 处理"既没转后台也没跑完"的各种中止情况
//     500 行的复杂度，全部来自"随时可转后台"这一个需求。
//
// 【一个设计判断值得注意】
// 为什么不干脆"所有 agent 都异步"，省掉这 500 行？
// 因为同步有真实的交互价值：模型派一个查文件的 agent，3 秒后
// 拿到结果就能接着干。改成异步的话要多等一个通知轮次（模型说完
// "我去查"→ 结束轮次 → 通知到达 → 新轮次继续），用户看到的是
// 界面停一下。对短任务，这个停顿比等待更烦。
// ═══════════════════════════════════════════════════════════
    if (shouldRunAsync) {
      const asyncAgentId = earlyAgentId;
// 注册异步任务。注意三个细节：
//
// ① setAppState 用的是 rootSetAppState（第 693 行），不是
//    toolUseContext.setAppState —— 理由见第 257 行的批注。
//
// ② 第 694-696 行的注释解释了一个关键决策：
//    "Don't link to parent's abort controller -- background agents
//     should survive when the user presses ESC to cancel the main thread.
//     They are killed explicitly via chat:killAgents."
//    （不链接父的 abort controller —— 后台 agent 应该在用户按 Esc
//      取消主线程时**存活**。它们只能被显式的 kill 命令杀掉。）
//
//    这决定了 Esc 的语义：前台任务被取消，后台任务继续。
//    如果反过来（Esc 杀掉一切），用户想清屏时就会丢掉正在跑的长任务。
//
// ③ registerAsyncAgent 返回的 abortController 是**这个任务自己的**，
//    后面 runAgent 的 override 里传的就是它（第 741 行）。
      const agentBackgroundTask = registerAsyncAgent({
        agentId: asyncAgentId,
        description,
        prompt,
        selectedAgent,
        setAppState: rootSetAppState,
        // Don't link to parent's abort controller -- background agents should
        // survive when the user presses ESC to cancel the main thread.
        // They are killed explicitly via chat:killAgents.
        toolUseId: toolUseContext.toolUseId
      });

// name → agentId 的注册表，供 SendMessage({to: name}) 路由。
//
// 【位置很讲究：在 registerAsyncAgent 之后】
// 注释写了 "Post-registerAsyncAgent so we don't leave a stale entry
// if spawn fails"。
// 如果先登记名字、再注册任务，而注册失败（比如资源不足）——
// 名字就永久指向一个不存在的 agent。之后模型用名字发消息，
// 会得到一个"找不到"的错误，但注册表里明明有 —— 极难排查。
//
// 【为什么 sync 路径不登记】
// 注释："Sync agents skipped — coordinator is blocked, so SendMessage
// routing doesn't apply."
// 同步 agent 执行期间，主线程**被完全占住**，不可能同时调 SendMessage。
// 所以登记了也用不上，反而留了个需要清理的表项。
      // Register name → agentId for SendMessage routing. Post-registerAsyncAgent
      // so we don't leave a stale entry if spawn fails. Sync agents skipped —
      // coordinator is blocked, so SendMessage routing doesn't apply.
      if (name) {
        rootSetAppState(prev => {
          const next = new Map(prev.agentNameRegistry);
          next.set(name, asAgentId(asyncAgentId));
          return {
            ...prev,
            agentNameRegistry: next
          };
        });
      }

// agentContext 是遥测归因用的上下文包，被 runWithAgentContext 包住整段执行。
//
// 【第 717-719 行那两句注释解释了 parentSessionId 的两种取值】
//   "For subagents from teammates: use team lead's session"
//   "For subagents from main REPL: undefined (no parent session)"
// 也就是说：从 teammate 派出的 agent 挂在**团队领导**的会话下
// （因为 teammate 自己没有独立会话），从主 REPL 派出的则为 undefined。
//
// 这让遥测能画出正确的调用树，而不是把所有子 agent 都挂到一个空洞的
// "主会话"下面。
      // Wrap async agent execution in agent context for analytics attribution
      const asyncAgentContext = {
        agentId: asyncAgentId,
        // For subagents from teammates: use team lead's session
        // For subagents from main REPL: undefined (no parent session)
        parentSessionId: getParentSessionId(),
        agentType: 'subagent' as const,
        subagentName: selectedAgent.agentType,
        isBuiltIn: isBuiltInAgent(selectedAgent),
        invokingRequestId: assistantMessage?.requestId,
        invocationKind: 'spawn' as const,
        invocationEmitted: false
      };

// ⚠️ 这段注释讲的是 AsyncLocalStorage 的一个微妙性质，值得细读：
//
//   "Workload propagation: handlePromptSubmit wraps the entire turn in
//    runWithWorkload (AsyncLocalStorage). ALS context is captured at
//    invocation time — when this `void` fires — and survives every await
//    inside. No capture/restore needed; the detached closure sees the
//    parent turn's workload automatically, isolated from its finally."
//
// 拆开：
//   ① 父 turn 被 runWithWorkload 包着，ALS 里存着"这次请求的 workload 标记"
//   ② 这里 `void runWithAgentContext(...)` **在这一刻**捕获 ALS 上下文
//   ③ 之后这个游离的闭包（不 await、不等待）里所有 await 都看得见那个标记
//   ④ 而父 turn 的 finally 执行时，会不会影响这个闭包？不会 ——
//      ALS 是**捕获时快照**，不是引用
//
// 【为什么这件事需要专门写注释】
// 因为直觉上"父函数 return 了，它设置的状态应该消失"。ALS 恰恰不是这样。
// 如果不理解这个，你会担心"父 turn 结束后子 agent 的遥测标记会不会丢"，
// 然后写一堆手动的 capture/restore —— 那是多余的。
//
// 【`void` 这个关键字的含义】
// 明确表示"不等这个 promise、也不处理它的 rejection"。
// 这在这里是正确的：异步 agent 的错误由 runAsyncAgentLifecycle 内部
// 自己处理并转成通知，不该冒泡到 tool_result 里。
      // Workload propagation: handlePromptSubmit wraps the entire turn in
      // runWithWorkload (AsyncLocalStorage). ALS context is captured at
      // invocation time — when this `void` fires — and survives every await
      // inside. No capture/restore needed; the detached closure sees the
      // parent turn's workload automatically, isolated from its finally.
      void runWithAgentContext(asyncAgentContext, () => wrapWithCwd(() => runAsyncAgentLifecycle({
        taskId: agentBackgroundTask.agentId,
        abortController: agentBackgroundTask.abortController!,
        makeStream: onCacheSafeParams => runAgent({
          ...runAgentParams,
          override: {
            ...runAgentParams.override,
            agentId: asAgentId(agentBackgroundTask.agentId),
            abortController: agentBackgroundTask.abortController!
          },
          onCacheSafeParams
        }),
        metadata,
        description,
        toolUseContext,
        rootSetAppState,
        agentIdForCleanup: asyncAgentId,
        enableSummarization: isCoordinator || isForkSubagentEnabled() || getSdkAgentProgressSummariesEnabled(),
        getWorktreeResult: cleanupWorktreeIfNeeded
      })));
// canReadOutputFile：调用方有没有能力读那个 output file。
//
// 这个布尔值直接决定返回给模型的 **tool_result 话术**（第 1329 行）：
//   能读  → "如果想看进度可以用 Read 或 bash tail 那个文件"
//   不能读 → "简要告诉用户你派了什么，然后结束这一轮，不要生成其他文本"
//
// 【为什么要分这两种话术】
// 如果调用方是主线程（有 Read / Bash），告诉它可以查进度是合理的 ——
// 它偶尔真需要（用户问"进展如何"）。
// 如果调用方本身是个没有文件读取能力的 agent，那句话就是空头支票，
// 它照着做只会得到权限错误。这时更该说的是"别多话，等通知"。
      const canReadOutputFile = toolUseContext.options.tools.some(t => toolMatchesName(t, FILE_READ_TOOL_NAME) || toolMatchesName(t, BASH_TOOL_NAME));
      return {
        data: {
          isAsync: true as const,
          status: 'async_launched' as const,
          agentId: agentBackgroundTask.agentId,
          description: description,
          prompt: prompt,
          outputFile: getTaskOutputPath(agentBackgroundTask.agentId),
          canReadOutputFile
        }
      };
// ============================================================
// 【同步路径：一个"随时可以变成异步"的 while 循环】
//
// 需求一句话说清：前台跑，但用户在等待期间随时可以按"转后台"，
// 那一刻要把控制权还给用户、让 agent 在后台继续，而且**进度不能丢**。
//
// 这个需求的三个技术难点，对应后面三段代码：
//
//   ① 怎么同时等"下一条消息"和"转后台信号"？
//      → Promise.race（第 886 行）。但 race 有个陷阱：
//        同一个 promise 反复 race 会累积回调（第 811 行注释）。
//
//   ② 转后台时怎么把前台那条生成器**优雅关闭**？
//      → agentIterator.return(undefined)（第 918 行）。
//        必须调，否则生成器的 finally 不跑 → MCP 连接泄漏、
//        session hooks 不清、prompt cache 跟踪表不释放。
//
//   ③ 后台怎么从"已经产生的消息"接着跑？
//      → 重放 agentMessages 到新的 tracker（第 922-924 行），
//        然后用同一个 taskId 重新调 runAgent（第 925 行）。
//        注意是**重新调**，不是"继续"——因为原生成器已经被关闭了。
//        所谓"继续"是靠把之前所有消息作为上下文再喂一遍实现的。
// ============================================================
    } else {
// 同步路径也要一个 agentId。这里从 earlyAgentId 转成 branded type
// （asAgentId），类型系统据此防止把普通字符串当 id 传。
//
// 【branded type 在这个文件里出现多次】
// asAgentId / asSystemPrompt 都是这个模式：运行时是空函数，
// 编译期给字符串打上一个不可伪造的标记类型。作用是防止
// "把 description 传进 agentId 参数"这类低级错误 ——
// 两个都是 string，普通类型系统区分不了。
      // Create an explicit agentId for sync agents
      const syncAgentId = asAgentId(earlyAgentId);

      // Set up agent context for sync execution (for analytics attribution)
      const syncAgentContext = {
        agentId: syncAgentId,
        // For subagents from teammates: use team lead's session
        // For subagents from main REPL: undefined (no parent session)
        parentSessionId: getParentSessionId(),
        agentType: 'subagent' as const,
        subagentName: selectedAgent.agentType,
        isBuiltIn: isBuiltInAgent(selectedAgent),
        invokingRequestId: assistantMessage?.requestId,
        invocationKind: 'spawn' as const,
        invocationEmitted: false
      };

      // Wrap entire sync agent execution in context for analytics attribution
      // and optionally in a worktree cwd override for filesystem isolation
// 三层包裹，从外到内：
//   runWithAgentContext   遥测归因（ALS）
//   wrapWithCwd           cwd 覆盖（worktree 或显式 cwd）
//   async 箭头函数         实际执行体
//
// 顺序不能换：cwd 覆盖必须在 agentContext 内部，否则
// 构建系统提示词时 getCwd() 拿到的还是旧路径。
      return runWithAgentContext(syncAgentContext, () => wrapWithCwd(async () => {
        const agentMessages: MessageType[] = [];
        const agentStartTime = Date.now();
        const syncTracker = createProgressTracker();
        const syncResolveActivity = createActivityDescriptionResolver(toolUseContext.options.tools);

// 先 yield 一条进度消息，把 prompt 带出去。
//
// 用途：界面在 agent 刚开始跑、还没有任何输出的那几秒里，
// 能显示"正在做什么"（prompt 的摘要）。否则用户看到的是一个
// 没有任何信息的转圈。
//
// 注意注释里那句 "prompt only needed on first progress message
// (UI.tsx:624 reads progressMessages[0])" —— 这是**跨文件契约**：
// UI 只读第一条 progress 的 prompt，后面的都传空串（第 1119 行）
// 以避免重复传输这份可能很长的文本。
        // Yield initial progress message to carry metadata (prompt)
        if (promptMessages.length > 0) {
          const normalizedPromptMessages = normalizeMessages(promptMessages);
          const normalizedFirstMessage = normalizedPromptMessages.find((m): m is NormalizedUserMessage => m.type === 'user');
          if (normalizedFirstMessage && normalizedFirstMessage.type === 'user' && onProgress) {
            onProgress({
              toolUseID: `agent_${assistantMessage.message.id}`,
              data: {
                message: normalizedFirstMessage,
                type: 'agent_progress',
                prompt,
                agentId: syncAgentId
              }
            });
          }
        }

// 立即注册为"前台任务"。
//
// 为什么前台也要注册成任务？
// 因为这样才能**随时转后台** —— 转后台的本质是"这个任务从
// 前台视图切到后台视图"，前提是它在任务表里已经存在。
// 如果等转的时候才注册，中间会有一段"既不在前台也不在后台"的空窗。
//
// 注释 "so it can be backgrounded at any time" 就是这个意思。
        // Register as foreground task immediately so it can be backgrounded at any time
        // Skip registration if background tasks are disabled
        let foregroundTaskId: string | undefined;
// ⚠️⚠️ 这个变量**必须在循环外**创建。注释说得很清楚，但值得展开：
//
//   "Create the background race promise once outside the loop — otherwise
//    each iteration adds a new .then() reaction to the same pending
//    promise, accumulating callbacks for the lifetime of the agent."
//
// 如果写在循环里（直觉写法）：
//   while (true) {
//     const bg = registration.backgroundSignal.then(...)   // ❌
//     await Promise.race([nextMessage, bg])
//   }
// 会发生什么：
//   · 每轮都新建一个 .then()，挂到**同一个**未完成的 promise 上
//   · 这些回调全都留着，等那个 promise 最终 resolve 时**全部执行**
//   · 一个跑 200 轮的工具调用 agent，就积累 200 个回调
//   · 更要紧的是：每个回调都闭包捕获了当轮的变量 → 内存泄漏
//
// 而且这个泄漏是"静默"的：功能完全正常（第一个回调生效，其余
// 重复执行同样的逻辑但幂等），只是内存慢慢涨。
//
// 【判别方法】
// 在 while 循环里看到 .then() / .catch() / new Promise，先问一句：
// "这个东西每轮都新建，还是应该在外层建一次？"
// 如果它监听的是**循环外产生的事件**，答案就是外层。
        // Create the background race promise once outside the loop — otherwise
        // each iteration adds a new .then() reaction to the same pending
        // promise, accumulating callbacks for the lifetime of the agent.
        let backgroundPromise: Promise<{
          type: 'background';
        }> | undefined;
        let cancelAutoBackground: (() => void) | undefined;
// 后台任务被禁用时跳过整个注册。
//
// 于是 foregroundTaskId 是 undefined，backgroundPromise 也是 undefined。
// 后面第 886 行的 race 会走 else 分支（直接 await 下一条消息），
// 而第 897 行的转后台判断永远不会成立 —— 整条"转后台"路径被自然禁用，
// 不需要额外的 if。
//
// 【这是"用 undefined 控制功能可用性"的写法】
// 比到处写 if (!isBackgroundTasksDisabled) 干净，但代价是
// 阅读时必须意识到"这两个变量可能不存在"。
        if (!isBackgroundTasksDisabled) {
          const registration = registerAgentForeground({
            agentId: syncAgentId,
            description,
            prompt,
            selectedAgent,
            setAppState: rootSetAppState,
            toolUseId: toolUseContext.toolUseId,
            autoBackgroundMs: getAutoBackgroundMs() || undefined
          });
          foregroundTaskId = registration.taskId;
          backgroundPromise = registration.backgroundSignal.then(() => ({
            type: 'background' as const
          }));
          cancelAutoBackground = registration.cancelAutoBackground;
        }

// 三个状态标记，各自防一种重复执行：
//
//   backgroundHintShown  2 秒提示只设一次（setToolJSX 是渲染副作用，
//                        每轮调一次会不停重置界面）
//   wasBackgrounded      finally 里据此跳过清理（后台闭包自己会清）
//   stopForegroundSummarization
//                        前台摘要器的 stop 函数，与后台那份**互相独立**
//
// 【第 839-841 行注释点破了一个容易写错的地方】
//   "Per-scope stop function — NOT shared with the backgrounded closure.
//    idempotent: startAgentSummarization's stop() checks `stopped` flag."
//
// 也就是：前台有一个摘要器，转后台后后台再建一个**新的**摘要器，
// 两个各有自己的 stop。不能用同一个 —— 因为前台的 stop 已经被调用过
// （转后台那一刻），复用会让后台的摘要器立刻被判定为"已停止"。
//
// 这类"作用域绑定"的错误极难发现：功能看起来正常（进度照样更新），
// 只是后台 agent 的摘要**从来不刷新**，用户看到的是停留在转后台那一刻的旧摘要。
        // Track if we've shown the background hint UI
        let backgroundHintShown = false;
        // Track if the agent was backgrounded (cleanup handled by backgrounded finally)
        let wasBackgrounded = false;
        // Per-scope stop function — NOT shared with the backgrounded closure.
        // idempotent: startAgentSummarization's stop() checks `stopped` flag.
        let stopForegroundSummarization: (() => void) | undefined;
        // const capture for sound type narrowing inside the callback below
        const summaryTaskId = foregroundTaskId;

// 拿生成器的**手动迭代器**，而不是用 for await。
//
// 为什么？因为 for await 无法"在等待下一条消息的同时做别的事"。
// 手动迭代器可以拆成 next() 和 return() 两个动作：
//   next()    取下一项 —— 用 race 包起来，随时可以不等
//   return()  提前终止 —— 转后台时用来触发 finally
//
// 【这是读这个文件必须理解的一点】
// 后面 500 行全部建立在"我手里有一个可控的迭代器"之上。
// 如果用 for await，转后台的那一刻只能 abort 整个 agent，
// 无法"优雅关闭 + 从已有消息接着跑"。
        // Get async iterator for the agent
        const agentIterator = runAgent({
          ...runAgentParams,
          override: {
            ...runAgentParams.override,
            agentId: syncAgentId
          },
// onCacheSafeParams 回调：runAgent 会把"这一轮实际发出去的参数"传回来，
// 我们用它启动**摘要器**（把 agent 的长对话压成一句"正在做什么"）。
//
// 为什么叫 CacheSafeParams？
// 因为摘要调用不能破坏 agent 自己的 prompt cache —— 它需要拿到
// 一组"可以安全用于旁路请求"的参数。这个约束在 compact.ts 里
// 也出现过（主路径严禁设 maxOutputTokens 那个例子）。
//
// 注意条件是 summaryTaskId && getSdkAgentProgressSummariesEnabled()：
// 只有 SDK 模式才开摘要。终端界面用另一套（转圈的 activity 描述）。
          onCacheSafeParams: summaryTaskId && getSdkAgentProgressSummariesEnabled() ? (params: CacheSafeParams) => {
            const {
              stop
            } = startAgentSummarization(summaryTaskId, syncAgentId, params, rootSetAppState);
            stopForegroundSummarization = stop;
          } : undefined
        })[Symbol.asyncIterator]();

        // Track if an error occurred during iteration
        let syncAgentError: Error | undefined;
        let wasAborted = false;
        let worktreeResult: {
          worktreePath?: string;
          worktreeBranch?: string;
        } = {};
// 主循环。三个变量在循环外声明，因为它们要在 catch / finally 里被读到：
//   syncAgentError  迭代中是否有非中止类错误
//   wasAborted      是否因中止退出（区分"用户取消"和"程序出错"）
//   worktreeResult  finally 里清理的结果，要并进最终返回值
//
// 【这三个变量的存在本身就是一种信号】
// 如果一段逻辑"必须在异常路径里还能读到状态"，它就很难抽成函数 ——
// 这正是 claude.ts 那个 1,881 行 queryModel 不拆的同一类理由。
        try {
          while (true) {
            const elapsed = Date.now() - agentStartTime;

// 2 秒后显示后台提示。
//
// 注意条件是 elapsed >= PROGRESS_THRESHOLD_MS 且 !backgroundHintShown。
// 两个条件缺一不可：
//   没有 elapsed 判断 → 一进门就弹提示（短任务会闪）
//   没有 shown 判断   → 每轮都调 setToolJSX，界面不停重置
//
// 还有个隐含条件 toolUseContext.setToolJSX 存在 —— 只有终端 UI 才有
// 这个能力，SDK / 无头模式没有，所以静默跳过。
            // Show background hint after threshold (but task is already registered)
            // Skip if background tasks are disabled
            if (!isBackgroundTasksDisabled && !backgroundHintShown && elapsed >= PROGRESS_THRESHOLD_MS && toolUseContext.setToolJSX) {
              backgroundHintShown = true;
              toolUseContext.setToolJSX({
                jsx: <BackgroundHint />,
                shouldHidePromptInput: false,
                shouldContinueAnimation: true,
                showSpinner: true
              });
            }

// ─────────────────────────────────────────────────────────────
// 【race：整个转后台机制的枢纽】
//
// 两个竞争者：
//   nextMessagePromise  下一条消息（可能几毫秒后到，也可能 30 秒后）
//   backgroundPromise  用户按"转后台"的信号（可能永远不来）
//
// 【race 的两个后果，都要处理】
//   ① 消息先到 → raceResult.type === 'message' → 正常处理
//   ② 信号先到 → type === 'background' → 进入转后台流程（897 行）
//
// 【但还有一个不明显的第三态】
// race 结束后，输掉的那个 promise **仍然在跑**。
// 对 nextMessagePromise 来说这没问题（它是迭代器的 next，输掉之后
// 下一轮会再调一次 next —— 需要注意 SDK 的迭代器是否支持重复 next，
// 这里依赖的正是"未完成的 next 会被后续 next 复用"的实现）。
//
// backgroundPromise 输掉之后也仍然 pending，这正是第 811 行
// 那个"只能在循环外建一次"的原因 —— 它注定要被 race 很多次。
//
// 【第 886 行那个 .then(r => ({type:'message', result:r})) 是形状对齐】
// 把迭代器的结果包装成和 backgroundPromise 相同的判别联合，
// 这样 race 的返回值可以直接用 .type 分流，不需要判断两个不同的形状。
            // Race between next message and background signal
            // If background tasks are disabled, just await the next message directly
            const nextMessagePromise = agentIterator.next();
            const raceResult = backgroundPromise ? await Promise.race([nextMessagePromise.then(r => ({
              type: 'message' as const,
              result: r
            })), backgroundPromise]) : {
              type: 'message' as const,
              result: await nextMessagePromise
            };

// 收到后台信号，但还要**再确认一次**：任务表里这个任务真的被标记为
// backgrounded 了吗？
//
// 【为什么不能直接信信号】
// backgroundSignal 是"有人请求转后台"，而 isBackgrounded 是
// "确实转成功了"。两者之间可能有别的情况（比如转后台过程中
// 任务已经结束了），这时信号是陈旧的，不该按转后台处理。
//
// 第 895-896 行那句注释也在解释类型收窄：
// "foregroundTaskId is guaranteed to be defined if raceResult.type is
//  'background' because backgroundPromise is only defined when
//  foregroundTaskId is defined"
// —— 逻辑上成立，但 TypeScript 看不出来，所以还是加了 && foregroundTaskId。
            // Check if we were backgrounded via backgroundAll()
            // foregroundTaskId is guaranteed to be defined if raceResult.type is 'background'
            // because backgroundPromise is only defined when foregroundTaskId is defined
            if (raceResult.type === 'background' && foregroundTaskId) {
              const appState = toolUseContext.getAppState();
              const task = appState.tasks[foregroundTaskId];
              if (isLocalAgentTask(task) && task.isBackgrounded) {
                // Capture the taskId for use in the async callback
                const backgroundedTaskId = foregroundTaskId;
                wasBackgrounded = true;
                // Stop foreground summarization; the backgrounded closure
                // below owns its own independent stop function.
                stopForegroundSummarization?.();

                // Workload: inherited via ALS at `void` invocation time,
                // same as the async-from-start path above.
                // Continue agent in background and return async result
                void runWithAgentContext(syncAgentContext, async () => {
                  let stopBackgroundedSummarization: (() => void) | undefined;
// ⚠️ 这是整个文件最容易写错的一段。`agentIterator.return(undefined)` 的必要性：
//
// 生成器的 finally 块里有什么？
//   · MCP 连接的释放
//   · session hooks 的清理
//   · prompt cache 跟踪表的摘除
//   · dumpState 的清空
//
// 如果直接丢弃迭代器（不调 return），这是一个**已启动但永不完成**的
// 异步生成器 —— 它的 finally 永远不会跑，上面那些资源全部泄漏。
// 而且因为 agent 还在"跑"，看起来一切正常。
//
// 【为什么要 race 一个 1 秒的 sleep】
// 注释："Timeout prevents blocking if MCP server cleanup hangs."
// MCP 的那个 cleanup 会发 SIGINT 等 100ms、SIGTERM 等 400ms
// （见 mcp/client.ts 的三级信号升级），最坏要 500ms 以上。
// 如果一个服务器卡住不响应，整个转后台操作会被拖住 ——
// 而用户按"转后台"的期望是"立刻"。
// 所以：给它 1 秒，超过就走人（资源让 GC 慢慢收）。
//
// 【.catch(() => {}) 也是必须的】
// race 输了之后那个 return() 的 promise 仍然会 resolve/reject，
// 如果不接住它的 rejection，就是一个 unhandled rejection ——
// 在 Node 里会打警告，某些配置下会直接退出进程。
                  try {
                    // Clean up the foreground iterator so its finally block runs
                    // (releases MCP connections, session hooks, prompt cache tracking, etc.)
                    // Timeout prevents blocking if MCP server cleanup hangs.
                    // .catch() prevents unhandled rejection if timeout wins the race.
                    await Promise.race([agentIterator.return(undefined).catch(() => {}), sleep(1000)]);
// 重放已有消息到新的 tracker。
//
// 【这一步为什么必要】
// 转后台后，进度显示（token 数、工具调用次数、当前活动描述）
// 需要接着之前的数字往上加，而不是从 0 开始。
// 新 tracker 是空的，所以要把 agentMessages 一条条喂进去重建。
//
// 【注意这里是"重放消息"而不是"迁移计数器"】
// 重放的好处是不需要知道 tracker 的内部结构 —— 只要
// updateProgressFromMessage 能处理消息，就能重建任意时刻的状态。
// 代价是 O(n)，但 n 是消息数（几十到几百），可接受。
//
// 这也是"用纯函数 + 事件流重建状态"的典型收益：
// 状态可以从头推导，就不需要序列化/反序列化。
                    // Initialize progress tracking from existing messages
                    const tracker = createProgressTracker();
                    const resolveActivity2 = createActivityDescriptionResolver(toolUseContext.options.tools);
                    for (const existingMsg of agentMessages) {
                      updateProgressFromMessage(tracker, existingMsg, resolveActivity2, toolUseContext.options.tools);
                    }
// ⚠️ **重新调用** runAgent，而不是"继续"之前的生成器。
//
// 这是理解转后台机制的最后一环。原生成器已经被 return() 关闭了
// （第 918 行），无法恢复。所以后台是这样"接着跑"的：
//
//   ① 把 agentMessages（之前所有消息）作为上下文
//   ② 用同一个 taskId、同一个 abortController
//   ③ 重新调 runAgent —— 它看到的历史就是之前跑出来的全部历史
//   ④ agent 无从得知自己"被转过一次后台"，它只看到一段完整的历史
//
// 【代价：有一小段重复计算】
// runAgent 会重新组装系统提示词、重新序列化工具、可能重发最后一轮请求。
// 因为 prompt cache 还在（历史没变），这部分成本远低于重跑整个任务。
//
// 【收益：实现极简】
// 不需要"从生成器中间恢复"这种复杂机制。生成器是不可恢复的，
// 但**消息历史是可重放的** —— 用可重放的输入重建执行，
// 比给生成器加序列化能力简单得多。
//
// isAsync: true 这一行是必须的 —— 它告诉 runAgent 现在是后台模式
// （影响它是否把流式事件过滤掉、是否推送通知等）。
                    for await (const msg of runAgent({
                      ...runAgentParams,
                      isAsync: true,
                      // Agent is now running in background
                      override: {
                        ...runAgentParams.override,
                        agentId: asAgentId(backgroundedTaskId),
                        abortController: task.abortController
                      },
                      onCacheSafeParams: getSdkAgentProgressSummariesEnabled() ? (params: CacheSafeParams) => {
                        const {
                          stop
                        } = startAgentSummarization(backgroundedTaskId, asAgentId(backgroundedTaskId), params, rootSetAppState);
                        stopBackgroundedSummarization = stop;
                      } : undefined
                    })) {
                      agentMessages.push(msg);

                      // Track progress for backgrounded agents
                      updateProgressFromMessage(tracker, msg, resolveActivity2, toolUseContext.options.tools);
                      updateAsyncAgentProgress(backgroundedTaskId, getProgressUpdate(tracker), rootSetAppState);
                      const lastToolName = getLastToolUseName(msg);
                      if (lastToolName) {
                        emitTaskProgress(tracker, backgroundedTaskId, toolUseContext.toolUseId, description, startTime, lastToolName);
                      }
                    }
// finalizeAgentTool 把一堆消息压成一个结果对象：
//   content / totalTokens / totalToolUseCount / totalDurationMs / agentId
//
// 【它是"消息流 → 结果"的唯一转换点】
// 同步路径（第 1235 行）也调它。两条路径用同一个收尾函数，
// 保证"同一个 agent 无论前台跑完还是后台转正，结果形状一致"。
                    const agentResult = finalizeAgentTool(agentMessages, backgroundedTaskId, metadata);

// ⚠️ 顺序要求：**先标完成，再做清理**。注释点了 issue 号（gh-20236）：
//
//   "Mark task completed FIRST so TaskOutput(block=true) unblocks
//    immediately. classifyHandoffIfNeeded and cleanupWorktreeIfNeeded
//    can hang — they must not gate the status transition."
//
// 场景：agent 跑完了，代码开始做两件可能很慢的事：
//   · classifyHandoffIfNeeded  一次额外的模型调用（判断"是不是该交接给别的 agent"）
//   · cleanupWorktreeIfNeeded  要跑 git status 检查有没有改动
// 如果先做这两件事再标完成，那么 `TaskOutput(block=true)` 的调用方
// 会一直阻塞 —— 它认为任务还没结束。
//
// 而 git 在一个巨大的仓库里跑 status 可能几十秒；classify 是一次
// 完整的 API 调用（5-10 秒，还可能被限流）。
//
// 【一条通用的时序原则】
// **状态转换要尽可能早，副作用要尽可能晚。**
// 因为状态转换的消费者（等待方）关心的是"能不能走了"，
// 而副作用（清理、遥测、分类）都不该成为别人的阻塞原因。
//
// 这个原则在本项目里出现过多次：QueryEngine 里"assistant 消息不能
// await"、mcp/client 里"先 reject pending 再清理缓存"。
// 都是同一个形状：**别让慢操作夹在状态和观察者之间。**
                    // Mark task completed FIRST so TaskOutput(block=true)
                    // unblocks immediately. classifyHandoffIfNeeded and
                    // cleanupWorktreeIfNeeded can hang — they must not gate
                    // the status transition (gh-20236).
                    completeAsyncAgent(agentResult, rootSetAppState);

                    // Extract text from agent result content for the notification
                    let finalMessage = extractTextContent(agentResult.content, '\n');
                    if (feature('TRANSCRIPT_CLASSIFIER')) {
                      const backgroundedAppState = toolUseContext.getAppState();
                      const handoffWarning = await classifyHandoffIfNeeded({
                        agentMessages,
                        tools: toolUseContext.options.tools,
                        toolPermissionContext: backgroundedAppState.toolPermissionContext,
                        abortSignal: task.abortController!.signal,
                        subagentType: selectedAgent.agentType,
                        totalToolUseCount: agentResult.totalToolUseCount
                      });
                      if (handoffWarning) {
                        finalMessage = `${handoffWarning}\n\n${finalMessage}`;
                      }
                    }

// 先清 worktree 再发通知，因为通知里要带上 worktree 路径。
//
// 这个顺序反过来不行：通知先发出去，模型和用户就收到了"完成了"，
// 但那时还不知道文件在哪个 worktree 里 —— 后面补一条消息说明
// 会让交互变啰嗦，而且模型可能已经基于"没有 worktree"的前提行动了。
                    // Clean up worktree before notification so we can include it
                    const worktreeResult = await cleanupWorktreeIfNeeded();
                    enqueueAgentNotification({
                      taskId: backgroundedTaskId,
                      description,
                      status: 'completed',
                      setAppState: rootSetAppState,
                      finalMessage,
                      usage: {
                        totalTokens: getTokenCountFromTracker(tracker),
                        toolUses: agentResult.totalToolUseCount,
                        durationMs: agentResult.totalDurationMs
                      },
                      toolUseId: toolUseContext.toolUseId,
                      ...worktreeResult
                    });
// 后台执行的三路错误处理，形状很统一：
//
//   AbortError → killAsyncAgent + 上报 **部分结果**
//   其他错误    → failAsyncAgent + 上报错误
//   finally    → 停摘要器 + 清 skills + 清 dumpState
//
// 【AbortError 为什么要给部分结果】
// 用户按 Esc 取消一个跑了一半的 agent，他不是想"什么都没有"，
// 而是想"停下来，把你已经得到的告诉我"。
// extractPartialResult 就是在已有消息里找出最后一条实质内容。
//
// 【注意第 994-995 行又重复了那个顺序原则】
//   "Transition status BEFORE worktree cleanup so TaskOutput unblocks
//    even if git hangs (gh-20236)."
// 同一个 bug 的两条路径（这里的 catch、上面的 try）都要单独修 ——
// 因为它们是两段独立的代码。这也是"复制粘贴的清理逻辑"的典型代价。
                  } catch (error) {
                    if (error instanceof AbortError) {
                      // Transition status BEFORE worktree cleanup so
                      // TaskOutput unblocks even if git hangs (gh-20236).
                      killAsyncAgent(backgroundedTaskId, rootSetAppState);
                      logEvent('tengu_agent_tool_terminated', {
                        agent_type: metadata.agentType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                        model: metadata.resolvedAgentModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                        duration_ms: Date.now() - metadata.startTime,
                        is_async: true,
                        is_built_in_agent: metadata.isBuiltInAgent,
                        reason: 'user_cancel_background' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
                      });
                      const worktreeResult = await cleanupWorktreeIfNeeded();
                      const partialResult = extractPartialResult(agentMessages);
                      enqueueAgentNotification({
                        taskId: backgroundedTaskId,
                        description,
                        status: 'killed',
                        setAppState: rootSetAppState,
                        toolUseId: toolUseContext.toolUseId,
                        finalMessage: partialResult,
                        ...worktreeResult
                      });
                      return;
                    }
                    const errMsg = errorMessage(error);
                    failAsyncAgent(backgroundedTaskId, errMsg, rootSetAppState);
                    const worktreeResult = await cleanupWorktreeIfNeeded();
                    enqueueAgentNotification({
                      taskId: backgroundedTaskId,
                      description,
                      status: 'failed',
                      error: errMsg,
                      setAppState: rootSetAppState,
                      toolUseId: toolUseContext.toolUseId,
                      ...worktreeResult
                    });
// finally 里只做三件**不会失败、也不需要等待**的事：
//   stopBackgroundedSummarization?.()   停摘要器（有 stopped 标记，幂等）
//   clearInvokedSkillsForAgent          清技能表（纯内存操作）
//   clearDumpState                      清 dump 表（纯内存操作）
//
// 【worktree 清理被刻意排除在外】
// 第 1034-1035 行注释："worktree cleanup is done before
// enqueueAgentNotification in both try and catch paths so we can
// include worktree info"
//
// 也就是：清理工作必须在通知之前做（要带路径），而 finally 在通知之后。
// 所以它不能放进 finally —— 这是被顺序要求逼出来的结构，
// 代价是 try 和 catch 里各写一遍（重复），收益是通知里的信息完整。
                  } finally {
                    stopBackgroundedSummarization?.();
                    clearInvokedSkillsForAgent(syncAgentId);
                    clearDumpState(syncAgentId);
                    // Note: worktree cleanup is done before enqueueAgentNotification
                    // in both try and catch paths so we can include worktree info
                  }
                });

// 立刻返回 async_launched，不等后台那坨异步逻辑。
//
// 【这里有一个容易忽略的语义】
// 返回的是"已启动"，不是"已完成"。tool_result 里的文本会告诉模型
// "agent 在后台工作，完成时你会收到通知"（第 1328 行）。
//
// 而此刻后台闭包可能一行都还没跑（`void` 是立即返回的）。
// 所以"启动成功"和"真的在跑"之间有时间差 —— 这个差在正常情况下
// 是微秒级，但如果事件循环被占住（比如同时有 5 个 agent 在起），
// 可能到几十毫秒。不需要处理，但理解这一点有助于看懂日志顺序。
                // Return async_launched result immediately
                const canReadOutputFile = toolUseContext.options.tools.some(t => toolMatchesName(t, FILE_READ_TOOL_NAME) || toolMatchesName(t, BASH_TOOL_NAME));
                return {
                  data: {
                    isAsync: true as const,
                    status: 'async_launched' as const,
                    agentId: backgroundedTaskId,
                    description: description,
                    prompt: prompt,
                    outputFile: getTaskOutputPath(backgroundedTaskId),
                    canReadOutputFile
                  }
                };
              }
            }

// 「这不应该发生」的分支。
//
// 正常情况下 race 只会产出 'message' 或 'background' 两种，
// 而 'background' 已经在上面处理并 return 了。走到这里说明
// raceResult.type 不是 'message' 且上面的 if 没进去（比如
// 任务表里查不到 foregroundTaskId 对应的任务）—— 直接 continue
// 而不是抛错，是为了"宁可多转一圈也不要因为状态不一致而崩掉"。
            // Process the message from the race result
            if (raceResult.type !== 'message') {
              // This shouldn't happen - background case handled above
              continue;
            }
            const {
              result
            } = raceResult;
            if (result.done) break;
            const message = result.value;
            agentMessages.push(message);

// 每收到一条消息就更新两处进度：
//   syncTracker               本地累加（最终结果要用）
//   emitTaskProgress          推给 VS Code 子 agent 面板 / SDK 消费者
//
// 第 1073-1078 行有个条件更新：只有开了 SDK 摘要时才把进度写回
// AppState（第 1077 行）。因为 updateAgentSummary 读的是 AppState 里的
// 计数，不写回去它就会一直显示 0 token / 0 工具调用。
//
// 【注释写得很直白】
// "Keep AppState task.progress in sync when SDK summaries are enabled,
//  so updateAgentSummary reads correct token/tool counts instead of zeros."
// 这又是一个"两条实现路径漏同步副作用"的例子 —— 和 autoCompact 里
// 忘了调 notifyCompaction 导致 20% 缓存告警误报是同一类问题。
            // Emit task_progress for the VS Code subagent panel
            updateProgressFromMessage(syncTracker, message, syncResolveActivity, toolUseContext.options.tools);
            if (foregroundTaskId) {
              const lastToolName = getLastToolUseName(message);
              if (lastToolName) {
                emitTaskProgress(syncTracker, foregroundTaskId, toolUseContext.toolUseId, description, agentStartTime, lastToolName);
                // Keep AppState task.progress in sync when SDK summaries are
                // enabled, so updateAgentSummary reads correct token/tool counts
                // instead of zeros.
                if (getSdkAgentProgressSummariesEnabled()) {
                  updateAsyncAgentProgress(foregroundTaskId, getProgressUpdate(syncTracker), rootSetAppState);
                }
              }
            }

// 把子 agent 的 bash_progress / powershell_progress 事件**转发**给父级。
//
// 【为什么需要手动转发】
// 子 agent 的流式事件在 runAgent 里被过滤掉了（第 1095-1096 行注释：
// "Subagent streaming events are filtered out in runAgent.ts"）。
// 被过滤的原因是：子 agent 的逐 token 流式对父级界面毫无意义
// （父级显示的是"agent 正在跑"，不是它的每个 token）。
//
// 但 bash 进度是例外 —— 它代表"这条命令跑了多久"，是**有信息量**的。
// 所以单独把它捞出来转发，让父级界面能显示 "running tests... 45s"。
//
// 【过滤的粒度是"事件类型"，不是"消息来源"】
// 这是一个挺细的设计：同样是子 agent 的事件，thinking delta 丢弃、
// bash_progress 转发。判据是"父级界面会不会用它"。
            // Forward bash_progress events from sub-agent to parent so the SDK
            // receives tool_progress events just as it does for the main agent.
            if (message.type === 'progress' && (message.data.type === 'bash_progress' || message.data.type === 'powershell_progress') && onProgress) {
              onProgress({
                toolUseID: message.toolUseID,
                data: message.data
              });
            }
            if (message.type !== 'assistant' && message.type !== 'user') {
              continue;
            }

// 在转圈里累加 token 数。
//
// 因为流式事件被过滤了（上一条批注），父级拿不到 usage 增量，
// 只能在这里用**内容长度**估算：getAssistantMessageContentLength。
//
// 注释："Subagent streaming events are filtered out in runAgent.ts,
//  so we need to count tokens from completed messages here"
//
// 【这是一个精度换简洁的取舍】
// 内容长度不等于 token 数（英文约 4 字符/token，中文约 1-2 字符/token），
// 所以转圈里显示的数字是**近似值**。
//
// 真正的精确值在 finalizeAgentTool 里（从 API usage 拿）。
// 所以：转圈用估算（要的是"在动"的感觉），最终结果用精确值（要的是准）。
            // Increment token count in spinner for assistant messages
            // Subagent streaming events are filtered out in runAgent.ts, so we
            // need to count tokens from completed messages here
            if (message.type === 'assistant') {
              const contentLength = getAssistantMessageContentLength(message);
              if (contentLength > 0) {
                toolUseContext.setResponseLength(len => len + contentLength);
              }
            }
            const normalizedNew = normalizeMessages([message]);
            for (const m of normalizedNew) {
              for (const content of m.message.content) {
                if (content.type !== 'tool_use' && content.type !== 'tool_result') {
                  continue;
                }

                // Forward progress updates
                if (onProgress) {
                  onProgress({
                    toolUseID: `agent_${assistantMessage.message.id}`,
                    data: {
                      message: m,
                      type: 'agent_progress',
                      // prompt only needed on first progress message (UI.tsx:624
                      // reads progressMessages[0]). Omit here to avoid duplication.
                      prompt: '',
                      agentId: syncAgentId
                    }
                  });
                }
              }
            }
          }
        } catch (error) {
          // Handle errors from the sync agent loop
          // AbortError should be re-thrown for proper interruption handling
          if (error instanceof AbortError) {
            wasAborted = true;
            logEvent('tengu_agent_tool_terminated', {
              agent_type: metadata.agentType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              model: metadata.resolvedAgentModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              duration_ms: Date.now() - metadata.startTime,
              is_async: false,
              is_built_in_agent: metadata.isBuiltInAgent,
              reason: 'user_cancel_sync' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
            });
            throw error;
          }

          // Log the error for debugging
          logForDebugging(`Sync agent error: ${errorMessage(error)}`, {
            level: 'error'
          });

          // Store the error to handle after cleanup
          syncAgentError = toError(error);
        } finally {
          // Clear the background hint UI
          if (toolUseContext.setToolJSX) {
            toolUseContext.setToolJSX(null);
          }

          // Stop foreground summarization. Idempotent — if already stopped at
          // the backgrounding transition, this is a no-op. The backgrounded
          // closure owns a separate stop function (stopBackgroundedSummarization).
          stopForegroundSummarization?.();

          // Unregister foreground task if agent completed without being backgrounded
          if (foregroundTaskId) {
            unregisterAgentForeground(foregroundTaskId, rootSetAppState);
            // Notify SDK consumers (e.g. VS Code subagent panel) that this
            // foreground agent is done. Goes through drainSdkEvents() — does
            // NOT trigger the print.ts XML task_notification parser or the LLM loop.
            if (!wasBackgrounded) {
              const progress = getProgressUpdate(syncTracker);
              enqueueSdkEvent({
                type: 'system',
                subtype: 'task_notification',
                task_id: foregroundTaskId,
                tool_use_id: toolUseContext.toolUseId,
                status: syncAgentError ? 'failed' : wasAborted ? 'stopped' : 'completed',
                output_file: '',
                summary: description,
                usage: {
                  total_tokens: progress.tokenCount,
                  tool_uses: progress.toolUseCount,
                  duration_ms: Date.now() - agentStartTime
                }
              });
            }
          }

          // Clean up scoped skills so they don't accumulate in the global map
          clearInvokedSkillsForAgent(syncAgentId);

          // Clean up dumpState entry for this agent to prevent unbounded growth
          // Skip if backgrounded — the backgrounded agent's finally handles cleanup
          if (!wasBackgrounded) {
            clearDumpState(syncAgentId);
          }

          // Cancel auto-background timer if agent completed before it fired
          cancelAutoBackground?.();

          // Clean up worktree if applicable (in finally to handle abort/error paths)
          // Skip if backgrounded — the background continuation is still running in it
          if (!wasBackgrounded) {
            worktreeResult = await cleanupWorktreeIfNeeded();
          }
        }

// ─────────────────────────────────────────────────────────────
// 【try 块之后的三个收尾判断，每个都在处理一种"非正常结束"】
//
//   1207  最后一条消息是 synthetic（合成的）→ 判定为中止 → throw AbortError
//   1223  迭代过程有错、但有 assistant 消息 → 带病返回部分结果
//   1235  正常路径 → finalizeAgentTool
//
// 【第 1207-1218 行的判断依据很巧妙】
// 不靠 wasAborted 标志，而是**看最后一条消息是不是合成的**。
//
// 为什么？因为用户按 Esc 时，框架会插入一条合成的 user 消息
// （内容类似 "[Request interrupted by user]"）。这是唯一可靠的信号：
// 它出现在消息流里，而 wasAborted 只在我们自己 throw AbortError 时
// 才会被设上 —— 但 Esc 走的是**另一条路径**（abortController），
// 未必要经过我们的 catch。
//
// 【findLast 的那个过滤条件也在说明问题】
//   _.type !== 'system' && _.type !== 'progress'
// 因为它要的是"最后一条实质消息"，而 system / progress 是噪音。
// 如果最后一条是 system，说明 agent 跑到了收尾阶段，不该判为中止。
        // Re-throw abort errors
        // TODO: Find a cleaner way to express this
        const lastMessage = agentMessages.findLast(_ => _.type !== 'system' && _.type !== 'progress');
        if (lastMessage && isSyntheticMessage(lastMessage)) {
          logEvent('tengu_agent_tool_terminated', {
            agent_type: metadata.agentType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            model: metadata.resolvedAgentModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            duration_ms: Date.now() - metadata.startTime,
            is_async: false,
            is_built_in_agent: metadata.isBuiltInAgent,
            reason: 'user_cancel_sync' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
          });
          throw new AbortError();
        }

// 【带病返回：有部分结果就交，没有才抛】
//
// 注释："This allows the parent agent to see partial progress even after
// an error."
//
// 判据是 hasAssistantMessages —— 只要有**一条** assistant 消息，
// 就说明 agent 真的干了点什么，那些内容对父级有价值。
// 一条都没有 → 纯粹的错误，抛出去让工具框架统一处理。
//
// 【这个取舍的风险】
// 父级拿到的结果可能"看起来正常但其实是半截"。
// 所以 finalizeAgentTool 生成的内容里会带 agentId / usage，
// 父级可以据此判断"工具调用次数这么少，可能没干完"。
// 但这依赖模型自己警觉 —— 是个软约束。
        // If an error occurred during iteration, try to return a result with
        // whatever messages we have. If we have no assistant messages,
        // re-throw the error so it's properly handled by the tool framework.
        if (syncAgentError) {
          // Check if we have any assistant messages to return
          const hasAssistantMessages = agentMessages.some(msg => msg.type === 'assistant');
          if (!hasAssistantMessages) {
            // No messages collected, re-throw the error
            throw syncAgentError;
          }

          // We have some messages, try to finalize and return them
          // This allows the parent agent to see partial progress even after an error
          logForDebugging(`Sync agent recovering from error with ${agentMessages.length} messages`);
        }
        const agentResult = finalizeAgentTool(agentMessages, syncAgentId, metadata);
        if (feature('TRANSCRIPT_CLASSIFIER')) {
          const currentAppState = toolUseContext.getAppState();
          const handoffWarning = await classifyHandoffIfNeeded({
            agentMessages,
            tools: toolUseContext.options.tools,
            toolPermissionContext: currentAppState.toolPermissionContext,
            abortSignal: toolUseContext.abortController.signal,
            subagentType: selectedAgent.agentType,
            totalToolUseCount: agentResult.totalToolUseCount
          });
          if (handoffWarning) {
            agentResult.content = [{
              type: 'text' as const,
              text: handoffWarning
            }, ...agentResult.content];
          }
        }
        return {
          data: {
            status: 'completed' as const,
            prompt,
            ...agentResult,
            ...worktreeResult
          }
        };
      }));
    }
  },
// ─────────────────────────────────────────────────────────────
// 【三行行为声明，决定了调度器怎么对待这个工具】
//
// isReadOnly() → true
//   注释只有半句："delegates permission checks to its underlying tools"
//   意思是：**派 agent 这个动作**不碰文件、不跑命令，所以它本身是只读的。
//   真正的读写发生在子 agent 内部，那里每一次工具调用各自过权限。
//
//   这个声明正确的三个前提：
//     ① 权限检查真的在子 agent 内部做了（是的，workerTools 带权限上下文）
//     ② 派活本身不产生副作用（是的，只创建任务）
//     ③ 只读声明不会被用来跳过什么关键检查（plan 模式下会——
//        但 plan 模式的子 agent 本来也拿不到写工具）
//
// isConcurrencySafe() → true（第 1273 行）
//   允许多个 Agent 调用**同时**执行。这依赖上一条：既然只读，就没有
//   写冲突。而且它是"并行派活"这个核心用法的前提 ——
//   coordinator 提示词里那句 "Parallelism is your superpower" 能成立，
//   靠的就是这一行返回 true。
//
//   ⚠️ 注意这里的并发安全只管**派活动作**，不管子 agent 之间会不会
//   冲突。两个 worker 同时改同一批文件时，谁也不会拦你 ——
//   那是协调者提示词的职责（"写重任务一次一个"），不是调度器的。
  isReadOnly() {
    return true; // delegates permission checks to its underlying tools
  },
// toAutoClassifierInput：把工具参数压成一段文本，喂给"自动审批分类器"。
//
// 【为什么需要这个函数】
// auto 模式下，权限请求不直接弹给用户，而是先问一个模型
// "这个操作安全吗"。那个模型需要一段**紧凑的输入**，
// 而不是完整的 JSON（prompt 可能几千字）。
//
// 这里的策略是：把 subagent_type 和 mode 两个"身份标签"放在前面，
// 然后是 prompt 全文。因为分类器要判断的正是"这个 agent 要干什么"。
//
// 注意 checkPermissions（第 1281 行）只在 auto 模式才 passthrough，
// 其他模式直接 allow —— 也就是说这个函数在绝大多数会话里用不到。
// 但 auto 模式正是"用户不想被弹窗打断"的场景，这时分类质量最重要。
  toAutoClassifierInput(input) {
    const i = input as AgentToolInput;
    const tags = [i.subagent_type, i.mode ? `mode=${i.mode}` : undefined].filter((t): t is string => t !== undefined);
    const prefix = tags.length > 0 ? `(${tags.join(', ')}): ` : ': ';
    return `${prefix}${i.prompt}`;
  },
  isConcurrencySafe() {
    return true;
  },
  userFacingName,
  userFacingNameBackgroundColor,
  getActivityDescription(input) {
    return input?.description ?? 'Running task';
  },
// 权限检查：**非 auto 模式直接放行**。
//
// 理由：子 agent 内部的每次工具调用都会各自过权限，
// 在这里再拦一次是重复的（而且会弹两次确认）。
//
// auto 模式例外 —— 返回 'passthrough'，交给分类器判断。
// 因为 auto 模式的语义是"你觉得安全就直接做"，而"派一个 agent
// 去做某件事"是个足够大的动作，值得让分类器看一眼 prompt。
//
// 【"external" === 'ant' 那一层是构建期开关】
// 外部构建里 auto 模式的分类器逻辑根本不存在，整个 if 被删掉，
// 于是函数体只剩 return allow。这也解释了为什么这个条件要写在这里
// 而不是在 mode 判断里 —— 它要能删掉**整块**代码。
  async checkPermissions(input, context): Promise<PermissionResult> {
    const appState = context.getAppState();

    // Only route through auto mode classifier when in auto mode
    // In all other modes, auto-approve sub-agent generation
    // Note: "external" === 'ant' guard enables dead code elimination for external builds
    if ("external" === 'ant' && appState.toolPermissionContext.mode === 'auto') {
      return {
        behavior: 'passthrough',
        message: 'Agent tool requires permission to spawn sub-agents.'
      };
    }
    return {
      behavior: 'allow',
      updatedInput: input
    };
  },
// ─────────────────────────────────────────────────────────────
// 【结果 → tool_result 文本：四种状态，四套话术】
//
// 这是全文件最被低估的一段。它决定了模型看到什么、进而决定
// 模型下一步做什么。四种状态：
//
//   teammate_spawned  "已生成，会通过 mailbox 收指令"
//   remote_launched   "已在远程启动，完成会通知你"
//   async_launched    "已启动，完成会通知你" +（能不能读输出文件）
//   completed         实际内容 + agentId + <usage>
//
// 【话术里藏着行为约束】
// 注意 async_launched 那段（1328-1329）：如果调用方**不能**读输出文件，
// 话术是"Do not generate any other text — agent results will arrive in
// a subsequent message."
//
// 这已经不是信息传递了，是**行为指令**。它出现在 tool_result 里而不是
// 系统提示词里，因为只有在"刚刚派了个 agent"这个时刻才需要它。
// 系统提示词里说一遍会让每次都读到，而这里说只在需要时说。
//
// 【这个模式值得记：把"时机相关的指令"放进 tool_result】
// 系统提示词 = 恒定的规则
// tool_result = 针对这一次结果的指令
// 后者更精准，而且不占系统提示词的缓存空间。
  mapToolResultToToolResultBlockParam(data, toolUseID) {
    // Multi-agent spawn result
    const internalData = data as InternalOutput;
    if (typeof internalData === 'object' && internalData !== null && 'status' in internalData && internalData.status === 'teammate_spawned') {
      const spawnData = internalData as TeammateSpawnedOutput;
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: [{
          type: 'text',
          text: `Spawned successfully.
agent_id: ${spawnData.teammate_id}
name: ${spawnData.name}
team_name: ${spawnData.team_name}
The agent is now running and will receive instructions via mailbox.`
        }]
      };
    }
    if ('status' in internalData && internalData.status === 'remote_launched') {
      const r = internalData;
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: [{
          type: 'text',
          text: `Remote agent launched in CCR.\ntaskId: ${r.taskId}\nsession_url: ${r.sessionUrl}\noutput_file: ${r.outputFile}\nThe agent is running remotely. You will be notified automatically when it completes.\nBriefly tell the user what you launched and end your response.`
        }]
      };
    }
// async_launched 的两种话术，分界在 canReadOutputFile。
//
// 【能读时】给出 output_file 路径 + 三种处置建议：
//   "Do not duplicate this agent's work — avoid working with the same
//    files or topics it is using."
//   （别重复它的工作 —— 避开它在用的文件和话题。）
//   这条针对的是一个真实浪费：模型派了个 agent 去重构 auth，
//   然后自己也开始改 auth，两边互相覆盖。
//
//   "Work on non-overlapping tasks, or briefly tell the user what you
//    launched and end your response."
//   给出两个合法选项：干别的，或者说一句就结束。
//
// 【不能读时】只剩一条：说一句就结束，不要生成别的文本。
// 因为如果它想说"我去看看进展"，又没有 Read / Bash，那句话是空头支票。
//
// 【第 1328 行那句插在括号里的话很有意思】
//   "agentId: xxx (internal ID - do not mention to user. Use SendMessage
//    with to: 'xxx' to continue this agent.)"
// —— 同一个值，明确区分"内部可用"和"不许对用户说"。
// 因为 agentId 对用户毫无意义（一串 UUID），说出来只会让界面变吵。
    if (data.status === 'async_launched') {
      const prefix = `Async agent launched successfully.\nagentId: ${data.agentId} (internal ID - do not mention to user. Use SendMessage with to: '${data.agentId}' to continue this agent.)\nThe agent is working in the background. You will be notified automatically when it completes.`;
      const instructions = data.canReadOutputFile ? `Do not duplicate this agent's work — avoid working with the same files or topics it is using. Work on non-overlapping tasks, or briefly tell the user what you launched and end your response.\noutput_file: ${data.outputFile}\nIf asked, you can check progress before completion by using ${FILE_READ_TOOL_NAME} or ${BASH_TOOL_NAME} tail on the output file.` : `Briefly tell the user what you launched and end your response. Do not generate any other text — agent results will arrive in a subsequent message.`;
      const text = `${prefix}\n${instructions}`;
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: [{
          type: 'text',
          text
        }]
      };
    }
// completed 状态：实际内容 + 一段 trailer（尾部元信息）。
//
// trailer 里有三样：agentId（可用于续用）、totalTokens、toolUses、
// durationMs。三者都是给模型判断"这次派活值不值"的线索。
//
// 第 1342 行还有 worktree 信息（如果有），因为那些文件需要人去处理。
    if (data.status === 'completed') {
      const worktreeData = data as Record<string, unknown>;
      const worktreeInfoText = worktreeData.worktreePath ? `\nworktreePath: ${worktreeData.worktreePath}\nworktreeBranch: ${worktreeData.worktreeBranch}` : '';
// ⚠️ 这个分支处理一个很容易被忽略的情况：**子 agent 什么都没说**。
//
// 注释（1343-1346 行）：
//   "If the subagent completes with no content, the tool_result is just the
//    agentId/usage trailer below — a metadata-only block at the prompt tail.
//    Some models read that as 'nothing to act on' and end their turn
//    immediately. Say so explicitly so the parent has something to react to."
//
// 场景：子 agent 跑完了，但最后一条消息是空的（干完了但没总结）。
// 于是 tool_result 里只剩下 agentId 和 usage —— 一堆元数据，没有内容。
// 模型看到这个会想："这没什么可回应的"，然后**直接结束轮次**，
// 用户就看到界面莫名其妙停住了。
//
// 解法：显式塞一句 "(Subagent completed but returned no output.)"
// 这不是给人看的，是给模型一个"可回应的对象"。
//
// 【这类修复的共同特征】
// 问题不在逻辑错误，而在**协议的语用层**：同样的数据，
// 有内容时模型知道该干什么，只有元数据时模型不知道该干什么。
// 加一句话就解决了 —— 但你得先意识到"空结果"是一种独立的失败模式。
      // If the subagent completes with no content, the tool_result is just the
      // agentId/usage trailer below — a metadata-only block at the prompt tail.
      // Some models read that as "nothing to act on" and end their turn
      // immediately. Say so explicitly so the parent has something to react to.
      const contentOrMarker = data.content.length > 0 ? data.content : [{
        type: 'text' as const,
        text: '(Subagent completed but returned no output.)'
      }];
// ⚠️ 全文件最"商业化"的一处优化，注释里的数字非常具体：
//
//   "One-shot built-ins (Explore, Plan) are never continued via SendMessage
//    — the agentId hint and <usage> block are dead weight
//    (~135 chars × 34M Explore runs/week ≈ 1-2 Gtok/week).
//    Telemetry doesn't parse this block (it uses logEvent in
//    finalizeAgentTool), so dropping is safe."
//
// 拆解：
//   · Explore / Plan 是**一次性**内置 agent，永远不会被续用
//   · 所以"用 SendMessage 可以继续这个 agent"的提示对它们是纯废话
//   · 这段废话约 135 字符
//   · Explore 每周跑 3,400 万次
//   · 135 × 34M ≈ 每周 1-2 G（十亿）token
//
// 于是加一个判断把它们省掉。这不是微优化 ——
// 每周十亿 token 的量级，按输入 token 计价是实打实的成本。
//
// 【三个必要条件，缺一不可】
//   ① 这些 agent 确实不会被续用（产品保证）
//   ② 遥测不依赖这段文本（遥测走 logEvent，不解析 tool_result）
//   ③ agentType 可能缺失（resume 老会话时没有这个字段）→ 有条件判断
//
// 【其中第 ② 条最容易被忽略】
// 如果遥测是靠正则解析 tool_result 里的 <usage> 块，这个优化就会
// 悄悄搞坏数据管道 —— 而且报错会在完全无关的地方出现。
// 所以注释专门写了 "Telemetry doesn't parse this block" ——
// 这是在为这个优化做**可删除性论证**。
      // One-shot built-ins (Explore, Plan) are never continued via SendMessage
      // — the agentId hint and <usage> block are dead weight (~135 chars ×
      // 34M Explore runs/week ≈ 1-2 Gtok/week). Telemetry doesn't parse this
      // block (it uses logEvent in finalizeAgentTool), so dropping is safe.
      // agentType is optional for resume compat — missing means show trailer.
      if (data.agentType && ONE_SHOT_BUILTIN_AGENT_TYPES.has(data.agentType) && !worktreeInfoText) {
        return {
          tool_use_id: toolUseID,
          type: 'tool_result',
          content: contentOrMarker
        };
      }
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: [...contentOrMarker, {
          type: 'text',
          text: `agentId: ${data.agentId} (use SendMessage with to: '${data.agentId}' to continue this agent)${worktreeInfoText}
<usage>total_tokens: ${data.totalTokens}
tool_uses: ${data.totalToolUseCount}
duration_ms: ${data.totalDurationMs}</usage>`
        }]
      };
    }
// data satisfies never —— 穷尽性检查。
//
// 如果将来给 Output 联合加了第五种 status 而忘了在这里处理，
// 这一行会编译失败。TypeScript 的 satisfies never 意思是
// "到这里 data 的类型应该是 never（所有分支都处理完了）"。
//
// 这比 default: throw 好，因为 default 会吞掉新状态（运行时才炸），
// 而 satisfies never 在编译期就拦住。
    data satisfies never;
    throw new Error(`Unexpected agent tool result status: ${(data as {
      status: string;
    }).status}`);
  },
  renderToolResultMessage,
  renderToolUseMessage,
  renderToolUseTag,
  renderToolUseProgressMessage,
  renderToolUseRejectedMessage,
  renderToolUseErrorMessage,
  renderGroupedToolUse: renderGroupedAgentToolUse
} satisfies ToolDef<InputSchema, Output, Progress>);
// ─────────────────────────────────────────────────────────────
// 【团队名的来源：参数优先，其次上下文】
//
// team_name 参数显式给了就用它；没给就从 appState.teamContext 取
// （也就是"当前会话已经在某个团队里"）。
//
// 【第一行的短路很关键】
//   if (!isAgentSwarmsEnabled()) return undefined
// 团队功能没开时，永远返回 undefined —— 于是第 284 行那个
// "teamName && name" 的判断恒假，整个 spawnTeammate 分支不会进入。
//
// 注意这和上面第 262 行的检查是两道：
//   262  用户显式传了 team_name 但功能没开 → **报错**（明确告知）
//   1395 只是从上下文继承 → **静默返回 undefined**（不打扰）
//
// 【为什么区别对待】
// 显式传参表示"我知道我要什么"，那是能力缺失，必须告知；
// 隐式继承表示"环境里碰巧有"，此时降级成普通子 agent 是最合理的。
// 同一个"功能不可用"，两种处理 —— 判据是**用户的意图是否明确**。
function resolveTeamName(input: {
  team_name?: string;
}, appState: {
  teamContext?: {
    teamName: string;
  };
}): string | undefined {
  if (!isAgentSwarmsEnabled()) return undefined;
  return input.team_name || appState.teamContext?.teamName;
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJmZWF0dXJlIiwiUmVhY3QiLCJidWlsZFRvb2wiLCJUb29sRGVmIiwidG9vbE1hdGNoZXNOYW1lIiwiTWVzc2FnZSIsIk1lc3NhZ2VUeXBlIiwiTm9ybWFsaXplZFVzZXJNZXNzYWdlIiwiZ2V0UXVlcnlTb3VyY2VGb3JBZ2VudCIsInoiLCJjbGVhckludm9rZWRTa2lsbHNGb3JBZ2VudCIsImdldFNka0FnZW50UHJvZ3Jlc3NTdW1tYXJpZXNFbmFibGVkIiwiZW5oYW5jZVN5c3RlbVByb21wdFdpdGhFbnZEZXRhaWxzIiwiZ2V0U3lzdGVtUHJvbXB0IiwiaXNDb29yZGluYXRvck1vZGUiLCJzdGFydEFnZW50U3VtbWFyaXphdGlvbiIsImdldEZlYXR1cmVWYWx1ZV9DQUNIRURfTUFZX0JFX1NUQUxFIiwiQW5hbHl0aWNzTWV0YWRhdGFfSV9WRVJJRklFRF9USElTX0lTX05PVF9DT0RFX09SX0ZJTEVQQVRIUyIsImxvZ0V2ZW50IiwiY2xlYXJEdW1wU3RhdGUiLCJjb21wbGV0ZUFnZW50VGFzayIsImNvbXBsZXRlQXN5bmNBZ2VudCIsImNyZWF0ZUFjdGl2aXR5RGVzY3JpcHRpb25SZXNvbHZlciIsImNyZWF0ZVByb2dyZXNzVHJhY2tlciIsImVucXVldWVBZ2VudE5vdGlmaWNhdGlvbiIsImZhaWxBZ2VudFRhc2siLCJmYWlsQXN5bmNBZ2VudCIsImdldFByb2dyZXNzVXBkYXRlIiwiZ2V0VG9rZW5Db3VudEZyb21UcmFja2VyIiwiaXNMb2NhbEFnZW50VGFzayIsImtpbGxBc3luY0FnZW50IiwicmVnaXN0ZXJBZ2VudEZvcmVncm91bmQiLCJyZWdpc3RlckFzeW5jQWdlbnQiLCJ1bnJlZ2lzdGVyQWdlbnRGb3JlZ3JvdW5kIiwidXBkYXRlQWdlbnRQcm9ncmVzcyIsInVwZGF0ZUFzeW5jQWdlbnRQcm9ncmVzcyIsInVwZGF0ZVByb2dyZXNzRnJvbU1lc3NhZ2UiLCJjaGVja1JlbW90ZUFnZW50RWxpZ2liaWxpdHkiLCJmb3JtYXRQcmVjb25kaXRpb25FcnJvciIsImdldFJlbW90ZVRhc2tTZXNzaW9uVXJsIiwicmVnaXN0ZXJSZW1vdGVBZ2VudFRhc2siLCJhc3NlbWJsZVRvb2xQb29sIiwiYXNBZ2VudElkIiwicnVuV2l0aEFnZW50Q29udGV4dCIsImlzQWdlbnRTd2FybXNFbmFibGVkIiwiZ2V0Q3dkIiwicnVuV2l0aEN3ZE92ZXJyaWRlIiwibG9nRm9yRGVidWdnaW5nIiwiaXNFbnZUcnV0aHkiLCJBYm9ydEVycm9yIiwiZXJyb3JNZXNzYWdlIiwidG9FcnJvciIsIkNhY2hlU2FmZVBhcmFtcyIsImxhenlTY2hlbWEiLCJjcmVhdGVVc2VyTWVzc2FnZSIsImV4dHJhY3RUZXh0Q29udGVudCIsImlzU3ludGhldGljTWVzc2FnZSIsIm5vcm1hbGl6ZU1lc3NhZ2VzIiwiZ2V0QWdlbnRNb2RlbCIsInBlcm1pc3Npb25Nb2RlU2NoZW1hIiwiUGVybWlzc2lvblJlc3VsdCIsImZpbHRlckRlbmllZEFnZW50cyIsImdldERlbnlSdWxlRm9yQWdlbnQiLCJlbnF1ZXVlU2RrRXZlbnQiLCJ3cml0ZUFnZW50TWV0YWRhdGEiLCJzbGVlcCIsImJ1aWxkRWZmZWN0aXZlU3lzdGVtUHJvbXB0IiwiYXNTeXN0ZW1Qcm9tcHQiLCJnZXRUYXNrT3V0cHV0UGF0aCIsImdldFBhcmVudFNlc3Npb25JZCIsImlzVGVhbW1hdGUiLCJpc0luUHJvY2Vzc1RlYW1tYXRlIiwidGVsZXBvcnRUb1JlbW90ZSIsImdldEFzc2lzdGFudE1lc3NhZ2VDb250ZW50TGVuZ3RoIiwiY3JlYXRlQWdlbnRJZCIsImNyZWF0ZUFnZW50V29ya3RyZWUiLCJoYXNXb3JrdHJlZUNoYW5nZXMiLCJyZW1vdmVBZ2VudFdvcmt0cmVlIiwiQkFTSF9UT09MX05BTUUiLCJCYWNrZ3JvdW5kSGludCIsIkZJTEVfUkVBRF9UT09MX05BTUUiLCJzcGF3blRlYW1tYXRlIiwic2V0QWdlbnRDb2xvciIsImFnZW50VG9vbFJlc3VsdFNjaGVtYSIsImNsYXNzaWZ5SGFuZG9mZklmTmVlZGVkIiwiZW1pdFRhc2tQcm9ncmVzcyIsImV4dHJhY3RQYXJ0aWFsUmVzdWx0IiwiZmluYWxpemVBZ2VudFRvb2wiLCJnZXRMYXN0VG9vbFVzZU5hbWUiLCJydW5Bc3luY0FnZW50TGlmZWN5Y2xlIiwiR0VORVJBTF9QVVJQT1NFX0FHRU5UIiwiQUdFTlRfVE9PTF9OQU1FIiwiTEVHQUNZX0FHRU5UX1RPT0xfTkFNRSIsIk9ORV9TSE9UX0JVSUxUSU5fQUdFTlRfVFlQRVMiLCJidWlsZEZvcmtlZE1lc3NhZ2VzIiwiYnVpbGRXb3JrdHJlZU5vdGljZSIsIkZPUktfQUdFTlQiLCJpc0ZvcmtTdWJhZ2VudEVuYWJsZWQiLCJpc0luRm9ya0NoaWxkIiwiQWdlbnREZWZpbml0aW9uIiwiZmlsdGVyQWdlbnRzQnlNY3BSZXF1aXJlbWVudHMiLCJoYXNSZXF1aXJlZE1jcFNlcnZlcnMiLCJpc0J1aWx0SW5BZ2VudCIsImdldFByb21wdCIsInJ1bkFnZW50IiwicmVuZGVyR3JvdXBlZEFnZW50VG9vbFVzZSIsInJlbmRlclRvb2xSZXN1bHRNZXNzYWdlIiwicmVuZGVyVG9vbFVzZUVycm9yTWVzc2FnZSIsInJlbmRlclRvb2xVc2VNZXNzYWdlIiwicmVuZGVyVG9vbFVzZVByb2dyZXNzTWVzc2FnZSIsInJlbmRlclRvb2xVc2VSZWplY3RlZE1lc3NhZ2UiLCJyZW5kZXJUb29sVXNlVGFnIiwidXNlckZhY2luZ05hbWUiLCJ1c2VyRmFjaW5nTmFtZUJhY2tncm91bmRDb2xvciIsInByb2FjdGl2ZU1vZHVsZSIsInJlcXVpcmUiLCJQUk9HUkVTU19USFJFU0hPTERfTVMiLCJpc0JhY2tncm91bmRUYXNrc0Rpc2FibGVkIiwicHJvY2VzcyIsImVudiIsIkNMQVVERV9DT0RFX0RJU0FCTEVfQkFDS0dST1VORF9UQVNLUyIsImdldEF1dG9CYWNrZ3JvdW5kTXMiLCJDTEFVREVfQVVUT19CQUNLR1JPVU5EX1RBU0tTIiwiYmFzZUlucHV0U2NoZW1hIiwib2JqZWN0IiwiZGVzY3JpcHRpb24iLCJzdHJpbmciLCJkZXNjcmliZSIsInByb21wdCIsInN1YmFnZW50X3R5cGUiLCJvcHRpb25hbCIsIm1vZGVsIiwiZW51bSIsInJ1bl9pbl9iYWNrZ3JvdW5kIiwiYm9vbGVhbiIsImZ1bGxJbnB1dFNjaGVtYSIsIm11bHRpQWdlbnRJbnB1dFNjaGVtYSIsIm5hbWUiLCJ0ZWFtX25hbWUiLCJtb2RlIiwibWVyZ2UiLCJleHRlbmQiLCJpc29sYXRpb24iLCJjd2QiLCJpbnB1dFNjaGVtYSIsInNjaGVtYSIsIm9taXQiLCJJbnB1dFNjaGVtYSIsIlJldHVyblR5cGUiLCJBZ2VudFRvb2xJbnB1dCIsImluZmVyIiwib3V0cHV0U2NoZW1hIiwic3luY091dHB1dFNjaGVtYSIsInN0YXR1cyIsImxpdGVyYWwiLCJhc3luY091dHB1dFNjaGVtYSIsImFnZW50SWQiLCJvdXRwdXRGaWxlIiwiY2FuUmVhZE91dHB1dEZpbGUiLCJ1bmlvbiIsIk91dHB1dFNjaGVtYSIsIk91dHB1dCIsImlucHV0IiwiVGVhbW1hdGVTcGF3bmVkT3V0cHV0IiwidGVhbW1hdGVfaWQiLCJhZ2VudF9pZCIsImFnZW50X3R5cGUiLCJjb2xvciIsInRtdXhfc2Vzc2lvbl9uYW1lIiwidG11eF93aW5kb3dfbmFtZSIsInRtdXhfcGFuZV9pZCIsImlzX3NwbGl0cGFuZSIsInBsYW5fbW9kZV9yZXF1aXJlZCIsIlJlbW90ZUxhdW5jaGVkT3V0cHV0IiwidGFza0lkIiwic2Vzc2lvblVybCIsIkludGVybmFsT3V0cHV0IiwiQWdlbnRUb29sUHJvZ3Jlc3MiLCJTaGVsbFByb2dyZXNzIiwiUHJvZ3Jlc3MiLCJBZ2VudFRvb2wiLCJhZ2VudHMiLCJ0b29scyIsImdldFRvb2xQZXJtaXNzaW9uQ29udGV4dCIsImFsbG93ZWRBZ2VudFR5cGVzIiwidG9vbFBlcm1pc3Npb25Db250ZXh0IiwibWNwU2VydmVyc1dpdGhUb29scyIsInRvb2wiLCJzdGFydHNXaXRoIiwicGFydHMiLCJzcGxpdCIsInNlcnZlck5hbWUiLCJpbmNsdWRlcyIsInB1c2giLCJhZ2VudHNXaXRoTWNwUmVxdWlyZW1lbnRzTWV0IiwiZmlsdGVyZWRBZ2VudHMiLCJpc0Nvb3JkaW5hdG9yIiwiQ0xBVURFX0NPREVfQ09PUkRJTkFUT1JfTU9ERSIsInNlYXJjaEhpbnQiLCJhbGlhc2VzIiwibWF4UmVzdWx0U2l6ZUNoYXJzIiwiY2FsbCIsIm1vZGVsUGFyYW0iLCJzcGF3bk1vZGUiLCJ0b29sVXNlQ29udGV4dCIsImNhblVzZVRvb2wiLCJhc3Npc3RhbnRNZXNzYWdlIiwib25Qcm9ncmVzcyIsInN0YXJ0VGltZSIsIkRhdGUiLCJub3ciLCJ1bmRlZmluZWQiLCJhcHBTdGF0ZSIsImdldEFwcFN0YXRlIiwicGVybWlzc2lvbk1vZGUiLCJyb290U2V0QXBwU3RhdGUiLCJzZXRBcHBTdGF0ZUZvclRhc2tzIiwic2V0QXBwU3RhdGUiLCJFcnJvciIsInRlYW1OYW1lIiwicmVzb2x2ZVRlYW1OYW1lIiwiYWdlbnREZWYiLCJvcHRpb25zIiwiYWdlbnREZWZpbml0aW9ucyIsImFjdGl2ZUFnZW50cyIsImZpbmQiLCJhIiwiYWdlbnRUeXBlIiwicmVzdWx0IiwidXNlX3NwbGl0cGFuZSIsImludm9raW5nUmVxdWVzdElkIiwicmVxdWVzdElkIiwic3Bhd25SZXN1bHQiLCJjb25zdCIsImRhdGEiLCJlZmZlY3RpdmVUeXBlIiwiaXNGb3JrUGF0aCIsInNlbGVjdGVkQWdlbnQiLCJxdWVyeVNvdXJjZSIsIm1lc3NhZ2VzIiwiYWxsQWdlbnRzIiwiZmlsdGVyIiwiZm91bmQiLCJhZ2VudCIsImFnZW50RXhpc3RzQnV0RGVuaWVkIiwiZGVueVJ1bGUiLCJzb3VyY2UiLCJtYXAiLCJqb2luIiwiYmFja2dyb3VuZCIsInJlcXVpcmVkTWNwU2VydmVycyIsImxlbmd0aCIsImhhc1BlbmRpbmdSZXF1aXJlZFNlcnZlcnMiLCJtY3AiLCJjbGllbnRzIiwic29tZSIsImMiLCJ0eXBlIiwicGF0dGVybiIsInRvTG93ZXJDYXNlIiwiY3VycmVudEFwcFN0YXRlIiwiTUFYX1dBSVRfTVMiLCJQT0xMX0lOVEVSVkFMX01TIiwiZGVhZGxpbmUiLCJoYXNGYWlsZWRSZXF1aXJlZFNlcnZlciIsInN0aWxsUGVuZGluZyIsInNlcnZlcnNXaXRoVG9vbHMiLCJtaXNzaW5nIiwic2VydmVyIiwicmVzb2x2ZWRBZ2VudE1vZGVsIiwibWFpbkxvb3BNb2RlbCIsImlzX2J1aWx0X2luX2FnZW50IiwiaXNfcmVzdW1lIiwiaXNfYXN5bmMiLCJpc19mb3JrIiwiZWZmZWN0aXZlSXNvbGF0aW9uIiwiZWxpZ2liaWxpdHkiLCJlbGlnaWJsZSIsInJlYXNvbnMiLCJlcnJvcnMiLCJidW5kbGVGYWlsSGludCIsInNlc3Npb24iLCJpbml0aWFsTWVzc2FnZSIsInNpZ25hbCIsImFib3J0Q29udHJvbGxlciIsIm9uQnVuZGxlRmFpbCIsIm1zZyIsInNlc3Npb25JZCIsInJlbW90ZVRhc2tUeXBlIiwiaWQiLCJ0aXRsZSIsImNvbW1hbmQiLCJjb250ZXh0IiwidG9vbFVzZUlkIiwicmVtb3RlUmVzdWx0IiwiZW5oYW5jZWRTeXN0ZW1Qcm9tcHQiLCJmb3JrUGFyZW50U3lzdGVtUHJvbXB0IiwicHJvbXB0TWVzc2FnZXMiLCJyZW5kZXJlZFN5c3RlbVByb21wdCIsIm1haW5UaHJlYWRBZ2VudERlZmluaXRpb24iLCJhZGRpdGlvbmFsV29ya2luZ0RpcmVjdG9yaWVzIiwiQXJyYXkiLCJmcm9tIiwia2V5cyIsImRlZmF1bHRTeXN0ZW1Qcm9tcHQiLCJtY3BDbGllbnRzIiwiY3VzdG9tU3lzdGVtUHJvbXB0IiwiYXBwZW5kU3lzdGVtUHJvbXB0IiwiYWdlbnRQcm9tcHQiLCJtZW1vcnkiLCJzY29wZSIsImVycm9yIiwiY29udGVudCIsIm1ldGFkYXRhIiwiaXNBc3luYyIsImZvcmNlQXN5bmMiLCJhc3Npc3RhbnRGb3JjZUFzeW5jIiwia2Fpcm9zRW5hYmxlZCIsInNob3VsZFJ1bkFzeW5jIiwiaXNQcm9hY3RpdmVBY3RpdmUiLCJ3b3JrZXJQZXJtaXNzaW9uQ29udGV4dCIsIndvcmtlclRvb2xzIiwiZWFybHlBZ2VudElkIiwid29ya3RyZWVJbmZvIiwid29ya3RyZWVQYXRoIiwid29ya3RyZWVCcmFuY2giLCJoZWFkQ29tbWl0IiwiZ2l0Um9vdCIsImhvb2tCYXNlZCIsInNsdWciLCJzbGljZSIsInJ1bkFnZW50UGFyYW1zIiwiUGFyYW1ldGVycyIsImFnZW50RGVmaW5pdGlvbiIsIm92ZXJyaWRlIiwic3lzdGVtUHJvbXB0IiwiYXZhaWxhYmxlVG9vbHMiLCJmb3JrQ29udGV4dE1lc3NhZ2VzIiwidXNlRXhhY3RUb29scyIsImN3ZE92ZXJyaWRlUGF0aCIsIndyYXBXaXRoQ3dkIiwiZm4iLCJUIiwiY2xlYW51cFdvcmt0cmVlSWZOZWVkZWQiLCJQcm9taXNlIiwiY2hhbmdlZCIsImNhdGNoIiwiX2VyciIsImFzeW5jQWdlbnRJZCIsImFnZW50QmFja2dyb3VuZFRhc2siLCJwcmV2IiwibmV4dCIsIk1hcCIsImFnZW50TmFtZVJlZ2lzdHJ5Iiwic2V0IiwiYXN5bmNBZ2VudENvbnRleHQiLCJwYXJlbnRTZXNzaW9uSWQiLCJzdWJhZ2VudE5hbWUiLCJpc0J1aWx0SW4iLCJpbnZvY2F0aW9uS2luZCIsImludm9jYXRpb25FbWl0dGVkIiwibWFrZVN0cmVhbSIsIm9uQ2FjaGVTYWZlUGFyYW1zIiwiYWdlbnRJZEZvckNsZWFudXAiLCJlbmFibGVTdW1tYXJpemF0aW9uIiwiZ2V0V29ya3RyZWVSZXN1bHQiLCJ0Iiwic3luY0FnZW50SWQiLCJzeW5jQWdlbnRDb250ZXh0IiwiYWdlbnRNZXNzYWdlcyIsImFnZW50U3RhcnRUaW1lIiwic3luY1RyYWNrZXIiLCJzeW5jUmVzb2x2ZUFjdGl2aXR5Iiwibm9ybWFsaXplZFByb21wdE1lc3NhZ2VzIiwibm9ybWFsaXplZEZpcnN0TWVzc2FnZSIsIm0iLCJ0b29sVXNlSUQiLCJtZXNzYWdlIiwiZm9yZWdyb3VuZFRhc2tJZCIsImJhY2tncm91bmRQcm9taXNlIiwiY2FuY2VsQXV0b0JhY2tncm91bmQiLCJyZWdpc3RyYXRpb24iLCJhdXRvQmFja2dyb3VuZE1zIiwiYmFja2dyb3VuZFNpZ25hbCIsInRoZW4iLCJiYWNrZ3JvdW5kSGludFNob3duIiwid2FzQmFja2dyb3VuZGVkIiwic3RvcEZvcmVncm91bmRTdW1tYXJpemF0aW9uIiwic3VtbWFyeVRhc2tJZCIsImFnZW50SXRlcmF0b3IiLCJwYXJhbXMiLCJzdG9wIiwiU3ltYm9sIiwiYXN5bmNJdGVyYXRvciIsInN5bmNBZ2VudEVycm9yIiwid2FzQWJvcnRlZCIsIndvcmt0cmVlUmVzdWx0IiwiZWxhcHNlZCIsInNldFRvb2xKU1giLCJqc3giLCJzaG91bGRIaWRlUHJvbXB0SW5wdXQiLCJzaG91bGRDb250aW51ZUFuaW1hdGlvbiIsInNob3dTcGlubmVyIiwibmV4dE1lc3NhZ2VQcm9taXNlIiwicmFjZVJlc3VsdCIsInJhY2UiLCJyIiwidGFzayIsInRhc2tzIiwiaXNCYWNrZ3JvdW5kZWQiLCJiYWNrZ3JvdW5kZWRUYXNrSWQiLCJzdG9wQmFja2dyb3VuZGVkU3VtbWFyaXphdGlvbiIsInJldHVybiIsInRyYWNrZXIiLCJyZXNvbHZlQWN0aXZpdHkyIiwiZXhpc3RpbmdNc2ciLCJsYXN0VG9vbE5hbWUiLCJhZ2VudFJlc3VsdCIsImZpbmFsTWVzc2FnZSIsImJhY2tncm91bmRlZEFwcFN0YXRlIiwiaGFuZG9mZldhcm5pbmciLCJhYm9ydFNpZ25hbCIsInN1YmFnZW50VHlwZSIsInRvdGFsVG9vbFVzZUNvdW50IiwidXNhZ2UiLCJ0b3RhbFRva2VucyIsInRvb2xVc2VzIiwiZHVyYXRpb25NcyIsInRvdGFsRHVyYXRpb25NcyIsImR1cmF0aW9uX21zIiwicmVhc29uIiwicGFydGlhbFJlc3VsdCIsImVyck1zZyIsImRvbmUiLCJ2YWx1ZSIsImNvbnRlbnRMZW5ndGgiLCJzZXRSZXNwb25zZUxlbmd0aCIsImxlbiIsIm5vcm1hbGl6ZWROZXciLCJsZXZlbCIsInByb2dyZXNzIiwic3VidHlwZSIsInRhc2tfaWQiLCJ0b29sX3VzZV9pZCIsIm91dHB1dF9maWxlIiwic3VtbWFyeSIsInRvdGFsX3Rva2VucyIsInRva2VuQ291bnQiLCJ0b29sX3VzZXMiLCJ0b29sVXNlQ291bnQiLCJsYXN0TWVzc2FnZSIsImZpbmRMYXN0IiwiXyIsImhhc0Fzc2lzdGFudE1lc3NhZ2VzIiwidGV4dCIsImlzUmVhZE9ubHkiLCJ0b0F1dG9DbGFzc2lmaWVySW5wdXQiLCJpIiwidGFncyIsInByZWZpeCIsImlzQ29uY3VycmVuY3lTYWZlIiwiZ2V0QWN0aXZpdHlEZXNjcmlwdGlvbiIsImNoZWNrUGVybWlzc2lvbnMiLCJiZWhhdmlvciIsInVwZGF0ZWRJbnB1dCIsIm1hcFRvb2xSZXN1bHRUb1Rvb2xSZXN1bHRCbG9ja1BhcmFtIiwiaW50ZXJuYWxEYXRhIiwic3Bhd25EYXRhIiwiaW5zdHJ1Y3Rpb25zIiwid29ya3RyZWVEYXRhIiwiUmVjb3JkIiwid29ya3RyZWVJbmZvVGV4dCIsImNvbnRlbnRPck1hcmtlciIsImhhcyIsInJlbmRlckdyb3VwZWRUb29sVXNlIiwidGVhbUNvbnRleHQiXSwic291cmNlcyI6WyJBZ2VudFRvb2wudHN4Il0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGZlYXR1cmUgfSBmcm9tICdidW46YnVuZGxlJ1xuaW1wb3J0ICogYXMgUmVhY3QgZnJvbSAncmVhY3QnXG5pbXBvcnQgeyBidWlsZFRvb2wsIHR5cGUgVG9vbERlZiwgdG9vbE1hdGNoZXNOYW1lIH0gZnJvbSAnc3JjL1Rvb2wuanMnXG5pbXBvcnQgdHlwZSB7XG4gIE1lc3NhZ2UgYXMgTWVzc2FnZVR5cGUsXG4gIE5vcm1hbGl6ZWRVc2VyTWVzc2FnZSxcbn0gZnJvbSAnc3JjL3R5cGVzL21lc3NhZ2UuanMnXG5pbXBvcnQgeyBnZXRRdWVyeVNvdXJjZUZvckFnZW50IH0gZnJvbSAnc3JjL3V0aWxzL3Byb21wdENhdGVnb3J5LmpzJ1xuaW1wb3J0IHsgeiB9IGZyb20gJ3pvZC92NCdcbmltcG9ydCB7XG4gIGNsZWFySW52b2tlZFNraWxsc0ZvckFnZW50LFxuICBnZXRTZGtBZ2VudFByb2dyZXNzU3VtbWFyaWVzRW5hYmxlZCxcbn0gZnJvbSAnLi4vLi4vYm9vdHN0cmFwL3N0YXRlLmpzJ1xuaW1wb3J0IHtcbiAgZW5oYW5jZVN5c3RlbVByb21wdFdpdGhFbnZEZXRhaWxzLFxuICBnZXRTeXN0ZW1Qcm9tcHQsXG59IGZyb20gJy4uLy4uL2NvbnN0YW50cy9wcm9tcHRzLmpzJ1xuaW1wb3J0IHsgaXNDb29yZGluYXRvck1vZGUgfSBmcm9tICcuLi8uLi9jb29yZGluYXRvci9jb29yZGluYXRvck1vZGUuanMnXG5pbXBvcnQgeyBzdGFydEFnZW50U3VtbWFyaXphdGlvbiB9IGZyb20gJy4uLy4uL3NlcnZpY2VzL0FnZW50U3VtbWFyeS9hZ2VudFN1bW1hcnkuanMnXG5pbXBvcnQgeyBnZXRGZWF0dXJlVmFsdWVfQ0FDSEVEX01BWV9CRV9TVEFMRSB9IGZyb20gJy4uLy4uL3NlcnZpY2VzL2FuYWx5dGljcy9ncm93dGhib29rLmpzJ1xuaW1wb3J0IHtcbiAgdHlwZSBBbmFseXRpY3NNZXRhZGF0YV9JX1ZFUklGSUVEX1RISVNfSVNfTk9UX0NPREVfT1JfRklMRVBBVEhTLFxuICBsb2dFdmVudCxcbn0gZnJvbSAnLi4vLi4vc2VydmljZXMvYW5hbHl0aWNzL2luZGV4LmpzJ1xuaW1wb3J0IHsgY2xlYXJEdW1wU3RhdGUgfSBmcm9tICcuLi8uLi9zZXJ2aWNlcy9hcGkvZHVtcFByb21wdHMuanMnXG5pbXBvcnQge1xuICBjb21wbGV0ZUFnZW50VGFzayBhcyBjb21wbGV0ZUFzeW5jQWdlbnQsXG4gIGNyZWF0ZUFjdGl2aXR5RGVzY3JpcHRpb25SZXNvbHZlcixcbiAgY3JlYXRlUHJvZ3Jlc3NUcmFja2VyLFxuICBlbnF1ZXVlQWdlbnROb3RpZmljYXRpb24sXG4gIGZhaWxBZ2VudFRhc2sgYXMgZmFpbEFzeW5jQWdlbnQsXG4gIGdldFByb2dyZXNzVXBkYXRlLFxuICBnZXRUb2tlbkNvdW50RnJvbVRyYWNrZXIsXG4gIGlzTG9jYWxBZ2VudFRhc2ssXG4gIGtpbGxBc3luY0FnZW50LFxuICByZWdpc3RlckFnZW50Rm9yZWdyb3VuZCxcbiAgcmVnaXN0ZXJBc3luY0FnZW50LFxuICB1bnJlZ2lzdGVyQWdlbnRGb3JlZ3JvdW5kLFxuICB1cGRhdGVBZ2VudFByb2dyZXNzIGFzIHVwZGF0ZUFzeW5jQWdlbnRQcm9ncmVzcyxcbiAgdXBkYXRlUHJvZ3Jlc3NGcm9tTWVzc2FnZSxcbn0gZnJvbSAnLi4vLi4vdGFza3MvTG9jYWxBZ2VudFRhc2svTG9jYWxBZ2VudFRhc2suanMnXG5pbXBvcnQge1xuICBjaGVja1JlbW90ZUFnZW50RWxpZ2liaWxpdHksXG4gIGZvcm1hdFByZWNvbmRpdGlvbkVycm9yLFxuICBnZXRSZW1vdGVUYXNrU2Vzc2lvblVybCxcbiAgcmVnaXN0ZXJSZW1vdGVBZ2VudFRhc2ssXG59IGZyb20gJy4uLy4uL3Rhc2tzL1JlbW90ZUFnZW50VGFzay9SZW1vdGVBZ2VudFRhc2suanMnXG5pbXBvcnQgeyBhc3NlbWJsZVRvb2xQb29sIH0gZnJvbSAnLi4vLi4vdG9vbHMuanMnXG5pbXBvcnQgeyBhc0FnZW50SWQgfSBmcm9tICcuLi8uLi90eXBlcy9pZHMuanMnXG5pbXBvcnQgeyBydW5XaXRoQWdlbnRDb250ZXh0IH0gZnJvbSAnLi4vLi4vdXRpbHMvYWdlbnRDb250ZXh0LmpzJ1xuaW1wb3J0IHsgaXNBZ2VudFN3YXJtc0VuYWJsZWQgfSBmcm9tICcuLi8uLi91dGlscy9hZ2VudFN3YXJtc0VuYWJsZWQuanMnXG5pbXBvcnQgeyBnZXRDd2QsIHJ1bldpdGhDd2RPdmVycmlkZSB9IGZyb20gJy4uLy4uL3V0aWxzL2N3ZC5qcydcbmltcG9ydCB7IGxvZ0ZvckRlYnVnZ2luZyB9IGZyb20gJy4uLy4uL3V0aWxzL2RlYnVnLmpzJ1xuaW1wb3J0IHsgaXNFbnZUcnV0aHkgfSBmcm9tICcuLi8uLi91dGlscy9lbnZVdGlscy5qcydcbmltcG9ydCB7IEFib3J0RXJyb3IsIGVycm9yTWVzc2FnZSwgdG9FcnJvciB9IGZyb20gJy4uLy4uL3V0aWxzL2Vycm9ycy5qcydcbmltcG9ydCB0eXBlIHsgQ2FjaGVTYWZlUGFyYW1zIH0gZnJvbSAnLi4vLi4vdXRpbHMvZm9ya2VkQWdlbnQuanMnXG5pbXBvcnQgeyBsYXp5U2NoZW1hIH0gZnJvbSAnLi4vLi4vdXRpbHMvbGF6eVNjaGVtYS5qcydcbmltcG9ydCB7XG4gIGNyZWF0ZVVzZXJNZXNzYWdlLFxuICBleHRyYWN0VGV4dENvbnRlbnQsXG4gIGlzU3ludGhldGljTWVzc2FnZSxcbiAgbm9ybWFsaXplTWVzc2FnZXMsXG59IGZyb20gJy4uLy4uL3V0aWxzL21lc3NhZ2VzLmpzJ1xuaW1wb3J0IHsgZ2V0QWdlbnRNb2RlbCB9IGZyb20gJy4uLy4uL3V0aWxzL21vZGVsL2FnZW50LmpzJ1xuaW1wb3J0IHsgcGVybWlzc2lvbk1vZGVTY2hlbWEgfSBmcm9tICcuLi8uLi91dGlscy9wZXJtaXNzaW9ucy9QZXJtaXNzaW9uTW9kZS5qcydcbmltcG9ydCB0eXBlIHsgUGVybWlzc2lvblJlc3VsdCB9IGZyb20gJy4uLy4uL3V0aWxzL3Blcm1pc3Npb25zL1Blcm1pc3Npb25SZXN1bHQuanMnXG5pbXBvcnQge1xuICBmaWx0ZXJEZW5pZWRBZ2VudHMsXG4gIGdldERlbnlSdWxlRm9yQWdlbnQsXG59IGZyb20gJy4uLy4uL3V0aWxzL3Blcm1pc3Npb25zL3Blcm1pc3Npb25zLmpzJ1xuaW1wb3J0IHsgZW5xdWV1ZVNka0V2ZW50IH0gZnJvbSAnLi4vLi4vdXRpbHMvc2RrRXZlbnRRdWV1ZS5qcydcbmltcG9ydCB7IHdyaXRlQWdlbnRNZXRhZGF0YSB9IGZyb20gJy4uLy4uL3V0aWxzL3Nlc3Npb25TdG9yYWdlLmpzJ1xuaW1wb3J0IHsgc2xlZXAgfSBmcm9tICcuLi8uLi91dGlscy9zbGVlcC5qcydcbmltcG9ydCB7IGJ1aWxkRWZmZWN0aXZlU3lzdGVtUHJvbXB0IH0gZnJvbSAnLi4vLi4vdXRpbHMvc3lzdGVtUHJvbXB0LmpzJ1xuaW1wb3J0IHsgYXNTeXN0ZW1Qcm9tcHQgfSBmcm9tICcuLi8uLi91dGlscy9zeXN0ZW1Qcm9tcHRUeXBlLmpzJ1xuaW1wb3J0IHsgZ2V0VGFza091dHB1dFBhdGggfSBmcm9tICcuLi8uLi91dGlscy90YXNrL2Rpc2tPdXRwdXQuanMnXG5pbXBvcnQgeyBnZXRQYXJlbnRTZXNzaW9uSWQsIGlzVGVhbW1hdGUgfSBmcm9tICcuLi8uLi91dGlscy90ZWFtbWF0ZS5qcydcbmltcG9ydCB7IGlzSW5Qcm9jZXNzVGVhbW1hdGUgfSBmcm9tICcuLi8uLi91dGlscy90ZWFtbWF0ZUNvbnRleHQuanMnXG5pbXBvcnQgeyB0ZWxlcG9ydFRvUmVtb3RlIH0gZnJvbSAnLi4vLi4vdXRpbHMvdGVsZXBvcnQuanMnXG5pbXBvcnQgeyBnZXRBc3Npc3RhbnRNZXNzYWdlQ29udGVudExlbmd0aCB9IGZyb20gJy4uLy4uL3V0aWxzL3Rva2Vucy5qcydcbmltcG9ydCB7IGNyZWF0ZUFnZW50SWQgfSBmcm9tICcuLi8uLi91dGlscy91dWlkLmpzJ1xuaW1wb3J0IHtcbiAgY3JlYXRlQWdlbnRXb3JrdHJlZSxcbiAgaGFzV29ya3RyZWVDaGFuZ2VzLFxuICByZW1vdmVBZ2VudFdvcmt0cmVlLFxufSBmcm9tICcuLi8uLi91dGlscy93b3JrdHJlZS5qcydcbmltcG9ydCB7IEJBU0hfVE9PTF9OQU1FIH0gZnJvbSAnLi4vQmFzaFRvb2wvdG9vbE5hbWUuanMnXG5pbXBvcnQgeyBCYWNrZ3JvdW5kSGludCB9IGZyb20gJy4uL0Jhc2hUb29sL1VJLmpzJ1xuaW1wb3J0IHsgRklMRV9SRUFEX1RPT0xfTkFNRSB9IGZyb20gJy4uL0ZpbGVSZWFkVG9vbC9wcm9tcHQuanMnXG5pbXBvcnQgeyBzcGF3blRlYW1tYXRlIH0gZnJvbSAnLi4vc2hhcmVkL3NwYXduTXVsdGlBZ2VudC5qcydcbmltcG9ydCB7IHNldEFnZW50Q29sb3IgfSBmcm9tICcuL2FnZW50Q29sb3JNYW5hZ2VyLmpzJ1xuaW1wb3J0IHtcbiAgYWdlbnRUb29sUmVzdWx0U2NoZW1hLFxuICBjbGFzc2lmeUhhbmRvZmZJZk5lZWRlZCxcbiAgZW1pdFRhc2tQcm9ncmVzcyxcbiAgZXh0cmFjdFBhcnRpYWxSZXN1bHQsXG4gIGZpbmFsaXplQWdlbnRUb29sLFxuICBnZXRMYXN0VG9vbFVzZU5hbWUsXG4gIHJ1bkFzeW5jQWdlbnRMaWZlY3ljbGUsXG59IGZyb20gJy4vYWdlbnRUb29sVXRpbHMuanMnXG5pbXBvcnQgeyBHRU5FUkFMX1BVUlBPU0VfQUdFTlQgfSBmcm9tICcuL2J1aWx0LWluL2dlbmVyYWxQdXJwb3NlQWdlbnQuanMnXG5pbXBvcnQge1xuICBBR0VOVF9UT09MX05BTUUsXG4gIExFR0FDWV9BR0VOVF9UT09MX05BTUUsXG4gIE9ORV9TSE9UX0JVSUxUSU5fQUdFTlRfVFlQRVMsXG59IGZyb20gJy4vY29uc3RhbnRzLmpzJ1xuaW1wb3J0IHtcbiAgYnVpbGRGb3JrZWRNZXNzYWdlcyxcbiAgYnVpbGRXb3JrdHJlZU5vdGljZSxcbiAgRk9SS19BR0VOVCxcbiAgaXNGb3JrU3ViYWdlbnRFbmFibGVkLFxuICBpc0luRm9ya0NoaWxkLFxufSBmcm9tICcuL2ZvcmtTdWJhZ2VudC5qcydcbmltcG9ydCB0eXBlIHsgQWdlbnREZWZpbml0aW9uIH0gZnJvbSAnLi9sb2FkQWdlbnRzRGlyLmpzJ1xuaW1wb3J0IHtcbiAgZmlsdGVyQWdlbnRzQnlNY3BSZXF1aXJlbWVudHMsXG4gIGhhc1JlcXVpcmVkTWNwU2VydmVycyxcbiAgaXNCdWlsdEluQWdlbnQsXG59IGZyb20gJy4vbG9hZEFnZW50c0Rpci5qcydcbmltcG9ydCB7IGdldFByb21wdCB9IGZyb20gJy4vcHJvbXB0LmpzJ1xuaW1wb3J0IHsgcnVuQWdlbnQgfSBmcm9tICcuL3J1bkFnZW50LmpzJ1xuaW1wb3J0IHtcbiAgcmVuZGVyR3JvdXBlZEFnZW50VG9vbFVzZSxcbiAgcmVuZGVyVG9vbFJlc3VsdE1lc3NhZ2UsXG4gIHJlbmRlclRvb2xVc2VFcnJvck1lc3NhZ2UsXG4gIHJlbmRlclRvb2xVc2VNZXNzYWdlLFxuICByZW5kZXJUb29sVXNlUHJvZ3Jlc3NNZXNzYWdlLFxuICByZW5kZXJUb29sVXNlUmVqZWN0ZWRNZXNzYWdlLFxuICByZW5kZXJUb29sVXNlVGFnLFxuICB1c2VyRmFjaW5nTmFtZSxcbiAgdXNlckZhY2luZ05hbWVCYWNrZ3JvdW5kQ29sb3IsXG59IGZyb20gJy4vVUkuanMnXG5cbi8qIGVzbGludC1kaXNhYmxlIEB0eXBlc2NyaXB0LWVzbGludC9uby1yZXF1aXJlLWltcG9ydHMgKi9cbmNvbnN0IHByb2FjdGl2ZU1vZHVsZSA9XG4gIGZlYXR1cmUoJ1BST0FDVElWRScpIHx8IGZlYXR1cmUoJ0tBSVJPUycpXG4gICAgPyAocmVxdWlyZSgnLi4vLi4vcHJvYWN0aXZlL2luZGV4LmpzJykgYXMgdHlwZW9mIGltcG9ydCgnLi4vLi4vcHJvYWN0aXZlL2luZGV4LmpzJykpXG4gICAgOiBudWxsXG4vKiBlc2xpbnQtZW5hYmxlIEB0eXBlc2NyaXB0LWVzbGludC9uby1yZXF1aXJlLWltcG9ydHMgKi9cblxuLy8gUHJvZ3Jlc3MgZGlzcGxheSBjb25zdGFudHMgKGZvciBzaG93aW5nIGJhY2tncm91bmQgaGludClcbmNvbnN0IFBST0dSRVNTX1RIUkVTSE9MRF9NUyA9IDIwMDAgLy8gU2hvdyBiYWNrZ3JvdW5kIGhpbnQgYWZ0ZXIgMiBzZWNvbmRzXG5cbi8vIENoZWNrIGlmIGJhY2tncm91bmQgdGFza3MgYXJlIGRpc2FibGVkIGF0IG1vZHVsZSBsb2FkIHRpbWVcbmNvbnN0IGlzQmFja2dyb3VuZFRhc2tzRGlzYWJsZWQgPVxuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgY3VzdG9tLXJ1bGVzL25vLXByb2Nlc3MtZW52LXRvcC1sZXZlbCAtLSBJbnRlbnRpb25hbDogc2NoZW1hIG11c3QgYmUgZGVmaW5lZCBhdCBtb2R1bGUgbG9hZFxuICBpc0VudlRydXRoeShwcm9jZXNzLmVudi5DTEFVREVfQ09ERV9ESVNBQkxFX0JBQ0tHUk9VTkRfVEFTS1MpXG5cbi8vIEF1dG8tYmFja2dyb3VuZCBhZ2VudCB0YXNrcyBhZnRlciB0aGlzIG1hbnkgbXMgKDAgPSBkaXNhYmxlZClcbi8vIEVuYWJsZWQgYnkgZW52IHZhciBPUiBHcm93dGhCb29rIGdhdGUgKGNoZWNrZWQgbGF6aWx5IHNpbmNlIEdCIG1heSBub3QgYmUgcmVhZHkgYXQgbW9kdWxlIGxvYWQpXG5mdW5jdGlvbiBnZXRBdXRvQmFja2dyb3VuZE1zKCk6IG51bWJlciB7XG4gIGlmIChcbiAgICBpc0VudlRydXRoeShwcm9jZXNzLmVudi5DTEFVREVfQVVUT19CQUNLR1JPVU5EX1RBU0tTKSB8fFxuICAgIGdldEZlYXR1cmVWYWx1ZV9DQUNIRURfTUFZX0JFX1NUQUxFKCd0ZW5ndV9hdXRvX2JhY2tncm91bmRfYWdlbnRzJywgZmFsc2UpXG4gICkge1xuICAgIHJldHVybiAxMjBfMDAwXG4gIH1cbiAgcmV0dXJuIDBcbn1cblxuLy8gTXVsdGktYWdlbnQgdHlwZSBjb25zdGFudHMgYXJlIGRlZmluZWQgaW5saW5lIGluc2lkZSBnYXRlZCBibG9ja3MgdG8gZW5hYmxlIGRlYWQgY29kZSBlbGltaW5hdGlvblxuXG4vLyBCYXNlIGlucHV0IHNjaGVtYSB3aXRob3V0IG11bHRpLWFnZW50IHBhcmFtZXRlcnNcbmNvbnN0IGJhc2VJbnB1dFNjaGVtYSA9IGxhenlTY2hlbWEoKCkgPT5cbiAgei5vYmplY3Qoe1xuICAgIGRlc2NyaXB0aW9uOiB6XG4gICAgICAuc3RyaW5nKClcbiAgICAgIC5kZXNjcmliZSgnQSBzaG9ydCAoMy01IHdvcmQpIGRlc2NyaXB0aW9uIG9mIHRoZSB0YXNrJyksXG4gICAgcHJvbXB0OiB6LnN0cmluZygpLmRlc2NyaWJlKCdUaGUgdGFzayBmb3IgdGhlIGFnZW50IHRvIHBlcmZvcm0nKSxcbiAgICBzdWJhZ2VudF90eXBlOiB6XG4gICAgICAuc3RyaW5nKClcbiAgICAgIC5vcHRpb25hbCgpXG4gICAgICAuZGVzY3JpYmUoJ1RoZSB0eXBlIG9mIHNwZWNpYWxpemVkIGFnZW50IHRvIHVzZSBmb3IgdGhpcyB0YXNrJyksXG4gICAgbW9kZWw6IHpcbiAgICAgIC5lbnVtKFsnc29ubmV0JywgJ29wdXMnLCAnaGFpa3UnXSlcbiAgICAgIC5vcHRpb25hbCgpXG4gICAgICAuZGVzY3JpYmUoXG4gICAgICAgIFwiT3B0aW9uYWwgbW9kZWwgb3ZlcnJpZGUgZm9yIHRoaXMgYWdlbnQuIFRha2VzIHByZWNlZGVuY2Ugb3ZlciB0aGUgYWdlbnQgZGVmaW5pdGlvbidzIG1vZGVsIGZyb250bWF0dGVyLiBJZiBvbWl0dGVkLCB1c2VzIHRoZSBhZ2VudCBkZWZpbml0aW9uJ3MgbW9kZWwsIG9yIGluaGVyaXRzIGZyb20gdGhlIHBhcmVudC5cIixcbiAgICAgICksXG4gICAgcnVuX2luX2JhY2tncm91bmQ6IHpcbiAgICAgIC5ib29sZWFuKClcbiAgICAgIC5vcHRpb25hbCgpXG4gICAgICAuZGVzY3JpYmUoXG4gICAgICAgICdTZXQgdG8gdHJ1ZSB0byBydW4gdGhpcyBhZ2VudCBpbiB0aGUgYmFja2dyb3VuZC4gWW91IHdpbGwgYmUgbm90aWZpZWQgd2hlbiBpdCBjb21wbGV0ZXMuJyxcbiAgICAgICksXG4gIH0pLFxuKVxuXG4vLyBGdWxsIHNjaGVtYSBjb21iaW5pbmcgYmFzZSArIG11bHRpLWFnZW50IHBhcmFtcyArIGlzb2xhdGlvblxuY29uc3QgZnVsbElucHV0U2NoZW1hID0gbGF6eVNjaGVtYSgoKSA9PiB7XG4gIC8vIE11bHRpLWFnZW50IHBhcmFtZXRlcnNcbiAgY29uc3QgbXVsdGlBZ2VudElucHV0U2NoZW1hID0gei5vYmplY3Qoe1xuICAgIG5hbWU6IHpcbiAgICAgIC5zdHJpbmcoKVxuICAgICAgLm9wdGlvbmFsKClcbiAgICAgIC5kZXNjcmliZShcbiAgICAgICAgJ05hbWUgZm9yIHRoZSBzcGF3bmVkIGFnZW50LiBNYWtlcyBpdCBhZGRyZXNzYWJsZSB2aWEgU2VuZE1lc3NhZ2Uoe3RvOiBuYW1lfSkgd2hpbGUgcnVubmluZy4nLFxuICAgICAgKSxcbiAgICB0ZWFtX25hbWU6IHpcbiAgICAgIC5zdHJpbmcoKVxuICAgICAgLm9wdGlvbmFsKClcbiAgICAgIC5kZXNjcmliZShcbiAgICAgICAgJ1RlYW0gbmFtZSBmb3Igc3Bhd25pbmcuIFVzZXMgY3VycmVudCB0ZWFtIGNvbnRleHQgaWYgb21pdHRlZC4nLFxuICAgICAgKSxcbiAgICBtb2RlOiBwZXJtaXNzaW9uTW9kZVNjaGVtYSgpXG4gICAgICAub3B0aW9uYWwoKVxuICAgICAgLmRlc2NyaWJlKFxuICAgICAgICAnUGVybWlzc2lvbiBtb2RlIGZvciBzcGF3bmVkIHRlYW1tYXRlIChlLmcuLCBcInBsYW5cIiB0byByZXF1aXJlIHBsYW4gYXBwcm92YWwpLicsXG4gICAgICApLFxuICB9KVxuXG4gIHJldHVybiBiYXNlSW5wdXRTY2hlbWEoKVxuICAgIC5tZXJnZShtdWx0aUFnZW50SW5wdXRTY2hlbWEpXG4gICAgLmV4dGVuZCh7XG4gICAgICBpc29sYXRpb246IChcImV4dGVybmFsXCIgPT09ICdhbnQnXG4gICAgICAgID8gei5lbnVtKFsnd29ya3RyZWUnLCAncmVtb3RlJ10pXG4gICAgICAgIDogei5lbnVtKFsnd29ya3RyZWUnXSlcbiAgICAgIClcbiAgICAgICAgLm9wdGlvbmFsKClcbiAgICAgICAgLmRlc2NyaWJlKFxuICAgICAgICAgIFwiZXh0ZXJuYWxcIiA9PT0gJ2FudCdcbiAgICAgICAgICAgID8gJ0lzb2xhdGlvbiBtb2RlLiBcIndvcmt0cmVlXCIgY3JlYXRlcyBhIHRlbXBvcmFyeSBnaXQgd29ya3RyZWUgc28gdGhlIGFnZW50IHdvcmtzIG9uIGFuIGlzb2xhdGVkIGNvcHkgb2YgdGhlIHJlcG8uIFwicmVtb3RlXCIgbGF1bmNoZXMgdGhlIGFnZW50IGluIGEgcmVtb3RlIENDUiBlbnZpcm9ubWVudCAoYWx3YXlzIHJ1bnMgaW4gYmFja2dyb3VuZCkuJ1xuICAgICAgICAgICAgOiAnSXNvbGF0aW9uIG1vZGUuIFwid29ya3RyZWVcIiBjcmVhdGVzIGEgdGVtcG9yYXJ5IGdpdCB3b3JrdHJlZSBzbyB0aGUgYWdlbnQgd29ya3Mgb24gYW4gaXNvbGF0ZWQgY29weSBvZiB0aGUgcmVwby4nLFxuICAgICAgICApLFxuICAgICAgY3dkOiB6XG4gICAgICAgIC5zdHJpbmcoKVxuICAgICAgICAub3B0aW9uYWwoKVxuICAgICAgICAuZGVzY3JpYmUoXG4gICAgICAgICAgJ0Fic29sdXRlIHBhdGggdG8gcnVuIHRoZSBhZ2VudCBpbi4gT3ZlcnJpZGVzIHRoZSB3b3JraW5nIGRpcmVjdG9yeSBmb3IgYWxsIGZpbGVzeXN0ZW0gYW5kIHNoZWxsIG9wZXJhdGlvbnMgd2l0aGluIHRoaXMgYWdlbnQuIE11dHVhbGx5IGV4Y2x1c2l2ZSB3aXRoIGlzb2xhdGlvbjogXCJ3b3JrdHJlZVwiLicsXG4gICAgICAgICksXG4gICAgfSlcbn0pXG5cbi8vIFN0cmlwIG9wdGlvbmFsIGZpZWxkcyBmcm9tIHRoZSBzY2hlbWEgd2hlbiB0aGUgYmFja2luZyBmZWF0dXJlIGlzIG9mZiBzb1xuLy8gdGhlIG1vZGVsIG5ldmVyIHNlZXMgdGhlbS4gRG9uZSB2aWEgLm9taXQoKSByYXRoZXIgdGhhbiBjb25kaXRpb25hbCBzcHJlYWRcbi8vIGluc2lkZSAuZXh0ZW5kKCkgYmVjYXVzZSB0aGUgc3ByZWFkLXRlcm5hcnkgYnJlYWtzIFpvZCdzIHR5cGUgaW5mZXJlbmNlXG4vLyAoZmllbGQgdHlwZSBjb2xsYXBzZXMgdG8gYHVua25vd25gKS4gVGhlIHRlcm5hcnkgcmV0dXJuIHByb2R1Y2VzIGEgdW5pb25cbi8vIHR5cGUsIGJ1dCBjYWxsKCkgZGVzdHJ1Y3R1cmVzIHZpYSB0aGUgZXhwbGljaXQgQWdlbnRUb29sSW5wdXQgdHlwZSBiZWxvd1xuLy8gd2hpY2ggYWx3YXlzIGluY2x1ZGVzIGFsbCBvcHRpb25hbCBmaWVsZHMuXG5leHBvcnQgY29uc3QgaW5wdXRTY2hlbWEgPSBsYXp5U2NoZW1hKCgpID0+IHtcbiAgY29uc3Qgc2NoZW1hID0gZmVhdHVyZSgnS0FJUk9TJylcbiAgICA/IGZ1bGxJbnB1dFNjaGVtYSgpXG4gICAgOiBmdWxsSW5wdXRTY2hlbWEoKS5vbWl0KHsgY3dkOiB0cnVlIH0pXG5cbiAgLy8gR3Jvd3RoQm9vay1pbi1sYXp5U2NoZW1hIGlzIGFjY2VwdGFibGUgaGVyZSAodW5saWtlIHN1YmFnZW50X3R5cGUsIHdoaWNoXG4gIC8vIHdhcyByZW1vdmVkIGluIDkwNmRhNmM3MjMpOiB0aGUgZGl2ZXJnZW5jZSB3aW5kb3cgaXMgb25lLXNlc3Npb24tcGVyLVxuICAvLyBnYXRlLWZsaXAgdmlhIF9DQUNIRURfTUFZX0JFX1NUQUxFIGRpc2sgcmVhZCwgYW5kIHdvcnN0IGNhc2UgaXMgZWl0aGVyXG4gIC8vIFwic2NoZW1hIHNob3dzIGEgbm8tb3AgcGFyYW1cIiAoZ2F0ZSBmbGlwcyBvbiBtaWQtc2Vzc2lvbjogcGFyYW0gaWdub3JlZFxuICAvLyBieSBmb3JjZUFzeW5jKSBvciBcInNjaGVtYSBoaWRlcyBhIHBhcmFtIHRoYXQgd291bGQndmUgd29ya2VkXCIgKGdhdGVcbiAgLy8gZmxpcHMgb2ZmIG1pZC1zZXNzaW9uOiBldmVyeXRoaW5nIHN0aWxsIHJ1bnMgYXN5bmMgdmlhIG1lbW9pemVkXG4gIC8vIGZvcmNlQXN5bmMpLiBObyBab2QgcmVqZWN0aW9uLCBubyBjcmFzaCDigJQgdW5saWtlIHJlcXVpcmVk4oaSb3B0aW9uYWwuXG4gIHJldHVybiBpc0JhY2tncm91bmRUYXNrc0Rpc2FibGVkIHx8IGlzRm9ya1N1YmFnZW50RW5hYmxlZCgpXG4gICAgPyBzY2hlbWEub21pdCh7IHJ1bl9pbl9iYWNrZ3JvdW5kOiB0cnVlIH0pXG4gICAgOiBzY2hlbWFcbn0pXG50eXBlIElucHV0U2NoZW1hID0gUmV0dXJuVHlwZTx0eXBlb2YgaW5wdXRTY2hlbWE+XG5cbi8vIEV4cGxpY2l0IHR5cGUgd2lkZW5zIHRoZSBzY2hlbWEgaW5mZXJlbmNlIHRvIGFsd2F5cyBpbmNsdWRlIGFsbCBvcHRpb25hbFxuLy8gZmllbGRzIGV2ZW4gd2hlbiAub21pdCgpIHN0cmlwcyB0aGVtIGZvciBnYXRpbmcgKGN3ZCwgcnVuX2luX2JhY2tncm91bmQpLlxuLy8gc3ViYWdlbnRfdHlwZSBpcyBvcHRpb25hbDsgY2FsbCgpIGRlZmF1bHRzIGl0IHRvIGdlbmVyYWwtcHVycG9zZSB3aGVuIHRoZVxuLy8gZm9yayBnYXRlIGlzIG9mZiwgb3Igcm91dGVzIHRvIHRoZSBmb3JrIHBhdGggd2hlbiB0aGUgZ2F0ZSBpcyBvbi5cbnR5cGUgQWdlbnRUb29sSW5wdXQgPSB6LmluZmVyPFJldHVyblR5cGU8dHlwZW9mIGJhc2VJbnB1dFNjaGVtYT4+ICYge1xuICBuYW1lPzogc3RyaW5nXG4gIHRlYW1fbmFtZT86IHN0cmluZ1xuICBtb2RlPzogei5pbmZlcjxSZXR1cm5UeXBlPHR5cGVvZiBwZXJtaXNzaW9uTW9kZVNjaGVtYT4+XG4gIGlzb2xhdGlvbj86ICd3b3JrdHJlZScgfCAncmVtb3RlJ1xuICBjd2Q/OiBzdHJpbmdcbn1cblxuLy8gT3V0cHV0IHNjaGVtYSAtIG11bHRpLWFnZW50IHNwYXduZWQgc2NoZW1hIGFkZGVkIGR5bmFtaWNhbGx5IGF0IHJ1bnRpbWUgd2hlbiBlbmFibGVkXG5leHBvcnQgY29uc3Qgb3V0cHV0U2NoZW1hID0gbGF6eVNjaGVtYSgoKSA9PiB7XG4gIGNvbnN0IHN5bmNPdXRwdXRTY2hlbWEgPSBhZ2VudFRvb2xSZXN1bHRTY2hlbWEoKS5leHRlbmQoe1xuICAgIHN0YXR1czogei5saXRlcmFsKCdjb21wbGV0ZWQnKSxcbiAgICBwcm9tcHQ6IHouc3RyaW5nKCksXG4gIH0pXG5cbiAgY29uc3QgYXN5bmNPdXRwdXRTY2hlbWEgPSB6Lm9iamVjdCh7XG4gICAgc3RhdHVzOiB6LmxpdGVyYWwoJ2FzeW5jX2xhdW5jaGVkJyksXG4gICAgYWdlbnRJZDogei5zdHJpbmcoKS5kZXNjcmliZSgnVGhlIElEIG9mIHRoZSBhc3luYyBhZ2VudCcpLFxuICAgIGRlc2NyaXB0aW9uOiB6LnN0cmluZygpLmRlc2NyaWJlKCdUaGUgZGVzY3JpcHRpb24gb2YgdGhlIHRhc2snKSxcbiAgICBwcm9tcHQ6IHouc3RyaW5nKCkuZGVzY3JpYmUoJ1RoZSBwcm9tcHQgZm9yIHRoZSBhZ2VudCcpLFxuICAgIG91dHB1dEZpbGU6IHpcbiAgICAgIC5zdHJpbmcoKVxuICAgICAgLmRlc2NyaWJlKCdQYXRoIHRvIHRoZSBvdXRwdXQgZmlsZSBmb3IgY2hlY2tpbmcgYWdlbnQgcHJvZ3Jlc3MnKSxcbiAgICBjYW5SZWFkT3V0cHV0RmlsZTogelxuICAgICAgLmJvb2xlYW4oKVxuICAgICAgLm9wdGlvbmFsKClcbiAgICAgIC5kZXNjcmliZShcbiAgICAgICAgJ1doZXRoZXIgdGhlIGNhbGxpbmcgYWdlbnQgaGFzIFJlYWQvQmFzaCB0b29scyB0byBjaGVjayBwcm9ncmVzcycsXG4gICAgICApLFxuICB9KVxuXG4gIHJldHVybiB6LnVuaW9uKFtzeW5jT3V0cHV0U2NoZW1hLCBhc3luY091dHB1dFNjaGVtYV0pXG59KVxudHlwZSBPdXRwdXRTY2hlbWEgPSBSZXR1cm5UeXBlPHR5cGVvZiBvdXRwdXRTY2hlbWE+XG50eXBlIE91dHB1dCA9IHouaW5wdXQ8T3V0cHV0U2NoZW1hPlxuXG4vLyBQcml2YXRlIHR5cGUgZm9yIHRlYW1tYXRlIHNwYXduIHJlc3VsdHMgLSBleGNsdWRlZCBmcm9tIGV4cG9ydGVkIHNjaGVtYSBmb3IgZGVhZCBjb2RlIGVsaW1pbmF0aW9uXG4vLyBUaGUgJ3RlYW1tYXRlX3NwYXduZWQnIHN0YXR1cyBzdHJpbmcgaXMgb25seSBpbmNsdWRlZCB3aGVuIEVOQUJMRV9BR0VOVF9TV0FSTVMgaXMgdHJ1ZVxudHlwZSBUZWFtbWF0ZVNwYXduZWRPdXRwdXQgPSB7XG4gIHN0YXR1czogJ3RlYW1tYXRlX3NwYXduZWQnXG4gIHByb21wdDogc3RyaW5nXG4gIHRlYW1tYXRlX2lkOiBzdHJpbmdcbiAgYWdlbnRfaWQ6IHN0cmluZ1xuICBhZ2VudF90eXBlPzogc3RyaW5nXG4gIG1vZGVsPzogc3RyaW5nXG4gIG5hbWU6IHN0cmluZ1xuICBjb2xvcj86IHN0cmluZ1xuICB0bXV4X3Nlc3Npb25fbmFtZTogc3RyaW5nXG4gIHRtdXhfd2luZG93X25hbWU6IHN0cmluZ1xuICB0bXV4X3BhbmVfaWQ6IHN0cmluZ1xuICB0ZWFtX25hbWU/OiBzdHJpbmdcbiAgaXNfc3BsaXRwYW5lPzogYm9vbGVhblxuICBwbGFuX21vZGVfcmVxdWlyZWQ/OiBib29sZWFuXG59XG5cbi8vIENvbWJpbmVkIG91dHB1dCB0eXBlIGluY2x1ZGluZyBib3RoIHB1YmxpYyBhbmQgaW50ZXJuYWwgdHlwZXNcbi8vIE5vdGU6IFRlYW1tYXRlU3Bhd25lZE91dHB1dCB0eXBlIGlzIGZpbmUgLSBUeXBlU2NyaXB0IHR5cGVzIGFyZSBlcmFzZWQgYXQgY29tcGlsZSB0aW1lXG4vLyBQcml2YXRlIHR5cGUgZm9yIHJlbW90ZS1sYXVuY2hlZCByZXN1bHRzIOKAlCBleGNsdWRlZCBmcm9tIGV4cG9ydGVkIHNjaGVtYVxuLy8gbGlrZSBUZWFtbWF0ZVNwYXduZWRPdXRwdXQgZm9yIGRlYWQgY29kZSBlbGltaW5hdGlvbiBwdXJwb3Nlcy4gRXhwb3J0ZWRcbi8vIGZvciBVSS50c3ggdG8gZG8gcHJvcGVyIGRpc2NyaW1pbmF0ZWQtdW5pb24gbmFycm93aW5nIGluc3RlYWQgb2YgYWQtaG9jIGNhc3RzLlxuZXhwb3J0IHR5cGUgUmVtb3RlTGF1bmNoZWRPdXRwdXQgPSB7XG4gIHN0YXR1czogJ3JlbW90ZV9sYXVuY2hlZCdcbiAgdGFza0lkOiBzdHJpbmdcbiAgc2Vzc2lvblVybDogc3RyaW5nXG4gIGRlc2NyaXB0aW9uOiBzdHJpbmdcbiAgcHJvbXB0OiBzdHJpbmdcbiAgb3V0cHV0RmlsZTogc3RyaW5nXG59XG5cbnR5cGUgSW50ZXJuYWxPdXRwdXQgPSBPdXRwdXQgfCBUZWFtbWF0ZVNwYXduZWRPdXRwdXQgfCBSZW1vdGVMYXVuY2hlZE91dHB1dFxuXG5pbXBvcnQgdHlwZSB7IEFnZW50VG9vbFByb2dyZXNzLCBTaGVsbFByb2dyZXNzIH0gZnJvbSAnLi4vLi4vdHlwZXMvdG9vbHMuanMnXG4vLyBBZ2VudFRvb2wgZm9yd2FyZHMgYm90aCBpdHMgb3duIHByb2dyZXNzIGV2ZW50cyBhbmQgc2hlbGwgcHJvZ3Jlc3Ncbi8vIGV2ZW50cyBmcm9tIHRoZSBzdWItYWdlbnQgc28gdGhlIFNESyByZWNlaXZlcyB0b29sX3Byb2dyZXNzIHVwZGF0ZXMgZHVyaW5nIGJhc2gvcG93ZXJzaGVsbCBydW5zLlxuZXhwb3J0IHR5cGUgUHJvZ3Jlc3MgPSBBZ2VudFRvb2xQcm9ncmVzcyB8IFNoZWxsUHJvZ3Jlc3NcblxuZXhwb3J0IGNvbnN0IEFnZW50VG9vbCA9IGJ1aWxkVG9vbCh7XG4gIGFzeW5jIHByb21wdCh7IGFnZW50cywgdG9vbHMsIGdldFRvb2xQZXJtaXNzaW9uQ29udGV4dCwgYWxsb3dlZEFnZW50VHlwZXMgfSkge1xuICAgIGNvbnN0IHRvb2xQZXJtaXNzaW9uQ29udGV4dCA9IGF3YWl0IGdldFRvb2xQZXJtaXNzaW9uQ29udGV4dCgpXG5cbiAgICAvLyBHZXQgTUNQIHNlcnZlcnMgdGhhdCBoYXZlIHRvb2xzIGF2YWlsYWJsZVxuICAgIGNvbnN0IG1jcFNlcnZlcnNXaXRoVG9vbHM6IHN0cmluZ1tdID0gW11cbiAgICBmb3IgKGNvbnN0IHRvb2wgb2YgdG9vbHMpIHtcbiAgICAgIGlmICh0b29sLm5hbWU/LnN0YXJ0c1dpdGgoJ21jcF9fJykpIHtcbiAgICAgICAgY29uc3QgcGFydHMgPSB0b29sLm5hbWUuc3BsaXQoJ19fJylcbiAgICAgICAgY29uc3Qgc2VydmVyTmFtZSA9IHBhcnRzWzFdXG4gICAgICAgIGlmIChzZXJ2ZXJOYW1lICYmICFtY3BTZXJ2ZXJzV2l0aFRvb2xzLmluY2x1ZGVzKHNlcnZlck5hbWUpKSB7XG4gICAgICAgICAgbWNwU2VydmVyc1dpdGhUb29scy5wdXNoKHNlcnZlck5hbWUpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBGaWx0ZXIgYWdlbnRzOiBmaXJzdCBieSBNQ1AgcmVxdWlyZW1lbnRzLCB0aGVuIGJ5IHBlcm1pc3Npb24gcnVsZXNcbiAgICBjb25zdCBhZ2VudHNXaXRoTWNwUmVxdWlyZW1lbnRzTWV0ID0gZmlsdGVyQWdlbnRzQnlNY3BSZXF1aXJlbWVudHMoXG4gICAgICBhZ2VudHMsXG4gICAgICBtY3BTZXJ2ZXJzV2l0aFRvb2xzLFxuICAgIClcbiAgICBjb25zdCBmaWx0ZXJlZEFnZW50cyA9IGZpbHRlckRlbmllZEFnZW50cyhcbiAgICAgIGFnZW50c1dpdGhNY3BSZXF1aXJlbWVudHNNZXQsXG4gICAgICB0b29sUGVybWlzc2lvbkNvbnRleHQsXG4gICAgICBBR0VOVF9UT09MX05BTUUsXG4gICAgKVxuXG4gICAgLy8gVXNlIGlubGluZSBlbnYgY2hlY2sgaW5zdGVhZCBvZiBjb29yZGluYXRvck1vZHVsZSB0byBhdm9pZCBjaXJjdWxhclxuICAgIC8vIGRlcGVuZGVuY3kgaXNzdWVzIGR1cmluZyB0ZXN0IG1vZHVsZSBsb2FkaW5nLlxuICAgIGNvbnN0IGlzQ29vcmRpbmF0b3IgPSBmZWF0dXJlKCdDT09SRElOQVRPUl9NT0RFJylcbiAgICAgID8gaXNFbnZUcnV0aHkocHJvY2Vzcy5lbnYuQ0xBVURFX0NPREVfQ09PUkRJTkFUT1JfTU9ERSlcbiAgICAgIDogZmFsc2VcbiAgICByZXR1cm4gYXdhaXQgZ2V0UHJvbXB0KGZpbHRlcmVkQWdlbnRzLCBpc0Nvb3JkaW5hdG9yLCBhbGxvd2VkQWdlbnRUeXBlcylcbiAgfSxcbiAgbmFtZTogQUdFTlRfVE9PTF9OQU1FLFxuICBzZWFyY2hIaW50OiAnZGVsZWdhdGUgd29yayB0byBhIHN1YmFnZW50JyxcbiAgYWxpYXNlczogW0xFR0FDWV9BR0VOVF9UT09MX05BTUVdLFxuICBtYXhSZXN1bHRTaXplQ2hhcnM6IDEwMF8wMDAsXG4gIGFzeW5jIGRlc2NyaXB0aW9uKCkge1xuICAgIHJldHVybiAnTGF1bmNoIGEgbmV3IGFnZW50J1xuICB9LFxuICBnZXQgaW5wdXRTY2hlbWEoKTogSW5wdXRTY2hlbWEge1xuICAgIHJldHVybiBpbnB1dFNjaGVtYSgpXG4gIH0sXG4gIGdldCBvdXRwdXRTY2hlbWEoKTogT3V0cHV0U2NoZW1hIHtcbiAgICByZXR1cm4gb3V0cHV0U2NoZW1hKClcbiAgfSxcbiAgYXN5bmMgY2FsbChcbiAgICB7XG4gICAgICBwcm9tcHQsXG4gICAgICBzdWJhZ2VudF90eXBlLFxuICAgICAgZGVzY3JpcHRpb24sXG4gICAgICBtb2RlbDogbW9kZWxQYXJhbSxcbiAgICAgIHJ1bl9pbl9iYWNrZ3JvdW5kLFxuICAgICAgbmFtZSxcbiAgICAgIHRlYW1fbmFtZSxcbiAgICAgIG1vZGU6IHNwYXduTW9kZSxcbiAgICAgIGlzb2xhdGlvbixcbiAgICAgIGN3ZCxcbiAgICB9OiBBZ2VudFRvb2xJbnB1dCxcbiAgICB0b29sVXNlQ29udGV4dCxcbiAgICBjYW5Vc2VUb29sLFxuICAgIGFzc2lzdGFudE1lc3NhZ2UsXG4gICAgb25Qcm9ncmVzcz8sXG4gICkge1xuICAgIGNvbnN0IHN0YXJ0VGltZSA9IERhdGUubm93KClcbiAgICBjb25zdCBtb2RlbCA9IGlzQ29vcmRpbmF0b3JNb2RlKCkgPyB1bmRlZmluZWQgOiBtb2RlbFBhcmFtXG5cbiAgICAvLyBHZXQgYXBwIHN0YXRlIGZvciBwZXJtaXNzaW9uIG1vZGUgYW5kIGFnZW50IGZpbHRlcmluZ1xuICAgIGNvbnN0IGFwcFN0YXRlID0gdG9vbFVzZUNvbnRleHQuZ2V0QXBwU3RhdGUoKVxuICAgIGNvbnN0IHBlcm1pc3Npb25Nb2RlID0gYXBwU3RhdGUudG9vbFBlcm1pc3Npb25Db250ZXh0Lm1vZGVcbiAgICAvLyBJbi1wcm9jZXNzIHRlYW1tYXRlcyBnZXQgYSBuby1vcCBzZXRBcHBTdGF0ZTsgc2V0QXBwU3RhdGVGb3JUYXNrc1xuICAgIC8vIHJlYWNoZXMgdGhlIHJvb3Qgc3RvcmUgc28gdGFzayByZWdpc3RyYXRpb24vcHJvZ3Jlc3Mva2lsbCBzdGF5IHZpc2libGUuXG4gICAgY29uc3Qgcm9vdFNldEFwcFN0YXRlID1cbiAgICAgIHRvb2xVc2VDb250ZXh0LnNldEFwcFN0YXRlRm9yVGFza3MgPz8gdG9vbFVzZUNvbnRleHQuc2V0QXBwU3RhdGVcblxuICAgIC8vIENoZWNrIGlmIHVzZXIgaXMgdHJ5aW5nIHRvIHVzZSBhZ2VudCB0ZWFtcyB3aXRob3V0IGFjY2Vzc1xuICAgIGlmICh0ZWFtX25hbWUgJiYgIWlzQWdlbnRTd2FybXNFbmFibGVkKCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignQWdlbnQgVGVhbXMgaXMgbm90IHlldCBhdmFpbGFibGUgb24geW91ciBwbGFuLicpXG4gICAgfVxuXG4gICAgLy8gVGVhbW1hdGVzIChpbi1wcm9jZXNzIG9yIHRtdXgpIHBhc3NpbmcgYG5hbWVgIHdvdWxkIHRyaWdnZXIgc3Bhd25UZWFtbWF0ZSgpXG4gICAgLy8gYmVsb3csIGJ1dCBUZWFtRmlsZS5tZW1iZXJzIGlzIGEgZmxhdCBhcnJheSB3aXRoIG9uZSBsZWFkQWdlbnRJZCDigJQgbmVzdGVkXG4gICAgLy8gdGVhbW1hdGVzIGxhbmQgaW4gdGhlIHJvc3RlciB3aXRoIG5vIHByb3ZlbmFuY2UgYW5kIGNvbmZ1c2UgdGhlIGxlYWQuXG4gICAgY29uc3QgdGVhbU5hbWUgPSByZXNvbHZlVGVhbU5hbWUoeyB0ZWFtX25hbWUgfSwgYXBwU3RhdGUpXG4gICAgaWYgKGlzVGVhbW1hdGUoKSAmJiB0ZWFtTmFtZSAmJiBuYW1lKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICdUZWFtbWF0ZXMgY2Fubm90IHNwYXduIG90aGVyIHRlYW1tYXRlcyDigJQgdGhlIHRlYW0gcm9zdGVyIGlzIGZsYXQuIFRvIHNwYXduIGEgc3ViYWdlbnQgaW5zdGVhZCwgb21pdCB0aGUgYG5hbWVgIHBhcmFtZXRlci4nLFxuICAgICAgKVxuICAgIH1cbiAgICAvLyBJbi1wcm9jZXNzIHRlYW1tYXRlcyBjYW5ub3Qgc3Bhd24gYmFja2dyb3VuZCBhZ2VudHMgKHRoZWlyIGxpZmVjeWNsZSBpc1xuICAgIC8vIHRpZWQgdG8gdGhlIGxlYWRlcidzIHByb2Nlc3MpLiBUbXV4IHRlYW1tYXRlcyBhcmUgc2VwYXJhdGUgcHJvY2Vzc2VzIGFuZFxuICAgIC8vIGNhbiBtYW5hZ2UgdGhlaXIgb3duIGJhY2tncm91bmQgYWdlbnRzLlxuICAgIGlmIChpc0luUHJvY2Vzc1RlYW1tYXRlKCkgJiYgdGVhbU5hbWUgJiYgcnVuX2luX2JhY2tncm91bmQgPT09IHRydWUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgJ0luLXByb2Nlc3MgdGVhbW1hdGVzIGNhbm5vdCBzcGF3biBiYWNrZ3JvdW5kIGFnZW50cy4gVXNlIHJ1bl9pbl9iYWNrZ3JvdW5kPWZhbHNlIGZvciBzeW5jaHJvbm91cyBzdWJhZ2VudHMuJyxcbiAgICAgIClcbiAgICB9XG5cbiAgICAvLyBDaGVjayBpZiB0aGlzIGlzIGEgbXVsdGktYWdlbnQgc3Bhd24gcmVxdWVzdFxuICAgIC8vIFNwYXduIGlzIHRyaWdnZXJlZCB3aGVuIHRlYW1fbmFtZSBpcyBzZXQgKGZyb20gcGFyYW0gb3IgY29udGV4dCkgYW5kIG5hbWUgaXMgcHJvdmlkZWRcbiAgICBpZiAodGVhbU5hbWUgJiYgbmFtZSkge1xuICAgICAgLy8gU2V0IGFnZW50IGRlZmluaXRpb24gY29sb3IgZm9yIGdyb3VwZWQgVUkgZGlzcGxheSBiZWZvcmUgc3Bhd25pbmdcbiAgICAgIGNvbnN0IGFnZW50RGVmID0gc3ViYWdlbnRfdHlwZVxuICAgICAgICA/IHRvb2xVc2VDb250ZXh0Lm9wdGlvbnMuYWdlbnREZWZpbml0aW9ucy5hY3RpdmVBZ2VudHMuZmluZChcbiAgICAgICAgICAgIGEgPT4gYS5hZ2VudFR5cGUgPT09IHN1YmFnZW50X3R5cGUsXG4gICAgICAgICAgKVxuICAgICAgICA6IHVuZGVmaW5lZFxuICAgICAgaWYgKGFnZW50RGVmPy5jb2xvcikge1xuICAgICAgICBzZXRBZ2VudENvbG9yKHN1YmFnZW50X3R5cGUhLCBhZ2VudERlZi5jb2xvcilcbiAgICAgIH1cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHNwYXduVGVhbW1hdGUoXG4gICAgICAgIHtcbiAgICAgICAgICBuYW1lLFxuICAgICAgICAgIHByb21wdCxcbiAgICAgICAgICBkZXNjcmlwdGlvbixcbiAgICAgICAgICB0ZWFtX25hbWU6IHRlYW1OYW1lLFxuICAgICAgICAgIHVzZV9zcGxpdHBhbmU6IHRydWUsXG4gICAgICAgICAgcGxhbl9tb2RlX3JlcXVpcmVkOiBzcGF3bk1vZGUgPT09ICdwbGFuJyxcbiAgICAgICAgICBtb2RlbDogbW9kZWwgPz8gYWdlbnREZWY/Lm1vZGVsLFxuICAgICAgICAgIGFnZW50X3R5cGU6IHN1YmFnZW50X3R5cGUsXG4gICAgICAgICAgaW52b2tpbmdSZXF1ZXN0SWQ6IGFzc2lzdGFudE1lc3NhZ2U/LnJlcXVlc3RJZCxcbiAgICAgICAgfSxcbiAgICAgICAgdG9vbFVzZUNvbnRleHQsXG4gICAgICApXG5cbiAgICAgIC8vIFR5cGUgYXNzZXJ0aW9uIHVzZXMgVGVhbW1hdGVTcGF3bmVkT3V0cHV0IChkZWZpbmVkIGFib3ZlKSBpbnN0ZWFkIG9mIGFueS5cbiAgICAgIC8vIFRoaXMgdHlwZSBpcyBleGNsdWRlZCBmcm9tIHRoZSBleHBvcnRlZCBvdXRwdXRTY2hlbWEgZm9yIGRlYWQgY29kZSBlbGltaW5hdGlvbi5cbiAgICAgIC8vIENhc3QgdGhyb3VnaCB1bmtub3duIGJlY2F1c2UgVGVhbW1hdGVTcGF3bmVkT3V0cHV0IGlzIGludGVudGlvbmFsbHlcbiAgICAgIC8vIG5vdCBwYXJ0IG9mIHRoZSBleHBvcnRlZCBPdXRwdXQgdW5pb24gKGZvciBkZWFkIGNvZGUgZWxpbWluYXRpb24gcHVycG9zZXMpLlxuICAgICAgY29uc3Qgc3Bhd25SZXN1bHQ6IFRlYW1tYXRlU3Bhd25lZE91dHB1dCA9IHtcbiAgICAgICAgc3RhdHVzOiAndGVhbW1hdGVfc3Bhd25lZCcgYXMgY29uc3QsXG4gICAgICAgIHByb21wdCxcbiAgICAgICAgLi4ucmVzdWx0LmRhdGEsXG4gICAgICB9XG4gICAgICByZXR1cm4geyBkYXRhOiBzcGF3blJlc3VsdCB9IGFzIHVua25vd24gYXMgeyBkYXRhOiBPdXRwdXQgfVxuICAgIH1cblxuICAgIC8vIEZvcmsgc3ViYWdlbnQgZXhwZXJpbWVudCByb3V0aW5nOlxuICAgIC8vIC0gc3ViYWdlbnRfdHlwZSBzZXQ6IHVzZSBpdCAoZXhwbGljaXQgd2lucylcbiAgICAvLyAtIHN1YmFnZW50X3R5cGUgb21pdHRlZCwgZ2F0ZSBvbjogZm9yayBwYXRoICh1bmRlZmluZWQpXG4gICAgLy8gLSBzdWJhZ2VudF90eXBlIG9taXR0ZWQsIGdhdGUgb2ZmOiBkZWZhdWx0IGdlbmVyYWwtcHVycG9zZVxuICAgIGNvbnN0IGVmZmVjdGl2ZVR5cGUgPVxuICAgICAgc3ViYWdlbnRfdHlwZSA/P1xuICAgICAgKGlzRm9ya1N1YmFnZW50RW5hYmxlZCgpID8gdW5kZWZpbmVkIDogR0VORVJBTF9QVVJQT1NFX0FHRU5ULmFnZW50VHlwZSlcbiAgICBjb25zdCBpc0ZvcmtQYXRoID0gZWZmZWN0aXZlVHlwZSA9PT0gdW5kZWZpbmVkXG5cbiAgICBsZXQgc2VsZWN0ZWRBZ2VudDogQWdlbnREZWZpbml0aW9uXG4gICAgaWYgKGlzRm9ya1BhdGgpIHtcbiAgICAgIC8vIFJlY3Vyc2l2ZSBmb3JrIGd1YXJkOiBmb3JrIGNoaWxkcmVuIGtlZXAgdGhlIEFnZW50IHRvb2wgaW4gdGhlaXJcbiAgICAgIC8vIHBvb2wgZm9yIGNhY2hlLWlkZW50aWNhbCB0b29sIGRlZnMsIHNvIHJlamVjdCBmb3JrIGF0dGVtcHRzIGF0IGNhbGxcbiAgICAgIC8vIHRpbWUuIFByaW1hcnkgY2hlY2sgaXMgcXVlcnlTb3VyY2UgKGNvbXBhY3Rpb24tcmVzaXN0YW50IOKAlCBzZXQgb25cbiAgICAgIC8vIGNvbnRleHQub3B0aW9ucyBhdCBzcGF3biB0aW1lLCBzdXJ2aXZlcyBhdXRvY29tcGFjdCdzIG1lc3NhZ2VcbiAgICAgIC8vIHJld3JpdGUpLiBNZXNzYWdlLXNjYW4gZmFsbGJhY2sgY2F0Y2hlcyBhbnkgcGF0aCB3aGVyZSBxdWVyeVNvdXJjZVxuICAgICAgLy8gd2Fzbid0IHRocmVhZGVkLlxuICAgICAgaWYgKFxuICAgICAgICB0b29sVXNlQ29udGV4dC5vcHRpb25zLnF1ZXJ5U291cmNlID09PVxuICAgICAgICAgIGBhZ2VudDpidWlsdGluOiR7Rk9SS19BR0VOVC5hZ2VudFR5cGV9YCB8fFxuICAgICAgICBpc0luRm9ya0NoaWxkKHRvb2xVc2VDb250ZXh0Lm1lc3NhZ2VzKVxuICAgICAgKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICAnRm9yayBpcyBub3QgYXZhaWxhYmxlIGluc2lkZSBhIGZvcmtlZCB3b3JrZXIuIENvbXBsZXRlIHlvdXIgdGFzayBkaXJlY3RseSB1c2luZyB5b3VyIHRvb2xzLicsXG4gICAgICAgIClcbiAgICAgIH1cbiAgICAgIHNlbGVjdGVkQWdlbnQgPSBGT1JLX0FHRU5UXG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIEZpbHRlciBhZ2VudHMgdG8gZXhjbHVkZSB0aG9zZSBkZW5pZWQgdmlhIEFnZW50KEFnZW50TmFtZSkgc3ludGF4XG4gICAgICBjb25zdCBhbGxBZ2VudHMgPSB0b29sVXNlQ29udGV4dC5vcHRpb25zLmFnZW50RGVmaW5pdGlvbnMuYWN0aXZlQWdlbnRzXG4gICAgICBjb25zdCB7IGFsbG93ZWRBZ2VudFR5cGVzIH0gPSB0b29sVXNlQ29udGV4dC5vcHRpb25zLmFnZW50RGVmaW5pdGlvbnNcbiAgICAgIGNvbnN0IGFnZW50cyA9IGZpbHRlckRlbmllZEFnZW50cyhcbiAgICAgICAgLy8gV2hlbiBhbGxvd2VkQWdlbnRUeXBlcyBpcyBzZXQgKGZyb20gQWdlbnQoeCx5KSB0b29sIHNwZWMpLCByZXN0cmljdCB0byB0aG9zZSB0eXBlc1xuICAgICAgICBhbGxvd2VkQWdlbnRUeXBlc1xuICAgICAgICAgID8gYWxsQWdlbnRzLmZpbHRlcihhID0+IGFsbG93ZWRBZ2VudFR5cGVzLmluY2x1ZGVzKGEuYWdlbnRUeXBlKSlcbiAgICAgICAgICA6IGFsbEFnZW50cyxcbiAgICAgICAgYXBwU3RhdGUudG9vbFBlcm1pc3Npb25Db250ZXh0LFxuICAgICAgICBBR0VOVF9UT09MX05BTUUsXG4gICAgICApXG5cbiAgICAgIGNvbnN0IGZvdW5kID0gYWdlbnRzLmZpbmQoYWdlbnQgPT4gYWdlbnQuYWdlbnRUeXBlID09PSBlZmZlY3RpdmVUeXBlKVxuICAgICAgaWYgKCFmb3VuZCkge1xuICAgICAgICAvLyBDaGVjayBpZiB0aGUgYWdlbnQgZXhpc3RzIGJ1dCBpcyBkZW5pZWQgYnkgcGVybWlzc2lvbiBydWxlc1xuICAgICAgICBjb25zdCBhZ2VudEV4aXN0c0J1dERlbmllZCA9IGFsbEFnZW50cy5maW5kKFxuICAgICAgICAgIGFnZW50ID0+IGFnZW50LmFnZW50VHlwZSA9PT0gZWZmZWN0aXZlVHlwZSxcbiAgICAgICAgKVxuICAgICAgICBpZiAoYWdlbnRFeGlzdHNCdXREZW5pZWQpIHtcbiAgICAgICAgICBjb25zdCBkZW55UnVsZSA9IGdldERlbnlSdWxlRm9yQWdlbnQoXG4gICAgICAgICAgICBhcHBTdGF0ZS50b29sUGVybWlzc2lvbkNvbnRleHQsXG4gICAgICAgICAgICBBR0VOVF9UT09MX05BTUUsXG4gICAgICAgICAgICBlZmZlY3RpdmVUeXBlLFxuICAgICAgICAgIClcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgICBgQWdlbnQgdHlwZSAnJHtlZmZlY3RpdmVUeXBlfScgaGFzIGJlZW4gZGVuaWVkIGJ5IHBlcm1pc3Npb24gcnVsZSAnJHtBR0VOVF9UT09MX05BTUV9KCR7ZWZmZWN0aXZlVHlwZX0pJyBmcm9tICR7ZGVueVJ1bGU/LnNvdXJjZSA/PyAnc2V0dGluZ3MnfS5gLFxuICAgICAgICAgIClcbiAgICAgICAgfVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgYEFnZW50IHR5cGUgJyR7ZWZmZWN0aXZlVHlwZX0nIG5vdCBmb3VuZC4gQXZhaWxhYmxlIGFnZW50czogJHthZ2VudHNcbiAgICAgICAgICAgIC5tYXAoYSA9PiBhLmFnZW50VHlwZSlcbiAgICAgICAgICAgIC5qb2luKCcsICcpfWAsXG4gICAgICAgIClcbiAgICAgIH1cbiAgICAgIHNlbGVjdGVkQWdlbnQgPSBmb3VuZFxuICAgIH1cblxuICAgIC8vIFNhbWUgbGlmZWN5Y2xlIGNvbnN0cmFpbnQgYXMgdGhlIHJ1bl9pbl9iYWNrZ3JvdW5kIGd1YXJkIGFib3ZlLCBidXQgZm9yXG4gICAgLy8gYWdlbnQgZGVmaW5pdGlvbnMgdGhhdCBmb3JjZSBiYWNrZ3JvdW5kIHZpYSBgYmFja2dyb3VuZDogdHJ1ZWAuIENoZWNrZWRcbiAgICAvLyBoZXJlIGJlY2F1c2Ugc2VsZWN0ZWRBZ2VudCBpcyBvbmx5IG5vdyByZXNvbHZlZC5cbiAgICBpZiAoXG4gICAgICBpc0luUHJvY2Vzc1RlYW1tYXRlKCkgJiZcbiAgICAgIHRlYW1OYW1lICYmXG4gICAgICBzZWxlY3RlZEFnZW50LmJhY2tncm91bmQgPT09IHRydWVcbiAgICApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgYEluLXByb2Nlc3MgdGVhbW1hdGVzIGNhbm5vdCBzcGF3biBiYWNrZ3JvdW5kIGFnZW50cy4gQWdlbnQgJyR7c2VsZWN0ZWRBZ2VudC5hZ2VudFR5cGV9JyBoYXMgYmFja2dyb3VuZDogdHJ1ZSBpbiBpdHMgZGVmaW5pdGlvbi5gLFxuICAgICAgKVxuICAgIH1cblxuICAgIC8vIENhcHR1cmUgZm9yIHR5cGUgbmFycm93aW5nIOKAlCBgbGV0IHNlbGVjdGVkQWdlbnRgIHByZXZlbnRzIFRTIGZyb21cbiAgICAvLyBuYXJyb3dpbmcgcHJvcGVydHkgdHlwZXMgYWNyb3NzIHRoZSBpZi1lbHNlIGFzc2lnbm1lbnQgYWJvdmUuXG4gICAgY29uc3QgcmVxdWlyZWRNY3BTZXJ2ZXJzID0gc2VsZWN0ZWRBZ2VudC5yZXF1aXJlZE1jcFNlcnZlcnNcblxuICAgIC8vIENoZWNrIGlmIHJlcXVpcmVkIE1DUCBzZXJ2ZXJzIGhhdmUgdG9vbHMgYXZhaWxhYmxlXG4gICAgLy8gQSBzZXJ2ZXIgdGhhdCdzIGNvbm5lY3RlZCBidXQgbm90IGF1dGhlbnRpY2F0ZWQgd29uJ3QgaGF2ZSBhbnkgdG9vbHNcbiAgICBpZiAocmVxdWlyZWRNY3BTZXJ2ZXJzPy5sZW5ndGgpIHtcbiAgICAgIC8vIElmIGFueSByZXF1aXJlZCBzZXJ2ZXJzIGFyZSBzdGlsbCBwZW5kaW5nIChjb25uZWN0aW5nKSwgd2FpdCBmb3IgdGhlbVxuICAgICAgLy8gYmVmb3JlIGNoZWNraW5nIHRvb2wgYXZhaWxhYmlsaXR5LiBUaGlzIGF2b2lkcyBhIHJhY2UgY29uZGl0aW9uIHdoZXJlXG4gICAgICAvLyB0aGUgYWdlbnQgaXMgaW52b2tlZCBiZWZvcmUgTUNQIHNlcnZlcnMgZmluaXNoIGNvbm5lY3RpbmcuXG4gICAgICBjb25zdCBoYXNQZW5kaW5nUmVxdWlyZWRTZXJ2ZXJzID0gYXBwU3RhdGUubWNwLmNsaWVudHMuc29tZShcbiAgICAgICAgYyA9PlxuICAgICAgICAgIGMudHlwZSA9PT0gJ3BlbmRpbmcnICYmXG4gICAgICAgICAgcmVxdWlyZWRNY3BTZXJ2ZXJzLnNvbWUocGF0dGVybiA9PlxuICAgICAgICAgICAgYy5uYW1lLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMocGF0dGVybi50b0xvd2VyQ2FzZSgpKSxcbiAgICAgICAgICApLFxuICAgICAgKVxuXG4gICAgICBsZXQgY3VycmVudEFwcFN0YXRlID0gYXBwU3RhdGVcbiAgICAgIGlmIChoYXNQZW5kaW5nUmVxdWlyZWRTZXJ2ZXJzKSB7XG4gICAgICAgIGNvbnN0IE1BWF9XQUlUX01TID0gMzBfMDAwXG4gICAgICAgIGNvbnN0IFBPTExfSU5URVJWQUxfTVMgPSA1MDBcbiAgICAgICAgY29uc3QgZGVhZGxpbmUgPSBEYXRlLm5vdygpICsgTUFYX1dBSVRfTVNcblxuICAgICAgICB3aGlsZSAoRGF0ZS5ub3coKSA8IGRlYWRsaW5lKSB7XG4gICAgICAgICAgYXdhaXQgc2xlZXAoUE9MTF9JTlRFUlZBTF9NUylcbiAgICAgICAgICBjdXJyZW50QXBwU3RhdGUgPSB0b29sVXNlQ29udGV4dC5nZXRBcHBTdGF0ZSgpXG5cbiAgICAgICAgICAvLyBFYXJseSBleGl0OiBpZiBhbnkgcmVxdWlyZWQgc2VydmVyIGhhcyBhbHJlYWR5IGZhaWxlZCwgbm8gcG9pbnRcbiAgICAgICAgICAvLyB3YWl0aW5nIGZvciBvdGhlciBwZW5kaW5nIHNlcnZlcnMg4oCUIHRoZSBjaGVjayB3aWxsIGZhaWwgcmVnYXJkbGVzcy5cbiAgICAgICAgICBjb25zdCBoYXNGYWlsZWRSZXF1aXJlZFNlcnZlciA9IGN1cnJlbnRBcHBTdGF0ZS5tY3AuY2xpZW50cy5zb21lKFxuICAgICAgICAgICAgYyA9PlxuICAgICAgICAgICAgICBjLnR5cGUgPT09ICdmYWlsZWQnICYmXG4gICAgICAgICAgICAgIHJlcXVpcmVkTWNwU2VydmVycy5zb21lKHBhdHRlcm4gPT5cbiAgICAgICAgICAgICAgICBjLm5hbWUudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhwYXR0ZXJuLnRvTG93ZXJDYXNlKCkpLFxuICAgICAgICAgICAgICApLFxuICAgICAgICAgIClcbiAgICAgICAgICBpZiAoaGFzRmFpbGVkUmVxdWlyZWRTZXJ2ZXIpIGJyZWFrXG5cbiAgICAgICAgICBjb25zdCBzdGlsbFBlbmRpbmcgPSBjdXJyZW50QXBwU3RhdGUubWNwLmNsaWVudHMuc29tZShcbiAgICAgICAgICAgIGMgPT5cbiAgICAgICAgICAgICAgYy50eXBlID09PSAncGVuZGluZycgJiZcbiAgICAgICAgICAgICAgcmVxdWlyZWRNY3BTZXJ2ZXJzLnNvbWUocGF0dGVybiA9PlxuICAgICAgICAgICAgICAgIGMubmFtZS50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKHBhdHRlcm4udG9Mb3dlckNhc2UoKSksXG4gICAgICAgICAgICAgICksXG4gICAgICAgICAgKVxuICAgICAgICAgIGlmICghc3RpbGxQZW5kaW5nKSBicmVha1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIC8vIEdldCBzZXJ2ZXJzIHRoYXQgYWN0dWFsbHkgaGF2ZSB0b29scyAobWVhbmluZyB0aGV5J3JlIGNvbm5lY3RlZCBBTkQgYXV0aGVudGljYXRlZClcbiAgICAgIGNvbnN0IHNlcnZlcnNXaXRoVG9vbHM6IHN0cmluZ1tdID0gW11cbiAgICAgIGZvciAoY29uc3QgdG9vbCBvZiBjdXJyZW50QXBwU3RhdGUubWNwLnRvb2xzKSB7XG4gICAgICAgIGlmICh0b29sLm5hbWU/LnN0YXJ0c1dpdGgoJ21jcF9fJykpIHtcbiAgICAgICAgICAvLyBFeHRyYWN0IHNlcnZlciBuYW1lIGZyb20gdG9vbCBuYW1lIChmb3JtYXQ6IG1jcF9fc2VydmVyTmFtZV9fdG9vbE5hbWUpXG4gICAgICAgICAgY29uc3QgcGFydHMgPSB0b29sLm5hbWUuc3BsaXQoJ19fJylcbiAgICAgICAgICBjb25zdCBzZXJ2ZXJOYW1lID0gcGFydHNbMV1cbiAgICAgICAgICBpZiAoc2VydmVyTmFtZSAmJiAhc2VydmVyc1dpdGhUb29scy5pbmNsdWRlcyhzZXJ2ZXJOYW1lKSkge1xuICAgICAgICAgICAgc2VydmVyc1dpdGhUb29scy5wdXNoKHNlcnZlck5hbWUpXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmICghaGFzUmVxdWlyZWRNY3BTZXJ2ZXJzKHNlbGVjdGVkQWdlbnQsIHNlcnZlcnNXaXRoVG9vbHMpKSB7XG4gICAgICAgIGNvbnN0IG1pc3NpbmcgPSByZXF1aXJlZE1jcFNlcnZlcnMuZmlsdGVyKFxuICAgICAgICAgIHBhdHRlcm4gPT5cbiAgICAgICAgICAgICFzZXJ2ZXJzV2l0aFRvb2xzLnNvbWUoc2VydmVyID0+XG4gICAgICAgICAgICAgIHNlcnZlci50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKHBhdHRlcm4udG9Mb3dlckNhc2UoKSksXG4gICAgICAgICAgICApLFxuICAgICAgICApXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICBgQWdlbnQgJyR7c2VsZWN0ZWRBZ2VudC5hZ2VudFR5cGV9JyByZXF1aXJlcyBNQ1Agc2VydmVycyBtYXRjaGluZzogJHttaXNzaW5nLmpvaW4oJywgJyl9LiBgICtcbiAgICAgICAgICAgIGBNQ1Agc2VydmVycyB3aXRoIHRvb2xzOiAke3NlcnZlcnNXaXRoVG9vbHMubGVuZ3RoID4gMCA/IHNlcnZlcnNXaXRoVG9vbHMuam9pbignLCAnKSA6ICdub25lJ30uIGAgK1xuICAgICAgICAgICAgYFVzZSAvbWNwIHRvIGNvbmZpZ3VyZSBhbmQgYXV0aGVudGljYXRlIHRoZSByZXF1aXJlZCBNQ1Agc2VydmVycy5gLFxuICAgICAgICApXG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gSW5pdGlhbGl6ZSB0aGUgY29sb3IgZm9yIHRoaXMgYWdlbnQgaWYgaXQgaGFzIGEgcHJlZGVmaW5lZCBvbmVcbiAgICBpZiAoc2VsZWN0ZWRBZ2VudC5jb2xvcikge1xuICAgICAgc2V0QWdlbnRDb2xvcihzZWxlY3RlZEFnZW50LmFnZW50VHlwZSwgc2VsZWN0ZWRBZ2VudC5jb2xvcilcbiAgICB9XG5cbiAgICAvLyBSZXNvbHZlIGFnZW50IHBhcmFtcyBmb3IgbG9nZ2luZyAodGhlc2UgYXJlIGFscmVhZHkgcmVzb2x2ZWQgaW4gcnVuQWdlbnQpXG4gICAgY29uc3QgcmVzb2x2ZWRBZ2VudE1vZGVsID0gZ2V0QWdlbnRNb2RlbChcbiAgICAgIHNlbGVjdGVkQWdlbnQubW9kZWwsXG4gICAgICB0b29sVXNlQ29udGV4dC5vcHRpb25zLm1haW5Mb29wTW9kZWwsXG4gICAgICBpc0ZvcmtQYXRoID8gdW5kZWZpbmVkIDogbW9kZWwsXG4gICAgICBwZXJtaXNzaW9uTW9kZSxcbiAgICApXG5cbiAgICBsb2dFdmVudCgndGVuZ3VfYWdlbnRfdG9vbF9zZWxlY3RlZCcsIHtcbiAgICAgIGFnZW50X3R5cGU6XG4gICAgICAgIHNlbGVjdGVkQWdlbnQuYWdlbnRUeXBlIGFzIEFuYWx5dGljc01ldGFkYXRhX0lfVkVSSUZJRURfVEhJU19JU19OT1RfQ09ERV9PUl9GSUxFUEFUSFMsXG4gICAgICBtb2RlbDpcbiAgICAgICAgcmVzb2x2ZWRBZ2VudE1vZGVsIGFzIEFuYWx5dGljc01ldGFkYXRhX0lfVkVSSUZJRURfVEhJU19JU19OT1RfQ09ERV9PUl9GSUxFUEFUSFMsXG4gICAgICBzb3VyY2U6XG4gICAgICAgIHNlbGVjdGVkQWdlbnQuc291cmNlIGFzIEFuYWx5dGljc01ldGFkYXRhX0lfVkVSSUZJRURfVEhJU19JU19OT1RfQ09ERV9PUl9GSUxFUEFUSFMsXG4gICAgICBjb2xvcjpcbiAgICAgICAgc2VsZWN0ZWRBZ2VudC5jb2xvciBhcyBBbmFseXRpY3NNZXRhZGF0YV9JX1ZFUklGSUVEX1RISVNfSVNfTk9UX0NPREVfT1JfRklMRVBBVEhTLFxuICAgICAgaXNfYnVpbHRfaW5fYWdlbnQ6IGlzQnVpbHRJbkFnZW50KHNlbGVjdGVkQWdlbnQpLFxuICAgICAgaXNfcmVzdW1lOiBmYWxzZSxcbiAgICAgIGlzX2FzeW5jOlxuICAgICAgICAocnVuX2luX2JhY2tncm91bmQgPT09IHRydWUgfHwgc2VsZWN0ZWRBZ2VudC5iYWNrZ3JvdW5kID09PSB0cnVlKSAmJlxuICAgICAgICAhaXNCYWNrZ3JvdW5kVGFza3NEaXNhYmxlZCxcbiAgICAgIGlzX2Zvcms6IGlzRm9ya1BhdGgsXG4gICAgfSlcblxuICAgIC8vIFJlc29sdmUgZWZmZWN0aXZlIGlzb2xhdGlvbiBtb2RlIChleHBsaWNpdCBwYXJhbSBvdmVycmlkZXMgYWdlbnQgZGVmKVxuICAgIGNvbnN0IGVmZmVjdGl2ZUlzb2xhdGlvbiA9IGlzb2xhdGlvbiA/PyBzZWxlY3RlZEFnZW50Lmlzb2xhdGlvblxuXG4gICAgLy8gUmVtb3RlIGlzb2xhdGlvbjogZGVsZWdhdGUgdG8gQ0NSLiBHYXRlZCBhbnQtb25seSDigJQgdGhlIGd1YXJkIGVuYWJsZXNcbiAgICAvLyBkZWFkIGNvZGUgZWxpbWluYXRpb24gb2YgdGhlIGVudGlyZSBibG9jayBmb3IgZXh0ZXJuYWwgYnVpbGRzLlxuICAgIGlmIChcImV4dGVybmFsXCIgPT09ICdhbnQnICYmIGVmZmVjdGl2ZUlzb2xhdGlvbiA9PT0gJ3JlbW90ZScpIHtcbiAgICAgIGNvbnN0IGVsaWdpYmlsaXR5ID0gYXdhaXQgY2hlY2tSZW1vdGVBZ2VudEVsaWdpYmlsaXR5KClcbiAgICAgIGlmICghZWxpZ2liaWxpdHkuZWxpZ2libGUpIHtcbiAgICAgICAgY29uc3QgcmVhc29ucyA9IGVsaWdpYmlsaXR5LmVycm9yc1xuICAgICAgICAgIC5tYXAoZm9ybWF0UHJlY29uZGl0aW9uRXJyb3IpXG4gICAgICAgICAgLmpvaW4oJ1xcbicpXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IGxhdW5jaCByZW1vdGUgYWdlbnQ6XFxuJHtyZWFzb25zfWApXG4gICAgICB9XG5cbiAgICAgIGxldCBidW5kbGVGYWlsSGludDogc3RyaW5nIHwgdW5kZWZpbmVkXG4gICAgICBjb25zdCBzZXNzaW9uID0gYXdhaXQgdGVsZXBvcnRUb1JlbW90ZSh7XG4gICAgICAgIGluaXRpYWxNZXNzYWdlOiBwcm9tcHQsXG4gICAgICAgIGRlc2NyaXB0aW9uLFxuICAgICAgICBzaWduYWw6IHRvb2xVc2VDb250ZXh0LmFib3J0Q29udHJvbGxlci5zaWduYWwsXG4gICAgICAgIG9uQnVuZGxlRmFpbDogbXNnID0+IHtcbiAgICAgICAgICBidW5kbGVGYWlsSGludCA9IG1zZ1xuICAgICAgICB9LFxuICAgICAgfSlcbiAgICAgIGlmICghc2Vzc2lvbikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYnVuZGxlRmFpbEhpbnQgPz8gJ0ZhaWxlZCB0byBjcmVhdGUgcmVtb3RlIHNlc3Npb24nKVxuICAgICAgfVxuXG4gICAgICBjb25zdCB7IHRhc2tJZCwgc2Vzc2lvbklkIH0gPSByZWdpc3RlclJlbW90ZUFnZW50VGFzayh7XG4gICAgICAgIHJlbW90ZVRhc2tUeXBlOiAncmVtb3RlLWFnZW50JyxcbiAgICAgICAgc2Vzc2lvbjogeyBpZDogc2Vzc2lvbi5pZCwgdGl0bGU6IHNlc3Npb24udGl0bGUgfHwgZGVzY3JpcHRpb24gfSxcbiAgICAgICAgY29tbWFuZDogcHJvbXB0LFxuICAgICAgICBjb250ZXh0OiB0b29sVXNlQ29udGV4dCxcbiAgICAgICAgdG9vbFVzZUlkOiB0b29sVXNlQ29udGV4dC50b29sVXNlSWQsXG4gICAgICB9KVxuXG4gICAgICBsb2dFdmVudCgndGVuZ3VfYWdlbnRfdG9vbF9yZW1vdGVfbGF1bmNoZWQnLCB7XG4gICAgICAgIGFnZW50X3R5cGU6XG4gICAgICAgICAgc2VsZWN0ZWRBZ2VudC5hZ2VudFR5cGUgYXMgQW5hbHl0aWNzTWV0YWRhdGFfSV9WRVJJRklFRF9USElTX0lTX05PVF9DT0RFX09SX0ZJTEVQQVRIUyxcbiAgICAgIH0pXG5cbiAgICAgIGNvbnN0IHJlbW90ZVJlc3VsdDogUmVtb3RlTGF1bmNoZWRPdXRwdXQgPSB7XG4gICAgICAgIHN0YXR1czogJ3JlbW90ZV9sYXVuY2hlZCcsXG4gICAgICAgIHRhc2tJZCxcbiAgICAgICAgc2Vzc2lvblVybDogZ2V0UmVtb3RlVGFza1Nlc3Npb25Vcmwoc2Vzc2lvbklkKSxcbiAgICAgICAgZGVzY3JpcHRpb24sXG4gICAgICAgIHByb21wdCxcbiAgICAgICAgb3V0cHV0RmlsZTogZ2V0VGFza091dHB1dFBhdGgodGFza0lkKSxcbiAgICAgIH1cbiAgICAgIHJldHVybiB7IGRhdGE6IHJlbW90ZVJlc3VsdCB9IGFzIHVua25vd24gYXMgeyBkYXRhOiBPdXRwdXQgfVxuICAgIH1cbiAgICAvLyBTeXN0ZW0gcHJvbXB0ICsgcHJvbXB0IG1lc3NhZ2VzOiBicmFuY2ggb24gZm9yayBwYXRoLlxuICAgIC8vXG4gICAgLy8gRm9yayBwYXRoOiBjaGlsZCBpbmhlcml0cyB0aGUgUEFSRU5UJ3Mgc3lzdGVtIHByb21wdCAobm90IEZPUktfQUdFTlQncylcbiAgICAvLyBmb3IgY2FjaGUtaWRlbnRpY2FsIEFQSSByZXF1ZXN0IHByZWZpeGVzLiBQcm9tcHQgbWVzc2FnZXMgYXJlIGJ1aWx0IHZpYVxuICAgIC8vIGJ1aWxkRm9ya2VkTWVzc2FnZXMoKSB3aGljaCBjbG9uZXMgdGhlIHBhcmVudCdzIGZ1bGwgYXNzaXN0YW50IG1lc3NhZ2VcbiAgICAvLyAoYWxsIHRvb2xfdXNlIGJsb2NrcykgKyBwbGFjZWhvbGRlciB0b29sX3Jlc3VsdHMgKyBwZXItY2hpbGQgZGlyZWN0aXZlLlxuICAgIC8vXG4gICAgLy8gTm9ybWFsIHBhdGg6IGJ1aWxkIHRoZSBzZWxlY3RlZCBhZ2VudCdzIG93biBzeXN0ZW0gcHJvbXB0IHdpdGggZW52XG4gICAgLy8gZGV0YWlscywgYW5kIHVzZSBhIHNpbXBsZSB1c2VyIG1lc3NhZ2UgZm9yIHRoZSBwcm9tcHQuXG4gICAgbGV0IGVuaGFuY2VkU3lzdGVtUHJvbXB0OiBzdHJpbmdbXSB8IHVuZGVmaW5lZFxuICAgIGxldCBmb3JrUGFyZW50U3lzdGVtUHJvbXB0OlxuICAgICAgfCBSZXR1cm5UeXBlPHR5cGVvZiBidWlsZEVmZmVjdGl2ZVN5c3RlbVByb21wdD5cbiAgICAgIHwgdW5kZWZpbmVkXG4gICAgbGV0IHByb21wdE1lc3NhZ2VzOiBNZXNzYWdlVHlwZVtdXG5cbiAgICBpZiAoaXNGb3JrUGF0aCkge1xuICAgICAgaWYgKHRvb2xVc2VDb250ZXh0LnJlbmRlcmVkU3lzdGVtUHJvbXB0KSB7XG4gICAgICAgIGZvcmtQYXJlbnRTeXN0ZW1Qcm9tcHQgPSB0b29sVXNlQ29udGV4dC5yZW5kZXJlZFN5c3RlbVByb21wdFxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gRmFsbGJhY2s6IHJlY29tcHV0ZS4gTWF5IGRpdmVyZ2UgZnJvbSBwYXJlbnQncyBjYWNoZWQgYnl0ZXMgaWZcbiAgICAgICAgLy8gR3Jvd3RoQm9vayBzdGF0ZSBjaGFuZ2VkIGJldHdlZW4gcGFyZW50IHR1cm4tc3RhcnQgYW5kIGZvcmsgc3Bhd24uXG4gICAgICAgIGNvbnN0IG1haW5UaHJlYWRBZ2VudERlZmluaXRpb24gPSBhcHBTdGF0ZS5hZ2VudFxuICAgICAgICAgID8gYXBwU3RhdGUuYWdlbnREZWZpbml0aW9ucy5hY3RpdmVBZ2VudHMuZmluZChcbiAgICAgICAgICAgICAgYSA9PiBhLmFnZW50VHlwZSA9PT0gYXBwU3RhdGUuYWdlbnQsXG4gICAgICAgICAgICApXG4gICAgICAgICAgOiB1bmRlZmluZWRcbiAgICAgICAgY29uc3QgYWRkaXRpb25hbFdvcmtpbmdEaXJlY3RvcmllcyA9IEFycmF5LmZyb20oXG4gICAgICAgICAgYXBwU3RhdGUudG9vbFBlcm1pc3Npb25Db250ZXh0LmFkZGl0aW9uYWxXb3JraW5nRGlyZWN0b3JpZXMua2V5cygpLFxuICAgICAgICApXG4gICAgICAgIGNvbnN0IGRlZmF1bHRTeXN0ZW1Qcm9tcHQgPSBhd2FpdCBnZXRTeXN0ZW1Qcm9tcHQoXG4gICAgICAgICAgdG9vbFVzZUNvbnRleHQub3B0aW9ucy50b29scyxcbiAgICAgICAgICB0b29sVXNlQ29udGV4dC5vcHRpb25zLm1haW5Mb29wTW9kZWwsXG4gICAgICAgICAgYWRkaXRpb25hbFdvcmtpbmdEaXJlY3RvcmllcyxcbiAgICAgICAgICB0b29sVXNlQ29udGV4dC5vcHRpb25zLm1jcENsaWVudHMsXG4gICAgICAgIClcbiAgICAgICAgZm9ya1BhcmVudFN5c3RlbVByb21wdCA9IGJ1aWxkRWZmZWN0aXZlU3lzdGVtUHJvbXB0KHtcbiAgICAgICAgICBtYWluVGhyZWFkQWdlbnREZWZpbml0aW9uLFxuICAgICAgICAgIHRvb2xVc2VDb250ZXh0LFxuICAgICAgICAgIGN1c3RvbVN5c3RlbVByb21wdDogdG9vbFVzZUNvbnRleHQub3B0aW9ucy5jdXN0b21TeXN0ZW1Qcm9tcHQsXG4gICAgICAgICAgZGVmYXVsdFN5c3RlbVByb21wdCxcbiAgICAgICAgICBhcHBlbmRTeXN0ZW1Qcm9tcHQ6IHRvb2xVc2VDb250ZXh0Lm9wdGlvbnMuYXBwZW5kU3lzdGVtUHJvbXB0LFxuICAgICAgICB9KVxuICAgICAgfVxuICAgICAgcHJvbXB0TWVzc2FnZXMgPSBidWlsZEZvcmtlZE1lc3NhZ2VzKHByb21wdCwgYXNzaXN0YW50TWVzc2FnZSlcbiAgICB9IGVsc2Uge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgYWRkaXRpb25hbFdvcmtpbmdEaXJlY3RvcmllcyA9IEFycmF5LmZyb20oXG4gICAgICAgICAgYXBwU3RhdGUudG9vbFBlcm1pc3Npb25Db250ZXh0LmFkZGl0aW9uYWxXb3JraW5nRGlyZWN0b3JpZXMua2V5cygpLFxuICAgICAgICApXG5cbiAgICAgICAgLy8gQWxsIGFnZW50cyBoYXZlIGdldFN5c3RlbVByb21wdCAtIHBhc3MgdG9vbFVzZUNvbnRleHQgdG8gYWxsXG4gICAgICAgIGNvbnN0IGFnZW50UHJvbXB0ID0gc2VsZWN0ZWRBZ2VudC5nZXRTeXN0ZW1Qcm9tcHQoeyB0b29sVXNlQ29udGV4dCB9KVxuXG4gICAgICAgIC8vIExvZyBhZ2VudCBtZW1vcnkgbG9hZGVkIGV2ZW50IGZvciBzdWJhZ2VudHNcbiAgICAgICAgaWYgKHNlbGVjdGVkQWdlbnQubWVtb3J5KSB7XG4gICAgICAgICAgbG9nRXZlbnQoJ3Rlbmd1X2FnZW50X21lbW9yeV9sb2FkZWQnLCB7XG4gICAgICAgICAgICAuLi4oXCJleHRlcm5hbFwiID09PSAnYW50JyAmJiB7XG4gICAgICAgICAgICAgIGFnZW50X3R5cGU6XG4gICAgICAgICAgICAgICAgc2VsZWN0ZWRBZ2VudC5hZ2VudFR5cGUgYXMgQW5hbHl0aWNzTWV0YWRhdGFfSV9WRVJJRklFRF9USElTX0lTX05PVF9DT0RFX09SX0ZJTEVQQVRIUyxcbiAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgc2NvcGU6XG4gICAgICAgICAgICAgIHNlbGVjdGVkQWdlbnQubWVtb3J5IGFzIEFuYWx5dGljc01ldGFkYXRhX0lfVkVSSUZJRURfVEhJU19JU19OT1RfQ09ERV9PUl9GSUxFUEFUSFMsXG4gICAgICAgICAgICBzb3VyY2U6XG4gICAgICAgICAgICAgICdzdWJhZ2VudCcgYXMgQW5hbHl0aWNzTWV0YWRhdGFfSV9WRVJJRklFRF9USElTX0lTX05PVF9DT0RFX09SX0ZJTEVQQVRIUyxcbiAgICAgICAgICB9KVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gQXBwbHkgZW52aXJvbm1lbnQgZGV0YWlscyBlbmhhbmNlbWVudFxuICAgICAgICBlbmhhbmNlZFN5c3RlbVByb21wdCA9IGF3YWl0IGVuaGFuY2VTeXN0ZW1Qcm9tcHRXaXRoRW52RGV0YWlscyhcbiAgICAgICAgICBbYWdlbnRQcm9tcHRdLFxuICAgICAgICAgIHJlc29sdmVkQWdlbnRNb2RlbCxcbiAgICAgICAgICBhZGRpdGlvbmFsV29ya2luZ0RpcmVjdG9yaWVzLFxuICAgICAgICApXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBsb2dGb3JEZWJ1Z2dpbmcoXG4gICAgICAgICAgYEZhaWxlZCB0byBnZXQgc3lzdGVtIHByb21wdCBmb3IgYWdlbnQgJHtzZWxlY3RlZEFnZW50LmFnZW50VHlwZX06ICR7ZXJyb3JNZXNzYWdlKGVycm9yKX1gLFxuICAgICAgICApXG4gICAgICB9XG4gICAgICBwcm9tcHRNZXNzYWdlcyA9IFtjcmVhdGVVc2VyTWVzc2FnZSh7IGNvbnRlbnQ6IHByb21wdCB9KV1cbiAgICB9XG5cbiAgICBjb25zdCBtZXRhZGF0YSA9IHtcbiAgICAgIHByb21wdCxcbiAgICAgIHJlc29sdmVkQWdlbnRNb2RlbCxcbiAgICAgIGlzQnVpbHRJbkFnZW50OiBpc0J1aWx0SW5BZ2VudChzZWxlY3RlZEFnZW50KSxcbiAgICAgIHN0YXJ0VGltZSxcbiAgICAgIGFnZW50VHlwZTogc2VsZWN0ZWRBZ2VudC5hZ2VudFR5cGUsXG4gICAgICBpc0FzeW5jOlxuICAgICAgICAocnVuX2luX2JhY2tncm91bmQgPT09IHRydWUgfHwgc2VsZWN0ZWRBZ2VudC5iYWNrZ3JvdW5kID09PSB0cnVlKSAmJlxuICAgICAgICAhaXNCYWNrZ3JvdW5kVGFza3NEaXNhYmxlZCxcbiAgICB9XG5cbiAgICAvLyBVc2UgaW5saW5lIGVudiBjaGVjayBpbnN0ZWFkIG9mIGNvb3JkaW5hdG9yTW9kdWxlIHRvIGF2b2lkIGNpcmN1bGFyXG4gICAgLy8gZGVwZW5kZW5jeSBpc3N1ZXMgZHVyaW5nIHRlc3QgbW9kdWxlIGxvYWRpbmcuXG4gICAgY29uc3QgaXNDb29yZGluYXRvciA9IGZlYXR1cmUoJ0NPT1JESU5BVE9SX01PREUnKVxuICAgICAgPyBpc0VudlRydXRoeShwcm9jZXNzLmVudi5DTEFVREVfQ09ERV9DT09SRElOQVRPUl9NT0RFKVxuICAgICAgOiBmYWxzZVxuXG4gICAgLy8gRm9yayBzdWJhZ2VudCBleHBlcmltZW50OiBmb3JjZSBBTEwgc3Bhd25zIGFzeW5jIGZvciBhIHVuaWZpZWRcbiAgICAvLyA8dGFzay1ub3RpZmljYXRpb24+IGludGVyYWN0aW9uIG1vZGVsIChub3QganVzdCBmb3JrIHNwYXducyDigJQgYWxsIG9mIHRoZW0pLlxuICAgIGNvbnN0IGZvcmNlQXN5bmMgPSBpc0ZvcmtTdWJhZ2VudEVuYWJsZWQoKVxuXG4gICAgLy8gQXNzaXN0YW50IG1vZGU6IGZvcmNlIGFsbCBhZ2VudHMgYXN5bmMuIFN5bmNocm9ub3VzIHN1YmFnZW50cyBob2xkIHRoZVxuICAgIC8vIG1haW4gbG9vcCdzIHR1cm4gb3BlbiB1bnRpbCB0aGV5IGNvbXBsZXRlIOKAlCB0aGUgZGFlbW9uJ3MgaW5wdXRRdWV1ZVxuICAgIC8vIGJhY2tzIHVwLCBhbmQgdGhlIGZpcnN0IG92ZXJkdWUgY3JvbiBjYXRjaC11cCBvbiBzcGF3biBiZWNvbWVzIE5cbiAgICAvLyBzZXJpYWwgc3ViYWdlbnQgdHVybnMgYmxvY2tpbmcgYWxsIHVzZXIgaW5wdXQuIFNhbWUgZ2F0ZSBhc1xuICAgIC8vIGV4ZWN1dGVGb3JrZWRTbGFzaENvbW1hbmQncyBmaXJlLWFuZC1mb3JnZXQgcGF0aDsgdGhlXG4gICAgLy8gPHRhc2stbm90aWZpY2F0aW9uPiByZS1lbnRyeSB0aGVyZSBpcyBoYW5kbGVkIGJ5IHRoZSBlbHNlIGJyYW5jaFxuICAgIC8vIGJlbG93IChyZWdpc3RlckFzeW5jQWdlbnRUYXNrICsgbm90aWZ5T25Db21wbGV0aW9uKS5cbiAgICBjb25zdCBhc3Npc3RhbnRGb3JjZUFzeW5jID0gZmVhdHVyZSgnS0FJUk9TJylcbiAgICAgID8gYXBwU3RhdGUua2Fpcm9zRW5hYmxlZFxuICAgICAgOiBmYWxzZVxuXG4gICAgY29uc3Qgc2hvdWxkUnVuQXN5bmMgPVxuICAgICAgKHJ1bl9pbl9iYWNrZ3JvdW5kID09PSB0cnVlIHx8XG4gICAgICAgIHNlbGVjdGVkQWdlbnQuYmFja2dyb3VuZCA9PT0gdHJ1ZSB8fFxuICAgICAgICBpc0Nvb3JkaW5hdG9yIHx8XG4gICAgICAgIGZvcmNlQXN5bmMgfHxcbiAgICAgICAgYXNzaXN0YW50Rm9yY2VBc3luYyB8fFxuICAgICAgICAocHJvYWN0aXZlTW9kdWxlPy5pc1Byb2FjdGl2ZUFjdGl2ZSgpID8/IGZhbHNlKSkgJiZcbiAgICAgICFpc0JhY2tncm91bmRUYXNrc0Rpc2FibGVkXG4gICAgLy8gQXNzZW1ibGUgdGhlIHdvcmtlcidzIHRvb2wgcG9vbCBpbmRlcGVuZGVudGx5IG9mIHRoZSBwYXJlbnQncy5cbiAgICAvLyBXb3JrZXJzIGFsd2F5cyBnZXQgdGhlaXIgdG9vbHMgZnJvbSBhc3NlbWJsZVRvb2xQb29sIHdpdGggdGhlaXIgb3duXG4gICAgLy8gcGVybWlzc2lvbiBtb2RlLCBzbyB0aGV5IGFyZW4ndCBhZmZlY3RlZCBieSB0aGUgcGFyZW50J3MgdG9vbFxuICAgIC8vIHJlc3RyaWN0aW9ucy4gVGhpcyBpcyBjb21wdXRlZCBoZXJlIHNvIHRoYXQgcnVuQWdlbnQgZG9lc24ndCBuZWVkIHRvXG4gICAgLy8gaW1wb3J0IGZyb20gdG9vbHMudHMgKHdoaWNoIHdvdWxkIGNyZWF0ZSBhIGNpcmN1bGFyIGRlcGVuZGVuY3kpLlxuICAgIGNvbnN0IHdvcmtlclBlcm1pc3Npb25Db250ZXh0ID0ge1xuICAgICAgLi4uYXBwU3RhdGUudG9vbFBlcm1pc3Npb25Db250ZXh0LFxuICAgICAgbW9kZTogc2VsZWN0ZWRBZ2VudC5wZXJtaXNzaW9uTW9kZSA/PyAnYWNjZXB0RWRpdHMnLFxuICAgIH1cbiAgICBjb25zdCB3b3JrZXJUb29scyA9IGFzc2VtYmxlVG9vbFBvb2woXG4gICAgICB3b3JrZXJQZXJtaXNzaW9uQ29udGV4dCxcbiAgICAgIGFwcFN0YXRlLm1jcC50b29scyxcbiAgICApXG5cbiAgICAvLyBDcmVhdGUgYSBzdGFibGUgYWdlbnQgSUQgZWFybHkgc28gaXQgY2FuIGJlIHVzZWQgZm9yIHdvcmt0cmVlIHNsdWdcbiAgICBjb25zdCBlYXJseUFnZW50SWQgPSBjcmVhdGVBZ2VudElkKClcblxuICAgIC8vIFNldCB1cCB3b3JrdHJlZSBpc29sYXRpb24gaWYgcmVxdWVzdGVkXG4gICAgbGV0IHdvcmt0cmVlSW5mbzoge1xuICAgICAgd29ya3RyZWVQYXRoOiBzdHJpbmdcbiAgICAgIHdvcmt0cmVlQnJhbmNoPzogc3RyaW5nXG4gICAgICBoZWFkQ29tbWl0Pzogc3RyaW5nXG4gICAgICBnaXRSb290Pzogc3RyaW5nXG4gICAgICBob29rQmFzZWQ/OiBib29sZWFuXG4gICAgfSB8IG51bGwgPSBudWxsXG5cbiAgICBpZiAoZWZmZWN0aXZlSXNvbGF0aW9uID09PSAnd29ya3RyZWUnKSB7XG4gICAgICBjb25zdCBzbHVnID0gYGFnZW50LSR7ZWFybHlBZ2VudElkLnNsaWNlKDAsIDgpfWBcbiAgICAgIHdvcmt0cmVlSW5mbyA9IGF3YWl0IGNyZWF0ZUFnZW50V29ya3RyZWUoc2x1ZylcbiAgICB9XG5cbiAgICAvLyBGb3JrICsgd29ya3RyZWU6IGluamVjdCBhIG5vdGljZSB0ZWxsaW5nIHRoZSBjaGlsZCB0byB0cmFuc2xhdGUgcGF0aHNcbiAgICAvLyBhbmQgcmUtcmVhZCBwb3RlbnRpYWxseSBzdGFsZSBmaWxlcy4gQXBwZW5kZWQgYWZ0ZXIgdGhlIGZvcmsgZGlyZWN0aXZlXG4gICAgLy8gc28gaXQgYXBwZWFycyBhcyB0aGUgbW9zdCByZWNlbnQgZ3VpZGFuY2UgdGhlIGNoaWxkIHNlZXMuXG4gICAgaWYgKGlzRm9ya1BhdGggJiYgd29ya3RyZWVJbmZvKSB7XG4gICAgICBwcm9tcHRNZXNzYWdlcy5wdXNoKFxuICAgICAgICBjcmVhdGVVc2VyTWVzc2FnZSh7XG4gICAgICAgICAgY29udGVudDogYnVpbGRXb3JrdHJlZU5vdGljZShnZXRDd2QoKSwgd29ya3RyZWVJbmZvLndvcmt0cmVlUGF0aCksXG4gICAgICAgIH0pLFxuICAgICAgKVxuICAgIH1cblxuICAgIGNvbnN0IHJ1bkFnZW50UGFyYW1zOiBQYXJhbWV0ZXJzPHR5cGVvZiBydW5BZ2VudD5bMF0gPSB7XG4gICAgICBhZ2VudERlZmluaXRpb246IHNlbGVjdGVkQWdlbnQsXG4gICAgICBwcm9tcHRNZXNzYWdlcyxcbiAgICAgIHRvb2xVc2VDb250ZXh0LFxuICAgICAgY2FuVXNlVG9vbCxcbiAgICAgIGlzQXN5bmM6IHNob3VsZFJ1bkFzeW5jLFxuICAgICAgcXVlcnlTb3VyY2U6XG4gICAgICAgIHRvb2xVc2VDb250ZXh0Lm9wdGlvbnMucXVlcnlTb3VyY2UgPz9cbiAgICAgICAgZ2V0UXVlcnlTb3VyY2VGb3JBZ2VudChcbiAgICAgICAgICBzZWxlY3RlZEFnZW50LmFnZW50VHlwZSxcbiAgICAgICAgICBpc0J1aWx0SW5BZ2VudChzZWxlY3RlZEFnZW50KSxcbiAgICAgICAgKSxcbiAgICAgIG1vZGVsOiBpc0ZvcmtQYXRoID8gdW5kZWZpbmVkIDogbW9kZWwsXG4gICAgICAvLyBGb3JrIHBhdGg6IHBhc3MgcGFyZW50J3Mgc3lzdGVtIHByb21wdCBBTkQgcGFyZW50J3MgZXhhY3QgdG9vbFxuICAgICAgLy8gYXJyYXkgKGNhY2hlLWlkZW50aWNhbCBwcmVmaXgpLiB3b3JrZXJUb29scyBpcyByZWJ1aWx0IHVuZGVyXG4gICAgICAvLyBwZXJtaXNzaW9uTW9kZSAnYnViYmxlJyB3aGljaCBkaWZmZXJzIGZyb20gdGhlIHBhcmVudCdzIG1vZGUsIHNvXG4gICAgICAvLyBpdHMgdG9vbC1kZWYgc2VyaWFsaXphdGlvbiBkaXZlcmdlcyBhbmQgYnJlYWtzIGNhY2hlIGF0IHRoZSBmaXJzdFxuICAgICAgLy8gZGlmZmVyaW5nIHRvb2wuIHVzZUV4YWN0VG9vbHMgYWxzbyBpbmhlcml0cyB0aGUgcGFyZW50J3NcbiAgICAgIC8vIHRoaW5raW5nQ29uZmlnIGFuZCBpc05vbkludGVyYWN0aXZlU2Vzc2lvbiAoc2VlIHJ1bkFnZW50LnRzKS5cbiAgICAgIC8vXG4gICAgICAvLyBOb3JtYWwgcGF0aDogd2hlbiBhIGN3ZCBvdmVycmlkZSBpcyBpbiBlZmZlY3QgKHdvcmt0cmVlIGlzb2xhdGlvblxuICAgICAgLy8gb3IgZXhwbGljaXQgY3dkKSwgc2tpcCB0aGUgcHJlLWJ1aWx0IHN5c3RlbSBwcm9tcHQgc28gcnVuQWdlbnQnc1xuICAgICAgLy8gYnVpbGRBZ2VudFN5c3RlbVByb21wdCgpIHJ1bnMgaW5zaWRlIHdyYXBXaXRoQ3dkIHdoZXJlIGdldEN3ZCgpXG4gICAgICAvLyByZXR1cm5zIHRoZSBvdmVycmlkZSBwYXRoLlxuICAgICAgb3ZlcnJpZGU6IGlzRm9ya1BhdGhcbiAgICAgICAgPyB7IHN5c3RlbVByb21wdDogZm9ya1BhcmVudFN5c3RlbVByb21wdCB9XG4gICAgICAgIDogZW5oYW5jZWRTeXN0ZW1Qcm9tcHQgJiYgIXdvcmt0cmVlSW5mbyAmJiAhY3dkXG4gICAgICAgICAgPyB7IHN5c3RlbVByb21wdDogYXNTeXN0ZW1Qcm9tcHQoZW5oYW5jZWRTeXN0ZW1Qcm9tcHQpIH1cbiAgICAgICAgICA6IHVuZGVmaW5lZCxcbiAgICAgIGF2YWlsYWJsZVRvb2xzOiBpc0ZvcmtQYXRoID8gdG9vbFVzZUNvbnRleHQub3B0aW9ucy50b29scyA6IHdvcmtlclRvb2xzLFxuICAgICAgLy8gUGFzcyBwYXJlbnQgY29udmVyc2F0aW9uIHdoZW4gdGhlIGZvcmstc3ViYWdlbnQgcGF0aCBuZWVkcyBmdWxsXG4gICAgICAvLyBjb250ZXh0LiB1c2VFeGFjdFRvb2xzIGluaGVyaXRzIHRoaW5raW5nQ29uZmlnIChydW5BZ2VudC50czo2MjQpLlxuICAgICAgZm9ya0NvbnRleHRNZXNzYWdlczogaXNGb3JrUGF0aCA/IHRvb2xVc2VDb250ZXh0Lm1lc3NhZ2VzIDogdW5kZWZpbmVkLFxuICAgICAgLi4uKGlzRm9ya1BhdGggJiYgeyB1c2VFeGFjdFRvb2xzOiB0cnVlIH0pLFxuICAgICAgd29ya3RyZWVQYXRoOiB3b3JrdHJlZUluZm8/Lndvcmt0cmVlUGF0aCxcbiAgICAgIGRlc2NyaXB0aW9uLFxuICAgIH1cblxuICAgIC8vIEhlbHBlciB0byB3cmFwIGV4ZWN1dGlvbiB3aXRoIGEgY3dkIG92ZXJyaWRlOiBleHBsaWNpdCBjd2QgYXJnIChLQUlST1MpXG4gICAgLy8gdGFrZXMgcHJlY2VkZW5jZSBvdmVyIHdvcmt0cmVlIGlzb2xhdGlvbiBwYXRoLlxuICAgIGNvbnN0IGN3ZE92ZXJyaWRlUGF0aCA9IGN3ZCA/PyB3b3JrdHJlZUluZm8/Lndvcmt0cmVlUGF0aFxuICAgIGNvbnN0IHdyYXBXaXRoQ3dkID0gPFQsPihmbjogKCkgPT4gVCk6IFQgPT5cbiAgICAgIGN3ZE92ZXJyaWRlUGF0aCA/IHJ1bldpdGhDd2RPdmVycmlkZShjd2RPdmVycmlkZVBhdGgsIGZuKSA6IGZuKClcblxuICAgIC8vIEhlbHBlciB0byBjbGVhbiB1cCB3b3JrdHJlZSBhZnRlciBhZ2VudCBjb21wbGV0ZXNcbiAgICBjb25zdCBjbGVhbnVwV29ya3RyZWVJZk5lZWRlZCA9IGFzeW5jICgpOiBQcm9taXNlPHtcbiAgICAgIHdvcmt0cmVlUGF0aD86IHN0cmluZ1xuICAgICAgd29ya3RyZWVCcmFuY2g/OiBzdHJpbmdcbiAgICB9PiA9PiB7XG4gICAgICBpZiAoIXdvcmt0cmVlSW5mbykgcmV0dXJuIHt9XG4gICAgICBjb25zdCB7IHdvcmt0cmVlUGF0aCwgd29ya3RyZWVCcmFuY2gsIGhlYWRDb21taXQsIGdpdFJvb3QsIGhvb2tCYXNlZCB9ID1cbiAgICAgICAgd29ya3RyZWVJbmZvXG4gICAgICAvLyBOdWxsIG91dCB0byBtYWtlIGlkZW1wb3RlbnQg4oCUIGd1YXJkcyBhZ2FpbnN0IGRvdWJsZS1jYWxsIGlmIGNvZGVcbiAgICAgIC8vIGJldHdlZW4gY2xlYW51cCBhbmQgZW5kIG9mIHRyeSB0aHJvd3MgaW50byBjYXRjaFxuICAgICAgd29ya3RyZWVJbmZvID0gbnVsbFxuICAgICAgaWYgKGhvb2tCYXNlZCkge1xuICAgICAgICAvLyBIb29rLWJhc2VkIHdvcmt0cmVlcyBhcmUgYWx3YXlzIGtlcHQgc2luY2Ugd2UgY2FuJ3QgZGV0ZWN0IFZDUyBjaGFuZ2VzXG4gICAgICAgIGxvZ0ZvckRlYnVnZ2luZyhgSG9vay1iYXNlZCBhZ2VudCB3b3JrdHJlZSBrZXB0IGF0OiAke3dvcmt0cmVlUGF0aH1gKVxuICAgICAgICByZXR1cm4geyB3b3JrdHJlZVBhdGggfVxuICAgICAgfVxuICAgICAgaWYgKGhlYWRDb21taXQpIHtcbiAgICAgICAgY29uc3QgY2hhbmdlZCA9IGF3YWl0IGhhc1dvcmt0cmVlQ2hhbmdlcyh3b3JrdHJlZVBhdGgsIGhlYWRDb21taXQpXG4gICAgICAgIGlmICghY2hhbmdlZCkge1xuICAgICAgICAgIGF3YWl0IHJlbW92ZUFnZW50V29ya3RyZWUod29ya3RyZWVQYXRoLCB3b3JrdHJlZUJyYW5jaCwgZ2l0Um9vdClcbiAgICAgICAgICAvLyBDbGVhciB3b3JrdHJlZVBhdGggZnJvbSBtZXRhZGF0YSBzbyByZXN1bWUgZG9lc24ndCB0cnkgdG8gdXNlXG4gICAgICAgICAgLy8gYSBkZWxldGVkIGRpcmVjdG9yeS4gRmlyZS1hbmQtZm9yZ2V0IHRvIG1hdGNoIHJ1bkFnZW50J3NcbiAgICAgICAgICAvLyB3cml0ZUFnZW50TWV0YWRhdGEgaGFuZGxpbmcuXG4gICAgICAgICAgdm9pZCB3cml0ZUFnZW50TWV0YWRhdGEoYXNBZ2VudElkKGVhcmx5QWdlbnRJZCksIHtcbiAgICAgICAgICAgIGFnZW50VHlwZTogc2VsZWN0ZWRBZ2VudC5hZ2VudFR5cGUsXG4gICAgICAgICAgICBkZXNjcmlwdGlvbixcbiAgICAgICAgICB9KS5jYXRjaChfZXJyID0+XG4gICAgICAgICAgICBsb2dGb3JEZWJ1Z2dpbmcoYEZhaWxlZCB0byBjbGVhciB3b3JrdHJlZSBtZXRhZGF0YTogJHtfZXJyfWApLFxuICAgICAgICAgIClcbiAgICAgICAgICByZXR1cm4ge31cbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgbG9nRm9yRGVidWdnaW5nKGBBZ2VudCB3b3JrdHJlZSBoYXMgY2hhbmdlcywga2VlcGluZzogJHt3b3JrdHJlZVBhdGh9YClcbiAgICAgIHJldHVybiB7IHdvcmt0cmVlUGF0aCwgd29ya3RyZWVCcmFuY2ggfVxuICAgIH1cblxuICAgIGlmIChzaG91bGRSdW5Bc3luYykge1xuICAgICAgY29uc3QgYXN5bmNBZ2VudElkID0gZWFybHlBZ2VudElkXG4gICAgICBjb25zdCBhZ2VudEJhY2tncm91bmRUYXNrID0gcmVnaXN0ZXJBc3luY0FnZW50KHtcbiAgICAgICAgYWdlbnRJZDogYXN5bmNBZ2VudElkLFxuICAgICAgICBkZXNjcmlwdGlvbixcbiAgICAgICAgcHJvbXB0LFxuICAgICAgICBzZWxlY3RlZEFnZW50LFxuICAgICAgICBzZXRBcHBTdGF0ZTogcm9vdFNldEFwcFN0YXRlLFxuICAgICAgICAvLyBEb24ndCBsaW5rIHRvIHBhcmVudCdzIGFib3J0IGNvbnRyb2xsZXIgLS0gYmFja2dyb3VuZCBhZ2VudHMgc2hvdWxkXG4gICAgICAgIC8vIHN1cnZpdmUgd2hlbiB0aGUgdXNlciBwcmVzc2VzIEVTQyB0byBjYW5jZWwgdGhlIG1haW4gdGhyZWFkLlxuICAgICAgICAvLyBUaGV5IGFyZSBraWxsZWQgZXhwbGljaXRseSB2aWEgY2hhdDpraWxsQWdlbnRzLlxuICAgICAgICB0b29sVXNlSWQ6IHRvb2xVc2VDb250ZXh0LnRvb2xVc2VJZCxcbiAgICAgIH0pXG5cbiAgICAgIC8vIFJlZ2lzdGVyIG5hbWUg4oaSIGFnZW50SWQgZm9yIFNlbmRNZXNzYWdlIHJvdXRpbmcuIFBvc3QtcmVnaXN0ZXJBc3luY0FnZW50XG4gICAgICAvLyBzbyB3ZSBkb24ndCBsZWF2ZSBhIHN0YWxlIGVudHJ5IGlmIHNwYXduIGZhaWxzLiBTeW5jIGFnZW50cyBza2lwcGVkIOKAlFxuICAgICAgLy8gY29vcmRpbmF0b3IgaXMgYmxvY2tlZCwgc28gU2VuZE1lc3NhZ2Ugcm91dGluZyBkb2Vzbid0IGFwcGx5LlxuICAgICAgaWYgKG5hbWUpIHtcbiAgICAgICAgcm9vdFNldEFwcFN0YXRlKHByZXYgPT4ge1xuICAgICAgICAgIGNvbnN0IG5leHQgPSBuZXcgTWFwKHByZXYuYWdlbnROYW1lUmVnaXN0cnkpXG4gICAgICAgICAgbmV4dC5zZXQobmFtZSwgYXNBZ2VudElkKGFzeW5jQWdlbnRJZCkpXG4gICAgICAgICAgcmV0dXJuIHsgLi4ucHJldiwgYWdlbnROYW1lUmVnaXN0cnk6IG5leHQgfVxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICAvLyBXcmFwIGFzeW5jIGFnZW50IGV4ZWN1dGlvbiBpbiBhZ2VudCBjb250ZXh0IGZvciBhbmFseXRpY3MgYXR0cmlidXRpb25cbiAgICAgIGNvbnN0IGFzeW5jQWdlbnRDb250ZXh0ID0ge1xuICAgICAgICBhZ2VudElkOiBhc3luY0FnZW50SWQsXG4gICAgICAgIC8vIEZvciBzdWJhZ2VudHMgZnJvbSB0ZWFtbWF0ZXM6IHVzZSB0ZWFtIGxlYWQncyBzZXNzaW9uXG4gICAgICAgIC8vIEZvciBzdWJhZ2VudHMgZnJvbSBtYWluIFJFUEw6IHVuZGVmaW5lZCAobm8gcGFyZW50IHNlc3Npb24pXG4gICAgICAgIHBhcmVudFNlc3Npb25JZDogZ2V0UGFyZW50U2Vzc2lvbklkKCksXG4gICAgICAgIGFnZW50VHlwZTogJ3N1YmFnZW50JyBhcyBjb25zdCxcbiAgICAgICAgc3ViYWdlbnROYW1lOiBzZWxlY3RlZEFnZW50LmFnZW50VHlwZSxcbiAgICAgICAgaXNCdWlsdEluOiBpc0J1aWx0SW5BZ2VudChzZWxlY3RlZEFnZW50KSxcbiAgICAgICAgaW52b2tpbmdSZXF1ZXN0SWQ6IGFzc2lzdGFudE1lc3NhZ2U/LnJlcXVlc3RJZCxcbiAgICAgICAgaW52b2NhdGlvbktpbmQ6ICdzcGF3bicgYXMgY29uc3QsXG4gICAgICAgIGludm9jYXRpb25FbWl0dGVkOiBmYWxzZSxcbiAgICAgIH1cblxuICAgICAgLy8gV29ya2xvYWQgcHJvcGFnYXRpb246IGhhbmRsZVByb21wdFN1Ym1pdCB3cmFwcyB0aGUgZW50aXJlIHR1cm4gaW5cbiAgICAgIC8vIHJ1bldpdGhXb3JrbG9hZCAoQXN5bmNMb2NhbFN0b3JhZ2UpLiBBTFMgY29udGV4dCBpcyBjYXB0dXJlZCBhdFxuICAgICAgLy8gaW52b2NhdGlvbiB0aW1lIOKAlCB3aGVuIHRoaXMgYHZvaWRgIGZpcmVzIOKAlCBhbmQgc3Vydml2ZXMgZXZlcnkgYXdhaXRcbiAgICAgIC8vIGluc2lkZS4gTm8gY2FwdHVyZS9yZXN0b3JlIG5lZWRlZDsgdGhlIGRldGFjaGVkIGNsb3N1cmUgc2VlcyB0aGVcbiAgICAgIC8vIHBhcmVudCB0dXJuJ3Mgd29ya2xvYWQgYXV0b21hdGljYWxseSwgaXNvbGF0ZWQgZnJvbSBpdHMgZmluYWxseS5cbiAgICAgIHZvaWQgcnVuV2l0aEFnZW50Q29udGV4dChhc3luY0FnZW50Q29udGV4dCwgKCkgPT5cbiAgICAgICAgd3JhcFdpdGhDd2QoKCkgPT5cbiAgICAgICAgICBydW5Bc3luY0FnZW50TGlmZWN5Y2xlKHtcbiAgICAgICAgICAgIHRhc2tJZDogYWdlbnRCYWNrZ3JvdW5kVGFzay5hZ2VudElkLFxuICAgICAgICAgICAgYWJvcnRDb250cm9sbGVyOiBhZ2VudEJhY2tncm91bmRUYXNrLmFib3J0Q29udHJvbGxlciEsXG4gICAgICAgICAgICBtYWtlU3RyZWFtOiBvbkNhY2hlU2FmZVBhcmFtcyA9PlxuICAgICAgICAgICAgICBydW5BZ2VudCh7XG4gICAgICAgICAgICAgICAgLi4ucnVuQWdlbnRQYXJhbXMsXG4gICAgICAgICAgICAgICAgb3ZlcnJpZGU6IHtcbiAgICAgICAgICAgICAgICAgIC4uLnJ1bkFnZW50UGFyYW1zLm92ZXJyaWRlLFxuICAgICAgICAgICAgICAgICAgYWdlbnRJZDogYXNBZ2VudElkKGFnZW50QmFja2dyb3VuZFRhc2suYWdlbnRJZCksXG4gICAgICAgICAgICAgICAgICBhYm9ydENvbnRyb2xsZXI6IGFnZW50QmFja2dyb3VuZFRhc2suYWJvcnRDb250cm9sbGVyISxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIG9uQ2FjaGVTYWZlUGFyYW1zLFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIG1ldGFkYXRhLFxuICAgICAgICAgICAgZGVzY3JpcHRpb24sXG4gICAgICAgICAgICB0b29sVXNlQ29udGV4dCxcbiAgICAgICAgICAgIHJvb3RTZXRBcHBTdGF0ZSxcbiAgICAgICAgICAgIGFnZW50SWRGb3JDbGVhbnVwOiBhc3luY0FnZW50SWQsXG4gICAgICAgICAgICBlbmFibGVTdW1tYXJpemF0aW9uOlxuICAgICAgICAgICAgICBpc0Nvb3JkaW5hdG9yIHx8XG4gICAgICAgICAgICAgIGlzRm9ya1N1YmFnZW50RW5hYmxlZCgpIHx8XG4gICAgICAgICAgICAgIGdldFNka0FnZW50UHJvZ3Jlc3NTdW1tYXJpZXNFbmFibGVkKCksXG4gICAgICAgICAgICBnZXRXb3JrdHJlZVJlc3VsdDogY2xlYW51cFdvcmt0cmVlSWZOZWVkZWQsXG4gICAgICAgICAgfSksXG4gICAgICAgICksXG4gICAgICApXG5cbiAgICAgIGNvbnN0IGNhblJlYWRPdXRwdXRGaWxlID0gdG9vbFVzZUNvbnRleHQub3B0aW9ucy50b29scy5zb21lKFxuICAgICAgICB0ID0+XG4gICAgICAgICAgdG9vbE1hdGNoZXNOYW1lKHQsIEZJTEVfUkVBRF9UT09MX05BTUUpIHx8XG4gICAgICAgICAgdG9vbE1hdGNoZXNOYW1lKHQsIEJBU0hfVE9PTF9OQU1FKSxcbiAgICAgIClcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGRhdGE6IHtcbiAgICAgICAgICBpc0FzeW5jOiB0cnVlIGFzIGNvbnN0LFxuICAgICAgICAgIHN0YXR1czogJ2FzeW5jX2xhdW5jaGVkJyBhcyBjb25zdCxcbiAgICAgICAgICBhZ2VudElkOiBhZ2VudEJhY2tncm91bmRUYXNrLmFnZW50SWQsXG4gICAgICAgICAgZGVzY3JpcHRpb246IGRlc2NyaXB0aW9uLFxuICAgICAgICAgIHByb21wdDogcHJvbXB0LFxuICAgICAgICAgIG91dHB1dEZpbGU6IGdldFRhc2tPdXRwdXRQYXRoKGFnZW50QmFja2dyb3VuZFRhc2suYWdlbnRJZCksXG4gICAgICAgICAgY2FuUmVhZE91dHB1dEZpbGUsXG4gICAgICAgIH0sXG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIENyZWF0ZSBhbiBleHBsaWNpdCBhZ2VudElkIGZvciBzeW5jIGFnZW50c1xuICAgICAgY29uc3Qgc3luY0FnZW50SWQgPSBhc0FnZW50SWQoZWFybHlBZ2VudElkKVxuXG4gICAgICAvLyBTZXQgdXAgYWdlbnQgY29udGV4dCBmb3Igc3luYyBleGVjdXRpb24gKGZvciBhbmFseXRpY3MgYXR0cmlidXRpb24pXG4gICAgICBjb25zdCBzeW5jQWdlbnRDb250ZXh0ID0ge1xuICAgICAgICBhZ2VudElkOiBzeW5jQWdlbnRJZCxcbiAgICAgICAgLy8gRm9yIHN1YmFnZW50cyBmcm9tIHRlYW1tYXRlczogdXNlIHRlYW0gbGVhZCdzIHNlc3Npb25cbiAgICAgICAgLy8gRm9yIHN1YmFnZW50cyBmcm9tIG1haW4gUkVQTDogdW5kZWZpbmVkIChubyBwYXJlbnQgc2Vzc2lvbilcbiAgICAgICAgcGFyZW50U2Vzc2lvbklkOiBnZXRQYXJlbnRTZXNzaW9uSWQoKSxcbiAgICAgICAgYWdlbnRUeXBlOiAnc3ViYWdlbnQnIGFzIGNvbnN0LFxuICAgICAgICBzdWJhZ2VudE5hbWU6IHNlbGVjdGVkQWdlbnQuYWdlbnRUeXBlLFxuICAgICAgICBpc0J1aWx0SW46IGlzQnVpbHRJbkFnZW50KHNlbGVjdGVkQWdlbnQpLFxuICAgICAgICBpbnZva2luZ1JlcXVlc3RJZDogYXNzaXN0YW50TWVzc2FnZT8ucmVxdWVzdElkLFxuICAgICAgICBpbnZvY2F0aW9uS2luZDogJ3NwYXduJyBhcyBjb25zdCxcbiAgICAgICAgaW52b2NhdGlvbkVtaXR0ZWQ6IGZhbHNlLFxuICAgICAgfVxuXG4gICAgICAvLyBXcmFwIGVudGlyZSBzeW5jIGFnZW50IGV4ZWN1dGlvbiBpbiBjb250ZXh0IGZvciBhbmFseXRpY3MgYXR0cmlidXRpb25cbiAgICAgIC8vIGFuZCBvcHRpb25hbGx5IGluIGEgd29ya3RyZWUgY3dkIG92ZXJyaWRlIGZvciBmaWxlc3lzdGVtIGlzb2xhdGlvblxuICAgICAgcmV0dXJuIHJ1bldpdGhBZ2VudENvbnRleHQoc3luY0FnZW50Q29udGV4dCwgKCkgPT5cbiAgICAgICAgd3JhcFdpdGhDd2QoYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGNvbnN0IGFnZW50TWVzc2FnZXM6IE1lc3NhZ2VUeXBlW10gPSBbXVxuICAgICAgICAgIGNvbnN0IGFnZW50U3RhcnRUaW1lID0gRGF0ZS5ub3coKVxuICAgICAgICAgIGNvbnN0IHN5bmNUcmFja2VyID0gY3JlYXRlUHJvZ3Jlc3NUcmFja2VyKClcbiAgICAgICAgICBjb25zdCBzeW5jUmVzb2x2ZUFjdGl2aXR5ID0gY3JlYXRlQWN0aXZpdHlEZXNjcmlwdGlvblJlc29sdmVyKFxuICAgICAgICAgICAgdG9vbFVzZUNvbnRleHQub3B0aW9ucy50b29scyxcbiAgICAgICAgICApXG5cbiAgICAgICAgICAvLyBZaWVsZCBpbml0aWFsIHByb2dyZXNzIG1lc3NhZ2UgdG8gY2FycnkgbWV0YWRhdGEgKHByb21wdClcbiAgICAgICAgICBpZiAocHJvbXB0TWVzc2FnZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgY29uc3Qgbm9ybWFsaXplZFByb21wdE1lc3NhZ2VzID0gbm9ybWFsaXplTWVzc2FnZXMocHJvbXB0TWVzc2FnZXMpXG4gICAgICAgICAgICBjb25zdCBub3JtYWxpemVkRmlyc3RNZXNzYWdlID0gbm9ybWFsaXplZFByb21wdE1lc3NhZ2VzLmZpbmQoXG4gICAgICAgICAgICAgIChtKTogbSBpcyBOb3JtYWxpemVkVXNlck1lc3NhZ2UgPT4gbS50eXBlID09PSAndXNlcicsXG4gICAgICAgICAgICApXG4gICAgICAgICAgICBpZiAoXG4gICAgICAgICAgICAgIG5vcm1hbGl6ZWRGaXJzdE1lc3NhZ2UgJiZcbiAgICAgICAgICAgICAgbm9ybWFsaXplZEZpcnN0TWVzc2FnZS50eXBlID09PSAndXNlcicgJiZcbiAgICAgICAgICAgICAgb25Qcm9ncmVzc1xuICAgICAgICAgICAgKSB7XG4gICAgICAgICAgICAgIG9uUHJvZ3Jlc3Moe1xuICAgICAgICAgICAgICAgIHRvb2xVc2VJRDogYGFnZW50XyR7YXNzaXN0YW50TWVzc2FnZS5tZXNzYWdlLmlkfWAsXG4gICAgICAgICAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgICAgICAgbWVzc2FnZTogbm9ybWFsaXplZEZpcnN0TWVzc2FnZSxcbiAgICAgICAgICAgICAgICAgIHR5cGU6ICdhZ2VudF9wcm9ncmVzcycsXG4gICAgICAgICAgICAgICAgICBwcm9tcHQsXG4gICAgICAgICAgICAgICAgICBhZ2VudElkOiBzeW5jQWdlbnRJZCxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cblxuICAgICAgICAgIC8vIFJlZ2lzdGVyIGFzIGZvcmVncm91bmQgdGFzayBpbW1lZGlhdGVseSBzbyBpdCBjYW4gYmUgYmFja2dyb3VuZGVkIGF0IGFueSB0aW1lXG4gICAgICAgICAgLy8gU2tpcCByZWdpc3RyYXRpb24gaWYgYmFja2dyb3VuZCB0YXNrcyBhcmUgZGlzYWJsZWRcbiAgICAgICAgICBsZXQgZm9yZWdyb3VuZFRhc2tJZDogc3RyaW5nIHwgdW5kZWZpbmVkXG4gICAgICAgICAgLy8gQ3JlYXRlIHRoZSBiYWNrZ3JvdW5kIHJhY2UgcHJvbWlzZSBvbmNlIG91dHNpZGUgdGhlIGxvb3Ag4oCUIG90aGVyd2lzZVxuICAgICAgICAgIC8vIGVhY2ggaXRlcmF0aW9uIGFkZHMgYSBuZXcgLnRoZW4oKSByZWFjdGlvbiB0byB0aGUgc2FtZSBwZW5kaW5nXG4gICAgICAgICAgLy8gcHJvbWlzZSwgYWNjdW11bGF0aW5nIGNhbGxiYWNrcyBmb3IgdGhlIGxpZmV0aW1lIG9mIHRoZSBhZ2VudC5cbiAgICAgICAgICBsZXQgYmFja2dyb3VuZFByb21pc2U6IFByb21pc2U8eyB0eXBlOiAnYmFja2dyb3VuZCcgfT4gfCB1bmRlZmluZWRcbiAgICAgICAgICBsZXQgY2FuY2VsQXV0b0JhY2tncm91bmQ6ICgoKSA9PiB2b2lkKSB8IHVuZGVmaW5lZFxuICAgICAgICAgIGlmICghaXNCYWNrZ3JvdW5kVGFza3NEaXNhYmxlZCkge1xuICAgICAgICAgICAgY29uc3QgcmVnaXN0cmF0aW9uID0gcmVnaXN0ZXJBZ2VudEZvcmVncm91bmQoe1xuICAgICAgICAgICAgICBhZ2VudElkOiBzeW5jQWdlbnRJZCxcbiAgICAgICAgICAgICAgZGVzY3JpcHRpb24sXG4gICAgICAgICAgICAgIHByb21wdCxcbiAgICAgICAgICAgICAgc2VsZWN0ZWRBZ2VudCxcbiAgICAgICAgICAgICAgc2V0QXBwU3RhdGU6IHJvb3RTZXRBcHBTdGF0ZSxcbiAgICAgICAgICAgICAgdG9vbFVzZUlkOiB0b29sVXNlQ29udGV4dC50b29sVXNlSWQsXG4gICAgICAgICAgICAgIGF1dG9CYWNrZ3JvdW5kTXM6IGdldEF1dG9CYWNrZ3JvdW5kTXMoKSB8fCB1bmRlZmluZWQsXG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgZm9yZWdyb3VuZFRhc2tJZCA9IHJlZ2lzdHJhdGlvbi50YXNrSWRcbiAgICAgICAgICAgIGJhY2tncm91bmRQcm9taXNlID0gcmVnaXN0cmF0aW9uLmJhY2tncm91bmRTaWduYWwudGhlbigoKSA9PiAoe1xuICAgICAgICAgICAgICB0eXBlOiAnYmFja2dyb3VuZCcgYXMgY29uc3QsXG4gICAgICAgICAgICB9KSlcbiAgICAgICAgICAgIGNhbmNlbEF1dG9CYWNrZ3JvdW5kID0gcmVnaXN0cmF0aW9uLmNhbmNlbEF1dG9CYWNrZ3JvdW5kXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgLy8gVHJhY2sgaWYgd2UndmUgc2hvd24gdGhlIGJhY2tncm91bmQgaGludCBVSVxuICAgICAgICAgIGxldCBiYWNrZ3JvdW5kSGludFNob3duID0gZmFsc2VcbiAgICAgICAgICAvLyBUcmFjayBpZiB0aGUgYWdlbnQgd2FzIGJhY2tncm91bmRlZCAoY2xlYW51cCBoYW5kbGVkIGJ5IGJhY2tncm91bmRlZCBmaW5hbGx5KVxuICAgICAgICAgIGxldCB3YXNCYWNrZ3JvdW5kZWQgPSBmYWxzZVxuICAgICAgICAgIC8vIFBlci1zY29wZSBzdG9wIGZ1bmN0aW9uIOKAlCBOT1Qgc2hhcmVkIHdpdGggdGhlIGJhY2tncm91bmRlZCBjbG9zdXJlLlxuICAgICAgICAgIC8vIGlkZW1wb3RlbnQ6IHN0YXJ0QWdlbnRTdW1tYXJpemF0aW9uJ3Mgc3RvcCgpIGNoZWNrcyBgc3RvcHBlZGAgZmxhZy5cbiAgICAgICAgICBsZXQgc3RvcEZvcmVncm91bmRTdW1tYXJpemF0aW9uOiAoKCkgPT4gdm9pZCkgfCB1bmRlZmluZWRcbiAgICAgICAgICAvLyBjb25zdCBjYXB0dXJlIGZvciBzb3VuZCB0eXBlIG5hcnJvd2luZyBpbnNpZGUgdGhlIGNhbGxiYWNrIGJlbG93XG4gICAgICAgICAgY29uc3Qgc3VtbWFyeVRhc2tJZCA9IGZvcmVncm91bmRUYXNrSWRcblxuICAgICAgICAgIC8vIEdldCBhc3luYyBpdGVyYXRvciBmb3IgdGhlIGFnZW50XG4gICAgICAgICAgY29uc3QgYWdlbnRJdGVyYXRvciA9IHJ1bkFnZW50KHtcbiAgICAgICAgICAgIC4uLnJ1bkFnZW50UGFyYW1zLFxuICAgICAgICAgICAgb3ZlcnJpZGU6IHtcbiAgICAgICAgICAgICAgLi4ucnVuQWdlbnRQYXJhbXMub3ZlcnJpZGUsXG4gICAgICAgICAgICAgIGFnZW50SWQ6IHN5bmNBZ2VudElkLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIG9uQ2FjaGVTYWZlUGFyYW1zOlxuICAgICAgICAgICAgICBzdW1tYXJ5VGFza0lkICYmIGdldFNka0FnZW50UHJvZ3Jlc3NTdW1tYXJpZXNFbmFibGVkKClcbiAgICAgICAgICAgICAgICA/IChwYXJhbXM6IENhY2hlU2FmZVBhcmFtcykgPT4ge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCB7IHN0b3AgfSA9IHN0YXJ0QWdlbnRTdW1tYXJpemF0aW9uKFxuICAgICAgICAgICAgICAgICAgICAgIHN1bW1hcnlUYXNrSWQsXG4gICAgICAgICAgICAgICAgICAgICAgc3luY0FnZW50SWQsXG4gICAgICAgICAgICAgICAgICAgICAgcGFyYW1zLFxuICAgICAgICAgICAgICAgICAgICAgIHJvb3RTZXRBcHBTdGF0ZSxcbiAgICAgICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgICAgICBzdG9wRm9yZWdyb3VuZFN1bW1hcml6YXRpb24gPSBzdG9wXG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgOiB1bmRlZmluZWQsXG4gICAgICAgICAgfSlbU3ltYm9sLmFzeW5jSXRlcmF0b3JdKClcblxuICAgICAgICAgIC8vIFRyYWNrIGlmIGFuIGVycm9yIG9jY3VycmVkIGR1cmluZyBpdGVyYXRpb25cbiAgICAgICAgICBsZXQgc3luY0FnZW50RXJyb3I6IEVycm9yIHwgdW5kZWZpbmVkXG4gICAgICAgICAgbGV0IHdhc0Fib3J0ZWQgPSBmYWxzZVxuICAgICAgICAgIGxldCB3b3JrdHJlZVJlc3VsdDoge1xuICAgICAgICAgICAgd29ya3RyZWVQYXRoPzogc3RyaW5nXG4gICAgICAgICAgICB3b3JrdHJlZUJyYW5jaD86IHN0cmluZ1xuICAgICAgICAgIH0gPSB7fVxuXG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICAgICAgICAgIGNvbnN0IGVsYXBzZWQgPSBEYXRlLm5vdygpIC0gYWdlbnRTdGFydFRpbWVcblxuICAgICAgICAgICAgICAvLyBTaG93IGJhY2tncm91bmQgaGludCBhZnRlciB0aHJlc2hvbGQgKGJ1dCB0YXNrIGlzIGFscmVhZHkgcmVnaXN0ZXJlZClcbiAgICAgICAgICAgICAgLy8gU2tpcCBpZiBiYWNrZ3JvdW5kIHRhc2tzIGFyZSBkaXNhYmxlZFxuICAgICAgICAgICAgICBpZiAoXG4gICAgICAgICAgICAgICAgIWlzQmFja2dyb3VuZFRhc2tzRGlzYWJsZWQgJiZcbiAgICAgICAgICAgICAgICAhYmFja2dyb3VuZEhpbnRTaG93biAmJlxuICAgICAgICAgICAgICAgIGVsYXBzZWQgPj0gUFJPR1JFU1NfVEhSRVNIT0xEX01TICYmXG4gICAgICAgICAgICAgICAgdG9vbFVzZUNvbnRleHQuc2V0VG9vbEpTWFxuICAgICAgICAgICAgICApIHtcbiAgICAgICAgICAgICAgICBiYWNrZ3JvdW5kSGludFNob3duID0gdHJ1ZVxuICAgICAgICAgICAgICAgIHRvb2xVc2VDb250ZXh0LnNldFRvb2xKU1goe1xuICAgICAgICAgICAgICAgICAganN4OiA8QmFja2dyb3VuZEhpbnQgLz4sXG4gICAgICAgICAgICAgICAgICBzaG91bGRIaWRlUHJvbXB0SW5wdXQ6IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgc2hvdWxkQ29udGludWVBbmltYXRpb246IHRydWUsXG4gICAgICAgICAgICAgICAgICBzaG93U3Bpbm5lcjogdHJ1ZSxcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgLy8gUmFjZSBiZXR3ZWVuIG5leHQgbWVzc2FnZSBhbmQgYmFja2dyb3VuZCBzaWduYWxcbiAgICAgICAgICAgICAgLy8gSWYgYmFja2dyb3VuZCB0YXNrcyBhcmUgZGlzYWJsZWQsIGp1c3QgYXdhaXQgdGhlIG5leHQgbWVzc2FnZSBkaXJlY3RseVxuICAgICAgICAgICAgICBjb25zdCBuZXh0TWVzc2FnZVByb21pc2UgPSBhZ2VudEl0ZXJhdG9yLm5leHQoKVxuICAgICAgICAgICAgICBjb25zdCByYWNlUmVzdWx0ID0gYmFja2dyb3VuZFByb21pc2VcbiAgICAgICAgICAgICAgICA/IGF3YWl0IFByb21pc2UucmFjZShbXG4gICAgICAgICAgICAgICAgICAgIG5leHRNZXNzYWdlUHJvbWlzZS50aGVuKHIgPT4gKHtcbiAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnbWVzc2FnZScgYXMgY29uc3QsXG4gICAgICAgICAgICAgICAgICAgICAgcmVzdWx0OiByLFxuICAgICAgICAgICAgICAgICAgICB9KSksXG4gICAgICAgICAgICAgICAgICAgIGJhY2tncm91bmRQcm9taXNlLFxuICAgICAgICAgICAgICAgICAgXSlcbiAgICAgICAgICAgICAgICA6IHtcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogJ21lc3NhZ2UnIGFzIGNvbnN0LFxuICAgICAgICAgICAgICAgICAgICByZXN1bHQ6IGF3YWl0IG5leHRNZXNzYWdlUHJvbWlzZSxcbiAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAvLyBDaGVjayBpZiB3ZSB3ZXJlIGJhY2tncm91bmRlZCB2aWEgYmFja2dyb3VuZEFsbCgpXG4gICAgICAgICAgICAgIC8vIGZvcmVncm91bmRUYXNrSWQgaXMgZ3VhcmFudGVlZCB0byBiZSBkZWZpbmVkIGlmIHJhY2VSZXN1bHQudHlwZSBpcyAnYmFja2dyb3VuZCdcbiAgICAgICAgICAgICAgLy8gYmVjYXVzZSBiYWNrZ3JvdW5kUHJvbWlzZSBpcyBvbmx5IGRlZmluZWQgd2hlbiBmb3JlZ3JvdW5kVGFza0lkIGlzIGRlZmluZWRcbiAgICAgICAgICAgICAgaWYgKHJhY2VSZXN1bHQudHlwZSA9PT0gJ2JhY2tncm91bmQnICYmIGZvcmVncm91bmRUYXNrSWQpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBhcHBTdGF0ZSA9IHRvb2xVc2VDb250ZXh0LmdldEFwcFN0YXRlKClcbiAgICAgICAgICAgICAgICBjb25zdCB0YXNrID0gYXBwU3RhdGUudGFza3NbZm9yZWdyb3VuZFRhc2tJZF1cbiAgICAgICAgICAgICAgICBpZiAoaXNMb2NhbEFnZW50VGFzayh0YXNrKSAmJiB0YXNrLmlzQmFja2dyb3VuZGVkKSB7XG4gICAgICAgICAgICAgICAgICAvLyBDYXB0dXJlIHRoZSB0YXNrSWQgZm9yIHVzZSBpbiB0aGUgYXN5bmMgY2FsbGJhY2tcbiAgICAgICAgICAgICAgICAgIGNvbnN0IGJhY2tncm91bmRlZFRhc2tJZCA9IGZvcmVncm91bmRUYXNrSWRcbiAgICAgICAgICAgICAgICAgIHdhc0JhY2tncm91bmRlZCA9IHRydWVcbiAgICAgICAgICAgICAgICAgIC8vIFN0b3AgZm9yZWdyb3VuZCBzdW1tYXJpemF0aW9uOyB0aGUgYmFja2dyb3VuZGVkIGNsb3N1cmVcbiAgICAgICAgICAgICAgICAgIC8vIGJlbG93IG93bnMgaXRzIG93biBpbmRlcGVuZGVudCBzdG9wIGZ1bmN0aW9uLlxuICAgICAgICAgICAgICAgICAgc3RvcEZvcmVncm91bmRTdW1tYXJpemF0aW9uPy4oKVxuXG4gICAgICAgICAgICAgICAgICAvLyBXb3JrbG9hZDogaW5oZXJpdGVkIHZpYSBBTFMgYXQgYHZvaWRgIGludm9jYXRpb24gdGltZSxcbiAgICAgICAgICAgICAgICAgIC8vIHNhbWUgYXMgdGhlIGFzeW5jLWZyb20tc3RhcnQgcGF0aCBhYm92ZS5cbiAgICAgICAgICAgICAgICAgIC8vIENvbnRpbnVlIGFnZW50IGluIGJhY2tncm91bmQgYW5kIHJldHVybiBhc3luYyByZXN1bHRcbiAgICAgICAgICAgICAgICAgIHZvaWQgcnVuV2l0aEFnZW50Q29udGV4dChzeW5jQWdlbnRDb250ZXh0LCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGxldCBzdG9wQmFja2dyb3VuZGVkU3VtbWFyaXphdGlvbjogKCgpID0+IHZvaWQpIHwgdW5kZWZpbmVkXG4gICAgICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgICAgLy8gQ2xlYW4gdXAgdGhlIGZvcmVncm91bmQgaXRlcmF0b3Igc28gaXRzIGZpbmFsbHkgYmxvY2sgcnVuc1xuICAgICAgICAgICAgICAgICAgICAgIC8vIChyZWxlYXNlcyBNQ1AgY29ubmVjdGlvbnMsIHNlc3Npb24gaG9va3MsIHByb21wdCBjYWNoZSB0cmFja2luZywgZXRjLilcbiAgICAgICAgICAgICAgICAgICAgICAvLyBUaW1lb3V0IHByZXZlbnRzIGJsb2NraW5nIGlmIE1DUCBzZXJ2ZXIgY2xlYW51cCBoYW5ncy5cbiAgICAgICAgICAgICAgICAgICAgICAvLyAuY2F0Y2goKSBwcmV2ZW50cyB1bmhhbmRsZWQgcmVqZWN0aW9uIGlmIHRpbWVvdXQgd2lucyB0aGUgcmFjZS5cbiAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBQcm9taXNlLnJhY2UoW1xuICAgICAgICAgICAgICAgICAgICAgICAgYWdlbnRJdGVyYXRvci5yZXR1cm4odW5kZWZpbmVkKS5jYXRjaCgoKSA9PiB7fSksXG4gICAgICAgICAgICAgICAgICAgICAgICBzbGVlcCgxMDAwKSxcbiAgICAgICAgICAgICAgICAgICAgICBdKVxuICAgICAgICAgICAgICAgICAgICAgIC8vIEluaXRpYWxpemUgcHJvZ3Jlc3MgdHJhY2tpbmcgZnJvbSBleGlzdGluZyBtZXNzYWdlc1xuICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHRyYWNrZXIgPSBjcmVhdGVQcm9ncmVzc1RyYWNrZXIoKVxuICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHJlc29sdmVBY3Rpdml0eTIgPVxuICAgICAgICAgICAgICAgICAgICAgICAgY3JlYXRlQWN0aXZpdHlEZXNjcmlwdGlvblJlc29sdmVyKFxuICAgICAgICAgICAgICAgICAgICAgICAgICB0b29sVXNlQ29udGV4dC5vcHRpb25zLnRvb2xzLFxuICAgICAgICAgICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgICAgICAgIGZvciAoY29uc3QgZXhpc3RpbmdNc2cgb2YgYWdlbnRNZXNzYWdlcykge1xuICAgICAgICAgICAgICAgICAgICAgICAgdXBkYXRlUHJvZ3Jlc3NGcm9tTWVzc2FnZShcbiAgICAgICAgICAgICAgICAgICAgICAgICAgdHJhY2tlcixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgZXhpc3RpbmdNc2csXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHJlc29sdmVBY3Rpdml0eTIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHRvb2xVc2VDb250ZXh0Lm9wdGlvbnMudG9vbHMsXG4gICAgICAgICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIGZvciBhd2FpdCAoY29uc3QgbXNnIG9mIHJ1bkFnZW50KHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC4uLnJ1bkFnZW50UGFyYW1zLFxuICAgICAgICAgICAgICAgICAgICAgICAgaXNBc3luYzogdHJ1ZSwgLy8gQWdlbnQgaXMgbm93IHJ1bm5pbmcgaW4gYmFja2dyb3VuZFxuICAgICAgICAgICAgICAgICAgICAgICAgb3ZlcnJpZGU6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgLi4ucnVuQWdlbnRQYXJhbXMub3ZlcnJpZGUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGFnZW50SWQ6IGFzQWdlbnRJZChiYWNrZ3JvdW5kZWRUYXNrSWQpLFxuICAgICAgICAgICAgICAgICAgICAgICAgICBhYm9ydENvbnRyb2xsZXI6IHRhc2suYWJvcnRDb250cm9sbGVyLFxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIG9uQ2FjaGVTYWZlUGFyYW1zOiBnZXRTZGtBZ2VudFByb2dyZXNzU3VtbWFyaWVzRW5hYmxlZCgpXG4gICAgICAgICAgICAgICAgICAgICAgICAgID8gKHBhcmFtczogQ2FjaGVTYWZlUGFyYW1zKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB7IHN0b3AgfSA9IHN0YXJ0QWdlbnRTdW1tYXJpemF0aW9uKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBiYWNrZ3JvdW5kZWRUYXNrSWQsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFzQWdlbnRJZChiYWNrZ3JvdW5kZWRUYXNrSWQpLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYXJhbXMsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJvb3RTZXRBcHBTdGF0ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN0b3BCYWNrZ3JvdW5kZWRTdW1tYXJpemF0aW9uID0gc3RvcFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgOiB1bmRlZmluZWQsXG4gICAgICAgICAgICAgICAgICAgICAgfSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGFnZW50TWVzc2FnZXMucHVzaChtc2cpXG5cbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIFRyYWNrIHByb2dyZXNzIGZvciBiYWNrZ3JvdW5kZWQgYWdlbnRzXG4gICAgICAgICAgICAgICAgICAgICAgICB1cGRhdGVQcm9ncmVzc0Zyb21NZXNzYWdlKFxuICAgICAgICAgICAgICAgICAgICAgICAgICB0cmFja2VyLFxuICAgICAgICAgICAgICAgICAgICAgICAgICBtc2csXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHJlc29sdmVBY3Rpdml0eTIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHRvb2xVc2VDb250ZXh0Lm9wdGlvbnMudG9vbHMsXG4gICAgICAgICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgICAgICAgICB1cGRhdGVBc3luY0FnZW50UHJvZ3Jlc3MoXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGJhY2tncm91bmRlZFRhc2tJZCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgZ2V0UHJvZ3Jlc3NVcGRhdGUodHJhY2tlciksXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHJvb3RTZXRBcHBTdGF0ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIClcblxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbGFzdFRvb2xOYW1lID0gZ2V0TGFzdFRvb2xVc2VOYW1lKG1zZylcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChsYXN0VG9vbE5hbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgZW1pdFRhc2tQcm9ncmVzcyhcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0cmFja2VyLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJhY2tncm91bmRlZFRhc2tJZCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0b29sVXNlQ29udGV4dC50b29sVXNlSWQsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb24sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc3RhcnRUaW1lLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxhc3RUb29sTmFtZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICBjb25zdCBhZ2VudFJlc3VsdCA9IGZpbmFsaXplQWdlbnRUb29sKFxuICAgICAgICAgICAgICAgICAgICAgICAgYWdlbnRNZXNzYWdlcyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGJhY2tncm91bmRlZFRhc2tJZCxcbiAgICAgICAgICAgICAgICAgICAgICAgIG1ldGFkYXRhLFxuICAgICAgICAgICAgICAgICAgICAgIClcblxuICAgICAgICAgICAgICAgICAgICAgIC8vIE1hcmsgdGFzayBjb21wbGV0ZWQgRklSU1Qgc28gVGFza091dHB1dChibG9jaz10cnVlKVxuICAgICAgICAgICAgICAgICAgICAgIC8vIHVuYmxvY2tzIGltbWVkaWF0ZWx5LiBjbGFzc2lmeUhhbmRvZmZJZk5lZWRlZCBhbmRcbiAgICAgICAgICAgICAgICAgICAgICAvLyBjbGVhbnVwV29ya3RyZWVJZk5lZWRlZCBjYW4gaGFuZyDigJQgdGhleSBtdXN0IG5vdCBnYXRlXG4gICAgICAgICAgICAgICAgICAgICAgLy8gdGhlIHN0YXR1cyB0cmFuc2l0aW9uIChnaC0yMDIzNikuXG4gICAgICAgICAgICAgICAgICAgICAgY29tcGxldGVBc3luY0FnZW50KGFnZW50UmVzdWx0LCByb290U2V0QXBwU3RhdGUpXG5cbiAgICAgICAgICAgICAgICAgICAgICAvLyBFeHRyYWN0IHRleHQgZnJvbSBhZ2VudCByZXN1bHQgY29udGVudCBmb3IgdGhlIG5vdGlmaWNhdGlvblxuICAgICAgICAgICAgICAgICAgICAgIGxldCBmaW5hbE1lc3NhZ2UgPSBleHRyYWN0VGV4dENvbnRlbnQoXG4gICAgICAgICAgICAgICAgICAgICAgICBhZ2VudFJlc3VsdC5jb250ZW50LFxuICAgICAgICAgICAgICAgICAgICAgICAgJ1xcbicsXG4gICAgICAgICAgICAgICAgICAgICAgKVxuXG4gICAgICAgICAgICAgICAgICAgICAgaWYgKGZlYXR1cmUoJ1RSQU5TQ1JJUFRfQ0xBU1NJRklFUicpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBiYWNrZ3JvdW5kZWRBcHBTdGF0ZSA9XG4gICAgICAgICAgICAgICAgICAgICAgICAgIHRvb2xVc2VDb250ZXh0LmdldEFwcFN0YXRlKClcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGhhbmRvZmZXYXJuaW5nID0gYXdhaXQgY2xhc3NpZnlIYW5kb2ZmSWZOZWVkZWQoe1xuICAgICAgICAgICAgICAgICAgICAgICAgICBhZ2VudE1lc3NhZ2VzLFxuICAgICAgICAgICAgICAgICAgICAgICAgICB0b29sczogdG9vbFVzZUNvbnRleHQub3B0aW9ucy50b29scyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgdG9vbFBlcm1pc3Npb25Db250ZXh0OlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJhY2tncm91bmRlZEFwcFN0YXRlLnRvb2xQZXJtaXNzaW9uQ29udGV4dCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgYWJvcnRTaWduYWw6IHRhc2suYWJvcnRDb250cm9sbGVyIS5zaWduYWwsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHN1YmFnZW50VHlwZTogc2VsZWN0ZWRBZ2VudC5hZ2VudFR5cGUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHRvdGFsVG9vbFVzZUNvdW50OiBhZ2VudFJlc3VsdC50b3RhbFRvb2xVc2VDb3VudCxcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoaGFuZG9mZldhcm5pbmcpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgZmluYWxNZXNzYWdlID0gYCR7aGFuZG9mZldhcm5pbmd9XFxuXFxuJHtmaW5hbE1lc3NhZ2V9YFxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICAgIC8vIENsZWFuIHVwIHdvcmt0cmVlIGJlZm9yZSBub3RpZmljYXRpb24gc28gd2UgY2FuIGluY2x1ZGUgaXRcbiAgICAgICAgICAgICAgICAgICAgICBjb25zdCB3b3JrdHJlZVJlc3VsdCA9IGF3YWl0IGNsZWFudXBXb3JrdHJlZUlmTmVlZGVkKClcblxuICAgICAgICAgICAgICAgICAgICAgIGVucXVldWVBZ2VudE5vdGlmaWNhdGlvbih7XG4gICAgICAgICAgICAgICAgICAgICAgICB0YXNrSWQ6IGJhY2tncm91bmRlZFRhc2tJZCxcbiAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uLFxuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzOiAnY29tcGxldGVkJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHNldEFwcFN0YXRlOiByb290U2V0QXBwU3RhdGUsXG4gICAgICAgICAgICAgICAgICAgICAgICBmaW5hbE1lc3NhZ2UsXG4gICAgICAgICAgICAgICAgICAgICAgICB1c2FnZToge1xuICAgICAgICAgICAgICAgICAgICAgICAgICB0b3RhbFRva2VuczogZ2V0VG9rZW5Db3VudEZyb21UcmFja2VyKHRyYWNrZXIpLFxuICAgICAgICAgICAgICAgICAgICAgICAgICB0b29sVXNlczogYWdlbnRSZXN1bHQudG90YWxUb29sVXNlQ291bnQsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGR1cmF0aW9uTXM6IGFnZW50UmVzdWx0LnRvdGFsRHVyYXRpb25NcyxcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICB0b29sVXNlSWQ6IHRvb2xVc2VDb250ZXh0LnRvb2xVc2VJZCxcbiAgICAgICAgICAgICAgICAgICAgICAgIC4uLndvcmt0cmVlUmVzdWx0LFxuICAgICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgQWJvcnRFcnJvcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gVHJhbnNpdGlvbiBzdGF0dXMgQkVGT1JFIHdvcmt0cmVlIGNsZWFudXAgc29cbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIFRhc2tPdXRwdXQgdW5ibG9ja3MgZXZlbiBpZiBnaXQgaGFuZ3MgKGdoLTIwMjM2KS5cbiAgICAgICAgICAgICAgICAgICAgICAgIGtpbGxBc3luY0FnZW50KGJhY2tncm91bmRlZFRhc2tJZCwgcm9vdFNldEFwcFN0YXRlKVxuICAgICAgICAgICAgICAgICAgICAgICAgbG9nRXZlbnQoJ3Rlbmd1X2FnZW50X3Rvb2xfdGVybWluYXRlZCcsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgYWdlbnRfdHlwZTpcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtZXRhZGF0YS5hZ2VudFR5cGUgYXMgQW5hbHl0aWNzTWV0YWRhdGFfSV9WRVJJRklFRF9USElTX0lTX05PVF9DT0RFX09SX0ZJTEVQQVRIUyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kZWw6XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbWV0YWRhdGEucmVzb2x2ZWRBZ2VudE1vZGVsIGFzIEFuYWx5dGljc01ldGFkYXRhX0lfVkVSSUZJRURfVEhJU19JU19OT1RfQ09ERV9PUl9GSUxFUEFUSFMsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGR1cmF0aW9uX21zOiBEYXRlLm5vdygpIC0gbWV0YWRhdGEuc3RhcnRUaW1lLFxuICAgICAgICAgICAgICAgICAgICAgICAgICBpc19hc3luYzogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgaXNfYnVpbHRfaW5fYWdlbnQ6IG1ldGFkYXRhLmlzQnVpbHRJbkFnZW50LFxuICAgICAgICAgICAgICAgICAgICAgICAgICByZWFzb246XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ3VzZXJfY2FuY2VsX2JhY2tncm91bmQnIGFzIEFuYWx5dGljc01ldGFkYXRhX0lfVkVSSUZJRURfVEhJU19JU19OT1RfQ09ERV9PUl9GSUxFUEFUSFMsXG4gICAgICAgICAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgd29ya3RyZWVSZXN1bHQgPSBhd2FpdCBjbGVhbnVwV29ya3RyZWVJZk5lZWRlZCgpXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwYXJ0aWFsUmVzdWx0ID1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgZXh0cmFjdFBhcnRpYWxSZXN1bHQoYWdlbnRNZXNzYWdlcylcbiAgICAgICAgICAgICAgICAgICAgICAgIGVucXVldWVBZ2VudE5vdGlmaWNhdGlvbih7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIHRhc2tJZDogYmFja2dyb3VuZGVkVGFza0lkLFxuICAgICAgICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzOiAna2lsbGVkJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgc2V0QXBwU3RhdGU6IHJvb3RTZXRBcHBTdGF0ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgdG9vbFVzZUlkOiB0b29sVXNlQ29udGV4dC50b29sVXNlSWQsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGZpbmFsTWVzc2FnZTogcGFydGlhbFJlc3VsdCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgLi4ud29ya3RyZWVSZXN1bHQsXG4gICAgICAgICAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuXG4gICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGVyck1zZyA9IGVycm9yTWVzc2FnZShlcnJvcilcbiAgICAgICAgICAgICAgICAgICAgICBmYWlsQXN5bmNBZ2VudChcbiAgICAgICAgICAgICAgICAgICAgICAgIGJhY2tncm91bmRlZFRhc2tJZCxcbiAgICAgICAgICAgICAgICAgICAgICAgIGVyck1zZyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHJvb3RTZXRBcHBTdGF0ZSxcbiAgICAgICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgICAgICAgY29uc3Qgd29ya3RyZWVSZXN1bHQgPSBhd2FpdCBjbGVhbnVwV29ya3RyZWVJZk5lZWRlZCgpXG4gICAgICAgICAgICAgICAgICAgICAgZW5xdWV1ZUFnZW50Tm90aWZpY2F0aW9uKHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRhc2tJZDogYmFja2dyb3VuZGVkVGFza0lkLFxuICAgICAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb24sXG4gICAgICAgICAgICAgICAgICAgICAgICBzdGF0dXM6ICdmYWlsZWQnLFxuICAgICAgICAgICAgICAgICAgICAgICAgZXJyb3I6IGVyck1zZyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHNldEFwcFN0YXRlOiByb290U2V0QXBwU3RhdGUsXG4gICAgICAgICAgICAgICAgICAgICAgICB0b29sVXNlSWQ6IHRvb2xVc2VDb250ZXh0LnRvb2xVc2VJZCxcbiAgICAgICAgICAgICAgICAgICAgICAgIC4uLndvcmt0cmVlUmVzdWx0LFxuICAgICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgICAgICAgICAgICAgc3RvcEJhY2tncm91bmRlZFN1bW1hcml6YXRpb24/LigpXG4gICAgICAgICAgICAgICAgICAgICAgY2xlYXJJbnZva2VkU2tpbGxzRm9yQWdlbnQoc3luY0FnZW50SWQpXG4gICAgICAgICAgICAgICAgICAgICAgY2xlYXJEdW1wU3RhdGUoc3luY0FnZW50SWQpXG4gICAgICAgICAgICAgICAgICAgICAgLy8gTm90ZTogd29ya3RyZWUgY2xlYW51cCBpcyBkb25lIGJlZm9yZSBlbnF1ZXVlQWdlbnROb3RpZmljYXRpb25cbiAgICAgICAgICAgICAgICAgICAgICAvLyBpbiBib3RoIHRyeSBhbmQgY2F0Y2ggcGF0aHMgc28gd2UgY2FuIGluY2x1ZGUgd29ya3RyZWUgaW5mb1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICB9KVxuXG4gICAgICAgICAgICAgICAgICAvLyBSZXR1cm4gYXN5bmNfbGF1bmNoZWQgcmVzdWx0IGltbWVkaWF0ZWx5XG4gICAgICAgICAgICAgICAgICBjb25zdCBjYW5SZWFkT3V0cHV0RmlsZSA9IHRvb2xVc2VDb250ZXh0Lm9wdGlvbnMudG9vbHMuc29tZShcbiAgICAgICAgICAgICAgICAgICAgdCA9PlxuICAgICAgICAgICAgICAgICAgICAgIHRvb2xNYXRjaGVzTmFtZSh0LCBGSUxFX1JFQURfVE9PTF9OQU1FKSB8fFxuICAgICAgICAgICAgICAgICAgICAgIHRvb2xNYXRjaGVzTmFtZSh0LCBCQVNIX1RPT0xfTkFNRSksXG4gICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICAgICAgICAgICAgaXNBc3luYzogdHJ1ZSBhcyBjb25zdCxcbiAgICAgICAgICAgICAgICAgICAgICBzdGF0dXM6ICdhc3luY19sYXVuY2hlZCcgYXMgY29uc3QsXG4gICAgICAgICAgICAgICAgICAgICAgYWdlbnRJZDogYmFja2dyb3VuZGVkVGFza0lkLFxuICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiBkZXNjcmlwdGlvbixcbiAgICAgICAgICAgICAgICAgICAgICBwcm9tcHQ6IHByb21wdCxcbiAgICAgICAgICAgICAgICAgICAgICBvdXRwdXRGaWxlOiBnZXRUYXNrT3V0cHV0UGF0aChiYWNrZ3JvdW5kZWRUYXNrSWQpLFxuICAgICAgICAgICAgICAgICAgICAgIGNhblJlYWRPdXRwdXRGaWxlLFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgIC8vIFByb2Nlc3MgdGhlIG1lc3NhZ2UgZnJvbSB0aGUgcmFjZSByZXN1bHRcbiAgICAgICAgICAgICAgaWYgKHJhY2VSZXN1bHQudHlwZSAhPT0gJ21lc3NhZ2UnKSB7XG4gICAgICAgICAgICAgICAgLy8gVGhpcyBzaG91bGRuJ3QgaGFwcGVuIC0gYmFja2dyb3VuZCBjYXNlIGhhbmRsZWQgYWJvdmVcbiAgICAgICAgICAgICAgICBjb250aW51ZVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIGNvbnN0IHsgcmVzdWx0IH0gPSByYWNlUmVzdWx0XG4gICAgICAgICAgICAgIGlmIChyZXN1bHQuZG9uZSkgYnJlYWtcbiAgICAgICAgICAgICAgY29uc3QgbWVzc2FnZSA9IHJlc3VsdC52YWx1ZVxuXG4gICAgICAgICAgICAgIGFnZW50TWVzc2FnZXMucHVzaChtZXNzYWdlKVxuXG4gICAgICAgICAgICAgIC8vIEVtaXQgdGFza19wcm9ncmVzcyBmb3IgdGhlIFZTIENvZGUgc3ViYWdlbnQgcGFuZWxcbiAgICAgICAgICAgICAgdXBkYXRlUHJvZ3Jlc3NGcm9tTWVzc2FnZShcbiAgICAgICAgICAgICAgICBzeW5jVHJhY2tlcixcbiAgICAgICAgICAgICAgICBtZXNzYWdlLFxuICAgICAgICAgICAgICAgIHN5bmNSZXNvbHZlQWN0aXZpdHksXG4gICAgICAgICAgICAgICAgdG9vbFVzZUNvbnRleHQub3B0aW9ucy50b29scyxcbiAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICBpZiAoZm9yZWdyb3VuZFRhc2tJZCkge1xuICAgICAgICAgICAgICAgIGNvbnN0IGxhc3RUb29sTmFtZSA9IGdldExhc3RUb29sVXNlTmFtZShtZXNzYWdlKVxuICAgICAgICAgICAgICAgIGlmIChsYXN0VG9vbE5hbWUpIHtcbiAgICAgICAgICAgICAgICAgIGVtaXRUYXNrUHJvZ3Jlc3MoXG4gICAgICAgICAgICAgICAgICAgIHN5bmNUcmFja2VyLFxuICAgICAgICAgICAgICAgICAgICBmb3JlZ3JvdW5kVGFza0lkLFxuICAgICAgICAgICAgICAgICAgICB0b29sVXNlQ29udGV4dC50b29sVXNlSWQsXG4gICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uLFxuICAgICAgICAgICAgICAgICAgICBhZ2VudFN0YXJ0VGltZSxcbiAgICAgICAgICAgICAgICAgICAgbGFzdFRvb2xOYW1lLFxuICAgICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgICAgLy8gS2VlcCBBcHBTdGF0ZSB0YXNrLnByb2dyZXNzIGluIHN5bmMgd2hlbiBTREsgc3VtbWFyaWVzIGFyZVxuICAgICAgICAgICAgICAgICAgLy8gZW5hYmxlZCwgc28gdXBkYXRlQWdlbnRTdW1tYXJ5IHJlYWRzIGNvcnJlY3QgdG9rZW4vdG9vbCBjb3VudHNcbiAgICAgICAgICAgICAgICAgIC8vIGluc3RlYWQgb2YgemVyb3MuXG4gICAgICAgICAgICAgICAgICBpZiAoZ2V0U2RrQWdlbnRQcm9ncmVzc1N1bW1hcmllc0VuYWJsZWQoKSkge1xuICAgICAgICAgICAgICAgICAgICB1cGRhdGVBc3luY0FnZW50UHJvZ3Jlc3MoXG4gICAgICAgICAgICAgICAgICAgICAgZm9yZWdyb3VuZFRhc2tJZCxcbiAgICAgICAgICAgICAgICAgICAgICBnZXRQcm9ncmVzc1VwZGF0ZShzeW5jVHJhY2tlciksXG4gICAgICAgICAgICAgICAgICAgICAgcm9vdFNldEFwcFN0YXRlLFxuICAgICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgLy8gRm9yd2FyZCBiYXNoX3Byb2dyZXNzIGV2ZW50cyBmcm9tIHN1Yi1hZ2VudCB0byBwYXJlbnQgc28gdGhlIFNES1xuICAgICAgICAgICAgICAvLyByZWNlaXZlcyB0b29sX3Byb2dyZXNzIGV2ZW50cyBqdXN0IGFzIGl0IGRvZXMgZm9yIHRoZSBtYWluIGFnZW50LlxuICAgICAgICAgICAgICBpZiAoXG4gICAgICAgICAgICAgICAgbWVzc2FnZS50eXBlID09PSAncHJvZ3Jlc3MnICYmXG4gICAgICAgICAgICAgICAgKG1lc3NhZ2UuZGF0YS50eXBlID09PSAnYmFzaF9wcm9ncmVzcycgfHxcbiAgICAgICAgICAgICAgICAgIG1lc3NhZ2UuZGF0YS50eXBlID09PSAncG93ZXJzaGVsbF9wcm9ncmVzcycpICYmXG4gICAgICAgICAgICAgICAgb25Qcm9ncmVzc1xuICAgICAgICAgICAgICApIHtcbiAgICAgICAgICAgICAgICBvblByb2dyZXNzKHtcbiAgICAgICAgICAgICAgICAgIHRvb2xVc2VJRDogbWVzc2FnZS50b29sVXNlSUQsXG4gICAgICAgICAgICAgICAgICBkYXRhOiBtZXNzYWdlLmRhdGEsXG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgIGlmIChtZXNzYWdlLnR5cGUgIT09ICdhc3Npc3RhbnQnICYmIG1lc3NhZ2UudHlwZSAhPT0gJ3VzZXInKSB7XG4gICAgICAgICAgICAgICAgY29udGludWVcbiAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgIC8vIEluY3JlbWVudCB0b2tlbiBjb3VudCBpbiBzcGlubmVyIGZvciBhc3Npc3RhbnQgbWVzc2FnZXNcbiAgICAgICAgICAgICAgLy8gU3ViYWdlbnQgc3RyZWFtaW5nIGV2ZW50cyBhcmUgZmlsdGVyZWQgb3V0IGluIHJ1bkFnZW50LnRzLCBzbyB3ZVxuICAgICAgICAgICAgICAvLyBuZWVkIHRvIGNvdW50IHRva2VucyBmcm9tIGNvbXBsZXRlZCBtZXNzYWdlcyBoZXJlXG4gICAgICAgICAgICAgIGlmIChtZXNzYWdlLnR5cGUgPT09ICdhc3Npc3RhbnQnKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgY29udGVudExlbmd0aCA9IGdldEFzc2lzdGFudE1lc3NhZ2VDb250ZW50TGVuZ3RoKG1lc3NhZ2UpXG4gICAgICAgICAgICAgICAgaWYgKGNvbnRlbnRMZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgICB0b29sVXNlQ29udGV4dC5zZXRSZXNwb25zZUxlbmd0aChsZW4gPT4gbGVuICsgY29udGVudExlbmd0aClcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICBjb25zdCBub3JtYWxpemVkTmV3ID0gbm9ybWFsaXplTWVzc2FnZXMoW21lc3NhZ2VdKVxuICAgICAgICAgICAgICBmb3IgKGNvbnN0IG0gb2Ygbm9ybWFsaXplZE5ldykge1xuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgY29udGVudCBvZiBtLm1lc3NhZ2UuY29udGVudCkge1xuICAgICAgICAgICAgICAgICAgaWYgKFxuICAgICAgICAgICAgICAgICAgICBjb250ZW50LnR5cGUgIT09ICd0b29sX3VzZScgJiZcbiAgICAgICAgICAgICAgICAgICAgY29udGVudC50eXBlICE9PSAndG9vbF9yZXN1bHQnXG4gICAgICAgICAgICAgICAgICApIHtcbiAgICAgICAgICAgICAgICAgICAgY29udGludWVcbiAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgLy8gRm9yd2FyZCBwcm9ncmVzcyB1cGRhdGVzXG4gICAgICAgICAgICAgICAgICBpZiAob25Qcm9ncmVzcykge1xuICAgICAgICAgICAgICAgICAgICBvblByb2dyZXNzKHtcbiAgICAgICAgICAgICAgICAgICAgICB0b29sVXNlSUQ6IGBhZ2VudF8ke2Fzc2lzdGFudE1lc3NhZ2UubWVzc2FnZS5pZH1gLFxuICAgICAgICAgICAgICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6IG0sXG4gICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnYWdlbnRfcHJvZ3Jlc3MnLFxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gcHJvbXB0IG9ubHkgbmVlZGVkIG9uIGZpcnN0IHByb2dyZXNzIG1lc3NhZ2UgKFVJLnRzeDo2MjRcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIHJlYWRzIHByb2dyZXNzTWVzc2FnZXNbMF0pLiBPbWl0IGhlcmUgdG8gYXZvaWQgZHVwbGljYXRpb24uXG4gICAgICAgICAgICAgICAgICAgICAgICBwcm9tcHQ6ICcnLFxuICAgICAgICAgICAgICAgICAgICAgICAgYWdlbnRJZDogc3luY0FnZW50SWQsXG4gICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgLy8gSGFuZGxlIGVycm9ycyBmcm9tIHRoZSBzeW5jIGFnZW50IGxvb3BcbiAgICAgICAgICAgIC8vIEFib3J0RXJyb3Igc2hvdWxkIGJlIHJlLXRocm93biBmb3IgcHJvcGVyIGludGVycnVwdGlvbiBoYW5kbGluZ1xuICAgICAgICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgQWJvcnRFcnJvcikge1xuICAgICAgICAgICAgICB3YXNBYm9ydGVkID0gdHJ1ZVxuICAgICAgICAgICAgICBsb2dFdmVudCgndGVuZ3VfYWdlbnRfdG9vbF90ZXJtaW5hdGVkJywge1xuICAgICAgICAgICAgICAgIGFnZW50X3R5cGU6XG4gICAgICAgICAgICAgICAgICBtZXRhZGF0YS5hZ2VudFR5cGUgYXMgQW5hbHl0aWNzTWV0YWRhdGFfSV9WRVJJRklFRF9USElTX0lTX05PVF9DT0RFX09SX0ZJTEVQQVRIUyxcbiAgICAgICAgICAgICAgICBtb2RlbDpcbiAgICAgICAgICAgICAgICAgIG1ldGFkYXRhLnJlc29sdmVkQWdlbnRNb2RlbCBhcyBBbmFseXRpY3NNZXRhZGF0YV9JX1ZFUklGSUVEX1RISVNfSVNfTk9UX0NPREVfT1JfRklMRVBBVEhTLFxuICAgICAgICAgICAgICAgIGR1cmF0aW9uX21zOiBEYXRlLm5vdygpIC0gbWV0YWRhdGEuc3RhcnRUaW1lLFxuICAgICAgICAgICAgICAgIGlzX2FzeW5jOiBmYWxzZSxcbiAgICAgICAgICAgICAgICBpc19idWlsdF9pbl9hZ2VudDogbWV0YWRhdGEuaXNCdWlsdEluQWdlbnQsXG4gICAgICAgICAgICAgICAgcmVhc29uOlxuICAgICAgICAgICAgICAgICAgJ3VzZXJfY2FuY2VsX3N5bmMnIGFzIEFuYWx5dGljc01ldGFkYXRhX0lfVkVSSUZJRURfVEhJU19JU19OT1RfQ09ERV9PUl9GSUxFUEFUSFMsXG4gICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgIHRocm93IGVycm9yXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIExvZyB0aGUgZXJyb3IgZm9yIGRlYnVnZ2luZ1xuICAgICAgICAgICAgbG9nRm9yRGVidWdnaW5nKGBTeW5jIGFnZW50IGVycm9yOiAke2Vycm9yTWVzc2FnZShlcnJvcil9YCwge1xuICAgICAgICAgICAgICBsZXZlbDogJ2Vycm9yJyxcbiAgICAgICAgICAgIH0pXG5cbiAgICAgICAgICAgIC8vIFN0b3JlIHRoZSBlcnJvciB0byBoYW5kbGUgYWZ0ZXIgY2xlYW51cFxuICAgICAgICAgICAgc3luY0FnZW50RXJyb3IgPSB0b0Vycm9yKGVycm9yKVxuICAgICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgICAvLyBDbGVhciB0aGUgYmFja2dyb3VuZCBoaW50IFVJXG4gICAgICAgICAgICBpZiAodG9vbFVzZUNvbnRleHQuc2V0VG9vbEpTWCkge1xuICAgICAgICAgICAgICB0b29sVXNlQ29udGV4dC5zZXRUb29sSlNYKG51bGwpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIFN0b3AgZm9yZWdyb3VuZCBzdW1tYXJpemF0aW9uLiBJZGVtcG90ZW50IOKAlCBpZiBhbHJlYWR5IHN0b3BwZWQgYXRcbiAgICAgICAgICAgIC8vIHRoZSBiYWNrZ3JvdW5kaW5nIHRyYW5zaXRpb24sIHRoaXMgaXMgYSBuby1vcC4gVGhlIGJhY2tncm91bmRlZFxuICAgICAgICAgICAgLy8gY2xvc3VyZSBvd25zIGEgc2VwYXJhdGUgc3RvcCBmdW5jdGlvbiAoc3RvcEJhY2tncm91bmRlZFN1bW1hcml6YXRpb24pLlxuICAgICAgICAgICAgc3RvcEZvcmVncm91bmRTdW1tYXJpemF0aW9uPy4oKVxuXG4gICAgICAgICAgICAvLyBVbnJlZ2lzdGVyIGZvcmVncm91bmQgdGFzayBpZiBhZ2VudCBjb21wbGV0ZWQgd2l0aG91dCBiZWluZyBiYWNrZ3JvdW5kZWRcbiAgICAgICAgICAgIGlmIChmb3JlZ3JvdW5kVGFza0lkKSB7XG4gICAgICAgICAgICAgIHVucmVnaXN0ZXJBZ2VudEZvcmVncm91bmQoZm9yZWdyb3VuZFRhc2tJZCwgcm9vdFNldEFwcFN0YXRlKVxuICAgICAgICAgICAgICAvLyBOb3RpZnkgU0RLIGNvbnN1bWVycyAoZS5nLiBWUyBDb2RlIHN1YmFnZW50IHBhbmVsKSB0aGF0IHRoaXNcbiAgICAgICAgICAgICAgLy8gZm9yZWdyb3VuZCBhZ2VudCBpcyBkb25lLiBHb2VzIHRocm91Z2ggZHJhaW5TZGtFdmVudHMoKSDigJQgZG9lc1xuICAgICAgICAgICAgICAvLyBOT1QgdHJpZ2dlciB0aGUgcHJpbnQudHMgWE1MIHRhc2tfbm90aWZpY2F0aW9uIHBhcnNlciBvciB0aGUgTExNIGxvb3AuXG4gICAgICAgICAgICAgIGlmICghd2FzQmFja2dyb3VuZGVkKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgcHJvZ3Jlc3MgPSBnZXRQcm9ncmVzc1VwZGF0ZShzeW5jVHJhY2tlcilcbiAgICAgICAgICAgICAgICBlbnF1ZXVlU2RrRXZlbnQoe1xuICAgICAgICAgICAgICAgICAgdHlwZTogJ3N5c3RlbScsXG4gICAgICAgICAgICAgICAgICBzdWJ0eXBlOiAndGFza19ub3RpZmljYXRpb24nLFxuICAgICAgICAgICAgICAgICAgdGFza19pZDogZm9yZWdyb3VuZFRhc2tJZCxcbiAgICAgICAgICAgICAgICAgIHRvb2xfdXNlX2lkOiB0b29sVXNlQ29udGV4dC50b29sVXNlSWQsXG4gICAgICAgICAgICAgICAgICBzdGF0dXM6IHN5bmNBZ2VudEVycm9yXG4gICAgICAgICAgICAgICAgICAgID8gJ2ZhaWxlZCdcbiAgICAgICAgICAgICAgICAgICAgOiB3YXNBYm9ydGVkXG4gICAgICAgICAgICAgICAgICAgICAgPyAnc3RvcHBlZCdcbiAgICAgICAgICAgICAgICAgICAgICA6ICdjb21wbGV0ZWQnLFxuICAgICAgICAgICAgICAgICAgb3V0cHV0X2ZpbGU6ICcnLFxuICAgICAgICAgICAgICAgICAgc3VtbWFyeTogZGVzY3JpcHRpb24sXG4gICAgICAgICAgICAgICAgICB1c2FnZToge1xuICAgICAgICAgICAgICAgICAgICB0b3RhbF90b2tlbnM6IHByb2dyZXNzLnRva2VuQ291bnQsXG4gICAgICAgICAgICAgICAgICAgIHRvb2xfdXNlczogcHJvZ3Jlc3MudG9vbFVzZUNvdW50LFxuICAgICAgICAgICAgICAgICAgICBkdXJhdGlvbl9tczogRGF0ZS5ub3coKSAtIGFnZW50U3RhcnRUaW1lLFxuICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIENsZWFuIHVwIHNjb3BlZCBza2lsbHMgc28gdGhleSBkb24ndCBhY2N1bXVsYXRlIGluIHRoZSBnbG9iYWwgbWFwXG4gICAgICAgICAgICBjbGVhckludm9rZWRTa2lsbHNGb3JBZ2VudChzeW5jQWdlbnRJZClcblxuICAgICAgICAgICAgLy8gQ2xlYW4gdXAgZHVtcFN0YXRlIGVudHJ5IGZvciB0aGlzIGFnZW50IHRvIHByZXZlbnQgdW5ib3VuZGVkIGdyb3d0aFxuICAgICAgICAgICAgLy8gU2tpcCBpZiBiYWNrZ3JvdW5kZWQg4oCUIHRoZSBiYWNrZ3JvdW5kZWQgYWdlbnQncyBmaW5hbGx5IGhhbmRsZXMgY2xlYW51cFxuICAgICAgICAgICAgaWYgKCF3YXNCYWNrZ3JvdW5kZWQpIHtcbiAgICAgICAgICAgICAgY2xlYXJEdW1wU3RhdGUoc3luY0FnZW50SWQpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIENhbmNlbCBhdXRvLWJhY2tncm91bmQgdGltZXIgaWYgYWdlbnQgY29tcGxldGVkIGJlZm9yZSBpdCBmaXJlZFxuICAgICAgICAgICAgY2FuY2VsQXV0b0JhY2tncm91bmQ/LigpXG5cbiAgICAgICAgICAgIC8vIENsZWFuIHVwIHdvcmt0cmVlIGlmIGFwcGxpY2FibGUgKGluIGZpbmFsbHkgdG8gaGFuZGxlIGFib3J0L2Vycm9yIHBhdGhzKVxuICAgICAgICAgICAgLy8gU2tpcCBpZiBiYWNrZ3JvdW5kZWQg4oCUIHRoZSBiYWNrZ3JvdW5kIGNvbnRpbnVhdGlvbiBpcyBzdGlsbCBydW5uaW5nIGluIGl0XG4gICAgICAgICAgICBpZiAoIXdhc0JhY2tncm91bmRlZCkge1xuICAgICAgICAgICAgICB3b3JrdHJlZVJlc3VsdCA9IGF3YWl0IGNsZWFudXBXb3JrdHJlZUlmTmVlZGVkKClcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG5cbiAgICAgICAgICAvLyBSZS10aHJvdyBhYm9ydCBlcnJvcnNcbiAgICAgICAgICAvLyBUT0RPOiBGaW5kIGEgY2xlYW5lciB3YXkgdG8gZXhwcmVzcyB0aGlzXG4gICAgICAgICAgY29uc3QgbGFzdE1lc3NhZ2UgPSBhZ2VudE1lc3NhZ2VzLmZpbmRMYXN0KFxuICAgICAgICAgICAgXyA9PiBfLnR5cGUgIT09ICdzeXN0ZW0nICYmIF8udHlwZSAhPT0gJ3Byb2dyZXNzJyxcbiAgICAgICAgICApXG4gICAgICAgICAgaWYgKGxhc3RNZXNzYWdlICYmIGlzU3ludGhldGljTWVzc2FnZShsYXN0TWVzc2FnZSkpIHtcbiAgICAgICAgICAgIGxvZ0V2ZW50KCd0ZW5ndV9hZ2VudF90b29sX3Rlcm1pbmF0ZWQnLCB7XG4gICAgICAgICAgICAgIGFnZW50X3R5cGU6XG4gICAgICAgICAgICAgICAgbWV0YWRhdGEuYWdlbnRUeXBlIGFzIEFuYWx5dGljc01ldGFkYXRhX0lfVkVSSUZJRURfVEhJU19JU19OT1RfQ09ERV9PUl9GSUxFUEFUSFMsXG4gICAgICAgICAgICAgIG1vZGVsOlxuICAgICAgICAgICAgICAgIG1ldGFkYXRhLnJlc29sdmVkQWdlbnRNb2RlbCBhcyBBbmFseXRpY3NNZXRhZGF0YV9JX1ZFUklGSUVEX1RISVNfSVNfTk9UX0NPREVfT1JfRklMRVBBVEhTLFxuICAgICAgICAgICAgICBkdXJhdGlvbl9tczogRGF0ZS5ub3coKSAtIG1ldGFkYXRhLnN0YXJ0VGltZSxcbiAgICAgICAgICAgICAgaXNfYXN5bmM6IGZhbHNlLFxuICAgICAgICAgICAgICBpc19idWlsdF9pbl9hZ2VudDogbWV0YWRhdGEuaXNCdWlsdEluQWdlbnQsXG4gICAgICAgICAgICAgIHJlYXNvbjpcbiAgICAgICAgICAgICAgICAndXNlcl9jYW5jZWxfc3luYycgYXMgQW5hbHl0aWNzTWV0YWRhdGFfSV9WRVJJRklFRF9USElTX0lTX05PVF9DT0RFX09SX0ZJTEVQQVRIUyxcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICB0aHJvdyBuZXcgQWJvcnRFcnJvcigpXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgLy8gSWYgYW4gZXJyb3Igb2NjdXJyZWQgZHVyaW5nIGl0ZXJhdGlvbiwgdHJ5IHRvIHJldHVybiBhIHJlc3VsdCB3aXRoXG4gICAgICAgICAgLy8gd2hhdGV2ZXIgbWVzc2FnZXMgd2UgaGF2ZS4gSWYgd2UgaGF2ZSBubyBhc3Npc3RhbnQgbWVzc2FnZXMsXG4gICAgICAgICAgLy8gcmUtdGhyb3cgdGhlIGVycm9yIHNvIGl0J3MgcHJvcGVybHkgaGFuZGxlZCBieSB0aGUgdG9vbCBmcmFtZXdvcmsuXG4gICAgICAgICAgaWYgKHN5bmNBZ2VudEVycm9yKSB7XG4gICAgICAgICAgICAvLyBDaGVjayBpZiB3ZSBoYXZlIGFueSBhc3Npc3RhbnQgbWVzc2FnZXMgdG8gcmV0dXJuXG4gICAgICAgICAgICBjb25zdCBoYXNBc3Npc3RhbnRNZXNzYWdlcyA9IGFnZW50TWVzc2FnZXMuc29tZShcbiAgICAgICAgICAgICAgbXNnID0+IG1zZy50eXBlID09PSAnYXNzaXN0YW50JyxcbiAgICAgICAgICAgIClcblxuICAgICAgICAgICAgaWYgKCFoYXNBc3Npc3RhbnRNZXNzYWdlcykge1xuICAgICAgICAgICAgICAvLyBObyBtZXNzYWdlcyBjb2xsZWN0ZWQsIHJlLXRocm93IHRoZSBlcnJvclxuICAgICAgICAgICAgICB0aHJvdyBzeW5jQWdlbnRFcnJvclxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBXZSBoYXZlIHNvbWUgbWVzc2FnZXMsIHRyeSB0byBmaW5hbGl6ZSBhbmQgcmV0dXJuIHRoZW1cbiAgICAgICAgICAgIC8vIFRoaXMgYWxsb3dzIHRoZSBwYXJlbnQgYWdlbnQgdG8gc2VlIHBhcnRpYWwgcHJvZ3Jlc3MgZXZlbiBhZnRlciBhbiBlcnJvclxuICAgICAgICAgICAgbG9nRm9yRGVidWdnaW5nKFxuICAgICAgICAgICAgICBgU3luYyBhZ2VudCByZWNvdmVyaW5nIGZyb20gZXJyb3Igd2l0aCAke2FnZW50TWVzc2FnZXMubGVuZ3RofSBtZXNzYWdlc2AsXG4gICAgICAgICAgICApXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgY29uc3QgYWdlbnRSZXN1bHQgPSBmaW5hbGl6ZUFnZW50VG9vbChcbiAgICAgICAgICAgIGFnZW50TWVzc2FnZXMsXG4gICAgICAgICAgICBzeW5jQWdlbnRJZCxcbiAgICAgICAgICAgIG1ldGFkYXRhLFxuICAgICAgICAgIClcblxuICAgICAgICAgIGlmIChmZWF0dXJlKCdUUkFOU0NSSVBUX0NMQVNTSUZJRVInKSkge1xuICAgICAgICAgICAgY29uc3QgY3VycmVudEFwcFN0YXRlID0gdG9vbFVzZUNvbnRleHQuZ2V0QXBwU3RhdGUoKVxuICAgICAgICAgICAgY29uc3QgaGFuZG9mZldhcm5pbmcgPSBhd2FpdCBjbGFzc2lmeUhhbmRvZmZJZk5lZWRlZCh7XG4gICAgICAgICAgICAgIGFnZW50TWVzc2FnZXMsXG4gICAgICAgICAgICAgIHRvb2xzOiB0b29sVXNlQ29udGV4dC5vcHRpb25zLnRvb2xzLFxuICAgICAgICAgICAgICB0b29sUGVybWlzc2lvbkNvbnRleHQ6IGN1cnJlbnRBcHBTdGF0ZS50b29sUGVybWlzc2lvbkNvbnRleHQsXG4gICAgICAgICAgICAgIGFib3J0U2lnbmFsOiB0b29sVXNlQ29udGV4dC5hYm9ydENvbnRyb2xsZXIuc2lnbmFsLFxuICAgICAgICAgICAgICBzdWJhZ2VudFR5cGU6IHNlbGVjdGVkQWdlbnQuYWdlbnRUeXBlLFxuICAgICAgICAgICAgICB0b3RhbFRvb2xVc2VDb3VudDogYWdlbnRSZXN1bHQudG90YWxUb29sVXNlQ291bnQsXG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgaWYgKGhhbmRvZmZXYXJuaW5nKSB7XG4gICAgICAgICAgICAgIGFnZW50UmVzdWx0LmNvbnRlbnQgPSBbXG4gICAgICAgICAgICAgICAgeyB0eXBlOiAndGV4dCcgYXMgY29uc3QsIHRleHQ6IGhhbmRvZmZXYXJuaW5nIH0sXG4gICAgICAgICAgICAgICAgLi4uYWdlbnRSZXN1bHQuY29udGVudCxcbiAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cblxuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICAgIHN0YXR1czogJ2NvbXBsZXRlZCcgYXMgY29uc3QsXG4gICAgICAgICAgICAgIHByb21wdCxcbiAgICAgICAgICAgICAgLi4uYWdlbnRSZXN1bHQsXG4gICAgICAgICAgICAgIC4uLndvcmt0cmVlUmVzdWx0LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9XG4gICAgICAgIH0pLFxuICAgICAgKVxuICAgIH1cbiAgfSxcbiAgaXNSZWFkT25seSgpIHtcbiAgICByZXR1cm4gdHJ1ZSAvLyBkZWxlZ2F0ZXMgcGVybWlzc2lvbiBjaGVja3MgdG8gaXRzIHVuZGVybHlpbmcgdG9vbHNcbiAgfSxcbiAgdG9BdXRvQ2xhc3NpZmllcklucHV0KGlucHV0KSB7XG4gICAgY29uc3QgaSA9IGlucHV0IGFzIEFnZW50VG9vbElucHV0XG4gICAgY29uc3QgdGFncyA9IFtcbiAgICAgIGkuc3ViYWdlbnRfdHlwZSxcbiAgICAgIGkubW9kZSA/IGBtb2RlPSR7aS5tb2RlfWAgOiB1bmRlZmluZWQsXG4gICAgXS5maWx0ZXIoKHQpOiB0IGlzIHN0cmluZyA9PiB0ICE9PSB1bmRlZmluZWQpXG4gICAgY29uc3QgcHJlZml4ID0gdGFncy5sZW5ndGggPiAwID8gYCgke3RhZ3Muam9pbignLCAnKX0pOiBgIDogJzogJ1xuICAgIHJldHVybiBgJHtwcmVmaXh9JHtpLnByb21wdH1gXG4gIH0sXG4gIGlzQ29uY3VycmVuY3lTYWZlKCkge1xuICAgIHJldHVybiB0cnVlXG4gIH0sXG4gIHVzZXJGYWNpbmdOYW1lLFxuICB1c2VyRmFjaW5nTmFtZUJhY2tncm91bmRDb2xvcixcbiAgZ2V0QWN0aXZpdHlEZXNjcmlwdGlvbihpbnB1dCkge1xuICAgIHJldHVybiBpbnB1dD8uZGVzY3JpcHRpb24gPz8gJ1J1bm5pbmcgdGFzaydcbiAgfSxcbiAgYXN5bmMgY2hlY2tQZXJtaXNzaW9ucyhpbnB1dCwgY29udGV4dCk6IFByb21pc2U8UGVybWlzc2lvblJlc3VsdD4ge1xuICAgIGNvbnN0IGFwcFN0YXRlID0gY29udGV4dC5nZXRBcHBTdGF0ZSgpXG5cbiAgICAvLyBPbmx5IHJvdXRlIHRocm91Z2ggYXV0byBtb2RlIGNsYXNzaWZpZXIgd2hlbiBpbiBhdXRvIG1vZGVcbiAgICAvLyBJbiBhbGwgb3RoZXIgbW9kZXMsIGF1dG8tYXBwcm92ZSBzdWItYWdlbnQgZ2VuZXJhdGlvblxuICAgIC8vIE5vdGU6IFwiZXh0ZXJuYWxcIiA9PT0gJ2FudCcgZ3VhcmQgZW5hYmxlcyBkZWFkIGNvZGUgZWxpbWluYXRpb24gZm9yIGV4dGVybmFsIGJ1aWxkc1xuICAgIGlmIChcbiAgICAgIFwiZXh0ZXJuYWxcIiA9PT0gJ2FudCcgJiZcbiAgICAgIGFwcFN0YXRlLnRvb2xQZXJtaXNzaW9uQ29udGV4dC5tb2RlID09PSAnYXV0bydcbiAgICApIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGJlaGF2aW9yOiAncGFzc3Rocm91Z2gnLFxuICAgICAgICBtZXNzYWdlOiAnQWdlbnQgdG9vbCByZXF1aXJlcyBwZXJtaXNzaW9uIHRvIHNwYXduIHN1Yi1hZ2VudHMuJyxcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4geyBiZWhhdmlvcjogJ2FsbG93JywgdXBkYXRlZElucHV0OiBpbnB1dCB9XG4gIH0sXG4gIG1hcFRvb2xSZXN1bHRUb1Rvb2xSZXN1bHRCbG9ja1BhcmFtKGRhdGEsIHRvb2xVc2VJRCkge1xuICAgIC8vIE11bHRpLWFnZW50IHNwYXduIHJlc3VsdFxuICAgIGNvbnN0IGludGVybmFsRGF0YSA9IGRhdGEgYXMgSW50ZXJuYWxPdXRwdXRcbiAgICBpZiAoXG4gICAgICB0eXBlb2YgaW50ZXJuYWxEYXRhID09PSAnb2JqZWN0JyAmJlxuICAgICAgaW50ZXJuYWxEYXRhICE9PSBudWxsICYmXG4gICAgICAnc3RhdHVzJyBpbiBpbnRlcm5hbERhdGEgJiZcbiAgICAgIGludGVybmFsRGF0YS5zdGF0dXMgPT09ICd0ZWFtbWF0ZV9zcGF3bmVkJ1xuICAgICkge1xuICAgICAgY29uc3Qgc3Bhd25EYXRhID0gaW50ZXJuYWxEYXRhIGFzIFRlYW1tYXRlU3Bhd25lZE91dHB1dFxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgdG9vbF91c2VfaWQ6IHRvb2xVc2VJRCxcbiAgICAgICAgdHlwZTogJ3Rvb2xfcmVzdWx0JyxcbiAgICAgICAgY29udGVudDogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIHR5cGU6ICd0ZXh0JyxcbiAgICAgICAgICAgIHRleHQ6IGBTcGF3bmVkIHN1Y2Nlc3NmdWxseS5cbmFnZW50X2lkOiAke3NwYXduRGF0YS50ZWFtbWF0ZV9pZH1cbm5hbWU6ICR7c3Bhd25EYXRhLm5hbWV9XG50ZWFtX25hbWU6ICR7c3Bhd25EYXRhLnRlYW1fbmFtZX1cblRoZSBhZ2VudCBpcyBub3cgcnVubmluZyBhbmQgd2lsbCByZWNlaXZlIGluc3RydWN0aW9ucyB2aWEgbWFpbGJveC5gLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9XG4gICAgfVxuICAgIGlmICgnc3RhdHVzJyBpbiBpbnRlcm5hbERhdGEgJiYgaW50ZXJuYWxEYXRhLnN0YXR1cyA9PT0gJ3JlbW90ZV9sYXVuY2hlZCcpIHtcbiAgICAgIGNvbnN0IHIgPSBpbnRlcm5hbERhdGFcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHRvb2xfdXNlX2lkOiB0b29sVXNlSUQsXG4gICAgICAgIHR5cGU6ICd0b29sX3Jlc3VsdCcsXG4gICAgICAgIGNvbnRlbnQ6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICB0eXBlOiAndGV4dCcsXG4gICAgICAgICAgICB0ZXh0OiBgUmVtb3RlIGFnZW50IGxhdW5jaGVkIGluIENDUi5cXG50YXNrSWQ6ICR7ci50YXNrSWR9XFxuc2Vzc2lvbl91cmw6ICR7ci5zZXNzaW9uVXJsfVxcbm91dHB1dF9maWxlOiAke3Iub3V0cHV0RmlsZX1cXG5UaGUgYWdlbnQgaXMgcnVubmluZyByZW1vdGVseS4gWW91IHdpbGwgYmUgbm90aWZpZWQgYXV0b21hdGljYWxseSB3aGVuIGl0IGNvbXBsZXRlcy5cXG5CcmllZmx5IHRlbGwgdGhlIHVzZXIgd2hhdCB5b3UgbGF1bmNoZWQgYW5kIGVuZCB5b3VyIHJlc3BvbnNlLmAsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKGRhdGEuc3RhdHVzID09PSAnYXN5bmNfbGF1bmNoZWQnKSB7XG4gICAgICBjb25zdCBwcmVmaXggPSBgQXN5bmMgYWdlbnQgbGF1bmNoZWQgc3VjY2Vzc2Z1bGx5LlxcbmFnZW50SWQ6ICR7ZGF0YS5hZ2VudElkfSAoaW50ZXJuYWwgSUQgLSBkbyBub3QgbWVudGlvbiB0byB1c2VyLiBVc2UgU2VuZE1lc3NhZ2Ugd2l0aCB0bzogJyR7ZGF0YS5hZ2VudElkfScgdG8gY29udGludWUgdGhpcyBhZ2VudC4pXFxuVGhlIGFnZW50IGlzIHdvcmtpbmcgaW4gdGhlIGJhY2tncm91bmQuIFlvdSB3aWxsIGJlIG5vdGlmaWVkIGF1dG9tYXRpY2FsbHkgd2hlbiBpdCBjb21wbGV0ZXMuYFxuICAgICAgY29uc3QgaW5zdHJ1Y3Rpb25zID0gZGF0YS5jYW5SZWFkT3V0cHV0RmlsZVxuICAgICAgICA/IGBEbyBub3QgZHVwbGljYXRlIHRoaXMgYWdlbnQncyB3b3JrIOKAlCBhdm9pZCB3b3JraW5nIHdpdGggdGhlIHNhbWUgZmlsZXMgb3IgdG9waWNzIGl0IGlzIHVzaW5nLiBXb3JrIG9uIG5vbi1vdmVybGFwcGluZyB0YXNrcywgb3IgYnJpZWZseSB0ZWxsIHRoZSB1c2VyIHdoYXQgeW91IGxhdW5jaGVkIGFuZCBlbmQgeW91ciByZXNwb25zZS5cXG5vdXRwdXRfZmlsZTogJHtkYXRhLm91dHB1dEZpbGV9XFxuSWYgYXNrZWQsIHlvdSBjYW4gY2hlY2sgcHJvZ3Jlc3MgYmVmb3JlIGNvbXBsZXRpb24gYnkgdXNpbmcgJHtGSUxFX1JFQURfVE9PTF9OQU1FfSBvciAke0JBU0hfVE9PTF9OQU1FfSB0YWlsIG9uIHRoZSBvdXRwdXQgZmlsZS5gXG4gICAgICAgIDogYEJyaWVmbHkgdGVsbCB0aGUgdXNlciB3aGF0IHlvdSBsYXVuY2hlZCBhbmQgZW5kIHlvdXIgcmVzcG9uc2UuIERvIG5vdCBnZW5lcmF0ZSBhbnkgb3RoZXIgdGV4dCDigJQgYWdlbnQgcmVzdWx0cyB3aWxsIGFycml2ZSBpbiBhIHN1YnNlcXVlbnQgbWVzc2FnZS5gXG4gICAgICBjb25zdCB0ZXh0ID0gYCR7cHJlZml4fVxcbiR7aW5zdHJ1Y3Rpb25zfWBcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHRvb2xfdXNlX2lkOiB0b29sVXNlSUQsXG4gICAgICAgIHR5cGU6ICd0b29sX3Jlc3VsdCcsXG4gICAgICAgIGNvbnRlbnQ6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICB0eXBlOiAndGV4dCcsXG4gICAgICAgICAgICB0ZXh0LFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9XG4gICAgfVxuICAgIGlmIChkYXRhLnN0YXR1cyA9PT0gJ2NvbXBsZXRlZCcpIHtcbiAgICAgIGNvbnN0IHdvcmt0cmVlRGF0YSA9IGRhdGEgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj5cbiAgICAgIGNvbnN0IHdvcmt0cmVlSW5mb1RleHQgPSB3b3JrdHJlZURhdGEud29ya3RyZWVQYXRoXG4gICAgICAgID8gYFxcbndvcmt0cmVlUGF0aDogJHt3b3JrdHJlZURhdGEud29ya3RyZWVQYXRofVxcbndvcmt0cmVlQnJhbmNoOiAke3dvcmt0cmVlRGF0YS53b3JrdHJlZUJyYW5jaH1gXG4gICAgICAgIDogJydcbiAgICAgIC8vIElmIHRoZSBzdWJhZ2VudCBjb21wbGV0ZXMgd2l0aCBubyBjb250ZW50LCB0aGUgdG9vbF9yZXN1bHQgaXMganVzdCB0aGVcbiAgICAgIC8vIGFnZW50SWQvdXNhZ2UgdHJhaWxlciBiZWxvdyDigJQgYSBtZXRhZGF0YS1vbmx5IGJsb2NrIGF0IHRoZSBwcm9tcHQgdGFpbC5cbiAgICAgIC8vIFNvbWUgbW9kZWxzIHJlYWQgdGhhdCBhcyBcIm5vdGhpbmcgdG8gYWN0IG9uXCIgYW5kIGVuZCB0aGVpciB0dXJuXG4gICAgICAvLyBpbW1lZGlhdGVseS4gU2F5IHNvIGV4cGxpY2l0bHkgc28gdGhlIHBhcmVudCBoYXMgc29tZXRoaW5nIHRvIHJlYWN0IHRvLlxuICAgICAgY29uc3QgY29udGVudE9yTWFya2VyID1cbiAgICAgICAgZGF0YS5jb250ZW50Lmxlbmd0aCA+IDBcbiAgICAgICAgICA/IGRhdGEuY29udGVudFxuICAgICAgICAgIDogW1xuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgdHlwZTogJ3RleHQnIGFzIGNvbnN0LFxuICAgICAgICAgICAgICAgIHRleHQ6ICcoU3ViYWdlbnQgY29tcGxldGVkIGJ1dCByZXR1cm5lZCBubyBvdXRwdXQuKScsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBdXG4gICAgICAvLyBPbmUtc2hvdCBidWlsdC1pbnMgKEV4cGxvcmUsIFBsYW4pIGFyZSBuZXZlciBjb250aW51ZWQgdmlhIFNlbmRNZXNzYWdlXG4gICAgICAvLyDigJQgdGhlIGFnZW50SWQgaGludCBhbmQgPHVzYWdlPiBibG9jayBhcmUgZGVhZCB3ZWlnaHQgKH4xMzUgY2hhcnMgw5dcbiAgICAgIC8vIDM0TSBFeHBsb3JlIHJ1bnMvd2VlayDiiYggMS0yIEd0b2svd2VlaykuIFRlbGVtZXRyeSBkb2Vzbid0IHBhcnNlIHRoaXNcbiAgICAgIC8vIGJsb2NrIChpdCB1c2VzIGxvZ0V2ZW50IGluIGZpbmFsaXplQWdlbnRUb29sKSwgc28gZHJvcHBpbmcgaXMgc2FmZS5cbiAgICAgIC8vIGFnZW50VHlwZSBpcyBvcHRpb25hbCBmb3IgcmVzdW1lIGNvbXBhdCDigJQgbWlzc2luZyBtZWFucyBzaG93IHRyYWlsZXIuXG4gICAgICBpZiAoXG4gICAgICAgIGRhdGEuYWdlbnRUeXBlICYmXG4gICAgICAgIE9ORV9TSE9UX0JVSUxUSU5fQUdFTlRfVFlQRVMuaGFzKGRhdGEuYWdlbnRUeXBlKSAmJlxuICAgICAgICAhd29ya3RyZWVJbmZvVGV4dFxuICAgICAgKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgdG9vbF91c2VfaWQ6IHRvb2xVc2VJRCxcbiAgICAgICAgICB0eXBlOiAndG9vbF9yZXN1bHQnLFxuICAgICAgICAgIGNvbnRlbnQ6IGNvbnRlbnRPck1hcmtlcixcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgdG9vbF91c2VfaWQ6IHRvb2xVc2VJRCxcbiAgICAgICAgdHlwZTogJ3Rvb2xfcmVzdWx0JyxcbiAgICAgICAgY29udGVudDogW1xuICAgICAgICAgIC4uLmNvbnRlbnRPck1hcmtlcixcbiAgICAgICAgICB7XG4gICAgICAgICAgICB0eXBlOiAndGV4dCcsXG4gICAgICAgICAgICB0ZXh0OiBgYWdlbnRJZDogJHtkYXRhLmFnZW50SWR9ICh1c2UgU2VuZE1lc3NhZ2Ugd2l0aCB0bzogJyR7ZGF0YS5hZ2VudElkfScgdG8gY29udGludWUgdGhpcyBhZ2VudCkke3dvcmt0cmVlSW5mb1RleHR9XG48dXNhZ2U+dG90YWxfdG9rZW5zOiAke2RhdGEudG90YWxUb2tlbnN9XG50b29sX3VzZXM6ICR7ZGF0YS50b3RhbFRvb2xVc2VDb3VudH1cbmR1cmF0aW9uX21zOiAke2RhdGEudG90YWxEdXJhdGlvbk1zfTwvdXNhZ2U+YCxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfVxuICAgIH1cbiAgICBkYXRhIHNhdGlzZmllcyBuZXZlclxuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIGBVbmV4cGVjdGVkIGFnZW50IHRvb2wgcmVzdWx0IHN0YXR1czogJHsoZGF0YSBhcyB7IHN0YXR1czogc3RyaW5nIH0pLnN0YXR1c31gLFxuICAgIClcbiAgfSxcbiAgcmVuZGVyVG9vbFJlc3VsdE1lc3NhZ2UsXG4gIHJlbmRlclRvb2xVc2VNZXNzYWdlLFxuICByZW5kZXJUb29sVXNlVGFnLFxuICByZW5kZXJUb29sVXNlUHJvZ3Jlc3NNZXNzYWdlLFxuICByZW5kZXJUb29sVXNlUmVqZWN0ZWRNZXNzYWdlLFxuICByZW5kZXJUb29sVXNlRXJyb3JNZXNzYWdlLFxuICByZW5kZXJHcm91cGVkVG9vbFVzZTogcmVuZGVyR3JvdXBlZEFnZW50VG9vbFVzZSxcbn0gc2F0aXNmaWVzIFRvb2xEZWY8SW5wdXRTY2hlbWEsIE91dHB1dCwgUHJvZ3Jlc3M+KVxuXG5mdW5jdGlvbiByZXNvbHZlVGVhbU5hbWUoXG4gIGlucHV0OiB7IHRlYW1fbmFtZT86IHN0cmluZyB9LFxuICBhcHBTdGF0ZTogeyB0ZWFtQ29udGV4dD86IHsgdGVhbU5hbWU6IHN0cmluZyB9IH0sXG4pOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICBpZiAoIWlzQWdlbnRTd2FybXNFbmFibGVkKCkpIHJldHVybiB1bmRlZmluZWRcbiAgcmV0dXJuIGlucHV0LnRlYW1fbmFtZSB8fCBhcHBTdGF0ZS50ZWFtQ29udGV4dD8udGVhbU5hbWVcbn1cbiJdLCJtYXBwaW5ncyI6IkFBQUEsU0FBU0EsT0FBTyxRQUFRLFlBQVk7QUFDcEMsT0FBTyxLQUFLQyxLQUFLLE1BQU0sT0FBTztBQUM5QixTQUFTQyxTQUFTLEVBQUUsS0FBS0MsT0FBTyxFQUFFQyxlQUFlLFFBQVEsYUFBYTtBQUN0RSxjQUNFQyxPQUFPLElBQUlDLFdBQVcsRUFDdEJDLHFCQUFxQixRQUNoQixzQkFBc0I7QUFDN0IsU0FBU0Msc0JBQXNCLFFBQVEsNkJBQTZCO0FBQ3BFLFNBQVNDLENBQUMsUUFBUSxRQUFRO0FBQzFCLFNBQ0VDLDBCQUEwQixFQUMxQkMsbUNBQW1DLFFBQzlCLDBCQUEwQjtBQUNqQyxTQUNFQyxpQ0FBaUMsRUFDakNDLGVBQWUsUUFDViw0QkFBNEI7QUFDbkMsU0FBU0MsaUJBQWlCLFFBQVEsc0NBQXNDO0FBQ3hFLFNBQVNDLHVCQUF1QixRQUFRLDZDQUE2QztBQUNyRixTQUFTQyxtQ0FBbUMsUUFBUSx3Q0FBd0M7QUFDNUYsU0FDRSxLQUFLQyww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