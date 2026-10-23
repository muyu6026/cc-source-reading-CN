import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import { splitCommand_DEPRECATED } from '../../utils/bash/commands.js'
import { SandboxManager } from '../../utils/sandbox/sandbox-adapter.js'
import { getSettings_DEPRECATED } from '../../utils/settings/settings.js'
import {
  BINARY_HIJACK_VARS,
  bashPermissionRule,
  matchWildcardPattern,
  stripAllLeadingEnvVars,
  stripSafeWrappers,
} from './bashPermissions.js'

type SandboxInput = {
  command?: string
  dangerouslyDisableSandbox?: boolean
}

// NOTE: excludedCommands is a user-facing convenience feature, not a security boundary.
// It is not a security bug to be able to bypass excludedCommands — the sandbox permission
// system (which prompts users) is the actual security control.
// 文件级 NOTE：excludedCommands 是**用户便利功能，不是安全边界**。能绕过它不是安全 bug——沙箱权限系统（会弹窗问用户）才是真正的控制。
function containsExcludedCommand(command: string): boolean {
// containsExcludedCommand 两级检查：ant 动态配置（GrowthBook 远程下发的禁用命令）+ 用户 settings 配置。
  // Check dynamic config for disabled commands and substrings (only for ants)
  if (process.env.USER_TYPE === 'ant') {
// ant 用户的禁用命令从 GrowthBook 特性 tengu_sandbox_disabled_commands 动态取——可以在不发版的情况下全局拉黑某个命令。
    const disabledCommands = getFeatureValue_CACHED_MAY_BE_STALE<{
      commands: string[]
      substrings: string[]
    }>('tengu_sandbox_disabled_commands', { commands: [], substrings: [] })

    // Check if command contains any disabled substrings
    for (const substring of disabledCommands.substrings) {
      if (command.includes(substring)) {
        return true
      }
    }

    // Check if command starts with any disabled commands
    try {
// 动态配置解析失败时静默跳过（catch 里不抛）——渲染工具消息路径不能因为配置格式错误而崩。
      const commandParts = splitCommand_DEPRECATED(command)
      for (const part of commandParts) {
        const baseCommand = part.trim().split(' ')[0]
        if (baseCommand && disabledCommands.commands.includes(baseCommand)) {
          return true
        }
      }
    } catch {
// 注释说明了为什么吞异常：命令解析失败（畸形 bash）时当作「未排除」，交给后续校验处理，防止渲染路径崩溃。
      // If we can't parse the command (e.g., malformed bash syntax),
      // treat it as not excluded to allow other validation checks to handle it
      // This prevents crashes when rendering tool use messages
    }
  }

  // Check user-configured excluded commands from settings
// 用户配置从 settings.sandbox.excludedCommands 取。
  const settings = getSettings_DEPRECATED()
  const userExcludedCommands = settings.sandbox?.excludedCommands ?? []

  if (userExcludedCommands.length === 0) {
    return false
  }

  // Split compound commands (e.g. "docker ps && curl evil.com") into individual
  // subcommands and check each one against excluded patterns. This prevents a
  // compound command from escaping the sandbox just because its first subcommand
  // matches an excluded pattern.
// 复合命令必须拆开逐段匹配：`docker ps && curl evil.com` 不能因为第一段命中排除模式就整条逃出沙箱。
  let subcommands: string[]
// 拆命令失败退化成「整条当一个子命令」——fail-open 到后续检查。
  try {
    subcommands = splitCommand_DEPRECATED(command)
  } catch {
    subcommands = [command]
  }

  for (const subcommand of subcommands) {
    const trimmed = subcommand.trim()
    // Also try matching with env var prefixes and wrapper commands stripped, so
    // that `FOO=bar bazel ...` and `timeout 30 bazel ...` match `bazel:*`. Not a
    // security boundary (see NOTE at top); the &&-split above already lets
    // `export FOO=bar && bazel ...` match. BINARY_HIJACK_VARS kept as a heuristic.
    //
    // We iteratively apply both stripping operations until no new candidates are
    // produced (fixed-point), matching the approach in filterRulesByContentsMatchingInput.
    // This handles interleaved patterns like `timeout 300 FOO=bar bazel run`
    // where single-pass composition would fail.
// env 前缀和 wrapper 也要剥掉再匹配：`FOO=bar bazel ...` 和 `timeout 30 bazel ...` 都要能命中 `bazel:*` 模式。注释同时点明 && 拆分已经覆盖了 `export FOO=bar && bazel` 的形态，BINARY_HIJACK_VARS 在这里只是启发式。
// 不动点迭代：反复应用「剥 env」和「剥 wrapper」直到没有新候选——处理 `timeout 300 FOO=bar bazel run` 这种交替嵌套，单趟组合会漏。与 filterRulesByContentsMatchingInput 同一思路。
    const candidates = [trimmed]
// candidates + seen 的工作集算法：每轮处理上一轮新增的候选，直到稳定。
    const seen = new Set(candidates)
    let startIdx = 0
    while (startIdx < candidates.length) {
      const endIdx = candidates.length
      for (let i = startIdx; i < endIdx; i++) {
        const cmd = candidates[i]!
        const envStripped = stripAllLeadingEnvVars(cmd, BINARY_HIJACK_VARS)
        if (!seen.has(envStripped)) {
          candidates.push(envStripped)
          seen.add(envStripped)
        }
        const wrapperStripped = stripSafeWrappers(cmd)
        if (!seen.has(wrapperStripped)) {
          candidates.push(wrapperStripped)
          seen.add(wrapperStripped)
        }
      }
      startIdx = endIdx
    }

    for (const pattern of userExcludedCommands) {
// 三种规则类型逐候选匹配：prefix（前缀 + 词边界）、exact（全等）、wildcard（通配符）。
      const rule = bashPermissionRule(pattern)
      for (const cand of candidates) {
        switch (rule.type) {
          case 'prefix':
            if (cand === rule.prefix || cand.startsWith(rule.prefix + ' ')) {
              return true
            }
            break
          case 'exact':
            if (cand === rule.command) {
              return true
            }
            break
          case 'wildcard':
            if (matchWildcardPattern(rule.pattern, cand)) {
              return true
            }
            break
        }
      }
    }
  }

  return false
}

export function shouldUseSandbox(input: Partial<SandboxInput>): boolean {
// shouldUseSandbox 是总决策：沙箱没启用 → 不进沙箱；显式禁用且策略允许 → 不进；无命令 → 不进；命中排除命令 → 不进；其余进。
  if (!SandboxManager.isSandboxingEnabled()) {
    return false
  }

  // Don't sandbox if explicitly overridden AND unsandboxed commands are allowed by policy
// dangerouslyDisableSandbox 要与 areUnsandboxedCommandsAllowed 策略**同时**满足才放行——用户单方面请求不能突破策略（对应 prompt.ts 里「策略禁用时任何情况都必须沙箱内运行」）。
  if (
    input.dangerouslyDisableSandbox &&
    SandboxManager.areUnsandboxedCommandsAllowed()
  ) {
    return false
  }

  if (!input.command) {
    return false
  }

  // Don't sandbox if the command contains user-configured excluded commands
  if (containsExcludedCommand(input.command)) {
    return false
  }

  return true
}
