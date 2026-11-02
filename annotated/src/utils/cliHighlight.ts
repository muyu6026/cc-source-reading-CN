// 文件级摘要：把 cli-highlight 做成懒加载的单例 Promise，并借它顺带拿到 highlight.js 的语言注册表。
// 第 1 到 5 行的注释解释了那行 triple-slash 库引用指令为何不能删：
// tsconfig 只开了 ESNext 库，别处用到的 DOM 类型全靠 highlight.js 的类型定义顺手带进来。
// highlight.js's type defs carry `/// <reference lib="dom" />`. SSETransport,
// mcp/client, ssh, dumpPrompts use DOM types (TextDecodeOptions, RequestInfo)
// that only typecheck because this file's `typeof import('highlight.js')` pulls
// lib.dom in. tsconfig has lib: ["ESNext"] only — fixing the actual DOM-type
// deps is a separate sweep; this ref preserves the status quo.
/// <reference lib="dom" />

import { extname } from 'path'

export type CliHighlight = {
  highlight: typeof import('cli-highlight').highlight
  supportsLanguage: typeof import('cli-highlight').supportsLanguage
}
// 对外暴露的类型只保留两个真正被调用的入口。类型用 `typeof import(...)` 动态取，避免在类型层引入运行时依赖。

// One promise shared by Fallback.tsx, markdown.ts, events.ts, getLanguageName.
// The highlight.js import piggybacks: cli-highlight has already pulled it into
// the module cache, so the second import() is a cache hit — no extra bytes
// faulted in.
let cliHighlightPromise: Promise<CliHighlight | null> | undefined
// 单例 Promise，供多个调用方共享：代码块渲染、markdown 处理、事件上报、语言名查询都走这一份。

let loadedGetLanguage: typeof import('highlight.js').getLanguage | undefined
// 语言查询函数的缓存位。它在 loadCliHighlight 里被赋值，之后 getLanguageName 直接读，
// 这样调用方不必再持有 highlight.js 的模块对象。

async function loadCliHighlight(): Promise<CliHighlight | null> {
  try {
    const cliHighlight = await import('cli-highlight')
    // cache hit — cli-highlight already loaded highlight.js
    const highlightJs = await import('highlight.js')
    loadedGetLanguage = highlightJs.getLanguage
    return {
      highlight: cliHighlight.highlight,
      supportsLanguage: cliHighlight.supportsLanguage,
    }
  } catch {
    return null
  }
}
// 加载失败一律吞成 null，不向上抛——高亮是可降级能力，缺了只影响观感，不该让调用链断掉。

export function getCliHighlightPromise(): Promise<CliHighlight | null> {
  cliHighlightPromise ??= loadCliHighlight()
  return cliHighlightPromise
}
// `??=` 保证只加载一次：并发调用方拿到的是同一个 Promise，不会各自触发一次动态 import。

/**
 * eg. "foo/bar.ts" → "TypeScript". Awaits the shared cli-highlight load,
 * then reads highlight.js's language registry. All callers are telemetry
 * (OTel counter attributes, permission-dialog unary events) — none block
 * on this, they fire-and-forget or the consumer already handles Promise<string>.
 */
export async function getLanguageName(file_path: string): Promise<string> {
// 取语言名的入参是文件路径，先 await 共享加载，再从扩展名反查。
// 调用方全是遥测类场景（计数器属性、权限弹窗事件），都不阻塞，因此这里返回 Promise 没有问题。
  await getCliHighlightPromise()
  const ext = extname(file_path).slice(1)
  if (!ext) return 'unknown'
  return loadedGetLanguage?.(ext)?.name ?? 'unknown'
}
// 取不到扩展名或注册表里没有该语言时统一返回 unknown，调用方无需再判空。
