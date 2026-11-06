import {
// /vim 命令：在「vim」与「normal」编辑模式间切换；旧版「emacs」按「normal」处理，写回设置并打点。
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import type { LocalCommandCall } from '../../types/command.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'

export const call: LocalCommandCall = async () => {
// 命令入口：读全局配置拿当前编辑模式。
  const config = getGlobalConfig()
  let currentMode = config.editorMode || 'normal'
// 默认 normal，兼容旧 emacs 视为 normal。

  // Handle backward compatibility - treat 'emacs' as 'normal'
  if (currentMode === 'emacs') {
// emacs 一律按 normal 处理（向后兼容）。
    currentMode = 'normal'
  }

  const newMode = currentMode === 'normal' ? 'vim' : 'normal'
// normal 切 vim，否则切回 normal。

  saveGlobalConfig(current => ({
// 写回全局配置。
    ...current,
    editorMode: newMode,
  }))

  logEvent('tengu_editor_mode_changed', {
// 打点记录模式变化与来源（command）。
    mode: newMode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    source:
      'command' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })

  return {
// 返回文本提示：vim 模式告知用 Esc 切换，normal 告知用标准按键绑定。
    type: 'text',
    value: `Editor mode set to ${newMode}. ${
      newMode === 'vim'
        ? 'Use Escape key to toggle between INSERT and NORMAL modes.'
        : 'Using standard (readline) keyboard bindings.'
    }`,
  }
}
