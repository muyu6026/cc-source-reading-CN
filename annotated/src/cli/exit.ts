/**
 * CLI exit helpers for subcommand handlers.
 *
 * Consolidates the 4-5 line "print + lint-suppress + exit" block that was
 * copy-pasted ~60 times across `claude mcp *` / `claude plugin *` handlers.
 * The `: never` return type lets TypeScript narrow control flow at call sites
 * without a trailing `return`.
 */
/* eslint-disable custom-rules/no-process-exit -- centralized CLI exit point */
// 用 eslint-disable 关掉 no-process-exit 规则——本文件是全仓唯一的集中退出点，必须调用 process.exit。

// `return undefined as never` (not a post-exit throw) — tests spy on
// process.exit and let it return. Call sites write `return cliError(...)`
// where subsequent code would dereference narrowed-away values under mock.
// cliError uses console.error (tests spy on console.error); cliOk uses
// process.stdout.write (tests spy on process.stdout.write — Bun's console.log
// doesn't route through a spied process.stdout.write).
// 文件定位：把分散在 claude mcp / plugin 子命令里约 60 处「打印 + 关 lint + 退出」的退出块收拢成两个统一函数。返回类型用 never 让 TypeScript 在调用处收窄控制流，不必再写 trailing return。

/** Write an error message to stderr (if given) and exit with code 1. */
export function cliError(msg?: string): never {
// cliError：把错误信息写到 stderr（若有）并以退出码 1 退出。
  // biome-ignore lint/suspicious/noConsole: centralized CLI error output
  if (msg) console.error(msg)
  process.exit(1)
  return undefined as never
// return undefined as never 让控制流收窄到 never，调用处不用补 return；测试会 spy process.exit 让它返回而非真的退出。
}

/** Write a message to stdout (if given) and exit with code 0. */
export function cliOk(msg?: string): never {
// cliOk：cliError 的「成功」对应版——信息写到 stdout（若有）并以退出码 0 退出。
  if (msg) process.stdout.write(msg + '\n')
  process.exit(0)
  return undefined as never
}
// 与 cliError 同理用 as never 收窄控制流；cliOk 走 process.stdout.write，因为 Bun 的 console.log 不经过被 spy 的 process.stdout.write。
