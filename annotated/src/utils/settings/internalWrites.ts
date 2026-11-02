// 本文件记录「进程内设置文件写入」的时间戳，供 changeDetector.ts 中的 chokidar 监听器忽略自身写回声。它从 changeDetector 抽离出来，打破 settings→changeDetector→hooks→…→settings 的循环依赖。
/**
 * Tracks timestamps of in-process settings-file writes so the chokidar watcher
 * in changeDetector.ts can ignore its own echoes.
 *
 * Extracted from changeDetector.ts to break the settings.ts → changeDetector.ts →
 * hooks.ts → … → settings.ts cycle. settings.ts needs to mark "I'm about to
 * write" before the write lands; changeDetector needs to read the mark when
 * chokidar fires. The map is the only shared state — everything else in
 * changeDetector (chokidar, hooks, mdm polling) is irrelevant to settings.ts.
 *
 * Callers pass resolved paths. The path→source resolution (getSettingsFilePathForSource)
 * lives in settings.ts, so settings.ts does it before calling here. No imports.
 */

// timestamps：路径到写入时间戳的共享 Map，是本模块与 changeDetector 之间唯一的共享状态。
const timestamps = new Map<string, number>()

// markInternalWrite：在真正落盘前由 settings.ts 调用，标记某路径即将被写入，记录当前时间。
export function markInternalWrite(path: string): void {
  timestamps.set(path, Date.now())
}

/**
 * True if `path` was marked within `windowMs`. Consumes the mark on match —
 * the watcher fires once per write, so a matched mark shouldn't suppress
 * the next (real, external) change to the same file.
 */
// consumeInternalWrite：当 chokidar 触发时判断该路径是否在 windowMs 窗口内被标记过。命中则消费掉该标记（避免抑制下一次真实外部改动）并返回 true。
export function consumeInternalWrite(path: string, windowMs: number): boolean {
  const ts = timestamps.get(path)
  if (ts !== undefined && Date.now() - ts < windowMs) {
    timestamps.delete(path)
    return true
  }
  return false
}

// clearInternalWrites：清空全部时间戳标记，一般用于设置系统复位或测试清理。
export function clearInternalWrites(): void {
  timestamps.clear()
}
