// AWS 短期凭证相关的小型工具集：定义凭证与 STS 输出的形状、校验 STS 输出、确认调用者身份，以及清掉凭证提供方缓存。
import { logForDebugging } from './debug.js'

/** AWS short-term credentials format. */
// `AwsCredentials` 与 `AwsStsOutput` 两个类型描述 STS 返回的短期凭证结构；字段名沿用 AWS 的帕斯卡命名。
export type AwsCredentials = {
  AccessKeyId: string
  SecretAccessKey: string
  SessionToken: string
  Expiration?: string
}

/** Output from `aws sts get-session-token` or `aws sts assume-role`. */
export type AwsStsOutput = {
  Credentials: AwsCredentials
}

type AwsError = {
  name: string
}

// `isAwsCredentialsProviderError` 是类型守卫，判断错误是否来自凭证提供方链路的失败。
export function isAwsCredentialsProviderError(err: unknown) {
  return (err as AwsError | undefined)?.name === 'CredentialsProviderError'
}

/** Typeguard to validate AWS STS assume-role output */
// `isValidAwsStsOutput` 校验 `aws sts` 的输出形状：必须是对象且 `Credentials` 内三个字段均为非空字符串。
export function isValidAwsStsOutput(obj: unknown): obj is AwsStsOutput {
  if (!obj || typeof obj !== 'object') {
    return false
  }

  const output = obj as Record<string, unknown>

  // Check if Credentials exists and has required fields
  if (!output.Credentials || typeof output.Credentials !== 'object') {
    return false
  }

  const credentials = output.Credentials as Record<string, unknown>

  return (
    typeof credentials.AccessKeyId === 'string' &&
    typeof credentials.SecretAccessKey === 'string' &&
    typeof credentials.SessionToken === 'string' &&
    credentials.AccessKeyId.length > 0 &&
    credentials.SecretAccessKey.length > 0 &&
    credentials.SessionToken.length > 0
  )
}

/** Throws if STS caller identity cannot be retrieved. */
// `checkStsCallerIdentity` 惰性加载 STS 客户端并发送 `GetCallerIdentity`，取不到调用者身份则抛错。
export async function checkStsCallerIdentity(): Promise<void> {
  const { STSClient, GetCallerIdentityCommand } = await import(
    '@aws-sdk/client-sts'
  )
  await new STSClient().send(new GetCallerIdentityCommand({}))
}

/**
 * Clear AWS credential provider cache by forcing a refresh
 * This ensures that any changes to ~/.aws/credentials are picked up immediately
 */
// `clearAwsIniCache` 通过以忽略缓存方式触发一次 ini 提供方来刷新全局文件缓存，确保 `~/.aws/credentials` 的改动被立即读到；失败仅记调试日志。
export async function clearAwsIniCache(): Promise<void> {
  try {
    logForDebugging('Clearing AWS credential provider cache')
    const { fromIni } = await import('@aws-sdk/credential-providers')
    const iniProvider = fromIni({ ignoreCache: true })
    await iniProvider() // This updates the global file cache
    logForDebugging('AWS credential provider cache refreshed')
  } catch (_error) {
    // Ignore errors - we're just clearing the cache
    logForDebugging(
      'Failed to clear AWS credential cache (this is expected if no credentials are configured)',
    )
  }
}
