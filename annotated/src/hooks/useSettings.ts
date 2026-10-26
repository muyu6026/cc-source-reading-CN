import { type AppState, useAppState } from '../state/AppState.js'

/**
 * Settings type as stored in AppState (DeepImmutable wrapped).
 * Use this type when you need to annotate variables that hold settings from useSettings().
 */
export type ReadonlySettings = AppState['settings']

/**
 * React hook to access current settings from AppState.
 * Settings automatically update when files change on disk via settingsChangeDetector.
 *
 * Use this instead of getSettings_DEPRECATED() in React components for reactive updates.
 */
// 从 AppState 取当前 settings 的 React hook：磁盘变更经 settingsChangeDetector 自动更新，组件可响应式拿到。
export function useSettings(): ReadonlySettings {
  return useAppState(s => s.settings)
// 优先用这个而非 getSettings_DEPRECATED()，才能在 React 组件里拿到响应式更新。
}
