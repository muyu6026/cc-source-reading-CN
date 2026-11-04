import capitalize from 'lodash-es/capitalize.js'
import type { SettingSource } from 'src/utils/settings/constants.js'
import { getSettingSourceName } from 'src/utils/settings/constants.js'

// 来源转标题：三个特例（全部、内置、插件）在这里定死，其余交给设置层统一命名
export function getAgentSourceDisplayName(
  source: SettingSource | 'all' | 'built-in' | 'plugin',
): string {
  if (source === 'all') {
// 特例优先判：「all」要显示成带复数的 Agents，而不是直译
    return 'Agents'
  }
  if (source === 'built-in') {
    return 'Built-in agents'
  }
  if (source === 'plugin') {
    return 'Plugin agents'
  }
  return capitalize(getSettingSourceName(source))
// 兜底做首字母大写：内置来源名是英文小写标识，标题化后与上面几个特例风格一致
}
