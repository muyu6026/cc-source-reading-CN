import { isRemoteManagedSettingsEligible } from '../services/remoteManagedSettings/syncCache.js'
import { clearCACertsCache } from './caCerts.js'
import { getGlobalConfig } from './config.js'
import { isEnvTruthy } from './envUtils.js'
import {
  isProviderManagedEnvVar,
  SAFE_ENV_VARS,
} from './managedEnvConstants.js'
import { clearMTLSCache } from './mtls.js'
import { clearProxyCache, configureGlobalAgents } from './proxy.js'
import { isSettingSourceEnabled } from './settings/constants.js'
import {
  getSettings_DEPRECATED,
  getSettingsForSource,
} from './settings/settings.js'

/**
 * `claude ssh` remote: ANTHROPIC_UNIX_SOCKET routes auth through a -R forwarded
 * socket to a local proxy, and the launcher sets a handful of placeholder auth
 * env vars that the remote's ~/.claude settings.env MUST NOT clobber (see
 * isAnthropicAuthEnabled). Strip them from any settings-sourced env object.
 */
// withoutSSHTunnelVars 剥离由 `claude ssh` 远端启动器注入的占位认证变量，防止远端 settings.env 覆盖它们。
function withoutSSHTunnelVars(
  env: Record<string, string> | undefined,
): Record<string, string> {
  if (!env || !process.env.ANTHROPIC_UNIX_SOCKET) return env || {}
  const {
    ANTHROPIC_UNIX_SOCKET: _1,
    ANTHROPIC_BASE_URL: _2,
    ANTHROPIC_API_KEY: _3,
    ANTHROPIC_AUTH_TOKEN: _4,
    CLAUDE_CODE_OAUTH_TOKEN: _5,
    ...rest
  } = env
  return rest
}
// withoutSSHTunnelVars 收尾：仅在存在 SSH unix socket 时剥离，否则原样返回。

/**
 * When the host owns inference routing (sets
 * CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST in spawn env), strip
 * provider-selection / model-default vars from settings-sourced env so a
 * user's ~/.claude/settings.json can't redirect requests away from the
 * host-configured provider.
 */
// withoutHostManagedProviderVars 当宿主接管推理路由时，剥离 provider 选择与模型默认变量，避免用户配置重定向请求。
function withoutHostManagedProviderVars(
  env: Record<string, string> | undefined,
): Record<string, string> {
  if (!env) return {}
  if (!isEnvTruthy(process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST)) {
    return env
  }
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (!isProviderManagedEnvVar(key)) {
      out[key] = value
    }
  }
  return out
}
// withoutHostManagedProviderVars 收尾：按是否由宿主管理决定逐键保留或剥离。

/**
 * Snapshot of env keys present before any settings.env is applied — for CCD,
 * these are the keys the desktop host set to orchestrate the subprocess.
 * Settings must not override them (OTEL_LOGS_EXPORTER=console would corrupt
 * the stdio JSON-RPC transport). Keys added LATER by user/project settings
 * are not in this set, so mid-session settings.json changes still apply.
 * Lazy-captured on first applySafeConfigEnvironmentVariables() call.
 */
let ccdSpawnEnvKeys: Set<string> | null | undefined
// ccdSpawnEnvKeys 懒捕获首批 applySafeConfigEnvironmentVariables 调用前的环境变量键集合，用于保护桌面宿主的操作变量。

function withoutCcdSpawnEnvKeys(
  env: Record<string, string> | undefined,
): Record<string, string> {
  if (!env || !ccdSpawnEnvKeys) return env || {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (!ccdSpawnEnvKeys.has(key)) out[key] = value
  }
  return out
}
// withoutCcdSpawnEnvKeys 收尾：剔除属于 CCD 启动环境的键，使后续 settings 改动仍可生效。

/**
 * Compose the strip filters applied to every settings-sourced env object.
 */
// filterSettingsEnv 组合上述三个剥离过滤器，对所有来源于 settings 的环境对象统一处理。
function filterSettingsEnv(
  env: Record<string, string> | undefined,
): Record<string, string> {
  return withoutCcdSpawnEnvKeys(
    withoutHostManagedProviderVars(withoutSSHTunnelVars(env)),
  )
}
// filterSettingsEnv 收尾：先剥 CCD 启动键，再剥宿主托管 provider 变量，最后剥 SSH 隧道变量。

/**
 * Trusted setting sources whose env vars can be applied before the trust dialog.
 *
 * - userSettings (~/.claude/settings.json): controlled by the user, not project-specific
 * - flagSettings (--settings CLI flag or SDK inline settings): explicitly passed by the user
 * - policySettings (managed settings from enterprise API or local managed-settings.json):
 *   controlled by IT/admin (highest priority, cannot be overridden)
 *
 * Project-scoped sources (projectSettings, localSettings) are excluded because they live
 * inside the project directory and could be committed by a malicious actor to redirect
 * traffic (e.g., ANTHROPIC_BASE_URL) to an attacker-controlled server.
 */
const TRUSTED_SETTING_SOURCES = [
  'userSettings',
  'flagSettings',
  'policySettings',
] as const
// TRUSTED_SETTING_SOURCES 列出可在信任对话框前应用的环境来源（用户、命令行、策略），项目级来源被排除以防流量劫持。

/**
 * Apply environment variables from trusted sources to process.env.
 * Called before the trust dialog so that user/enterprise env vars like
 * ANTHROPIC_BASE_URL take effect during first-run/onboarding.
 *
 * For trusted sources (user settings, managed settings, CLI flags), ALL env vars
 * are applied — including ones like ANTHROPIC_BASE_URL that would be dangerous
 * from project-scoped settings.
 *
 * For project-scoped sources (projectSettings, localSettings), only safe env vars
 * from the SAFE_ENV_VARS allowlist are applied. These are applied after trust is
 * fully established via applyConfigEnvironmentVariables().
 */
// applySafeConfigEnvironmentVariables 在信任对话框前应用受信来源的环境变量，使认证与基础 URL 能在首次运行时生效。
export function applySafeConfigEnvironmentVariables(): void {
  // Capture CCD spawn-env keys before any settings.env is applied (once).
  if (ccdSpawnEnvKeys === undefined) {
    ccdSpawnEnvKeys =
      process.env.CLAUDE_CODE_ENTRYPOINT === 'claude-desktop'
        ? new Set(Object.keys(process.env))
        : null
  }

  // Global config (~/.claude.json) is user-controlled. In CCD mode,
  // filterSettingsEnv strips keys that were in the spawn env snapshot so
  // the desktop host's operational vars (OTEL, etc.) are not overridden.
  Object.assign(process.env, filterSettingsEnv(getGlobalConfig().env))

  // Apply ALL env vars from trusted setting sources, policySettings last.
  // Gate on isSettingSourceEnabled so SDK settingSources: [] (isolation mode)
  // doesn't get clobbered by ~/.claude/settings.json env (gh#217). policy/flag
  // sources are always enabled, so this only ever filters userSettings.
  for (const source of TRUSTED_SETTING_SOURCES) {
    if (source === 'policySettings') continue
    if (!isSettingSourceEnabled(source)) continue
    Object.assign(
      process.env,
      filterSettingsEnv(getSettingsForSource(source)?.env),
    )
  }

  // Compute remote-managed-settings eligibility now, with userSettings and
  // flagSettings env applied. Eligibility reads CLAUDE_CODE_USE_BEDROCK,
  // ANTHROPIC_BASE_URL — both settable via settings.env.
  // getSettingsForSource('policySettings') below consults the remote cache,
  // which guards on this. The two-phase structure makes the ordering
  // dependency visible: non-policy env → eligibility → policy env.
  isRemoteManagedSettingsEligible()

  Object.assign(
    process.env,
    filterSettingsEnv(getSettingsForSource('policySettings')?.env),
  )

  // Apply only safe env vars from the fully-merged settings (which includes
  // project-scoped sources). For safe vars that also exist in trusted sources,
  // the merged value (which may come from a higher-priority project source)
  // will overwrite the trusted value — this is acceptable since these vars are
  // in the safe allowlist. Only policySettings values are guaranteed to survive
  // unchanged (it has the highest merge priority in both loops) — except
  // provider-routing vars, which filterSettingsEnv strips from every source
  // when CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST is set.
  const settingsEnv = filterSettingsEnv(getSettings_DEPRECATED()?.env)
  for (const [key, value] of Object.entries(settingsEnv)) {
    if (SAFE_ENV_VARS.has(key.toUpperCase())) {
      process.env[key] = value
    }
  }
}
// applySafeConfigEnvironmentVariables 收尾：分两阶段应用环境变量，先非策略后策略，并计算远端托管设置资格。

/**
 * Apply environment variables from settings to process.env.
 * This applies ALL environment variables (except provider-routing vars when
 * CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST is set — see filterSettingsEnv) and
 * should only be called after trust is established. This applies potentially
 * dangerous environment variables such as LD_PRELOAD, PATH, etc.
 */
// applyConfigEnvironmentVariables 在信任建立后应用全部环境变量，包括可能危险的 LD_PRELOAD、PATH 等。
export function applyConfigEnvironmentVariables(): void {
  Object.assign(process.env, filterSettingsEnv(getGlobalConfig().env))

  Object.assign(process.env, filterSettingsEnv(getSettings_DEPRECATED()?.env))

  // Clear caches so agents are rebuilt with the new env vars
  clearCACertsCache()
  clearMTLSCache()
  clearProxyCache()

  // Reconfigure proxy/mTLS agents to pick up any proxy env vars from settings
  configureGlobalAgents()
}
// applyConfigEnvironmentVariables 收尾：应用后清空证书与代理缓存并重新配置全局代理代理智能体。
