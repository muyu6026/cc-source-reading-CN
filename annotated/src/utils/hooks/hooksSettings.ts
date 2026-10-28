// 注：本文件汇总与展示「钩子（Hook）设置」——把来自用户/项目/本地/会话/插件/内置等多来源的钩子收集成统一结构，并提供排序与展示文案。
import { resolve } from 'path'
import type { HookEvent } from 'src/entrypoints/agentSdkTypes.js'
import { getSessionId } from '../../bootstrap/state.js'
import type { AppState } from '../../state/AppState.js'
import type { EditableSettingSource } from '../settings/constants.js'
import { SOURCES } from '../settings/constants.js'
import {
  getSettingsFilePathForSource,
  getSettingsForSource,
} from '../settings/settings.js'
import type { HookCommand, HookMatcher } from '../settings/types.js'
import { DEFAULT_HOOK_SHELL } from '../shell/shellProvider.js'
import { getSessionHooks } from './sessionHooks.js'

// 注：HookSource 是钩子来源的并集类型，除了三种可编辑来源，还含策略设置、插件、会话与内置四类。
export type HookSource =
  | EditableSettingSource
  | 'policySettings'
  | 'pluginHook'
  | 'sessionHook'
  | 'builtinHook'

// 注：IndividualHookConfig 描述单条钩子的扁平记录：事件名、命令配置、匹配串、来源，以及可选的插件名。
export interface IndividualHookConfig {
  event: HookEvent
  config: HookCommand
  matcher?: string
  source: HookSource
  pluginName?: string
}

/**
 * Check if two hooks are equal (comparing only command/prompt content, not timeout)
 */
// 注：isHookEqual 判断两条钩子是否等价，只比较命令/提示/代理/网址内容与匹配条件，不比较超时；函数型钩子无法比较，恒返回 false。
export function isHookEqual(
  a: HookCommand | { type: 'function'; timeout?: number },
  b: HookCommand | { type: 'function'; timeout?: number },
): boolean {
  if (a.type !== b.type) return false

  // Use switch for exhaustive type checking
  // Note: We only compare command/prompt content, not timeout
  // `if` is part of identity: same command with different `if` conditions
  // are distinct hooks (e.g., setup.sh if=Bash(git *) vs if=Bash(npm *)).
  const sameIf = (x: { if?: string }, y: { if?: string }) =>
    (x.if ?? '') === (y.if ?? '')
  switch (a.type) {
    case 'command':
      // shell is part of identity: same command string with different
      // shells are distinct hooks. Default 'bash' so undefined === 'bash'.
      return (
        b.type === 'command' &&
        a.command === b.command &&
        (a.shell ?? DEFAULT_HOOK_SHELL) === (b.shell ?? DEFAULT_HOOK_SHELL) &&
        sameIf(a, b)
      )
    case 'prompt':
      return b.type === 'prompt' && a.prompt === b.prompt && sameIf(a, b)
    case 'agent':
      return b.type === 'agent' && a.prompt === b.prompt && sameIf(a, b)
    case 'http':
      return b.type === 'http' && a.url === b.url && sameIf(a, b)
    case 'function':
      // Function hooks can't be compared (no stable identifier)
      return false
  }
}

// 注：getHookDisplayText 返回钩子的展示文本：优先用自定义状态消息，否则按类型取命令串、提示串、网址或回调/函数字样。
/** Get the display text for a hook */
export function getHookDisplayText(
  hook: HookCommand | { type: 'callback' | 'function'; statusMessage?: string },
): string {
  // Return custom status message if provided
  if ('statusMessage' in hook && hook.statusMessage) {
    return hook.statusMessage
  }

  switch (hook.type) {
    case 'command':
      return hook.command
    case 'prompt':
      return hook.prompt
    case 'agent':
      return hook.prompt
    case 'http':
      return hook.url
    case 'callback':
      return 'callback'
    case 'function':
      return 'function'
  }
}

// 注：getAllHooks 是核心收集器：若未限定只显示受管钩子，就从用户/项目/本地三种来源去重收集，再并入会话钩子。
export function getAllHooks(appState: AppState): IndividualHookConfig[] {
  const hooks: IndividualHookConfig[] = []

  // Check if restricted to managed hooks only
  const policySettings = getSettingsForSource('policySettings')
  const restrictedToManagedOnly = policySettings?.allowManagedHooksOnly === true

  // If allowManagedHooksOnly is set, don't show any hooks in the UI
  // (user/project/local are blocked, and managed hooks are intentionally hidden)
  if (!restrictedToManagedOnly) {
    // Get hooks from all editable sources
    const sources = [
      'userSettings',
      'projectSettings',
      'localSettings',
    ] as EditableSettingSource[]

    // Track which settings files we've already processed to avoid duplicates
    // (e.g., when running from home directory, userSettings and projectSettings
    // both resolve to ~/.claude/settings.json)
    const seenFiles = new Set<string>()

    for (const source of sources) {
      const filePath = getSettingsFilePathForSource(source)
      if (filePath) {
        const resolvedPath = resolve(filePath)
        if (seenFiles.has(resolvedPath)) {
          continue
        }
        seenFiles.add(resolvedPath)
      }

      const sourceSettings = getSettingsForSource(source)
      if (!sourceSettings?.hooks) {
        continue
      }

      for (const [event, matchers] of Object.entries(sourceSettings.hooks)) {
        for (const matcher of matchers as HookMatcher[]) {
          for (const hookCommand of matcher.hooks) {
            hooks.push({
              event: event as HookEvent,
              config: hookCommand,
              matcher: matcher.matcher,
              source,
            })
          }
        }
      }
    }
  }

  // Get session hooks
  const sessionId = getSessionId()
  const sessionHooks = getSessionHooks(appState, sessionId)
  for (const [event, matchers] of sessionHooks.entries()) {
    for (const matcher of matchers) {
      for (const hookCommand of matcher.hooks) {
        hooks.push({
          event,
          config: hookCommand,
          matcher: matcher.matcher,
          source: 'sessionHook',
        })
      }
    }
  }

  return hooks
}

// 注：getHooksForEvent 是便捷封装，按事件名过滤 getAllHooks 的结果。
export function getHooksForEvent(
  appState: AppState,
  event: HookEvent,
): IndividualHookConfig[] {
  return getAllHooks(appState).filter(hook => hook.event === event)
}

// 注：三个 hookSource 开头的展示函数分别给出来源的完整路径说明、分组标题与内联短名，供 UI 三处展示。
export function hookSourceDescriptionDisplayString(source: HookSource): string {
  switch (source) {
    case 'userSettings':
      return 'User settings (~/.claude/settings.json)'
    case 'projectSettings':
      return 'Project settings (.claude/settings.json)'
    case 'localSettings':
      return 'Local settings (.claude/settings.local.json)'
    case 'pluginHook':
      // TODO: Get the actual plugin hook file paths instead of using glob pattern
      // We should capture the specific plugin paths during hook registration and display them here
      // e.g., "Plugin hooks (~/.claude/plugins/repos/source/example-plugin/example-plugin/hooks/hooks.json)"
      return 'Plugin hooks (~/.claude/plugins/*/hooks/hooks.json)'
    case 'sessionHook':
      return 'Session hooks (in-memory, temporary)'
    case 'builtinHook':
      return 'Built-in hooks (registered internally by Claude Code)'
    default:
      return source as string
  }
}

export function hookSourceHeaderDisplayString(source: HookSource): string {
  switch (source) {
    case 'userSettings':
      return 'User Settings'
    case 'projectSettings':
      return 'Project Settings'
    case 'localSettings':
      return 'Local Settings'
    case 'pluginHook':
      return 'Plugin Hooks'
    case 'sessionHook':
      return 'Session Hooks'
    case 'builtinHook':
      return 'Built-in Hooks'
    default:
      return source as string
  }
}

export function hookSourceInlineDisplayString(source: HookSource): string {
  switch (source) {
    case 'userSettings':
      return 'User'
    case 'projectSettings':
      return 'Project'
    case 'localSettings':
      return 'Local'
    case 'pluginHook':
      return 'Plugin'
    case 'sessionHook':
      return 'Session'
    case 'builtinHook':
      return 'Built-in'
    default:
      return source as string
  }
}

// 注：sortMatchersByPriority 按来源优先级给匹配串排序：可编辑来源按 SOURCES 顺序，插件与内置排到最后，同级再按名称排序。
export function sortMatchersByPriority(
  matchers: string[],
  hooksByEventAndMatcher: Record<
    string,
    Record<string, IndividualHookConfig[]>
  >,
  selectedEvent: HookEvent,
): string[] {
  // Create a priority map based on SOURCES order (lower index = higher priority)
  const sourcePriority = SOURCES.reduce(
    (acc, source, index) => {
      acc[source] = index
      return acc
    },
    {} as Record<EditableSettingSource, number>,
  )

  return [...matchers].sort((a, b) => {
    const aHooks = hooksByEventAndMatcher[selectedEvent]?.[a] || []
    const bHooks = hooksByEventAndMatcher[selectedEvent]?.[b] || []

    const aSources = Array.from(new Set(aHooks.map(h => h.source)))
    const bSources = Array.from(new Set(bHooks.map(h => h.source)))

    // Sort by highest priority source first (lowest priority number)
    // Plugin hooks get lowest priority (highest number)
    const getSourcePriority = (source: HookSource) =>
      source === 'pluginHook' || source === 'builtinHook'
        ? 999
        : sourcePriority[source as EditableSettingSource]

    const aHighestPriority = Math.min(...aSources.map(getSourcePriority))
    const bHighestPriority = Math.min(...bSources.map(getSourcePriority))

    if (aHighestPriority !== bHighestPriority) {
      return aHighestPriority - bHighestPriority
    }

    // If same priority, sort by matcher name
    return a.localeCompare(b)
  })
}
