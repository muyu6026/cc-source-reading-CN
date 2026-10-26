import React from 'react'
import { getDynamicConfig_BLOCKS_ON_INIT } from '../services/analytics/growthbook.js'

/**
 * React hook for dynamic config values.
 * Returns the default value initially, then updates when the config is fetched.
 */
// 动态配置 hook：先给默认值，配置拉到后异步更新（典型如灰度开关）。
export function useDynamicConfig<T>(configName: string, defaultValue: T): T {
  const [configValue, setConfigValue] = React.useState<T>(defaultValue)
// 用 useState 存配置值，初始为默认值。

  React.useEffect(() => {
    if (process.env.NODE_ENV === 'test') {
// 测试环境直接 return，不拉配置，避免 hook 等待导致测试挂起。
      // Prevents a test hang when using this hook in tests
      return
    }
    void getDynamicConfig_BLOCKS_ON_INIT<T>(configName, defaultValue).then(
      setConfigValue,
    )
  }, [configName, defaultValue])

  return configValue
}

// 拉取配置（阻塞初始化）后把结果写进 state，触发重渲染拿到新值。