import { saveGlobalConfig } from '../utils/config.js'
// 一次性迁移：把旧的 `replBridgeEnabled` 配置键改名为对外的 `remoteControlAtStartup`。

/**
 * Migrate the `replBridgeEnabled` config key to `remoteControlAtStartup`.
 *
 * The old key was an implementation detail that leaked into user-facing config.
 * This migration copies the value to the new key and removes the old one.
 * Idempotent — only acts when the old key exists and the new one doesn't.
 */
export function migrateReplBridgeEnabledToRemoteControlAtStartup(): void {
// 迁移函数幂等：仅当旧键存在、新键未设置时才搬运值，搬完即删旧键。
  saveGlobalConfig(prev => {
    // The old key is no longer in the GlobalConfig type, so access it via
    // an untyped cast. Only migrate if the old key exists and the new key
    // hasn't been set yet.
    const oldValue = (prev as Record<string, unknown>)['replBridgeEnabled']
// 旧键已不在类型里，用无类型断言读取；旧键缺失则原样返回不迁移。
    if (oldValue === undefined) return prev
    if (prev.remoteControlAtStartup !== undefined) return prev
    const next = { ...prev, remoteControlAtStartup: Boolean(oldValue) }
// 构造新配置：拷贝其余字段，写入新键（布尔化旧值）并删除旧键。
    delete (next as Record<string, unknown>)['replBridgeEnabled']
    return next
  })
}
