import type { Attributes, HrTime } from '@opentelemetry/api'
import { type ExportResult, ExportResultCode } from '@opentelemetry/core'
import {
  AggregationTemporality,
  type MetricData,
  type DataPoint as OTelDataPoint,
  type PushMetricExporter,
  type ResourceMetrics,
} from '@opentelemetry/sdk-metrics'
import axios from 'axios'
import { checkMetricsEnabled } from 'src/services/api/metricsOptOut.js'
import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import { getSubscriptionType, isClaudeAISubscriber } from '../auth.js'
import { checkHasTrustDialogAccepted } from '../config.js'
import { logForDebugging } from '../debug.js'
import { errorMessage, toError } from '../errors.js'
import { getAuthHeaders } from '../http.js'
import { logError } from '../log.js'
import { jsonStringify } from '../slowOperations.js'
import { getClaudeCodeUserAgent } from '../userAgent.js'

type DataPoint = {
  attributes: Record<string, string>
  value: number
  timestamp: string
}

type Metric = {
  name: string
  description?: string
  unit?: string
  data_points: DataPoint[]
}

type InternalMetricsPayload = {
  resource_attributes: Record<string, string>
  metrics: Metric[]
}

// BigQuery 指标导出器类，实现 OpenTelemetry 的 PushMetricExporter 接口
export class BigQueryMetricsExporter implements PushMetricExporter {
  private readonly endpoint: string
  private readonly timeout: number
  private pendingExports: Promise<void>[] = []
  private isShutdown = false

// 构造时选定上报端点（内部用户可走环境变量覆盖）和超时，默认 5 秒
  constructor(options: { timeout?: number } = {}) {
    const defaultEndpoint = 'https://api.anthropic.com/api/claude_code/metrics'

    if (
      process.env.USER_TYPE === 'ant' &&
      process.env.ANT_CLAUDE_CODE_METRICS_ENDPOINT
    ) {
      this.endpoint =
        process.env.ANT_CLAUDE_CODE_METRICS_ENDPOINT +
        '/api/claude_code/metrics'
    } else {
      this.endpoint = defaultEndpoint
    }

    this.timeout = options.timeout || 5000
  }

// 导出入口：记录待发请求，完成后从队列移除；已关闭则直接失败
  async export(
    metrics: ResourceMetrics,
    resultCallback: (result: ExportResult) => void,
  ): Promise<void> {
    if (this.isShutdown) {
      resultCallback({
        code: ExportResultCode.FAILED,
        error: new Error('Exporter has been shutdown'),
      })
      return
    }

    const exportPromise = this.doExport(metrics, resultCallback)
    this.pendingExports.push(exportPromise)

    // Clean up completed exports
    void exportPromise.finally(() => {
      const index = this.pendingExports.indexOf(exportPromise)
      if (index > -1) {
        void this.pendingExports.splice(index, 1)
      }
    })
  }

// 真正的导出逻辑：先校验信任态与组织开关，再转换、鉴权、POST 上报
  private async doExport(
    metrics: ResourceMetrics,
    resultCallback: (result: ExportResult) => void,
  ): Promise<void> {
    try {
      // Skip if trust not established in interactive mode
      // This prevents triggering apiKeyHelper before trust dialog
      const hasTrust =
        checkHasTrustDialogAccepted() || getIsNonInteractiveSession()
      if (!hasTrust) {
        logForDebugging(
          'BigQuery metrics export: trust not established, skipping',
        )
        resultCallback({ code: ExportResultCode.SUCCESS })
        return
      }

      // Check organization-level metrics opt-out
      const metricsStatus = await checkMetricsEnabled()
      if (!metricsStatus.enabled) {
        logForDebugging('Metrics export disabled by organization setting')
        resultCallback({ code: ExportResultCode.SUCCESS })
        return
      }

      const payload = this.transformMetricsForInternal(metrics)

      const authResult = getAuthHeaders()
      if (authResult.error) {
        logForDebugging(`Metrics export failed: ${authResult.error}`)
        resultCallback({
          code: ExportResultCode.FAILED,
          error: new Error(authResult.error),
        })
        return
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': getClaudeCodeUserAgent(),
        ...authResult.headers,
      }

      const response = await axios.post(this.endpoint, payload, {
        timeout: this.timeout,
        headers,
      })

      logForDebugging('BigQuery metrics exported successfully')
      logForDebugging(
        `BigQuery API Response: ${jsonStringify(response.data, null, 2)}`,
      )
      resultCallback({ code: ExportResultCode.SUCCESS })
    } catch (error) {
      logForDebugging(`BigQuery metrics export failed: ${errorMessage(error)}`)
      logError(error)
      resultCallback({
        code: ExportResultCode.FAILED,
        error: toError(error),
      })
    }
  }

// 把 OTel 指标转成内部 payload：固定资源属性 + 每个指标的数据点
  private transformMetricsForInternal(
    metrics: ResourceMetrics,
  ): InternalMetricsPayload {
    const attrs = metrics.resource.attributes

    const resourceAttributes: Record<string, string> = {
      'service.name': (attrs['service.name'] as string) || 'claude-code',
      'service.version': (attrs['service.version'] as string) || 'unknown',
      'os.type': (attrs['os.type'] as string) || 'unknown',
      'os.version': (attrs['os.version'] as string) || 'unknown',
      'host.arch': (attrs['host.arch'] as string) || 'unknown',
      'aggregation.temporality':
        this.selectAggregationTemporality() === AggregationTemporality.DELTA
          ? 'delta'
          : 'cumulative',
    }

    // Only add wsl.version if it exists (omit instead of default)
    if (attrs['wsl.version']) {
      resourceAttributes['wsl.version'] = attrs['wsl.version'] as string
    }

    // Add customer type and subscription type
    if (isClaudeAISubscriber()) {
      resourceAttributes['user.customer_type'] = 'claude_ai'
      const subscriptionType = getSubscriptionType()
      if (subscriptionType) {
        resourceAttributes['user.subscription_type'] = subscriptionType
      }
    } else {
      resourceAttributes['user.customer_type'] = 'api'
    }

    const transformed = {
      resource_attributes: resourceAttributes,
      metrics: metrics.scopeMetrics.flatMap(scopeMetric =>
        scopeMetric.metrics.map(metric => ({
          name: metric.descriptor.name,
          description: metric.descriptor.description,
          unit: metric.descriptor.unit,
          data_points: this.extractDataPoints(metric),
        })),
      ),
    }

    return transformed
  }

// 抽取数据点：只保留数值型，属性转成字符串，时间戳转成 ISO 格式
  private extractDataPoints(metric: MetricData): DataPoint[] {
    const dataPoints = metric.dataPoints || []

    return dataPoints
      .filter(
        (point): point is OTelDataPoint<number> =>
          typeof point.value === 'number',
      )
      .map(point => ({
        attributes: this.convertAttributes(point.attributes),
        value: point.value,
        timestamp: this.hrTimeToISOString(
          point.endTime || point.startTime || [Date.now() / 1000, 0],
        ),
      }))
  }

// 关闭导出器：先强制把待发请求刷完再标记关闭
  async shutdown(): Promise<void> {
    this.isShutdown = true
    await this.forceFlush()
    logForDebugging('BigQuery metrics exporter shutdown complete')
  }

// 强制刷新：等所有待发导出 Promise 完成
  async forceFlush(): Promise<void> {
    await Promise.all(this.pendingExports)
    logForDebugging('BigQuery metrics exporter flush complete')
  }

// 把属性对象里非空的值统一转成字符串
  private convertAttributes(
    attributes: Attributes | undefined,
  ): Record<string, string> {
    const result: Record<string, string> = {}
    if (attributes) {
      for (const [key, value] of Object.entries(attributes)) {
        if (value !== undefined && value !== null) {
          result[key] = String(value)
        }
      }
    }
    return result
  }

// 把 OpenTelemetry 的 [秒, 纳秒] 时间转成 ISO 字符串
  private hrTimeToISOString(hrTime: HrTime): string {
    const [seconds, nanoseconds] = hrTime
    const date = new Date(seconds * 1000 + nanoseconds / 1000000)
    return date.toISOString()
  }

// 聚合时态固定用 DELTA（增量），改 CUMULATIVE 会搞乱生产力看板
  selectAggregationTemporality(): AggregationTemporality {
    // DO NOT CHANGE THIS TO CUMULATIVE
    // It would mess up the aggregation of metrics
    // for CC Productivity metrics dashboard
    return AggregationTemporality.DELTA
  }
}
