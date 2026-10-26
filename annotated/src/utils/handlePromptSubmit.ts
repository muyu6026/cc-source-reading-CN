// 文件级：本文件是「用户提交提示词」的总入口（handlePromptSubmit），负责把一行输入分流到退出命令、本地 JSX 即时命令、队列、或直接执行。真正的执行逻辑在核心函数 executeUserInput 里，统一走 processUserInput → onQuery 的循环。
import type { UUID } from 'crypto'
import { logEvent } from 'src/services/analytics/index.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from 'src/services/analytics/metadata.js'
import { type Command, getCommandName, isCommandEnabled } from '../commands.js'
import { selectableUserMessagesFilter } from '../components/MessageSelector.js'
import type { SpinnerMode } from '../components/Spinner/types.js'
import type { QuerySource } from '../constants/querySource.js'
import { expandPastedTextRefs, parseReferences } from '../history.js'
import type { CanUseToolFn } from '../hooks/useCanUseTool.js'
import type { IDESelection } from '../hooks/useIdeSelection.js'
import type { AppState } from '../state/AppState.js'
import type { SetToolJSXFn } from '../Tool.js'
import type { LocalJSXCommandOnDone } from '../types/command.js'
import type { Message } from '../types/message.js'
import {
  isValidImagePaste,
  type PromptInputMode,
  type QueuedCommand,
} from '../types/textInputTypes.js'
import { createAbortController } from './abortController.js'
import type { PastedContent } from './config.js'
import { logForDebugging } from './debug.js'
import type { EffortValue } from './effort.js'
import type { FileHistoryState } from './fileHistory.js'
import { fileHistoryEnabled, fileHistoryMakeSnapshot } from './fileHistory.js'
import { gracefulShutdownSync } from './gracefulShutdown.js'
import { enqueue } from './messageQueueManager.js'
import { resolveSkillModelOverride } from './model/model.js'
import type { ProcessUserInputContext } from './processUserInput/processUserInput.js'
import { processUserInput } from './processUserInput/processUserInput.js'
import type { QueryGuard } from './QueryGuard.js'
import { queryCheckpoint, startQueryProfile } from './queryProfiler.js'
import { runWithWorkload } from './workloadContext.js'

// `exit`：封装优雅关闭，调用同步关闭流程退出进程。
function exit(): void {
  gracefulShutdownSync(0)
}

type BaseExecutionParams = {
// `BaseExecutionParams`：执行所需的基础参数集合，含消息、模型、IDE 选区、查询守卫、各类回调。
  queuedCommands?: QueuedCommand[]
  messages: Message[]
  mainLoopModel: string
  ideSelection: IDESelection | undefined
  querySource: QuerySource
  commands: Command[]
  queryGuard: QueryGuard
  /**
   * True when external loading (remote session, foregrounded background task)
   * is active. These don't route through queryGuard, so the queue check must
   * account for them separately. Omit (defaults to false) for the dequeue path
   * (executeQueuedInput) — dequeued items were already queued past this check.
   */
  isExternalLoading?: boolean
  setToolJSX: SetToolJSXFn
  getToolUseContext: (
    messages: Message[],
    newMessages: Message[],
    abortController: AbortController,
    mainLoopModel: string,
  ) => ProcessUserInputContext
  setUserInputOnProcessing: (prompt?: string) => void
  setAbortController: (abortController: AbortController | null) => void
  onQuery: (
    newMessages: Message[],
    abortController: AbortController,
    shouldQuery: boolean,
    additionalAllowedTools: string[],
    mainLoopModel: string,
    onBeforeQuery?: (input: string, newMessages: Message[]) => Promise<boolean>,
    input?: string,
    effort?: EffortValue,
  ) => Promise<void>
  setAppState: (updater: (prev: AppState) => AppState) => void
  onBeforeQuery?: (input: string, newMessages: Message[]) => Promise<boolean>
  canUseTool?: CanUseToolFn
}

/**
 * Parameters for core execution logic (no UI concerns).
 */
type ExecuteUserInputParams = BaseExecutionParams & {
// `ExecuteUserInputParams`：核心执行参数（无 UI 顾虑），在基础上加 resetHistory/onInputChange。
  resetHistory: () => void
  onInputChange: (value: string) => void
}

export type PromptInputHelpers = {
  setCursorOffset: (offset: number) => void
  clearBuffer: () => void
  resetHistory: () => void
}

export type HandlePromptSubmitParams = BaseExecutionParams & {
// `HandlePromptSubmitParams`：对外提交参数，区分直接输入路径与队列处理器路径，并承载 pastedContents、helpers、skipslash 等开关。
  // Direct user input path (set when called from onSubmit, absent for queue processor)
  input?: string
  mode?: PromptInputMode
  pastedContents?: Record<number, PastedContent>
  helpers: PromptInputHelpers
  onInputChange: (value: string) => void
  setPastedContents: React.Dispatch<
    React.SetStateAction<Record<number, PastedContent>>
  >
  abortController?: AbortController | null
  addNotification?: (notification: {
    key: string
    text: string
    priority: 'low' | 'medium' | 'high' | 'immediate'
  }) => void
  setMessages?: (updater: (prev: Message[]) => Message[]) => void
  streamMode?: SpinnerMode
  hasInterruptibleToolInProgress?: boolean
  uuid?: UUID
  /**
   * When true, input starting with `/` is treated as plain text.
   * Used for remotely-received messages (bridge/CCR) that should not
   * trigger local slash commands or skills.
   */
  skipSlashCommands?: boolean
}

// `handlePromptSubmit`：主函数，先解构参数，再按队列/直接输入两条路径分流。
export async function handlePromptSubmit(
  params: HandlePromptSubmitParams,
): Promise<void> {
  const {
    helpers,
    queryGuard,
    isExternalLoading = false,
    commands,
    onInputChange,
    setPastedContents,
    setToolJSX,
    getToolUseContext,
    messages,
    mainLoopModel,
    ideSelection,
    setUserInputOnProcessing,
    setAbortController,
    onQuery,
    setAppState,
    onBeforeQuery,
    canUseTool,
    queuedCommands,
    uuid,
    skipSlashCommands,
  } = params

  const { setCursorOffset, clearBuffer, resetHistory } = helpers

  // Queue processor path: commands are pre-validated and ready to execute.
  // Skip all input validation, reference parsing, and queuing logic.
  if (queuedCommands?.length) {
// 队列处理器路径：命令已预校验，跳过全部输入校验与引用解析，直接进 executeUserInput。
    startQueryProfile()
    await executeUserInput({
      queuedCommands,
      messages,
      mainLoopModel,
      ideSelection,
      querySource: params.querySource,
      commands,
      queryGuard,
      setToolJSX,
      getToolUseContext,
      setUserInputOnProcessing,
      setAbortController,
      onQuery,
      setAppState,
      onBeforeQuery,
      resetHistory,
      canUseTool,
      onInputChange,
    })
    return
  }

  const input = params.input ?? ''
// 过滤掉已删除的图片占位（orphaned paste），只保留文本引用仍指向的图片。
  const mode = params.mode ?? 'prompt'
  const rawPastedContents = params.pastedContents ?? {}

  // Images are only sent if their [Image #N] placeholder is still in the text.
  // Deleting the inline pill drops the image; orphaned entries are filtered here.
  const referencedIds = new Set(parseReferences(input).map(r => r.id))
  const pastedContents = Object.fromEntries(
    Object.entries(rawPastedContents).filter(
      ([, c]) => c.type !== 'image' || referencedIds.has(c.id),
    ),
  )

  const hasImages = Object.values(pastedContents).some(isValidImagePaste)
  if (input.trim() === '') {
    return
  }

  // Handle exit commands by triggering the exit command instead of direct process.exit
  // Skip for remote bridge messages — "exit" typed on iOS shouldn't kill the local session
  if (
// 退出命令处理：把 exit/quit/:q 等转成 `/exit` 命令（触发反馈弹窗），远程桥接消息则跳过以免误杀本地会话。
    !skipSlashCommands &&
    ['exit', 'quit', ':q', ':q!', ':wq', ':wq!'].includes(input.trim())
  ) {
    // Trigger the exit command which will show the feedback dialog
    const exitCommand = commands.find(cmd => cmd.name === 'exit')
    if (exitCommand) {
      // Submit the /exit command instead - recursive call needs to be handled
      void handlePromptSubmit({
        ...params,
        input: '/exit',
      })
    } else {
      // Fallback to direct exit if exit command not found
      exit()
    }
    return
  }

  // Parse references and replace with actual content early, before queueing
  // or immediate-command dispatch, so queued commands and immediate commands
  // both receive the expanded text from when it was submitted.
  const finalInput = expandPastedTextRefs(input, pastedContents)
  const pastedTextRefs = parseReferences(input).filter(
    r => pastedContents[r.id]?.type === 'text',
  )
  const pastedTextCount = pastedTextRefs.length
  const pastedTextBytes = pastedTextRefs.reduce(
    (sum, r) => sum + (pastedContents[r.id]?.content.length ?? 0),
    0,
  )
  logEvent('tengu_paste_text', { pastedTextCount, pastedTextBytes })

  // Handle local-jsx immediate commands (e.g., /config, /doctor)
  // Skip for remote bridge messages — slash commands from CCR clients are plain text
  if (!skipSlashCommands && finalInput.trim().startsWith('/')) {
// 本地 JSX 即时命令（如 /config /doctor）：在查询激活或外部加载时直接执行，清输入并渲染组件，避免走完整查询流程。
    const trimmedInput = finalInput.trim()
    const spaceIndex = trimmedInput.indexOf(' ')
    const commandName =
      spaceIndex === -1
        ? trimmedInput.slice(1)
        : trimmedInput.slice(1, spaceIndex)
    const commandArgs =
      spaceIndex === -1 ? '' : trimmedInput.slice(spaceIndex + 1).trim()

    const immediateCommand = commands.find(
      cmd =>
        cmd.immediate &&
        isCommandEnabled(cmd) &&
        (cmd.name === commandName ||
          cmd.aliases?.includes(commandName) ||
          getCommandName(cmd) === commandName),
    )

    if (
      immediateCommand &&
      immediateCommand.type === 'local-jsx' &&
      (queryGuard.isActive || isExternalLoading)
    ) {
      logEvent('tengu_immediate_command_executed', {
        commandName:
          immediateCommand.name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })

      // Clear input
      onInputChange('')
      setCursorOffset(0)
      setPastedContents({})
      clearBuffer()

      const context = getToolUseContext(
        messages,
        [],
        createAbortController(),
        mainLoopModel,
      )

      let doneWasCalled = false
      const onDone: LocalJSXCommandOnDone = (result, options) => {
        doneWasCalled = true
        // Use clearLocalJSX to explicitly clear the local JSX command
        setToolJSX({
          jsx: null,
          shouldHidePromptInput: false,
          clearLocalJSX: true,
        })
        if (result && options?.display !== 'skip' && params.addNotification) {
          params.addNotification({
            key: `immediate-${immediateCommand.name}`,
            text: result,
            priority: 'immediate',
          })
        }
        if (options?.nextInput) {
          if (options.submitNextInput) {
            enqueue({ value: options.nextInput, mode: 'prompt' })
          } else {
            onInputChange(options.nextInput)
          }
        }
      }

      const impl = await immediateCommand.load()
      const jsx = await impl.call(onDone, context, commandArgs)

      // Skip if onDone already fired — prevents stuck isLocalJSXCommand
      // (see processSlashCommand.tsx local-jsx case for full mechanism).
      if (jsx && !doneWasCalled) {
        setToolJSX({
          jsx,
          shouldHidePromptInput: false,
          isLocalJSXCommand: true,
          isImmediate: true,
        })
      }
      return
    }
  }

  if (queryGuard.isActive || isExternalLoading) {
// 查询激活或外部加载时：非 prompt/bash 模式不排队；可中断工具进行中则中止当前轮；否则入队并清输入。
    // Only allow prompt and bash mode commands to be queued
    if (mode !== 'prompt' && mode !== 'bash') {
      return
    }

    // Interrupt the current turn when all executing tools have
    // interruptBehavior 'cancel' (e.g. SleepTool).
    if (params.hasInterruptibleToolInProgress) {
      logForDebugging(
        `[interrupt] Aborting current turn: streamMode=${params.streamMode}`,
      )
      logEvent('tengu_cancel', {
        source:
          'interrupt_on_submit' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        streamMode:
          params.streamMode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      params.abortController?.abort('interrupt')
    }

    // Enqueue with string value + raw pastedContents. Images will be resized
    // at execution time when processUserInput runs (not baked in here).
    enqueue({
      value: finalInput.trim(),
      preExpansionValue: input.trim(),
      mode,
      pastedContents: hasImages ? pastedContents : undefined,
      skipSlashCommands,
      uuid,
    })

    onInputChange('')
    setCursorOffset(0)
    setPastedContents({})
    resetHistory()
    clearBuffer()
    return
  }

  // Start query profiling for this query
  startQueryProfile()

  // Construct a QueuedCommand from the direct user input so both paths
  // go through the same executeUserInput loop. This ensures images get
  // resized via processUserInput regardless of how the command arrives.
  const cmd: QueuedCommand = {
// 把直接输入也包装成一个 QueuedCommand，使两条路径都走同一个 executeUserInput 循环，保证图片统一在 processUserInput 阶段缩放。
    value: finalInput,
    preExpansionValue: input,
    mode,
    pastedContents: hasImages ? pastedContents : undefined,
    skipSlashCommands,
    uuid,
  }

  await executeUserInput({
    queuedCommands: [cmd],
    messages,
    mainLoopModel,
    ideSelection,
    querySource: params.querySource,
    commands,
    queryGuard,
    setToolJSX,
    getToolUseContext,
    setUserInputOnProcessing,
    setAbortController,
    onQuery,
    setAppState,
    onBeforeQuery,
    resetHistory,
    canUseTool,
    onInputChange,
  })
}

/**
 * Core logic for executing user input without UI side effects.
 *
 * All commands arrive as `queuedCommands`. First command gets full treatment
 * (attachments, ideSelection, pastedContents with image resizing). Commands 2-N
 * get `skipAttachments` to avoid duplicating turn-level context.
 */
// `executeUserInput`：核心执行——预留查询守卫、逐命令调用 processUserInput、收集首命令的模型/工具/effort、最后 onQuery 发起查询。所有命令都包在 runWithWorkload 的 ALS 上下文里以跨 await 传播负载标签。
async function executeUserInput(params: ExecuteUserInputParams): Promise<void> {
  const {
    messages,
    mainLoopModel,
    ideSelection,
    querySource,
    queryGuard,
    setToolJSX,
    getToolUseContext,
    setUserInputOnProcessing,
    setAbortController,
    onQuery,
    setAppState,
    onBeforeQuery,
    resetHistory,
    canUseTool,
    queuedCommands,
  } = params

  // Note: paste references are already processed before calling this function
  // (either in handlePromptSubmit before queuing, or before initial execution).
  // Always create a fresh abort controller — queryGuard guarantees no concurrent
  // executeUserInput call, so there's no prior controller to inherit.
  const abortController = createAbortController()
  setAbortController(abortController)

  function makeContext(): ProcessUserInputContext {
    return getToolUseContext(messages, [], abortController, mainLoopModel)
  }

  // Wrap in try-finally so the guard is released even if processUserInput
  // throws or onQuery is skipped. onQuery's finally calls queryGuard.end(),
  // which transitions running→idle; cancelReservation() below is a no-op in
  // that case (only acts on dispatching state).
  try {
    // Reserve the guard BEFORE processUserInput — processBashCommand awaits
    // BashTool.call() and processSlashCommand awaits getMessagesForSlashCommand,
    // so the guard must be active during those awaits to ensure concurrent
    // handlePromptSubmit calls queue (via the isActive check above) instead
    // of starting a second executeUserInput. This call is a no-op if the
    // guard is already in dispatching (legacy queue-processor path).
    queryGuard.reserve()
    queryCheckpoint('query_process_user_input_start')

    const newMessages: Message[] = []
    let shouldQuery = false
    let allowedTools: string[] | undefined
    let model: string | undefined
    let effort: EffortValue | undefined
    let nextInput: string | undefined
    let submitNextInput: boolean | undefined

    // Iterate all commands uniformly. First command gets attachments +
    // ideSelection + pastedContents, rest skip attachments to avoid
    // duplicating turn-level context (IDE selection, todos, diffs).
    const commands = queuedCommands ?? []

    // Compute the workload tag for this turn. queueProcessor can batch a
    // cron prompt with a same-tick human prompt; only tag when EVERY
    // command agrees on the same non-undefined workload — a human in the
    // mix is actively waiting.
    const firstWorkload = commands[0]?.workload
    const turnWorkload =
      firstWorkload !== undefined &&
      commands.every(c => c.workload === firstWorkload)
        ? firstWorkload
        : undefined

    // Wrap the entire turn (processUserInput loop + onQuery) in an
    // AsyncLocalStorage context. This is the ONLY way to correctly
    // propagate workload across await boundaries: void-detached bg agents
    // (executeForkedSlashCommand, AgentTool) capture the ALS context at
    // invocation time, and every await inside them resumes in that
    // context — isolated from the parent's continuation. A process-global
    // mutable slot would be clobbered at the detached closure's first
    // await by this function's synchronous return path. See state.ts.
    await runWithWorkload(turnWorkload, async () => {
// 整个回合包在 AsyncLocalStorage 里，这是跨 await 边界正确传播 workload 标签的唯一方式（detached 后台智能体捕获调用点上下文）。
      for (let i = 0; i < commands.length; i++) {
        const cmd = commands[i]!
        const isFirst = i === 0
        const result = await processUserInput({
          input: cmd.value,
          preExpansionInput: cmd.preExpansionValue,
          mode: cmd.mode,
          setToolJSX,
          context: makeContext(),
          pastedContents: isFirst ? cmd.pastedContents : undefined,
          messages,
          setUserInputOnProcessing: isFirst
            ? setUserInputOnProcessing
            : undefined,
          isAlreadyProcessing: !isFirst,
          querySource,
          canUseTool,
          uuid: cmd.uuid,
          ideSelection: isFirst ? ideSelection : undefined,
          skipSlashCommands: cmd.skipSlashCommands,
          bridgeOrigin: cmd.bridgeOrigin,
          isMeta: cmd.isMeta,
          skipAttachments: !isFirst,
        })
        // Stamp origin here rather than threading another arg through
        // processUserInput → processUserInputBase → processTextPrompt → createUserMessage.
        // Derive origin from mode for task-notifications — mirrors the origin
        // derivation at messages.ts (case 'queued_command'); intentionally
        // does NOT mirror its isMeta:true so idle-dequeued notifications stay
        // visible in the transcript via UserAgentNotificationMessage.
        const origin =
          cmd.origin ??
          (cmd.mode === 'task-notification'
            ? ({ kind: 'task-notification' } as const)
            : undefined)
// 为消息盖上 origin（来自 cmd.origin 或 task-notification），供 transcript 区分来源。
        if (origin) {
          for (const m of result.messages) {
            if (m.type === 'user') m.origin = origin
          }
        }
        newMessages.push(...result.messages)
        if (isFirst) {
          shouldQuery = result.shouldQuery
          allowedTools = result.allowedTools
          model = result.model
          effort = result.effort
          nextInput = result.nextInput
          submitNextInput = result.submitNextInput
        }
      }

      queryCheckpoint('query_process_user_input_end')
      if (fileHistoryEnabled()) {
        queryCheckpoint('query_file_history_snapshot_start')
        newMessages.filter(selectableUserMessagesFilter).forEach(message => {
          void fileHistoryMakeSnapshot(
            (updater: (prev: FileHistoryState) => FileHistoryState) => {
              setAppState(prev => ({
                ...prev,
                fileHistory: updater(prev.fileHistory),
              }))
            },
            message.uuid,
          )
        })
        queryCheckpoint('query_file_history_snapshot_end')
      }

      if (newMessages.length) {
        // History is now added in the caller (onSubmit) for direct user submissions.
        // This ensures queued command processing (notifications, already-queued user input)
        // doesn't add to history, since those either shouldn't be in history or were
        // already added when originally queued.
        resetHistory()
        setToolJSX({
          jsx: null,
          shouldHidePromptInput: false,
          clearLocalJSX: true,
        })

        const primaryCmd = commands[0]
        const primaryMode = primaryCmd?.mode ?? 'prompt'
        const primaryInput =
          primaryCmd && typeof primaryCmd.value === 'string'
            ? primaryCmd.value
            : undefined
        const shouldCallBeforeQuery = primaryMode === 'prompt'
        await onQuery(
// 有消息时调用 onQuery 发起真实查询，模型经 resolveSkillModelOverride 处理；无消息（纯本地斜杠命令）则释放守卫并清组件。
          newMessages,
          abortController,
          shouldQuery,
          allowedTools ?? [],
          model
            ? resolveSkillModelOverride(model, mainLoopModel)
            : mainLoopModel,
          shouldCallBeforeQuery ? onBeforeQuery : undefined,
          primaryInput,
          effort,
        )
      } else {
        // Local slash commands that skip messages (e.g., /model, /theme).
        // Release the guard BEFORE clearing toolJSX to prevent spinner flash —
        // the spinner formula checks: (!toolJSX || showSpinner) && isLoading.
        // If we clear toolJSX while the guard is still reserved, spinner briefly
        // shows. The finally below also calls cancelReservation (no-op if idle).
        queryGuard.cancelReservation()
        setToolJSX({
          jsx: null,
          shouldHidePromptInput: false,
          clearLocalJSX: true,
        })
        resetHistory()
        setAbortController(null)
      }

      // Handle nextInput from commands that want to chain (e.g., /discover activation)
      if (nextInput) {
        if (submitNextInput) {
          enqueue({ value: nextInput, mode: 'prompt' })
        } else {
          params.onInputChange(nextInput)
        }
      }
    }) // end runWithWorkload — ALS context naturally scoped, no finally needed
  } finally {
// finally 安全网：无论 processUserInput 抛错还是 onQuery 被跳过，都释放守卫预留并清掉占位提示，避免卡死。
    // Safety net: release the guard reservation if processUserInput threw
    // or onQuery was skipped. No-op if onQuery already ran (guard is idle
    // via end(), or running — cancelReservation only acts on dispatching).
    // This is the single source of truth for releasing the reservation;
    // useQueueProcessor no longer needs its own .finally().
    queryGuard.cancelReservation()
    // Safety net: clear the placeholder if processUserInput produced no
    // messages or threw — otherwise it would stay visible until the next
    // turn's resetLoadingState. Harmless when onQuery ran: setMessages grew
    // displayedMessages past the baseline, so REPL.tsx already hid it.
    setUserInputOnProcessing(undefined)
  }
}
