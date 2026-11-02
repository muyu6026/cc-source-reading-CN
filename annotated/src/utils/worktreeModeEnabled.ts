// 文件级。工作树模式现在对所有用户无条件开启，不再受 GrowthBook 开关控制。
/**
 * Worktree mode is now unconditionally enabled for all users.
 *
 * Previously gated by GrowthBook flag 'tengu_worktree_mode', but the
 * CACHED_MAY_BE_STALE pattern returns the default (false) on first launch
 * before the cache is populated, silently swallowing --worktree.
 * See https://github.com/anthropics/claude-code/issues/27044.
 */
export function isWorktreeModeEnabled(): boolean {
  return true
// 直接返回 `true`；原先的开关会在缓存填充前返回默认 `false`，从而悄悄吞掉 `--worktree` 参数，所以这里干脆写死。
}
