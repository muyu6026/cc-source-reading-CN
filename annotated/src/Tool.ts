// ═══════════════════════════════════════════════════════════════════════════
// src/Tool.ts —— 工具契约（Tool contract），792 行
//
// 【这个文件是什么】
//   它是整个工具系统的「接口定义」。BashTool / FileEditTool / Read / Grep / AgentTool / 各种 MCP 工具
//   ……全部都是在实现这里定义的 `Tool` 类型。读懂了 Tool.ts，任何一个具体工具的实现都只剩「填空」。
//
//   792 行里 **真正的可执行代码不到 40 行**，只有 5 个函数：
//     getEmptyToolPermissionContext()      造一个空的权限上下文
//     filterToolProgressMessages()         从进度消息里剔掉 hook 进度
//     toolMatchesName() / findToolByName() 按名字或别名查工具
//     buildTool()                          给工具定义补默认值
//   其余全是 type 声明。所以读法不是"从上往下一行行看"，而是：
//   先看清「一个工具从出生到显示要过几道关」，再回头查每道关对应哪个方法。
//
// 【三个泛型参数，先记住这个】
//     Tool<Input, Output, P>
//       Input  extends AnyObject       —— 一个 zod schema 的"类型"（不是 schema 值本身）
//       Output                         —— call() 返回的 data 的类型
//       P      extends ToolProgressData —— 进度事件的载荷类型（如 BashProgress）
//   方法签名里到处出现的 `z.infer<Input>` 就是「把 zod schema 反推成 TS 类型」。
//   这样做的收益：一份 schema 同时当「运行时校验器」和「编译期类型源」，不用写两遍。
//
// 【一个工具的一生：谁在哪一步调用哪个方法】
//   （下面的行号都是 source/src 里的真实位置，可点开对照）
//
//   ① 装配      src/tools.ts getAllBaseTools()        isEnabled() / shouldDefer / alwaysLoad
//   ② 发给模型  src/utils/api.ts:171                  prompt() → 塞进 API 的 description 字段
//                                                     inputSchema → 转成 JSON Schema
//   ③ 选中它    src/services/api/claude.ts            （模型返回 tool_use block）
//   ④ 分批      toolOrchestration.ts:101              isConcurrencySafe() → 并发跑还是一批批跑
//   ⑤ 形状校验  toolExecution.ts:615                  inputSchema.safeParse()
//   ⑥ 业务校验  toolExecution.ts:683                  validateInput()
//   ⑦ 权限判定  utils/permissions/permissions.ts:1120 checkPermissions()
//   ⑧ 执行      toolExecution.ts:1207                 call()
//   ⑨ 结果回灌  toolExecution.ts:1292                 mapToolResultToToolResultBlockParam()
//   ⑩ 大小落盘  utils/toolResultStorage.ts:217        maxResultSizeChars
//   ⑪ 渲染      components/messages/*                 renderToolUseMessage / renderToolResultMessage
//   ⑫ 中断      StreamingToolExecutor.ts:224          interruptBehavior()
//
//   ★ ⑧ 之前有 ⑤⑥⑦ 三道关，这个顺序是**不能换的**：
//     形状不对（zod 失败）就不该问权限，业务上无意义（validateInput 失败）也不该弹对话框。
//     这个"从便宜到昂贵、从客观到主观"的排序，是整条工具链最核心的设计。
//
// 【四个查证出来的关键事实（不是推测，都验证过调用点）】
//
//   1. 这份源码**不能 tsc**：Tool.ts 依赖的 3 个类型模块在仓库里根本不存在
//      —— src/types/message.ts、src/types/tools.ts、src/types/utils.ts。
//      其中 types/message.ts 被 75 个文件 import，是整份源码里最热门的缺失文件。
//      不影响阅读：它们全是 `import type`，bun 打包时被整段擦除，运行时不需要。
//      副作用：`DeepImmutable<T>` 的定义因此看不到（详见下面第 6 节，只能按用法推断语义）。
//
//   2. `isDestructive` 是个**事实上的死字段**：外部调用点只有三处，
//      全部写成 `tool.isDestructive?.({})`（print.ts:1661、MCPToolListView.tsx:62、
//      MCPToolDetailView.tsx:48），传的是空对象。
//      而 ExitWorktreeTool.ts:168 的实现是 `return input.action === 'remove'`
//      → 永远拿到 undefined，永远返回 false。所以 CLI 的 MCP 列表里永远不会出现 destructive 标记。
//
//   3. `buildTool` 只被 40 处使用。BashTool / FileEditTool / AgentTool / AskUserQuestionTool
//      这些最核心的工具仍然是手写 `satisfies Tool`，**不走** buildTool。
//      后果：TOOL_DEFAULTS 那套"默认 fail-closed"的保护，对最危险的几个工具恰恰不生效，
//      它们必须自己实现 isConcurrencySafe / isReadOnly / checkPermissions。
//
//   4. `TOOL_DEFAULTS.userFacingName` 是个死默认值：它返回 `''`，
//      但 buildTool 在 `...TOOL_DEFAULTS` 之后紧跟着写了 `userFacingName: () => def.name`，
//      再之后才是 `...def`。中间那行把它覆盖了 → 实际生效的是「没提供就用 name」，
//      那个 `''` 永远不会出现在任何工具上。读第 15 节时注意这三层的覆盖顺序。
//
// 【阅读约定】
//   · 英文原文（含原注释）一个字都不删
//   · 紧跟其后的 `// 译：` 是中文直译
//   · `// 注：` 是补充解释
//   · `// ── N. xxx ──` 是我加的段落分隔（原文没有这些分段）
//
// 原文位置：source/src/Tool.ts（792 行）
// ═══════════════════════════════════════════════════════════════════════════

// ── 1. import 区：为什么分成七八段 ───────────────────────────────────────────
//
// 这个文件有 30 多个 import，散落在 1-88 行，而且第 15 行突然插了一个类型定义进去。
// 看着乱，其实对应一条硬约束：**Tool.ts 是依赖图的根**。
// 几乎所有模块都要 import Tool，所以 Tool.ts 不能反过来 import 它们，否则 ESM 循环导入
// 会在"模块初始化顺序"上炸掉（不是类型报错，是运行时 undefined）。
//
// 于是所有被依赖的类型都被挪进 src/types/ 这种叶子目录，Tool.ts 只从叶子取。
// 源码第 41、48、116 行的注释反复写 "to break import cycles"，说的就是这件事。
//
// 这也解释了一个现象：为什么 `ToolPermissionContext`（第 123 行）要用
// `DeepImmutable<{...}>` 包一层再导出，而不是直接引用 permissions.ts 里的定义。

// ── 2. 头三个 import：API 线格式与 MCP 协议 ──────────────────────────────────
//
// `ToolUseBlockParam` 和 `ToolResultBlockParam` 是**发给 Anthropic API 的 JSON 结构**，
// 不是内部数据结构。这两个类型出现在这里，说明整个工具系统是「以 API 的 wire format 为中心」
// 建模的：内部数据结构最终都要能无损地塞进这两个 block。
//
//   模型输出 → { type: 'tool_use', id, name, input }        ← ToolUseBlockParam
//   我们回传 → { type: 'tool_result', tool_use_id, content } ← ToolResultBlockParam
//
// `mapToolResultToToolResultBlockParam()`（第 557 行）就是干这个转换的。
// Elicit* 是 MCP 的 "elicitation"（服务端反过来向用户提问）的请求/结果类型，
// 只在 handleElicitation 那条可选路径上用（第 193-202 行）。
import type {
  ToolResultBlockParam,
  ToolUseBlockParam,
} from '@anthropic-ai/sdk/resources/index.mjs'
// 注：路径写法是 `@anthropic-ai/sdk/resources/index.mjs` —— .mjs 后缀是为了 ESM 解析，
//     这是 SDK 自己导出的子路径，不是本地文件。

import type {
  ElicitRequestURLParams,
  ElicitResult,
} from '@modelcontextprotocol/sdk/types.js'
// 注：ElicitRequestURLParams 专指「-32042 错误码触发的 URL 型 elicitation」，
//     也就是 MCP 服务器要求用户去某个网页完成授权。ToolUseContext.handleElicitation
//     的注释（第 194 行）明确写了这个错误码，两者要对照着看。

import type { UUID } from 'crypto'
// 注：Node 内置模块。全项目用它当「消息 id / 会话 id」的类型，而不是裸 string，
//     这样把 userId 误传给 sessionId 这类错误能在编译期被抓住。
import type { z } from 'zod/v4'
// 注：注意是 `zod/v4`，不是 `zod`。v4 的 API 与 v3 有差异（比如 safeParse 的返回结构）。
import type { Command } from './commands.js'
// 注：斜杠命令类型。工具的渲染函数需要它，因为有些工具参数里可以直接写 `/命令`
//     （renderToolUseMessage 的 options.commands，第 607 行）。
import type { CanUseToolFn } from './hooks/useCanUseTool.js'
// 注：这个才是"问权限"的函数本体。定义在 useCanUseTool.tsx:27，签名是
//       (tool, input, ctx, assistantMessage, toolUseID, forceDecision?) => Promise<PermissionDecision>
//     Tool.checkPermissions() 只做「工具自己的特殊判断」，最终由它汇总成 allow/ask/deny。
import type { ThinkingConfig } from './utils/thinking.js'
// 注：放在 options 里传给工具 —— 让工具知道当前是否开了 extended thinking。
//     少数工具会据此调整输出详略（thinking 开着时模型更能消化长输出）。

export type ToolInputJSONSchema = {
  [x: string]: unknown
  type: 'object'
  properties?: {
    [x: string]: unknown
  }
}
// 注：↑ 这就是那个"夹在 import 中间"的类型定义，位置确实反常（第 15 行，
//     前面还有 20 多个 import 没写完）。历史遗留的可能性大：最初只写了这一段，
//     后来加 import 时往后堆，没整理。
//
//     它的用途很窄但很关键：**给 MCP 工具用**。MCP 工具的参数 schema 是服务端给的
//     JSON Schema，没有 zod 版本，所以没法走 `inputSchema: Input extends AnyObject` 那条路。
//     于是 Tool 类型里留了两个并列字段（第 394、397 行）：
//       inputSchema      —— zod（内置工具用）
//       inputJSONSchema  —— 裸 JSON Schema（MCP 工具用）
//     两者取其一，下游拼 API 请求时按有无 `inputJSONSchema` 分支（utils/api.ts:158 附近）。
//
//     为什么索引签名写成 `[x: string]: unknown` 而不是 `Record<string, unknown>`？
//     因为要允许 `type: 'object'` 这种字面量收窄，同时又能塞任意额外字段（$schema、$defs…）。

// ── 3. 第二批 import：消息、权限、进度三大类 ────────────────────────────────
//
// 这一段最容易看晕，因为 `import type {` 出现 10 次。按目录归类就清楚了：
//
//   context/ | services/mcp/ | tools/AgentTool/   ← 环境与外部系统
//   types/message、types/permissions、types/tools ← 三大数据契约（都是叶子模块）
//   utils/                                        ← 四个状态容器
//
// 注意 types/message.ts 和 types/tools.ts 这两个文件在仓库里**不存在**（见开头事实 1）。
// 所以下面这两段 import 是"悬空"的：TS 找得到名字的用法（Message、BashProgress…）
// 全靠调用处的字面量结构凑合，跳转定义会失败。这也是为什么本文件不能 tsc。

import type { Notification } from './context/notifications.js'
// 注：终端里那种短暂冒出来的提示条（addNotification 用，见第 204 行）。
import type {
  MCPServerConnection,
  ServerResource,
} from './services/mcp/types.js'
// 注：MCPServerConnection 有四种传输（stdio/sse/http/ws）的联合类型；
//     ServerResource 是 MCP 服务器暴露的资源（类似文件），会拼进 options.mcpResources。

import type {
  AgentDefinition,
  AgentDefinitionsResult,
} from './tools/AgentTool/loadAgentsDir.js'
// 注：★ 这是个有意思的不对称：AgentDefinition 定义在**某个工具目录里**，
//     却在 Tool.ts 里被 import。方向是反向的（工具 → 契约），但因为是 `import type`，
//     编译后被擦除，运行时不会真的形成循环依赖。
//     AgentDefinitionsResult 是「加载结果 + 错误」，因为 .claude/agents/*.md 可能解析失败，
//     要把失败信息一起带出来给 UI 显示（而不是静默丢弃）。

import type {
  AssistantMessage,
  AttachmentMessage,
  Message,
  ProgressMessage,
  SystemLocalCommandMessage,
  SystemMessage,
  UserMessage,
} from './types/message.js'
// 注：★ 文件缺失重灾区（75 个文件 import 它）。七个名字的含义按"谁说的话"分：
//       AssistantMessage      模型说的（可能含 tool_use）
//       UserMessage           用户说的，**也包括 tool_result**（API 层面 tool_result 属于 user 角色）
//       SystemMessage         系统注入的（进度、提醒、错误）
//       SystemLocalCommandMessage  本地斜杠命令的输出，是 SystemMessage 的子类
//       AttachmentMessage     附件（图片、CLAUDE.md、文件引用）
//       ProgressMessage       工具执行中的进度流
//       Message              以上全部的联合
//     记住这条："tool_result 在 API 里是 user 消息"，读 query.ts 时才不会困惑。
// Import permission types from centralized location to break import cycles
// Import PermissionResult from centralized location to break import cycles
// 译：从集中位置导入权限类型，以打破循环导入。
// 译：从集中位置导入 PermissionResult，以打破循环导入。
// 注：↑ 这两行注释是**重复的**，明显是重构残留：原本是两条 import
//     （一条取权限规则类型、一条取 PermissionResult），后来合并成下面这一条，
//     两行注释没删。这类小痕迹在整份源码里很多，能反推出"这里改过"。
//     它们的价值：告诉你 types/permissions.ts 是为了**打破循环**而抽出去的。
import type {
  AdditionalWorkingDirectory,
  PermissionMode,
  PermissionResult,
} from './types/permissions.js'
// 注：三个东西分别对应权限系统的三层：
//       PermissionMode          六种模式（default/plan/acceptEdits/bypassPermissions/dontAsk/auto）
//       AdditionalWorkingDirectory  /add-dir 加进来的额外目录（每个目录还能带自己的规则）
//       PermissionResult        checkPermissions() 的返回：{behavior:'allow'|'ask'|'deny', ...}
// Import tool progress types from centralized location to break import cycles
// 译：从集中位置导入工具进度类型，以打破循环导入。
// 注：这和上面那两行是同一个模式 —— 共享类型一律下沉到 types/ 叶子目录，Tool.ts 只做消费者。
import type {
  AgentToolProgress,
  BashProgress,
  MCPProgress,
  REPLToolProgress,
  SkillToolProgress,
  TaskOutputProgress,
  ToolProgressData,
  WebSearchProgress,
} from './types/tools.js'
// 注：★ 文件缺失（types/tools.ts 不存在）。八个名字 = 七个具体工具的进度载荷 + 一个基类。
//     注意每个进度类型的**粒度不同**，这是刻意的：
//       BashProgress    有 stdout 增量、总输出行数 —— 因为编译可能要跑几分钟
//       WebSearchProgress 有查询词和结果数 —— 因为搜索是黑盒，只能报"查到第几条"
//       AgentToolProgress 有子代理的中间消息 —— 因为子代理本身又是一轮对话
//     想加新工具时，第一步就是来这里登记一个新的 XxxProgress。
//
// 最后四个是"状态容器"类型，都是**跨轮次存活**的可变对象，必须放在 context 里传：
import type { FileStateCache } from './utils/fileStateCache.js'
// 注：记录"每个文件我们上次读到的内容"。Read 用它判断文件是否被改过（决定要不要提醒模型重读）。
import type { DenialTrackingState } from './utils/permissions/denialTracking.js'
// 注：连续被拒绝的次数。连续拒 3 次就停止自动判定、改成直接弹框问人。
//     注意 ToolUseContext.localDenialTracking（第 283 行）是它的"副本"，
//     因为异步子代理的 setAppState 是空操作，计数存不进全局 store。
import type { SystemPrompt } from './utils/systemPromptType.js'
// 注：已经渲染好的 system prompt（带缓存标记的字节）。作为「快照」存在 context 里，
//     目的是让 fork 出来的子代理复用父级的 prompt 缓存，别重新生成导致缓存失效。
import type { ContentReplacementState } from './utils/toolResultStorage.js'
// 注：工具结果超预算时的"替换/落盘"记录。它的设计有个细节（第 284-291 行注释）：
//     主线程只创建一次、永不清空（旧 UUID 的键自然失效，不会误伤）；
//     子代理默认克隆父级的（因为要共享缓存，必须做出一致的决定）。

// Re-export progress types for backwards compatibility
// 译：为了向后兼容，重新导出进度类型。
// 注：`export type { ... }` 只是把名字转手，编译后什么都不生成。
//     为什么要转手？因为历史上这些类型住在 Tool.ts，后来搬到 types/tools.ts，
//     但外部代码还在 `import type { BashProgress } from './Tool.js'`，
//     所以留一条"转口"通道，避免一次性改几百处 import。
//     读代码时看到这种转口，可以直接跳到真正的定义处，别在这里找实现。
export type {
  AgentToolProgress,
  BashProgress,
  MCPProgress,
  REPLToolProgress,
  SkillToolProgress,
  TaskOutputProgress,
  WebSearchProgress,
}

import type { SpinnerMode } from './components/Spinner.js'
// 注：★ 注意这条 import 在 re-export 之后才出现（第 75 行）。
//     说明作者是"用到哪加到哪"，没有严格分区。这类排版不用纠结，不影响语义。
import type { QuerySource } from './constants/querySource.js'
// 注：标记这次请求是谁发起的（repl_main_thread / agent:xxx / agent_summary …）。
//     埋点、结果持久化策略都要看它 —— query.ts:377 就是用 querySource 前缀决定要不要落盘。
import type { SDKStatus } from './entrypoints/agentSdkTypes.js'
// 注：`-p` / SDK 模式对外汇报的状态（idle / running / error），通过 setSDKStatus 回传。
import type { AppState } from './state/AppState.js'
// 注：整个 UI 的全局状态树。getAppState / setAppState 是它唯一的读写口。
import type {
  HookProgress,
  PromptRequest,
  PromptResponse,
} from './types/hooks.js'
// 注：HookProgress 会混进 Progress 联合（第 305 行），所以 filterToolProgressMessages
//     要专门把它剔掉 —— 因为 hook 进度不该出现在工具结果渲染里。
//     PromptRequest/Response 是 requestPrompt 的请求协议（第 270 行）。
import type { AgentId } from './types/ids.js'
// 注：和 UUID 一样是品牌类型（branded type），在类型层面区分"代理 id"与"会话 id"。
import type { DeepImmutable } from './types/utils.js'
// 注：★ 这个模块不存在（types/utils.ts 缺失），所以下面第 123 行的
//     `DeepImmutable<{...}>` 具体展开成什么，源码里看不到。
//     按名字和用法推断：递归地把所有字段变成 readonly（含嵌套对象与 Map 的元素）。
//     实际影响：权限上下文传进工具后**不能就地改**，只能造新对象 ——
//     这从设计上保证了"一个工具偷偷放宽自己的权限"这件事做不到。
import type { AttributionState } from './utils/commitAttribution.js'
// 注：git commit 的归属信息（哪次提交是 AI 参与写的），用于 updateAttributionState。
import type { FileHistoryState } from './utils/fileHistory.js'
// 注：文件编辑的时间线，支持"回退到某一步"。Edit/Write 每次改文件都要往这里记一笔。
import type { Theme, ThemeName } from './utils/theme.js'
// 注：Theme 是"主题里有哪些颜色键"的类型，ThemeName 是主题名（dark/light/…）。
//     区别很重要：renderToolUseMessage 收的是 ThemeName（只给名字，渲染函数自己查色表），
//     而 userFacingNameBackgroundColor 返回的是 Theme 的键名（第 527 行）。

// ── 4. QueryChainTracking：为什么工具要关心"第几层" ─────────────────────────
//
// 这是子代理系统的最小元数据。链条 = 主对话 → 子代理 → 子代理的子代理……
//   chainId：同一条链共享的 id（一次 query 从根到叶不换）
//   depth  ：当前在第几层，主对话是 0
//
// 两个字段各有实际用途：
//   depth 用来**限深**（防止子代理无限套娃），也用来给埋点分层（哪一层的工具调用最费时）
//   chainId 用来把一次请求的所有子调用串成一条 trace
// 埋点参数里到处出现的 queryChainId / queryDepth 就来自这里（见 toolExecution.ts:647-649）。
export type QueryChainTracking = {
  chainId: string
  depth: number
}

// ── 5. ValidationResult：一个"不带异常"的校验结果 ────────────────────────────
//
// 判别联合（discriminated union），用 `result: true|false` 当判别位。
// 注意它和 PermissionResult 的**分工**：
//   ValidationResult → 告诉**模型**"你这个参数不行"，会变成 tool_result 内容塞回对话
//   PermissionResult → 决定**要不要问人**，影响的是流程而不是对话内容
// 源码注释（第 485 行）专门强调了这一点：validateInput "informs the model of why
// the tool use failed, and does not directly display any UI"。
//
// errorCode 的用途：给错误分类（文件名不合法 / 路径越界 / 参数互斥…），
// 便于埋点统计"哪类参数错误最多"，也便于测试断言。
export type ValidationResult =
  | { result: true }
  | {
      result: false
      message: string
      errorCode: number
    }
// 注：成功分支不带任何字段。这是刻意的 —— 校验只回答"能不能做"，
//     不许顺手返回"改写后的参数"。要改参数得走 PermissionResult.updatedInput。
//     如果校验能顺手改参，那"参数"就有了两个真相来源，调试时根本追不清。

// ── 6. SetToolJSXFn：工具往终端里塞一块自定义 UI ────────────────────────────
//
// 有些工具的执行过程没法用一行文字表达（交互式选择器、todo 面板、diff 预览…）。
// 于是开了个口子：工具可以把自己渲染的 React 节点直接挂到界面上。
//
// 参数里 `| null` 很重要：传 null 等于"卸载我挂上去的那块 UI"。
// 这也是为什么 ToolUseContext 里它是可选（setToolJSX?）—— SDK / -p 模式下没有界面，
// 这个函数根本不存在，工具必须判空（或压根不实现需要它的能力）。
export type SetToolJSXFn = (
  args: {
    jsx: React.ReactNode | null
    shouldHidePromptInput: boolean
    shouldContinueAnimation?: true
    showSpinner?: boolean
    isLocalJSXCommand?: boolean
    isImmediate?: boolean
    /** Set to true to clear a local JSX command (e.g., from its onDone callback) */
    // 译：设为 true 表示清除一个本地 JSX 命令（例如从它自己的 onDone 回调里调用）。
    // 注：这个字段的存在说明"清除"有两个入口：传 jsx: null，或者传 clearLocalJSX: true。
    //     后者专门给"命令自己完成了、要把自己关掉"的场景 —— 因为那时它手里没有可传的 null 上下文。
    clearLocalJSX?: boolean
  } | null,
) => void
// 注：注意 `React.ReactNode` 在这里没有 `import React` —— 靠的是 @types/react 的
//     全局 UMD 声明。整份源码里大量这样写，属于"能用但不是最佳实践"。

// Import tool permission types from centralized location to break import cycles
// 译：从集中位置导入工具权限规则类型，以打破循环导入。
import type { ToolPermissionRulesBySource } from './types/permissions.js'

// Re-export for backwards compatibility
// 译：为了向后兼容，重新导出。
export type { ToolPermissionRulesBySource }

// Apply DeepImmutable to the imported type
// 译：把 DeepImmutable 应用到导入进来的类型上。
// 注：这句话是理解第 123 行的钥匙。ToolPermissionContext **不是**在 permissions.ts 里定义的，
//     它是"把一堆散落的类型在这里组装一次，然后整体冻住"。
//     所以想知道权限上下文长什么样，只能看这里，不能跳转。
export type ToolPermissionContext = DeepImmutable<{
  // 注：七个必填字段 + 四个可选字段。按来源分三类：
  //
  //   【当前模式】      mode
  //   【目录范围】      additionalWorkingDirectories
  //   【三类规则表】    alwaysAllowRules / alwaysDenyRules / alwaysAskRules
  //   【能力开关】      isBypassPermissionsModeAvailable / isAutoModeAvailable
  //   【运行时补丁】    strippedDangerousRules / shouldAvoidPermissionPrompts /
  //                     awaitAutomatedChecksBeforeDialog / prePlanMode
  //
  //   规则表的结构是 `Record<来源, 规则字符串[]>`，来源包括 userSettings / projectSettings /
  //   localSettings / session / cliArg … 所以同一条规则可以来自多处，判定时**全部合并**。
  //   这就是为什么类型叫 ToolPermissionRulesBySource（"按来源分组"）而不是一个扁平数组。
  mode: PermissionMode
  // 注：六种模式之一。注意它不是"权限级别"，而是"**决策策略**"：
  //     default 每次问、acceptEdits 只自动放行编辑、plan 只读、
  //     bypassPermissions 全放行（有两道安全闸，见 setup.ts 批注）、
  //     dontAsk 全拒绝、auto 交给分类器判断。
  additionalWorkingDirectories: Map<string, AdditionalWorkingDirectory>
  // 注：用 Map 而不是数组 —— 因为要按路径高频查。每个值还带着"这个目录自己的规则"，
  //     所以 /add-dir 加的目录可以比主目录更严或更松。
  alwaysAllowRules: ToolPermissionRulesBySource
  alwaysDenyRules: ToolPermissionRulesBySource
  alwaysAskRules: ToolPermissionRulesBySource
  // 注：三类规则表的**优先级是 deny > ask > allow**（deny 一票否决）。
  //     这个顺序写在 permissions.ts 的判定链里，这里只是数据。
  isBypassPermissionsModeAvailable: boolean
  // 注：注意是 "Available" 不是 "Enabled" —— 表示"这个会话允不允许进入 bypass 模式"
  //     （由启动参数、是否 root、是否沙箱内等条件算出来），不是"现在是不是 bypass 模式"。
  //     现在是什么模式看上面的 mode。
  isAutoModeAvailable?: boolean
  // 注：auto 模式（分类器自动判定）是否可用。可选，因为早期版本没有这个模式。
  strippedDangerousRules?: ToolPermissionRulesBySource
  // 注：被"剥掉"的危险规则。这是个安全设计：某些来源（比如项目里的 settings.json，
  //     可能来自别人的仓库）不允许自带高危 allow 规则，加载时就被摘掉，
  //     但摘掉的记录留在这里，UI 才能解释"你写的规则为什么没生效"。
  /** When true, permission prompts are auto-denied (e.g., background agents that can't show UI) */
  // 译：为 true 时，权限询问会被自动拒绝（例如无法显示界面的后台代理）。
  // 注：★ 这一条把"能不能弹窗"这个 UI 事实，变成了一个**权限语义**：
  //     不能弹窗 ⇒ 视为拒绝（fail-closed），而不是"视为同意"。
  //     整个权限系统里凡是拿不准的地方，都选拒绝，这条是最典型的一处。
  shouldAvoidPermissionPrompts?: boolean
  /** When true, automated checks (classifier, hooks) are awaited before showing the permission dialog (coordinator workers) */
  // 译：为 true 时，先等自动检查（分类器、hook）跑完，再显示权限对话框（协调器的 worker 用）。
  // 注：默认是"先弹框、同时在后台跑 hook"，快，但可能弹了个其实会被 hook 自动放行的框。
  //     worker 场景宁可慢一点，也不要弹出多余的框 —— 因为没人看着，弹了就是白等。
  awaitAutomatedChecksBeforeDialog?: boolean
  /** Stores the permission mode before model-initiated plan mode entry, so it can be restored on exit */
  // 译：保存"模型主动进入 plan 模式"之前的权限模式，以便退出时恢复。
  // 注：★ 这个字段暴露了一个易错点：plan 模式有两个入口。
  //     用户按快捷键进来 → 退出时回 default；
  //     模型自己调 EnterPlanMode 进来 → 退出时必须回到**原来那个模式**（可能本来是 acceptEdits）。
  //     没有这个字段，就会出现"模型进了一次 plan，出来把我的 acceptEdits 弄丢了"。
  prePlanMode?: PermissionMode
}>

export const getEmptyToolPermissionContext: () => ToolPermissionContext =
  () => ({
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
  })
// 注：↑ 类型写的是 `DeepImmutable<{...}>`，但这里返回的是普通对象字面量，
//     DeepImmutable 是纯类型层面的包装，运行时什么都不做（不 Object.freeze）。
//     所以"不可变"靠的是**约定 + 类型检查**，不是运行时保护。改它不会报错，但会被 review 拦。
//
//     谁需要这个空上下文？三类"没有真实权限环境"的调用者（实测调用点）：
//       components/agents/generateAgent.ts:156        生成 agent 定义时试跑 prompt()，只想知道文本
//       components/tasks/AsyncAgentDetailDialog.tsx:36 展示异步任务的工具列表
//       components/tasks/InProcessTeammateDetailDialog.tsx:37 同上
//     它们的共同点：只想调 getTools() 拿到工具清单做展示，不执行、不判定权限。
//
//     注意它**故意**把 isBypassPermissionsModeAvailable 设成 false —— 空上下文不能是"全放行"。

// ── 7. CompactProgressEvent：压缩过程也要能被"看见" ─────────────────────────
//
// 上下文压缩（compact）是一次可能耗时几十秒的操作，期间必须给用户进度，
// 否则界面像卡死。三个阶段事件：
//   hooks_start    即将跑 pre_compact / post_compact / session_start 这些 hook
//   compact_start  真正开始压缩
//   compact_end    结束
//
// 为什么不直接复用 ToolProgressData？因为压缩**不是工具**，它是 query 循环内部的动作，
// 走不了工具进度那条通道。所以另开一个小联合，由 ToolUseContext.onCompactProgress 传出去。
export type CompactProgressEvent =
  | {
      type: 'hooks_start'
      hookType: 'pre_compact' | 'post_compact' | 'session_start'
    }
  | { type: 'compact_start' }
  | { type: 'compact_end' }

// ── 8. ToolUseContext：46 个字段的"上帝对象" ────────────────────────────────
//
// 工具的执行环境全在这里。它大得离谱（143 行），但不是乱堆的：
// **每个字段后面的 `?` 精确地标出了三种运行环境的差异。**
//
//   有 `?`              → 只有某一种环境才有，工具必须判空
//   options 里的 `?`    → 同上，但属于"配置"而非"能力"
//   无 `?`              → 三种环境都保证有，工具可以放心用
//
// 三种环境：
//   REPL（终端交互）    字段最全。所有 UI 回调都在
//   SDK / -p（管道）    没有 setToolJSX / requestPrompt / sendOSNotification
//   子代理              在 REPL 基础上砍掉 setAppState（异步代理），改用 setAppStateForTasks
//
// 读这个类型的正确姿势不是"记住 46 个字段"，而是**按用途分九组**（下面依次标出）：
//   ① 配置 ② 中断与文件状态 ③ 全局状态读写 ④ 向外的通知通道 ⑤ 去重集合
//   ⑥ 进度与状态回传 ⑦ 会话身份 ⑧ 资源限制与决策记录 ⑨ 缓存与预算
export type ToolUseContext = {
  // ── ① 配置：整轮对话只读，不随单次调用变 ──
  options: {
    commands: Command[]
    // 注：当前可用的斜杠命令表。工具为什么要它？因为工具的渲染函数要判断
    //     "参数里这个 /xxx 是不是合法命令"，非法就显示成普通文本而不是高亮命令块。
    debug: boolean
    // 注：--debug。工具的很多日志用 logForDebugging 写，只有它为 true 才输出。
    mainLoopModel: string
    // 注：当前模型名。AgentTool 用它算"子代理能不能用 1M 上下文"这类问题。
    tools: Tools
    // 注：★ 工具能看见**其它所有工具**。这是几个能力的实现基础：
    //     AgentTool 要把工具清单塞给子代理；ToolSearch 要遍历全部工具做关键词匹配；
    //     权限提示要知道"同类工具还有哪些"。代价是耦合 —— 工具之间可以互相"认识"。
    verbose: boolean
    // 注：详细模式。影响渲染粒度（renderToolResultMessage 的 options.verbose 同源）。
    thinkingConfig: ThinkingConfig
    // 注：扩展思考配置。少数工具据此调整输出长度上限。
    mcpClients: MCPServerConnection[]
    // 注：当前连着的 MCP 服务器连接。MCP 工具的 call() 就是通过这些连接发请求的。
    mcpResources: Record<string, ServerResource[]>
    // 注：按服务器分组的资源清单（MCP 的 resources/list 结果），用于 @ 引用补全。
    isNonInteractiveSession: boolean
    // 注：★ `-p` / SDK 模式。工具用它决定"能不能弹交互框"。
    //     注意它和 setup.ts 里的 getIsNonInteractiveSession() 是**同一个事实的两个来源**，
    //     一个从 context 传、一个从全局读。后者给拿不到 context 的地方用（比如渲染层）。
    agentDefinitions: AgentDefinitionsResult
    // 注：可用的子代理定义（.claude/agents/*.md）。AgentTool 靠它解析 subagent_type。
    maxBudgetUsd?: number
    // 注：本次运行的成本上限（美元）。超了就中止 —— 这是"防跑飞"的硬闸。
    /** Custom system prompt that replaces the default system prompt */
    // 译：替换默认 system prompt 的自定义 prompt。
    customSystemPrompt?: string
    /** Additional system prompt appended after the main system prompt */
    // 译：在主 system prompt 之后追加的额外 system prompt。
    // 注：★ 这两个字段的区别极其重要，很多人配错：
    //       customSystemPrompt  → **替换**（模型不再知道自己是 Claude Code，工具说明还在）
    //       appendSystemPrompt  → **追加**（保留默认行为，再加你的要求）
    //     想做"加一条团队规范"就用 append；想做"完全换人格"才用 custom。
    appendSystemPrompt?: string
    /** Override querySource for analytics tracking */
    // 译：覆盖 querySource（用于埋点统计）。
    querySource?: QuerySource
    /** Optional callback to get the latest tools (e.g., after MCP servers connect mid-query) */
    // 译：可选回调，用于拿到最新的工具表（例如 MCP 服务器在一次查询进行到一半时连上了）。
    // 注：★ 这是个"缓存失效"补丁。options.tools 是查询开始时的快照；
    //     如果跑到一半 MCP 连上了新工具，快照里没有。工具需要最新列表时调这个函数，
    //     而不是直接读 options.tools。
    refreshTools?: () => Tools
  }
  // ── ② 中断与文件状态 ──
  abortController: AbortController
  // 注：★ 唯一的中断信号源。所有耗时操作都必须监听它的 signal，否则用户按 Esc 停不下来。
  //     它也承载"中断的原因"（signal.reason === 'interrupt' 表示用户敲了新消息），
  //     StreamingToolExecutor.ts:223 靠这个 reason 区分"用户打断"与"其它中止"。
  readFileState: FileStateCache
  // 注：文件内容缓存（LRU）。Read 用它做"文件变了吗"的判断，Edit 用它做并发冲突检测。
  //     注意它是 LRU —— 会被淘汰，所以不能拿它当"我做过这件事"的凭证
  //     （这正是 loadedNestedMemoryPaths 存在的理由，见第 216-222 行注释）。

  // ── ③ 全局状态读写：注意是**函数式**更新 ──
  getAppState(): AppState
  setAppState(f: (prev: AppState) => AppState): void
  // 注：★ 签名是 `(prev) => next`，不是 `(next)`。和 React 的 setState 同一个理由：
  //     多个工具并发跑时，读-改-写会互相覆盖；传函数则由 store 串行应用。
  //     这条约束在并发场景下是**正确性**问题，不是风格问题。
  /**
   * Always-shared setAppState for session-scoped infrastructure (background
   * tasks, session hooks). Unlike setAppState, which is no-op for async agents
   * (see createSubagentContext), this always reaches the root store so agents
   * at any nesting depth can register/clean up infrastructure that outlives
   * a single turn. Only set by createSubagentContext; main-thread contexts
   * fall back to setAppState.
   */
  // 译：用于会话级基础设施（后台任务、会话 hook）的"永远共享"版 setAppState。
  //     与 setAppState 不同（对异步代理是空操作，见 createSubagentContext），
  //     这个函数永远能到达根 store，因此任意嵌套深度的代理都能注册/清理那些
  //     "活得比单轮对话更久"的基础设施。只由 createSubagentContext 设置；
  //     主线程的 context 会回退到 setAppState。
  // 注：★★ 这是全文信息量最大的注释之一，它承认了一个设计缺陷及其补丁：
  //     异步子代理的 setAppState 被故意做成 no-op（因为子代理不该改父级 UI 状态），
  //     结果导致「子代理启动一个后台任务、想把句柄注册到全局」这个合法需求做不到。
  //     于是补了第二条通道：只允许操作"会话级基础设施"，不允许碰普通 UI 状态。
  //     读法：看到 `setAppStateForTasks ?? setAppState` 这种写法，就是这条补丁的痕迹。
  setAppStateForTasks?: (f: (prev: AppState) => AppState) => void
  /**
   * Optional handler for URL elicitations triggered by tool call errors (-32042).
   * In print/SDK mode, this delegates to structuredIO.handleElicitation.
   * In REPL mode, this is undefined and the queue-based UI path is used.
   */
  // 译：可选处理器，用于工具调用错误触发的 URL 型 elicitation（-32042）。
  //     在 print/SDK 模式下去交给 structuredIO.handleElicitation；
  //     在 REPL 模式下它是 undefined，改用基于队列的 UI 路径。
  // 注：又是"两种环境两条路"的典型：同一个需求（让用户去网页授权），
  //     管道模式走结构化 IO（能被程序解析），终端模式走 UI 队列（能弹框）。
  //     工具里写这段代码时必须分支，不能假设只有一种存在。
  handleElicitation?: (
    serverName: string,
    params: ElicitRequestURLParams,
    signal: AbortSignal,
  ) => Promise<ElicitResult>

  // ── ④ 向外的四条通知通道：按"侵入性"从强到弱 ──
  setToolJSX?: SetToolJSXFn
  // 注：最强 —— 直接往终端里塞一整块自定义 React UI（交互式选择器、todo 面板）。
  addNotification?: (notif: Notification) => void
  // 注：次强 —— 应用内的提示条，会自动消失。
  /** Append a UI-only system message to the REPL message list. Stripped at the
   *  normalizeMessagesForAPI boundary — the Exclude<> makes that type-enforced. */
  // 译：往 REPL 的消息列表追加一条**仅 UI 可见**的系统消息。在
  //     normalizeMessagesForAPI 边界处被剥离 —— 那个 Exclude<> 让这件事在类型层面被强制。
  // 注：★ 这个 Exclude<SystemMessage, SystemLocalCommandMessage> 是个很漂亮的技巧：
  //     它把"不能发给 API 的那一类消息"从参数类型里**排除掉**，
  //     于是"误把本地命令输出发给模型"这件事在编译期就不可能发生。
  //     比写文档提醒"记得过滤"可靠得多 —— 这是类型系统当约束用的正面例子。
  appendSystemMessage?: (
    msg: Exclude<SystemMessage, SystemLocalCommandMessage>,
  ) => void
  /** Send an OS-level notification (iTerm2, Kitty, Ghostty, bell, etc.) */
  // 译：发送操作系统级通知（iTerm2、Kitty、Ghostty、响铃等）。
  // 注：最弱（也最有用）—— 任务跑完时提醒你切回来。终端不支持时降级成响铃。
  sendOSNotification?: (opts: {
    message: string
    notificationType: string
  }) => void

  // ── ⑤ 四个"本会话已经做过没有"的去重集合 ──
  //    它们的共同问题：同一份内容被反复注入进上下文，白烧 token。
  //    解法都是"记下已做过的标识"，但标识物各不相同。
  nestedMemoryAttachmentTriggers?: Set<string>
  // 注：记录"哪些触发条件已经触发过嵌套记忆注入"。
  /**
   * CLAUDE.md paths already injected as nested_memory attachments this
   * session. Dedup for memoryFilesToAttachments — readFileState is an LRU
   * that evicts entries in busy sessions, so its .has() check alone can
   * re-inject the same CLAUDE.md dozens of times.
   */
  // 译：本会话已经作为 nested_memory 附件注入过的 CLAUDE.md 路径。用于
  //     memoryFilesToAttachments 去重 —— readFileState 是 LRU，在繁忙会话里会淘汰条目，
  //     所以仅靠它的 .has() 检查，同一份 CLAUDE.md 可能被重复注入几十次。
  // 注：★★ 这段注释记录了一个真实事故：**用错了缓存当去重表**。
  //     LRU 的本职是"省内存"，它的淘汰是特性不是 bug；拿它当"做过了吗"的账本，
  //     一旦被淘汰就会重做。于是在外面加一层永不过期的 Set。
  //     教训：**缓存 ≠ 去重表**。缓存可以丢，去重表不能丢。
  loadedNestedMemoryPaths?: Set<string>
  dynamicSkillDirTriggers?: Set<string>
  // 注：动态技能目录的触发记录（.claude/skills 里按需加载的技能）。
  /** Skill names surfaced via skill_discovery this session. Telemetry only (feeds was_discovered). */
  // 译：本会话通过 skill_discovery 露出过的技能名。**仅用于埋点**（喂给 was_discovered 指标）。
  // 注："Telemetry only" 这四个字值得注意 —— 它是唯一一个不影响行为的集合，
  //     删掉只会丢指标，不会改变功能。这类字段在排障时可以先忽略。
  discoveredSkillNames?: Set<string>
  userModified?: boolean
  // 注：用户在权限对话框里**手动改过参数**。工具可以据此调整行为
  //     （比如 Edit 发现用户改了 old_string，就不要再说"我改好了"）。

  // ── ⑥ 进度与状态回传：UI 靠这些函数知道"现在在干什么" ──
  setInProgressToolUseIDs: (f: (prev: Set<string>) => Set<string>) => void
  // 注：维护"正在执行的工具调用 id 集合"。UI 据此决定哪些块显示转圈。
  //     同样是函数式更新 —— 因为多个工具会并发进来。
  /** Only wired in interactive (REPL) contexts; SDK/QueryEngine don't set this. */
  // 译：只在交互式（REPL）上下文里接线；SDK/QueryEngine 不设置它。
  // 注：它的用途是让 UI 知道"当前有没有可以被打断的工具"，从而决定 Esc 该不该有反应。
  setHasInterruptibleToolInProgress?: (v: boolean) => void
  setResponseLength: (f: (prev: number) => number) => void
  // 注：累计本轮输出的字符数，用于界面上那个"已输出 N tokens"的估计。
  /** Ant-only: push a new API metrics entry for OTPS tracking.
   *  Called by subagent streaming when a new API request starts. */
  // 译：仅限 Anthropic 内部：为 OTPS 追踪推入一条新的 API 指标记录。
  //     由子代理的流式输出在每次新 API 请求开始时调用。
  // 注："Ant-only" = Anthropic 员工专用功能，外部构建里这行不会被执行。
  pushApiMetricsEntry?: (ttftMs: number) => void
  setStreamMode?: (mode: SpinnerMode) => void
  // 注：切换转圈样式（思考中 / 执行中 / 等待用户…）。纯视觉。
  onCompactProgress?: (event: CompactProgressEvent) => void
  // 注：压缩过程的进度出口（见第 150 行的三个事件）。
  setSDKStatus?: (status: SDKStatus) => void
  // 注：向 SDK 消费者汇报状态（idle / running / error）。
  openMessageSelector?: () => void
  // 注：打开"消息选择器"（回退到某条历史消息）。只有 REPL 有。
  updateFileHistoryState: (
    updater: (prev: FileHistoryState) => FileHistoryState,
  ) => void
  updateAttributionState: (
    updater: (prev: AttributionState) => AttributionState,
  ) => void
  // 注：这两个是**必填**（没有 `?`），因为 Edit / Write 这类工具无条件需要它们记账。
  //     对比上面那些可选的回调：必填 = 核心能力，可选 = 界面能力。
  setConversationId?: (id: UUID) => void
  // 注：切换当前会话 id（/clear 之后会换一个）。用于把消息归到正确的会话下。

  // ── ⑦ 会话身份：工具要知道"我正在替谁干活" ──
  agentId?: AgentId // Only set for subagents; use getSessionId() for session ID. Hooks use this to distinguish subagent calls.
  // 译：仅当处于子代理中时才设置；会话 id 请用 getSessionId()。hook 用它区分"这是子代理的调用"。
  // 注：★ 这个字段是**区分主线程与子代理的唯一可靠标记**。
  //     hook 里想"只拦子代理"或"只拦主线程"，就看它有没有值。
  //     千万别用 agentType 判断 —— 主线程也可以有 --agent 类型。
  agentType?: string // Subagent type name. For the main thread's --agent type, hooks fall back to getMainThreadAgentType().
  // 译：子代理的类型名。对于主线程的 --agent 类型，hook 应回退到 getMainThreadAgentType()。
  // 注：上面那行注释就是在提醒你别踩这个坑（我上面的注和作者的注释撞了，说明这坑真有人踩）。
  /** When true, canUseTool must always be called even when hooks auto-approve.
   *  Used by speculation for overlay file path rewriting. */
  // 译：为 true 时，即使 hook 已自动放行，也必须调用 canUseTool。
  //     用于"推测执行"（speculation）时的 overlay 文件路径改写。
  // 注：这是一个逃生阀：hook 自动放行通常可以跳过问人，但推测执行必须让 canUseTool
  //     走一遍（因为要在那里改写路径）。用布尔开关而不是新机制，成本最低。
  requireCanUseTool?: boolean

  // ── ⑧ 资源限制与决策记录 ──
  messages: Message[]
  // 注：★ 工具能读到**整段对话历史**。这是很多工具的前提：
  //     AgentTool 要把上文摘要给子代理；compact 相关的工具要数 token；
  //     BashTool 的某些判断要看用户之前说过什么。
  //     代价：工具可以"看见"一切，所以工具的权限等于会话的权限 —— 这是安全模型的基础假设。
  fileReadingLimits?: {
    maxTokens?: number
    maxSizeBytes?: number
  }
  // 注：读文件的上限。默认值在 constants 里，但调用方可以收紧
  //     （比如主对话给 25k token，子代理可能给更少，避免一个代理吃掉整个上下文）。
  globLimits?: {
    maxResults?: number
  }
  // 注：Glob 的条数上限。同样可被调用方收紧。
  toolDecisions?: Map<
    string,
    {
      source: string
      decision: 'accept' | 'reject'
      timestamp: number
    }
  >
  // 注：工具调用 id → "这次是谁批的、批了还是拒了、什么时候"。
  //     用途：UI 上显示"已通过 rule xxx 自动批准"，以及排障时回答
  //     "这条命令到底是谁放行的"。toolExecution.ts:1171 就是读它来结束"等用户"的计时。
  queryTracking?: QueryChainTracking
  /** Callback factory for requesting interactive prompts from the user.
   * Returns a prompt callback bound to the given source name.
   * Only available in interactive (REPL) contexts. */
  // 译：用于向用户请求交互式输入的工厂函数。返回一个绑定到给定 source 名的
  //     prompt 回调。仅在交互式（REPL）上下文中可用。
  // 注：★ 注意是"工厂"（返回函数）而不是"函数"。
  //     为什么要两层？因为"这次请求是谁发起的"（sourceName）要在建连时就绑定，
  //     而"问什么"（PromptRequest）要等到真正要问的时候才能确定。
  //     两层结构让调用方可以先把回调传来传去，最后才填问题。
  requestPrompt?: (
    sourceName: string,
    toolInputSummary?: string | null,
  ) => (request: PromptRequest) => Promise<PromptResponse>
  toolUseId?: string
  // 注：本次调用的 id。工具在发进度、发通知时要把这个 id 带上，
  //     UI 才知道这条进度属于哪个工具块。toolExecution.ts:1211 会覆盖进 context。
  criticalSystemReminder_EXPERIMENTAL?: string
  // 注：一条会被"强调"的系统提醒（实验特性）。后缀大写的 EXPERIMENTAL 是作者的自我警告：
  //     这个名字随时可能改，别在别的模块里依赖它。
  /** When true, preserve toolUseResult on messages even for subagents.
   * Used by in-process teammates whose transcripts are viewable by the user. */
  // 译：为 true 时，即使是子代理也保留消息上的 toolUseResult。
  //     用于"进程内队友"这种转录可被用户查看的场景。
  // 注：默认子代理会丢掉 toolUseResult（为了省内存/省 token），
  //     但"队友"的对话用户可能点开看，所以需要留。
  preserveToolUseResults?: boolean

  // ── ⑨ 缓存与预算：两个"为性能而存在"的字段 ──
  /** Local denial tracking state for async subagents whose setAppState is a
   *  no-op. Without this, the denial counter never accumulates and the
   *  fallback-to-prompting threshold is never reached. Mutable — the
   *  permissions code updates it in place. */
  // 译：供那些 setAppState 是空操作的异步子代理使用的**本地**拒绝计数状态。
  //     没有它，拒绝计数永远不会累加，"回退到弹框"的阈值也就永远达不到。可变 ——
  //     权限代码会就地更新它。
  // 注：★★ 又一处"设计缺陷的补丁"，而且作者写得很直白：
  //     计数本来存在全局 store 里，子代理写不进去 → 于是计数永远是 0
  //     → "连续拒 3 次就改成直接问人"的安全阀永远不触发。
  //     注意最后一句"Mutable — 就地更新"是**故意违反**函数式更新的：
  //     因为这个对象根本不在 store 里，没有并发保护的必要（每个子代理独享）。
  localDenialTracking?: DenialTrackingState
  /**
   * Per-conversation-thread content replacement state for the tool result
   * budget. When present, query.ts applies the aggregate tool result budget.
   * Main thread: REPL provisions once (never resets — stale UUID keys
   * are inert). Subagents: createSubagentContext clones the parent's state
   * by default (cache-sharing forks need identical decisions), or
   * resumeAgentBackground threads one reconstructed from sidechain records.
   */
  // 译：按"对话线程"划分的工具结果预算替换状态。存在时，query.ts 会施加
  //     聚合的工具结果预算。主线程：REPL 只创建一次（永不清空 —— 过期的 UUID 键是惰性的）。
  //     子代理：createSubagentContext 默认克隆父级的（共享缓存的 fork 必须做出一致的决定），
  //     或者 resumeAgentBackground 从 sidechain 记录里重建一个。
  // 注：★★ 这里藏着一个非常具体的正确性要求："共享缓存的 fork 必须做出一致的决定"。
  //     意思是：如果父级决定"把第 5 个工具结果替换成占位符"，克隆出来的子代理必须
  //     做**完全相同**的替换，否则两边发给 API 的字节不一样，prompt 缓存直接失效。
  //     所以这个状态不是"性能优化"，是"缓存正确性"的一部分。共享缓存 = 共享决定。
  contentReplacementState?: ContentReplacementState
  /**
   * Parent's rendered system prompt bytes, frozen at turn start.
   * Used by fork subagents to share the parent's prompt cache — re-calling
   * getSystemPrompt() at fork-spawn time can diverge (GrowthBook cold→warm)
   * and bust the cache. See forkSubagent.ts.
   */
  // 译：父级已渲染的 system prompt 字节，在轮次开始时冻结。
  //     供 fork 出来的子代理共享父级的 prompt 缓存 —— 在 fork 时重新调用
  //     getSystemPrompt() 可能得到不同结果（GrowthBook 从冷到热），从而击穿缓存。
  //     见 forkSubagent.ts。
  // 注：★★ 这段注释记录了一次非常隐蔽的性能事故：
  //     同样的 getSystemPrompt() 调用，在 GrowthBook 功能开关"预热"前后返回不同字节。
  //     于是 fork 时重新算一次 → 字节变了 → 整个 prefix 缓存作废 → 成本翻倍。
  //     解法不是"别重算"，而是**把结果冻结下来传过去**。
  //     教训：凡是"渲染一次就该固定"的东西，都要在入口处快照，别在深处重算。
  renderedSystemPrompt?: SystemPrompt
}

// ── 9. 进度与结果：工具和世界之间的三种返回值 ────────────────────────────────
//
// 一个工具在执行过程中/执行完之后，能往外送三样**性质完全不同**的东西：
//
//   ① 进度（ToolProgress）     执行中，可以被丢弃，不影响正确性
//   ② 结果（ToolResult.data）  执行后，唯一的"返回值"
//   ③ 插话（ToolResult.newMessages） 执行后，往对话里追加消息（不只是返回结果！）
//
// 这个三分法是理解工具系统的关键。尤其是 ③：工具不只是"函数"，它还能改变对话本身。

// Re-export ToolProgressData from centralized location
// 译：从集中位置重新导出 ToolProgressData。
export type { ToolProgressData }

export type Progress = ToolProgressData | HookProgress
// 注：★ 注意这个联合里混进了 HookProgress —— hook 的进度和工具的进度走**同一条通道**。
//     这不是设计得漂亮，是复用管道的现实结果：两者都要在"某个工具正在跑"的时候显示。
//     所以下一步必须把它们重新分开（见下面的 filter 函数）。

export type ToolProgress<P extends ToolProgressData> = {
  toolUseID: string
  data: P
}
// 注：只有两个字段 ——"哪次调用" + "载荷"。
//     toolUseID 是必需的，因为一批工具可能并发跑，UI 靠它把进度贴到正确的块上。

export function filterToolProgressMessages(
  progressMessagesForMessage: ProgressMessage[],
): ProgressMessage<ToolProgressData>[] {
  return progressMessagesForMessage.filter(
    // 注：`(msg): msg is ProgressMessage<ToolProgressData>` 是**类型谓词**（type predicate）。
    //     它同时干两件事：运行时返回布尔值决定留不留，编译期告诉 TS"过滤后这个联合窄化成哪个"。
    //     没有它，返回类型就得写成 as 断言，等于放弃了检查。
    //     写法模板：`(x): x is Narrow => 判断条件`
    (msg): msg is ProgressMessage<ToolProgressData> =>
      msg.data?.type !== 'hook_progress',
  )
}
// 注：★ 这个 6 行小函数是整个文件里唯一一处"运行时的清洗逻辑"，值得单独说：
//
//     为什么必须剔掉 hook 进度？因为渲染层是这么用的：
//       renderToolUseProgressMessage(progressMessagesForMessage, ...)
//     它假定每条 message 都是自己那个工具的进度（形如 BashProgress），
//     于是在里面直接读 `p.data.stdout`。如果混进一条 hook_progress，
//     读出来是 undefined，轻则显示错，重则崩。
//
//     所以过滤点选在**渲染入口**，而不是在写入时。这符合一条通用原则：
//     数据通道可以混，但**消费端必须显式声明自己要什么**。
//     调用点：GroupedToolUseContent.tsx:48、UserToolErrorMessage.tsx:86、UserToolRejectMessage.tsx（同批）。
//     也就是说四个渲染组件各自独立过滤了一遍 —— 有点重复，但至少不会漏。

export type ToolResult<T> = {
  data: T
  newMessages?: (
    | UserMessage
    | AssistantMessage
    | AttachmentMessage
    | SystemMessage
  )[]
  // 注：★ 工具的"插话权"。工具除了返回 data，还能往对话里塞任意消息。
  //     谁在用？toolExecution.ts:1566 把它们逐条 append 到结果后面。
  //     典型场景：AgentTool —— 子代理跑完，它把子代理的整段对话（含中间工具调用）
  //     作为 newMessages 塞进来，这样主对话里能看到子代理"干了什么"，
  //     而不是只看到一句"子代理返回了 xxx"。
  //     代价：工具可以伪造任意角色的消息。这是权限模型里最需要信任的一环。
  // contextModifier is only honored for tools that aren't concurrency safe.
  // 译：contextModifier 只对**非并发安全**的工具有效。
  // 注：★ 这句英文注释是全文最容易被忽略、后果最严重的一句。
  //     原因：并发安全的工具会**同时**跑，如果它们都能改共享 context，
  //     改的顺序就不确定了（A 改了 cwd，B 还在按旧 cwd 算路径）。
  //     所以只有串行执行的工具才允许返回 modifier。
  //     验证点：StreamingToolExecutor.ts:391 —— `if (!tool.isConcurrencySafe && contextModifiers.length > 0)`，
  //     非并发安全时才逐个 apply；并发批次里即使返回了也白返回。
  //     踩坑表现：工具返回了 contextModifier 却"没生效"，且不报错。
  contextModifier?: (context: ToolUseContext) => ToolUseContext
  /** MCP protocol metadata (structuredContent, _meta) to pass through to SDK consumers */
  // 译：MCP 协议元数据（structuredContent、_meta），透传给 SDK 消费者。
  // 注：MCP 工具可以返回"给模型看的文本"和"给程序看的结构化数据"两份。
  //     这个字段让后者不被丢掉（否则 SDK 用户只能解析文本，等于退化）。
  mcpMeta?: {
    _meta?: Record<string, unknown>
    structuredContent?: Record<string, unknown>
  }
}

export type ToolCallProgress<P extends ToolProgressData = ToolProgressData> = (
  progress: ToolProgress<P>,
) => void
// 注：就是 call() 的第 5 个参数 onProgress 的类型。别名单独抽出来，
//     是为了让工具实现里能写 `onProgress?: ToolCallProgress<BashProgress>`
//     而不用把整个函数签名抄一遍。

// ── 10. AnyObject 与两个查找函数 ────────────────────────────────────────────
//
// 这三个东西是"工具注册表"的最小 API。名字查找看似简单，但因为**别名**的存在而变复杂：
// 工具改名后旧名字要能用（比如某个工具从 TodoWrite 改成 TaskCreate）。

// Type for any schema that outputs an object with string keys
// 译：任何"输出一个字符串键对象"的 schema 的类型。
export type AnyObject = z.ZodType<{ [key: string]: unknown }>
// 注：这是 Tool 的 Input 泛型约束。为什么约束成"字符串键的对象"？
//     因为 API 的工具参数必须是 JSON object，数组/字符串都不行。
//     这个约束把"工具参数不能是数组"这条协议要求，变成了编译期错误。

/**
 * Checks if a tool matches the given name (primary name or alias).
 */
// 译：检查一个工具是否匹配给定的名字（主名或别名）。
// 注：注意第一个参数的类型是**结构化的** `{ name: string; aliases?: string[] }`，
//     而不是 `Tool`。这叫"按需声明"（structural typing 的正面用法）：
//     调用方只要有这两个字段就能用，不需要造一个完整的 Tool 出来。
//     测试里 mock 一个工具时，这个签名能省掉 90% 的样板代码。
export function toolMatchesName(
  tool: { name: string; aliases?: string[] },
  name: string,
): boolean {
  return tool.name === name || (tool.aliases?.includes(name) ?? false)
  // 注：`?? false` 是必需的 —— `aliases?.includes()` 在 aliases 为 undefined 时返回 undefined，
  //     而 `a || undefined` 会让整个表达式的类型变成 `boolean | undefined`，
  //     在 `if (toolMatchesName(...))` 里虽然能用，但别处赋给 boolean 就报错。
}

/**
 * Finds a tool by name or alias from a list of tools.
 */
// 译：从工具列表里按名字或别名找出一个工具。
// 注：返回 `Tool | undefined`，且是**线性 find**。
//     工具数量在几十的量级，线性查找完全够；不要以为这是个性能瓶颈。
//     真正的问题是"名字冲突"：两个工具同名时，这里返回第一个，**不报错**。
//     所以 tools.ts 的 getAllBaseTools() 里要人工保证名字唯一（那是唯一真相来源）。
export function findToolByName(tools: Tools, name: string): Tool | undefined {
  return tools.find(t => toolMatchesName(t, name))
}

// ── 11. Tool 类型本体（第 362-695 行，334 行）────────────────────────────────
//
// ★ 下面这一大段是全文件的正文。它**不是按重要性排序的**，而是历史堆积的结果：
//   核心的 call/description 在前面，渲染相关的七八个方法堆在后面。
//
//   所以读法建议：不要顺着读，按「一个工具的一生」那个十二步表来读。
//   为了好找，我在每组成员前加了小标题（生命周期的作用见表格）。
//
//   另外先记住两个数量事实：
//     · 必填方法 14 个   call / description / inputSchema / isConcurrencySafe /
//                        isEnabled / isReadOnly / checkPermissions / prompt /
//                        userFacingName / toAutoClassifierInput /
//                        mapToolResultToToolResultBlockParam / renderToolUseMessage /
//                        name / maxResultSizeChars
//     · 可选方法 22 个   其余全部带 `?`
//   写一个新工具时，只要实现那 14 个就能跑（其余有默认行为或干脆不显示）。

export type Tool<
  Input extends AnyObject = AnyObject,
  Output = unknown,
  P extends ToolProgressData = ToolProgressData,
> = {
  // 注：↑ 三个泛型都有默认值 = AnyObject / unknown / ToolProgressData。
  //     所以 `Tool` 和 `Tool<AnyObject, unknown, ToolProgressData>` 等价。
  //     `Tools = readonly Tool[]`（第 701 行）用的就是这个"无参数"形态 —— 工具列表里
  //     每个工具的参数类型都不同，只能用最宽的类型装起来，取出来用时再 safeParse。
  //     这也解释了为什么 partitionToolCalls 里必须先 `inputSchema.safeParse` 才能调
  //     isConcurrencySafe：**类型信息在放进列表的那一刻就丢了**，只能靠运行时 schema 找回来。

  // ── A. 身份与检索：模型和代码怎么"找到"这个工具 ──
  /**
   * Optional aliases for backwards compatibility when a tool is renamed.
   * The tool can be looked up by any of these names in addition to its primary name.
   */
  // 译：可选的别名，用于工具改名后的向后兼容。除了主名之外，工具还可以用这些名字被找到。
  // 注：别名解决的是"历史包袱"问题：用户的 hooks 里写了 `"Bash(git *)"`、
  //     权限规则里写了旧工具名、脚本里硬编码了工具名 —— 改名不能一夜之间全废。
  //     查找路径：toolMatchesName()（第 348 行）同时比主名和别名。
  aliases?: string[]
  /**
   * One-line capability phrase used by ToolSearch for keyword matching.
   * Helps the model find this tool via keyword search when it's deferred.
   * 3–10 words, no trailing period.
   * Prefer terms not already in the tool name (e.g. 'jupyter' for NotebookEdit).
   */
  // 译：一句能力短语，供 ToolSearch 做关键词匹配。当这个工具被"延迟加载"时，
  //     帮助模型通过关键词搜到它。3-10 个词，句末不加句号。
  //     优先用工具名里没出现过的词（例如给 NotebookEdit 用 'jupyter'）。
  // 注：★ 这是一条很实用的提示词工程经验，不是随手写的：
  //     ToolSearch 是靠**关键词**检索的。如果每个工具的 searchHint 都只是把名字拆一遍
  //     （Bash → "bash shell"），那检索等于没做。所以要补"用户会怎么说"的词：
  //     用户想编辑 notebook 时会搜 "jupyter"，不会搜 "NotebookEdit"。
  //     同源调用点：utils/toolSearch.ts:350。
  searchHint?: string

  // ── B. 执行：整个类型里唯一"干活"的方法 ──
  call(
    args: z.infer<Input>,
    context: ToolUseContext,
    canUseTool: CanUseToolFn,
    parentMessage: AssistantMessage,
    onProgress?: ToolCallProgress<P>,
  ): Promise<ToolResult<Output>>
  // 注：★ 五个参数，每一个都有明确的不可替代性：
  //
  //   1. args      已经过 zod 校验的输入（**不是模型原始 JSON**）。
  //                上游 toolExecution.ts:615 做过 safeParse，所以这里拿到的一定合法。
  //                这也意味着：工具里不需要再校验类型，只需要校验**业务规则**。
  //
  //   2. context   46 字段的执行环境（上一节）。
  //
  //   3. canUseTool ★ 这个参数最容易误解。它**不是**"工具给自己问权限"用的 ——
  //                实测：没有一个工具在自己的 call() 里调它。
  //                5 个工具直接把它命名成 _canUseTool（下划线 = 我不需要）。
  //                它真正的用途是**往下传**：AgentTool / SendMessageTool / SkillTool
  //                要把这个函数递给子代理的 runAgent()，因为子代理执行工具时也要过权限关。
  //                也就是说，它是"权限能力"的传递链，不是"权限请求"。
  //                为什么不做进 context？因为 context 是"环境"，而它是"能力凭证"；
  //                子代理 context 的其余字段会被改写，唯独这个必须原样透传。
  //
  //   4. parentMessage ★ 触发这次工具调用的那条**助手消息**。
  //                为什么工具需要它？为了给"副作用"找到归属锚点。真实用例：
  //                  FileEditTool.ts:438     parentMessage.uuid 记进文件历史（哪条消息改了这个文件）
  //                  BashTool.tsx:393        同上，用于 /rewind 回到某条消息时还原文件
  //                所以它是"可回溯性"的基础设施，不是给渲染用的。
  //
  //   5. onProgress 进度回调。不传就表示"我不关心进度"，工具内部所有
  //                onProgress?.(...) 自动变成空操作。所以工具实现里一律写 `onProgress?.()`。
  //
  //   返回 Promise<ToolResult<Output>>：注意是 ToolResult 包一层，不是直接 Output。
  //   因为要顺便带上 newMessages / contextModifier / mcpMeta（见第 9 节）。

  // ── C. 给"人"看的一句话说明（不是给模型看的！）───────────────────────
  description(
    input: z.infer<Input>,
    options: {
      isNonInteractiveSession: boolean
      toolPermissionContext: ToolPermissionContext
      tools: Tools
    },
  ): Promise<string>
  // 注：★★ 这是全文件最容易搞混的一对方法之一。`description()` 和后面的 `prompt()`
  //     **都是"说明文本"，但读者完全不同**：
  //
  //       prompt()       → 给**模型**看。它就是 API 请求里那个 `description` 字段（utils/api.ts:171）。
  //                        所以它长、详细、带大量规则与示例。
  //       description()  → 给**人**看。实测只有两个调用点：
  //                          hooks/useCanUseTool.tsx:56        权限对话框里"这个工具要干什么"
  //                          components/mcp/MCPToolDetailView.tsx:70  MCP 工具详情页
  //                        所以它必须短、是人话、能带着**具体参数**说清后果。
  //
  //     为什么 description 要收 toolPermissionContext？
  //     因为同一句"要执行 rm -rf /tmp/x"，在 bypass 模式下该说"将直接执行"，
  //     在 default 模式下该说"将请求你批准"。说明文本要跟着权限语境变。
  //
  //     返回值是 Promise<string> 而不是 string —— 因为有些工具要读文件/查配置才能说出
  //     "这个操作影响什么"（比如 Edit 要算出 diff 行数）。

  // ── D. 参数契约：三份 schema，各有各的消费者 ──
  readonly inputSchema: Input
  // 注：zod schema。三个地方要用它，所以必须是**运行时值**而不是类型：
  //     ① 上游校验   toolExecution.ts:615 `inputSchema.safeParse(input)`
  //     ② 转 API     utils/api.ts:160      `zodToJsonSchema(tool.inputSchema)`
  //     ③ 分组判断   toolOrchestration.ts:97 先 parse 才能调 isConcurrencySafe(input)
  //     `readonly` 是必须的：运行时被换掉会导致"校验用一套、序列化用另一套"。
  // Type for MCP tools that can specify their input schema directly in JSON Schema format
  // rather than converting from Zod schema
  // 译：给 MCP 工具用的类型 —— 它们可以直接用 JSON Schema 格式指定输入 schema，
  // 而不是从 Zod schema 转换。
  readonly inputJSONSchema?: ToolInputJSONSchema
  // Optional because TungstenTool doesn't define this. TODO: Make it required.
  // When we do that, we can also go through and make this a bit more type-safe.
  // 译：可选，因为 TungstenTool 没有定义它。TODO：把它改成必填。
  // 到那时我们也可以顺手把这里做得更类型安全一些。
  // 注：★★ 这一小段 TODO 暴露了"返回值类型"这块的设计债，值得单独说：
  //     没有 outputSchema，Output 泛型就只能是 `unknown`，
  //     于是所有 mapToolResultToToolResultBlockParam(content: Output) 的实现里
  //     content 都是 unknown，每个工具都得自己 as 断言。
  //     "TungstenTool" 是内部代号（钨），说明是某个内部工具拖住了改造。
  outputSchema?: z.ZodType<unknown>
  inputsEquivalent?(a: z.infer<Input>, b: z.infer<Input>): boolean
  // 注：判断"两份参数是不是同一个操作"。唯一调用点：
  //     hooks/toolPermission/PermissionContext.ts:309
  //       `? !tool.inputsEquivalent(input, updatedInput)`
  //     场景：hook 返回了一个 updatedInput，如果它和原参数**等价**，
  //     就不必让用户重新批准一次（否则每次 hook 格式化一下参数都要重弹框）。
  //     实现建议：按业务语义比，不比 JSON 字符串（键顺序不同会导致误判不等）。

  // ── E. 并发与安全：四个布尔方法，决定"能不能同时跑、要不要问人" ──
  isConcurrencySafe(input: z.infer<Input>): boolean
  // 注：★ 唯一一个"按参数决定"的并发标记 —— 因为同一个工具的行为可能差很远：
  //     BashTool 的 `ls` 可以并发，`rm` 不行；Read 并发安全，Write 不安全。
  //     三个调用点，其中前两个是并发的**唯一**判据：
  //       toolOrchestration.ts:101     把连续的安全调用并成一批（并发跑）
  //       StreamingToolExecutor.ts:108 流式执行时判断能否立刻起跑
  //       StreamingToolExecutor.ts:391 决定 contextModifier 是否被采纳
  //     ★ 实现要求：绝不能抛异常。toolOrchestration.ts:102-106 虽然 catch 了并
  //       当作"不安全"处理，但那是兜底，不是许可。
  isEnabled(): boolean
  // 注：注意**没有参数**。它是静态的"这个工具在当前构建/配置下存不存在"，
  //     不是"这次调用能不能做"（那个是 validateInput 的活）。
  //     典型用途：feature flag 关掉某个实验工具、平台不支持时返回 false（如 PowerShellTool 在非 Windows）。
  isReadOnly(input: z.infer<Input>): boolean
  // 注：两种用途，别混：
  //     ① 权限层：只读工具在很多模式下可以直接放行（plan 模式只允许只读）
  //     ② 界面层：连续多个只读调用会被折叠成一行（collapseReadSearch.ts 就靠类似的判断）
  //     实测调用点里 `isReadOnly({})` 这种空参调用存在（print.ts:1660），
  //     所以实现要能容忍 input 缺字段 —— 见下面 isDestructive 的坑。
  /** Defaults to false. Only set when the tool performs irreversible operations (delete, overwrite, send). */
  // 译：默认 false。只在这个工具会执行不可逆操作（删除、覆盖、发送）时才设置。
  // 注：★ 这个字段名很容易让人以为"它是安全机制"，其实**它不是**。
  //     真正的安全闸是 permissions.ts（规则 + 模式 + 分类器）。
  //     isDestructive 只影响**展示**（UI 上打个 [destructive] 标记），
  //     不影响任何执行决策 —— 全库搜不到一个 `if (tool.isDestructive(...))` 的控制流。
  //     ★★ 而且它现在实际上是坏的，见开头"关键事实 2"：
  //     三个外部调用点全部传 `{}`（print.ts:1661、MCPToolListView.tsx:62、MCPToolDetailView.tsx:48），
  //     而 ExitWorktreeTool.ts:168 的实现读 `input.action` → 永远 undefined → 永远 false。
  isDestructive?(input: z.infer<Input>): boolean
  /**
   * What should happen when the user submits a new message while this tool
   * is running.
   *
   * - `'cancel'` — stop the tool and discard its result
   * - `'block'`  — keep running; the new message waits
   *
   * Defaults to `'block'` when not implemented.
   */
  // 译：当这个工具正在运行时，用户提交了新消息，应该怎么办。
  //
  // - `'cancel'` —— 停止这个工具，并丢弃它的结果
  // - `'block'`  —— 继续运行；新消息等着
  //
  // 不实现时默认 `'block'`。
  // 注：★ 这是一个"用户体验 vs 一致性"的取舍点，默认值选得很对：
  //     默认 block = 不打断。因为大多数工具（读文件、跑测试）被打断的代价是
  //     "白跑一遍"，而用户随手补一句话的意图往往不是"停下"，是"补充说明"。
  //     只有明确知道"停下来更安全"的工具才声明 cancel —— 实测例子是 SleepTool
  //     （sleep 没意义地跑下去纯浪费），注释在 utils/handlePromptSubmit.ts:320。
  //     兜底行为：StreamingToolExecutor.ts:235 `if (!definition?.interruptBehavior) return 'block'`
  //     —— 注释里写了默认值，代码里也再兜一次。两处都写，是因为这里错了会让 Esc 失灵。
  interruptBehavior?(): 'cancel' | 'block'

  // ── F. 界面提示类：不影响执行，只影响"怎么显示" ──
  /**
   * Returns information about whether this tool use is a search or read operation
   * that should be collapsed into a condensed display in the UI. Examples include
   * file searching (Grep, Glob), file reading (Read), and bash commands like find,
   * grep, wc, etc.
   *
   * Returns an object indicating whether the operation is a search or read operation:
   * - `isSearch: true` for search operations (grep, find, glob patterns)
   * - `isRead: true` for read operations (cat, head, tail, file read)
   * - `isList: true` for directory-listing operations (ls, tree, du)
   * - All can be false if the operation shouldn't be collapsed
   */
  // 译：返回这个工具调用是否为"搜索或读取"操作的信息 —— 这类操作在 UI 里
  //     应该被折叠成一行紧凑显示。例子包括文件搜索（Grep、Glob）、文件读取（Read），
  //     以及 find / grep / wc 这样的 bash 命令。
  //
  // 返回一个对象，标明是搜索还是读取操作：
  // - `isSearch: true` 表示搜索操作（grep、find、glob 模式）
  // - `isRead: true`   表示读取操作（cat、head、tail、读文件）
  // - `isList: true`   表示列目录操作（ls、tree、du）
  // - 三者都为 false 表示这个操作不该被折叠
  // 注：★ 这个方法的"三个布尔"设计很值得学：它没有返回一个枚举
  //     （'search' | 'read' | 'list' | 'none'），而是三个独立布尔。
  //     为什么？因为 BashTool 里 `find . -name '*.ts' | xargs wc -l` 同时是
  //     **搜索 + 读取**。枚举装不下，三个布尔可以同时为 true。
  //     唯一调用点：utils/collapseReadSearch.ts:216（"把连续只读调用折成一行"）。
  //     注意上游是先 safeParse 再调（同文件 :213 的注释），因为实现里要读 input。
  isSearchOrReadCommand?(input: z.infer<Input>): {
    isSearch: boolean
    isRead: boolean
    isList?: boolean
  }
  isOpenWorld?(input: z.infer<Input>): boolean
  // 注：MCP 规范里有个 "openWorldHint" 注解，意思是"这个工具会和外部世界交互"
  //     （比如发网络请求、访问第三方），也就是**结果不可预测**。
  //     用途只有两处，都是展示：
  //       cli/print.ts:1662               作为 capabilities 透传给 IDE
  //       MCPToolListView / DetailView    打一个 [open-world] 标记
  //     ★ 和 isDestructive 一样，外部调用点传的是 `{}`（空参数），
  //       所以它只对"不看参数"的实现有效。MCP 工具的实现（services/mcp/client.ts:1807）
  //       恰好就是 `return true/false` 常量，所以对它无害。
  requiresUserInteraction?(): boolean
  // 注：★ 语义不是"这个工具会弹框"，而是"**没有真人就没法工作**"。
  //     实测三个调用点，作用各不相同，但都建立在这个语义上：
  //       permissions.ts:549      `if (tool.requiresUserInteraction?.() && result.behavior === 'ask') return result`
  //                               → 直接返回 ask，**跳过"连续拒绝后降级为直接问人"的那套统计**
  //       toolHooks.ts:344          hook 自动放行时，把交互型工具当成"非交互"处理
  //                                 （注释说得很清楚：hook 本身就是那次交互）
  //       interactiveHandler.ts:319 非交互环境下不给它弹框的机会
  //     典型成员：AskUserQuestionTool、ExitPlanModeTool、EnterPlanModeTool ——
  //     这三个没有用户就真的做不下去，不是"可选地需要确认"。
  isMcp?: boolean
  // 注：不是"这个工具叫 mcp__xxx"的字符串判断，而是显式标记（因为可以关掉名字前缀，
  //     见 mcpInfo 的注释）。用例：utils/api.ts 里做 prompt 缓存分区
  //     —— MCP 工具是"每用户不同"的动态区，不能和全局可缓存区混在一起（claude.ts:1210-1214）。
  isLsp?: boolean
  // 注：LSP 工具（跳转定义、找引用）的特殊标记。用途：claude.ts:786 的
  //     shouldDeferLspTool() 会根据它决定要不要延迟加载 —— 因为 LSP 工具只在
  //     打开了大文件/多文件项目时才有用，默认不给模型看可以省几千 token。

  // ── G. 延迟加载：ToolSearch 时代最重要的两个字段 ──
  /**
   * When true, this tool is deferred (sent with defer_loading: true) and requires
   * ToolSearch to be used before it can be called.
   */
  // 译：为 true 时，这个工具被延迟加载（以 defer_loading: true 发送），
  //     必须先通过 ToolSearch 才能调用它。
  // 注：★ 这是解决"工具太多塞不进上下文"的机制，值得完整理解一遍：
  //     工具一多，光 schema 就吃掉几万 token。于是把大部分工具的**完整 schema**
  //     不发给模型，只发一行摘要；模型需要时调 ToolSearch 搜关键词，
  //     搜到了才把某个工具的完整 schema 补进去（下一轮请求才带）。
  //     代价：多一次往返。所以 shouldDefer 的判断要谨慎 ——
  //     常用工具延迟掉，等于每轮都多一次 ToolSearch。
  readonly shouldDefer?: boolean
  /**
   * When true, this tool is never deferred — its full schema appears in the
   * initial prompt even when ToolSearch is enabled. For MCP tools, set via
   * `_meta['anthropic/alwaysLoad']`. Use for tools the model must see on
   * turn 1 without a ToolSearch round-trip.
   */
  // 译：为 true 时，这个工具**永不**被延迟 —— 即使 ToolSearch 开着，
  //     它的完整 schema 也会出现在初始 prompt 里。MCP 工具通过
  //     `_meta['anthropic/alwaysLoad']` 设置。用于那些模型必须在第 1 轮就看见、
  //     不能多走一次 ToolSearch 往返的工具。
  // 注：两个字段是**互斥的双保险**（shouldDefer 说"藏起来"，alwaysLoad 说"必须露出来"）。
  //     冲突时谁赢？看 services/mcp/client.ts:1785 和 claude.ts:1209 的实现顺序，
  //     实际以"是否在 deferredToolNames 集合里"为准，alwaysLoad 决定要不要进那个集合。
  //     设计意图很明确：**保守优先**。拿不准就用 alwaysLoad，宁可多花 token 也别让模型找不到。
  readonly alwaysLoad?: boolean
  /**
   * For MCP tools: the server and tool names as received from the MCP server (unnormalized).
   * Present on all MCP tools regardless of whether `name` is prefixed (mcp__server__tool)
   * or unprefixed (CLAUDE_AGENT_SDK_MCP_NO_PREFIX mode).
   */
  // 译：对 MCP 工具而言：从 MCP 服务器收到的服务器名与工具名（**未规范化**）。
  //     无论 `name` 是否带前缀（mcp__server__tool 形式），或是否未带前缀
  //     （CLAUDE_AGENT_SDK_MCP_NO_PREFIX 模式），所有 MCP 工具都有这个字段。
  // 注：★ 这是"名字被改写"问题的标准解法：**保留原始值**。
  //     name 是给我们看的（可能加前缀防冲突、可能被截断/规范化），
  //     mcpInfo 是给服务器看的（发请求时必须用原始名，多一个字符服务器就不认）。
  //     实测用处：cli/print.ts:1658 `tool.mcpInfo?.toolName ?? tool.name`
  //     —— 对外汇报时优先用原始名。
  mcpInfo?: { serverName: string; toolName: string }
  readonly name: string
  // 注：唯一的身份标识，也是权限规则里写的那个字符串（"Bash(git *)" 的 Bash）。
  //     `readonly` 很重要：tools.ts 里有一张按名字索引的 Map，运行时改名会让它失效。

  // ── H. 结果大小：一个数字决定"落盘还是塞进上下文" ──
  /**
   * Maximum size in characters for tool result before it gets persisted to disk.
   * When exceeded, the result is saved to a file and Claude receives a preview
   * with the file path instead of the full content.
   *
   * Set to Infinity for tools whose output must never be persisted (e.g. Read,
   * where persisting creates a circular Read→file→Read loop and the tool
   * already self-bounds via its own limits).
   */
  // 译：工具结果落盘前允许的最大字符数。超过时，结果被存到文件里，
  //     Claude 收到的是一段预览加文件路径，而不是完整内容。
  //
  // 对于绝不落盘的工具设为 Infinity（例如 Read —— 落盘会造成
  // Read→文件→Read 的循环，而且这个工具本身已经用自己的上限自我约束了）。
  maxResultSizeChars: number
  // 注：★★ 全文件信息密度最高的一个字段，三层含义：
  //
  //     ① 计量单位是**字符**不是 token。因为阈值要在"还没有 tokenizer 结果"时就能判断，
  //        字符数是唯一便宜且确定的量。
  //     ② 它是"硬预算"，不是"建议"。真正施加预算的地方在 query.ts:379 的
  //        applyToolResultBudget，而且那里筛出了 Infinity 的工具名：
  //          .filter(t => !Number.isFinite(t.maxResultSizeChars))
  //        也就是说 **Infinity 是一个哨兵值**（sentinel），不是"一个很大的数字"。
  //        写成 1e9 会被当成"普通大工具"，仍然参与预算计算。
  //     ③ 注释里那个 "circular Read→file→Read loop" 是真实事故：
  //        如果 Read 的结果被落盘，模型就会 Read 到这个结果文件，又可能被落盘……
  //        指数级放大。所以"自限型工具"必须主动退出这套机制。
  //     ★ 这也是它为什么是**必填**（没有 `?`）：每个工具都必须明确表态
  //       "我的结果该不该落盘"，不能靠默认值蒙混过去。
  /**
   * When true, enables strict mode for this tool, which causes the API to
   * more strictly adhere to tool instructions and parameter schemas.
   * Only applied when the tengu_tool_pear is enabled.
   */
  // 译：为 true 时，为这个工具启用严格模式，使 API 更严格地遵守工具指令与参数 schema。
  //     仅在 tengu_tool_pear 启用时才生效。
  // 注：`tengu_tool_pear` 是 GrowthBook 的功能开关名（tengu = 天狗，Anthropic 内部代号习惯）。
  //     真正拼进请求的逻辑在 utils/api.ts:185-192，条件有四个，缺一不可：
  //       开关打开 && tool.strict === true && 有 model && 该 model 支持结构化输出
  //     ★ 注意 `=== true` 而不是真值判断 —— 因为它是 `readonly strict?: boolean`，
  //       写成 `tool.strict` 在 false 和 undefined 上行为一样，但显式比较能让
  //       "这个工具明确关掉了严格模式"和"它没表态"在阅读时区分开。
  readonly strict?: boolean

  // ── I. 三道关：观测者补全 → 业务校验 → 权限判定 ──
  //
  // 这三个方法（外加必填的 checkPermissions）构成"执行前"的全部检查。
  // 顺序在 toolExecution.ts 里是写死的，见开头表格的 ⑤⑥⑦。
  /**
   * Called on copies of tool_use input before observers see it (SDK stream,
   * transcript, canUseTool, PreToolUse/PostToolUse hooks). Mutate in place
   * to add legacy/derived fields. Must be idempotent. The original API-bound
   * input is never mutated (preserves prompt cache). Not re-applied when a
   * hook/permission returns a fresh updatedInput — those own their shape.
   */
  // 译：在**观测者**看到 tool_use 输入之前，对输入的**副本**调用这个方法
  // （观测者包括 SDK 流、转录记录、canUseTool、PreToolUse/PostToolUse hook）。
  // 就地修改以补上历史遗留字段/派生字段。必须**幂等**。与 API 绑定的原始输入
  // 永远不会被改（保护 prompt 缓存）。当 hook/权限返回了一个全新的 updatedInput 时，
  // 本方法不会再次应用 —— 那种输入的形状由它们自己负责。
  // 注：★★ 这是全文最精细的一个设计，值得逐句拆：
  //
  //     问题：某次重构后，工具的输入里少了一个字段（比如旧的 `filePath` 改成了 `file_path`），
  //     但所有外部观测者（用户的 hook、SDK 消费方、转录回放）还在读旧字段名。
  //     直接改 schema 会破坏他们；在每次读取处兼容又太散。
  //
  //     解法：在"发出观测"的前一刻，往**副本**里补上旧字段。
  //     三条纪律：
  //       ① 只改副本 → 原始输入（要发给 API 的那份字节）不动 → prompt 缓存不会失效。
  //          这是"性能约束反过来决定 API 形状"的典型例子。
  //       ② 必须幂等 → 同一份输入可能被处理两次（流式一次、落盘一次），
  //          补两次不能变成两个字段。
  //       ③ 一旦 hook 返回了**新的** updatedInput，就不再补 → 因为那是人家自己造的，
  //          它自己负责形状。强行补会覆盖掉 hook 的意图。
  //
  //     调用点：query.ts:761（流式观测前）、toolExecution.ts:785（执行前）。
  //     反面教材：如果实现里写 `input.newField = input.oldField` 而没判"已有就跳过"，
  //     就会在第二次调用时把用户手动改过的值覆盖掉。
  backfillObservableInput?(input: Record<string, unknown>): void

  /**
   * Determines if this tool is allowed to run with this input in the current context.
   * It informs the model of why the tool use failed, and does not directly display any UI.
   * @param input
   * @param context
   */
  // 译：判断在当前上下文中，这个工具是否允许用这份输入运行。
  //     它把"为什么失败"告知**模型**，不直接显示任何 UI。
  // 注：★ 关键词是 "informs the model ... does not directly display any UI"。
  //     所以它返回的 message 会变成 `tool_use_error` 塞回对话（toolExecution.ts:687 的分支之后），
  //     模型能看到并自己改正。这就是"为什么 Read 一个不存在的文件"之后模型会换个路径重试。
  //     实现要点：
  //       · 只校验**业务规则**，不校验类型（类型已被 zod 管了）
  //       · 错误信息要写"怎么改"，不只是"不行"（因为读者是模型）
  //       · errorCode 用来分类统计，别随便填
  //     实测还有两处主动调用它（不经过主流程）：utils/attachments.ts:2096、:3172 ——
  //     注入附件前先问一句"这个文件读得了吗"，避免注入一个注定失败的 tool_result。
  validateInput?(
    input: z.infer<Input>,
    context: ToolUseContext,
  ): Promise<ValidationResult>

  /**
   * Determines if the user is asked for permission. Only called after validateInput() passes.
   * General permission logic is in permissions.ts. This method contains tool-specific logic.
   * @param input
   * @param context
   */
  // 译：决定是否要向用户请求权限。**只在 validateInput() 通过之后**才调用。
  //     通用权限逻辑在 permissions.ts 里；这个方法只放工具特有的逻辑。
  // 注：★★ "通用 vs 特有"这条分界线是理解权限系统的关键：
  //     通用部分（permissions.ts，484 行的 hasPermissionsToUseTool）管：
  //       六种模式、规则表合并、目录边界、bypass 的两道闸、分类器。
  //     特有部分（这里）管"只有这个工具才知道的事"，比如：
  //       BashTool 要判断"组合命令里每一段是否都在允许列表内"
  //       FileEditTool 要判断"这个路径在不在工作目录内"
  //     ★ 注意它返回的是 PermissionResult（allow/ask/deny + updatedInput），
  //       不是布尔。为什么？因为它可以在放行时**顺手改写参数**
  //       （典型：把 `~` 展开成绝对路径、把相对路径规范化再交给 call）。
  //       这也解释了三态为什么必要：ask 表示"通用规则没结论，交给用户"。
  checkPermissions(
    input: z.infer<Input>,
    context: ToolUseContext,
  ): Promise<PermissionResult>

  // Optional method for tools that operate on a file path
  // 译：可选方法，给"操作某个文件路径"的工具用。
  // 注：★ 它的作用不是"方便显示"，而是**让路径型权限规则能套用到这个工具上**。
  //     实测五个调用点全在权限链路里：
  //       utils/permissions/filesystem.ts:1041, :1217   拿路径去匹配 Read(./src/**) 这类规则
  //       hooks/toolPermission/permissionLogging.ts:52  审计日志里记下"动了哪个文件"
  //       FilesystemPermissionRequest.tsx:12            权限对话框标题显示路径
  //     所以：如果你的工具会读写文件，**必须实现 getPath**，否则路径规则对它全失效
  //     （表现为"我明明配了只允许 ./src，它却能改整个盘"）。
  getPath?(input: z.infer<Input>): string

  /**
   * Prepare a matcher for hook `if` conditions (permission-rule patterns like
   * "git *" from "Bash(git *)"). Called once per hook-input pair; any
   * expensive parsing happens here. Returns a closure that is called per
   * hook pattern. If not implemented, only tool-name-level matching works.
   */
  // 译：为 hook 的 `if` 条件准备一个匹配器（条件形如 "Bash(git *)" 里的 "git *"，
  //     也就是权限规则的模式部分）。每个"hook-输入"对调用一次；所有耗时的解析
  //     都在这里做。返回一个闭包，它会对**每个** hook 模式各调一次。
  //     若不实现，则只能做"工具名级别"的匹配。
  // 注：★ 注意这个"一次 + N 次"的两段式设计，理由是性能：
  //     一个 PreToolUse hook 可能配了 5 条 if 条件（git *、npm *、rm *…）。
  //     如果把解析放进闭包里，一份 Bash 命令会被 shell-quote 解析 5 遍。
  //     所以拆成：**解析一次**（这里）+ **匹配多次**（返回的闭包）。
  //     唯一调用点：utils/hooks.ts:1408。
  //     ★ 为什么"不实现就只能按工具名匹配"？因为权限规则的模式（"git *"）
  //       依赖工具自己的参数语义。通用代码不知道 Bash 的 command 字段在哪、
  //       也不知道该怎么分词。这个知识只有工具自己有。
  preparePermissionMatcher?(
    input: z.infer<Input>,
  ): Promise<(pattern: string) => boolean>

  // ── J. 给模型的主说明：prompt() ──
  prompt(options: {
    getToolPermissionContext: () => Promise<ToolPermissionContext>
    tools: Tools
    agents: AgentDefinition[]
    allowedAgentTypes?: string[]
  }): Promise<string>
  // 注：★★ 这就是 API 请求里那个 `description` 字段的内容（utils/api.ts:171），
  //     也就是**模型真正读到的工具说明书**。它是必填的，而且是全类型里最长的返回值。
  //
  //     为什么是函数而不是常量字符串？因为工具说明要**跟着权限语境变**：
  //       "不要用 cat，用 Read" 这类引导，在只读模式下说法不同；
  //       某些工具在 plan 模式（只读）下要自我说明"我现在只能读"。
  //     为什么 getToolPermissionContext 是**异步**的？因为它要等
  //     AppState 就绪 / 设置加载完；拼 prompt 发生在每轮请求前，不能假设状态已同步。
  //     为什么要把 tools 和 agents 传进去？因为说明里要引用**别的工具的名字**
  //     （"用 Agent 工具而不是自己搜索"）和可用的代理类型。
  //     ★ 性能提醒：这个函数的返回值直接进 prompt，**任何不稳定输出都会击穿缓存**。
  //       源码里为此专门做了记忆化：utils/toolSchemaCache.ts:7 的注释说
  //       "tool.prompt() all cause this churn. Memoizing per-session locks the schema"。

  userFacingName(input: Partial<z.infer<Input>> | undefined): string
  // 注：★ 注意参数是 `Partial<...> | undefined` —— 三种情况都得能处理：
  //       完整输入（正常渲染） / 部分输入（参数还在流式传输中） / 根本没有（列表页）
  //     所以实现里不能 `input.file_path.split(...)`，必须先判空。
  //     实测调用点就是这么用的：MCPToolListView.tsx:59 直接传 `{}`。
  userFacingNameBackgroundColor?(
    input: Partial<z.infer<Input>> | undefined,
  ): keyof Theme | undefined
  // 注：给工具名加底色，用于视觉分组（比如所有 Bash 类的用一个色，所有文件类的用一个色）。
  //     返回的是 `keyof Theme`（颜色**键名**）而不是颜色值 —— 主题切换时自动跟随。
  //     这个"返回键名不返回值"的约定很值得学：组件不持有颜色，只持有语义。
  /**
   * Transparent wrappers (e.g. REPL) delegate all rendering to their progress
   * handler, which emits native-looking blocks for each inner tool call.
   * The wrapper itself shows nothing.
   */
  // 译：透明包装器（例如 REPL 工具）把所有渲染都委托给它的进度处理器 ——
  //     那个处理器会为每个内部工具调用发出"看起来像原生"的块。
  //     包装器自己什么都不显示。
  // 注：REPL 工具是个"能执行代码、代码里又能调工具"的套娃型工具。
  //     如果不特殊处理，界面上会出现"REPL 块里套着工具块"的双层嵌套，很难看。
  //     这个标记等于告诉渲染层："跳过外层，只画内层"。
  //     唯一调用点：AssistantToolUseMessage.tsx:79。
  isTransparentWrapper?(): boolean

  // ── K. 渲染前的一行摘要：三个"短文本"方法 ──
  //
  // 终端界面空间有限，一个工具调用往往只能占一行。所以需要工具自己给出
  // "最少的但够用的"文字。三个方法分别用于三个位置，别混。
  /**
   * Returns a short string summary of this tool use for display in compact views.
   * @param input The tool input
   * @returns A short string summary, or null to not display
   */
  // 译：返回这次工具调用的简短摘要，用于紧凑视图中显示。
  // @param input 工具输入
  // @returns 一个简短摘要字符串，或 null 表示不显示
  // 注：用在"折叠视图"（compact views）—— 多个工具调用被压在一起时，每个只留一行。
  //     返回 null 和返回空字符串在这里**语义不同**：null = 这个工具在紧凑视图里不占行，
  //     '' = 占一行但没字（会有个空占位）。实现时别随手 return ''。
  getToolUseSummary?(input: Partial<z.infer<Input>> | undefined): string | null
  /**
   * Returns a human-readable present-tense activity description for spinner display.
   * Example: "Reading src/foo.ts", "Running bun test", "Searching for pattern"
   * @param input The tool input
   * @returns Activity description string, or null to fall back to tool name
   */
  // 译：返回一句人类可读的**现在进行时**活动描述，用于转圈时的显示。
  // 例子："Reading src/foo.ts"、"Running bun test"、"Searching for pattern"
  // @param input 工具输入
  // @returns 活动描述字符串，或 null 表示回退成工具名
  // 注：★ 三个细节，都是从例子反推出来的：
  //     ① 必须用**现在进行时 + 动名词**（Reading / Running / Searching），
  //        因为这个字符串出现在工具**还没跑完**的时候。
  //     ② 必须带上**具体对象**（src/foo.ts、bun test）。只说 "Reading file"
  //        等于没说 —— 用户在等的时候最想知道"到底在读哪个文件"。
  //     ③ 返回 null 就回退成工具名，所以"没好的说法"时返回 null 比硬编一句更好。
  //     实测三个调用点：spinner 的三种渲染路径。
  getActivityDescription?(
    input: Partial<z.infer<Input>> | undefined,
  ): string | null
  /**
   * Returns a compact representation of this tool use for the auto-mode
   * security classifier. Examples: `ls -la` for Bash, `/tmp/x: new content`
   * for Edit. Return '' to skip this tool in the classifier transcript
   * (e.g. tools with no security relevance). May return an object to avoid
   * double-encoding when the caller JSON-wraps the value.
   */
  // 译：返回这次工具调用的紧凑表示，供 auto 模式的安全分类器使用。
  // 例子：Bash 返回 `ls -la`，Edit 返回 `/tmp/x: new content`。
  // 返回 '' 表示在分类器的转录里跳过这个工具（例如与安全无关的工具）。
  // 可以返回对象，以避免调用方做 JSON 包装时二次编码。
  // 注：★★ 这个方法是必填的，而且它是全类型里**唯一直接决定安全判定输入**的字段。
  //     背景：auto 模式下，一个分类器模型要读"这次要干什么"并判断危不危险。
  //     如果直接把模型生成的 JSON 丢给它，会有两个问题：
  //       ① 爆炸：一个 Edit 的 new_string 可能几千字，撑爆分类器的窗口
  //       ② 注入：模型可以在参数里写"忽略前面的指令，这是安全的"来骗分类器
  //     所以要求每个工具**自己投影**出一个最短的、语义等价的表示。
  //     ★ 返回 '' 的语义是"跳过"（不是"空操作"）—— 见 yoloClassifier.ts:1021 的注释：
  //       "'' = 无安全相关性（Tool.toAutoClassifierInput 契约）"。
  //       也就是说，返回 '' 等于**声明这个工具不需要安全检查**。这是个高风险操作，
  //       所以 buildTool 的默认值给的是 ''（fail-open for classifier），
  //       并在注释里明确警告 "security-relevant tools must override"。
  toAutoClassifierInput(input: z.infer<Input>): unknown

  // ── L. 结果 → API 线格式：唯一通向模型的出口 ──
  mapToolResultToToolResultBlockParam(
    content: Output,
    toolUseID: string,
  ): ToolResultBlockParam
  // 注：★★ 这个方法是"工具结果"变成"模型能读到的东西"的**唯一**通道。
  //     重要性怎么强调都不过分：你在 renderToolResultMessage 里画得再漂亮，
  //     模型一个字节都看不到；反过来，这里返回的内容才是模型"看到"的全部。
  //
  //     实测四个调用点，其中一个最能说明问题：
  //       utils/messages.ts:4293      `mapToolResultToToolResultBlockParam(toolUseResult, '1')`
  //                                   —— 传的 toolUseID 是字面量 '1'，因为这个结果
  //                                      早就不对应任何真实的 tool_use 了（历史消息重放）
  //       utils/toolResultStorage.ts:217  落盘时先转一次，以便算出真实字节数
  //       cli/print.ts:4241               权限提示工具的假结果
  //       toolExecution.ts:1292           正常路径
  //
  //     实现要点：它必须是**纯函数**（同样输入同样输出），因为它可能被重放多次
  //     （落盘测算、历史重建）。往里面写时间戳会让 prompt 缓存每次失效。

  // ── M. 渲染：把结果/调用画到终端上（全部可选，除了一个）──
  //
  // 这一大段有 9 个 render* 方法。看起来吓人，其实可以按"画什么"分成三组：
  //   画调用：renderToolUseMessage（必填）/ renderToolUseTag / renderToolUseQueuedMessage
  //   画过程：renderToolUseProgressMessage / renderGroupedToolUse
  //   画结果：renderToolResultMessage / renderToolUseRejectedMessage / renderToolUseErrorMessage
  //          + isResultTruncated / extractSearchText（两个查询函数，配合上面用）
  //
  // ★ 为什么只有 renderToolUseMessage 是必填？
  //   因为工具调用**一出现就得画**——哪怕参数还在流式传输（所以它的 input 是 Partial）。
  //   而结果可以不画（工具可能在别处呈现），所以 renderToolResultMessage 是可选的。
  /**
   * Optional. When omitted, the tool result renders nothing (same as returning
   * null). Omit for tools whose results are surfaced elsewhere (e.g., TodoWrite
   * updates the todo panel, not the transcript).
   */
  // 译：可选。省略时，工具结果不渲染任何东西（等同于返回 null）。
  //     对于结果在别处呈现的工具可以省略（例如 TodoWrite —— 它更新的是待办面板，
  //     而不是对话转录）。
  // 注：TodoWrite 这个例子很典型：它的"结果"是一条待办列表，画在侧边面板里，
  //     如果在转录里再画一遍，就是重复信息、白占屏幕。
  renderToolResultMessage?(
    content: Output,
    progressMessagesForMessage: ProgressMessage<P>[],
    options: {
      style?: 'condensed'
      theme: ThemeName
      tools: Tools
      verbose: boolean
      isTranscriptMode?: boolean
      isBriefOnly?: boolean
      /** Original tool_use input, when available. Useful for compact result
       * summaries that reference what was requested (e.g. "Sent to #foo"). */
      // 译：原始 tool_use 输入（如果有的话）。用于那些需要引用"当初要求了什么"
      // 的紧凑结果摘要（例如 "Sent to #foo"）。
      // 注：注意它是 `unknown` 而不是 `z.infer<Input>` —— 因为是"原始输入"，
      //     可能来自历史消息、可能没经过 zod（旧版本格式）。用 unknown 逼你判空/收窄。
      //     这也解释了为什么它通过 options 传而不是单独参数：
      //     它是个"锦上添花"的附加信息，不该污染主签名。
      input?: unknown
    },
  ): React.ReactNode
  /**
   * Flattened text of what renderToolResultMessage shows IN TRANSCRIPT
   * MODE (verbose=true, isTranscriptMode=true). For transcript search
   * indexing: the index counts occurrences in this string, the highlight
   * overlay scans the actual screen buffer. For count ≡ highlight, this
   * must return the text that ends up visible — not the model-facing
   * serialization from mapToolResultToToolResultBlockParam (which adds
   * system-reminders, persisted-output wrappers).
   *
   * Chrome can be skipped (under-count is fine). "Found 3 files in 12ms"
   * isn't worth indexing. Phantoms are not fine — text that's claimed
   * here but doesn't render is a count≠highlight bug.
   *
   * Optional: omitted → field-name heuristic in transcriptSearch.ts.
   * Drift caught by test/utils/transcriptSearch.renderFidelity.test.tsx
   * which renders sample outputs and flags text that's indexed-but-not-
   * rendered (phantom) or rendered-but-not-indexed (under-count warning).
   */
  // 译：在**转录模式**（verbose=true、isTranscriptMode=true）下，
  //     renderToolResultMessage 所显示内容的**扁平化文本**。用于转录搜索的索引：
  //     索引统计这个字符串里出现的次数，而高亮层扫描的是实际屏幕缓冲区。
  //     为了让"计数 ≡ 高亮"，它必须返回**最终可见**的文本 ——
  //     而不是 mapToolResultToToolResultBlockParam 那份面向模型的序列化结果
  //     （那份会额外加上 system-reminder、落盘包装）。[译注：≡ 意为"相等"]
  //
  //     装饰性的东西可以跳过（少算一点没关系）。"Found 3 files in 12ms"
  //     这种不值得进索引。但**幻影**不行 —— 在这里声称有、实际却没渲染出来的文本，
  //     就是"计数≠高亮"的 bug。
  //
  //     可选：省略时，走 transcriptSearch.ts 里的"字段名启发式"。
  //     偏差由 test/utils/transcriptSearch.renderFidelity.test.tsx 捕获 ——
  //     它渲染样例输出，并标记出"进了索引但没渲染"（幻影）
  //     或"渲染了但没进索引"（少算警告）的文本。
  // 注：★★ 这段注释是全文最"工程味"的一段，它定义了一个**双向一致性契约**：
  //       索引里出现的，屏幕上必须能看到（否则高亮会指向空白 → 幻影）
  //       屏幕上看到的，索引里应该出现（否则搜不到 → 少算）
  //     而且作者明确说"少算可接受、幻影不可接受"—— 因为少算只是搜不到，
  //     幻影是搜索跳到一个不存在的位置，用户会以为界面坏了。
  //     ★ 还有一个易错点它专门点了出来：**不要复用 mapToolResultToToolResultBlockParam**。
  //       那个方法的输出多了 system-reminder 和落盘包装，是给模型的，不是给人看的。
  //       "同一个结果，两种读者，两份文本" —— 混用就会得到计数≠高亮。
  extractSearchText?(out: Output): string
  /**
   * Render the tool use message. Note that `input` is partial because we render
   * the message as soon as possible, possibly before tool parameters have fully
   * streamed in.
   */
  // 译：渲染"工具调用"这条消息。注意 `input` 是**部分**的，因为我们会尽可能早地
  //     渲染这条消息 —— 可能在工具参数还没完全流进来的时候就渲染了。
  // 注：★ 这条注释解释了一个必填方法的签名为什么这么"不方便"：
  //     `Partial<z.infer<Input>>` 意味着每个字段都可能 undefined。
  //     如果你在实现里写 `input.command!.startsWith('git')`，就会在流式过程中崩。
  //     正确写法：`input.command?.startsWith('git') ?? false`，或者给个占位符。
  //     实测崩过的后果：整个界面白屏（渲染异常会冒泡到 React 根）。
  renderToolUseMessage(
    input: Partial<z.infer<Input>>,
    options: { theme: ThemeName; verbose: boolean; commands?: Command[] },
  ): React.ReactNode
  /**
   * Returns true when the non-verbose rendering of this output is truncated
   * (i.e., clicking to expand would reveal more content). Gates
   * click-to-expand in fullscreen — only messages where verbose actually
   * shows more get a hover/click affordance. Unset means never truncated.
   */
  // 译：当这个输出的**非 verbose 渲染**被截断时返回 true（即点击展开能看到更多内容）。
  //     它控制全屏模式下的"点击展开"：只有那些 verbose 真的能看到更多内容的消
  //     才能获得悬停/点击提示。不实现表示"永不截断"。
  // 注：★ 这是个很细的 UX 修正：早期大概是"所有结果都能点开"，
  //     结果用户点了一堆展开后什么都没变（因为本来就全显示了），体验很糟。
  //     于是加了这个"能不能展开"的判定。
  //     ★ 为什么默认是 false（"永不截断"）而不是 true？因为**误报比漏报更烦**：
  //       声称能展开却展不开，用户会反复点；反过来只是少了几个可点的提示。
  isResultTruncated?(output: Output): boolean
  /**
   * Renders an optional tag to display after the tool use message.
   * Used for additional metadata like timeout, model, resume ID, etc.
   * Returns null to not display anything.
   */
  // 译：渲染一个可选的标签，显示在工具调用消息之后。
  //     用于附加元数据，比如超时时间、模型、resume ID 等。返回 null 表示不显示。
  // 注：和 getToolUseSummary 的分工：那个是"替换掉整行的摘要"，
  //     这个是"在主消息后面加个尾巴"。两个都在，是因为不同工具需要不同粒度。
  renderToolUseTag?(input: Partial<z.infer<Input>>): React.ReactNode
  /**
   * Optional. When omitted, no progress UI is shown while the tool runs.
   */
  // 译：可选。省略时，工具运行期间不显示任何进度 UI。
  // 注：★ 这是"进度"这条链路的最后一环：工具调 onProgress?.() → 生成 ProgressMessage
  //     → 过滤掉 hook_progress（第 312 行）→ 交给这里渲染。
  //     注意 options 里有 terminalSize —— 因为进度条要按终端宽度算能画多少格子。
  //     还有 inProgressToolCallCount —— 并发跑多个工具时，要显示"3 个中的一个"。
  renderToolUseProgressMessage?(
    progressMessagesForMessage: ProgressMessage<P>[],
    options: {
      tools: Tools
      verbose: boolean
      terminalSize?: { columns: number; rows: number }
      inProgressToolCallCount?: number
      isTranscriptMode?: boolean
    },
  ): React.ReactNode
  renderToolUseQueuedMessage?(): React.ReactNode
  // 注：没有参数 —— 因为"排队中"这个状态不需要任何上下文。
  //     这也是唯一一个"零信息"的渲染方法，说明它的作用只是占位/安抚。
  /**
   * Optional. When omitted, falls back to <FallbackToolUseRejectedMessage />.
   * Only define this for tools that need custom rejection UI (e.g., file edits
   * that show the rejected diff).
   */
  // 译：可选。省略时回退到 <FallbackToolUseRejectedMessage />。
  //     只有需要自定义"被拒"界面的工具才定义它（例如文件编辑 —— 要显示被拒的那个 diff）。
  // 注：★ "被拒"的默认界面只是一句"用户拒绝了"。对 Edit 来说这远远不够 ——
  //     用户拒绝是因为看到了某段 diff 不满意，所以他需要**再看一眼那段 diff** 才能决定
  //     怎么改。这就是"默认能兜底、特例才定制"的正确用法。
  renderToolUseRejectedMessage?(
    input: z.infer<Input>,
    options: {
      columns: number
      messages: Message[]
      style?: 'condensed'
      theme: ThemeName
      tools: Tools
      verbose: boolean
      progressMessagesForMessage: ProgressMessage<P>[]
      isTranscriptMode?: boolean
    },
  ): React.ReactNode
  /**
   * Optional. When omitted, falls back to <FallbackToolUseErrorMessage />.
   * Only define this for tools that need custom error UI (e.g., search tools
   * that show "File not found" instead of the raw error).
   */
  // 译：可选。省略时回退到 <FallbackToolUseErrorMessage />。
  //     只有需要自定义错误界面的工具才定义它（例如搜索工具 ——
  //     显示 "File not found" 而不是原始报错）。
  // 注：注意它收的是 `ToolResultBlockParam['content']` —— **已经转换过的线格式**，
  //     不是 Output。因为错误可能是"根本没执行到 call()"产生的（校验失败、权限拒绝），
  //     那种情况下压根没有 Output 可给。
  renderToolUseErrorMessage?(
    result: ToolResultBlockParam['content'],
    options: {
      progressMessagesForMessage: ProgressMessage<P>[]
      tools: Tools
      verbose: boolean
      isTranscriptMode?: boolean
    },
  ): React.ReactNode

  /**
   * Renders multiple parallel instances of this tool as a group.
   * @returns React node to render, or null to fall back to individual rendering
   */
  // 译：把这个工具的多个并行实例作为一个组来渲染。
  // @returns 要渲染的 React 节点，或 null 表示回退到逐个渲染
  // 注：★ 注意这里**连着两段 JSDoc**（上面这段 + 下面那段）。原文如此，不是笔误。
  //     对比一下措辞就知道原因：上一段说的是"parallel instances"（并行实例），
  //     下一段补充了"non-verbose mode only / In verbose mode, individual tool uses
  //     render at their original positions"（只在非 verbose 模式；verbose 模式下
  //     各自在原位置渲染）。说明后续改动时**新增了一段注释而没删旧的**。
  //     这类"注释堆积"在打包/泄露的源码里很常见，可以当"这里改过"的线索。
  /**
   * Renders multiple tool uses as a group (non-verbose mode only).
   * In verbose mode, individual tool uses render at their original positions.
   * @returns React node to render, or null to fall back to individual rendering
   */
  // 译：把多个工具调用作为一个组来渲染（**仅非 verbose 模式**）。
  //     在 verbose 模式下，每个工具调用都在它原本的位置各自渲染。
  // @returns 要渲染的 React 节点，或 null 表示回退到逐个渲染
  // 注：为什么 verbose 模式下不能分组？因为 verbose 的语义就是"按时间顺序完整记录"，
  //     而分组会把并发发生的调用挪到一起，破坏时间线。这是一个典型的
  //     "同一个开关影响多处渲染"的例子。
  //     ★ 返回 null 表示"我不处理，你按老的逐个画" —— 这个可空返回值是**渐进增强**的
  //       标准做法：先让所有工具都能跑，再逐个工具优化渲染。
  renderGroupedToolUse?(
    toolUses: Array<{
      param: ToolUseBlockParam
      isResolved: boolean
      isError: boolean
      isInProgress: boolean
      progressMessages: ProgressMessage<P>[]
      result?: {
        param: ToolResultBlockParam
        output: unknown
      }
    }>,
    options: {
      shouldAnimate: boolean
      tools: Tools
    },
  ): React.ReactNode | null
}

// ── 12. Tools：为什么不直接用 Tool[] ─────────────────────────────────────────
//
// 就一句话，但作者专门为它写了个类型别名 + 注释。理由在注释里：
// 想让"工具集在哪里被组装、传递、过滤"在代码里可搜索。
// 搜 `Tools`（大写开头）能定位所有"一群工具"的流转点，而搜 `Tool[]` 什么也找不到。
//
// ★ readonly 是**行为约束**而不是提醒：工具表在运行中被就地修改（push/splice）
//   几乎必然导致"某个已经发出的请求用的工具表和现在不一致"。
/**
 * A collection of tools. Use this type instead of `Tool[]` to make it easier
 * to track where tool sets are assembled, passed, and filtered across the codebase.
 */
// 译：一组工具的集合。请用这个类型而不是 `Tool[]`，这样可以更容易地
//     在整个代码库里追踪工具集是在哪里被组装、传递和过滤的。
export type Tools = readonly Tool[]

// ── 13. buildTool 三件套：让"写一个工具"不必实现 22 个可选方法 ──────────────
//
// 背景：Tool 有 14 个必填 + 22 个可选。大多数人写新工具时，只想实现 call + 渲染，
// 不想为 isEnabled/isReadOnly/toAutoClassifierInput 各写一个三行函数。
//
// 但"省略"必须安全：不能因为没写 isConcurrencySafe 就默认它能并发（那会出并发 bug）。
// 所以设计成三步：
//   ① DefaultableToolKeys  列出"允许省略"的 7 个方法
//   ② ToolDef              把 Tool 里这 7 个变成可选（调用方视角）
//   ③ BuiltTool + buildTool 运行时补默认值，并把类型也算准（返回方视角）
//
// ★ 为什么只有 7 个可默认？因为剩下 15 个**没法给出安全默认值**：
//   call、description、prompt、inputSchema、name、maxResultSizeChars 是本质信息，
//   渲染方法是可选本来就不需要默认，checkPermissions 之外的权限方法都影响安全。
/**
 * Methods that `buildTool` supplies a default for. A `ToolDef` may omit these;
 * the resulting `Tool` always has them.
 */
// 译：`buildTool` 会为其提供默认值的方法。`ToolDef` 可以省略这些；
//     而产出的 `Tool` 总是有它们。
type DefaultableToolKeys =
  | 'isEnabled'
  | 'isConcurrencySafe'
  | 'isReadOnly'
  | 'isDestructive'
  | 'checkPermissions'
  | 'toAutoClassifierInput'
  | 'userFacingName'
// 注：注意这 7 个名字**同时**用在两个地方（下面 ToolDef 和 BuiltTool），
//     所以新增一个可默认方法只需改这一处。这是"单一真相"的正确做法。
//     但有个代价：它是字符串字面量联合，拼错不会被 TS 抓（因为都是合法字符串），
//     只能靠 `Pick<Tool, ...>` 里的约束来兜 —— 如果写了 Tool 里不存在的键，Pick 会报错。

/**
 * Tool definition accepted by `buildTool`. Same shape as `Tool` but with the
 * defaultable methods optional — `buildTool` fills them in so callers always
 * see a complete `Tool`.
 */
// 译：`buildTool` 接受的工具定义。形状与 `Tool` 相同，但那些"可默认的方法"变成可选
//     —— `buildTool` 会把它们补上，因此调用方看到的始终是一个完整的 `Tool`。
export type ToolDef<
  Input extends AnyObject = AnyObject,
  Output = unknown,
  P extends ToolProgressData = ToolProgressData,
> = Omit<Tool<Input, Output, P>, DefaultableToolKeys> &
  Partial<Pick<Tool<Input, Output, P>, DefaultableToolKeys>>
// 注：★ 这是 TS 里"部分字段可选化"的标准配方，值得背下来：
//       Omit<T, K> & Partial<Pick<T, K>>
//     读法："把 K 这些键先从 T 里摘掉，再把它们以可选的形式贴回来"。
//     为什么不用别的写法？因为 `Partial<T>` 会把**所有**字段变可选（包括必填的 call），
//     那样就失去了"call 必须实现"的约束。
//     ★ 注意它和 `satisfies Tool` 的区别（这是本项目最容易混淆的一对）：
//       `const x = {...} satisfies Tool`  → 立即校验形状，且保留字面量类型
//       `buildTool({...})`                → 允许省略 7 个方法，返回 BuiltTool<D>
//     实测：40 处用 buildTool，剩下的核心工具（BashTool / FileEditTool / AgentTool /
//     AskUserQuestionTool / 计划模式工具…）仍是手写 satisfies Tool。

/**
 * Type-level spread mirroring `{ ...TOOL_DEFAULTS, ...def }`. For each
 * defaultable key: if D provides it (required), D's type wins; if D omits
 * it or has it optional (inherited from Partial<> in the constraint), the
 * default fills in. All other keys come from D verbatim — preserving arity,
 * optional presence, and literal types exactly as `satisfies Tool` did.
 */
// 译：类型层面的"展开运算"，对应运行时的 `{ ...TOOL_DEFAULTS, ...def }`。
//     对每个可默认的键：如果 D 提供了它（且是必填的），用 D 的类型；
//     如果 D 省略了它、或它是可选的（由约束里的 Partial<> 继承而来），就填默认值的类型。
//     其他所有键原样来自 D —— 完整保留参数个数、可选性，以及字面量类型，
//     和 `satisfies Tool` 的效果完全一致。
// 注：★★ 这段注释在解释一件很硬的事：**运行时的对象展开，在类型层面要手工镜像一遍**。
//     TS 不会因为你写了 `{...a, ...b}` 就自动算出正确的交叉类型（尤其当 b 的字段是可选时：
//     `{...{x: 1}, ...{x?: number}}` 的类型是 `{x: number}` 还是 `{x: number|undefined}`？
//     运行时是后者，TS 的朴素推断是前者）。所以用条件类型手动补齐。
type BuiltTool<D> = Omit<D, DefaultableToolKeys> & {
  [K in DefaultableToolKeys]-?: K extends keyof D
    ? undefined extends D[K]
      ? ToolDefaults[K]
      : D[K]
    : ToolDefaults[K]
}
// 注：逐层拆开这三行条件类型：
//     `[K in DefaultableToolKeys]-?`   遍历 7 个键，`-?` 表示**去掉可选性**（结果里必存在）
//     `K extends keyof D ?`            D 里有这个键吗？
//       有 → `undefined extends D[K] ?` 它的类型允许 undefined 吗？（= 调用方没提供）
//              允许 → 用 ToolDefaults[K]（默认值的类型）
//              不允许 → 用 D[K]（调用方提供的类型，原样保留）
//       没有 → 用 ToolDefaults[K]
//     ★ 关键在中间那层 `undefined extends D[K]`：它判断的不是"键存不存在"，
//       而是"值的类型里有没有 undefined"。所以 `userFacingName: () => ''` 和
//       `userFacingName?: () => string` 会走进不同分支 —— 前者保留，后者被默认值覆盖。
//       这个细节决定了"显式传了默认值"和"没传"在类型上能被区分开。

/**
 * Build a complete `Tool` from a partial definition, filling in safe defaults
 * for the commonly-stubbed methods. All tool exports should go through this so
 * that defaults live in one place and callers never need `?.() ?? default`.
 *
 * Defaults (fail-closed where it matters):
 * - `isEnabled` → `true`
 * - `isConcurrencySafe` → `false` (assume not safe)
 * - `isReadOnly` → `false` (assume writes)
 * - `isDestructive` → `false`
 * - `checkPermissions` → `{ behavior: 'allow', updatedInput }` (defer to general permission system)
 * - `toAutoClassifierInput` → `''` (skip classifier — security-relevant tools must override)
 * - `userFacingName` → `name`
 */
// 译：从一个"部分定义"构建出完整的 `Tool`，为那些常被敷衍的方法填上安全默认值。
//     所有工具的导出都应该走这里，这样默认值只存在一处，调用方永远不需要写
//     `?.() ?? default`。
//
// 默认值（在要紧的地方采用 fail-closed 即"默认拒绝/保守"）：
// - `isEnabled` → `true`
// - `isConcurrencySafe` → `false`（假定不安全）
// - `isReadOnly` → `false`（假定会写）
// - `isDestructive` → `false`
// - `checkPermissions` → `{ behavior: 'allow', updatedInput }`（交给通用权限系统）
// - `toAutoClassifierInput` → `''`（跳过分类器 —— 与安全相关的工具必须覆盖它）
// - `userFacingName` → `name`
// 注：★★ 这七条默认值里，有**一条违反了它自己声明的 fail-closed 原则**：
//
//       isConcurrencySafe → false   ✅ 保守（不并发 → 串行 → 慢但安全）
//       isReadOnly        → false   ✅ 保守（不假设只读 → 会走权限询问）
//       isDestructive     → false   ⚠️ 不保守（少报危险操作）
//       checkPermissions  → allow   ✅ 安全（通用系统仍会跑，见下）
//       toAutoClassifierInput → ''  ❌ **fail-open**：'' 的契约是"跳过分类器"
//
//     最后一条是真正的隐患：忘写这个方法的工具，在 auto 模式下**不会被安全分类器看过**。
//     作者显然知道，所以注释里加了"security-relevant tools must override"。
//     但"靠注释约束"终究不如"默认给一个保守值"。
//     如果想改，正确做法是让默认值抛错或返回完整参数（让分类器看到全部信息，宁可慢）。
//
//     另一条常被误解的是 checkPermissions → allow：它**不是绕过权限**。
//     工具自己的 checkPermissions 只是"特例判断"，通用判定在 permissions.ts 里
//     独立跑（484 行的 hasPermissionsToUseTool），所以返回 allow 的意思是
//     "我没有额外意见，按通用规则来"。这一点原文注释也点明了（defer to general
//     permission system）。
const TOOL_DEFAULTS = {
  isEnabled: () => true,
  isConcurrencySafe: (_input?: unknown) => false,
  isReadOnly: (_input?: unknown) => false,
  isDestructive: (_input?: unknown) => false,
  checkPermissions: (
    input: { [key: string]: unknown },
    _ctx?: ToolUseContext,
  ): Promise<PermissionResult> =>
    Promise.resolve({ behavior: 'allow', updatedInput: input }),
  // 注：↑ 默认实现把 input **原样**放进 updatedInput 返回。
  //     这是必须的：PermissionResult 的 updatedInput 是下游 call() 的参数来源，
  //     忘了带上就等于把参数丢了（表现为工具收到 undefined）。
  toAutoClassifierInput: (_input?: unknown) => '',
  // 注：↑ 开头"关键事实"提到的那个 fail-open 默认值。
  userFacingName: (_input?: unknown) => '',
  // 注：↑ 这个 '' 是**死代码** —— 见下面的 buildTool 实现。
}
// 注：注意这七个函数**都带可选参数**（`_input?: unknown`）。
//     为什么不按 Tool 接口的严格签名写？下面 ToolDefaults 的注释给了解释，很实在。

// The defaults type is the ACTUAL shape of TOOL_DEFAULTS (optional params so
// both 0-arg and full-arg call sites type-check — stubs varied in arity and
// tests relied on that), not the interface's strict signatures.
// 译：这个默认值的类型是 TOOL_DEFAULTS 的**实际形状**（参数是可选的，
// 以便 0 参调用和全参调用都能通过类型检查 —— 各种桩实现的参数个数不一致，
// 而测试依赖了这一点），而**不是**接口里的严格签名。
// 注：★ 这句话在坦白一个"类型欺骗"：`typeof TOOL_DEFAULTS` 和 `Tool['isReadOnly']`
//     （要求 1 个必填参数）在 TS 里是**不兼容**的。所以 BuiltTool 用 ToolDefaults[K]
//     当默认值类型时，得到的是 `(_input?: unknown) => boolean`，
//     和 Tool 要求的 `(input: z.infer<Input>) => boolean` 并不完全一致 ——
//     靠最后那个 `as BuiltTool<D>` 才圆过去。
//     为什么要容忍？因为"让 60 多个工具的测试不用改"的成本，低于"把类型做绝对严谨"。
//     这是一个有意识的取舍，而且作者把它写在了注释里 —— 这种做法值得学。
type ToolDefaults = typeof TOOL_DEFAULTS

// D infers the concrete object-literal type from the call site. The
// constraint provides contextual typing for method parameters; `any` in
// constraint position is structural and never leaks into the return type.
// BuiltTool<D> mirrors runtime `{...TOOL_DEFAULTS, ...def}` at the type level.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// 译：D 从调用点推断出具体的对象字面量类型。约束提供了方法参数的上下文类型；
//     处于约束位置的 `any` 是结构性的，不会泄漏进返回类型。
//     BuiltTool<D> 在类型层面镜像了运行时的 `{...TOOL_DEFAULTS, ...def}`。
// 注：★★ "`any` in constraint position is structural and never leaks" 这句话
//     是 TS 高级用法的一条重要经验，值得单独解释：
//
//     泛型约束 `D extends ToolDef<any, any, any>` 里的 any，**只用于**给
//     "调用方传进来的对象字面量"提供参数上下文类型（让 `input` 自动有类型），
//     它不会成为返回类型的一部分 —— 返回的是 `BuiltTool<D>`，D 是推断出来的精确类型。
//     所以 `def.name` 在返回类型里仍然是字面量 `'Bash'`，而不是 string。
//
//     这就是为什么它敢写 any 又敢在上一行加 eslint-disable：
//     这是一个"已知安全的 any 用法"，不是偷懒。
type AnyToolDef = ToolDef<any, any, any>

export function buildTool<D extends AnyToolDef>(def: D): BuiltTool<D> {
  // The runtime spread is straightforward; the `as` bridges the gap between
  // the structural-any constraint and the precise BuiltTool<D> return. The
  // type semantics are proven by the 0-error typecheck across all 60+ tools.
  // 译：运行时的对象展开很直接；那个 `as` 用来弥合"结构性 any 约束"与
  // "精确的 BuiltTool<D> 返回类型"之间的缝隙。其类型语义已由 60 多个工具的
  // 零错误类型检查证明。
  // 注：★ "proven by the 0-error typecheck across all 60+ tools" 是一句
  // "用测试代替证明"的声明 —— 这种复杂条件类型不可能在纸面上证明正确，
  // 只能靠"全量代码都能编过"来验证。作者把它写进注释，是在告诉后来者：
  // 你改这个类型时，唯一的保护就是全量 typecheck，别偷懒只编一个文件。
  // ★ 注意"60+ tools"与实测的 40 处 buildTool 调用有差距 —— 说明还有 20 多个工具
  // 是手写 satisfies Tool 的（BashTool、FileEditTool、AgentTool 等）。
  // 所以那句话里的 "across all 60+ tools" 严格说指的是"所有工具都能编过"，
  // 而不是"60 多个工具都走了 buildTool"。
  return {
    ...TOOL_DEFAULTS,
    userFacingName: () => def.name,
    ...def,
  } as BuiltTool<D>
  // 注：★★ 就是这三行。覆盖顺序从左到右，最终生效的是**最右边**：
  //
  //     ① ...TOOL_DEFAULTS            铺底（7 个默认值）
  //     ② userFacingName: () => def.name   把默认的 `() => ''` 换成"用工具名"
  //     ③ ...def                      调用方提供的覆盖一切
  //
  //     所以实际语义是：userFacingName 默认 = **工具名**，而不是 TOOL_DEFAULTS 里的 ''。
  //     中间那行让 TOOL_DEFAULTS.userFacingName 永远不生效 —— 它是死代码。
  //     这不算 bug（行为是对的），但会误导读者去 TOOL_DEFAULTS 里找"为什么名字是空"。
  //
  //     ★ 为什么 userFacingName 要特殊处理，而不是直接在 TOOL_DEFAULTS 里写死？
  //       因为 TOOL_DEFAULTS 是个**不带参数的常量对象**，它拿不到 `def.name`。
  //       只有 buildTool 的闭包里才能引用 def —— 这就是必须在展开序列中间插一行的原因。
  //       换句话说：这不是"写法随意"，而是"作用域决定了它只能在这里"。
}
