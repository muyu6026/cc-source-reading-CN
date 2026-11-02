// 组装遥测指标属性的统一入口，并在「是否包含会话 id、版本、账户 uuid」上做基数控制，避免高基数维度拖垮指标管道。
import type { Attributes } from '@opentelemetry/api'
import { getSessionId } from 'src/bootstrap/state.js'
import { getOauthAccountInfo } from './auth.js'
import { getOrCreateUserID } from './config.js'
import { envDynamic } from './envDynamic.js'
import { isEnvTruthy } from './envUtils.js'
import { toTaggedId } from './taggedId.js'

// Default configuration for metrics cardinality
const METRICS_CARDINALITY_DEFAULTS = {
  OTEL_METRICS_INCLUDE_SESSION_ID: true,
  OTEL_METRICS_INCLUDE_VERSION: false,
  OTEL_METRICS_INCLUDE_ACCOUNT_UUID: true,
}
// `METRICS_CARDINALITY_DEFAULTS` 给出三项开关的默认取向：默认带会话 id 与账户 uuid，不带版本。

// `shouldIncludeAttribute` 读取对应环境变量覆盖默认；变量未设置时用默认值，设置后用「真值判断」解析。
function shouldIncludeAttribute(
  envVar: keyof typeof METRICS_CARDINALITY_DEFAULTS,
): boolean {
  const defaultValue = METRICS_CARDINALITY_DEFAULTS[envVar]
  const envValue = process.env[envVar]

  if (envValue === undefined) {
    return defaultValue
  }

  return isEnvTruthy(envValue)
}

// `getTelemetryAttributes` 先放用户 id，再按开关追加会话 id 与版本，最后在确实走 OAuth 时附上组织、邮箱与账户标识。
export function getTelemetryAttributes(): Attributes {
  const userId = getOrCreateUserID()
  const sessionId = getSessionId()

  const attributes: Attributes = {
    'user.id': userId,
  }

  if (shouldIncludeAttribute('OTEL_METRICS_INCLUDE_SESSION_ID')) {
    attributes['session.id'] = sessionId
  }
  if (shouldIncludeAttribute('OTEL_METRICS_INCLUDE_VERSION')) {
    attributes['app.version'] = MACRO.VERSION
  }

  // Only include OAuth account data when actively using OAuth authentication
  const oauthAccount = getOauthAccountInfo()
  if (oauthAccount) {
    const orgId = oauthAccount.organizationUuid
    const email = oauthAccount.emailAddress
    const accountUuid = oauthAccount.accountUuid

    if (orgId) attributes['organization.id'] = orgId
    if (email) attributes['user.email'] = email

    if (
      accountUuid &&
      shouldIncludeAttribute('OTEL_METRICS_INCLUDE_ACCOUNT_UUID')
    ) {
      attributes['user.account_uuid'] = accountUuid
      attributes['user.account_id'] =
        process.env.CLAUDE_CODE_ACCOUNT_TAGGED_ID ||
        toTaggedId('user', accountUuid)
    }
  }
// 仅在真正使用 OAuth 时才附账户维度；账户 uuid 还要再过一次基数开关，且优先用带标签的标识以降低再识别风险。

  // Add terminal type if available
  if (envDynamic.terminal) {
    attributes['terminal.type'] = envDynamic.terminal
  }
// 最后把终端类型（若可探测）作为属性附上，方便按客户端环境切分指标。

  return attributes
}
