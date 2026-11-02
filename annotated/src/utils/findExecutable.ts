// 在 PATH 里查找可执行文件，作用类似 `which`，用来替换 spawn-rx 的 findActualExecutable，从而省掉把 rxjs（约 313KB）拉进来。
import { whichSync } from './which.js'

/**
 * Find an executable by searching PATH, similar to `which`.
 * Replaces spawn-rx's findActualExecutable to avoid pulling in rxjs (~313 KB).
 *
 * Returns { cmd, args } to match the spawn-rx API shape.
 * `cmd` is the resolved path if found, or the original name if not.
 * `args` is always the pass-through of the input args.
 */
export function findExecutable(
  exe: string,
  args: string[],
): { cmd: string; args: string[] } {
  const resolved = whichSync(exe)
  return { cmd: resolved ?? exe, args }
// 返回值：形状是 {cmd, args} 以贴合 spawn-rx 的 API；cmd 是解析到的路径，找不到就退回原名，args 则原样透传输入参数。
}
