// 文件级批注：`logger.ts` 实现 OpenTelemetry 的 `DiagLogger` 接口，把第三方遥测诊断日志桥接到本项目的 `logError`/`logForDebugging`。
import type { DiagLogger } from '@opentelemetry/api'
import { logForDebugging } from '../debug.js'
import { logError } from '../log.js'
// 类定义：error/warn 时转发到本地日志，info/debug/verbose 为空实现（静默丢弃）。
export class ClaudeCodeDiagLogger implements DiagLogger {
  error(message: string, ..._: unknown[]) {
    logError(new Error(message))
    logForDebugging(`[3P telemetry] OTEL diag error: ${message}`, {
      level: 'error',
    })
  }
  warn(message: string, ..._: unknown[]) {
    logError(new Error(message))
    logForDebugging(`[3P telemetry] OTEL diag warn: ${message}`, {
      level: 'warn',
    })
  }
  info(_message: string, ..._args: unknown[]) {
    return
  }
  debug(_message: string, ..._args: unknown[]) {
    return
  }
  verbose(_message: string, ..._args: unknown[]) {
    return
  }
}
// 类收尾：整个诊断日志器仅关心 error/warn 级别，其余级别不产出任何日志。
