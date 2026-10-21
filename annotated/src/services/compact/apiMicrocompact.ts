import { FILE_EDIT_TOOL_NAME } from 'src/tools/FileEditTool/constants.js'
import { FILE_READ_TOOL_NAME } from 'src/tools/FileReadTool/prompt.js'
import { FILE_WRITE_TOOL_NAME } from 'src/tools/FileWriteTool/prompt.js'
import { GLOB_TOOL_NAME } from 'src/tools/GlobTool/prompt.js'
import { GREP_TOOL_NAME } from 'src/tools/GrepTool/prompt.js'
import { NOTEBOOK_EDIT_TOOL_NAME } from 'src/tools/NotebookEditTool/constants.js'
import { WEB_FETCH_TOOL_NAME } from 'src/tools/WebFetchTool/prompt.js'
import { WEB_SEARCH_TOOL_NAME } from 'src/tools/WebSearchTool/prompt.js'
import { SHELL_TOOL_NAMES } from 'src/utils/shell/shellToolUtils.js'
import { isEnvTruthy } from '../../utils/envUtils.js'

// ═══════════════════════════════════════════════════════════════
// 第 6 步 · 服务层 · 2/N —— 服务端压缩（src/services/compact/apiMicrocompact.ts）
//
// 【先纠正一个常见误解，包括我上一轮说错的那句】
//
// 文件名里有 microcompact，很容易以为它是"压缩器"。它不是。
// 这个 153 行的文件**一次模型调用都不发**，它只做一件事：
//
//     构造一个叫 context_management 的配置对象，塞进请求体，
//     让**服务端**在推理过程中自己清理上下文。
//
// 所以它是"下指令"，不是"执行"。真正的执行发生在 Anthropic 的推理服务里。
// 客户端能做到这一点的前提是：API 支持 context editing beta
// （claude.ts 行 137 的 CONTEXT_MANAGEMENT_BETA_HEADER）。
//
// 【双轨制的压缩体系】
//
//   客户端压缩（microCompact.ts / compact.ts）—— 我们自己动手删消息、
//       生成摘要，改完的对话再发出去。主动权完全在本地。
//   服务端压缩（这个文件）—— 我们只说"当输入超过 18 万 token 时，
//       把工具结果清掉，至少清出 14 万"。清理动作在服务端做，
//       我们发出去的历史字节不变。
//
// 后者最大的好处是**不破坏 prompt cache**：服务端在内部做的编辑
// 不影响我们这一侧的前缀稳定性。前者每压一次，缓存就废一次。
//
// 【为什么这个文件这么短】
// 因为它只是把「策略」翻译成「JSON」。没有任何分支复杂度 ——
// 唯一的结构是"三类策略按条件往数组里 push"。
// 真正复杂的是那些策略本身的语义（哪些工具能清、清多少），
// 而那些语义定义在 API 那边，这里只是照抄字段名。
// ═══════════════════════════════════════════════════════════════
// docs: https://docs.google.com/document/d/1oCT4evvWTh3P6z-kcfNQwWTCxAhkoFndSaNS9Gm40uw/edit?tab=t.0

// 两个默认阈值，注释说"Match client-side microcompact token values"——
// 也就是说服务端清理的触发点和客户端压缩用的是同一套数字。
// 保持一致的理由：两边如果不同步，会出现"客户端觉得还早、
// 服务端已经开始清"这种不可预测的状态。
//
//   180,000  触发线（输入到这就不再多留）
//    40,000  目标线（清完希望剩下这么多）
//
// 两者相减 = 140,000，就是下面 clear_at_least 的值：
// "一次至少清出 14 万 token"，避免每次请求都只清一点点、
// 反复触发（每次编辑都有成本）。
// Default values for context management strategies
// Match client-side microcompact token values
const DEFAULT_MAX_INPUT_TOKENS = 180_000 // Typical warning threshold
const DEFAULT_TARGET_INPUT_TOKENS = 40_000 // Keep last 40k tokens like client-side

// ⚠ 两个名字很像的常量，差别是这个文件的全部设计意图：
//
//   TOOLS_CLEARABLE_RESULTS  只读类工具 —— shell / glob / grep / read / fetch / search
//   TOOLS_CLEARABLE_USES     写类工具   —— edit / write / notebook_edit
//
// 为什么必须分开：两类工具"能删的东西"不一样。
//
//   只读工具：**输出**可以删（读过的文件内容、搜过的结果）。
//             删了顶多重新跑一次，代价是时间。
//   写类工具：**输入**可以删（patch 内容可能几千行），
//             但结果必须留着 —— 那是"我改了什么"的唯一记录。
//
// 一条经验：能安全丢弃的是"可重新获得的信息"，不是"已经发生的动作记录"。
//
// ⚠ 需要坦白一处代码本身不自洽的地方：字段名是 clear_tool_inputs
// （按字面是"清这些工具的输入"），但传进去的常量叫 TOOLS_CLEARABLE_RESULTS
// （名字说的是"结果"）。究竟清输入还是清输出，代码里看不出来，
// 取决于 API 那边 clear_tool_uses_20250919 的真实语义。
// 这里只按代码能确定的部分标注：两组工具被**分到两个策略**里处理。
const TOOLS_CLEARABLE_RESULTS = [
  ...SHELL_TOOL_NAMES,
  GLOB_TOOL_NAME,
  GREP_TOOL_NAME,
  FILE_READ_TOOL_NAME,
  WEB_FETCH_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME,
]

const TOOLS_CLEARABLE_USES = [
  FILE_EDIT_TOOL_NAME,
  FILE_WRITE_TOOL_NAME,
  NOTEBOOK_EDIT_TOOL_NAME,
]

// 策略的联合类型。两个成员的名字都带日期后缀（20250919 / 20251015），
// 这是 API beta 功能的版本化惯例：日期即版本号，
// 语义变更就换新日期，老客户端不会因为服务端升级而突然行为不同。
//
// 注意两个成员的形状差异很大：
//   clear_tool_uses_20250919  四个可选字段（trigger / keep / clear_at_least / exclude）
//   clear_thinking_20251015   只有一个 **必填** 的 keep
//
// 这个不对称不是笔误，而是两种操作的本质不同：
//   清工具结果 —— "什么时候清、清到什么程度" 都需要参数
//   清思考轮次 —— 只有一个自由度：留几轮
// Context management strategy types matching API documentation
export type ContextEditStrategy =
  | {
      type: 'clear_tool_uses_20250919'
      trigger?: {
        type: 'input_tokens'
        value: number
      }
      keep?: {
        type: 'tool_uses'
        value: number
      }
      clear_tool_inputs?: boolean | string[]
      exclude_tools?: string[]
      clear_at_least?: {
        type: 'input_tokens'
        value: number
      }
    }
  | {
      type: 'clear_thinking_20251015'
      keep: { type: 'thinking_turns'; value: number } | 'all'
    }

// Context management configuration wrapper
export type ContextManagementConfig = {
  edits: ContextEditStrategy[]
}

// ═══════════════════════════════════════════════════════════════
// getAPIContextManagement —— 唯一的导出函数
//
// 调用点只有一处：claude.ts 行 1633，在 paramsFromContext 里。
// 那处的条件展开很关键（claude.ts 行 1718）：
//
//     ...(contextManagement && useBetas &&
//        betasParams.includes(CONTEXT_MANAGEMENT_BETA_HEADER) && {
//          context_management: contextManagement,
//        }),
//
// 三个条件缺一不可。所以这个函数返回 undefined 是**有意义的返回值**，
// 不是"没算出东西"：undefined 会让整个字段不出现在请求里。
// 如果返回 { edits: [] }，条件仍然成立（空数组是真值），
// 就会发一个空的 context_management 出去 —— 那是多余且可能被拒的字段。
//
// 三个入参都是布尔开关，来自 claude.ts 的实时状态和 latch：
//   hasThinking           这次请求开没开思考
//   isRedactThinkingActive 是不是脱敏思考模式
//   clearAllThinking      thinkingClearLatched（空闲超 1 小时后为真）
// ═══════════════════════════════════════════════════════════════
// API-based microcompact implementation that uses native context management
export function getAPIContextManagement(options?: {
  hasThinking?: boolean
  isRedactThinkingActive?: boolean
  clearAllThinking?: boolean
}): ContextManagementConfig | undefined {
  const {
    hasThinking = false,
    isRedactThinkingActive = false,
    clearAllThinking = false,
  } = options ?? {}

  const strategies: ContextEditStrategy[] = []

// ═══ 策略一：清思考轮次 ═══
//
// 两个跳过条件，理由完全不同：
//   !hasThinking           没开思考，没东西可清
//   isRedactThinkingActive 脱敏模式下 thinking 块里没有模型可见内容，
//                          清它是无意义的操作（服务端也拿不到信息）
//
// 下面那个 keep 的三元是最值得看的一行，注释（79-81 行）解释得极细，
// 值得逐字翻译一遍：
//
//   "the API schema requires value >= 1, and omitting the edit
//    falls back to the model-policy default (often "all"),
//    which wouldn't clear."
//
// 意思是：需求是"把之前的思考全清掉"，但你**没法用 0 表达**——
// schema 要求 thinking_turns >= 1。而如果你干脆不发这个 edit，
// 服务端会回落到模型策略的默认值（通常是 'all'，即全部保留），
// 结果就是"你想清，它反而全留着"。
//
// 所以只能用 value: 1 —— "只留最近一轮"，语义上最接近"全清"的可表达值。
// 这是典型的"用 1 表达 0"：schema 的下界约束逼出来的写法。
  // Preserve thinking blocks in previous assistant turns. Skip when
  // redact-thinking is active — redacted blocks have no model-visible content.
  // When clearAllThinking is set (>1h idle = cache miss), keep only the last
  // thinking turn — the API schema requires value >= 1, and omitting the edit
  // falls back to the model-policy default (often "all"), which wouldn't clear.
// 这段注释是全文件信息密度最高的地方，它同时回答了三个问题：
// 为什么跳过脱敏、为什么不能省略、为什么是 1 而不是 0。
// 上面那段批注已经逐条翻译，这里不再重复。
//
// 补一个背景：clearAllThinking 的来源是 claude.ts 行 1446 的 latch ——
// 只有在"上次请求距今超过 1 小时"时才会置真。
// 因为空闲一小时意味着 prompt cache 肯定过期了，这时清掉旧 thinking
// 不会额外损失什么，反而省下大量输入 token。
  if (hasThinking && !isRedactThinkingActive) {
    strategies.push({
      type: 'clear_thinking_20251015',
      keep: clearAllThinking ? { type: 'thinking_turns', value: 1 } : 'all',
    })
  }

// ⚠ 分界线：工具清理是**内部功能**，外部构建到这里就返回了。
//
// 注意它返回的是 strategies（可能已经有 clear_thinking 那条），
// 而不是 undefined —— 也就是说"外部用户能用到思考清理，但用不到工具清理"。
// 两个策略的可见性不同，这个 if 就是分界。
//
// 顺带说明为什么用 USER_TYPE 判断而不是 feature()：
// USER_TYPE === 'ant' 是构建期 --define 的文本替换，
// 压缩器看到 `"external" !== 'ant'` 是常量真，会把整个 if 块连同
// 下面那 60 行一起删掉。效果和 feature() 等价，但不需要额外的特性开关。
  // Tool clearing strategies are ant-only
  if (process.env.USER_TYPE !== 'ant') {
    return strategies.length > 0 ? { edits: strategies } : undefined
  }

// 两个独立的环境变量开关，对应下面两个几乎一模一样的策略块。
//
// 为什么做成两个独立开关而不是一个：它们要能**分别**验证。
// 一个清"只读工具"，一个清"写类工具"，出问题时必须能单独关掉其中一个
// 来定位是哪类清理导致的质量下降。
//
// 这种"两个开关 + 两段重复代码"的写法看起来该抽象成循环，
// 但重复在这里是有意的：两段的字段不同（clear_tool_inputs vs exclude_tools），
// 抽成循环反而要靠 if 区分字段名，可读性更差。
  const useClearToolResults = isEnvTruthy(
    process.env.USE_API_CLEAR_TOOL_RESULTS,
  )
  const useClearToolUses = isEnvTruthy(process.env.USE_API_CLEAR_TOOL_USES)

  // If no tool clearing strategy is enabled, return early
  if (!useClearToolResults && !useClearToolUses) {
    return strategies.length > 0 ? { edits: strategies } : undefined
  }

// ═══ 策略二：清只读工具 ═══
//
// 三个字段构成一条完整的指令：
//   trigger       输入超过 180k 时触发
//   clear_at_least 一次至少清出 140k（180k - 40k）
//   clear_tool_inputs 只对这批工具动手
//
// 为什么要 clear_at_least 这个"下限"：如果不设，服务端可能每次
// 只在触发线上清一点点（刚降回 179k 就停），于是下一轮又触发。
// 反复编辑的代价（服务端要重算）可能比一次清多点更高。
// 140k 这个数字就是"一次清到位，别磨蹭"。
  if (useClearToolResults) {
    const triggerThreshold = process.env.API_MAX_INPUT_TOKENS
      ? parseInt(process.env.API_MAX_INPUT_TOKENS)
      : DEFAULT_MAX_INPUT_TOKENS
    const keepTarget = process.env.API_TARGET_INPUT_TOKENS
      ? parseInt(process.env.API_TARGET_INPUT_TOKENS)
      : DEFAULT_TARGET_INPUT_TOKENS

    const strategy: ContextEditStrategy = {
      type: 'clear_tool_uses_20250919',
      trigger: {
        type: 'input_tokens',
        value: triggerThreshold,
      },
// clear_at_least = 触发线 - 目标线，这个减法在代码里是直接写的表达式
// （不是常量），好处是改阈值时不会忘记同步改下限。
// 代价是可读性：读的人得自己算 180000 - 40000 = 140000。
      clear_at_least: {
        type: 'input_tokens',
        value: triggerThreshold - keepTarget,
      },
      clear_tool_inputs: TOOLS_CLEARABLE_RESULTS,
    }

    strategies.push(strategy)
  }

// ═══ 策略三：清写类工具 ═══
//
// ⚠ 这段和上面那段有 90% 的重复代码，唯一的实质差别是字段：
//
//     上面：clear_tool_inputs: TOOLS_CLEARABLE_RESULTS   （清这批）
//     这里：exclude_tools:     TOOLS_CLEARABLE_USES      （除了这批都清）
//
// 一个是白名单，一个是黑名单 —— 语义方向完全相反。
// 为什么要反过来：写类工具只有 3 个（edit / write / notebook_edit），
// 而 MCP 工具可能有上百个。如果也用白名单，就得枚举所有工具名，
// 每来一个新的 MCP 工具都要改代码。用"排除法"才能自动覆盖未知工具。
//
// 一条通用经验：**集合小而稳定时用白名单，集合大而开放时用黑名单。**
  if (useClearToolUses) {
    const triggerThreshold = process.env.API_MAX_INPUT_TOKENS
      ? parseInt(process.env.API_MAX_INPUT_TOKENS)
      : DEFAULT_MAX_INPUT_TOKENS
    const keepTarget = process.env.API_TARGET_INPUT_TOKENS
      ? parseInt(process.env.API_TARGET_INPUT_TOKENS)
      : DEFAULT_TARGET_INPUT_TOKENS

    const strategy: ContextEditStrategy = {
      type: 'clear_tool_uses_20250919',
      trigger: {
        type: 'input_tokens',
        value: triggerThreshold,
      },
      clear_at_least: {
        type: 'input_tokens',
        value: triggerThreshold - keepTarget,
      },
      exclude_tools: TOOLS_CLEARABLE_USES,
    }

    strategies.push(strategy)
  }

// 三个出口都走这一个表达式，`strategies.length > 0` 的意思是
// "一条策略都没构造出来就返回 undefined"。
//
// 为什么这个区分重要（再强调一次）：claude.ts 那边用的是
// `contextManagement &&` 来判断要不要发字段。空对象是真值，
// 会导致发一个 { edits: [] } 出去。返回 undefined 才能真正做到"不发"。
  return strategies.length > 0 ? { edits: strategies } : undefined
}
