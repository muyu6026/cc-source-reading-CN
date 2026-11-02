/**
 * Config/settings-backed NODE_EXTRA_CA_CERTS population for `caCerts.ts`.
 *
 * Split from `caCerts.ts` because `config.ts` → `file.ts` →
 * `permissions/filesystem.ts` → `commands.ts` transitively pulls in ~5300
 * modules (REPL, React, every slash command). `proxy.ts`/`mtls.ts` (and
 * therefore anything using HTTPS through our proxy agent — WebSocketTransport,
 * CCRClient, telemetry) must NOT depend on that graph, or the Agent SDK
 * bundle (`connectRemoteControl` path) bloats from ~0.4 MB to ~10.8 MB.
 *
 * `getCACertificates()` only reads `process.env.NODE_EXTRA_CA_CERTS`. This
 * module is the one place allowed to import `config.ts` to *populate* that
 * env var at CLI startup. Only `init.ts` imports this file.
 */
// 从 caCerts.ts 拆出来的模块，理由写在头部：config.ts 的依赖图拖着约 5300 个模块（React、全部斜杠命令），代理与 mTLS 那条线绝不能沾，否则 Agent SDK 包体从 0.4MB 涨到 10.8MB。

import { getGlobalConfig } from './config.js'
import { logForDebugging } from './debug.js'
import { getSettingsForSource } from './settings/settings.js'
// 本模块是全仓唯一允许 import config.ts 去填充 NODE_EXTRA_CA_CERTS 的地方：caCerts.ts 本身只读环境变量，收口在一个文件里，依赖图的边界才守得住。

/**
 * Apply NODE_EXTRA_CA_CERTS from settings.json to process.env early in init,
 * BEFORE any TLS connections are made.
 *
 * Bun caches the TLS certificate store at process boot via BoringSSL.
 * If NODE_EXTRA_CA_CERTS isn't set in the environment at boot, Bun won't
 * include the custom CA cert. By setting it on process.env before any
 * TLS connections, we give Bun a chance to pick it up (if the cert store
 * is lazy-initialized) and ensure Node.js compatibility.
 *
 * This is safe to call before the trust dialog because we only read from
 * user-controlled files (~/.claude/settings.json and ~/.claude.json),
 * not from project-level settings.
 */
export function applyExtraCACertsFromConfig(): void {
  if (process.env.NODE_EXTRA_CA_CERTS) {
    return // Already set in environment, nothing to do
// 环境里已有值就直接退出：用户自己 shell 里设的优先级永远最高，配置只是兜底。
  }
  const configPath = getExtraCertsPathFromConfig()
  if (configPath) {
    process.env.NODE_EXTRA_CA_CERTS = configPath
// 写到 process.env 而不是传参：下游的 caCerts.ts 只认环境变量，这里早启动时先垫上。
    logForDebugging(
      `CA certs: Applied NODE_EXTRA_CA_CERTS from config to process.env: ${configPath}`,
    )
  }
}
// 必须在任何 TLS 连接建立之前执行：Bun 用 BoringSSL 在启动期缓存证书库，晚了自定义 CA 就进不去了。

/**
 * Read NODE_EXTRA_CA_CERTS from settings/config as a fallback.
 *
 * NODE_EXTRA_CA_CERTS is categorized as a non-safe env var (it allows
 * trusting attacker-controlled servers), so it's only applied to process.env
 * after the trust dialog. But we need the CA cert early to establish the TLS
 * connection to an HTTPS proxy during init().
 *
 * We read from global config (~/.claude.json) and user settings
 * (~/.claude/settings.json). These are user-controlled files that don't
 * require trust approval.
 */
function getExtraCertsPathFromConfig(): string | undefined {
  try {
    const globalConfig = getGlobalConfig()
    const globalEnv = globalConfig?.env
    // Only read from user-controlled settings (~/.claude/settings.json),
    // not project-level settings, to prevent malicious projects from
    // injecting CA certs before the trust dialog.
    const settings = getSettingsForSource('userSettings')
// 只读用户级设置：项目级 settings.json 不在允许范围内——恶意项目不能在信任对话弹出之前就往进程里塞 CA 证书。
    const settingsEnv = settings?.env

    logForDebugging(
      `CA certs: Config fallback - globalEnv keys: ${globalEnv ? Object.keys(globalEnv).join(',') : 'none'}, settingsEnv keys: ${settingsEnv ? Object.keys(settingsEnv).join(',') : 'none'}`,
    )

    // Settings override global config (same precedence as applyConfigEnvironmentVariables)
    const path =
      settingsEnv?.NODE_EXTRA_CA_CERTS || globalEnv?.NODE_EXTRA_CA_CERTS
// 优先级与全局环境变量应用逻辑一致：settings 的 env 覆盖全局配置的 env，避免同一变量两处来源各说各话。
    if (path) {
      logForDebugging(
        `CA certs: Found NODE_EXTRA_CA_CERTS in config/settings: ${path}`,
      )
    }
    return path
  } catch (error) {
    logForDebugging(`CA certs: Config fallback failed: ${error}`, {
      level: 'error',
    })
    return undefined
  }
}
// 整个读取包在 try 里：config 加载失败只降级为「没有自定义 CA」，CLI 其余功能照常——证书是增强项，不是启动前提。
