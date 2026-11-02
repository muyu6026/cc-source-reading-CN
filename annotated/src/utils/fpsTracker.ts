// 文件级：一个轻量 FPS 度量类型与采集器，记录每帧时长并算出平均 FPS 与低 1% 帧率。
export type FpsMetrics = {
  averageFps: number
  low1PctFps: number
}
// FpsMetrics 类型：只有 averageFps（平均帧率）与 low1PctFps（最慢 1% 帧对应的帧率）两个字段。

// FpsTracker 类：用 frameDurations 存每帧时长，firstRenderTime / lastRenderTime 标记首末帧时刻。
export class FpsTracker {
  private frameDurations: number[] = []
  private firstRenderTime: number | undefined
  private lastRenderTime: number | undefined

  record(durationMs: number): void {
    const now = performance.now()
    if (this.firstRenderTime === undefined) {
      this.firstRenderTime = now
    }
    this.lastRenderTime = now
    this.frameDurations.push(durationMs)
  }
// record 收尾：每帧把耗时压入数组并刷新 lastRenderTime（首帧额外记 firstRenderTime）。

  getMetrics(): FpsMetrics | undefined {
    if (
      this.frameDurations.length === 0 ||
      this.firstRenderTime === undefined ||
      this.lastRenderTime === undefined
    ) {
      return undefined
    }

    const totalTimeMs = this.lastRenderTime - this.firstRenderTime
    if (totalTimeMs <= 0) {
      return undefined
    }

    const totalFrames = this.frameDurations.length
    const averageFps = totalFrames / (totalTimeMs / 1000)

    const sorted = this.frameDurations.slice().sort((a, b) => b - a)
    const p99Index = Math.max(0, Math.ceil(sorted.length * 0.01) - 1)
    const p99FrameTimeMs = sorted[p99Index]!
    const low1PctFps = p99FrameTimeMs > 0 ? 1000 / p99FrameTimeMs : 0

    return {
      averageFps: Math.round(averageFps * 100) / 100,
      low1PctFps: Math.round(low1PctFps * 100) / 100,
    }
  }
// getMetrics 收尾：算出平均 FPS，并把帧时长排序取 p99 帧时反推低 1% 帧率，结果四舍五入保留两位小数。
}
