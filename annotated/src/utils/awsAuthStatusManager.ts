// 云厂商认证状态的单例管理器。名字里带 AWS 是历史遗留，实际同时服务 AWS Bedrock 与 GCP Vertex：因为 SDK 上报的认证状态消息本身与厂商无关，用同一个管理器即可，不必按云厂分叉。
/**
 * Singleton manager for cloud-provider authentication status (AWS Bedrock,
 * GCP Vertex). Communicates auth refresh state between auth utilities and
 * React components / SDK output. The SDK 'auth_status' message shape is
 * provider-agnostic, so a single manager serves all providers.
 *
 * Legacy name: originally AWS-only; now used by all cloud auth refresh flows.
 */

import { createSignal } from './signal.js'

export type AwsAuthStatus = {
  isAuthenticating: boolean
  output: string[]
  error?: string
}
// 状态形状只有三个字段：是否正在认证、已产生的输出行、错误信息。输出是字符串数组而不是单串，因为认证过程会持续打印多行日志，界面按行增量追加。

export class AwsAuthStatusManager {
  private static instance: AwsAuthStatusManager | null = null
  private status: AwsAuthStatus = {
    isAuthenticating: false,
    output: [],
  }
  private changed = createSignal<[status: AwsAuthStatus]>()

  static getInstance(): AwsAuthStatusManager {
    if (!AwsAuthStatusManager.instance) {
      AwsAuthStatusManager.instance = new AwsAuthStatusManager()
    }
    return AwsAuthStatusManager.instance
  }
// 单例走的是懒加载：首次取用时才构造，之后一直复用。这样模块加载阶段不会创建信号对象，也保证界面各处拿到的是同一份状态。

  getStatus(): AwsAuthStatus {
    return {
      ...this.status,
      output: [...this.status.output],
    }
  }

  startAuthentication(): void {
    this.status = {
      isAuthenticating: true,
      output: [],
    }
    this.changed.emit(this.getStatus())
  }
// 开始认证时把状态整体重置——既置位进行中标记，也清空上一次的输出，避免不同次认证的日志串在一起。每次改动后都主动发一次信号，订阅方无需轮询。

  addOutput(line: string): void {
    this.status.output.push(line)
    this.changed.emit(this.getStatus())
  }

  setError(error: string): void {
    this.status.error = error
    this.changed.emit(this.getStatus())
  }

  endAuthentication(success: boolean): void {
    if (success) {
      // Clear the status completely on success
      this.status = {
        isAuthenticating: false,
        output: [],
      }
    } else {
      // Keep the output visible on failure
      this.status.isAuthenticating = false
    }
    this.changed.emit(this.getStatus())
  }
// 结束认证按成功与否走两条不同路径：成功时把状态彻底清空，界面回到静止；失败时只把进行中标记置假，保留全部输出，因为失败日志恰恰是用户需要看到的内容。两条路径最后都会发信号。

  subscribe = this.changed.subscribe

  // Clean up for testing
  static reset(): void {
    if (AwsAuthStatusManager.instance) {
      AwsAuthStatusManager.instance.changed.clear()
      AwsAuthStatusManager.instance = null
    }
  }
// reset 只给测试用：清掉信号上的订阅者并把单例指针置空，防止上一个用例残留的订阅影响下一个用例。生产代码不应调用。
}
