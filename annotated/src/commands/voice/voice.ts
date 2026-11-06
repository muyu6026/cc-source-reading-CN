import { normalizeLanguageForSTT } from '../../hooks/useVoice.js'
import { getShortcutDisplay } from '../../keybindings/shortcutFormat.js'
import { logEvent } from '../../services/analytics/index.js'
import type { LocalCommandCall } from '../../types/command.js'
import { isAnthropicAuthEnabled } from '../../utils/auth.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { settingsChangeDetector } from '../../utils/settings/changeDetector.js'
import {
  getInitialSettings,
  updateSettingsForSource,
} from '../../utils/settings/settings.js'
import { isVoiceModeEnabled } from '../../voice/voiceModeEnabled.js'

// 语言提示最多两次：它是可发现性提示而不是状态栏，每次开启都刷一遍会变成噪音
const LANG_HINT_MAX_SHOWS = 2

export const call: LocalCommandCall = async () => {
  // Check auth and kill-switch before allowing voice mode
// 先看总开关再看账号：开关关着时这个命令本不该可达，所以只有没登录的用户需要一句登录提示
  if (!isVoiceModeEnabled()) {
    // Differentiate: OAuth-less users get an auth hint, everyone else
    // gets nothing (command shouldn't be reachable when the kill-switch is on).
// 两类不可用要分开说：没登录是用户自己能解决的事，其余情况给操作建议只会误导
    if (!isAnthropicAuthEnabled()) {
      return {
        type: 'text' as const,
        value:
          'Voice mode requires a Claude.ai account. Please run /login to sign in.',
      }
    }
    return {
      type: 'text' as const,
      value: 'Voice mode is not available.',
    }
  }

// 读初始设置而不是缓存状态：设置文件可能在外部被编辑过，命令执行时要以磁盘为准
  const currentSettings = getInitialSettings()
  const isCurrentlyEnabled = currentSettings.voiceEnabled === true

  // Toggle OFF — no checks needed
// 关闭方向不做任何前置检查：能关就立刻关，检查只会让用户关不掉
  if (isCurrentlyEnabled) {
    const result = updateSettingsForSource('userSettings', {
      voiceEnabled: false,
    })
    if (result.error) {
      return {
        type: 'text' as const,
        value:
          'Failed to update settings. Check your settings file for syntax errors.',
      }
    }
// 改完设置要广播变更：监听设置的组件靠这个信号重读，否则界面停在旧值
    settingsChangeDetector.notifyChange('userSettings')
    logEvent('tengu_voice_toggled', { enabled: false })
    return {
      type: 'text' as const,
      value: 'Voice mode disabled.',
    }
  }

  // Toggle ON — run pre-flight checks first
// 只有开启方向才动态导入：语音相关模块体积不小，永久关着语音的用户不该为它付启动成本
  const { isVoiceStreamAvailable } = await import(
    '../../services/voiceStreamSTT.js'
  )
  const { checkRecordingAvailability } = await import('../../services/voice.js')

  // Check recording availability (microphone access)
// 四项检查按代价从低到高排：录音能力、接口可用、依赖安装、系统权限——前面失败就不用惊动后面那条会弹系统对话框的
  const recording = await checkRecordingAvailability()
  if (!recording.available) {
    return {
      type: 'text' as const,
      value:
        recording.reason ?? 'Voice mode is not available in this environment.',
    }
  }

  // Check for API key
// 这里查的是接口密钥，所以缺失时的提示与未登录那条完全一样：用户要做的动作相同
  if (!isVoiceStreamAvailable()) {
    return {
      type: 'text' as const,
      value:
        'Voice mode requires a Claude.ai account. Please run /login to sign in.',
    }
  }

  // Check for recording tools
// 依赖检查与权限申请拆成两次导入：前者只读环境，后者会弹系统框，混在一起会让「只想看有没有装工具」也惊动用户
  const { checkVoiceDependencies, requestMicrophonePermission } = await import(
    '../../services/voice.js'
  )
  const deps = await checkVoiceDependencies()
  if (!deps.available) {
// 缺工具时把安装命令直接给出来：让用户自己去翻文档，是这一步最常见的流失点
    const hint = deps.installCommand
      ? `\nInstall audio recording tools? Run: ${deps.installCommand}`
      : '\nInstall SoX manually for audio recording.'
    return {
      type: 'text' as const,
      value: `No audio recording tool found.${hint}`,
    }
  }

  // Probe mic access so the OS permission dialog fires now rather than
  // on the user's first hold-to-talk activation.
// 现在就申请麦克风权限：等到第一次按住说话才弹框，那次录音一定是空的，用户会以为是功能坏了
  if (!(await requestMicrophonePermission())) {
    let guidance: string
// 拒绝后的引导按平台分三套：macOS 与 Windows 的路径名完全不同，Linux 没有统一入口
    if (process.platform === 'win32') {
      guidance = 'Settings \u2192 Privacy \u2192 Microphone'
    } else if (process.platform === 'linux') {
      guidance = "your system's audio settings"
    } else {
      guidance = 'System Settings \u2192 Privacy & Security \u2192 Microphone'
    }
    return {
      type: 'text' as const,
      value: `Microphone access is denied. To enable it, go to ${guidance}, then run /voice again.`,
    }
  }

  // All checks passed — enable voice
  const result = updateSettingsForSource('userSettings', { voiceEnabled: true })
  if (result.error) {
    return {
      type: 'text' as const,
      value:
        'Failed to update settings. Check your settings file for syntax errors.',
    }
  }
// 开启方向同样要广播，且必须排在落盘成功之后：先广播再落盘会让监听方读到旧值
  settingsChangeDetector.notifyChange('userSettings')
  logEvent('tengu_voice_toggled', { enabled: true })
  const key = getShortcutDisplay('voice:pushToTalk', 'Chat', 'Space')
// 转写语言要先归一化：设置里可能是带地区的写法，而语音接口只认少数几个代码
  const stt = normalizeLanguageForSTT(currentSettings.language)
  const cfg = getGlobalConfig()
  // Reset the hint counter whenever the resolved STT language changes
  // (including first-ever enable, where lastLanguage is undefined).
// 计数器只在语言变化时归零：换了语言就该重新给两次提示，否则旧语言的计数会一直压着
  const langChanged = cfg.voiceLangHintLastLanguage !== stt.code
  const priorCount = langChanged ? 0 : (cfg.voiceLangHintShownCount ?? 0)
// 回退过的语言不再给提示：那条回退说明比提示更重要，两者只出一条
  const showHint = !stt.fellBackFrom && priorCount < LANG_HINT_MAX_SHOWS
  let langNote = ''
  if (stt.fellBackFrom) {
    langNote = ` Note: "${stt.fellBackFrom}" is not a supported dictation language; using English. Change it via /config.`
  } else if (showHint) {
    langNote = ` Dictation language: ${stt.code} (/config to change).`
  }
// 两个字段必须同时写：只写计数会让下次判断沿用旧语言，只写语言则计数永远归零
  if (langChanged || showHint) {
    saveGlobalConfig(prev => ({
      ...prev,
      voiceLangHintShownCount: priorCount + (showHint ? 1 : 0),
      voiceLangHintLastLanguage: stt.code,
    }))
  }
  return {
    type: 'text' as const,
    value: `Voice mode enabled. Hold ${key} to record.${langNote}`,
  }
}
