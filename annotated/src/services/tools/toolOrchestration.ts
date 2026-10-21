// ═══════════════════════════════════════════════════════════════
//  tools/toolOrchestration：一轮里多个工具调用怎么排
// ═══════════════════════════════════════════════════════════════
//
//  188 行，核心只有一个函数 partitionToolCalls（第 91 行），规则两条：
//
//      连续的只读工具    →  合成一批，并发跑
//      非只读工具        →  各自一批，串行跑
//
//  「只读」由每个工具自己声明（isConcurrencySafe），不是猜的。
//  这个设计很关键：**并发安全性是工具的知识，不是调度器的知识。**
import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import { findToolByName, type ToolUseContext } from '../../Tool.js'
import type { AssistantMessage, Message } from '../../types/message.js'
import { all } from '../../utils/generators.js'
import { type MessageUpdateLazy, runToolUse } from './toolExecution.js'

// 【并发上限默认 10，可被环境变量覆盖】
//
//      parseInt(process.env.CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY || '', 10) || 10
//
//  这个写法用了 `|| 10` 而不是 `?? 10`：因为 parseInt 失败会返回 NaN，
//  而 NaN 是假值，`||` 能兜住它。用 `??` 就兜不住（NaN 不是 null/undefined）。
//
//  **这是 `||` 和 `??` 少数必须用 `||` 的场合：兜底值要覆盖 NaN。**
//
//  为什么默认是 10 而不是无限？因为每个并发工具都可能是个子进程
//  （Bash 调用），10 个已经是「能同时开 10 个 shell」的量级。
//  再高会让普通机器卡，而且模型很少一次发这么多只读调用。
function getMaxToolUseConcurrency(): number {
  return (
    parseInt(process.env.CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY || '', 10) || 10
  )
}

export type MessageUpdate = {
  message?: Message
  newContext: ToolUseContext
}

// 【runTools：一个 for 循环 + 两种跑法】
//
//  外层遍历批次，内层分两种：
//
//      isConcurrencySafe  →  runToolsConcurrently（并发，但要缓存 contextModifier）
//      else               →  runToolsSerially（串行，contextModifier 立刻生效）
//
//  为什么并发那条路要「缓存 contextModifier」？这是本文件最精妙的地方，
//  见第 42 行。
//
//  注意函数签名：AsyncGenerator<MessageUpdate, void> —— 它**边跑边吐消息**，
//  不是等全部跑完再返回。这样 UI 能在工具执行过程中就显示进度。
export async function* runTools(
  toolUseMessages: ToolUseBlock[],
  assistantMessages: AssistantMessage[],
  canUseTool: CanUseToolFn,
  toolUseContext: ToolUseContext,
): AsyncGenerator<MessageUpdate, void> {
  let currentContext = toolUseContext
  for (const { isConcurrencySafe, blocks } of partitionToolCalls(
    toolUseMessages,
    currentContext,
  )) {
    if (isConcurrencySafe) {
      const queuedContextModifiers: Record<
        string,
        ((context: ToolUseContext) => ToolUseContext)[]
      > = {}
      // Run read-only batch concurrently
      for await (const update of runToolsConcurrently(
        blocks,
        assistantMessages,
        canUseTool,
        currentContext,
      )) {
//       // 【并发批里 contextModifier 必须排队，不能立刻应用 —— 原因很硬】
//       //
//       //  串行批里，每个工具的 contextModifier 立刻作用到 currentContext 上，
//       //  下一个工具看到的是更新后的上下文。这是大家想要的语义。
//       //
//       //  但并发批不行：三个工具同时跑，如果每个都「立刻」改 currentContext，
//       //  谁先改谁后改取决于谁先完成 —— **结果不确定**。
//       //
//       //  所以这里改成：
//       //
//       //      1. 并发跑，把所有 modifier 按 toolUseID 收集起来
//       //      2. 全部跑完之后，**按 blocks 的顺序**依次应用
//       //
//       //  第 54 行那个 `for (const block of blocks)` 就是在按原始顺序回放。
//       //
//       //  这是一个通用原则：**并发执行 + 有序提交。** 执行阶段可以乱序，
//       //  但状态变更必须按确定的顺序落地，否则同一份输入会得到不同结果。
//       //
//       //  注意 yield 的是 currentContext（旧值），因为这时还没应用 modifier ——
//       //  这是诚实的：告诉消费方「这个工具的结果出来了，但上下文还没变」。
        if (update.contextModifier) {
          const { toolUseID, modifyContext } = update.contextModifier
          if (!queuedContextModifiers[toolUseID]) {
            queuedContextModifiers[toolUseID] = []
          }
          queuedContextModifiers[toolUseID].push(modifyContext)
        }
        yield {
          message: update.message,
          newContext: currentContext,
        }
      }
      for (const block of blocks) {
        const modifiers = queuedContextModifiers[block.id]
        if (!modifiers) {
          continue
        }
        for (const modifier of modifiers) {
          currentContext = modifier(currentContext)
        }
      }
      yield { newContext: currentContext }
    } else {
      // Run non-read-only batch serially
      for await (const update of runToolsSerially(
        blocks,
        assistantMessages,
        canUseTool,
        currentContext,
      )) {
        if (update.newContext) {
          currentContext = update.newContext
        }
        yield {
          message: update.message,
          newContext: currentContext,
        }
      }
    }
  }
}

type Batch = { isConcurrencySafe: boolean; blocks: ToolUseBlock[] }

/**
 * Partition tool calls into batches where each batch is either:
 * 1. A single non-read-only tool, or
 * 2. Multiple consecutive read-only tools
 */
// 【partitionToolCalls：reduce 出来的分批，规则只有两条】
//
//      if (isConcurrencySafe && 上一批也是并发的) → 塞进上一批
//      else                                      → 开新批
//
//  所以「连续」是关键词：
//
//      [读A] [读B] [写C] [读D]
//      → 批次1: [读A, 读B]  批次2: [写C]  批次3: [读D]
//
//  注意 [读D] **不能**和 [读A, 读B] 合并，因为中间隔了写 C。
//  这是必须的：读 D 可能依赖写 C 的结果。
//
//  第 98 行那个判断里有个细节：先 safeParse 再调 isConcurrencySafe，
//  **解析失败就直接当作不安全**。因为被判为「并发安全」的代价是
//  「可能和其他工具并行跑」，而解析都失败的工具根本不知道自己要干什么，
//  绝对不能并发。
//
//  第 102 行的 catch 同理，注释写得很直接：
//
//      If isConcurrencySafe throws (e.g., due to shell-quote parse failure),
//      treat as not concurrency-safe to be conservative
//
//  **默认值选「安全的那一边」** —— 这里的安全就是串行。
function partitionToolCalls(
  toolUseMessages: ToolUseBlock[],
  toolUseContext: ToolUseContext,
): Batch[] {
  return toolUseMessages.reduce((acc: Batch[], toolUse) => {
    const tool = findToolByName(toolUseContext.options.tools, toolUse.name)
    const parsedInput = tool?.inputSchema.safeParse(toolUse.input)
    const isConcurrencySafe = parsedInput?.success
      ? (() => {
          try {
            return Boolean(tool?.isConcurrencySafe(parsedInput.data))
          } catch {
            // If isConcurrencySafe throws (e.g., due to shell-quote parse failure),
            // treat as not concurrency-safe to be conservative
            return false
          }
        })()
      : false
    if (isConcurrencySafe && acc[acc.length - 1]?.isConcurrencySafe) {
      acc[acc.length - 1]!.blocks.push(toolUse)
    } else {
      acc.push({ isConcurrencySafe, blocks: [toolUse] })
    }
    return acc
  }, [])
}

async function* runToolsSerially(
  toolUseMessages: ToolUseBlock[],
  assistantMessages: AssistantMessage[],
  canUseTool: CanUseToolFn,
  toolUseContext: ToolUseContext,
): AsyncGenerator<MessageUpdate, void> {
  let currentContext = toolUseContext

  for (const toolUse of toolUseMessages) {
    toolUseContext.setInProgressToolUseIDs(prev =>
      new Set(prev).add(toolUse.id),
    )
    for await (const update of runToolUse(
      toolUse,
      assistantMessages.find(_ =>
        _.message.content.some(
          _ => _.type === 'tool_use' && _.id === toolUse.id,
        ),
      )!,
      canUseTool,
      currentContext,
    )) {
      if (update.contextModifier) {
        currentContext = update.contextModifier.modifyContext(currentContext)
      }
      yield {
        message: update.message,
        newContext: currentContext,
      }
    }
    markToolUseAsComplete(toolUseContext, toolUse.id)
  }
}

// 【runToolsConcurrently：yield* all(...) —— 一个自研的并发合并生成器】
//
//  `all` 来自 utils/generators.js，作用是把「N 个异步生成器」合并成
//  一个生成器，并发数受限。这在标准库里没有，所以自己实现了。
//
//  注意它和 Promise.all 的区别：Promise.all 要等所有结果才返回，
//  而这里**谁先产出就先吐谁**。这就是为什么工具执行能做到「边跑边显示」。
//
//  两个传参的细节：
//
//      第 160 行  进函数就 setInProgressToolUseIDs，标记「我开始跑了」
//                 这是给 UI 用的：让用户看到哪个工具正在跑
//      第 175 行  getMaxToolUseConcurrency() —— 上限在这里生效
//
//  注意 runToolsSerially 里也有同样的两句（127 / 148 行），
//  也就是「标记进行中」和「标记完成」是两种跑法共同的职责，
//  而不是调度器统一管的。**每个执行单元自己报告状态**，比外层猜更可靠。
async function* runToolsConcurrently(
  toolUseMessages: ToolUseBlock[],
  assistantMessages: AssistantMessage[],
  canUseTool: CanUseToolFn,
  toolUseContext: ToolUseContext,
): AsyncGenerator<MessageUpdateLazy, void> {
  yield* all(
    toolUseMessages.map(async function* (toolUse) {
      toolUseContext.setInProgressToolUseIDs(prev =>
        new Set(prev).add(toolUse.id),
      )
      yield* runToolUse(
        toolUse,
        assistantMessages.find(_ =>
          _.message.content.some(
            _ => _.type === 'tool_use' && _.id === toolUse.id,
          ),
        )!,
        canUseTool,
        toolUseContext,
      )
      markToolUseAsComplete(toolUseContext, toolUse.id)
    }),
    getMaxToolUseConcurrency(),
  )
}

function markToolUseAsComplete(
  toolUseContext: ToolUseContext,
  toolUseID: string,
) {
  toolUseContext.setInProgressToolUseIDs(prev => {
    const next = new Set(prev)
    next.delete(toolUseID)
    return next
  })
}
