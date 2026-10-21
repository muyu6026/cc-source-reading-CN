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
// 原文件此处有一行 164556 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。