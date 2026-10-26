import { DiagLogLevel, diag, trace } from '@opentelemetry/api'
// 「引入 OpenTelemetry 核心 API 与日志/追踪能力」
import { logs } from '@opentelemetry/api-logs'
// OTLP/Prometheus exporters are dynamically imported inside the protocol
// switch statements below. A process uses at most one protocol variant per
// signal, but static imports would load all 6 (~1.2MB) on every startup.
import {
  envDetector,
  hostDetector,
  osDetector,
  resourceFromAttributes,
} from '@opentelemetry/resources'
import {
  BatchLogRecordProcessor,
  ConsoleLogRecordExporter,
  LoggerProvider,
} from '@opentelemetry/sdk-logs'
import {
  ConsoleMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics'
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  ConsoleSpanExporter,
} from '@opentelemetry/sdk-trace-base'
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  SEMRESATTRS_HOST_ARCH,
} from '@opentelemetry/semantic-conventions'
import { HttpsProxyAgent } from 'https-proxy-agent'
import {
  getLoggerProvider,
  getMeterProvider,
  getTracerProvider,
  setEventLogger,
  setLoggerProvider,
  setMeterProvider,
  setTracerProvider,
} from 'src/bootstrap/state.js'
import {
  getOtelHeadersFromHelper,
  getSubscriptionType,
  is1PApiCustomer,
  isClaudeAISubscriber,
} from 'src/utils/auth.js'
import { getPlatform, getWslVersion } from 'src/utils/platform.js'

import { getCACertificates } from '../caCerts.js'
import { registerCleanup } from '../cleanupRegistry.js'
import { getHasFormattedOutput, logForDebugging } from '../debug.js'
import { isEnvTruthy } from '../envUtils.js'
import { errorMessage } from '../errors.js'
import { getMTLSConfig } from '../mtls.js'
import { getProxyUrl, shouldBypassProxy } from '../proxy.js'
import { getSettings_DEPRECATED } from '../settings/settings.js'
import { jsonStringify } from '../slowOperations.js'
import { profileCheckpoint } from '../startupProfiler.js'
import { isBetaTracingEnabled } from './betaSessionTracing.js'
import { BigQueryMetricsExporter } from './bigqueryExporter.js'
import { ClaudeCodeDiagLogger } from './logger.js'
import { initializePerfettoTracing } from './perfettoTracing.js'
import {
  endInteractionSpan,
  isEnhancedTelemetryEnabled,
} from './sessionTracing.js'

const DEFAULT_METRICS_EXPORT_INTERVAL_MS = 60000
// 「指标导出默认间隔 60 秒」
const DEFAULT_LOGS_EXPORT_INTERVAL_MS = 5000
const DEFAULT_TRACES_EXPORT_INTERVAL_MS = 5000

class TelemetryTimeoutError extends Error {}
// 「遥测关闭超时专用错误类型」

function telemetryTimeout(ms: number, message: string): Promise<never> {
// 「构造一个在指定毫秒后拒绝的超时 Promise，unref 避免拖住进程」
  return new Promise((_, reject) => {
    setTimeout(
      (rej: (e: Error) => void, msg: string) =>
        rej(new TelemetryTimeoutError(msg)),
      ms,
      reject,
      message,
    ).unref()
  })
}

export function bootstrapTelemetry() {
// 「引导遥测：ant 环境变量复制到 OTEL 变量并设定默认时间粒度」
  if (process.env.USER_TYPE === 'ant') {
    // Read from ANT_ prefixed variables that are defined at build time
    if (process.env.ANT_OTEL_METRICS_EXPORTER) {
      process.env.OTEL_METRICS_EXPORTER = process.env.ANT_OTEL_METRICS_EXPORTER
    }
    if (process.env.ANT_OTEL_LOGS_EXPORTER) {
      process.env.OTEL_LOGS_EXPORTER = process.env.ANT_OTEL_LOGS_EXPORTER
    }
    if (process.env.ANT_OTEL_TRACES_EXPORTER) {
      process.env.OTEL_TRACES_EXPORTER = process.env.ANT_OTEL_TRACES_EXPORTER
    }
    if (process.env.ANT_OTEL_EXPORTER_OTLP_PROTOCOL) {
      process.env.OTEL_EXPORTER_OTLP_PROTOCOL =
        process.env.ANT_OTEL_EXPORTER_OTLP_PROTOCOL
    }
    if (process.env.ANT_OTEL_EXPORTER_OTLP_ENDPOINT) {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT =
        process.env.ANT_OTEL_EXPORTER_OTLP_ENDPOINT
    }
    if (process.env.ANT_OTEL_EXPORTER_OTLP_HEADERS) {
      process.env.OTEL_EXPORTER_OTLP_HEADERS =
        process.env.ANT_OTEL_EXPORTER_OTLP_HEADERS
    }
  }

  // Set default tempoality to 'delta' because it's the more sane default
  if (!process.env.OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE) {
// 「未显式指定时默认指标时间粒度为 delta」
    process.env.OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE = 'delta'
  }
}

// Per OTEL spec, "none" means "no automatically configured exporter for this signal".
// https://opentelemetry.io/docs/specs/otel/configuration/sdk-environment-variables/#exporter-selection
export function parseExporterTypes(value: string | undefined): string[] {
// 「解析导出器类型列表，过滤空串与 none 关键字」
  return (value || '')
    .trim()
    .split(',')
    .filter(Boolean)
    .map(t => t.trim())
    .filter(t => t !== 'none')
}

async function getOtlpReaders() {
// 「构造 OTLP 指标读取器，按协议懒加载对应导出器」
  const exporterTypes = parseExporterTypes(process.env.OTEL_METRICS_EXPORTER)
  const exportInterval = parseInt(
    process.env.OTEL_METRIC_EXPORT_INTERVAL ||
      DEFAULT_METRICS_EXPORT_INTERVAL_MS.toString(),
  )

  const exporters = []
  for (const exporterType of exporterTypes) {
    if (exporterType === 'console') {
      // Custom console exporter that shows resource attributes
      const consoleExporter = new ConsoleMetricExporter()
      const originalExport = consoleExporter.export.bind(consoleExporter)

      consoleExporter.export = (metrics, callback) => {
        // Log resource attributes once at the start
        if (metrics.resource && metrics.resource.attributes) {
          // The console exporter is for debugging, so console output is intentional here

          logForDebugging('\n=== Resource Attributes ===')
          logForDebugging(jsonStringify(metrics.resource.attributes))
          logForDebugging('===========================\n')
        }

        return originalExport(metrics, callback)
      }

      exporters.push(consoleExporter)
    } else if (exporterType === 'otlp') {
      const protocol =
        process.env.OTEL_EXPORTER_OTLP_METRICS_PROTOCOL?.trim() ||
        process.env.OTEL_EXPORTER_OTLP_PROTOCOL?.trim()

      const httpConfig = getOTLPExporterConfig()

      switch (protocol) {
        case 'grpc': {
          // Lazy-import to keep @grpc/grpc-js (~700KB) out of the telemetry chunk
          // when the protocol is http/protobuf (ant default) or http/json.
          const { OTLPMetricExporter } = await import(
            '@opentelemetry/exporter-metrics-otlp-grpc'
          )
// 「grpc 协议懒加载，避免把约 700KB 引入遥测分块」
          exporters.push(new OTLPMetricExporter())
          break
        }
        case 'http/json': {
          const { OTLPMetricExporter } = await import(
            '@opentelemetry/exporter-metrics-otlp-http'
          )
          exporters.push(new OTLPMetricExporter(httpConfig))
          break
        }
        case 'http/protobuf': {
          const { OTLPMetricExporter } = await import(
            '@opentelemetry/exporter-metrics-otlp-proto'
          )
          exporters.push(new OTLPMetricExporter(httpConfig))
          break
        }
        default:
          throw new Error(
            `Unknown protocol set in OTEL_EXPORTER_OTLP_METRICS_PROTOCOL or OTEL_EXPORTER_OTLP_PROTOCOL env var: ${protocol}`,
          )
      }
    } else if (exporterType === 'prometheus') {
      const { PrometheusExporter } = await import(
        '@opentelemetry/exporter-prometheus'
      )
      exporters.push(new PrometheusExporter())
    } else {
      throw new Error(
        `Unknown exporter type set in OTEL_EXPORTER_OTLP_METRICS_PROTOCOL or OTEL_EXPORTER_OTLP_PROTOCOL env var: ${exporterType}`,
      )
    }
  }

  return exporters.map(exporter => {
    if ('export' in exporter) {
      return new PeriodicExportingMetricReader({
        exporter,
        exportIntervalMillis: exportInterval,
      })
    }
    return exporter
  })
}

async function getOtlpLogExporters() {
// 「构造 OTLP 日志导出器，支持 console 与多种 OTLP 协议」
  const exporterTypes = parseExporterTypes(process.env.OTEL_LOGS_EXPORTER)

  const protocol =
    process.env.OTEL_EXPORTER_OTLP_LOGS_PROTOCOL?.trim() ||
    process.env.OTEL_EXPORTER_OTLP_PROTOCOL?.trim()
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT

  logForDebugging(
    `[3P telemetry] getOtlpLogExporters: types=${jsonStringify(exporterTypes)}, protocol=${protocol}, endpoint=${endpoint}`,
  )

  const exporters = []
  for (const exporterType of exporterTypes) {
    if (exporterType === 'console') {
      exporters.push(new ConsoleLogRecordExporter())
    } else if (exporterType === 'otlp') {
      const httpConfig = getOTLPExporterConfig()

      switch (protocol) {
        case 'grpc': {
          const { OTLPLogExporter } = await import(
            '@opentelemetry/exporter-logs-otlp-grpc'
          )
          exporters.push(new OTLPLogExporter())
          break
        }
        case 'http/json': {
          const { OTLPLogExporter } = await import(
            '@opentelemetry/exporter-logs-otlp-http'
          )
          exporters.push(new OTLPLogExporter(httpConfig))
          break
        }
        case 'http/protobuf': {
          const { OTLPLogExporter } = await import(
            '@opentelemetry/exporter-logs-otlp-proto'
          )
          exporters.push(new OTLPLogExporter(httpConfig))
          break
        }
        default:
          throw new Error(
            `Unknown protocol set in OTEL_EXPORTER_OTLP_LOGS_PROTOCOL or OTEL_EXPORTER_OTLP_PROTOCOL env var: ${protocol}`,
          )
      }
    } else {
      throw new Error(
        `Unknown exporter type set in OTEL_LOGS_EXPORTER env var: ${exporterType}`,
      )
    }
  }

  return exporters
}

async function getOtlpTraceExporters() {
// 「构造 OTLP 追踪导出器，按协议懒加载对应 exporter」
  const exporterTypes = parseExporterTypes(process.env.OTEL_TRACES_EXPORTER)

  const exporters = []
  for (const exporterType of exporterTypes) {
    if (exporterType === 'console') {
      exporters.push(new ConsoleSpanExporter())
    } else if (exporterType === 'otlp') {
      const protocol =
        process.env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL?.trim() ||
        process.env.OTEL_EXPORTER_OTLP_PROTOCOL?.trim()

      const httpConfig = getOTLPExporterConfig()

      switch (protocol) {
        case 'grpc': {
          const { OTLPTraceExporter } = await import(
            '@opentelemetry/exporter-trace-otlp-grpc'
          )
          exporters.push(new OTLPTraceExporter())
          break
        }
        case 'http/json': {
          const { OTLPTraceExporter } = await import(
            '@opentelemetry/exporter-trace-otlp-http'
          )
          exporters.push(new OTLPTraceExporter(httpConfig))
          break
        }
        case 'http/protobuf': {
          const { OTLPTraceExporter } = await import(
            '@opentelemetry/exporter-trace-otlp-proto'
          )
          exporters.push(new OTLPTraceExporter(httpConfig))
          break
        }
        default:
          throw new Error(
            `Unknown protocol set in OTEL_EXPORTER_OTLP_TRACES_PROTOCOL or OTEL_EXPORTER_OTLP_PROTOCOL env var: ${protocol}`,
          )
      }
    } else {
      throw new Error(
        `Unknown exporter type set in OTEL_TRACES_EXPORTER env var: ${exporterType}`,
      )
    }
  }

  return exporters
}

export function isTelemetryEnabled() {
// 「由环境变量判定遥测是否启用」
  return isEnvTruthy(process.env.CLAUDE_CODE_ENABLE_TELEMETRY)
}

function getBigQueryExportingReader() {
// 「构造 BigQuery 指标读取器，5 分钟间隔以降低负载」
  const bigqueryExporter = new BigQueryMetricsExporter()
  return new PeriodicExportingMetricReader({
    exporter: bigqueryExporter,
    exportIntervalMillis: 5 * 60 * 1000, // 5mins for BigQuery metrics exporter to reduce load
  })
}

function isBigQueryMetricsEnabled() {
// 「判定 BigQuery 指标是否启用：API 客户、C4E 与团队用户」
  // BigQuery metrics are enabled for:
  // 1. API customers (excluding Claude.ai subscribers and Bedrock/Vertex)
  // 2. Claude for Enterprise (C4E) users
  // 3. Claude for Teams users
  const subscriptionType = getSubscriptionType()
  const isC4EOrTeamUser =
    isClaudeAISubscriber() &&
    (subscriptionType === 'enterprise' || subscriptionType === 'team')

  return is1PApiCustomer() || isC4EOrTeamUser
}

/**
 * Initialize beta tracing - a separate code path for detailed debugging.
 * Uses BETA_TRACING_ENDPOINT instead of OTEL_EXPORTER_OTLP_ENDPOINT.
 */
async function initializeBetaTracing(
  resource: ReturnType<typeof resourceFromAttributes>,
): Promise<void> {
// 「初始化 beta 详细追踪，使用独立的 BETA_TRACING_ENDPOINT」
  const endpoint = process.env.BETA_TRACING_ENDPOINT
  if (!endpoint) {
    return
  }

  const [{ OTLPTraceExporter }, { OTLPLogExporter }] = await Promise.all([
    import('@opentelemetry/exporter-trace-otlp-http'),
    import('@opentelemetry/exporter-logs-otlp-http'),
  ])

  const httpConfig = {
    url: `${endpoint}/v1/traces`,
  }

  const logHttpConfig = {
    url: `${endpoint}/v1/logs`,
  }

  // Initialize trace exporter
  const traceExporter = new OTLPTraceExporter(httpConfig)
  const spanProcessor = new BatchSpanProcessor(traceExporter, {
    scheduledDelayMillis: DEFAULT_TRACES_EXPORT_INTERVAL_MS,
  })

  const tracerProvider = new BasicTracerProvider({
    resource,
    spanProcessors: [spanProcessor],
  })

  trace.setGlobalTracerProvider(tracerProvider)
  setTracerProvider(tracerProvider)

  // Initialize log exporter
  const logExporter = new OTLPLogExporter(logHttpConfig)
  const loggerProvider = new LoggerProvider({
    resource,
    processors: [
      new BatchLogRecordProcessor(logExporter, {
        scheduledDelayMillis: DEFAULT_LOGS_EXPORT_INTERVAL_MS,
      }),
    ],
  })

  logs.setGlobalLoggerProvider(loggerProvider)
  setLoggerProvider(loggerProvider)

  // Initialize event logger
  const eventLogger = logs.getLogger(
    'com.anthropic.claude_code.events',
    MACRO.VERSION,
  )
  setEventLogger(eventLogger)

  // Setup flush handlers - flush both logs AND traces
  process.on('beforeExit', async () => {
// 「进程退出前强制刷出日志与追踪」
    await loggerProvider?.forceFlush()
    await tracerProvider?.forceFlush()
  })

  process.on('exit', () => {
    void loggerProvider?.forceFlush()
    void tracerProvider?.forceFlush()
  })
}

export async function initializeTelemetry() {
// 「遥测初始化主入口：装配导出器、资源与提供者」
  profileCheckpoint('telemetry_init_start')
  bootstrapTelemetry()

  // Console exporters call console.dir on a timer (5s logs/traces, 60s
  // metrics), writing pretty-printed objects to stdout. In stream-json
  // mode stdout is the SDK message channel; the first line (`{`) breaks
  // the SDK's line reader. Stripped here (not main.tsx) because init.ts
  // re-runs applyConfigEnvironmentVariables() inside initializeTelemetry-
  // AfterTrust for remote-managed-settings users, and bootstrapTelemetry
  // above copies ANT_OTEL_* for ant users — both would undo an earlier strip.
  if (getHasFormattedOutput()) {
// 「格式化输出（SDK 通道）下剔除 console 导出器以免破坏行读取」
    for (const key of [
      'OTEL_METRICS_EXPORTER',
      'OTEL_LOGS_EXPORTER',
      'OTEL_TRACES_EXPORTER',
    ] as const) {
      const v = process.env[key]
      if (v?.includes('console')) {
        process.env[key] = v
          .split(',')
          .map(s => s.trim())
          .filter(s => s !== 'console')
          .join(',')
      }
    }
  }

  diag.setLogger(new ClaudeCodeDiagLogger(), DiagLogLevel.ERROR)
// 「设置诊断日志器，仅 ERROR 级别」

  // Initialize Perfetto tracing (independent of OTEL)
  // Enable via CLAUDE_CODE_PERFETTO_TRACE=1 or CLAUDE_CODE_PERFETTO_TRACE=<path>
  initializePerfettoTracing()
// 「初始化 Perfetto 追踪（独立于 OTEL）」

  const readers = []

  // Add customer exporters (if enabled)
  const telemetryEnabled = isTelemetryEnabled()
  logForDebugging(
    `[3P telemetry] isTelemetryEnabled=${telemetryEnabled} (CLAUDE_CODE_ENABLE_TELEMETRY=${process.env.CLAUDE_CODE_ENABLE_TELEMETRY})`,
  )
  if (telemetryEnabled) {
    readers.push(...(await getOtlpReaders()))
  }

  // Add BigQuery exporter (for API customers, C4E users, and internal users)
// 「BigQuery 指标启用时追加其读取器」
  if (isBigQueryMetricsEnabled()) {
    readers.push(getBigQueryExportingReader())
  }

  // Create base resource with service attributes
  const platform = getPlatform()
  const baseAttributes: Record<string, string> = {
    [ATTR_SERVICE_NAME]: 'claude-code',
    [ATTR_SERVICE_VERSION]: MACRO.VERSION,
  }

  // Add WSL-specific attributes if running on WSL
  if (platform === 'wsl') {
    const wslVersion = getWslVersion()
    if (wslVersion) {
      baseAttributes['wsl.version'] = wslVersion
    }
  }

  const baseResource = resourceFromAttributes(baseAttributes)
// 「以服务名与版本构造基础资源属性」

  // Use OpenTelemetry detectors
  const osResource = resourceFromAttributes(
    osDetector.detect().attributes || {},
  )

  // Extract only host.arch from hostDetector
  const hostDetected = hostDetector.detect()
  const hostArchAttributes = hostDetected.attributes?.[SEMRESATTRS_HOST_ARCH]
    ? {
        [SEMRESATTRS_HOST_ARCH]: hostDetected.attributes[SEMRESATTRS_HOST_ARCH],
      }
    : {}
  const hostArchResource = resourceFromAttributes(hostArchAttributes)

  const envResource = resourceFromAttributes(
    envDetector.detect().attributes || {},
  )

  // Merge resources - later resources take precedence
  const resource = baseResource
    .merge(osResource)
    .merge(hostArchResource)
    .merge(envResource)
// 「合并基础、系统、主机架构与环境资源，后者覆盖前者」

  // Check if beta tracing is enabled - this is a separate code path
  // Available to all users who set ENABLE_BETA_TRACING_DETAILED=1 and BETA_TRACING_ENDPOINT
  if (isBetaTracingEnabled()) {
// 「beta 追踪开启时走独立分支，仅建指标提供者」
    void initializeBetaTracing(resource).catch(e =>
      logForDebugging(`Beta tracing init failed: ${e}`, { level: 'error' }),
    )
    // Still set up meter provider for metrics (but skip regular logs/traces setup)
    const meterProvider = new MeterProvider({
      resource,
      views: [],
      readers,
    })
    setMeterProvider(meterProvider)

    // Register shutdown for beta tracing
    const shutdownTelemetry = async () => {
      const timeoutMs = parseInt(
        process.env.CLAUDE_CODE_OTEL_SHUTDOWN_TIMEOUT_MS || '2000',
      )
      try {
        endInteractionSpan()

        // Force flush + shutdown together inside the timeout. Previously forceFlush
        // was awaited unbounded BEFORE the race, blocking exit on slow OTLP endpoints.
        // Each provider's flush→shutdown is chained independently so a slow logger
        // flush doesn't delay meterProvider/tracerProvider shutdown (no waterfall).
        const loggerProvider = getLoggerProvider()
        const tracerProvider = getTracerProvider()

        const chains: Promise<void>[] = [meterProvider.shutdown()]
        if (loggerProvider) {
          chains.push(
            loggerProvider.forceFlush().then(() => loggerProvider.shutdown()),
          )
        }
        if (tracerProvider) {
          chains.push(
            tracerProvider.forceFlush().then(() => tracerProvider.shutdown()),
          )
        }

        await Promise.race([
          Promise.all(chains),
          telemetryTimeout(timeoutMs, 'OpenTelemetry shutdown timeout'),
        ])
      } catch {
        // Ignore shutdown errors
      }
    }
    registerCleanup(shutdownTelemetry)

    return meterProvider.getMeter('com.anthropic.claude_code', MACRO.VERSION)
  }

  const meterProvider = new MeterProvider({
    resource,
    views: [],
    readers,
  })
// 「常规路径：用全部读取器创建指标提供者」

  // Store reference in state for flushing
  setMeterProvider(meterProvider)

  // Initialize logs if telemetry is enabled
  if (telemetryEnabled) {
// 「遥测启用时初始化日志导出管线」
    const logExporters = await getOtlpLogExporters()
    logForDebugging(
      `[3P telemetry] Created ${logExporters.length} log exporter(s)`,
    )

    if (logExporters.length > 0) {
      const loggerProvider = new LoggerProvider({
        resource,
        // Add batch processors for each exporter
        processors: logExporters.map(
          exporter =>
            new BatchLogRecordProcessor(exporter, {
              scheduledDelayMillis: parseInt(
                process.env.OTEL_LOGS_EXPORT_INTERVAL ||
                  DEFAULT_LOGS_EXPORT_INTERVAL_MS.toString(),
              ),
            }),
        ),
      })

      // Register the logger provider globally
      logs.setGlobalLoggerProvider(loggerProvider)
      setLoggerProvider(loggerProvider)

      // Initialize event logger
      const eventLogger = logs.getLogger(
        'com.anthropic.claude_code.events',
        MACRO.VERSION,
      )
      setEventLogger(eventLogger)
      logForDebugging('[3P telemetry] Event logger set successfully')

      // 'beforeExit' is emitted when Node.js empties its event loop and has no additional work to schedule.
      // Unlike 'exit', it allows us to perform async operations, so it works well for letting
      // network requests complete before the process exits naturally.
      process.on('beforeExit', async () => {
// 「普通路径下退出前刷出日志与追踪」
        await loggerProvider?.forceFlush()
        // Also flush traces - they use BatchSpanProcessor which needs explicit flush
        const tracerProvider = getTracerProvider()
        await tracerProvider?.forceFlush()
      })

      process.on('exit', () => {
        // Final attempt to flush logs and traces
        void loggerProvider?.forceFlush()
        void getTracerProvider()?.forceFlush()
      })
    }
  }

  // Initialize tracing if enhanced telemetry is enabled (BETA)
  if (telemetryEnabled && isEnhancedTelemetryEnabled()) {
// 「增强遥测启用时初始化追踪导出管线」
    const traceExporters = await getOtlpTraceExporters()
    if (traceExporters.length > 0) {
      // Create span processors for each exporter
      const spanProcessors = traceExporters.map(
        exporter =>
          new BatchSpanProcessor(exporter, {
            scheduledDelayMillis: parseInt(
              process.env.OTEL_TRACES_EXPORT_INTERVAL ||
                DEFAULT_TRACES_EXPORT_INTERVAL_MS.toString(),
            ),
          }),
      )

      const tracerProvider = new BasicTracerProvider({
        resource,
        spanProcessors,
      })

      // Register the tracer provider globally
      trace.setGlobalTracerProvider(tracerProvider)
      setTracerProvider(tracerProvider)
    }
  }

  // Shutdown metrics and logs on exit (flushes and closes exporters)
  const shutdownTelemetry = async () => {
// 「退出时关闭遥测：端到端 flush 并受超时约束」
    const timeoutMs = parseInt(
      process.env.CLAUDE_CODE_OTEL_SHUTDOWN_TIMEOUT_MS || '2000',
    )

    try {
      // End any active interaction span before shutdown
      endInteractionSpan()

      const shutdownPromises = [meterProvider.shutdown()]
      const loggerProvider = getLoggerProvider()
      if (loggerProvider) {
        shutdownPromises.push(loggerProvider.shutdown())
      }
      const tracerProvider = getTracerProvider()
      if (tracerProvider) {
        shutdownPromises.push(tracerProvider.shutdown())
      }

      await Promise.race([
        Promise.all(shutdownPromises),
        telemetryTimeout(timeoutMs, 'OpenTelemetry shutdown timeout'),
      ])
// 「在超时与全部关闭之间竞速，避免慢端点阻塞退出」
    } catch (error) {
      if (error instanceof Error && error.message.includes('timeout')) {
        logForDebugging(
          `
OpenTelemetry telemetry flush timed out after ${timeoutMs}ms

To resolve this issue, you can:
1. Increase the timeout by setting CLAUDE_CODE_OTEL_SHUTDOWN_TIMEOUT_MS env var (e.g., 5000 for 5 seconds)
2. Check if your OpenTelemetry backend is experiencing scalability issues
3. Disable OpenTelemetry by unsetting CLAUDE_CODE_ENABLE_TELEMETRY env var

Current timeout: ${timeoutMs}ms
`,
          { level: 'error' },
        )
      }
      throw error
    }
  }

  // Always register shutdown (internal metrics are always enabled)
  registerCleanup(shutdownTelemetry)
// 「始终注册关闭钩子（内部指标恒启用）」

  return meterProvider.getMeter('com.anthropic.claude_code', MACRO.VERSION)
}

/**
 * Flush all pending telemetry data immediately.
 * This should be called before logout or org switching to prevent data leakage.
 */
export async function flushTelemetry(): Promise<void> {
// 「登出或切换组织前立即刷出遥测，避免数据泄露」
  const meterProvider = getMeterProvider()
  if (!meterProvider) {
    return
  }

  const timeoutMs = parseInt(
    process.env.CLAUDE_CODE_OTEL_FLUSH_TIMEOUT_MS || '5000',
  )

  try {
    const flushPromises = [meterProvider.forceFlush()]
    const loggerProvider = getLoggerProvider()
    if (loggerProvider) {
      flushPromises.push(loggerProvider.forceFlush())
    }
    const tracerProvider = getTracerProvider()
    if (tracerProvider) {
      flushPromises.push(tracerProvider.forceFlush())
    }

    await Promise.race([
      Promise.all(flushPromises),
      telemetryTimeout(timeoutMs, 'OpenTelemetry flush timeout'),
    ])

    logForDebugging('Telemetry flushed successfully')
  } catch (error) {
    if (error instanceof TelemetryTimeoutError) {
      logForDebugging(
        `Telemetry flush timed out after ${timeoutMs}ms. Some metrics may not be exported.`,
        { level: 'warn' },
      )
    } else {
      logForDebugging(`Telemetry flush failed: ${errorMessage(error)}`, {
        level: 'error',
      })
    }
    // Don't throw - allow logout to continue even if flush fails
  }
}

function parseOtelHeadersEnvVar(): Record<string, string> {
// 「解析 OTEL 头环境变量为键值对」
  const headers: Record<string, string> = {}
  const envHeaders = process.env.OTEL_EXPORTER_OTLP_HEADERS
  if (envHeaders) {
    for (const pair of envHeaders.split(',')) {
      const [key, ...valueParts] = pair.split('=')
      if (key && valueParts.length > 0) {
        headers[key.trim()] = valueParts.join('=').trim()
      }
    }
  }
  return headers
}

/**
 * Get configuration for OTLP exporters including:
 * - HTTP agent options (proxy, mTLS)
 * - Dynamic headers via otelHeadersHelper or static headers from env var
 */
function getOTLPExporterConfig() {
// 「组装 OTLP 导出器配置：代理、mTLS、动态或静态头」
  const proxyUrl = getProxyUrl()
  const mtlsConfig = getMTLSConfig()
  const settings = getSettings_DEPRECATED()

  // Build base config
  const config: Record<string, unknown> = {}

  // Parse static headers from env var once (doesn't change at runtime)
  const staticHeaders = parseOtelHeadersEnvVar()

  // If otelHeadersHelper is configured, use async headers function for dynamic refresh
  // Otherwise just return static headers if any exist
  if (settings?.otelHeadersHelper) {
    config.headers = async (): Promise<Record<string, string>> => {
      const dynamicHeaders = getOtelHeadersFromHelper()
      return { ...staticHeaders, ...dynamicHeaders }
    }
  } else if (Object.keys(staticHeaders).length > 0) {
    config.headers = async (): Promise<Record<string, string>> => staticHeaders
  }

  // Check if we should bypass proxy for OTEL endpoint
  const otelEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  if (!proxyUrl || (otelEndpoint && shouldBypassProxy(otelEndpoint))) {
    // No proxy configured or OTEL endpoint should bypass proxy
    const caCerts = getCACertificates()
    if (mtlsConfig || caCerts) {
      config.httpAgentOptions = {
        ...mtlsConfig,
        ...(caCerts && { ca: caCerts }),
      }
    }
    return config
  }

  // Return an HttpAgentFactory function that creates our proxy agent
  const caCerts = getCACertificates()
  const agentFactory = (_protocol: string) => {
// 「返回创建带代理与 mTLS/CA 配置的 HTTPS 代理器的工厂」
    // Create and return the proxy agent with mTLS and CA cert config
    const proxyAgent =
      mtlsConfig || caCerts
        ? new HttpsProxyAgent(proxyUrl, {
            ...(mtlsConfig && {
              cert: mtlsConfig.cert,
              key: mtlsConfig.key,
              passphrase: mtlsConfig.passphrase,
            }),
            ...(caCerts && { ca: caCerts }),
          })
        : new HttpsProxyAgent(proxyUrl)

    return proxyAgent
  }

  config.httpAgentOptions = agentFactory
  return config
}
