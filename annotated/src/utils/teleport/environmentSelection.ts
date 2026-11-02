// 远程执行环境的「选择结果」推导：先取服务端返回的环境清单，再结合设置里的默认环境标识，算出最终会用哪个环境、以及这个默认值来自哪一层设置。返回值同时供界面展示与后续调用使用。
import { SETTING_SOURCES, type SettingSource } from '../settings/constants.js'
import {
  getSettings_DEPRECATED,
  getSettingsForSource,
} from '../settings/settings.js'
import { type EnvironmentResource, fetchEnvironments } from './environments.js'

export type EnvironmentSelectionInfo = {
  availableEnvironments: EnvironmentResource[]
  selectedEnvironment: EnvironmentResource | null
  selectedEnvironmentSource: SettingSource | null
}
// 三个字段对应界面上要显示的三件事：有哪些可选、当前会选哪个、这个选择的依据来自哪一层配置。来源为空表示没有显式配置，用的是默认的第一个可选环境。

/**
 * Gets information about available environments and the currently selected one.
 *
 * @returns Promise<EnvironmentSelectionInfo> containing:
 *   - availableEnvironments: all environments from the API
 *   - selectedEnvironment: the environment that would be used (based on settings or first available),
 *     or null if no environments are available
 *   - selectedEnvironmentSource: the SettingSource where defaultEnvironmentId is configured,
 *     or null if using the default (first environment)
 */
export async function getEnvironmentSelectionInfo(): Promise<EnvironmentSelectionInfo> {
  // Fetch available environments
  const environments = await fetchEnvironments()

  if (environments.length === 0) {
    return {
      availableEnvironments: [],
      selectedEnvironment: null,
      selectedEnvironmentSource: null,
    }
  }
// 清单为空时立刻返回空结果，不去读设置。这个早退避免了下游把一个并不存在的默认环境标识当成有效选择。

  // Get the merged settings to see what would actually be used
  const mergedSettings = getSettings_DEPRECATED()
  const defaultEnvironmentId = mergedSettings?.remote?.defaultEnvironmentId

  // Find which environment would be selected
  let selectedEnvironment: EnvironmentResource =
    environments.find(env => env.kind !== 'bridge') ?? environments[0]!
// 默认选择是「第一个非桥接类型的环境」，找不到才退回清单首项。桥接类型被跳过，因为它是给另一套连通方式用的中间层，不适合作为默认落点。
  let selectedEnvironmentSource: SettingSource | null = null

  if (defaultEnvironmentId) {
    const matchingEnvironment = environments.find(
      env => env.environment_id === defaultEnvironmentId,
    )

    if (matchingEnvironment) {
      selectedEnvironment = matchingEnvironment

      // Find which source has this setting
      // Iterate from lowest to highest priority, so the last match wins (highest priority)
      for (let i = SETTING_SOURCES.length - 1; i >= 0; i--) {
        const source = SETTING_SOURCES[i]
        if (!source || source === 'flagSettings') {
          // Skip flagSettings as it's not a normal source we check
          continue
        }
        const sourceSettings = getSettingsForSource(source)
        if (
          sourceSettings?.remote?.defaultEnvironmentId === defaultEnvironmentId
        ) {
          selectedEnvironmentSource = source
          break
        }
      }
// 定位默认值来源时从低优先级往高优先级倒着遍历，最后一个命中的就是优先级最高的那个。跳过来自命令行参数的那一层，因为它是每次启动的临时覆盖，不算用户持久配置；找到即跳出。
    }
  }

  return {
    availableEnvironments: environments,
    selectedEnvironment,
    selectedEnvironmentSource,
  }
}
// 返回时把清单原样带上，界面不必再请求一次。注意默认值在清单里找不到匹配时不会报错，而是保留「第一个非桥接环境」并让来源保持为空——把「配置指向了已删除的环境」这种情形降级成默认行为，而不是让整个选择流程失败。
