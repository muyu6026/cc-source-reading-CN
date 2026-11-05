import { profileCheckpoint } from '../utils/startupProfiler.js'
import '../bootstrap/state.js'
import '../utils/config.js'
import type { Attributes, MetricOptions } from '@opentelemetry/api'
import memoize from 'lodash-es/memoize.js'
import { getIsNonInteractiveSession } from 'src/bootstrap/state.js'
import type { AttributedCounter } from '../bootstrap/state.js'
import { getSessionCounter, setMeter } from '../bootstrap/state.js'
import { shutdownLspServerManager } from '../services/lsp/manager.js'
import { populateOAuthAccountInfoIfNeeded } from '../services/oauth/client.js'
import {
  initializePolicyLimitsLoadingPromise,
  isPolicyLimitsEligible,
} from '../services/policyLimits/index.js'
import {
  initializeRemoteManagedSettingsLoadingPromise,
  isEligibleForRemoteManagedSettings,
  waitForRemoteManagedSettingsToLoad,
} from '../services/remoteManagedSettings/index.js'
import { preconnectAnthropicApi } from '../utils/apiPreconnect.js'
import { applyExtraCACertsFromConfig } from '../utils/caCertsConfig.js'
import { registerCleanup } from '../utils/cleanupRegistry.js'
import { enableConfigs, recordFirstStartTime } from '../utils/config.js'
import { logForDebugging } from '../utils/debug.js'
import { detectCurrentRepository } from '../utils/detectRepository.js'
import { logForDiagnosticsNoPII } from '../utils/diagLogs.js'
import { initJetBrainsDetection } from '../utils/envDynamic.js'
import { isEnvTruthy } from '../utils/envUtils.js'
import { ConfigParseError, errorMessage } from '../utils/errors.js'
// showInvalidConfigDialog is dynamically imported in the error path to avoid loading React at init
import {
  gracefulShutdownSync,
  setupGracefulShutdown,
} from '../utils/gracefulShutdown.js'
import {
  applyConfigEnvironmentVariables,
  applySafeConfigEnvironmentVariables,
} from '../utils/managedEnv.js'
import { configureGlobalMTLS } from '../utils/mtls.js'
import {
  ensureScratchpadDir,
  isScratchpadEnabled,
} from '../utils/permissions/filesystem.js'
// initializeTelemetry is loaded lazily via import() in setMeterState() to defer
// ~400KB of OpenTelemetry + protobuf modules until telemetry is actually initialized.
// gRPC exporters (~700KB via @grpc/grpc-js) are further lazy-loaded within instrumentation.ts.
import { configureGlobalAgents } from '../utils/proxy.js'
import { isBetaTracingEnabled } from '../utils/telemetry/betaSessionTracing.js'
import { getTelemetryAttributes } from '../utils/telemetryAttributes.js'
import { setShellIfWindows } from '../utils/windowsPaths.js'

// initialize1PEventLogging is dynamically imported to defer OpenTelemetry sdk-logs/resources

// Track if telemetry has been initialized to prevent double initialization
let telemetryInitialized = false
// 模块级布尔标记：防止遥测被重复初始化

// init 被 memoize 包裹，整个进程只跑一次启动初始化；内部用打点测量各阶段耗时
export const init = memoize(async (): Promise<void> => {
  const initStartTime = Date.now()
  logForDiagnosticsNoPII('info', 'init_started')
  profileCheckpoint('init_function_start')

  // Validate configs are valid and enable configuration system
  try {
// 主流程包在 try 里：配置错误走交互对话框，其余错误向上抛
    const configsStart = Date.now()
    enableConfigs()
// enableConfigs 启用配置系统并打点记录耗时
    logForDiagnosticsNoPII('info', 'init_configs_enabled', {
      duration_ms: Date.now() - configsStart,
    })
    profileCheckpoint('init_configs_enabled')

    // Apply only safe environment variables before trust dialog
    // Full environment variables are applied after trust is established
    const envVarsStart = Date.now()
    applySafeConfigEnvironmentVariables()
// 信任对话框之前只应用安全环境变量，完整环境变量等信任建立后再覆写

    // Apply NODE_EXTRA_CA_CERTS from settings.json to process.env early,
    // before any TLS connections. Bun caches the TLS cert store at boot
    // via BoringSSL, so this must happen before the first TLS handshake.
    applyExtraCACertsFromConfig()
// 趁第一次 TLS 握手前把 NODE_EXTRA_CA_CERTS 写进环境，Bun 启动就缓存了证书库

    logForDiagnosticsNoPII('info', 'init_safe_env_vars_applied', {
      duration_ms: Date.now() - envVarsStart,
    })
    profileCheckpoint('init_safe_env_vars_applied')

    // Make sure things get flushed on exit
    setupGracefulShutdown()
// 注册优雅关闭，确保退出时子进程不会变孤儿
    profileCheckpoint('init_after_graceful_shutdown')

    // Initialize 1P event logging (no security concerns, but deferred to avoid
    // loading OpenTelemetry sdk-logs at startup). growthbook.js is already in
    // the module cache by this point (firstPartyEventLogger imports it), so the
    // second dynamic import adds no load cost.
    void Promise.all([
// 并行预加载一方事件日志与功能开关，二者已在模块缓存里，二次 import 无额外开销
      import('../services/analytics/firstPartyEventLogger.js'),
      import('../services/analytics/growthbook.js'),
    ]).then(([fp, gb]) => {
      fp.initialize1PEventLogging()
      // Rebuild the logger provider if tengu_1p_event_batch_config changes
      // mid-session. Change detection (isEqual) is inside the handler so
      // unchanged refreshes are no-ops.
      gb.onGrowthBookRefresh(() => {
        void fp.reinitialize1PEventLoggingIfConfigChanged()
      })
    })
    profileCheckpoint('init_after_1p_event_logging')

    // Populate OAuth account info if it is not already cached in config. This is needed since the
    // OAuth account info may not be populated when logging in through the VSCode extension.
// 异步补 OAuth 账户信息，VSCode 扩展登录时这一项可能还没填
    void populateOAuthAccountInfoIfNeeded()
    profileCheckpoint('init_after_oauth_populate')

    // Initialize JetBrains IDE detection asynchronously (populates cache for later sync access)
    void initJetBrainsDetection()
// 异步探测 JetBrains IDE，结果缓存起来供后续同步读取
    profileCheckpoint('init_after_jetbrains_detection')

    // Detect GitHub repository asynchronously (populates cache for gitDiff PR linking)
    void detectCurrentRepository()
// 异步探测当前 Git 仓库，供 diff 关联 PR 用

    // Initialize the loading promise early so that other systems (like plugin hooks)
    // can await remote settings loading. The promise includes a timeout to prevent
    // deadlocks if loadRemoteManagedSettings() is never called (e.g., Agent SDK tests).
    if (isEligibleForRemoteManagedSettings()) {
// 尽早初始化远程托管设置的加载承诺，让插件钩子等系统能 await 它
      initializeRemoteManagedSettingsLoadingPromise()
    }
    if (isPolicyLimitsEligible()) {
      initializePolicyLimitsLoadingPromise()
    }
    profileCheckpoint('init_after_remote_settings_check')

    // Record the first start time
    recordFirstStartTime()
// 记录首次启动时间，用于后续遥测

    // Configure global mTLS settings
    const mtlsStart = Date.now()
    logForDebugging('[init] configureGlobalMTLS starting')
    configureGlobalMTLS()
// 配置全局 mTLS：证书不对会连带崩掉所有 TLS 连接
    logForDiagnosticsNoPII('info', 'init_mtls_configured', {
      duration_ms: Date.now() - mtlsStart,
    })
    logForDebugging('[init] configureGlobalMTLS complete')

    // Configure global HTTP agents (proxy and/or mTLS)
    const proxyStart = Date.now()
    logForDebugging('[init] configureGlobalAgents starting')
    configureGlobalAgents()
// 配置全局 HTTP 代理与 mTLS 代理，复用前面准备好的传输层
    logForDiagnosticsNoPII('info', 'init_proxy_configured', {
      duration_ms: Date.now() - proxyStart,
    })
    logForDebugging('[init] configureGlobalAgents complete')
    profileCheckpoint('init_network_configured')

    // Preconnect to the Anthropic API — overlap TCP+TLS handshake
    // (~100-200ms) with the ~100ms of action-handler work before the API
    // request. After CA certs + proxy agents are configured so the warmed
    // connection uses the right transport. Fire-and-forget; skipped for
    // proxy/mTLS/unix/cloud-provider where the SDK's dispatcher wouldn't
    // reuse the global pool.
    preconnectAnthropicApi()
// 预连接 Anthropic API：把 TCP+TLS 握手与后续请求重叠，省下几百毫秒

    // CCR upstreamproxy: start the local CONNECT relay so agent subprocesses
    // can reach org-configured upstreams with credential injection. Gated on
    // CLAUDE_CODE_REMOTE + GrowthBook; fail-open on any error. Lazy import so
    // non-CCR startups don't pay the module load. The getUpstreamProxyEnv
    // function is registered with subprocessEnv.ts so subprocess spawning can
    // inject proxy vars without a static import of the upstreamproxy module.
    if (isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)) {
// 仅 CCR 远程模式才起本地 CONNECT 中继，注入凭证给子进程；失败则放行不阻断
      try {
        const { initUpstreamProxy, getUpstreamProxyEnv } = await import(
          '../upstreamproxy/upstreamproxy.js'
        )
        const { registerUpstreamProxyEnvFn } = await import(
          '../utils/subprocessEnv.js'
        )
        registerUpstreamProxyEnvFn(getUpstreamProxyEnv)
        await initUpstreamProxy()
      } catch (err) {
        logForDebugging(
          `[init] upstreamproxy init failed: ${err instanceof Error ? err.message : String(err)}; continuing without proxy`,
          { level: 'warn' },
        )
      }
    }

    // Set up git-bash if relevant
    setShellIfWindows()
// Windows 上设置 git-bash 作为 shell

    // Register LSP manager cleanup (initialization happens in main.tsx after --plugin-dir is processed)
    registerCleanup(shutdownLspServerManager)
// 注册 LSP 管理器清理，真正的初始化在 main.tsx 处理完插件目录后做

    // gh-32730: teams created by subagents (or main agent without
    // explicit TeamDelete) were left on disk forever. Register cleanup
    // for all teams created this session. Lazy import: swarm code is
    // behind feature gate and most sessions never create teams.
    registerCleanup(async () => {
// 注册团队清理：子智能体建的团队会话结束要删掉，避免永远留盘
      const { cleanupSessionTeams } = await import(
        '../utils/swarm/teamHelpers.js'
      )
      await cleanupSessionTeams()
    })

    // Initialize scratchpad directory if enabled
    if (isScratchpadEnabled()) {
// 启用便签目录时确保它存在，记一下耗时
      const scratchpadStart = Date.now()
      await ensureScratchpadDir()
      logForDiagnosticsNoPII('info', 'init_scratchpad_created', {
        duration_ms: Date.now() - scratchpadStart,
      })
    }

    logForDiagnosticsNoPII('info', 'init_completed', {
      duration_ms: Date.now() - initStartTime,
    })
    profileCheckpoint('init_function_end')
  } catch (error) {
// init 主流程收尾，记录总耗时与各阶段打点
    if (error instanceof ConfigParseError) {
// catch 分流：配置错误走对话框，非配置错误原样抛出
      // Skip the interactive Ink dialog when we can't safely render it.
      // The dialog breaks JSON consumers (e.g. desktop marketplace plugin
      // manager running `plugin marketplace list --json` in a VM sandbox).
      if (getIsNonInteractiveSession()) {
// 非交互会话里配置错误不渲染 Ink 对话框，直接写 stderr 并退出
        process.stderr.write(
          `Configuration error in ${error.filePath}: ${error.message}\n`,
        )
        gracefulShutdownSync(1)
        return
      }

      // Show the invalid config dialog with the error object and wait for it to complete
      return import('../components/InvalidConfigDialog.js').then(m =>
// 交互会话里弹出无效配置对话框并等待用户处理
        m.showInvalidConfigDialog({ error }),
      )
      // Dialog itself handles process.exit, so we don't need additional cleanup here
    } else {
      // For non-config errors, rethrow them
      throw error
    }
  }
})

/**
 * Initialize telemetry after trust has been granted.
 * For remote-settings-eligible users, waits for settings to load (non-blocking),
 * then re-applies env vars (to include remote settings) before initializing telemetry.
 * For non-eligible users, initializes telemetry immediately.
 * This should only be called once, after the trust dialog has been accepted.
 */
// initializeTelemetryAfterTrust：信任授予后再初始化遥测，确保拿到远程设置里的配置
export function initializeTelemetryAfterTrust(): void {
  if (isEligibleForRemoteManagedSettings()) {
// 远程设置合格用户先等设置加载完，再覆写环境变量并初始化遥测
    // For SDK/headless mode with beta tracing, initialize eagerly first
    // to ensure the tracer is ready before the first query runs.
    // The async path below will still run but doInitializeTelemetry() guards against double init.
    if (getIsNonInteractiveSession() && isBetaTracingEnabled()) {
      void doInitializeTelemetry().catch(error => {
        logForDebugging(
          `[3P telemetry] Eager telemetry init failed (beta tracing): ${errorMessage(error)}`,
          { level: 'error' },
        )
      })
    }
    logForDebugging(
      '[3P telemetry] Waiting for remote managed settings before telemetry init',
    )
    void waitForRemoteManagedSettingsToLoad()
      .then(async () => {
        logForDebugging(
          '[3P telemetry] Remote managed settings loaded, initializing telemetry',
        )
        // Re-apply env vars to pick up remote settings before initializing telemetry.
        applyConfigEnvironmentVariables()
        await doInitializeTelemetry()
      })
      .catch(error => {
        logForDebugging(
          `[3P telemetry] Telemetry init failed (remote settings path): ${errorMessage(error)}`,
          { level: 'error' },
        )
      })
  } else {
    void doInitializeTelemetry().catch(error => {
      logForDebugging(
        `[3P telemetry] Telemetry init failed: ${errorMessage(error)}`,
        { level: 'error' },
      )
    })
  }
}

// doInitializeTelemetry：真正执行遥测初始化，带重入保护
async function doInitializeTelemetry(): Promise<void> {
  if (telemetryInitialized) {
    // Already initialized, nothing to do
    return
  }

  // Set flag before init to prevent double initialization
  telemetryInitialized = true
// 设标记在初始化之前，防止并发调用导致双初始化
  try {
    await setMeterState()
  } catch (error) {
    // Reset flag on failure so subsequent calls can retry
    telemetryInitialized = false
    throw error
  }
}

// setMeterState：懒加载遥测埋点模块（约 400KB）后创建计量器
async function setMeterState(): Promise<void> {
  // Lazy-load instrumentation to defer ~400KB of OpenTelemetry + protobuf
  const { initializeTelemetry } = await import(
    '../utils/telemetry/instrumentation.js'
  )
  // Initialize customer OTLP telemetry (metrics, logs, traces)
  const meter = await initializeTelemetry()
  if (meter) {
    // Create factory function for attributed counters
    const createAttributedCounter = (
      name: string,
      options: MetricOptions,
    ): AttributedCounter => {
      const counter = meter?.createCounter(name, options)
// 计量器工厂每次取最新遥测属性，保证计数维度是最新的

      return {
        add(value: number, additionalAttributes: Attributes = {}) {
          // Always fetch fresh telemetry attributes to ensure they're up to date
          const currentAttributes = getTelemetryAttributes()
          const mergedAttributes = {
            ...currentAttributes,
            ...additionalAttributes,
          }
          counter?.add(value, mergedAttributes)
        },
      }
    }

    setMeter(meter, createAttributedCounter)

    // Increment session counter here because the startup telemetry path
    // runs before this async initialization completes, so the counter
    // would be null there.
    getSessionCounter()?.add(1)
  }
// 启动遥测路径在异步初始化完成前就跑，所以会话计数器在这里补加
}
// setMeterState 收尾：创建好计量器与计数器后函数结束
