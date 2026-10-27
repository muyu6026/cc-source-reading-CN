/**
 * Shared command prefix extraction using Haiku LLM
 *
 * This module provides a factory for creating command prefix extractors
 * that can be used by different shell tools. The core logic
 * (Haiku query, response validation) is shared, while tool-specific
 * aspects (examples, pre-checks) are configurable.
 */

import chalk from 'chalk'
import type { QuerySource } from '../../constants/querySource.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import { queryHaiku } from '../../services/api/claude.js'
import { startsWithApiErrorPrefix } from '../../services/api/errors.js'
import { memoizeWithLRU } from '../memoize.js'
import { jsonStringify } from '../slowOperations.js'
import { asSystemPrompt } from '../systemPromptType.js'

/**
 * Shell executables that must never be accepted as bare prefixes.
 * Allowing e.g. "bash:*" would let any command through, defeating
 * the permission system. Includes Unix shells and Windows equivalents.
 */
const DANGEROUS_SHELL_PREFIXES = new Set([
// `DANGEROUS_SHELL_PREFIXES` 列出绝不可作为裸前缀接受的 shell 可执行文件，避免绕过权限系统。
  'sh',
  'bash',
  'zsh',
  'fish',
  'csh',
  'tcsh',
  'ksh',
  'dash',
  'cmd',
  'cmd.exe',
  'powershell',
  'powershell.exe',
  'pwsh',
  'pwsh.exe',
  'bash.exe',
])

// 危险前缀集合结束。
/**
 * Result of command prefix extraction
 */
export type CommandPrefixResult = {
// `CommandPrefixResult` 定义命令前缀提取结果结构。
  /** The detected command prefix, or null if no prefix could be determined */
  commandPrefix: string | null
}

/**
 * Result including subcommand prefixes for compound commands
 */
export type CommandSubcommandPrefixResult = CommandPrefixResult & {
  subcommandPrefixes: Map<string, CommandPrefixResult>
}
// `CommandSubcommandPrefixResult` 在前者基础上增加子命令前缀映射。

/**
 * Configuration for creating a command prefix extractor
 */
export type PrefixExtractorConfig = {
  /** Tool name for logging and warning messages */
  toolName: string

  /** The policy spec containing examples for Haiku */
  policySpec: string
  /** Analytics event name for logging */
  eventName: string

  /** Query source identifier for the API call */
  querySource: QuerySource

  /** Optional pre-check function that can short-circuit the Haiku call */
  preCheck?: (command: string) => CommandPrefixResult | null
}
// `PrefixExtractorConfig` 配置提取器：工具名、策略说明、事件名、查询源与可选预检函数。

/**
 * Creates a memoized command prefix extractor function.
 *
 * Uses two-layer memoization: the outer memoized function creates the promise
 * and attaches a .catch handler that evicts the cache entry on rejection.
 * This prevents aborted or failed Haiku calls from poisoning future lookups.
 *
 * Bounded to 200 entries via LRU to prevent unbounded growth in heavy sessions.
 *
 * @param config - Configuration for the extractor
 * @returns A memoized async function that extracts command prefixes
 */
export function createCommandPrefixExtractor(config: PrefixExtractorConfig) {
// `createCommandPrefixExtractor` 工厂，创建带双层记忆化的前缀提取器。
  const { toolName, policySpec, eventName, querySource, preCheck } = config

  const memoized = memoizeWithLRU(
    (
      command: string,
      abortSignal: AbortSignal,
      isNonInteractiveSession: boolean,
    ): Promise<CommandPrefixResult | null> => {
      const promise = getCommandPrefixImpl(
        command,
        abortSignal,
        isNonInteractiveSession,
        toolName,
        policySpec,
        eventName,
        querySource,
        preCheck,
      )
      // Evict on rejection so aborted calls don't poison future turns.
      // Identity guard: after LRU eviction, a newer promise may occupy
      // this key; a stale rejection must not delete it.
      promise.catch(() => {
// 失败时从缓存移除该条目，并用身份守卫防止误删已被新 Promise 占用的键。
        if (memoized.cache.get(command) === promise) {
          memoized.cache.delete(command)
        }
      })
      return promise
    },
    command => command, // memoize by command only
    200,
// 记忆化仅以命令字符串为键，上限 200 条防止会话中无限增长。
  )

  return memoized
}
// 工厂返回记忆化后的提取函数。

/**
 * Creates a memoized function to get prefixes for compound commands with subcommands.
 *
 * Uses the same two-layer memoization pattern as createCommandPrefixExtractor:
 * a .catch handler evicts the cache entry on rejection to prevent poisoning.
 *
 * @param getPrefix - The single-command prefix extractor (from createCommandPrefixExtractor)
 * @param splitCommand - Function to split a compound command into subcommands
 * @returns A memoized async function that extracts prefixes for the main command and all subcommands
 */
export function createSubcommandPrefixExtractor(
// `createSubcommandPrefixExtractor` 为复合命令构建子命令前缀提取器。
  getPrefix: ReturnType<typeof createCommandPrefixExtractor>,
  splitCommand: (command: string) => string[] | Promise<string[]>,
) {
  const memoized = memoizeWithLRU(
    (
      command: string,
      abortSignal: AbortSignal,
      isNonInteractiveSession: boolean,
    ): Promise<CommandSubcommandPrefixResult | null> => {
      const promise = getCommandSubcommandPrefixImpl(
        command,
        abortSignal,
        isNonInteractiveSession,
        getPrefix,
        splitCommand,
      )
      // Evict on rejection so aborted calls don't poison future turns.
      // Identity guard: after LRU eviction, a newer promise may occupy
      // this key; a stale rejection must not delete it.
      promise.catch(() => {
// 子命令提取器同样在拒绝时清理缓存。
        if (memoized.cache.get(command) === promise) {
          memoized.cache.delete(command)
        }
      })
      return promise
    },
    command => command, // memoize by command only
    200,
  )

  return memoized
}
// 子命令提取器工厂结束。

async function getCommandPrefixImpl(
  command: string,
  abortSignal: AbortSignal,
  isNonInteractiveSession: boolean,
  toolName: string,
  policySpec: string,
  eventName: string,
  querySource: QuerySource,
  preCheck?: (command: string) => CommandPrefixResult | null,
): Promise<CommandPrefixResult | null> {
// `getCommandPrefixImpl` 实现：调用 Haiku 大模型提取命令前缀。
  if (process.env.NODE_ENV === 'test') {
    return null
// 测试环境下直接返回 null，跳过模型调用。
  }

  // Run pre-check if provided (e.g., isHelpCommand for Bash)
  if (preCheck) {
// 先执行预检（如 Bash 的 isHelpCommand）以短路 Haiku 调用。
    const preCheckResult = preCheck(command)
    if (preCheckResult !== null) {
      return preCheckResult
    }
  }

  let preflightCheckTimeoutId: NodeJS.Timeout | undefined
// 设置预检超时计时器，耗时过长时输出告警。
  const startTime = Date.now()
  let result: CommandPrefixResult | null = null

  try {
    // Log a warning if the pre-flight check takes too long
    preflightCheckTimeoutId = setTimeout(
      (tn, nonInteractive) => {
        const message = `[${tn}Tool] Pre-flight check is taking longer than expected. Run with ANTHROPIC_LOG=debug to check for failed or slow API requests.`
        if (nonInteractive) {
          process.stderr.write(jsonStringify({ level: 'warn', message }) + '\n')
        } else {
          // biome-ignore lint/suspicious/noConsole: intentional warning
          console.warn(chalk.yellow(`⚠️  ${message}`))
        }
      },
      10000, // 10 seconds
      toolName,
      isNonInteractiveSession,
    )

    const useSystemPromptPolicySpec = getFeatureValue_CACHED_MAY_BE_STALE(
// 读取特性开关决定是否采用系统提示策略写法。
      'tengu_cork_m4q',
      false,
    )

    const response = await queryHaiku({
// 调用 queryHaiku 得到候选前缀。
      systemPrompt: asSystemPrompt(
        useSystemPromptPolicySpec
          ? [
              `Your task is to process ${toolName} commands that an AI coding agent wants to run.\n\n${policySpec}`,
            ]
          : [
              `Your task is to process ${toolName} commands that an AI coding agent wants to run.\n\nThis policy spec defines how to determine the prefix of a ${toolName} command:`,
            ],
      ),
      userPrompt: useSystemPromptPolicySpec
        ? `Command: ${command}`
        : `${policySpec}\n\nCommand: ${command}`,
      signal: abortSignal,
      options: {
        enablePromptCaching: useSystemPromptPolicySpec,
        querySource,
        agents: [],
        isNonInteractiveSession,
        hasAppendSystemPrompt: false,
        mcpTools: [],
      },
    })

    // Clear the timeout since the query completed
    clearTimeout(preflightCheckTimeoutId)
// 查询完成后清除超时计时器并记录耗时。
    const durationMs = Date.now() - startTime

    const prefix =
      typeof response.message.content === 'string'
        ? response.message.content
        : Array.isArray(response.message.content)
          ? (response.message.content.find(_ => _.type === 'text')?.text ??
            'none')
          : 'none'
// 从响应中取出前缀文本，兼容字符串或数组内容。

    if (startsWithApiErrorPrefix(prefix)) {
// 前缀是 API 错误前缀时记录事件并置空。
      logEvent(eventName, {
        success: false,
        error:
          'API error' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        durationMs,
      })
      result = null
    } else if (prefix === 'command_injection_detected') {
// 模型检测到命令注入特征时按无前缀处理。
      // Haiku detected something suspicious - treat as no prefix available
      logEvent(eventName, {
        success: false,
        error:
          'command_injection_detected' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        durationMs,
      })
      result = {
        commandPrefix: null,
      }
    } else if (
// 绝不接受裸 git 或 shell 可执行文件作为前缀。
      prefix === 'git' ||
      DANGEROUS_SHELL_PREFIXES.has(prefix.toLowerCase())
    ) {
      // Never accept bare `git` or shell executables as a prefix
      logEvent(eventName, {
        success: false,
        error:
          'dangerous_shell_prefix' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        durationMs,
      })
      result = {
        commandPrefix: null,
      }
    } else if (prefix === 'none') {
// 前缀为 none 时记录并返回空。
      // No prefix detected
      logEvent(eventName, {
        success: false,
        error:
          'prefix "none"' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        durationMs,
      })
      result = {
        commandPrefix: null,
      }
    } else {
// 校验前缀确实是指令开头，否则记录并返回空。
      // Validate that the prefix is actually a prefix of the command

      if (!command.startsWith(prefix)) {
        // Prefix isn't actually a prefix of the command
        logEvent(eventName, {
          success: false,
          error:
            'command did not start with prefix' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          durationMs,
        })
        result = {
          commandPrefix: null,
        }
      } else {
        logEvent(eventName, {
          success: true,
          durationMs,
        })
        result = {
          commandPrefix: prefix,
        }
      }
    }

    return result
// 返回最终提取结果。
  } catch (error) {
    clearTimeout(preflightCheckTimeoutId)
    throw error
  }
}
// `getCommandPrefixImpl` 结束。

async function getCommandSubcommandPrefixImpl(
  command: string,
  abortSignal: AbortSignal,
  isNonInteractiveSession: boolean,
  getPrefix: ReturnType<typeof createCommandPrefixExtractor>,
  splitCommandFn: (command: string) => string[] | Promise<string[]>,
): Promise<CommandSubcommandPrefixResult | null> {
// `getCommandSubcommandPrefixImpl` 实现子命令前缀提取。
  const subcommands = await splitCommandFn(command)
// 先用 splitCommand 拆出子命令。

  const [fullCommandPrefix, ...subcommandPrefixesResults] = await Promise.all([
// 并行获取整体与每个子命令的前缀。
    getPrefix(command, abortSignal, isNonInteractiveSession),
    ...subcommands.map(async subcommand => ({
      subcommand,
      prefix: await getPrefix(subcommand, abortSignal, isNonInteractiveSession),
    })),
  ])

  if (!fullCommandPrefix) {
// 整体无前缀时整体返回 null。
    return null
  }

  const subcommandPrefixes = subcommandPrefixesResults.reduce(
    (acc, { subcommand, prefix }) => {
      if (prefix) {
        acc.set(subcommand, prefix)
      }
      return acc
    },
    new Map<string, CommandPrefixResult>(),
  )
// 汇总子命令前缀并返回完整结果。

  return {
    ...fullCommandPrefix,
    subcommandPrefixes,
  }
}
