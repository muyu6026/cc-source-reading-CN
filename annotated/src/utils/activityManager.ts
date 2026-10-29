import { getActiveTimeCounter as getActiveTimeCounterImpl } from '../bootstrap/state.js'
// 文件入口：通用活动追踪，区分用户活跃时间与 CLI 活跃时间。

type ActivityManagerOptions = {
  getNow?: () => number
  getActiveTimeCounter?: typeof getActiveTimeCounterImpl
}
// ActivityManagerOptions：可注入 getNow 与计数器，便于测试。

/**
 * ActivityManager handles generic activity tracking for both user and CLI operations.
 * It automatically deduplicates overlapping activities and provides separate metrics
 * for user vs CLI active time.
 */
export class ActivityManager {
  private activeOperations = new Set<string>()

  private lastUserActivityTime: number = 0 // Start with 0 to indicate no activity yet
  private lastCLIRecordedTime: number

  private isCLIActive: boolean = false

  private readonly USER_ACTIVITY_TIMEOUT_MS = 5000 // 5 seconds

  private readonly getNow: () => number
  private readonly getActiveTimeCounter: typeof getActiveTimeCounterImpl

  private static instance: ActivityManager | null = null

  constructor(options?: ActivityManagerOptions) {
    this.getNow = options?.getNow ?? (() => Date.now())
    this.getActiveTimeCounter =
      options?.getActiveTimeCounter ?? getActiveTimeCounterImpl
    this.lastCLIRecordedTime = this.getNow()
  }
// 构造器：初始化时间函数，每个实例独立记录。

  static getInstance(): ActivityManager {
    if (!ActivityManager.instance) {
      ActivityManager.instance = new ActivityManager()
    }
    return ActivityManager.instance
  }
// getInstance：单例获取。

  /**
   * Reset the singleton instance (for testing purposes)
   */
  static resetInstance(): void {
    ActivityManager.instance = null
  }

  /**
   * Create a new instance with custom options (for testing purposes)
   */
  static createInstance(options?: ActivityManagerOptions): ActivityManager {
    ActivityManager.instance = new ActivityManager(options)
    return ActivityManager.instance
  }
// createInstance / resetInstance：测试用实例管理与重置。

  /**
   * Called when user interacts with the CLI (typing, commands, etc.)
   */
  recordUserActivity(): void {
    // Don't record user time if CLI is active (CLI takes precedence)
    if (!this.isCLIActive && this.lastUserActivityTime !== 0) {
      const now = this.getNow()
      const timeSinceLastActivity = (now - this.lastUserActivityTime) / 1000

      if (timeSinceLastActivity > 0) {
        const activeTimeCounter = this.getActiveTimeCounter()
        if (activeTimeCounter) {
          const timeoutSeconds = this.USER_ACTIVITY_TIMEOUT_MS / 1000

          // Only record time if within the timeout window
          if (timeSinceLastActivity < timeoutSeconds) {
            activeTimeCounter.add(timeSinceLastActivity, { type: 'user' })
          }
        }
      }
    }

    // Update the last user activity timestamp
    this.lastUserActivityTime = this.getNow()
  }
// recordUserActivity：CLI 活跃时跳过用户计时，仅在超时窗口内累计。

  /**
   * Starts tracking CLI activity (tool execution, AI response, etc.)
   */
  startCLIActivity(operationId: string): void {
    // If operation already exists, it likely means the previous one didn't clean up
    // properly (e.g., component crashed/unmounted without calling end). Force cleanup
    // to avoid overestimating time - better to underestimate than overestimate.
    if (this.activeOperations.has(operationId)) {
      this.endCLIActivity(operationId)
    }

    const wasEmpty = this.activeOperations.size === 0
    this.activeOperations.add(operationId)

    if (wasEmpty) {
      this.isCLIActive = true
      this.lastCLIRecordedTime = this.getNow()
    }
  }
// startCLIActivity：开始 CLI 计时，首个操作置 CLI 为活跃。

  /**
   * Stops tracking CLI activity
   */
  endCLIActivity(operationId: string): void {
    this.activeOperations.delete(operationId)

    if (this.activeOperations.size === 0) {
      // Last operation ended - CLI becoming inactive
      // Record the CLI time before switching to inactive
      const now = this.getNow()
      const timeSinceLastRecord = (now - this.lastCLIRecordedTime) / 1000

      if (timeSinceLastRecord > 0) {
        const activeTimeCounter = this.getActiveTimeCounter()
        if (activeTimeCounter) {
          activeTimeCounter.add(timeSinceLastRecord, { type: 'cli' })
        }
      }

      this.lastCLIRecordedTime = now
      this.isCLIActive = false
    }
  }
// endCLIActivity：结束 CLI 计时并记录区间时间。

  /**
   * Convenience method to track an async operation automatically (mainly for testing/debugging)
   */
  async trackOperation<T>(
    operationId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    this.startCLIActivity(operationId)
    try {
      return await fn()
    } finally {
      this.endCLIActivity(operationId)
    }
  }
// trackOperation：自动包裹异步操作的起止计时。

  /**
   * Gets current activity states (mainly for testing/debugging)
   */
  getActivityStates(): {
    isUserActive: boolean
    isCLIActive: boolean
    activeOperationCount: number
  } {
    const now = this.getNow()
    const timeSinceUserActivity = (now - this.lastUserActivityTime) / 1000
    const isUserActive =
      timeSinceUserActivity < this.USER_ACTIVITY_TIMEOUT_MS / 1000

    return {
      isUserActive,
      isCLIActive: this.isCLIActive,
      activeOperationCount: this.activeOperations.size,
    }
  }
// getActivityStates：返回当前活跃状态，主要供测试与调试。
}

// Export singleton instance
export const activityManager = ActivityManager.getInstance()
// 导出单例 activityManager。
