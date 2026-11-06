import type { Command } from '../../commands.js'
// `/voice` 命令：切换语音模式，仅在语音功能经 GrowthBook 与运行期开关同时启用时可见可用。
import {
  isVoiceGrowthBookEnabled,
  isVoiceModeEnabled,
} from '../../voice/voiceModeEnabled.js'

const voice = {
// 命令定义：类型 `local`、名称、描述与可用性范围，并依赖两项开关决定是否隐藏。
  type: 'local',
  name: 'voice',
  description: 'Toggle voice mode',
  availability: ['claude-ai'],
  isEnabled: () => isVoiceGrowthBookEnabled(),
// `isEnabled` 由 GrowthBook 杀开关决定；`isHidden` 由运行期语音开关决定。
  get isHidden() {
    return !isVoiceModeEnabled()
  },
  supportsNonInteractive: false,
  load: () => import('./voice.js'),
} satisfies Command

export default voice
