// 本文件放两个与「鉴权凭证便携化」相关的纯函数：在 macOS 上删除钥匙串里的 API key，以及对 API key 做脱敏归一。
import { execa } from 'execa'
import { getMacOsKeychainStorageServiceName } from 'src/utils/secureStorage/macOsKeychainHelpers.js'

export async function maybeRemoveApiKeyFromMacOSKeychainThrows(): Promise<void> {
  if (process.platform === 'darwin') {
    const storageServiceName = getMacOsKeychainStorageServiceName()
    const result = await execa(
      `security delete-generic-password -a $USER -s "${storageServiceName}"`,
      { shell: true, reject: false },
    )
    if (result.exitCode !== 0) {
      throw new Error('Failed to delete keychain entry')
    }
  }
}
// maybeRemoveApiKeyFromMacOSKeychainThrows 仅在 darwin 平台执行：调用系统 security 命令删除对应服务的通用密码；删除失败则抛错。函数名带 Throws 明示失败会向上抛出。

export function normalizeApiKeyForConfig(apiKey: string): string {
  return apiKey.slice(-20)
}
// normalizeApiKeyForConfig 把 API key 归一为末尾 20 个字符，用于配置展示时只保留尾部片段而非完整密钥。
