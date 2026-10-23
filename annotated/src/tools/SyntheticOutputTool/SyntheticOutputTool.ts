import { Ajv } from 'ajv'
import { z } from 'zod/v4'
import type { Tool, ToolInputJSONSchema } from '../../Tool.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../utils/errors.js'
import { lazySchema } from '../../utils/lazySchema.js'
import type { PermissionResult } from '../../utils/permissions/PermissionResult.js'
import { jsonStringify } from '../../utils/slowOperations.js'

// Allow any input object since the schema is provided dynamically
const inputSchema = lazySchema(() => z.object({}).passthrough())
// passthrough + 空对象：schema 由调用方动态提供，模板版工具不预设任何输入约束。
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.string().describe('Structured output tool result'),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>
// Output 是 string——结构化输出模式下，模型的「最终回答」本身以 JSON 字符串形态在工具里流转。

export const SYNTHETIC_OUTPUT_TOOL_NAME = 'StructuredOutput'
// SYNTHETIC_OUTPUT_TOOL_NAME = 'StructuredOutput' —— 对模型暴露的名字与内部常量刻意不同。

export function isSyntheticOutputToolEnabled(opts: {
  isNonInteractiveSession: boolean
}): boolean {
  return opts.isNonInteractiveSession
// 启用条件只有一个：非交互会话（SDK / CI / 工作流脚本）。交互式 CLI 用不到它——那边模型直接说话就是输出。
}

export const SyntheticOutputTool = buildTool({
  isMcp: false,
  isEnabled() {
    // This tool is only created when conditions are met (see main.tsx where
    // isSyntheticOutputToolEnabled() gates tool creation). Once created, always enabled.
    return true
// isEnabled 恒真：创建时机已在 main.tsx 用 isSyntheticOutputToolEnabled 把过关，造出来就等于启用。
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  isOpenWorld() {
    return false
// isOpenWorld: false —— 不碰外部世界，纯数据回传，权限系统没有可拦的东西。
  },
  name: SYNTHETIC_OUTPUT_TOOL_NAME,
  searchHint: 'return the final response as structured JSON',
  maxResultSizeChars: 100_000,
  async description(): Promise<string> {
    return 'Return structured output in the requested format'
  },
  async prompt(): Promise<string> {
    return `Use this tool to return your final response in the requested structured format. You MUST call this tool exactly once at the end of your response to provide the structured output.`
// prompt 是命令句：MUST call this tool exactly once at the end——结构化输出模式下模型不允许「直接回答」，必须落在这个工具上。
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  async call(input) {
    // The tool just validates and returns the input as the structured output
// 模板版 call 不校验：原样回传输入，真正的 schema 校验在 createSyntheticOutputTool 造出的实例里（下面覆盖了 call）。
    return {
      data: 'Structured output provided successfully',
      structured_output: input,
    }
  },
  async checkPermissions(input): Promise<PermissionResult> {
    // Always allow this tool - it's just returning data
    return {
      behavior: 'allow',
      updatedInput: input,
    }
// checkPermissions 恒 allow：数据通道没有副作用。
  },
  // Minimal UI implementations - this tool is for non-interactive SDK/CLI use
// UI 全家桶都是极简实现——这个工具给非交互场景用，渲染只是兜底。
  renderToolUseMessage(input: Record<string, unknown>) {
    const keys = Object.keys(input)
    if (keys.length === 0) return null
    if (keys.length <= 3) {
      return keys.map(k => `${k}: ${jsonStringify(input[k])}`).join(', ')
    }
    return `${keys.length} fields: ${keys.slice(0, 3).join(', ')}…`
// renderToolUseMessage 按字段数分档：0 个不显示，≤3 个逐字段列，更多只报字段数加前三个字段名。
  },
  renderToolUseRejectedMessage() {
    return 'Structured output rejected'
  },
  renderToolUseErrorMessage() {
    return 'Structured output error'
  },
  renderToolUseProgressMessage() {
    return null
  },
  renderToolResultMessage(output: string) {
    return output
  },
  mapToolResultToToolResultBlockParam(content: string, toolUseID: string) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result' as const,
      content,
    }
  },
// mapToolResultToToolResultBlockParam 原样透传 content 字符串——校验过的结构化数据直接进 transcript。
} satisfies ToolDef<InputSchema, Output>)

type CreateResult = { tool: Tool<InputSchema> } | { error: string }

// Workflow scripts call agent({schema: BUGS_SCHEMA}) 30-80 times per run with
// the same schema object reference. Without caching, each call does
// new Ajv() + validateSchema() + compile() (~1.4ms of JIT codegen). Identity
// cache brings 80-call workflows from ~110ms to ~4ms Ajv overhead.
// WeakMap 身份缓存：工作流脚本反复用同一个 schema 对象调 agent({schema})，80 次调用只编译 1 次；schema 对象被回收时缓存自动消失，不漏内存。
const toolCache = new WeakMap<object, CreateResult>()

/**
 * Create a SyntheticOutputTool configured with the given JSON schema.
 * Returns {tool} on success or {error} with Ajv's diagnostic message
 * (e.g. "data/properties/bugs should be object") on invalid schema.
 */
export function createSyntheticOutputTool(
  jsonSchema: Record<string, unknown>,
// 工厂函数返回 {tool} 或 {error}：schema 本身不合法时（比如 bugs 写成 string），把 Ajv 的诊断原文抛回去，调用方知道改哪。
): CreateResult {
  const cached = toolCache.get(jsonSchema)
  if (cached) return cached

  const result = buildSyntheticOutputTool(jsonSchema)
  toolCache.set(jsonSchema, result)
  return result
// 缓存命中直接返回——注意 success 和 error 两种结果都进缓存，坏 schema 不会每次重复编译。
}

function buildSyntheticOutputTool(
  jsonSchema: Record<string, unknown>,
): CreateResult {
  try {
    const ajv = new Ajv({ allErrors: true })
    const isValidSchema = ajv.validateSchema(jsonSchema)
    if (!isValidSchema) {
      return { error: ajv.errorsText(ajv.errors) }
// validateSchema 先验 schema 再 compile：compile 阶段的错误信息太底层，validateSchema 的才指向 data/properties/bugs 这种路径。
    }
// compile 出的 validateSchema 闭包捕获 allErrors: true——一次校验报全部错，不是首个即停。
    const validateSchema = ajv.compile(jsonSchema)

    return {
      tool: {
        ...SyntheticOutputTool,
        inputJSONSchema: jsonSchema as ToolInputJSONSchema,
        async call(input) {
          const isValid = validateSchema(input)
          if (!isValid) {
            const errors = validateSchema.errors
              ?.map(e => `${e.instancePath || 'root'}: ${e.message}`)
              .join(', ')
            throw new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
              `Output does not match required schema: ${errors}`,
              `StructuredOutput schema mismatch: ${(errors ?? '').slice(0, 150)}`,
            )
// 校验失败抛 TelemetrySafeError：对外文案只带前 150 字符摘要，内部文案带全量——兼顾可调试与不把用户输入写进日志。
          }
          return {
            data: 'Structured output provided successfully',
            structured_output: input,
          }
        },
      },
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
// 兜底 catch：Ajv 编译期异常（如循环引用）也翻成 {error} 返回，工厂函数永不抛。
  }
}
