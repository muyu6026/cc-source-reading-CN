import type {
// 仅做类型导入，不引入运行时依赖；本模块作为依赖图叶子，避免形成循环。
  createSkillCommand,
  parseSkillFrontmatterFields,
} from './loadSkillsDir.js'

/**
 * Write-once registry for the two loadSkillsDir functions that MCP skill
 * discovery needs. This module is a dependency-graph leaf: it imports nothing
 * but types, so both mcpSkills.ts and loadSkillsDir.ts can depend on it
 * without forming a cycle (client.ts → mcpSkills.ts → loadSkillsDir.ts → …
 * → client.ts).
 *
 * The non-literal dynamic-import approach ("await import(variable)") fails at
 * runtime in Bun-bundled binaries — the specifier is resolved against the
 * chunk's /$bunfs/root/… path, not the original source tree, yielding "Cannot
 * find module './loadSkillsDir.js'". A literal dynamic import works in bunfs
 * but dependency-cruiser tracks it, and because loadSkillsDir transitively
 * reaches almost everything, the single new edge fans out into many new cycle
 * violations in the diff check.
 *
 * Registration happens at loadSkillsDir.ts module init, which is eagerly
 * evaluated at startup via the static import from commands.ts — long before
 * any MCP server connects.
 */
// 注释：MCP 技能发现所需的两个 loadSkillsDir 函数的写一次注册表，并解释为何要拆出本叶子模块。

export type MCPSkillBuilders = {
// MCPSkillBuilders 类型：持有 createSkillCommand 与 parseSkillFrontmatterFields 两函数的引用。
  createSkillCommand: typeof createSkillCommand
  parseSkillFrontmatterFields: typeof parseSkillFrontmatterFields
}

let builders: MCPSkillBuilders | null = null
// 模块级单例 builders，初始为 null。

export function registerMCPSkillBuilders(b: MCPSkillBuilders): void {
// 注册函数：在 loadSkillsDir 模块初始化时写入两函数引用。
  builders = b
}

export function getMCPSkillBuilders(): MCPSkillBuilders {
// 获取函数：未注册时抛出明确错误，提示 loadSkillsDir 尚未求值。
  if (!builders) {
// 防御性检查：builders 为空即说明依赖尚未初始化。
    throw new Error(
      'MCP skill builders not registered — loadSkillsDir.ts has not been evaluated yet',
    )
  }
  return builders
// 已注册则返回缓存的构建器引用。
}
