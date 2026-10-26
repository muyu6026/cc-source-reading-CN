import { useCallback, useEffect } from 'react'
import { settingsChangeDetector } from '../utils/settings/changeDetector.js'
import type { SettingSource } from '../utils/settings/constants.js'
import { getSettings_DEPRECATED } from '../utils/settings/settings.js'
import type { SettingsJson } from '../utils/settings/types.js'

export function useSettingsChange(
  onChange: (source: SettingSource, settings: SettingsJson) => void,
): void {
// 订阅设置变更：磁盘上的 settings 一变就回调 onChange（带 source + 新设置）。
  const handleChange = useCallback(
    (source: SettingSource) => {
      // Cache is already reset by the notifier (changeDetector.fanOut) —
      // resetting here caused N-way thrashing with N subscribers: each
      // cleared the cache, re-read from disk, then the next cleared again.
// 注意：缓存已由通知方（changeDetector.fanOut）重置，这里不要再清，否则 N 个订阅者会互相踩（N 路抖动）。
      const newSettings = getSettings_DEPRECATED()
      onChange(source, newSettings)
    },
    [onChange],
  )

// 用 settingsChangeDetector.subscribe 订阅；handleChange 入 memo 保依赖稳定。
  useEffect(
    () => settingsChangeDetector.subscribe(handleChange),
    [handleChange],
  )
}
