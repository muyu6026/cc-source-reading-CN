import { feature } from 'bun:bundle'
import { z } from 'zod/v4'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import {
  type GlobalConfig,
  getGlobalConfig,
  getRemoteControlAtStartup,
  saveGlobalConfig,
} from '../../utils/config.js'
import { errorMessage } from '../../utils/errors.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { logError } from '../../utils/log.js'
import {
  getInitialSettings,
  updateSettingsForSource,
} from '../../utils/settings/settings.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { CONFIG_TOOL_NAME } from './constants.js'
import { DESCRIPTION, generatePrompt } from './prompt.js'
import {
  getConfig,
  getOptionsForSetting,
  getPath,
  isSupported,
} from './supportedSettings.js'
import {
  renderToolResultMessage,
  renderToolUseMessage,
  renderToolUseRejectedMessage,
} from './UI.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    setting: z
      .string()
      .describe(
        'The setting key (e.g., "theme", "model", "permissions.defaultMode")',
      ),
    value: z
      .union([z.string(), z.boolean(), z.number()])
      .optional()
      .describe('The new value. Omit to get current value.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    operation: z.enum(['get', 'set']).optional(),
    setting: z.string().optional(),
    value: z.unknown().optional(),
    previousValue: z.unknown().optional(),
    newValue: z.unknown().optional(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Input = z.infer<InputSchema>
export type Output = z.infer<OutputSchema>

// buildTool 标准五件套在这里齐了：name / searchHint（延迟加载时的检索提示）/ maxResultSizeChars / description / prompt。
export const ConfigTool = buildTool({
  name: CONFIG_TOOL_NAME,
  searchHint: 'get or set Claude Code settings (theme, model)',
  maxResultSizeChars: 100_000,
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return generatePrompt()
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return 'Config'
  },
  shouldDefer: true,
// shouldDefer: true——配置查询不是高频工具，进延迟加载池，由 ToolSearch 按需唤出。
  isConcurrencySafe() {
    return true
  },
  isReadOnly(input: Input) {
// isReadOnly 判据极简：没带 value 就是读。读操作自动放行（见下面 checkPermissions），带 value 才是写。
    return input.value === undefined
  },
  toAutoClassifierInput(input) {
// toAutoClassifierInput 把参数压成一行人类可读文本（theme = dark），权限分类器只看这行——get 只给 key，set 给 key=value，区分度足够。
    return input.value === undefined
      ? input.setting
      : `${input.setting} = ${input.value}`
  },
  async checkPermissions(input: Input) {
// checkPermissions 二分：读恒 allow，写恒 ask。没有任何白名单短路——改配置必须过人眼，哪怕是改主题。
    // Auto-allow reading configs
    if (input.value === undefined) {
      return { behavior: 'allow' as const, updatedInput: input }
    }
    return {
      behavior: 'ask' as const,
      message: `Set ${input.setting} to ${jsonStringify(input.value)}`,
    }
  },
  renderToolUseMessage,
  renderToolResultMessage,
  renderToolUseRejectedMessage,
  async call({ setting, value }: Input, context): Promise<{ data: Output }> {
    // 1. Check if setting is supported
    // Voice settings are registered at build-time (feature('VOICE_MODE')), but
    // must also be gated at runtime. When the kill-switch is on, treat
    // voiceEnabled as an unknown setting so no voice-specific strings leak.
    if (feature('VOICE_MODE') && setting === 'voiceEnabled') {
// voiceEnabled 的双重门：编译期 feature('VOICE_MODE') 注册进支持列表，运行期还要过 GrowthBook。kill-switch 翻转时按「未知配置」处理，一条语音相关字符串都不泄给模型。
      const { isVoiceGrowthBookEnabled } = await import(
        '../../voice/voiceModeEnabled.js'
      )
      if (!isVoiceGrowthBookEnabled()) {
        return {
          data: { success: false, error: `Unknown setting: "${setting}"` },
        }
      }
    }
    if (!isSupported(setting)) {
// isSupported 是总闸——不在注册表里的 key 直接 Unknown setting，后面的 getConfig 用非空断言也安全。
      return {
        data: { success: false, error: `Unknown setting: "${setting}"` },
      }
    }

    const config = getConfig(setting)!
    const path = getPath(setting)

    // 2. GET operation
    if (value === undefined) {
// GET 分支：formatOnRead 是展示层钩子，model 配置的 null 会被格式化成 default（null 在此表示跟随默认模型）。
      const currentValue = getValue(config.source, path)
      const displayValue = config.formatOnRead
        ? config.formatOnRead(currentValue)
        : currentValue
      return {
        data: { success: true, operation: 'get', setting, value: displayValue },
      }
    }

    // 3. SET operation

    // Handle "default" — unset the config key so it falls back to the
    // platform-aware default (determined by the bridge feature gate).
    if (
// default 是保留值：删掉 remoteControlAtStartup 这个 key 而非写入字面量，让平台感知的默认值重新接管——「设为默认」的正确实现是「撤销覆盖」。
      setting === 'remoteControlAtStartup' &&
      typeof value === 'string' &&
      value.toLowerCase().trim() === 'default'
    ) {
      saveGlobalConfig(prev => {
        if (prev.remoteControlAtStartup === undefined) return prev
        const next = { ...prev }
        delete next.remoteControlAtStartup
        return next
      })
      const resolved = getRemoteControlAtStartup()
// 写盘后立刻把解析结果同步进 AppState（replBridgeEnabled），否则 useReplBridge 要等下次重启才反应。
      // Sync to AppState so useReplBridge reacts immediately
      context.setAppState(prev => {
        if (prev.replBridgeEnabled === resolved && !prev.replBridgeOutboundOnly)
          return prev
        return {
          ...prev,
          replBridgeEnabled: resolved,
          replBridgeOutboundOnly: false,
        }
      })
      return {
        data: {
          success: true,
          operation: 'set',
          setting,
          value: resolved,
        },
      }
    }

    let finalValue: unknown = value

    // Coerce and validate boolean values
    if (config.type === 'boolean') {
// 布尔强制转换：模型经常把 true 写成字符串 "true"。lower+trim 后认 true/false 两个字面量，其余报错——不猜。
      if (typeof value === 'string') {
        const lower = value.toLowerCase().trim()
        if (lower === 'true') finalValue = true
        else if (lower === 'false') finalValue = false
      }
      if (typeof finalValue !== 'boolean') {
        return {
          data: {
            success: false,
            operation: 'set',
            setting,
            error: `${setting} requires true or false.`,
          },
        }
      }
    }

    // Check options
    const options = getOptionsForSetting(setting)
// options 白名单第二道闸：枚举型配置（theme/editorMode/权限模式）不在列表里就是 Invalid value，错误文案把合法选项全列出来让模型自重试。
    if (options && !options.includes(String(finalValue))) {
      return {
        data: {
          success: false,
          operation: 'set',
          setting,
          error: `Invalid value "${value}". Options: ${options.join(', ')}`,
        },
      }
    }

    // Async validation (e.g., model API check)
    if (config.validateOnWrite) {
// validateOnWrite 是异步钩子位：model 配置在这里调 validateModel（真去查模型是否可用），错误文案由钩子自己生成。
      const result = await config.validateOnWrite(finalValue)
      if (!result.valid) {
        return {
          data: {
            success: false,
            operation: 'set',
            setting,
            error: result.error,
          },
        }
      }
    }

    // Pre-flight checks for voice mode
    if (
// 开语音的预检链五连：GrowthBook → claude.ai 账号 → 录音可用性 → 流式通道 → 录音工具与麦克风权限。每一步失败都给出对应指引，其中麦克风指引按平台分支（win32/linux/darwin 三套路径）。
      feature('VOICE_MODE') &&
      setting === 'voiceEnabled' &&
      finalValue === true
    ) {
      const { isVoiceModeEnabled } = await import(
        '../../voice/voiceModeEnabled.js'
      )
      if (!isVoiceModeEnabled()) {
        const { isAnthropicAuthEnabled } = await import('../../utils/auth.js')
        return {
          data: {
            success: false,
            error: !isAnthropicAuthEnabled()
              ? 'Voice mode requires a Claude.ai account. Please run /login to sign in.'
              : 'Voice mode is not available.',
          },
        }
      }
      const { isVoiceStreamAvailable } = await import(
        '../../services/voiceStreamSTT.js'
      )
      const {
        checkRecordingAvailability,
        checkVoiceDependencies,
        requestMicrophonePermission,
      } = await import('../../services/voice.js')

      const recording = await checkRecordingAvailability()
      if (!recording.available) {
        return {
          data: {
            success: false,
            error:
              recording.reason ??
              'Voice mode is not available in this environment.',
          },
        }
      }
      if (!isVoiceStreamAvailable()) {
        return {
          data: {
            success: false,
            error:
              'Voice mode requires a Claude.ai account. Please run /login to sign in.',
          },
        }
      }
      const deps = await checkVoiceDependencies()
      if (!deps.available) {
        return {
          data: {
            success: false,
            error:
              'No audio recording tool found.' +
              (deps.installCommand ? ` Run: ${deps.installCommand}` : ''),
          },
        }
      }
      if (!(await requestMicrophonePermission())) {
        let guidance: string
        if (process.platform === 'win32') {
          guidance = 'Settings \u2192 Privacy \u2192 Microphone'
        } else if (process.platform === 'linux') {
          guidance = "your system's audio settings"
        } else {
          guidance =
            'System Settings \u2192 Privacy & Security \u2192 Microphone'
        }
        return {
          data: {
            success: false,
            error: `Microphone access is denied. To enable it, go to ${guidance}, then try again.`,
          },
        }
      }
    }

    const previousValue = getValue(config.source, path)

    // 4. Write to storage
    try {
      if (config.source === 'global') {
// 两套存储分叉：global 走 ~/.claude.json（saveGlobalConfig 读改写），settings 走项目级 settings.json（buildNestedObject 把点号路径还原成嵌套对象再 updateSettingsForSource）。
        const key = path[0]
        if (!key) {
          return {
            data: {
              success: false,
              operation: 'set',
              setting,
              error: 'Invalid setting path',
            },
          }
        }
        saveGlobalConfig(prev => {
// saveGlobalConfig 的更新函数带等值短路：值没变就原样返回 prev，避免无意义落盘与文件监听风暴。
          if (prev[key as keyof GlobalConfig] === finalValue) return prev
          return { ...prev, [key]: finalValue }
        })
      } else {
        const update = buildNestedObject(path, finalValue)
        const result = updateSettingsForSource('userSettings', update)
        if (result.error) {
          return {
            data: {
              success: false,
              operation: 'set',
              setting,
              error: result.error.message,
            },
          }
        }
      }

      // 5a. Voice needs notifyChange so applySettingsChange resyncs
      // AppState.settings (useVoiceEnabled reads settings.voiceEnabled)
      // and the settings cache resets for the next /voice read.
      if (feature('VOICE_MODE') && setting === 'voiceEnabled') {
// 语音开关写完后必须手动 notifyChange——settingsChangeDetector 是文件监听驱动，程序内写盘不触发文件事件，不通知的话 useVoiceEnabled 读到的是旧缓存。
        const { settingsChangeDetector } = await import(
          '../../utils/settings/changeDetector.js'
        )
        settingsChangeDetector.notifyChange('userSettings')
      }

      // 5b. Sync to AppState if needed for immediate UI effect
      if (config.appStateKey) {
// appStateKey 机制：verbose/mainLoopModel/thinkingEnabled 三个配置与 AppState 字段同名，写盘后顺手同步，UI 零延迟生效。
        const appKey = config.appStateKey
        context.setAppState(prev => {
          if (prev[appKey] === finalValue) return prev
          return { ...prev, [appKey]: finalValue }
        })
      }

      // Sync remoteControlAtStartup to AppState so the bridge reacts
      // immediately (the config key differs from the AppState field name,
      // so the generic appStateKey mechanism can't handle this).
      if (setting === 'remoteControlAtStartup') {
// remoteControlAtStartup 是例外：配置 key 与 AppState 字段名不同（replBridgeEnabled），通用机制兜不住，单独一段同步。
        const resolved = getRemoteControlAtStartup()
        context.setAppState(prev => {
          if (
            prev.replBridgeEnabled === resolved &&
            !prev.replBridgeOutboundOnly
          )
            return prev
          return {
            ...prev,
            replBridgeEnabled: resolved,
            replBridgeOutboundOnly: false,
          }
        })
      }

      logEvent('tengu_config_tool_changed', {
// 遥测字段强制过 AnalyticsMetadata 类型标记——这个类型名的意思是「已人工确认此处不是代码或文件路径」，防止配置值被误传进分析管道当代码。
        setting:
          setting as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        value: String(
          finalValue,
        ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })

      return {
        data: {
          success: true,
          operation: 'set',
          setting,
          previousValue,
          newValue: finalValue,
        },
      }
    } catch (error) {
      logError(error)
      return {
        data: {
          success: false,
          operation: 'set',
          setting,
          error: errorMessage(error),
        },
      }
    }
  },
  mapToolResultToToolResultBlockParam(content: Output, toolUseID: string) {
// tool_result 内容三段式：get 显示 setting = value，set 显示 Set ... to ...，失败是 Error 前缀 + is_error。
    if (content.success) {
      if (content.operation === 'get') {
        return {
          tool_use_id: toolUseID,
          type: 'tool_result' as const,
          content: `${content.setting} = ${jsonStringify(content.value)}`,
        }
      }
      return {
        tool_use_id: toolUseID,
        type: 'tool_result' as const,
        content: `Set ${content.setting} to ${jsonStringify(content.newValue)}`,
      }
    }
    return {
      tool_use_id: toolUseID,
      type: 'tool_result' as const,
      content: `Error: ${content.error}`,
      is_error: true,
    }
  },
} satisfies ToolDef<InputSchema, Output>)

function getValue(source: 'global' | 'settings', path: string[]): unknown {
// getValue 按路径逐层下钻，任一层不是对象或键不存在就返回 undefined（读不存在的配置不是错误，是「未设置」）。
  if (source === 'global') {
    const config = getGlobalConfig()
    const key = path[0]
    if (!key) return undefined
    return config[key as keyof GlobalConfig]
  }
  const settings = getInitialSettings()
  let current: unknown = settings
  for (const key of path) {
    if (current && typeof current === 'object' && key in current) {
      current = (current as Record<string, unknown>)[key]
    } else {
      return undefined
    }
  }
  return current
}

function buildNestedObject(
// buildNestedObject 递归把 ['permissions','defaultMode'] 还原成 {permissions:{defaultMode:value}}，与 getPath 的 split('.') 互为逆运算。
  path: string[],
  value: unknown,
): Record<string, unknown> {
  if (path.length === 0) {
    return {}
  }
  const key = path[0]!
  if (path.length === 1) {
    return { [key]: value }
  }
  return { [key]: buildNestedObject(path.slice(1), value) }
}
