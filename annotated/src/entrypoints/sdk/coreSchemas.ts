// 文件头一句话定死了这份文件的地位：SDK 所有可序列化类型都以这里的 zod schema 为单一真相源，TS 类型是生成产物，提交进仓库只为 IDE 补全
/**
 * SDK Core Schemas - Zod schemas for serializable SDK data types.
 *
 * These schemas are the single source of truth for SDK data types.
 * TypeScript types are generated from these schemas and committed for IDE support.
 *
 * @see scripts/generate-sdk-types.ts for type generation
 */

// 必须从 zod/v4 子路径导入：v4 把 record 改成强制两参数（键类型、值类型），全文件几十处 record 调用都按 v4 口径写
import { z } from 'zod/v4'
// lazySchema 是全文骨架：每个 schema 都包成惰性工厂，模块加载期只登记不建树——既是循环引用的解药，也把冷启动成本摊到首次解析
import { lazySchema } from '../../utils/lazySchema.js'

// ============================================================================
// Usage & Model Types
// ============================================================================

// 每个模型一份用量快照：四类 token 计数（输入、输出、缓存读、缓存写）加联网搜索次数、美元成本、上下文窗口与单次最大输出
export const ModelUsageSchema = lazySchema(() =>
  z.object({
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheReadInputTokens: z.number(),
    cacheCreationInputTokens: z.number(),
    webSearchRequests: z.number(),
    costUSD: z.number(),
// costUSD 是客户端按价目表自己算出来的，服务端并不返回金额——它是估算值，不能当账单依据
    contextWindow: z.number(),
    maxOutputTokens: z.number(),
  }),
)

// 输出格式目前只有 json_schema 一种，仍留 BaseOutputFormat 抽象，是为了将来加第二个判别式时不动调用方
// ============================================================================
// Output Format Types
// ============================================================================

export const OutputFormatTypeSchema = lazySchema(() => z.literal('json_schema'))

export const BaseOutputFormatSchema = lazySchema(() =>
  z.object({
    type: OutputFormatTypeSchema(),
  }),
)

export const JsonSchemaOutputFormatSchema = lazySchema(() =>
  z.object({
    type: z.literal('json_schema'),
    schema: z.record(z.string(), z.unknown()),
  }),
)

// 这层看起来多余（唯一实现原样转发），但接入点先留住，扩展时只改这一行
export const OutputFormatSchema = lazySchema(() =>
  JsonSchemaOutputFormatSchema(),
)

// ============================================================================
// Config Types
// ============================================================================

// 凭据来源五档：用户填的、项目配的、组织下发的、临时申请的、OAuth 换来的——审计与限流都按这个分桶
export const ApiKeySourceSchema = lazySchema(() =>
  z.enum(['user', 'project', 'org', 'temporary', 'oauth']),
)

// 配置作用域只有本地、用户、项目三档，没有组织级——设置文件的层级就到项目为止
export const ConfigScopeSchema = lazySchema(() =>
  z.enum(['local', 'user', 'project']).describe('Config scope for settings.'),
)

// Beta 头锁死一个字符串字面量：这是能力协商，客户端declare之后服务端才知道可以按百万上下文处理
export const SdkBetaSchema = lazySchema(() =>
  z.literal('context-1m-2025-08-07'),
)

// 思考配置是三分支判别联合：自适应（模型自己决定何时想、想多少）、固定预算（老模型）、关闭
export const ThinkingAdaptiveSchema = lazySchema(() =>
  z
    .object({
      type: z.literal('adaptive'),
    })
    .describe('Claude decides when and how much to think (Opus 4.6+).'),
)

export const ThinkingEnabledSchema = lazySchema(() =>
  z
    .object({
      type: z.literal('enabled'),
      budgetTokens: z.number().optional(),
    })
    .describe('Fixed thinking token budget (older models)'),
)

export const ThinkingDisabledSchema = lazySchema(() =>
  z
    .object({
      type: z.literal('disabled'),
    })
    .describe('No extended thinking'),
)

// 用 union 而非 discriminatedUnion：每个分支第一字段都是 literal 的 type，zod 能靠它自动择优；下一条 describe 还写明新字段一旦设置就压过已废弃的 maxThinkingTokens
export const ThinkingConfigSchema = lazySchema(() =>
  z
    .union([
      ThinkingAdaptiveSchema(),
      ThinkingEnabledSchema(),
      ThinkingDisabledSchema(),
    ])
    .describe(
      "Controls Claude's thinking/reasoning behavior. When set, takes precedence over the deprecated maxThinkingTokens.",
    ),
)

// ============================================================================
// MCP Server Config Types (serializable only)
// ============================================================================

// stdio 的 type 标成 optional 是有意的向后兼容：老配置文件里根本不写 type，靠「有 command」推断
export const McpStdioServerConfigSchema = lazySchema(() =>
  z.object({
    type: z.literal('stdio').optional(), // Optional for backwards compatibility
    command: z.string(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
  }),
)

// SSE 在协议层已被 streamable HTTP 取代，但仍然保留——存量服务器还在跑，删掉会打断它们
export const McpSSEServerConfigSchema = lazySchema(() =>
  z.object({
    type: z.literal('sse'),
    url: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
  }),
)

// HTTP 与 SSE 字段完全同形，差别只在传输语义，所以拆成两个 schema 而不是加一个 mode 字段
export const McpHttpServerConfigSchema = lazySchema(() =>
  z.object({
    type: z.literal('http'),
    url: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
  }),
)

// sdk 类型既不启进程也不连网：服务器跑在宿主进程里靠内存通道通信，所以一份配置只需要一个名字
export const McpSdkServerConfigSchema = lazySchema(() =>
  z.object({
    type: z.literal('sdk'),
    name: z.string(),
  }),
)

// 进程传输的联合：这四种才是能写进配置的；代理类型只出现在状态响应里
export const McpServerConfigForProcessTransportSchema = lazySchema(() =>
  z.union([
    McpStdioServerConfigSchema(),
    McpSSEServerConfigSchema(),
    McpHttpServerConfigSchema(),
    McpSdkServerConfigSchema(),
  ]),
)

// claudeai-proxy 是输出专用形态：客户端能读不能写，凭据在服务端，写下来也没有意义
export const McpClaudeAIProxyServerConfigSchema = lazySchema(() =>
  z.object({
    type: z.literal('claudeai-proxy'),
    url: z.string(),
    id: z.string(),
  }),
)

// Broader config type for status responses (includes claudeai-proxy which is output-only)
// 状态响应必须宽于配置类型，否则把只读的代理形态报回来时解析就会失败——读的范围要盖住写的范围
export const McpServerStatusConfigSchema = lazySchema(() =>
  z.union([
    McpServerConfigForProcessTransportSchema(),
    McpClaudeAIProxyServerConfigSchema(),
  ]),
)

// 一个对象装齐服务器状态：连接态五档、错误消息、配置回显、作用域、工具清单、能力位
export const McpServerStatusSchema = lazySchema(() =>
  z
    .object({
      name: z.string().describe('Server name as configured'),
      status: z
        .enum(['connected', 'failed', 'needs-auth', 'pending', 'disabled'])
        .describe('Current connection status'),
      serverInfo: z
        .object({
          name: z.string(),
          version: z.string(),
        })
        .optional()
        .describe('Server information (available when connected)'),
      error: z
        .string()
        .optional()
        .describe("Error message (available when status is 'failed')"),
      config: McpServerStatusConfigSchema()
        .optional()
        .describe('Server configuration (includes URL for HTTP/SSE servers)'),
      scope: z
        .string()
        .optional()
        .describe(
          'Configuration scope (e.g., project, user, local, claudeai, managed)',
        ),
// 工具注解三态：只读、破坏性、开放世界——权限分类器的风险判断与 UI 的风险提示都读这三个布尔
      tools: z
        .array(
          z.object({
            name: z.string(),
            description: z.string().optional(),
            annotations: z
              .object({
                readOnly: z.boolean().optional(),
                destructive: z.boolean().optional(),
                openWorld: z.boolean().optional(),
              })
              .optional(),
          }),
        )
        .optional()
        .describe('Tools provided by this server (available when connected)'),
// 能力位里 experimental 是个自由记录，全文件唯一的约定是 claude/channel 这个键；设计上最巧的一处是用键的存在性当开关而不是布尔值——存在即该插件在已批准频道白名单里，据此决定要不要弹启用频道提示
      capabilities: z
        .object({
          experimental: z.record(z.string(), z.unknown()).optional(),
        })
        .optional()
        .describe(
          "@internal Server capabilities (available when connected). experimental['claude/channel'] is only present if the server's plugin is on the approved channels allowlist — use its presence to decide whether to show an Enable-channel prompt.",
        ),
    })
    .describe('Status information for an MCP server connection.'),
)

// setMcpServers 的回执分三桶：新增、移除、失败；失败桶是「服务器名到错误消息」的映射，而不是数组，便于按名取
export const McpSetServersResultSchema = lazySchema(() =>
  z
    .object({
      added: z.array(z.string()).describe('Names of servers that were added'),
      removed: z
        .array(z.string())
        .describe('Names of servers that were removed'),
      errors: z
        .record(z.string(), z.string())
        .describe(
          'Map of server names to error messages for servers that failed to connect',
        ),
    })
    .describe('Result of a setMcpServers operation.'),
)

// ============================================================================
// Permission Types
// ============================================================================

// 权限变更的落点五档：用户设置、项目设置、本地设置、仅本会话、命令行参数——决定这条规则写到哪个文件还是只活在内存
export const PermissionUpdateDestinationSchema = lazySchema(() =>
  z.enum([
    'userSettings',
    'projectSettings',
    'localSettings',
    'session',
    'cliArg',
  ]),
)

// 行为三值 allow/deny/ask。注意 ask 是「弹窗问」而不是「拒绝」，别把它当成 deny 的弱化版
export const PermissionBehaviorSchema = lazySchema(() =>
  z.enum(['allow', 'deny', 'ask']),
)

export const PermissionRuleValueSchema = lazySchema(() =>
  z.object({
    toolName: z.string(),
    ruleContent: z.string().optional(),
  }),
)

// 权限更新是判别联合，判别键是 type：增规则、换规则、删规则、设模式、加目录、删目录
export const PermissionUpdateSchema = lazySchema(() =>
  z.discriminatedUnion('type', [
// 前三种分支的三字段完全同形，仍然拆开写——为了生成出来的 TS 类型能按 type 字段自然收窄
    z.object({
      type: z.literal('addRules'),
      rules: z.array(PermissionRuleValueSchema()),
      behavior: PermissionBehaviorSchema(),
      destination: PermissionUpdateDestinationSchema(),
    }),
    z.object({
      type: z.literal('replaceRules'),
      rules: z.array(PermissionRuleValueSchema()),
      behavior: PermissionBehaviorSchema(),
      destination: PermissionUpdateDestinationSchema(),
    }),
    z.object({
      type: z.literal('removeRules'),
      rules: z.array(PermissionRuleValueSchema()),
      behavior: PermissionBehaviorSchema(),
      destination: PermissionUpdateDestinationSchema(),
    }),
    z.object({
      type: z.literal('setMode'),
// setMode 分支用 z.lazy 延迟求值 PermissionModeSchema：那个 schema 在本行之后才定义，不延迟就是 TDZ 报错
      mode: z.lazy(() => PermissionModeSchema()),
      destination: PermissionUpdateDestinationSchema(),
    }),
    z.object({
      type: z.literal('addDirectories'),
      directories: z.array(z.string()),
      destination: PermissionUpdateDestinationSchema(),
    }),
    z.object({
      type: z.literal('removeDirectories'),
      directories: z.array(z.string()),
      destination: PermissionUpdateDestinationSchema(),
    }),
  ]),
)

// 决策分类只服务遥测，三档对应临时允许、永久允许、拒绝；取值刻意与 OTel 的 tool_decision 事件词表对齐。describe 里另有一条关键约定——未设置时 CLI 保守推断，宿主不报就按临时允许算，绝不把一次性放行记成永久授权
export const PermissionDecisionClassificationSchema = lazySchema(() =>
  z
    .enum(['user_temporary', 'user_permanent', 'user_reject'])
    .describe(
      'Classification of this permission decision for telemetry. SDK hosts ' +
        'that prompt users (desktop apps, IDEs) should set this to reflect ' +
        'what actually happened: user_temporary for allow-once, user_permanent ' +
        'for always-allow (both the click and later cache hits), user_reject ' +
        'for deny. If unset, the CLI infers conservatively (temporary for ' +
        'allow, reject for deny). The vocabulary matches tool_decision OTel ' +
        'events (monitoring-usage docs).',
    ),
)

// 权限结果二选一：允许分支可回填改过的输入与新权限，拒绝分支必须带原因字符串
export const PermissionResultSchema = lazySchema(() =>
  z.union([
    z.object({
      behavior: z.literal('allow'),
      // Optional - may not be provided if hook sets permission without input modification
// updatedInput 是 optional 且注释写明理由：钩子只裁决不改写时，这个字段压根不会出现
      updatedInput: z.record(z.string(), z.unknown()).optional(),
      updatedPermissions: z.array(PermissionUpdateSchema()).optional(),
      toolUseID: z.string().optional(),
      decisionClassification:
        PermissionDecisionClassificationSchema().optional(),
    }),
// 拒绝分支的 interrupt 能直接打断当前回合——这是让钩子拥有「叫停」能力的唯一通道
    z.object({
      behavior: z.literal('deny'),
      message: z.string(),
      interrupt: z.boolean().optional(),
      toolUseID: z.string().optional(),
      decisionClassification:
        PermissionDecisionClassificationSchema().optional(),
    }),
  ]),
)

// 权限模式五档。bypassPermissions 需要显式开关配合，dontAsk 是「不问，未预批就直接拒」——两者都省弹窗，后果相反
export const PermissionModeSchema = lazySchema(() =>
  z
    .enum(['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk'])
    .describe(
      'Permission mode for controlling how tool executions are handled. ' +
        "'default' - Standard behavior, prompts for dangerous operations. " +
        "'acceptEdits' - Auto-accept file edit operations. " +
        "'bypassPermissions' - Bypass all permission checks (requires allowDangerouslySkipPermissions). " +
        "'plan' - Planning mode, no actual tool execution. " +
        "'dontAsk' - Don't prompt for permissions, deny if not pre-approved.",
    ),
)

// 下面这一整段是钩子契约，分三层：事件名清单、输入形状、输出形状

// ============================================================================
// Hook Types
// ============================================================================

// 事件名用 as const 数组暴露，既是 schema 的取值来源也是生成类型的来源——加事件只改这一处
export const HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Notification',
  'UserPromptSubmit',
  'SessionStart',
  'SessionEnd',
  'Stop',
  'StopFailure',
  'SubagentStart',
  'SubagentStop',
  'PreCompact',
  'PostCompact',
  'PermissionRequest',
  'PermissionDenied',
  'Setup',
  'TeammateIdle',
  'TaskCreated',
  'TaskCompleted',
  'Elicitation',
  'ElicitationResult',
  'ConfigChange',
  'WorktreeCreate',
  'WorktreeRemove',
  'InstructionsLoaded',
  'CwdChanged',
  'FileChanged',
] as const

// 从工具执行前到文件变更共 27 个事件，覆盖工具前后、会话起止、子代理、压缩、权限、工作树、文件监听
export const HookEventSchema = lazySchema(() => z.enum(HOOK_EVENTS))

// 所有钩子输入共享的底板：会话号、转录路径、工作目录、权限模式，外加两个子代理标识
export const BaseHookInputSchema = lazySchema(() =>
  z.object({
    session_id: z.string(),
    transcript_path: z.string(),
    cwd: z.string(),
    permission_mode: z.string().optional(),
// agent_id 的有无才是「是否在子代理里」的判据，describe 专门强调不要拿 agent_type 判断
    agent_id: z
      .string()
      .optional()
      .describe(
        'Subagent identifier. Present only when the hook fires from within a subagent ' +
          '(e.g., a tool called by an AgentTool worker). Absent for the main thread, ' +
          'even in --agent sessions. Use this field (not agent_type) to distinguish ' +
          'subagent calls from main-thread calls.',
      ),
// agent_type 两种场景都会出现：子代理里与 agent_id 并存；主线程用 agent 参数启动时则单独出现
    agent_type: z
      .string()
      .optional()
      .describe(
        'Agent type name (e.g., "general-purpose", "code-reviewer"). Present when the ' +
          'hook fires from within a subagent (alongside agent_id), or on the main thread ' +
          'of a session started with --agent (without agent_id).',
      ),
  }),
)

// Use .and() instead of .extend() to preserve BaseHookInput & {...} in generated types
// 刻意用 and 而不是 extend：生成 TS 时能保留「基础类型交叉扩展」的写法，读起来更贴近契约本意
// 工具执行前输入：工具名、原始输入、工具调用 ID——钩子据此在真正执行之前裁决或改写
export const PreToolUseHookInputSchema = lazySchema(() =>
  BaseHookInputSchema().and(
    z.object({
      hook_event_name: z.literal('PreToolUse'),
      tool_name: z.string(),
      tool_input: z.unknown(),
      tool_use_id: z.string(),
    }),
  ),
)

// 权限请求输入多带 suggestions：那是「建议授予哪些权限」的现成选项，钩子可以直接采纳而不必自己拼
export const PermissionRequestHookInputSchema = lazySchema(() =>
  BaseHookInputSchema().and(
    z.object({
      hook_event_name: z.literal('PermissionRequest'),
      tool_name: z.string(),
      tool_input: z.unknown(),
      permission_suggestions: z.array(PermissionUpdateSchema()).optional(),
    }),
  ),
)

// 执行后输入带回 tool_response，让钩子能看结果做二次加工或事后审计
export const PostToolUseHookInputSchema = lazySchema(() =>
  BaseHookInputSchema().and(
    z.object({
      hook_event_name: z.literal('PostToolUse'),
      tool_name: z.string(),
      tool_input: z.unknown(),
      tool_response: z.unknown(),
      tool_use_id: z.string(),
    }),
  ),
)

// 失败版去掉响应、加上错误文本与是否被中断——中断和真错要分开，处理策略完全不同
export const PostToolUseFailureHookInputSchema = lazySchema(() =>
  BaseHookInputSchema().and(
    z.object({
      hook_event_name: z.literal('PostToolUseFailure'),
      tool_name: z.string(),
      tool_input: z.unknown(),
      tool_use_id: z.string(),
      error: z.string(),
      is_interrupt: z.boolean().optional(),
    }),
  ),
)

// 只在拒绝之后触发，带原因字符串，可用于「用户为什么拒」的统计
export const PermissionDeniedHookInputSchema = lazySchema(() =>
  BaseHookInputSchema().and(
    z.object({
      hook_event_name: z.literal('PermissionDenied'),
      tool_name: z.string(),
      tool_input: z.unknown(),
      tool_use_id: z.string(),
      reason: z.string(),
    }),
  ),
)

// 通知事件是纯广播：消息、可选标题、通知类型，不需要任何返回值
export const NotificationHookInputSchema = lazySchema(() =>
  BaseHookInputSchema().and(
    z.object({
      hook_event_name: z.literal('Notification'),
      message: z.string(),
      title: z.string().optional(),
      notification_type: z.string(),
    }),
  ),
)

// 用户提交提示词时触发，只带提示词原文——这是往上下文里注入额外材料的常规位置
export const UserPromptSubmitHookInputSchema = lazySchema(() =>
  BaseHookInputSchema().and(
    z.object({
      hook_event_name: z.literal('UserPromptSubmit'),
      prompt: z.string(),
    }),
  ),
)

// 会话开始的 source 四值区分启动、恢复、清空重启、压缩后重启，钩子据此决定注入多少背景
export const SessionStartHookInputSchema = lazySchema(() =>
  BaseHookInputSchema().and(
    z.object({
      hook_event_name: z.literal('SessionStart'),
      source: z.enum(['startup', 'resume', 'clear', 'compact']),
      agent_type: z.string().optional(),
      model: z.string().optional(),
    }),
  ),
)

// Setup 的触发分初始化与维护两档：前者一次性，后者每次启动都跑
export const SetupHookInputSchema = lazySchema(() =>
  BaseHookInputSchema().and(
    z.object({
      hook_event_name: z.literal('Setup'),
      trigger: z.enum(['init', 'maintenance']),
    }),
  ),
)

// Stop 钩子带 stop_hook_active，用来防死循环：钩子自己再触发停止时必须能识别出这是二次进入
export const StopHookInputSchema = lazySchema(() =>
  BaseHookInputSchema().and(
    z.object({
      hook_event_name: z.literal('Stop'),
      stop_hook_active: z.boolean(),
// last_assistant_message 是给钩子的便利字段：省得它去读整份转录文件再解析最后一条消息
      last_assistant_message: z
        .string()
        .optional()
        .describe(
          'Text content of the last assistant message before stopping. ' +
            'Avoids the need to read and parse the transcript file.',
        ),
    }),
  ),
)

// StopFailure 的 error 复用了助手消息的错误枚举，保证这两处的错误词表是同一套
export const StopFailureHookInputSchema = lazySchema(() =>
  BaseHookInputSchema().and(
    z.object({
      hook_event_name: z.literal('StopFailure'),
      error: SDKAssistantMessageErrorSchema(),
      error_details: z.string().optional(),
      last_assistant_message: z.string().optional(),
    }),
  ),
)

// 子代理开始事件：此时 agent_id 与 agent_type 都必有，可直接拿去建索引
export const SubagentStartHookInputSchema = lazySchema(() =>
  BaseHookInputSchema().and(
    z.object({
      hook_event_name: z.literal('SubagentStart'),
      agent_id: z.string(),
      agent_type: z.string(),
    }),
  ),
)

// 子代理停止多带一条转录路径：每个子代理有独立转录文件，主线程那份里没有它的内容
export const SubagentStopHookInputSchema = lazySchema(() =>
  BaseHookInputSchema().and(
    z.object({
      hook_event_name: z.literal('SubagentStop'),
      stop_hook_active: z.boolean(),
      agent_id: z.string(),
      agent_transcript_path: z.string(),
      agent_type: z.string(),
      last_assistant_message: z
        .string()
        .optional()
        .describe(
          'Text content of the last assistant message before stopping. ' +
            'Avoids the need to read and parse the transcript file.',
        ),
    }),
  ),
)

// 压缩前事件带手动或自动触发与自定义指令，钩子可以在这时改写要保留什么
export const PreCompactHookInputSchema = lazySchema(() =>
  BaseHookInputSchema().and(
    z.object({
      hook_event_name: z.literal('PreCompact'),
      trigger: z.enum(['manual', 'auto']),
      custom_instructions: z.string().nullable(),
    }),
  ),
)

// 压缩后事件必须带摘要文本——没有它，下游就无从知道压缩之后还剩哪些信息
export const PostCompactHookInputSchema = lazySchema(() =>
  BaseHookInputSchema().and(
    z.object({
      hook_event_name: z.literal('PostCompact'),
      trigger: z.enum(['manual', 'auto']),
      compact_summary: z
        .string()
        .describe('The conversation summary produced by compaction'),
    }),
  ),
)

// 队友空闲事件：多代理协作里判断谁可以接下一单的信号
export const TeammateIdleHookInputSchema = lazySchema(() =>
  BaseHookInputSchema().and(
    z.object({
      hook_event_name: z.literal('TeammateIdle'),
      teammate_name: z.string(),
      team_name: z.string(),
    }),
  ),
)

// 任务创建与任务完成两个事件的字段完全同形；团队相关字段可选，因为单人任务没有队友名
export const TaskCreatedHookInputSchema = lazySchema(() =>
  BaseHookInputSchema().and(
    z.object({
      hook_event_name: z.literal('TaskCreated'),
      task_id: z.string(),
      task_subject: z.string(),
      task_description: z.string().optional(),
      teammate_name: z.string().optional(),
      team_name: z.string().optional(),
    }),
  ),
)

export const TaskCompletedHookInputSchema = lazySchema(() =>
  BaseHookInputSchema().and(
    z.object({
      hook_event_name: z.literal('TaskCompleted'),
      task_id: z.string(),
      task_subject: z.string(),
      task_description: z.string().optional(),
      teammate_name: z.string().optional(),
      team_name: z.string().optional(),
    }),
  ),
)

// 引出事件是 MCP 服务器反过来向用户要输入：表单或链接两种模式
export const ElicitationHookInputSchema = lazySchema(() =>
  BaseHookInputSchema()
    .and(
      z.object({
        hook_event_name: z.literal('Elicitation'),
        mcp_server_name: z.string(),
        message: z.string(),
        mode: z.enum(['form', 'url']).optional(),
        url: z.string().optional(),
        elicitation_id: z.string().optional(),
        requested_schema: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .describe(
      'Hook input for the Elicitation event. Fired when an MCP server requests user input. Hooks can auto-respond (accept/decline) instead of showing the dialog.',
    ),
)
// 钩子可以代答：直接返回接受或拒绝，省掉整个弹窗——这就是「自动化代替人工」预留的接缝

// 引出结果事件在用户已经答完之后触发，钩子仍可覆盖答案，是发回服务器之前的最后一道闸门
export const ElicitationResultHookInputSchema = lazySchema(() =>
  BaseHookInputSchema()
    .and(
      z.object({
        hook_event_name: z.literal('ElicitationResult'),
        mcp_server_name: z.string(),
        elicitation_id: z.string().optional(),
        mode: z.enum(['form', 'url']).optional(),
        action: z.enum(['accept', 'decline', 'cancel']),
        content: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .describe(
      'Hook input for the ElicitationResult event. Fired after the user responds to an MCP elicitation. Hooks can observe or override the response before it is sent to the server.',
    ),
)

// 配置变更来源五档，其中 policy_settings 指组织统管策略、skills 指技能目录发生变动
export const CONFIG_CHANGE_SOURCES = [
  'user_settings',
  'project_settings',
  'local_settings',
  'policy_settings',
  'skills',
] as const

export const ConfigChangeHookInputSchema = lazySchema(() =>
  BaseHookInputSchema().and(
    z.object({
      hook_event_name: z.literal('ConfigChange'),
      source: z.enum(CONFIG_CHANGE_SOURCES),
      file_path: z.string().optional(),
    }),
  ),
)

// 指令加载原因五档：会话开始、嵌套遍历、路径匹配、include 引入、压缩后重载
export const INSTRUCTIONS_LOAD_REASONS = [
  'session_start',
  'nested_traversal',
  'path_glob_match',
  'include',
  'compact',
] as const

// 记忆类型四档，与设置层级对齐但多一个 Managed，表示组织统管的那份
export const INSTRUCTIONS_MEMORY_TYPES = [
  'User',
  'Project',
  'Local',
  'Managed',
] as const

// 指令加载事件一次报全：哪个文件、什么类型、为什么加载、匹配了哪些 glob、由哪个文件触发
export const InstructionsLoadedHookInputSchema = lazySchema(() =>
  BaseHookInputSchema().and(
    z.object({
      hook_event_name: z.literal('InstructionsLoaded'),
      file_path: z.string(),
      memory_type: z.enum(INSTRUCTIONS_MEMORY_TYPES),
      load_reason: z.enum(INSTRUCTIONS_LOAD_REASONS),
      globs: z.array(z.string()).optional(),
      trigger_file_path: z.string().optional(),
      parent_file_path: z.string().optional(),
    }),
  ),
)

// 工作树创建事件只带名字：路径由钩子返回，真正的创建动作交给外部工具
export const WorktreeCreateHookInputSchema = lazySchema(() =>
  BaseHookInputSchema().and(
    z.object({
      hook_event_name: z.literal('WorktreeCreate'),
      name: z.string(),
    }),
  ),
)

// 删除事件反过来带路径：此时目录已经存在，按路径清理比按名字可靠
export const WorktreeRemoveHookInputSchema = lazySchema(() =>
  BaseHookInputSchema().and(
    z.object({
      hook_event_name: z.literal('WorktreeRemove'),
      worktree_path: z.string(),
    }),
  ),
)

// 工作目录变更带新旧两个路径，方便钩子做相对路径的批量修正
export const CwdChangedHookInputSchema = lazySchema(() =>
  BaseHookInputSchema().and(
    z.object({
      hook_event_name: z.literal('CwdChanged'),
      old_cwd: z.string(),
      new_cwd: z.string(),
    }),
  ),
)

// 文件变更事件只有改、增、删三值——重命名要拆成一次删加一次增，没有单独的重命名事件
export const FileChangedHookInputSchema = lazySchema(() =>
  BaseHookInputSchema().and(
    z.object({
      hook_event_name: z.literal('FileChanged'),
      file_path: z.string(),
      event: z.enum(['change', 'add', 'unlink']),
    }),
  ),
)

// 退出原因六档。bypass_permissions_disabled 单独一档，是因为它属于「被策略关掉」而不是用户主动退出
export const EXIT_REASONS = [
  'clear',
  'resume',
  'logout',
  'prompt_input_exit',
  'other',
  'bypass_permissions_disabled',
] as const

export const ExitReasonSchema = lazySchema(() => z.enum(EXIT_REASONS))

// 会话结束事件把退出原因塞进 reason，复用同一个枚举保证前后端口径一致
export const SessionEndHookInputSchema = lazySchema(() =>
  BaseHookInputSchema().and(
    z.object({
      hook_event_name: z.literal('SessionEnd'),
      reason: ExitReasonSchema(),
    }),
  ),
)

// 输入总联合：27 个事件一一对应，排列顺序与上面的清单不完全一致，但覆盖是完整的
export const HookInputSchema = lazySchema(() =>
  z.union([
    PreToolUseHookInputSchema(),
    PostToolUseHookInputSchema(),
    PostToolUseFailureHookInputSchema(),
    PermissionDeniedHookInputSchema(),
    NotificationHookInputSchema(),
    UserPromptSubmitHookInputSchema(),
    SessionStartHookInputSchema(),
    SessionEndHookInputSchema(),
    StopHookInputSchema(),
    StopFailureHookInputSchema(),
    SubagentStartHookInputSchema(),
    SubagentStopHookInputSchema(),
    PreCompactHookInputSchema(),
    PostCompactHookInputSchema(),
    PermissionRequestHookInputSchema(),
    SetupHookInputSchema(),
    TeammateIdleHookInputSchema(),
    TaskCreatedHookInputSchema(),
    TaskCompletedHookInputSchema(),
    ElicitationHookInputSchema(),
    ElicitationResultHookInputSchema(),
    ConfigChangeHookInputSchema(),
    InstructionsLoadedHookInputSchema(),
    WorktreeCreateHookInputSchema(),
    WorktreeRemoveHookInputSchema(),
    CwdChangedHookInputSchema(),
    FileChangedHookInputSchema(),
  ]),
)

// 异步输出只有两个字段：标记 async 为真、可选超时——这是一种「我先收下，稍后回」的应答
export const AsyncHookJSONOutputSchema = lazySchema(() =>
  z.object({
    async: z.literal(true),
// 用 literal(true) 当判别字段：值为真才进这个分支；同步输出里根本没有 async 这个键，二者天然互斥
    asyncTimeout: z.number().optional(),
  }),
)

// 工具执行前的专属输出：可以改裁决、改输入、追加上下文
export const PreToolUseHookSpecificOutputSchema = lazySchema(() =>
  z.object({
    hookEventName: z.literal('PreToolUse'),
    permissionDecision: PermissionBehaviorSchema().optional(),
    permissionDecisionReason: z.string().optional(),
    updatedInput: z.record(z.string(), z.unknown()).optional(),
    additionalContext: z.string().optional(),
  }),
)

export const UserPromptSubmitHookSpecificOutputSchema = lazySchema(() =>
  z.object({
    hookEventName: z.literal('UserPromptSubmit'),
    additionalContext: z.string().optional(),
  }),
)

// 会话开始的专属输出能塞初始用户消息与监听路径：前者相当于替用户先开口，后者是自动加文件监视
export const SessionStartHookSpecificOutputSchema = lazySchema(() =>
  z.object({
    hookEventName: z.literal('SessionStart'),
    additionalContext: z.string().optional(),
    initialUserMessage: z.string().optional(),
    watchPaths: z.array(z.string()).optional(),
  }),
)

export const SetupHookSpecificOutputSchema = lazySchema(() =>
  z.object({
    hookEventName: z.literal('Setup'),
    additionalContext: z.string().optional(),
  }),
)

export const SubagentStartHookSpecificOutputSchema = lazySchema(() =>
  z.object({
    hookEventName: z.literal('SubagentStart'),
    additionalContext: z.string().optional(),
  }),
)

// 执行后的专属输出可整体替换 MCP 工具的输出——这是给结果做脱敏或统一格式化的口子
export const PostToolUseHookSpecificOutputSchema = lazySchema(() =>
  z.object({
    hookEventName: z.literal('PostToolUse'),
    additionalContext: z.string().optional(),
    updatedMCPToolOutput: z.unknown().optional(),
  }),
)

export const PostToolUseFailureHookSpecificOutputSchema = lazySchema(() =>
  z.object({
    hookEventName: z.literal('PostToolUseFailure'),
    additionalContext: z.string().optional(),
  }),
)

// 拒绝后的专属输出只有一个 retry 布尔：允许钩子说「换个方式再试一次」
export const PermissionDeniedHookSpecificOutputSchema = lazySchema(() =>
  z.object({
    hookEventName: z.literal('PermissionDenied'),
    retry: z.boolean().optional(),
  }),
)

export const NotificationHookSpecificOutputSchema = lazySchema(() =>
  z.object({
    hookEventName: z.literal('Notification'),
    additionalContext: z.string().optional(),
  }),
)

// 权限请求专属输出内嵌一个二选一裁决，与权限结果同形，但少了工具调用 ID
export const PermissionRequestHookSpecificOutputSchema = lazySchema(() =>
  z.object({
    hookEventName: z.literal('PermissionRequest'),
    decision: z.union([
      z.object({
        behavior: z.literal('allow'),
        updatedInput: z.record(z.string(), z.unknown()).optional(),
        updatedPermissions: z.array(PermissionUpdateSchema()).optional(),
      }),
      z.object({
        behavior: z.literal('deny'),
        message: z.string().optional(),
        interrupt: z.boolean().optional(),
      }),
    ]),
  }),
)

// 目录变更与文件变更的专属输出都是 watchPaths：让钩子顺手加上需要盯住的路径
export const CwdChangedHookSpecificOutputSchema = lazySchema(() =>
  z.object({
    hookEventName: z.literal('CwdChanged'),
    watchPaths: z.array(z.string()).optional(),
  }),
)

export const FileChangedHookSpecificOutputSchema = lazySchema(() =>
  z.object({
    hookEventName: z.literal('FileChanged'),
    watchPaths: z.array(z.string()).optional(),
  }),
)

// 同步输出的公共字段：continue 控制是否继续、suppressOutput 隐藏输出、stopReason 说明为什么停
export const SyncHookJSONOutputSchema = lazySchema(() =>
  z.object({
    continue: z.boolean().optional(),
    suppressOutput: z.boolean().optional(),
    stopReason: z.string().optional(),
// decision 只有 approve 与 block 两值，是粗粒度闸门；细粒度裁决都在 hookSpecificOutput 里
    decision: z.enum(['approve', 'block']).optional(),
    systemMessage: z.string().optional(),
    reason: z.string().optional(),
// hookSpecificOutput 是十五个分支的大联合，逐个事件给专属形状
    hookSpecificOutput: z
      .union([
        PreToolUseHookSpecificOutputSchema(),
        UserPromptSubmitHookSpecificOutputSchema(),
        SessionStartHookSpecificOutputSchema(),
        SetupHookSpecificOutputSchema(),
        SubagentStartHookSpecificOutputSchema(),
        PostToolUseHookSpecificOutputSchema(),
        PostToolUseFailureHookSpecificOutputSchema(),
        PermissionDeniedHookSpecificOutputSchema(),
        NotificationHookSpecificOutputSchema(),
        PermissionRequestHookSpecificOutputSchema(),
// 引出相关的两个分支在这里被引用，但它们的定义在下方——靠 lazy 才能前向引用
        ElicitationHookSpecificOutputSchema(),
        ElicitationResultHookSpecificOutputSchema(),
        CwdChangedHookSpecificOutputSchema(),
        FileChangedHookSpecificOutputSchema(),
// 工作树创建分支同样定义在后面，顺序颠倒不影响，因为求值被推迟到首次解析
        WorktreeCreateHookSpecificOutputSchema(),
      ])
      .optional(),
  }),
)

// 引出专属输出：可代答接受或拒绝，也可以直接带表单内容
export const ElicitationHookSpecificOutputSchema = lazySchema(() =>
  z
    .object({
      hookEventName: z.literal('Elicitation'),
      action: z.enum(['accept', 'decline', 'cancel']).optional(),
      content: z.record(z.string(), z.unknown()).optional(),
    })
    .describe(
      'Hook-specific output for the Elicitation event. Return this to programmatically accept or decline an MCP elicitation request.',
    ),
)

export const ElicitationResultHookSpecificOutputSchema = lazySchema(() =>
  z
    .object({
      hookEventName: z.literal('ElicitationResult'),
      action: z.enum(['accept', 'decline', 'cancel']).optional(),
      content: z.record(z.string(), z.unknown()).optional(),
    })
    .describe(
      'Hook-specific output for the ElicitationResult event. Return this to override the action or content before the response is sent to the MCP server.',
    ),
)

// 工作树创建输出只回一个绝对路径；命令行形态的钩子改成把路径打印到标准输出，两种形态并存
export const WorktreeCreateHookSpecificOutputSchema = lazySchema(() =>
  z
    .object({
      hookEventName: z.literal('WorktreeCreate'),
      worktreePath: z.string(),
    })
    .describe(
      'Hook-specific output for the WorktreeCreate event. Provides the absolute path to the created worktree directory. Command hooks print the path on stdout instead.',
    ),
)

// 输出总联合：异步与同步二选一，靠 async 这个字面量字段区分
export const HookJSONOutputSchema = lazySchema(() =>
  z.union([AsyncHookJSONOutputSchema(), SyncHookJSONOutputSchema()]),
)

// 提问选项三字段：键（回执里原样带回）、标签、可选说明
export const PromptRequestOptionSchema = lazySchema(() =>
  z.object({
    key: z
      .string()
      .describe('Unique key for this option, returned in the response'),
    label: z.string().describe('Display text for this option'),
    description: z
      .string()
      .optional()
      .describe('Optional description shown below the label'),
  }),
)

// 这里的设计很巧：prompt 字段本身就是请求 ID，这一行出现即代表「这是一条提问」，不需要额外的类型标记
export const PromptRequestSchema = lazySchema(() =>
  z.object({
    prompt: z
      .string()
      .describe(
        'Request ID. Presence of this key marks the line as a prompt request.',
      ),
// 用键的存在与否标记行类型，是行式 JSONL 协议的常见做法——比加一个 type 字段少一层判断
    message: z.string().describe('The prompt message to display to the user'),
    options: z
      .array(PromptRequestOptionSchema())
      .describe('Available options for the user to choose from'),
  }),
)

// 回执只需两个字段：原请求 ID 与所选键，宿主据此把答案接回正在等待的那次提问
export const PromptResponseSchema = lazySchema(() =>
  z.object({
    prompt_response: z
      .string()
      .describe('The request ID from the corresponding prompt request'),
    selected: z.string().describe('The key of the selected option'),
  }),
)

// ============================================================================
// Skill/Command Types
// ============================================================================

// 斜杠命令的三字段刻意极简：名字、说明、参数提示——这是给补全菜单用的，不是命令的完整定义
export const SlashCommandSchema = lazySchema(() =>
  z
    .object({
      name: z.string().describe('Skill name (without the leading slash)'),
      description: z.string().describe('Description of what the skill does'),
      argumentHint: z
        .string()
        .describe('Hint for skill arguments (e.g., "<file>")'),
    })
    .describe(
      'Information about an available skill (invoked via /command syntax).',
    ),
)

// 子代理信息带模型别名，省略即继承父级——这条继承规则必须在 UI 上写明，否则用户会以为用的是默认模型
export const AgentInfoSchema = lazySchema(() =>
  z
    .object({
      name: z.string().describe('Agent type identifier (e.g., "Explore")'),
      description: z.string().describe('Description of when to use this agent'),
      model: z
        .string()
        .optional()
        .describe(
          "Model alias this agent uses. If omitted, inherits the parent's model",
        ),
    })
    .describe(
      'Information about an available subagent that can be invoked via the Task tool.',
    ),
)

// 模型信息把能力位摊平：是否支持努力档、有哪几档、是否支持自适应思考、是否支持快速模式与自动模式
export const ModelInfoSchema = lazySchema(() =>
  z
    .object({
      value: z.string().describe('Model identifier to use in API calls'),
      displayName: z.string().describe('Human-readable display name'),
      description: z
        .string()
        .describe("Description of the model's capabilities"),
      supportsEffort: z
        .boolean()
        .optional()
        .describe('Whether this model supports effort levels'),
      supportedEffortLevels: z
// 努力档四值 low/medium/high/max，与代理定义里的枚举必须保持一致，两处不同步会静默失配
        .array(z.enum(['low', 'medium', 'high', 'max']))
        .optional()
        .describe('Available effort levels for this model'),
      supportsAdaptiveThinking: z
        .boolean()
        .optional()
        .describe(
          'Whether this model supports adaptive thinking (Claude decides when and how much to think)',
        ),
      supportsFastMode: z
        .boolean()
        .optional()
        .describe('Whether this model supports fast mode'),
      supportsAutoMode: z
        .boolean()
        .optional()
        .describe('Whether this model supports auto mode'),
    })
    .describe('Information about an available model.'),
)

// 账户信息几乎所有字段都可选：第三方后端下只有 apiProvider 有意义，其余凭据都在外部
export const AccountInfoSchema = lazySchema(() =>
  z
    .object({
      email: z.string().optional(),
      organization: z.string().optional(),
      subscriptionType: z.string().optional(),
      tokenSource: z.string().optional(),
      apiKeySource: z.string().optional(),
// apiProvider 四值点明一条边界：只有 firstParty 才走 Anthropic 的 OAuth 登录，其余靠云厂商自己的凭据
      apiProvider: z
        .enum(['firstParty', 'bedrock', 'vertex', 'foundry'])
        .optional()
        .describe(
          'Active API backend. Anthropic OAuth login only applies when "firstParty"; for 3P providers the other fields are absent and auth is external (AWS creds, gcloud ADC, etc.).',
        ),
    })
    .describe("Information about the logged in user's account."),
)

// ============================================================================
// Agent Definition Types
// ============================================================================

// 代理声明的 MCP 服务器两种写法：一个字符串（引用已有配置），或「名字到配置」的映射
export const AgentMcpServerSpecSchema = lazySchema(() =>
  z.union([
    z.string(),
    z.record(z.string(), McpServerConfigForProcessTransportSchema()),
  ]),
)

// 代理定义是这份文件里最像产品配置的一段：工具白黑名单、系统提示词、模型、技能、初始提示、轮数上限
export const AgentDefinitionSchema = lazySchema(() =>
  z
    .object({
      description: z
        .string()
        .describe('Natural language description of when to use this agent'),
// tools 省略即继承全部工具，这是最危险的默认值——自定义代理忘了写这一项，就等于拿到了全部权限
      tools: z
        .array(z.string())
        .optional()
        .describe(
          'Array of allowed tool names. If omitted, inherits all tools from parent',
        ),
      disallowedTools: z
        .array(z.string())
        .optional()
        .describe('Array of tool names to explicitly disallow for this agent'),
// 提示词必填且无默认值：代理没有系统提示词就等于没有身份，不能靠空值蒙混过去
      prompt: z.string().describe("The agent's system prompt"),
      model: z
        .string()
        .optional()
        .describe(
          "Model alias (e.g. 'sonnet', 'opus', 'haiku') or full model ID (e.g. 'claude-opus-4-5'). If omitted or 'inherit', uses the main model",
        ),
      mcpServers: z.array(AgentMcpServerSpecSchema()).optional(),
// criticalSystemReminder 带 EXPERIMENTAL 后缀：实验字段用命名而非开关来标记，便于全文检索出所有实验面
      criticalSystemReminder_EXPERIMENTAL: z
        .string()
        .optional()
        .describe('Experimental: Critical reminder added to system prompt'),
      skills: z
        .array(z.string())
        .optional()
        .describe('Array of skill names to preload into the agent context'),
// initialPrompt 在该代理作为主线程时自动作为第一轮用户输入提交，且支持斜杠命令，会拼在用户输入之前
      initialPrompt: z
        .string()
        .optional()
        .describe(
          'Auto-submitted as the first user turn when this agent is the main thread agent. Slash commands are processed. Prepended to any user-provided prompt.',
        ),
// 轮数上限用 int 加 positive 双约束：语义靠 schema 表达，而不是靠注释或调用方自觉
      maxTurns: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          'Maximum number of agentic turns (API round-trips) before stopping',
        ),
// background 让代理以发射后不管的方式跑：调用方立刻拿到句柄，不等结果
      background: z
        .boolean()
        .optional()
        .describe(
          'Run this agent as a background task (non-blocking, fire-and-forget) when invoked',
        ),
// 记忆作用域三档，describe 直接把三个目录路径写出来——契约文档就长在 schema 上，不另开一份
      memory: z
        .enum(['user', 'project', 'local'])
        .optional()
        .describe(
          "Scope for auto-loading agent memory files. 'user' - ~/.claude/agent-memory/<agentType>/, 'project' - .claude/agent-memory/<agentType>/, 'local' - .claude/agent-memory-local/<agentType>/",
        ),
// 努力程度既接受命名档也接受整数：命名档给人类读，整数给程序化调度用
      effort: z
        .union([z.enum(['low', 'medium', 'high', 'max']), z.number().int()])
        .optional()
        .describe(
          'Reasoning effort level for this agent. Either a named level or an integer',
        ),
      permissionMode: PermissionModeSchema()
        .optional()
        .describe(
          'Permission mode controlling how tool executions are handled',
        ),
    })
    .describe(
      'Definition for a custom subagent that can be invoked via the Agent tool.',
    ),
)

// ============================================================================
// Settings Types
// ============================================================================

// 设置来源三档，与配置作用域同义但少两档——这里只关心来自文件系统的那三种
export const SettingSourceSchema = lazySchema(() =>
  z
    .enum(['user', 'project', 'local'])
    .describe(
      'Source for loading filesystem-based settings. ' +
        "'user' - Global user settings (~/.claude/settings.json). " +
        "'project' - Project settings (.claude/settings.json). " +
        "'local' - Local settings (.claude/settings.local.json).",
    ),
)

// 插件配置目前只支持 local 类型；type 字段留着是为了将来加市场安装这种新来源
export const SdkPluginConfigSchema = lazySchema(() =>
  z
    .object({
      type: z
        .literal('local')
        .describe("Plugin type. Currently only 'local' is supported"),
      path: z
        .string()
        .describe('Absolute or relative path to the plugin directory'),
    })
    .describe('Configuration for loading a plugin.'),
)

// ============================================================================
// Rewind Types
// ============================================================================

// 回滚结果：能不能回、错误、改了哪些文件、增删行数——回滚也要给用户一份「改了什么」的回执
export const RewindFilesResultSchema = lazySchema(() =>
  z
    .object({
      canRewind: z.boolean(),
      error: z.string().optional(),
      filesChanged: z.array(z.string()).optional(),
      insertions: z.number().optional(),
      deletions: z.number().optional(),
    })
    .describe('Result of a rewindFiles operation.'),
)

// 下面这五个占位符是类型生成器的把手：zod 里只能写 unknown，生成 TS 时按类型映射表替换成真实外部类型
// ============================================================================
// External Type Placeholders
// ============================================================================
//
// These schemas use z.unknown() as placeholders for external types.
// The generation script uses TypeOverrideMap to output the correct TS type references.
// This allows us to define SDK message types in Zod while maintaining proper typing.

// 占位符旁边都标着对应哪个外部类型，这是给生成脚本的维护者看的，不是给运行时看的
/** Placeholder for APIUserMessage from @anthropic-ai/sdk */
export const APIUserMessagePlaceholder = lazySchema(() => z.unknown())

/** Placeholder for APIAssistantMessage from @anthropic-ai/sdk */
export const APIAssistantMessagePlaceholder = lazySchema(() => z.unknown())

/** Placeholder for RawMessageStreamEvent from @anthropic-ai/sdk */
export const RawMessageStreamEventPlaceholder = lazySchema(() => z.unknown())

/** Placeholder for UUID from crypto */
// UUID 占位符落地成字符串 schema：zod 侧只校验「是字符串」，格式约束交给上游
export const UUIDPlaceholder = lazySchema(() => z.string())

/** Placeholder for NonNullableUsage (mapped type over Usage) */
export const NonNullableUsagePlaceholder = lazySchema(() => z.unknown())

// ============================================================================
// SDK Message Types
// ============================================================================

export const SDKAssistantMessageErrorSchema = lazySchema(() =>
  z.enum([
    'authentication_failed',
    'billing_error',
    'rate_limit',
    'invalid_request',
    'server_error',
    'unknown',
    'max_output_tokens',
  ]),
)

export const SDKStatusSchema = lazySchema(() =>
  z.union([z.literal('compacting'), z.null()]),
)

// SDKUserMessage content without uuid/session_id
// 用户消息内容单独抽出来，是为了让正常消息与重放消息共用同一份字段定义，再各自扩展
const SDKUserMessageContentSchema = lazySchema(() =>
  z.object({
    type: z.literal('user'),
    message: APIUserMessagePlaceholder(),
    parent_tool_use_id: z.string().nullable(),
    isSynthetic: z.boolean().optional(),
    tool_use_result: z.unknown().optional(),
    priority: z.enum(['now', 'next', 'later']).optional(),
// timestamp 可选且注释写明降级策略：旧版本不发时间戳，消费端退到本地接收时刻
    timestamp: z
      .string()
      .optional()
      .describe(
        'ISO timestamp when the message was created on the originating process. Older emitters omit it; consumers should fall back to receive time.',
      ),
  }),
)

// 正常用户消息在内容基础上补 uuid 与 session_id，两者都可选——外部注入的消息可能没有这两个字段
export const SDKUserMessageSchema = lazySchema(() =>
  SDKUserMessageContentSchema().extend({
    uuid: UUIDPlaceholder().optional(),
    session_id: z.string().optional(),
  }),
)

// 重放消息反过来要求两者必填，并加 isReplay 标记：回放的数据必须能追溯到确定的会话
export const SDKUserMessageReplaySchema = lazySchema(() =>
  SDKUserMessageContentSchema().extend({
    uuid: UUIDPlaceholder(),
    session_id: z.string(),
    isReplay: z.literal(true),
  }),
)

// 限流信息把「当前状态、何时重置、哪一档限额、用了多少」合成一个对象，客户端据此决定提示强度
export const SDKRateLimitInfoSchema = lazySchema(() =>
  z
    .object({
      status: z.enum(['allowed', 'allowed_warning', 'rejected']),
      resetsAt: z.number().optional(),
      rateLimitType: z
        .enum([
          'five_hour',
          'seven_day',
          'seven_day_opus',
          'seven_day_sonnet',
          'overage',
        ])
        .optional(),
      utilization: z.number().optional(),
      overageStatus: z
        .enum(['allowed', 'allowed_warning', 'rejected'])
        .optional(),
      overageResetsAt: z.number().optional(),
// 超额被禁的十三种原因本身就是一份排障手册：未开通、组织禁用、余额不足、席位档位限制等
      overageDisabledReason: z
        .enum([
          'overage_not_provisioned',
          'org_level_disabled',
          'org_level_disabled_until',
          'out_of_credits',
          'seat_tier_level_disabled',
          'member_level_disabled',
          'seat_tier_zero_credit_limit',
          'group_zero_credit_limit',
          'member_zero_credit_limit',
          'org_service_level_disabled',
          'org_service_zero_credit_limit',
          'no_limits_configured',
          'unknown',
        ])
        .optional(),
      isUsingOverage: z.boolean().optional(),
      surpassedThreshold: z.number().optional(),
    })
    .describe('Rate limit information for claude.ai subscription users.'),
)

// 助手消息复用外部占位类型，错误是可选枚举——正常回复里不会有 error 字段
export const SDKAssistantMessageSchema = lazySchema(() =>
  z.object({
    type: z.literal('assistant'),
    message: APIAssistantMessagePlaceholder(),
    parent_tool_use_id: z.string().nullable(),
    error: SDKAssistantMessageErrorSchema().optional(),
    uuid: UUIDPlaceholder(),
    session_id: z.string(),
  }),
)

export const SDKRateLimitEventSchema = lazySchema(() =>
  z
    .object({
      type: z.literal('rate_limit_event'),
      rate_limit_info: SDKRateLimitInfoSchema(),
      uuid: UUIDPlaceholder(),
      session_id: z.string(),
    })
    .describe('Rate limit event emitted when rate limit info changes.'),
)

// streamlined 两种消息是内部替代形态：把思考块与工具块剥掉，只留文本与一句工具调用汇总
export const SDKStreamlinedTextMessageSchema = lazySchema(() =>
  z
    .object({
      type: z.literal('streamlined_text'),
      text: z
        .string()
        .describe('Text content preserved from the assistant message'),
      session_id: z.string(),
      uuid: UUIDPlaceholder(),
    })
    .describe(
      '@internal Streamlined text message - replaces SDKAssistantMessage in streamlined output. Text content preserved, thinking and tool_use blocks removed.',
    ),
)

export const SDKStreamlinedToolUseSummaryMessageSchema = lazySchema(() =>
  z
    .object({
      type: z.literal('streamlined_tool_use_summary'),
      tool_summary: z
        .string()
        .describe('Summary of tool calls (e.g., "Read 2 files, wrote 1 file")'),
      session_id: z.string(),
      uuid: UUIDPlaceholder(),
    })
    .describe(
      '@internal Streamlined tool use summary - replaces tool_use blocks in streamlined output with a cumulative summary string.',
    ),
)

// 权限拒绝记录：工具名、调用 ID、原始输入——事后审计的三件套
export const SDKPermissionDenialSchema = lazySchema(() =>
  z.object({
    tool_name: z.string(),
    tool_use_id: z.string(),
    tool_input: z.record(z.string(), z.unknown()),
  }),
)

// 成功结果一次报全：耗时、轮数、成本、总量与模型级用量、被拒记录，还有可选的结构化输出
export const SDKResultSuccessSchema = lazySchema(() =>
  z.object({
    type: z.literal('result'),
    subtype: z.literal('success'),
    duration_ms: z.number(),
    duration_api_ms: z.number(),
    is_error: z.boolean(),
    num_turns: z.number(),
    result: z.string(),
    stop_reason: z.string().nullable(),
    total_cost_usd: z.number(),
    usage: NonNullableUsagePlaceholder(),
    modelUsage: z.record(z.string(), ModelUsageSchema()),
    permission_denials: z.array(SDKPermissionDenialSchema()),
    structured_output: z.unknown().optional(),
    fast_mode_state: FastModeStateSchema().optional(),
    uuid: UUIDPlaceholder(),
    session_id: z.string(),
  }),
)

// 失败结果与成功结果几乎同形，唯一实质差异是用 errors 数组替掉 result 字符串
export const SDKResultErrorSchema = lazySchema(() =>
  z.object({
    type: z.literal('result'),
    subtype: z.enum([
      'error_during_execution',
      'error_max_turns',
      'error_max_budget_usd',
      'error_max_structured_output_retries',
    ]),
    duration_ms: z.number(),
    duration_api_ms: z.number(),
    is_error: z.boolean(),
    num_turns: z.number(),
    stop_reason: z.string().nullable(),
    total_cost_usd: z.number(),
    usage: NonNullableUsagePlaceholder(),
    modelUsage: z.record(z.string(), ModelUsageSchema()),
    permission_denials: z.array(SDKPermissionDenialSchema()),
    errors: z.array(z.string()),
    fast_mode_state: FastModeStateSchema().optional(),
    uuid: UUIDPlaceholder(),
    session_id: z.string(),
  }),
)

export const SDKResultMessageSchema = lazySchema(() =>
  z.union([SDKResultSuccessSchema(), SDKResultErrorSchema()]),
)

// 初始化系统消息相当于一份会话体检报告：版本、目录、工具、MCP 服务器、模型、权限模式、技能、插件
export const SDKSystemMessageSchema = lazySchema(() =>
  z.object({
    type: z.literal('system'),
    subtype: z.literal('init'),
    agents: z.array(z.string()).optional(),
    apiKeySource: ApiKeySourceSchema(),
    betas: z.array(z.string()).optional(),
    claude_code_version: z.string(),
    cwd: z.string(),
    tools: z.array(z.string()),
    mcp_servers: z.array(
      z.object({
        name: z.string(),
        status: z.string(),
      }),
    ),
    model: z.string(),
    permissionMode: PermissionModeSchema(),
    slash_commands: z.array(z.string()),
    output_style: z.string(),
    skills: z.array(z.string()),
    plugins: z.array(
      z.object({
        name: z.string(),
        path: z.string(),
// 插件来源用「名字加市场名」的约定，另有两个哨兵值分别代表命令行目录与内置插件
        source: z
          .string()
          .optional()
          .describe(
            '@internal Plugin source identifier in "name\\@marketplace" format. Sentinels: "name\\@inline" for --plugin-dir, "name\\@builtin" for built-in plugins.',
          ),
      }),
    ),
    fast_mode_state: FastModeStateSchema().optional(),
    uuid: UUIDPlaceholder(),
    session_id: z.string(),
  }),
)

export const SDKPartialAssistantMessageSchema = lazySchema(() =>
  z.object({
    type: z.literal('stream_event'),
    event: RawMessageStreamEventPlaceholder(),
    parent_tool_use_id: z.string().nullable(),
    uuid: UUIDPlaceholder(),
    session_id: z.string(),
  }),
)

// 压缩边界消息带保留段三件套：头、锚点、尾——加载时按锚点把被保留的内容重新接回消息流
export const SDKCompactBoundaryMessageSchema = lazySchema(() =>
  z.object({
    type: z.literal('system'),
    subtype: z.literal('compact_boundary'),
    compact_metadata: z.object({
      trigger: z.enum(['manual', 'auto']),
      pre_tokens: z.number(),
// describe 解释了两种保留策略：后缀保留锚在摘要上，前缀保留锚在边界上；整体压缩时这个字段不出现
      preserved_segment: z
        .object({
          head_uuid: UUIDPlaceholder(),
          anchor_uuid: UUIDPlaceholder(),
          tail_uuid: UUIDPlaceholder(),
        })
        .optional()
        .describe(
          'Relink info for messagesToKeep. Loaders splice the preserved ' +
            'segment at anchor_uuid (summary for suffix-preserving, ' +
            'boundary for prefix-preserving partial compact) so resume ' +
            'includes preserved content. Unset when compaction summarizes ' +
            'everything (no messagesToKeep).',
        ),
    }),
    uuid: UUIDPlaceholder(),
    session_id: z.string(),
  }),
)

// 状态消息的 status 只可能是「正在压缩」或 null——压缩是全文唯一的全局状态
export const SDKStatusMessageSchema = lazySchema(() =>
  z.object({
    type: z.literal('system'),
    subtype: z.literal('status'),
    status: SDKStatusSchema(),
    permissionMode: PermissionModeSchema().optional(),
    uuid: UUIDPlaceholder(),
    session_id: z.string(),
  }),
)

// 回合后摘要是一屏后台战报：状态分类五档、标题、描述、最近动作、待办事项、产物链接
export const SDKPostTurnSummaryMessageSchema = lazySchema(() =>
  z
    .object({
      type: z.literal('system'),
      subtype: z.literal('post_turn_summary'),
      summarizes_uuid: z.string(),
      status_category: z.enum([
        'blocked',
        'waiting',
        'completed',
        'review_ready',
        'failed',
      ]),
      status_detail: z.string(),
      is_noteworthy: z.boolean(),
      title: z.string(),
      description: z.string(),
      recent_action: z.string(),
      needs_action: z.string(),
      artifact_urls: z.array(z.string()),
      uuid: UUIDPlaceholder(),
      session_id: z.string(),
    })
    .describe(
      '@internal Background post-turn summary emitted after each assistant turn. summarizes_uuid points to the assistant message this summarizes.',
    ),
)

// 接口重试消息把「第几次、上限多少、等多久、错误码」全摊开，前端可以直接画重试进度
export const SDKAPIRetryMessageSchema = lazySchema(() =>
  z
    .object({
      type: z.literal('system'),
      subtype: z.literal('api_retry'),
      attempt: z.number(),
      max_retries: z.number(),
      retry_delay_ms: z.number(),
      error_status: z.number().nullable(),
// error_status 为 null 表示连接层失败、压根没有 HTTP 响应——注释把这条边界写死了
      error: SDKAssistantMessageErrorSchema(),
      uuid: UUIDPlaceholder(),
      session_id: z.string(),
    })
    .describe(
      'Emitted when an API request fails with a retryable error and will be retried after a delay. error_status is null for connection errors (e.g. timeouts) that had no HTTP response.',
    ),
)

// 本地命令的输出也当系统消息下发：斜杠命令的打印结果在转录里按助手样式显示
export const SDKLocalCommandOutputMessageSchema = lazySchema(() =>
  z
    .object({
      type: z.literal('system'),
      subtype: z.literal('local_command_output'),
      content: z.string(),
      uuid: UUIDPlaceholder(),
      session_id: z.string(),
    })
    .describe(
      'Output from a local slash command (e.g. /voice, /cost). Displayed as assistant-style text in the transcript.',
    ),
)

// 钩子三件套：开始、进度、响应。开始只有身份，进度带实时标准输出，响应带退出码与结局
export const SDKHookStartedMessageSchema = lazySchema(() =>
  z.object({
    type: z.literal('system'),
    subtype: z.literal('hook_started'),
    hook_id: z.string(),
    hook_name: z.string(),
    hook_event: z.string(),
    uuid: UUIDPlaceholder(),
    session_id: z.string(),
  }),
)

export const SDKHookProgressMessageSchema = lazySchema(() =>
  z.object({
    type: z.literal('system'),
    subtype: z.literal('hook_progress'),
    hook_id: z.string(),
    hook_name: z.string(),
    hook_event: z.string(),
    stdout: z.string(),
    stderr: z.string(),
    output: z.string(),
    uuid: UUIDPlaceholder(),
    session_id: z.string(),
  }),
)

export const SDKHookResponseMessageSchema = lazySchema(() =>
  z.object({
    type: z.literal('system'),
    subtype: z.literal('hook_response'),
    hook_id: z.string(),
    hook_name: z.string(),
    hook_event: z.string(),
    output: z.string(),
    stdout: z.string(),
    stderr: z.string(),
    exit_code: z.number().optional(),
// 结局三值 success/error/cancelled：取消与失败必须分开，前者不该算进错误率
    outcome: z.enum(['success', 'error', 'cancelled']),
    uuid: UUIDPlaceholder(),
    session_id: z.string(),
  }),
)

// 工具进度消息按秒累计耗时，可选任务 ID——长任务执行期间这是唯一的活体信号
export const SDKToolProgressMessageSchema = lazySchema(() =>
  z.object({
    type: z.literal('tool_progress'),
    tool_use_id: z.string(),
    tool_name: z.string(),
    parent_tool_use_id: z.string().nullable(),
    elapsed_time_seconds: z.number(),
    task_id: z.string().optional(),
    uuid: UUIDPlaceholder(),
    session_id: z.string(),
  }),
)

// 认证状态消息：是否正在认证、逐行输出、可选错误
export const SDKAuthStatusMessageSchema = lazySchema(() =>
  z.object({
    type: z.literal('auth_status'),
    isAuthenticating: z.boolean(),
    output: z.array(z.string()),
    error: z.string().optional(),
    uuid: UUIDPlaceholder(),
    session_id: z.string(),
  }),
)

// 文件落盘事件把成功与失败分两桶报，另带一个处理时间戳
export const SDKFilesPersistedEventSchema = lazySchema(() =>
  z.object({
    type: z.literal('system'),
    subtype: z.literal('files_persisted'),
    files: z.array(
      z.object({
        filename: z.string(),
        file_id: z.string(),
      }),
    ),
    failed: z.array(
      z.object({
        filename: z.string(),
        error: z.string(),
      }),
    ),
    processed_at: z.string(),
    uuid: UUIDPlaceholder(),
    session_id: z.string(),
  }),
)

// 任务通知是终态：完成、失败、停止三态，带输出文件路径与用量小结
export const SDKTaskNotificationMessageSchema = lazySchema(() =>
  z.object({
    type: z.literal('system'),
    subtype: z.literal('task_notification'),
    task_id: z.string(),
    tool_use_id: z.string().optional(),
    status: z.enum(['completed', 'failed', 'stopped']),
    output_file: z.string(),
    summary: z.string(),
    usage: z
      .object({
        total_tokens: z.number(),
        tool_uses: z.number(),
        duration_ms: z.number(),
      })
      .optional(),
    uuid: UUIDPlaceholder(),
    session_id: z.string(),
  }),
)

// 任务开始消息带描述、任务类型、工作流名、提示词；工作流名只在类型为 local_workflow 时才有
export const SDKTaskStartedMessageSchema = lazySchema(() =>
  z.object({
    type: z.literal('system'),
    subtype: z.literal('task_started'),
    task_id: z.string(),
    tool_use_id: z.string().optional(),
    description: z.string(),
    task_type: z.string().optional(),
    workflow_name: z
      .string()
      .optional()
      .describe(
        "meta.name from the workflow script (e.g. 'spec'). Only set when task_type is 'local_workflow'.",
      ),
    prompt: z.string().optional(),
    uuid: UUIDPlaceholder(),
    session_id: z.string(),
  }),
)

// 会话状态变更镜像内部的通知机制：空闲、运行中、需要动作三态
export const SDKSessionStateChangedMessageSchema = lazySchema(() =>
  z
    .object({
      type: z.literal('system'),
      subtype: z.literal('session_state_changed'),
      state: z.enum(['idle', 'running', 'requires_action']),
      uuid: UUIDPlaceholder(),
      session_id: z.string(),
    })
    .describe(
      "Mirrors notifySessionStateChanged. 'idle' fires after heldBackResult flushes and the bg-agent do-while exits — authoritative turn-over signal.",
    ),
)
// describe 点明 idle 的语义：要等结果冲刷完、后台代理循环退出才发，是最权威的「回合结束」信号


// 任务进度与任务通知的分工：进度是高频增量，通知是终态一次性
export const SDKTaskProgressMessageSchema = lazySchema(() =>
  z.object({
    type: z.literal('system'),
    subtype: z.literal('task_progress'),
    task_id: z.string(),
    tool_use_id: z.string().optional(),
    description: z.string(),
    usage: z.object({
      total_tokens: z.number(),
      tool_uses: z.number(),
      duration_ms: z.number(),
    }),
    last_tool_name: z.string().optional(),
    summary: z.string().optional(),
    uuid: UUIDPlaceholder(),
    session_id: z.string(),
  }),
)

// 工具使用汇总带上了「这次汇总覆盖哪些调用」的 ID 列表——没有它就无法判断汇总是否重复计入
export const SDKToolUseSummaryMessageSchema = lazySchema(() =>
  z.object({
    type: z.literal('tool_use_summary'),
    summary: z.string(),
    preceding_tool_use_ids: z.array(z.string()),
    uuid: UUIDPlaceholder(),
    session_id: z.string(),
  }),
)

// 引出完成事件只在链接模式下由服务器确认，表单模式不需要这个信号
export const SDKElicitationCompleteMessageSchema = lazySchema(() =>
  z
    .object({
      type: z.literal('system'),
      subtype: z.literal('elicitation_complete'),
      mcp_server_name: z.string(),
      elicitation_id: z.string(),
      uuid: UUIDPlaceholder(),
      session_id: z.string(),
    })
    .describe(
      'Emitted when an MCP server confirms that a URL-mode elicitation is complete.',
    ),
)

/** @internal */
// 提示建议是内部实验功能：预测用户下一句，挂在每个回合结束后
export const SDKPromptSuggestionMessageSchema = lazySchema(() =>
  z
    .object({
      type: z.literal('prompt_suggestion'),
      suggestion: z.string(),
      uuid: UUIDPlaceholder(),
      session_id: z.string(),
    })
    .describe(
      'Predicted next user prompt, emitted after each turn when promptSuggestions is enabled.',
    ),
)

// ============================================================================
// Session Listing Types
// ============================================================================

// 会话列表信息的字段是驼峰命名，与消息流的蛇形命名形成分界：这是 API 表面，不是流式协议
export const SDKSessionInfoSchema = lazySchema(() =>
  z
    .object({
      sessionId: z.string().describe('Unique session identifier (UUID).'),
      summary: z
        .string()
        .describe(
          'Display title for the session: custom title, auto-generated summary, or first prompt.',
        ),
      lastModified: z
        .number()
        .describe('Last modified time in milliseconds since epoch.'),
// fileSize 只在本地 JSONL 存储时才有，云端会话不提供——消费端必须做可选处理
      fileSize: z
        .number()
        .optional()
        .describe(
          'File size in bytes. Only populated for local JSONL storage.',
        ),
      customTitle: z
        .string()
        .optional()
        .describe('User-set session title via /rename.'),
      firstPrompt: z
        .string()
        .optional()
        .describe('First meaningful user prompt in the session.'),
      gitBranch: z
        .string()
        .optional()
        .describe('Git branch at the end of the session.'),
      cwd: z.string().optional().describe('Working directory for the session.'),
      tag: z.string().optional().describe('User-set session tag.'),
      createdAt: z
        .number()
        .optional()
        .describe(
          "Creation time in milliseconds since epoch, extracted from the first entry's timestamp.",
        ),
    })
    .describe('Session metadata returned by listSessions and getSessionInfo.'),
)

// 消息总联合 24 个分支，zod 按顺序依次尝试；顺序影响解析性能，不影响正确性
export const SDKMessageSchema = lazySchema(() =>
  z.union([
    SDKAssistantMessageSchema(),
    SDKUserMessageSchema(),
    SDKUserMessageReplaySchema(),
    SDKResultMessageSchema(),
    SDKSystemMessageSchema(),
    SDKPartialAssistantMessageSchema(),
    SDKCompactBoundaryMessageSchema(),
    SDKStatusMessageSchema(),
    SDKAPIRetryMessageSchema(),
    SDKLocalCommandOutputMessageSchema(),
    SDKHookStartedMessageSchema(),
    SDKHookProgressMessageSchema(),
    SDKHookResponseMessageSchema(),
    SDKToolProgressMessageSchema(),
    SDKAuthStatusMessageSchema(),
    SDKTaskNotificationMessageSchema(),
    SDKTaskStartedMessageSchema(),
    SDKTaskProgressMessageSchema(),
    SDKSessionStateChangedMessageSchema(),
    SDKFilesPersistedEventSchema(),
    SDKToolUseSummaryMessageSchema(),
    SDKRateLimitEventSchema(),
    SDKElicitationCompleteMessageSchema(),
    SDKPromptSuggestionMessageSchema(),
  ]),
)

// 快速模式三态：关、限流后的冷却、开。冷却态是「想开但被限流压住」的中间状态，不能简化为布尔
export const FastModeStateSchema = lazySchema(() =>
  z
    .enum(['off', 'cooldown', 'on'])
    .describe(
      'Fast mode state: off, in cooldown after rate limit, or actively enabled.',
    ),
)
