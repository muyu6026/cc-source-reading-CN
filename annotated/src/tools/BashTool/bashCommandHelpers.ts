import type { z } from 'zod/v4'
import {
  isUnsafeCompoundCommand_DEPRECATED,
  splitCommand_DEPRECATED,
} from '../../utils/bash/commands.js'
import {
  buildParsedCommandFromRoot,
  type IParsedCommand,
  ParsedCommand,
} from '../../utils/bash/ParsedCommand.js'
import { type Node, PARSE_ABORTED } from '../../utils/bash/parser.js'
import type { PermissionResult } from '../../utils/permissions/PermissionResult.js'
import type { PermissionUpdate } from '../../utils/permissions/PermissionUpdateSchema.js'
import { createPermissionRequestMessage } from '../../utils/permissions/permissions.js'
import { BashTool } from './BashTool.js'
import { bashCommandIsSafeAsync_DEPRECATED } from './bashSecurity.js'

export type CommandIdentityCheckers = {
// CommandIdentityCheckers 是注入的两个身份判定函数（cd/git）——从 bashPermissions.ts 传进来，避免循环依赖。
  isNormalizedCdCommand: (command: string) => boolean
  isNormalizedGitCommand: (command: string) => boolean
}

async function segmentedCommandPermissionResult(
// segmentedCommandPermissionResult 处理管道分段命令的权限聚合：每段单独过完整权限系统，再按 deny > ask > allow 汇总。
  input: z.infer<typeof BashTool.inputSchema>,
  segments: string[],
  bashToolHasPermissionFn: (
    input: z.infer<typeof BashTool.inputSchema>,
  ) => Promise<PermissionResult>,
  checkers: CommandIdentityCheckers,
): Promise<PermissionResult> {
  // Check for multiple cd commands across all segments
// 一条命令里多个 cd → ask（「一次说清」原则：连串目录切换人容易看漏）。
  const cdCommands = segments.filter(segment => {
    const trimmed = segment.trim()
    return checkers.isNormalizedCdCommand(trimmed)
  })
  if (cdCommands.length > 1) {
    const decisionReason = {
      type: 'other' as const,
      reason:
        'Multiple directory changes in one command require approval for clarity',
    }
    return {
      behavior: 'ask',
      decisionReason,
      message: createPermissionRequestMessage(BashTool.name, decisionReason),
    }
  }

  // SECURITY: Check for cd+git across pipe segments to prevent bare repo fsmonitor bypass.
  // When cd and git are in different pipe segments (e.g., "cd sub && echo | git status"),
  // each segment is checked independently and neither triggers the cd+git check in
  // bashPermissions.ts. We must detect this cross-segment pattern here.
  // Each pipe segment can itself be a compound command (e.g., "cd sub && echo"),
  // so we split each segment into subcommands before checking.
// 跨管道段的 cd+git 检测。`cd sub && echo | git status` 每段单独看都不触发 cd+git 检查（bashPermissions.ts 里的检查只在一个复合命令内生效），但攻击成立：cd 进恶意目录，git 从管道另一端执行。每段还可能自己是复合命令，所以先拆子命令再扫。
  {
    let hasCd = false
    let hasGit = false
    for (const segment of segments) {
      const subcommands = splitCommand_DEPRECATED(segment)
      for (const sub of subcommands) {
        const trimmed = sub.trim()
        if (checkers.isNormalizedCdCommand(trimmed)) {
          hasCd = true
        }
        if (checkers.isNormalizedGitCommand(trimmed)) {
          hasGit = true
        }
      }
    }
    if (hasCd && hasGit) {
      const decisionReason = {
        type: 'other' as const,
        reason:
          'Compound commands with cd and git require approval to prevent bare repository attacks',
      }
      return {
        behavior: 'ask',
        decisionReason,
        message: createPermissionRequestMessage(BashTool.name, decisionReason),
      }
    }
  }

  const segmentResults = new Map<string, PermissionResult>()
// segmentResults 用 Map 缓存每段结果——同一段可能被多个检查引用，且最终 decisionReason 要把全部结果带上。

  // Check each segment through the full permission system
  for (const segment of segments) {
    const trimmedSegment = segment.trim()
    if (!trimmedSegment) continue // Skip empty segments

    const segmentResult = await bashToolHasPermissionFn({
      ...input,
      command: trimmedSegment,
    })
    segmentResults.set(trimmedSegment, segmentResult)
  }

  // Check if any segment is denied (after evaluating all)
// 先全部评估完再找 deny：不能遇到第一个 deny 就返回，decisionReason 需要完整的 subcommandResults。
  const deniedSegment = Array.from(segmentResults.entries()).find(
    ([, result]) => result.behavior === 'deny',
  )

  if (deniedSegment) {
    const [segmentCommand, segmentResult] = deniedSegment
    return {
      behavior: 'deny',
      message:
        segmentResult.behavior === 'deny'
          ? segmentResult.message
          : `Permission denied for: ${segmentCommand}`,
      decisionReason: {
// deny 的 decisionReason 类型是 subcommandResults——把每段的判定依据全带給用户/日志。
        type: 'subcommandResults',
        reasons: segmentResults,
      },
    }
  }

  const allAllowed = Array.from(segmentResults.values()).every(
// 全 allow 才整体 allow；任何一段 ask 就整体 ask。
    result => result.behavior === 'allow',
  )

  if (allAllowed) {
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: {
        type: 'subcommandResults',
        reasons: segmentResults,
      },
    }
  }

  // Collect suggestions from segments that need approval
// 建议从各段收集：ask 段的 suggestions 汇总到顶层，用户一次批准全部受益。
  const suggestions: PermissionUpdate[] = []
  for (const [, result] of segmentResults) {
    if (
      result.behavior !== 'allow' &&
      'suggestions' in result &&
      result.suggestions
    ) {
      suggestions.push(...result.suggestions)
    }
  }

  const decisionReason = {
    type: 'subcommandResults' as const,
    reasons: segmentResults,
  }

  return {
    behavior: 'ask',
    message: createPermissionRequestMessage(BashTool.name, decisionReason),
    decisionReason,
    suggestions: suggestions.length > 0 ? suggestions : undefined,
  }
}

/**
 * Builds a command segment, stripping output redirections to avoid
 * treating filenames as commands in permission checking.
 * Uses ParsedCommand to preserve original quoting.
 */
// buildSegmentWithoutRedirections：剥掉输出重定向再送去权限检查——否则 `echo x > foo.txt` 的 foo.txt 会被当成命令名。ParsedCommand 保留原始引号。
async function buildSegmentWithoutRedirections(
  segmentCommand: string,
): Promise<string> {
  // Fast path: skip parsing if no redirection operators present
// 没有 > 就跳过解析的快路径。
  if (!segmentCommand.includes('>')) {
    return segmentCommand
  }

  // Use ParsedCommand to strip redirections while preserving quotes
  const parsed = await ParsedCommand.parse(segmentCommand)
  return parsed?.withoutOutputRedirections() ?? segmentCommand
}

/**
 * Wrapper that resolves an IParsedCommand (from a pre-parsed AST root if
 * available, else via ParsedCommand.parse) and delegates to
 * bashToolCheckCommandOperatorPermissions.
 */
// checkCommandOperatorPermissions 优先用预解析的 AST root（上游已 tree-sitter 解析过），没有才现解析。PARSE_ABORTED 是解析超限的哨兵，与 null 区分。
export async function checkCommandOperatorPermissions(
  input: z.infer<typeof BashTool.inputSchema>,
  bashToolHasPermissionFn: (
    input: z.infer<typeof BashTool.inputSchema>,
  ) => Promise<PermissionResult>,
  checkers: CommandIdentityCheckers,
  astRoot: Node | null | typeof PARSE_ABORTED,
): Promise<PermissionResult> {
  const parsed =
    astRoot && astRoot !== PARSE_ABORTED
      ? buildParsedCommandFromRoot(input.command, astRoot)
      : await ParsedCommand.parse(input.command)
  if (!parsed) {
    return { behavior: 'passthrough', message: 'Failed to parse command' }
  }
  return bashToolCheckCommandOperatorPermissions(
    input,
    bashToolHasPermissionFn,
    checkers,
    parsed,
  )
}

/**
 * Checks if the command has special operators that require behavior beyond
 * simple subcommand checking.
 */
// bashToolCheckCommandOperatorPermissions 两步：① 危险复合命令（子shell/命令组）→ ask 且不给建议（这种结构给规则也放不了）；② 有管道 → 分段处理。
async function bashToolCheckCommandOperatorPermissions(
  input: z.infer<typeof BashTool.inputSchema>,
  bashToolHasPermissionFn: (
    input: z.infer<typeof BashTool.inputSchema>,
  ) => Promise<PermissionResult>,
  checkers: CommandIdentityCheckers,
  parsed: IParsedCommand,
): Promise<PermissionResult> {
  // 1. Check for unsafe compound commands (subshells, command groups).
// 子shell (...) 和命令组 {...} 不可静态拆分，直接 ask。消息优先用 bashCommandIsSafeAsync 的具体原因。
  const tsAnalysis = parsed.getTreeSitterAnalysis()
  const isUnsafeCompound = tsAnalysis
    ? tsAnalysis.compoundStructure.hasSubshell ||
      tsAnalysis.compoundStructure.hasCommandGroup
    : isUnsafeCompoundCommand_DEPRECATED(input.command)
  if (isUnsafeCompound) {
    // This command contains an operator like `>` that we don't support as a subcommand separator
    // Check if bashCommandIsSafe_DEPRECATED has a more specific message
    const safetyResult = await bashCommandIsSafeAsync_DEPRECATED(input.command)

    const decisionReason = {
      type: 'other' as const,
      reason:
        safetyResult.behavior === 'ask' && safetyResult.message
          ? safetyResult.message
          : 'This command uses shell operators that require approval for safety',
    }
    return {
      behavior: 'ask',
      message: createPermissionRequestMessage(BashTool.name, decisionReason),
      decisionReason,
      // This is an unsafe compound command, so we don't want to suggest rules since we wont be able to allow it
    }
  }

  // 2. Check for piped commands using ParsedCommand (preserves quotes)
// 管道检测用 ParsedCommand.getPipeSegments（保留引号语义）。
  const pipeSegments = parsed.getPipeSegments()

  // If no pipes (single segment), let normal flow handle it
// 单段（无管道）直接 passthrough，交给常规流程。
  if (pipeSegments.length <= 1) {
    return {
      behavior: 'passthrough',
      message: 'No pipes found in command',
    }
  }

  // Strip output redirections from each segment while preserving quotes
  const segments = await Promise.all(
    pipeSegments.map(segment => buildSegmentWithoutRedirections(segment)),
  )

  // Handle as segmented command
  return segmentedCommandPermissionResult(
    input,
    segments,
    bashToolHasPermissionFn,
    checkers,
  )
}
