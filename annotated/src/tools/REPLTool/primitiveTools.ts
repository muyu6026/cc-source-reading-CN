import type { Tool } from '../../Tool.js'
import { AgentTool } from '../AgentTool/AgentTool.js'
import { BashTool } from '../BashTool/BashTool.js'
import { FileEditTool } from '../FileEditTool/FileEditTool.js'
import { FileReadTool } from '../FileReadTool/FileReadTool.js'
import { FileWriteTool } from '../FileWriteTool/FileWriteTool.js'
import { GlobTool } from '../GlobTool/GlobTool.js'
import { GrepTool } from '../GrepTool/GrepTool.js'
import { NotebookEditTool } from '../NotebookEditTool/NotebookEditTool.js'

let _primitiveTools: readonly Tool[] | undefined
// 模块级缓存：首次调用后把原语工具数组缓存住，后续直接返回同一实例。

/**
 * Primitive tools hidden from direct model use when REPL mode is on
 * (REPL_ONLY_TOOLS) but still accessible inside the REPL VM context.
 * Exported so display-side code (collapseReadSearch, renderers) can
 * classify/render virtual messages for these tools even when they're
 * absent from the filtered execution tools list.
 *
 * Lazy getter — the import chain collapseReadSearch.ts → primitiveTools.ts
 * → FileReadTool.tsx → ... loops back through the tool registry, so a
 * top-level const hits "Cannot access before initialization". Deferring
 * to call time avoids the TDZ.
 *
 * Referenced directly rather than via getAllBaseTools() because that
 * excludes Glob/Grep when hasEmbeddedSearchTools() is true.
 */
// getReplPrimitiveTools：REPL_ONLY_TOOLS 对应的工具实例表——REPL 模式下被藏起
// 但 REPL VM 内部仍可调用的原语。
export function getReplPrimitiveTools(): readonly Tool[] {
  return (_primitiveTools ??= [
    FileReadTool,
    FileWriteTool,
    FileEditTool,
    GlobTool,
    GrepTool,
    BashTool,
    NotebookEditTool,
    AgentTool,
  ])
}
// 三个实现细节：
// ① 惰性 getter（??= 延迟初始化）：import 链 collapseReadSearch → primitiveTools → FileReadTool
//    会绕回工具注册表，模块顶层 const 会撞 TDZ「Cannot access before initialization」；
// ② 直接列实例而非走 getAllBaseTools()：后者在 hasEmbeddedSearchTools() 时会剔除 Glob/Grep；
// ③ 导出是为了展示侧（collapseReadSearch、渲染器）能给这些被隐藏工具的虚拟消息分类/渲染。
