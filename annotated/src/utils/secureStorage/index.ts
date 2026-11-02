// 按当前运行平台挑选安全的凭据存储实现：macOS 走 Keychain 并以明文做兜底，Linux 暂时直接用明文（注释里说待加 libsecret 支持）。
import { createFallbackStorage } from './fallbackStorage.js'
import { macOsKeychainStorage } from './macOsKeychainStorage.js'
import { plainTextStorage } from './plainTextStorage.js'
import type { SecureStorage } from './types.js'

/**
 * Get the appropriate secure storage implementation for the current platform
 */
export function getSecureStorage(): SecureStorage {
  if (process.platform === 'darwin') {
    return createFallbackStorage(macOsKeychainStorage, plainTextStorage)
  }

  // TODO: add libsecret support for Linux

  return plainTextStorage
}
// 函数返回：macOS 用 createFallbackStorage(macOsKeychainStorage, plainTextStorage) 做双保险，其余平台直接返回 plainTextStorage。
