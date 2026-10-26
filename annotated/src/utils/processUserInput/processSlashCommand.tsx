import { feature } from 'bun:bundle';
import type { ContentBlockParam, TextBlockParam } from '@anthropic-ai/sdk/resources';
import { randomUUID } from 'crypto';
import { setPromptId } from 'src/bootstrap/state.js';
import { builtInCommandNames, type Command, type CommandBase, findCommand, getCommand, getCommandName, hasCommand, type PromptCommand } from 'src/commands.js';
import { NO_CONTENT_MESSAGE } from 'src/constants/messages.js';
import type { SetToolJSXFn, ToolUseContext } from 'src/Tool.js';
import type { AssistantMessage, AttachmentMessage, Message, NormalizedUserMessage, ProgressMessage, UserMessage } from 'src/types/message.js';
import { addInvokedSkill, getSessionId } from '../../bootstrap/state.js';
import { COMMAND_MESSAGE_TAG, COMMAND_NAME_TAG } from '../../constants/xml.js';
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, type AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED, logEvent } from '../../services/analytics/index.js';
import { getDumpPromptsPath } from '../../services/api/dumpPrompts.js';
import { buildPostCompactMessages } from '../../services/compact/compact.js';
import { resetMicrocompactState } from '../../services/compact/microCompact.js';
import type { Progress as AgentProgress } from '../../tools/AgentTool/AgentTool.js';
import { runAgent } from '../../tools/AgentTool/runAgent.js';
import { renderToolUseProgressMessage } from '../../tools/AgentTool/UI.js';
import type { CommandResultDisplay } from '../../types/command.js';
import { createAbortController } from '../abortController.js';
import { getAgentContext } from '../agentContext.js';
import { createAttachmentMessage, getAttachmentMessages } from '../attachments.js';
import { logForDebugging } from '../debug.js';
import { isEnvTruthy } from '../envUtils.js';
import { AbortError, MalformedCommandError } from '../errors.js';
import { getDisplayPath } from '../file.js';
import { extractResultText, prepareForkedCommandContext } from '../forkedAgent.js';
import { getFsImplementation } from '../fsOperations.js';
import { isFullscreenEnvEnabled } from '../fullscreen.js';
import { toArray } from '../generators.js';
import { registerSkillHooks } from '../hooks/registerSkillHooks.js';
import { logError } from '../log.js';
import { enqueuePendingNotification } from '../messageQueueManager.js';
import { createCommandInputMessage, createSyntheticUserCaveatMessage, createSystemMessage, createUserInterruptionMessage, createUserMessage, formatCommandInputTags, isCompactBoundaryMessage, isSystemLocalCommandMessage, normalizeMessages, prepareUserContent } from '../messages.js';
import type { ModelAlias } from '../model/aliases.js';
import { parseToolListFromCLI } from '../permissions/permissionSetup.js';
import { hasPermissionsToUseTool } from '../permissions/permissions.js';
import { isOfficialMarketplaceName, parsePluginIdentifier } from '../plugins/pluginIdentifier.js';
import { isRestrictedToPluginOnly, isSourceAdminTrusted } from '../settings/pluginOnlyPolicy.js';
import { parseSlashCommand } from '../slashCommandParsing.js';
import { sleep } from '../sleep.js';
import { recordSkillUsage } from '../suggestions/skillUsageTracking.js';
import { logOTelEvent, redactIfDisabled } from '../telemetry/events.js';
import { buildPluginCommandTelemetryFields } from '../telemetry/pluginTelemetry.js';
import { getAssistantMessageContentLength } from '../tokens.js';
import { createAgentId } from '../uuid.js';
import { getWorkload } from '../workloadContext.js';
import type { ProcessUserInputBaseResult, ProcessUserInputContext } from './processUserInput.js';
// SlashCommandResult：在普通处理结果上额外带上本次命中的 Command 对象，供上层区分「斜杠命令」这一类特殊结果。
type SlashCommandResult = ProcessUserInputBaseResult & {
  command: Command;
};

// MCP 安定轮询参数：后台 fork 子 agent 前先等 MCP 服务器连上。MCP 通常启动后 1-3 秒连上，这里给 10 秒余量覆盖慢的 SSE 握手；轮询间隔 200 毫秒。
// Poll interval and deadline for MCP settle before launching a background
// forked subagent. MCP servers typically connect within 1-3s of startup;
// 10s headroom covers slow SSE handshakes.
const MCP_SETTLE_POLL_MS = 200;
const MCP_SETTLE_TIMEOUT_MS = 10_000;

/**
 * Executes a slash command with context: fork in a sub-agent.
 */
// executeForkedSlashCommand：以 fork 子 agent 的方式执行斜杠命令——把技能内容、agent 定义、提示词准备好后，按 context:fork 的规则在后台或前台跑子 agent。
async function executeForkedSlashCommand(command: CommandBase & PromptCommand, args: string, context: ProcessUserInputContext, precedingInputBlocks: ContentBlockParam[], setToolJSX: SetToolJSXFn, canUseTool: CanUseToolFn): Promise<SlashCommandResult> {
  const agentId = createAgentId();
  const pluginMarketplace = command.pluginInfo ? parsePluginIdentifier(command.pluginInfo.repository).marketplace : undefined;
  logEvent('tengu_slash_command_forked', {
    command_name: command.name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    invocation_trigger: 'user-slash' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    ...(command.pluginInfo && {
      _PROTO_plugin_name: command.pluginInfo.pluginManifest.name as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
      ...(pluginMarketplace && {
        _PROTO_marketplace_name: pluginMarketplace as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED
      }),
      ...buildPluginCommandTelemetryFields(command.pluginInfo)
    })
  });
  const {
    skillContent,
    modifiedGetAppState,
    baseAgent,
    promptMessages
  } = await prepareForkedCommandContext(command, args, context);

  // Merge skill's effort into the agent definition so runAgent applies it
  const agentDefinition = command.effort !== undefined ? {
    ...baseAgent,
    effort: command.effort
  } : baseAgent;
  logForDebugging(`Executing forked slash command /${command.name} with agent ${agentDefinition.agentType}`);

  // Assistant mode: fire-and-forget. Launch subagent in background, return
  // immediately, re-enqueue the result as an isMeta prompt when done.
  // Without this, N scheduled tasks on startup = N serial (subagent + main
  // agent turn) cycles blocking user input. With this, N subagents run in
  // parallel and results trickle into the queue as they finish.
  //
  // Gated on kairosEnabled (not CLAUDE_CODE_BRIEF) because the closed loop
  // depends on assistant-mode invariants: scheduled_tasks.json exists,
  // the main agent knows to pipe results through SendUserMessage, and
  // isMeta prompts are hidden. Outside assistant mode, context:fork commands
  // are user-invoked skills (/commit etc.) that should run synchronously
  // with the progress UI.
  if (feature('KAIROS') && (await context.getAppState()).kairosEnabled) {
// 后台模式（fire-and-forget）：当 KAIROS 且 kairosEnabled 开启时，子 agent 在后台跑，立刻返回空消息、不阻塞用户输入；完成后把结果作为隐藏的 isMeta 提示重新入队，由主 agent 下一轮决定如何处理。没有这套机制的话，启动时 N 个定时任务会串行（子 agent + 主 agent 轮次）卡住输入。
    // Standalone abortController — background subagents survive main-thread
    // ESC (same policy as AgentTool's async path). They're cron-driven; if
    // killed mid-run they just re-fire on the next schedule.
    const bgAbortController = createAbortController();
    const commandName = getCommandName(command);

    // Workload: handlePromptSubmit wraps the entire turn in runWithWorkload
    // (AsyncLocalStorage). ALS context is captured when this `void` fires
    // and survives every await inside — isolated from the parent's
    // continuation. The detached closure's runAgent calls see the cron tag
    // automatically. We still capture the value here ONLY for the
    // re-enqueued result prompt below: that second turn runs in a fresh
    // handlePromptSubmit → fresh runWithWorkload boundary (which always
    // establishes a new context, even for `undefined`) → so it needs its
    // own QueuedCommand.workload tag to preserve attribution.
    const spawnTimeWorkload = getWorkload();
// 工作量标签：handlePromptSubmit 把整轮包在 runWithWorkload（AsyncLocalStorage）里，ALS 上下文在 void 触发时捕获并贯穿所有 await；但重新入队的第二条提示跑在全新的 runWithWorkload 边界里，需要自己的 QueuedCommand.workload 标签才能保留归属。

    // Re-enter the queue as a hidden prompt. isMeta: hides from queue
    // preview + placeholder + transcript. skipSlashCommands: prevents
    // re-parsing if the result text happens to start with '/'. When
    // drained, this triggers a main-agent turn that sees the result and
    // decides whether to SendUserMessage. Propagate workload so that
    // second turn is also tagged.
    const enqueueResult = (value: string): void => enqueuePendingNotification({
      value,
      mode: 'prompt',
      priority: 'later',
      isMeta: true,
      skipSlashCommands: true,
      workload: spawnTimeWorkload
    });
    void (async () => {
// 后台执行体：先轮询等 MCP 客户端都不再是 pending 再刷新工具列表；然后跑子 agent，收集消息、抽出结果文本，最后把结果包成 scheduled-task-result 重新入队。失败也入队一条 status=failed 的结果，保证队列不被卡死。
      // Wait for MCP servers to settle. Scheduled tasks fire at startup and
      // all N drain within ~1ms (since we return immediately), capturing
      // context.options.tools before MCP connects. The sync path
      // accidentally avoided this — tasks serialized, so task N's drain
      // happened after task N-1's 30s run, by which time MCP was up.
      // Poll until no 'pending' clients remain, then refresh.
      const deadline = Date.now() + MCP_SETTLE_TIMEOUT_MS;
      while (Date.now() < deadline) {
        const s = context.getAppState();
        if (!s.mcp.clients.some(c => c.type === 'pending')) break;
        await sleep(MCP_SETTLE_POLL_MS);
      }
      const freshTools = context.options.refreshTools?.() ?? context.options.tools;
      const agentMessages: Message[] = [];
      for await (const message of runAgent({
        agentDefinition,
        promptMessages,
        toolUseContext: {
          ...context,
          getAppState: modifiedGetAppState,
          abortController: bgAbortController
        },
        canUseTool,
        isAsync: true,
        querySource: 'agent:custom',
        model: command.model as ModelAlias | undefined,
        availableTools: freshTools,
        override: {
          agentId
        }
      })) {
        agentMessages.push(message);
      }
      const resultText = extractResultText(agentMessages, 'Command completed');
      logForDebugging(`Background forked command /${commandName} completed (agent ${agentId})`);
      enqueueResult(`<scheduled-task-result command="/${commandName}">\n${resultText}\n</scheduled-task-result>`);
    })().catch(err => {
      logError(err);
      enqueueResult(`<scheduled-task-result command="/${commandName}" status="failed">\n${err instanceof Error ? err.message : String(err)}\n</scheduled-task-result>`);
    });

    // Nothing to render, nothing to query — the background runner re-enters
    // the queue on its own schedule.
    return {
      messages: [],
      shouldQuery: false,
      command
    };
  }

  // Collect messages from the forked agent
  const agentMessages: Message[] = [];

  // Build progress messages for the agent progress UI
  const progressMessages: ProgressMessage<AgentProgress>[] = [];
  const parentToolUseID = `forked-command-${command.name}`;
  let toolUseCounter = 0;

  // Helper to create a progress message from an agent message
  const createProgressMessage = (message: AssistantMessage | NormalizedUserMessage): ProgressMessage<AgentProgress> => {
    toolUseCounter++;
    return {
      type: 'progress',
      data: {
        message,
        type: 'agent_progress',
        prompt: skillContent,
        agentId
      },
      parentToolUseID,
      toolUseID: `${parentToolUseID}-${toolUseCounter}`,
      timestamp: new Date().toISOString(),
      uuid: randomUUID()
    };
  };

  // Helper to update progress display using agent progress UI
  const updateProgress = (): void => {
    setToolJSX({
      jsx: renderToolUseProgressMessage(progressMessages, {
        tools: context.options.tools,
        verbose: false
      }),
      shouldHidePromptInput: false,
      shouldContinueAnimation: true,
      showSpinner: true
    });
  };

  // Show initial "Initializing…" state
  updateProgress();

  // Run the sub-agent
  try {
    for await (const message of runAgent({
      agentDefinition,
      promptMessages,
      toolUseContext: {
        ...context,
        getAppState: modifiedGetAppState
      },
      canUseTool,
      isAsync: false,
      querySource: 'agent:custom',
      model: command.model as ModelAlias | undefined,
      availableTools: context.options.tools
    })) {
      agentMessages.push(message);
      const normalizedNew = normalizeMessages([message]);

      // Add progress message for assistant messages (which contain tool uses)
      if (message.type === 'assistant') {
        // Increment token count in spinner for assistant messages
        const contentLength = getAssistantMessageContentLength(message);
        if (contentLength > 0) {
          context.setResponseLength(len => len + contentLength);
        }
        const normalizedMsg = normalizedNew[0];
        if (normalizedMsg && normalizedMsg.type === 'assistant') {
          progressMessages.push(createProgressMessage(message));
          updateProgress();
        }
      }

      // Add progress message for user messages (which contain tool results)
      if (message.type === 'user') {
        const normalizedMsg = normalizedNew[0];
        if (normalizedMsg && normalizedMsg.type === 'user') {
          progressMessages.push(createProgressMessage(normalizedMsg));
          updateProgress();
        }
      }
    }
  } finally {
    // Clear the progress display
    setToolJSX(null);
  }
  let resultText = extractResultText(agentMessages, 'Command completed');
  logForDebugging(`Forked slash command /${command.name} completed with agent ${agentId}`);

  // Prepend debug log for ant users so it appears inside the command output
  if ("external" === 'ant') {
    resultText = `[ANT-ONLY] API calls: ${getDisplayPath(getDumpPromptsPath(agentId))}\n${resultText}`;
  }

  // Return the result as a user message (simulates the agent's output)
  const messages: UserMessage[] = [createUserMessage({
    content: prepareUserContent({
      inputString: `/${getCommandName(command)} ${args}`.trim(),
      precedingInputBlocks
    })
  }), createUserMessage({
    content: `<local-command-stdout>\n${resultText}\n</local-command-stdout>`
  })];
  return {
    messages,
    shouldQuery: false,
    command,
    resultText
  };
}

/**
 * Determines if a string looks like a valid command name.
 * Valid command names only contain letters, numbers, colons, hyphens, and underscores.
 *
 * @param commandName - The potential command name to check
 * @returns true if it looks like a command name, false if it contains non-command characters
 */
// looksLikeCommand：判断一段字符串是否「像」合法命令名——只含字母、数字、冒号、连字符、下划线。含其它字符的更可能是文件路径或普通输入，不该当命令解析。
export function looksLikeCommand(commandName: string): boolean {
  // Command names should only contain [a-zA-Z0-9:_-]
  // If it contains other characters, it's probably a file path or other input
  return !/[^a-zA-Z0-9:\-_]/.test(commandName);
}
// processSlashCommand：斜杠命令的总入口。先解析输入，解析失败就报「命令形如 /command [args]」；再按命令类型分流到 getMessagesForSlashCommand，并对未知命令、本地命令、有效命令分别构造返回结果与遥测事件。
export async function processSlashCommand(inputString: string, precedingInputBlocks: ContentBlockParam[], imageContentBlocks: ContentBlockParam[], attachmentMessages: AttachmentMessage[], context: ProcessUserInputContext, setToolJSX: SetToolJSXFn, uuid?: string, isAlreadyProcessing?: boolean, canUseTool?: CanUseToolFn): Promise<ProcessUserInputBaseResult> {
  const parsed = parseSlashCommand(inputString);
  if (!parsed) {
    logEvent('tengu_input_slash_missing', {});
    const errorMessage = 'Commands are in the form `/command [args]`';
    return {
      messages: [createSyntheticUserCaveatMessage(), ...attachmentMessages, createUserMessage({
        content: prepareUserContent({
          inputString: errorMessage,
          precedingInputBlocks
        })
      })],
      shouldQuery: false,
      resultText: errorMessage
    };
  }
  const {
    commandName,
    args: parsedArgs,
    isMcp
  } = parsed;
  const sanitizedCommandName = isMcp ? 'mcp' : !builtInCommandNames().has(commandName) ? 'custom' : commandName;

  // Check if it's a real command before processing
  if (!hasCommand(commandName, context.options.commands)) {
// 命令不存在时的分流：先判断它「像不像命令名」以及「是不是真实存在的文件路径」。像命令名且不是文件路径 → 记 invalid 遥测并返回 Unknown skill；否则当作普通用户输入，记 user_prompt 事件并继续向模型查询。
    // Check if this looks like a command name vs a file path or other input
    // Also check if it's an actual file path that exists
    let isFilePath = false;
    try {
      await getFsImplementation().stat(`/${commandName}`);
      isFilePath = true;
    } catch {
      // Not a file path — treat as command name
    }
    if (looksLikeCommand(commandName) && !isFilePath) {
      logEvent('tengu_input_slash_invalid', {
        input: commandName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
      const unknownMessage = `Unknown skill: ${commandName}`;
      return {
        messages: [createSyntheticUserCaveatMessage(), ...attachmentMessages, createUserMessage({
          content: prepareUserContent({
            inputString: unknownMessage,
            precedingInputBlocks
          })
        }),
        // gh-32591: preserve args so the user can copy/resubmit without
        // retyping. System warning is UI-only (filtered before API).
        ...(parsedArgs ? [createSystemMessage(`Args from unknown skill: ${parsedArgs}`, 'warning')] : [])],
// gh-32591：未知命令时保留 args，让用户无需重打就能复制再提交；系统警告仅 UI 可见（发往 API 前会被过滤）。
        shouldQuery: false,
        resultText: unknownMessage
      };
    }
    const promptId = randomUUID();
    setPromptId(promptId);
    logEvent('tengu_input_prompt', {});
    // Log user prompt event for OTLP
    void logOTelEvent('user_prompt', {
      prompt_length: String(inputString.length),
      prompt: redactIfDisabled(inputString),
      'prompt.id': promptId
    });
    return {
      messages: [createUserMessage({
        content: prepareUserContent({
          inputString,
          precedingInputBlocks
        }),
        uuid: uuid
      }), ...attachmentMessages],
      shouldQuery: true
    };
  }

  // Track slash command usage for feature discovery

  const {
    messages: newMessages,
    shouldQuery: messageShouldQuery,
    allowedTools,
    model,
    effort,
    command: returnedCommand,
    resultText,
    nextInput,
    submitNextInput
  } = await getMessagesForSlashCommand(commandName, parsedArgs, setToolJSX, context, precedingInputBlocks, imageContentBlocks, isAlreadyProcessing, canUseTool, uuid);

  // Local slash commands that skip messages
  if (newMessages.length === 0) {
// 本地斜杠命令（newMessages 为空）走这条：按是否插件命令补上插件遥测元数据，再返回不查询的结果（或带 nextInput 让前端自动提交下一步输入）。
    const eventData: Record<string, boolean | number | undefined> = {
      input: sanitizedCommandName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    };

    // Add plugin metadata if this is a plugin command
    if (returnedCommand.type === 'prompt' && returnedCommand.pluginInfo) {
      const {
        pluginManifest,
        repository
      } = returnedCommand.pluginInfo;
      const {
        marketplace
      } = parsePluginIdentifier(repository);
      const isOfficial = isOfficialMarketplaceName(marketplace);
      // _PROTO_* routes to PII-tagged plugin_name/marketplace_name BQ columns
      // (unredacted, all users); plugin_name/plugin_repository stay in
      // additional_metadata as redacted variants for general-access dashboards.
      eventData._PROTO_plugin_name = pluginManifest.name as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED;
      if (marketplace) {
        eventData._PROTO_marketplace_name = marketplace as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED;
      }
      eventData.plugin_repository = (isOfficial ? repository : 'third-party') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS;
      eventData.plugin_name = (isOfficial ? pluginManifest.name : 'third-party') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS;
      if (isOfficial && pluginManifest.version) {
        eventData.plugin_version = pluginManifest.version as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS;
      }
      Object.assign(eventData, buildPluginCommandTelemetryFields(returnedCommand.pluginInfo));
    }
    logEvent('tengu_input_command', {
      ...eventData,
      invocation_trigger: 'user-slash' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...("external" === 'ant' && {
        skill_name: commandName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        ...(returnedCommand.type === 'prompt' && {
          skill_source: returnedCommand.source as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        }),
        ...(returnedCommand.loadedFrom && {
          skill_loaded_from: returnedCommand.loadedFrom as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        }),
        ...(returnedCommand.kind && {
          skill_kind: returnedCommand.kind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        })
      })
    });
    return {
      messages: [],
      shouldQuery: false,
      model,
      nextInput,
      submitNextInput
    };
  }

  // For invalid commands, preserve both the user message and error
  if (newMessages.length === 2 && newMessages[1]!.type === 'user' && typeof newMessages[1]!.message.content === 'string' && newMessages[1]!.message.content.startsWith('Unknown command:')) {
// 无效命令的特例：当返回两条消息且第二条是「Unknown command:」开头的用户消息时，若输入不像常见文件路径（/var、/tmp、/private）才记 invalid 遥测，否则静默放行，避免把文件路径误判成无效命令。
    // Don't log as invalid if it looks like a common file path
    const looksLikeFilePath = inputString.startsWith('/var') || inputString.startsWith('/tmp') || inputString.startsWith('/private');
    if (!looksLikeFilePath) {
      logEvent('tengu_input_slash_invalid', {
        input: commandName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
    }
    return {
      messages: [createSyntheticUserCaveatMessage(), ...newMessages],
      shouldQuery: messageShouldQuery,
      allowedTools,
      model
    };
  }

  // A valid command
  const eventData: Record<string, boolean | number | undefined> = {
    input: sanitizedCommandName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  };

  // Add plugin metadata if this is a plugin command
  if (returnedCommand.type === 'prompt' && returnedCommand.pluginInfo) {
    const {
      pluginManifest,
      repository
    } = returnedCommand.pluginInfo;
    const {
      marketplace
    } = parsePluginIdentifier(repository);
    const isOfficial = isOfficialMarketplaceName(marketplace);
    eventData._PROTO_plugin_name = pluginManifest.name as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED;
    if (marketplace) {
      eventData._PROTO_marketplace_name = marketplace as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED;
    }
    eventData.plugin_repository = (isOfficial ? repository : 'third-party') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS;
    eventData.plugin_name = (isOfficial ? pluginManifest.name : 'third-party') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS;
    if (isOfficial && pluginManifest.version) {
      eventData.plugin_version = pluginManifest.version as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS;
    }
    Object.assign(eventData, buildPluginCommandTelemetryFields(returnedCommand.pluginInfo));
  }
  logEvent('tengu_input_command', {
    ...eventData,
    invocation_trigger: 'user-slash' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    ...("external" === 'ant' && {
      skill_name: commandName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...(returnedCommand.type === 'prompt' && {
        skill_source: returnedCommand.source as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      }),
      ...(returnedCommand.loadedFrom && {
        skill_loaded_from: returnedCommand.loadedFrom as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      }),
      ...(returnedCommand.kind && {
        skill_kind: returnedCommand.kind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      })
    })
  });

  // Check if this is a compact result which handle their own synthetic caveat message ordering
// 压缩结果特例：若新消息首条是压缩边界消息，它自己会处理合成警告消息的排序，这里据此决定最终是否要在前面补一条合成警告。
  const isCompactResult = newMessages.length > 0 && newMessages[0] && isCompactBoundaryMessage(newMessages[0]);
  return {
    messages: messageShouldQuery || newMessages.every(isSystemLocalCommandMessage) || isCompactResult ? newMessages : [createSyntheticUserCaveatMessage(), ...newMessages],
    shouldQuery: messageShouldQuery,
    allowedTools,
    model,
    effort,
    resultText,
    nextInput,
    submitNextInput
  };
}
// getMessagesForSlashCommand：按命令类型（local-jsx / local / prompt）分别构造消息。先记录技能使用用于排序，再拦截 userInvocable 为 false 的「仅模型可调」技能，最后进入类型分发。
async function getMessagesForSlashCommand(commandName: string, args: string, setToolJSX: SetToolJSXFn, context: ProcessUserInputContext, precedingInputBlocks: ContentBlockParam[], imageContentBlocks: ContentBlockParam[], _isAlreadyProcessing?: boolean, canUseTool?: CanUseToolFn, uuid?: string): Promise<SlashCommandResult> {
  const command = getCommand(commandName, context.options.commands);

  // Track skill usage for ranking (only for prompt commands that are user-invocable)
  if (command.type === 'prompt' && command.userInvocable !== false) {
    recordSkillUsage(commandName);
  }

  // Check if the command is user-invocable
  // Skills with userInvocable === false can only be invoked by the model via SkillTool
  if (command.userInvocable === false) {
// 仅模型可调用：userInvocable 为 false 的技能只能由模型通过 SkillTool 触发；用户直接打会被拦截，并提示「让 Claude 帮你用这个技能」。
    return {
      messages: [createUserMessage({
        content: prepareUserContent({
          inputString: `/${commandName}`,
          precedingInputBlocks
        })
      }), createUserMessage({
        content: `This skill can only be invoked by Claude, not directly by users. Ask Claude to use the "${commandName}" skill for you.`
      })],
      shouldQuery: false,
      command
    };
  }
  try {
// 类型分发：local-jsx 用 onDone 回调驱动 UI 模态；local 直接加载并调用命令函数；prompt 则按 context:fork 决定走后台 fork 还是前台取提示词。
    switch (command.type) {
      case 'local-jsx':
        {
          return new Promise<SlashCommandResult>(resolve => {
            let doneWasCalled = false;
            const onDone = (result?: string, options?: {
              display?: CommandResultDisplay;
              shouldQuery?: boolean;
              metaMessages?: string[];
              nextInput?: string;
              submitNextInput?: boolean;
            }) => {
              doneWasCalled = true;
              // If display is 'skip', don't add any messages to the conversation
              if (options?.display === 'skip') {
                void resolve({
                  messages: [],
                  shouldQuery: false,
                  command,
                  nextInput: options?.nextInput,
                  submitNextInput: options?.submitNextInput
                });
                return;
              }

              // Meta messages are model-visible but hidden from the user
              const metaMessages = (options?.metaMessages ?? []).map((content: string) => createUserMessage({
                content,
                isMeta: true
              }));

              // In fullscreen the command just showed as a centered modal
              // pane — the transient notification is enough feedback. The
              // "❯ /config" + "⎿ dismissed" transcript entries are
              // type:system subtype:local_command (user-visible but NOT sent
              // to the model), so skipping them doesn't affect model context.
              // Outside fullscreen keep them so scrollback shows what ran.
              // Only skip "<Name> dismissed" modal-close notifications —
              // commands that early-exit before showing a modal (/ultraplan
              // usage, /rename, /proactive) use display:system for actual
              // output that must reach the transcript.
              const skipTranscript = isFullscreenEnvEnabled() && typeof result === 'string' && result.endsWith(' dismissed');
// 全屏模式下的转写取舍：全屏里命令只显示一个居中模态面板，转场通知已够反馈，所以以 dismissed 结尾的「XXX dismissed」提示可以跳过不进转录；全屏外则保留，让滚动历史显示跑过什么。
              void resolve({
                messages: options?.display === 'system' ? skipTranscript ? metaMessages : [createCommandInputMessage(formatCommandInput(command, args)), createCommandInputMessage(`<local-command-stdout>${result}</local-command-stdout>`), ...metaMessages] : [createUserMessage({
                  content: prepareUserContent({
                    inputString: formatCommandInput(command, args),
                    precedingInputBlocks
                  })
                }), result ? createUserMessage({
                  content: `<local-command-stdout>${result}</local-command-stdout>`
                }) : createUserMessage({
                  content: `<local-command-stdout>${NO_CONTENT_MESSAGE}</local-command-stdout>`
                }), ...metaMessages],
                shouldQuery: options?.shouldQuery ?? false,
                command,
                nextInput: options?.nextInput,
                submitNextInput: options?.submitNextInput
              });
            };
            void command.load().then(mod => mod.call(onDone, {
              ...context,
              canUseTool
            }, args)).then(jsx => {
              if (jsx == null) return;
              if (context.options.isNonInteractiveSession) {
                void resolve({
                  messages: [],
                  shouldQuery: false,
                  command
                });
                return;
              }
              // Guard: if onDone fired during mod.call() (early-exit path
              // that calls onDone then returns JSX), skip setToolJSX. This
              // chain is fire-and-forget — the outer Promise resolves when
              // onDone is called, so executeUserInput may have already run
              // its setToolJSX({clearLocalJSX: true}) before we get here.
              // Setting isLocalJSXCommand after clear leaves it stuck true,
              // blocking useQueueProcessor and TextInput focus.
// 防护：若 onDone 在 mod.call() 期间就已触发（早退路径先调 onDone 再返回 JSX），这里跳过 setToolJSX，否则在外层 Promise 已 resolve、executeUserInput 可能已清掉本地 JSX 之后再设 isLocalJSXCommand，会导致它卡在 true 从而阻塞队列处理器与输入框聚焦。
              if (doneWasCalled) return;
              setToolJSX({
                jsx,
                shouldHidePromptInput: true,
                showSpinner: false,
                isLocalJSXCommand: true,
                isImmediate: command.immediate === true
              });
            }).catch(e => {
              // If load()/call() throws and onDone never fired, the outer
              // Promise hangs forever, leaving queryGuard stuck in
              // 'dispatching' and deadlocking the queue processor.
              logError(e);
              if (doneWasCalled) return;
              doneWasCalled = true;
              setToolJSX({
                jsx: null,
                shouldHidePromptInput: false,
                clearLocalJSX: true
              });
              void resolve({
                messages: [],
                shouldQuery: false,
                command
              });
            });
          });
        }
      case 'local':
        {
          const displayArgs = command.isSensitive && args.trim() ? '***' : args;
          const userMessage = createUserMessage({
            content: prepareUserContent({
              inputString: formatCommandInput(command, displayArgs),
              precedingInputBlocks
            })
          });
          try {
            const syntheticCaveatMessage = createSyntheticUserCaveatMessage();
            const mod = await command.load();
            const result = await mod.call(args, context);
            if (result.type === 'skip') {
              return {
                messages: [],
                shouldQuery: false,
                command
              };
            }

            // Use discriminated union to handle different result types
            if (result.type === 'compact') {
// compact 类型结果：把斜杠命令消息追加到 messagesToKeep，让附件与 hook 结果排在用户消息之后；同时重置 microcompact 状态（整段压缩替换了全部消息，旧工具 ID 失效，但预算状态无需重置——过期条目是惰性的，UUID 不复用）。
              // Append slash command messages to messagesToKeep so that
              // attachments and hookResults come after user messages
              const slashCommandMessages = [syntheticCaveatMessage, userMessage, ...(result.displayText ? [createUserMessage({
                content: `<local-command-stdout>${result.displayText}</local-command-stdout>`,
                // --resume looks at latest timestamp message to determine which message to resume from
                // This is a perf optimization to avoid having to recaculcate the leaf node every time
                // Since we're creating a bunch of synthetic messages for compact, it's important to set
                // the timestamp of the last message to be slightly after the current time
                // This is mostly important for sdk / -p mode
                timestamp: new Date(Date.now() + 100).toISOString()
              })] : [])];
              const compactionResultWithSlashMessages = {
                ...result.compactionResult,
                messagesToKeep: [...(result.compactionResult.messagesToKeep ?? []), ...slashCommandMessages]
              };
              // Reset microcompact state since full compact replaces all
              // messages — old tool IDs are no longer relevant. Budget state
              // (on toolUseContext) needs no reset: stale entries are inert
              // (UUIDs never repeat, so they're never looked up).
              resetMicrocompactState();
              return {
                messages: buildPostCompactMessages(compactionResultWithSlashMessages),
                shouldQuery: false,
                command
              };
            }

            // Text result — use system message so it doesn't render as a user bubble
            return {
              messages: [userMessage, createCommandInputMessage(`<local-command-stdout>${result.value}</local-command-stdout>`)],
              shouldQuery: false,
              command,
              resultText: result.value
            };
          } catch (e) {
            logError(e);
            return {
              messages: [userMessage, createCommandInputMessage(`<local-command-stderr>${String(e)}</local-command-stderr>`)],
              shouldQuery: false,
              command
            };
          }
        }
// prompt 类型：若命令声明 context:fork 就走后台 fork 子 agent；否则取 prompt 型斜杠命令的消息。AbortError 单独处理成「Interrupted」提示，其它错误回显到 local-command-stderr。
      case 'prompt':
        {
          try {
            // Check if command should run as forked sub-agent
            if (command.context === 'fork') {
              return await executeForkedSlashCommand(command, args, context, precedingInputBlocks, setToolJSX, canUseTool ?? hasPermissionsToUseTool);
            }
            return await getMessagesForPromptSlashCommand(command, args, context, precedingInputBlocks, imageContentBlocks, uuid);
          } catch (e) {
            // Handle abort errors specially to show proper "Interrupted" message
            if (e instanceof AbortError) {
              return {
                messages: [createUserMessage({
                  content: prepareUserContent({
                    inputString: formatCommandInput(command, args),
                    precedingInputBlocks
                  })
                }), createUserInterruptionMessage({
                  toolUse: false
                })],
                shouldQuery: false,
                command
              };
            }
            return {
              messages: [createUserMessage({
                content: prepareUserContent({
                  inputString: formatCommandInput(command, args),
                  precedingInputBlocks
                })
              }), createUserMessage({
                content: `<local-command-stderr>${String(e)}</local-command-stderr>`
              })],
              shouldQuery: false,
              command
            };
          }
        }
    }
  } catch (e) {
// 分发外层兜底：MalformedCommandError 转成一条用户消息返回；其它异常继续向上抛，交由更上层处理。
    if (e instanceof MalformedCommandError) {
      return {
        messages: [createUserMessage({
          content: prepareUserContent({
            inputString: e.message,
            precedingInputBlocks
          })
        })],
        shouldQuery: false,
        command
      };
    }
    throw e;
  }
}
// formatCommandInput：把命令名与参数拼成展示用的输入字符串（走统一的 tag 格式化）。
function formatCommandInput(command: CommandBase, args: string): string {
  return formatCommandInputTags(getCommandName(command), args);
}

/**
 * Formats the metadata for a skill loading message.
 * Used by the Skill tool and for subagent skill preloading.
 */
// formatSkillLoadingMetadata：构造技能加载消息的元数据，渲染成 Skill(name) 形式；只含技能名，不含参数。
export function formatSkillLoadingMetadata(skillName: string, _progressMessage: string = 'loading'): string {
  // Use skill name only - UserCommandMessage renders as "Skill(name)"
  return [`<${COMMAND_MESSAGE_TAG}>${skillName}</${COMMAND_MESSAGE_TAG}>`, `<${COMMAND_NAME_TAG}>${skillName}</${COMMAND_NAME_TAG}>`, `<skill-format>true</skill-format>`].join('\n');
}

/**
 * Formats the metadata for a slash command loading message.
 */
// formatSlashCommandLoadingMetadata：构造斜杠命令加载元数据，渲染成 /name 形式；若有参数再附 command-args 段。
function formatSlashCommandLoadingMetadata(commandName: string, args?: string): string {
  return [`<${COMMAND_MESSAGE_TAG}>${commandName}</${COMMAND_MESSAGE_TAG}>`, `<${COMMAND_NAME_TAG}>/${commandName}</${COMMAND_NAME_TAG}>`, args ? `<command-args>${args}</command-args>` : null].filter(Boolean).join('\n');
}

/**
 * Formats the loading metadata for a command (skill or slash command).
 * User-invocable skills use slash command format (/name), while model-only
 * skills use the skill format ("The X skill is running").
 */
// formatCommandLoadingMetadata：统一入口——用户可调用技能显示成 /command（与普通斜杠命令一致），仅模型技能（来自 skills/plugin/mcp）显示成「The X skill is running」。优先用 command.name（含插件前缀的限定名）而非可能剥掉前缀的 userFacingName。
function formatCommandLoadingMetadata(command: CommandBase & PromptCommand, args?: string): string {
  // Use command.name (the qualified name including plugin prefix, e.g.
  // "product-management:feature-spec") instead of userFacingName() which may
  // strip the plugin prefix via displayName fallback.
  // User-invocable skills should show as /command-name like regular slash commands
  if (command.userInvocable !== false) {
    return formatSlashCommandLoadingMetadata(command.name, args);
  }
  // Model-only skills (userInvocable: false) show as "The X skill is running"
  if (command.loadedFrom === 'skills' || command.loadedFrom === 'plugin' || command.loadedFrom === 'mcp') {
    return formatSkillLoadingMetadata(command.name, command.progressMessage);
  }
  return formatSlashCommandLoadingMetadata(command.name, args);
}
// processPromptSlashCommand：供 Skill 工具等直接按命令名取 prompt 型斜杠命令的消息；命令不存在或类型不对就抛错。
export async function processPromptSlashCommand(commandName: string, args: string, commands: Command[], context: ToolUseContext, imageContentBlocks: ContentBlockParam[] = []): Promise<SlashCommandResult> {
  const command = findCommand(commandName, commands);
  if (!command) {
    throw new MalformedCommandError(`Unknown command: ${commandName}`);
  }
  if (command.type !== 'prompt') {
    throw new Error(`Unexpected ${command.type} command. Expected 'prompt' command. Use /${commandName} directly in the main conversation.`);
  }
  return getMessagesForPromptSlashCommand(command, args, context, [], imageContentBlocks);
}
// getMessagesForPromptSlashCommand：真正构造 prompt 型命令消息的地方。处理协调器模式短路、注册技能钩子、记录技能调用用于压缩保留，并组装主消息（含粘贴的图片、前置输入块、附件、命令权限）。
async function getMessagesForPromptSlashCommand(command: CommandBase & PromptCommand, args: string, context: ToolUseContext, precedingInputBlocks: ContentBlockParam[] = [], imageContentBlocks: ContentBlockParam[] = [], uuid?: string): Promise<SlashCommandResult> {
  // In coordinator mode (main thread only), skip loading the full skill content
  // and permissions. The coordinator only has Agent + TaskStop tools, so the
  // skill content and allowedTools are useless. Instead, send a brief summary
  // telling the coordinator how to delegate this skill to a worker.
  //
  // Workers run in-process and inherit CLAUDE_CODE_COORDINATOR_MODE from the
  // parent env, so we also check !context.agentId: agentId is only set for
  // subagents, letting workers fall through to getPromptForCommand and receive
  // the real skill content when they invoke the Skill tool.
  if (feature('COORDINATOR_MODE') && isEnvTruthy(process.env.CLAUDE_CODE_COORDINATOR_MODE) && !context.agentId) {
// 协调器模式短路：在主线程且开启 COORDINATOR_MODE、又不是子 agent 时，不加载完整技能内容与权限（协调器只有 Agent 与 TaskStop 工具，那些没用），只发一段简要说明，告诉协调器如何把这个技能委派给 worker。worker 是进程内运行并继承协调器环境变量，会在调用 Skill 工具时拿到真实内容。
    const metadata = formatCommandLoadingMetadata(command, args);
    const parts: string[] = [`Skill "/${command.name}" is available for workers.`];
    if (command.description) {
      parts.push(`Description: ${command.description}`);
    }
    if (command.whenToUse) {
      parts.push(`When to use: ${command.whenToUse}`);
    }
    const skillAllowedTools = command.allowedTools ?? [];
    if (skillAllowedTools.length > 0) {
      parts.push(`This skill grants workers additional tool permissions: ${skillAllowedTools.join(', ')}`);
    }
    parts.push(`\nInstruct a worker to use this skill by including "Use the /${command.name} skill" in your Agent prompt. The worker has access to the Skill tool and will receive the skill's content and permissions when it invokes it.`);
    const summaryContent: ContentBlockParam[] = [{
      type: 'text',
      text: parts.join('\n')
    }];
    return {
      messages: [createUserMessage({
        content: metadata,
        uuid
      }), createUserMessage({
        content: summaryContent,
        isMeta: true
      })],
      shouldQuery: true,
      model: command.model,
      effort: command.effort,
      command
    };
  }
  const result = await command.getPromptForCommand(args, context);

  // Register skill hooks if defined. Under ["hooks"]-only (skills not locked),
  // user skills still load and reach this point — block hook REGISTRATION here
  // where source is known. Mirrors the agent frontmatter gate in runAgent.ts.
  const hooksAllowedForThisSkill = !isRestrictedToPluginOnly('hooks') || isSourceAdminTrusted(command.source);
// 注册技能钩子：在 hooks 仅锁定（技能未锁）模式下，用户技能仍会加载到此处——就在 source 已知的地方拦下钩子注册，与 runAgent.ts 里 agent 前 matter 的门控保持一致。
  if (command.hooks && hooksAllowedForThisSkill) {
    const sessionId = getSessionId();
    registerSkillHooks(context.setAppState, sessionId, command.hooks, command.name, command.type === 'prompt' ? command.skillRoot : undefined);
  }

  // Record skill invocation for compaction preservation, scoped by agent context.
  // Skills are tagged with their agentId so only skills belonging to the current
  // agent are restored during compaction (preventing cross-agent leaks).
  const skillPath = command.source ? `${command.source}:${command.name}` : command.name;
  const skillContent = result.filter((b): b is TextBlockParam => b.type === 'text').map(b => b.text).join('\n\n');
  addInvokedSkill(command.name, skillPath, skillContent, getAgentContext()?.agentId ?? null);
  const metadata = formatCommandLoadingMetadata(command, args);
  const additionalAllowedTools = parseToolListFromCLI(command.allowedTools ?? []);

  // Create content for the main message, including any pasted images
  const mainMessageContent: ContentBlockParam[] = imageContentBlocks.length > 0 || precedingInputBlocks.length > 0 ? [...imageContentBlocks, ...precedingInputBlocks, ...result] : result;

  // Extract attachments from command arguments (@-mentions, MCP resources,
  // agent mentions in SKILL.md). skipSkillDiscovery prevents the SKILL.md
  // content itself from triggering discovery — it's meta-content, not user
  // intent, and a large SKILL.md (e.g. 110KB) would fire chunked AKI queries
  // adding seconds of latency to every skill invocation.
// 附件抽取与发现：从命令参数里抽取 @提及、MCP 资源、SKILL.md 里的 agent 提及作为附件；skipSkillDiscovery 防止 SKILL.md 内容本身触发技能发现——它是元内容而非用户意图，一个很大的 SKILL.md（如 110KB）会触发分块 AKI 查询，给每次技能调用凭空加几秒延迟。
  const attachmentMessages = await toArray(getAttachmentMessages(result.filter((block): block is TextBlockParam => block.type === 'text').map(block => block.text).join(' '), context, null, [],
  // queuedCommands - handled by query.ts for mid-turn attachments
  context.messages, 'repl_main_thread', {
    skipSkillDiscovery: true
  }));
  const messages = [createUserMessage({
    content: metadata,
    uuid
  }), createUserMessage({
    content: mainMessageContent,
    isMeta: true
  }), ...attachmentMessages, createAttachmentMessage({
    type: 'command_permissions',
    allowedTools: additionalAllowedTools,
    model: command.model
  })];
  return {
    messages,
    shouldQuery: true,
    allowedTools: additionalAllowedTools,
    model: command.model,
    effort: command.effort,
    command
  };
}
// 原文件此处有一行 102420 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。