// 文件级批注：`bundledMode.ts` 提供两个 Bun 运行时探测函数，判断当前是否用 Bun 启动或是否跑在 Bun 编译出的独立可执行文件里。
/**
 * Detects if the current runtime is Bun.
 * Returns true when:
 * - Running a JS file via the `bun` command
 * - Running a Bun-compiled standalone executable
 */
// 探测 Bun 启动：检查 `process.versions.bun` 是否存在来确定运行时。
export function isRunningWithBun(): boolean {
  // https://bun.com/guides/util/detect-bun
  return process.versions.bun !== undefined
}
// 收尾：非 Bun 运行时直接返回 `false`。

/**
 * Detects if running as a Bun-compiled standalone executable.
 * This checks for embedded files which are present in compiled binaries.
 */
// 探测打包模式：检查 Bun 全局是否存在且含内嵌文件列表，识别编译产物。
export function isInBundledMode(): boolean {
  return (
    typeof Bun !== 'undefined' &&
    Array.isArray(Bun.embeddedFiles) &&
    Bun.embeddedFiles.length > 0
  )
}
// 收尾：三项条件齐备才认定处于打包独立可执行模式。
