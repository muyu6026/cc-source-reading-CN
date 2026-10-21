// ═══════════════════════════════════════════════════════════════
//  tools/StreamingToolExecutor：一边流式收工具调用，一边就开始执行
// ═══════════════════════════════════════════════════════════════
//
//  它和 toolOrchestration 的区别是**时机**：
//
//      toolOrchestration        等模型把整条消息吐完，再开始跑工具
//      StreamingToolExecutor    模型还在吐，第一个工具就已经开始跑了
//
//  收益是「省掉一次完整的模型输出时间」—— 模型输出 2000 token 可能要十几秒，
//  而第一个工具调用在第 200 个 token 就出现了。
//
//  代价是复杂度全压在「状态机」上：四个状态、四个取消原因、按序输出。
import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import {
  createUserMessage,
  REJECT_MESSAGE,
  withMemoryCorrectionHint,
} from 'src/utils/messages.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import { findToolByName, type Tools, type ToolUseContext } from '../../Tool.js'
import { BASH_TOOL_NAME } from '../../tools/BashTool/toolName.js'
import type { AssistantMessage, Message } from '../../types/message.js'
import { createChildAbortController } from '../../utils/abortController.js'
import { runToolUse } from './toolExecution.js'

type MessageUpdate = {
  message?: Message
  newContext?: ToolUseContext
}

type ToolStatus = 'queued' | 'executing' | 'completed' | 'yielded'

type TrackedTool = {
  id: string
  block: ToolUseBlock
  assistantMessage: AssistantMessage
  status: ToolStatus
  isConcurrencySafe: boolean
  promise?: Promise<void>
  results?: Message[]
  // Progress messages are stored separately and yielded immediately
  pendingProgress: Message[]
  contextModifiers?: Array<(context: ToolUseContext) => ToolUseContext>
}

// 【三条规则写在类注释里，第三条最难】
//
//      并发安全的工具可以互相并行
//      非并发工具必须独占（不能有任何别的工具在跑）
//      结果按「工具被接收的顺序」输出，不是按完成顺序
//
//  第三条是核心。模型吐出的顺序是 [A, B]，但 B 可能先跑完。
//  如果按完成顺序输出，模型看到的是 [B, A] —— 而 tool_result 的顺序
//  必须和 tool_use 的顺序一致，否则 API 直接 400。
//
//  所以内部一定有个「缓冲 + 按序放行」的机制，见第 453 行。
/**
 * Executes tools as they stream in with concurrency control.
 * - Concurrent-safe tools can execute in parallel with other concurrent-safe tools
 * - Non-concurrent tools must execute alone (exclusive access)
 * - Results are buffered and emitted in the order tools were received
 */
export class StreamingToolExecutor {
  private tools: TrackedTool[] = []
  private toolUseContext: ToolUseContext
  private hasErrored = false
  private erroredToolDescription = ''
// 【siblingAbortController：一个只管兄弟、不管自己的中断器】
//
//  原注释把边界划得很清楚：
//
//      Fires when a Bash tool errors so sibling subprocesses die immediately
//      instead of running to completion.
//      Aborting this does NOT abort the parent — query.ts won't end the turn.
//
//  意思是：一个工具报错时，同时跑的其他工具要立刻停（否则白跑、
//  还可能产生副作用），但**整个回合不能结束** —— 模型还要看到错误、
//  还要继续对话。
//
//  这是一个「局部取消」的典型实现：从父 controller 派生一个子 controller，
//  子可以独立 abort，父不受影响。反过来父 abort 会级联到子。
//
//  判据：需要「只取消其中一部分」时，从父派生而不是新建一个无关的。
  // Child of toolUseContext.abortController. Fires when a Bash tool errors
  // so sibling subprocesses die immediately instead of running to completion.
  // Aborting this does NOT abort the parent — query.ts won't end the turn.
  private siblingAbortController: AbortController
  private discarded = false
  // Signal to wake up getRemainingResults when progress is available
  private progressAvailableResolve?: () => void

  constructor(
    private readonly toolDefinitions: Tools,
    private readonly canUseTool: CanUseToolFn,
    toolUseContext: ToolUseContext,
  ) {
    this.toolUseContext = toolUseContext
    this.siblingAbortController = createChildAbortController(
      toolUseContext.abortController,
    )
  }

  /**
   * Discards all pending and in-progress tools. Called when streaming fallback
   * occurs and results from the failed attempt should be abandoned.
   * Queued tools won't start, and in-progress tools will receive synthetic errors.
   */
// 【discard：流式降级时把这一批全部作废】
//
//  注释说清了两种处理：
//
//      Queued tools won't start        排队的直接不跑了
//      in-progress tools will receive synthetic errors   跑着的收到合成错误
//
//  为什么要合成错误而不是「静默丢弃」？因为每个 tool_use 都**必须**有一个
//  对应的 tool_result，否则下一次请求就是 400（tool_use 没有配对的 result）。
//
//  所以「取消」在协议层面不是一个动作，而是「补一条失败的结果」。
//  这也是 getAbortReason + createSyntheticErrorMessage 存在的理由。
  discard(): void {
    this.discarded = true
  }

  /**
   * Add a tool to the execution queue. Will start executing immediately if conditions allow.
   */
  addTool(block: ToolUseBlock, assistantMessage: AssistantMessage): void {
    const toolDefinition = findToolByName(this.toolDefinitions, block.name)
    if (!toolDefinition) {
      this.tools.push({
        id: block.id,
        block,
        assistantMessage,
        status: 'completed',
        isConcurrencySafe: true,
        pendingProgress: [],
        results: [
          createUserMessage({
            content: [
              {
                type: 'tool_result',
                content: `<tool_use_error>Error: No such tool available: ${block.name}</tool_use_error>`,
                is_error: true,
                tool_use_id: block.id,
              },
            ],
            toolUseResult: `Error: No such tool available: ${block.name}`,
            sourceToolAssistantUUID: assistantMessage.uuid,
          }),
        ],
      })
      return
    }

    const parsedInput = toolDefinition.inputSchema.safeParse(block.input)
    const isConcurrencySafe = parsedInput?.success
      ? (() => {
          try {
            return Boolean(toolDefinition.isConcurrencySafe(parsedInput.data))
          } catch {
            return false
          }
        })()
      : false
    this.tools.push({
      id: block.id,
      block,
      assistantMessage,
      status: 'queued',
      isConcurrencySafe,
      pendingProgress: [],
    })

    void this.processQueue()
  }

  /**
   * Check if a tool can execute based on current concurrency state
   */
// 【canExecuteTool：四行，但完整表达了并发规则】
//
//      executingTools.length === 0                                    → 可以跑
//      isConcurrencySafe && executingTools.every(t => t.isConcurrencySafe) → 可以跑
//
//  拆开看是两种情况：
//
//      1. 现在没有任何工具在跑        → 谁都可以开始
//      2. 我要跑的是并发安全的，而且**所有**在跑的都是并发安全的 → 可以
//
//  第 2 条里那个 every 是关键：只要有一个非并发工具在跑，新的并发工具
//  也得等。因为「非并发」的意思是「我要独占」，它不允许任何东西和它并行。
//
//  注意这里没有「队列」这个概念 —— 它是个纯判断函数，由 processQueue
//  在每次状态变化后重新评估。**声明式判断 + 循环重试，比手写状态迁移可靠。**
  private canExecuteTool(isConcurrencySafe: boolean): boolean {
    const executingTools = this.tools.filter(t => t.status === 'executing')
    return (
      executingTools.length === 0 ||
      (isConcurrencySafe && executingTools.every(t => t.isConcurrencySafe))
    )
  }

  /**
   * Process the queue, starting tools when concurrency conditions allow
   */
// 【processQueue 是串行的，那并发从哪来？答案在 addTool 的 void】
//
//  先看这个循环：它 `await this.executeTool(tool)` —— 也就是**一个 pass 里
//  工具是一个接一个跑的**。单看这段会以为根本没有并发。
//
//  并发出现在第 123 行：
//
//      addTool(...) { ...; void this.processQueue() }
//
//  每个新工具到达都会**踢一次独立的 pass**，而且不等它。于是：
//
//      工具1 到达 → pass A 开始跑工具1（在这里 await 住）
//      工具2 到达 → pass B 开始；此时工具1 status='executing'，
//                   如果两个都是并发安全的，canExecuteTool 返回 true
//                   → pass B 开跑工具2
//
//  所以并发不是「一个循环里同时跑」，而是**多个交错的 pass 各跑一个**。
//
//  这种写法要正确，必须有一条硬保证：**同一个工具不能被两个 pass 启动。**
//  保证来自 executeTool 的第二行（第 266 行）：
//
//      tool.status = 'executing'      ← 同步执行，在任何 await 之前
//
//  以及循环开头的 `if (tool.status !== 'queued') continue`。
//  因为 JS 是单线程，`status` 的读—改之间不会被打断，这个「状态翻转」
//  就充当了锁。**用同步的状态变更当互斥量，是 JS 里最常见的并发原语。**
//
//  再说那个 break：
//
//      遇到不能跑的工具时，如果是**非并发**的 → break
//      如果是并发的 → 不 break，继续看下一个
//
//  因为非并发工具要求「独占 + 保序」，后面的任何工具都不能越过它；
//  而并发工具之间没有顺序要求（结果顺序由缓冲层负责），跳过它没关系。
  private async processQueue(): Promise<void> {
    for (const tool of this.tools) {
      if (tool.status !== 'queued') continue

      if (this.canExecuteTool(tool.isConcurrencySafe)) {
        await this.executeTool(tool)
      } else {
        // Can't execute this tool yet, and since we need to maintain order for non-concurrent tools, stop here
        if (!tool.isConcurrencySafe) break
      }
    }
  }

  private createSyntheticErrorMessage(
    toolUseId: string,
    reason: 'sibling_error' | 'user_interrupted' | 'streaming_fallback',
    assistantMessage: AssistantMessage,
  ): Message {
    // For user interruptions (ESC to reject), use REJECT_MESSAGE so the UI shows
    // "User rejected edit" instead of "Error editing file"
    if (reason === 'user_interrupted') {
      return createUserMessage({
        content: [
          {
            type: 'tool_result',
            content: withMemoryCorrectionHint(REJECT_MESSAGE),
            is_error: true,
            tool_use_id: toolUseId,
          },
        ],
        toolUseResult: 'User rejected tool use',
        sourceToolAssistantUUID: assistantMessage.uuid,
      })
    }
    if (reason === 'streaming_fallback') {
      return createUserMessage({
        content: [
          {
            type: 'tool_result',
            content:
              '<tool_use_error>Error: Streaming fallback - tool execution discarded</tool_use_error>',
            is_error: true,
            tool_use_id: toolUseId,
          },
        ],
        toolUseResult: 'Streaming fallback - tool execution discarded',
        sourceToolAssistantUUID: assistantMessage.uuid,
      })
    }
    const desc = this.erroredToolDescription
    const msg = desc
      ? `Cancelled: parallel tool call ${desc} errored`
      : 'Cancelled: parallel tool call errored'
    return createUserMessage({
      content: [
        {
          type: 'tool_result',
          content: `<tool_use_error>${msg}</tool_use_error>`,
          is_error: true,
          tool_use_id: toolUseId,
        },
      ],
      toolUseResult: msg,
      sourceToolAssistantUUID: assistantMessage.uuid,
    })
  }

  /**
   * Determine why a tool should be cancelled.
   */
// 【getAbortReason：四个取消原因，检查顺序就是优先级】
//
//      discarded       →  streaming_fallback（整批作废，最高优先级）
//      hasErrored      →  sibling_error（兄弟报错了）
//      aborted         →  user_interrupted（用户按了 ESC）
//      都没有          →  null（继续跑）
//
//  为什么 discarded 要排第一？因为它代表「这一批根本不该存在」
//  （流式降级重试了），此时就算同时有兄弟错误，也应该报 streaming_fallback
//  —— 否则用户会看到一个莫名其妙的「兄弟报错」。
//
//  第 223 行那个分支很细：interrupt 的原因分两种工具行为
//
//      interruptBehavior === 'cancel'  →  取消（如正在跑的 Bash）
//      interruptBehavior === 'block'   →  不取消（等它跑完）
//
//  因为有些工具中途停下会留下半成品（写文件写一半），而有些可以安全中断。
//  **「能不能被中断」是工具自己的知识**，和 isConcurrencySafe 是同一个思路。
  private getAbortReason(
    tool: TrackedTool,
  ): 'sibling_error' | 'user_interrupted' | 'streaming_fallback' | null {
    if (this.discarded) {
      return 'streaming_fallback'
    }
    if (this.hasErrored) {
      return 'sibling_error'
    }
    if (this.toolUseContext.abortController.signal.aborted) {
      // 'interrupt' means the user typed a new message while tools were
      // running. Only cancel tools whose interruptBehavior is 'cancel';
      // 'block' tools shouldn't reach here (abort isn't fired).
      if (this.toolUseContext.abortController.signal.reason === 'interrupt') {
        return this.getToolInterruptBehavior(tool) === 'cancel'
          ? 'user_interrupted'
          : null
      }
      return 'user_interrupted'
    }
    return null
  }

  private getToolInterruptBehavior(tool: TrackedTool): 'cancel' | 'block' {
    const definition = findToolByName(this.toolDefinitions, tool.block.name)
    if (!definition?.interruptBehavior) return 'block'
    try {
      return definition.interruptBehavior()
    } catch {
      return 'block'
    }
  }

  private getToolDescription(tool: TrackedTool): string {
    const input = tool.block.input as Record<string, unknown> | undefined
    const summary = input?.command ?? input?.file_path ?? input?.pattern ?? ''
    if (typeof summary === 'string' && summary.length > 0) {
      const truncated =
        summary.length > 40 ? summary.slice(0, 40) + '\u2026' : summary
      return `${tool.block.name}(${truncated})`
    }
    return tool.block.name
  }

  private updateInterruptibleState(): void {
    const executing = this.tools.filter(t => t.status === 'executing')
    this.toolUseContext.setHasInterruptibleToolInProgress?.(
      executing.length > 0 &&
        executing.every(t => this.getToolInterruptBehavior(t) === 'cancel'),
    )
  }

  /**
   * Execute a tool and collect its results
   */
  private async executeTool(tool: TrackedTool): Promise<void> {
    tool.status = 'executing'
    this.toolUseContext.setInProgressToolUseIDs(prev =>
      new Set(prev).add(tool.id),
    )
    this.updateInterruptibleState()

    const messages: Message[] = []
    const contextModifiers: Array<(context: ToolUseContext) => ToolUseContext> =
      []

    const collectResults = async () => {
      // If already aborted (by error or user), generate synthetic error block instead of running the tool
      const initialAbortReason = this.getAbortReason(tool)
      if (initialAbortReason) {
        messages.push(
          this.createSyntheticErrorMessage(
            tool.id,
            initialAbortReason,
            tool.assistantMessage,
          ),
        )
        tool.results = messages
        tool.contextModifiers = contextModifiers
        tool.status = 'completed'
        this.updateInterruptibleState()
        return
      }

      // Per-tool child controller. Lets siblingAbortController kill running
      // subprocesses (Bash spawns listen to this signal) when a Bash error
      // cascades. Permission-dialog rejection also aborts this controller
      // (PermissionContext.ts cancelAndAbort) — that abort must bubble up to
      // the query controller so the query loop's post-tool abort check ends
      // the turn. Without bubble-up, ExitPlanMode "clear context + auto"
      // sends REJECT_MESSAGE to the model instead of aborting (#21056 regression).
      const toolAbortController = createChildAbortController(
        this.siblingAbortController,
      )
      toolAbortController.signal.addEventListener(
        'abort',
        () => {
          if (
            toolAbortController.signal.reason !== 'sibling_error' &&
            !this.toolUseContext.abortController.signal.aborted &&
            !this.discarded
          ) {
            this.toolUseContext.abortController.abort(
              toolAbortController.signal.reason,
            )
          }
        },
        { once: true },
      )

      const generator = runToolUse(
        tool.block,
        tool.assistantMessage,
        this.canUseTool,
        { ...this.toolUseContext, abortController: toolAbortController },
      )

      // Track if this specific tool has produced an error result.
      // This prevents the tool from receiving a duplicate "sibling error"
      // message when it is the one that caused the error.
      let thisToolErrored = false

      for await (const update of generator) {
        // Check if we were aborted by a sibling tool error or user interruption.
        // Only add the synthetic error if THIS tool didn't produce the error.
        const abortReason = this.getAbortReason(tool)
        if (abortReason && !thisToolErrored) {
          messages.push(
            this.createSyntheticErrorMessage(
              tool.id,
              abortReason,
              tool.assistantMessage,
            ),
          )
          break
        }

        const isErrorResult =
          update.message.type === 'user' &&
          Array.isArray(update.message.message.content) &&
          update.message.message.content.some(
            _ => _.type === 'tool_result' && _.is_error === true,
          )

        if (isErrorResult) {
          thisToolErrored = true
          // Only Bash errors cancel siblings. Bash commands often have implicit
          // dependency chains (e.g. mkdir fails → subsequent commands pointless).
          // Read/WebFetch/etc are independent — one failure shouldn't nuke the rest.
          if (tool.block.name === BASH_TOOL_NAME) {
            this.hasErrored = true
            this.erroredToolDescription = this.getToolDescription(tool)
            this.siblingAbortController.abort('sibling_error')
          }
        }

        if (update.message) {
          // Progress messages go to pendingProgress for immediate yielding
          if (update.message.type === 'progress') {
            tool.pendingProgress.push(update.message)
            // Signal that progress is available
            if (this.progressAvailableResolve) {
              this.progressAvailableResolve()
              this.progressAvailableResolve = undefined
            }
          } else {
            messages.push(update.message)
          }
        }
        if (update.contextModifier) {
          contextModifiers.push(update.contextModifier.modifyContext)
        }
      }
      tool.results = messages
      tool.contextModifiers = contextModifiers
      tool.status = 'completed'
      this.updateInterruptibleState()

      // NOTE: we currently don't support context modifiers for concurrent
      //       tools. None are actively being used, but if we want to use
      //       them in concurrent tools, we need to support that here.
      if (!tool.isConcurrencySafe && contextModifiers.length > 0) {
        for (const modifier of contextModifiers) {
          this.toolUseContext = modifier(this.toolUseContext)
        }
      }
    }

    const promise = collectResults()
    tool.promise = promise

    // Process more queue when done
    void promise.finally(() => {
      void this.processQueue()
    })
  }

  /**
   * Get any completed results that haven't been yielded yet (non-blocking)
   * Maintains order where necessary
   * Also yields any pending progress messages immediately
   */
  *getCompletedResults(): Generator<MessageUpdate, void> {
    if (this.discarded) {
      return
    }

    for (const tool of this.tools) {
      // Always yield pending progress messages immediately, regardless of tool status
      while (tool.pendingProgress.length > 0) {
        const progressMessage = tool.pendingProgress.shift()!
        yield { message: progressMessage, newContext: this.toolUseContext }
      }

      if (tool.status === 'yielded') {
        continue
      }

      if (tool.status === 'completed' && tool.results) {
        tool.status = 'yielded'

        for (const message of tool.results) {
          yield { message, newContext: this.toolUseContext }
        }

        markToolUseAsComplete(this.toolUseContext, tool.id)
      } else if (tool.status === 'executing' && !tool.isConcurrencySafe) {
        break
      }
    }
  }

  /**
   * Check if any tool has pending progress messages
   */
  private hasPendingProgress(): boolean {
    return this.tools.some(t => t.pendingProgress.length > 0)
  }

  /**
   * Wait for remaining tools and yield their results as they complete
   * Also yields progress messages as they become available
   */
  async *getRemainingResults(): AsyncGenerator<MessageUpdate, void> {
    if (this.discarded) {
      return
    }

    while (this.hasUnfinishedTools()) {
      await this.processQueue()

      for (const result of this.getCompletedResults()) {
        yield result
      }

      // If we still have executing tools but nothing completed, wait for any to complete
      // OR for progress to become available
      if (
        this.hasExecutingTools() &&
        !this.hasCompletedResults() &&
        !this.hasPendingProgress()
      ) {
        const executingPromises = this.tools
          .filter(t => t.status === 'executing' && t.promise)
          .map(t => t.promise!)

        // Also wait for progress to become available
        const progressPromise = new Promise<void>(resolve => {
          this.progressAvailableResolve = resolve
        })

        if (executingPromises.length > 0) {
          await Promise.race([...executingPromises, progressPromise])
        }
      }
    }

    for (const result of this.getCompletedResults()) {
      yield result
    }
  }

  /**
   * Check if there are any completed results ready to yield
   */
  private hasCompletedResults(): boolean {
    return this.tools.some(t => t.status === 'completed')
  }

  /**
   * Check if there are any tools still executing
   */
  private hasExecutingTools(): boolean {
    return this.tools.some(t => t.status === 'executing')
  }

  /**
   * Check if there are any unfinished tools
   */
  private hasUnfinishedTools(): boolean {
    return this.tools.some(t => t.status !== 'yielded')
  }

  /**
   * Get the current tool use context (may have been modified by context modifiers)
   */
  getUpdatedContext(): ToolUseContext {
    return this.toolUseContext
  }
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
