/**
 * Pure string utility functions for MCP tool/server name parsing.
 * This file has no heavy dependencies to keep it lightweight for
 * consumers that only need string parsing (e.g., permissionValidation).
 */

import { normalizeNameForMCP } from './normalization.js'

/*
 * Extracts MCP server information from a tool name string
 * @param toolString The string to parse. Expected format: "mcp__serverName__toolName"
 * @returns An object containing server name and optional tool name, or null if not a valid MCP rule
 *
 * Known limitation: If a server name contains "__", parsing will be incorrect.
 * For example, "mcp__my__server__tool" would parse as server="my" and tool="server__tool"
 * instead of server="my__server" and tool="tool". This is rare in practice since server
 * names typically don't contain double underscores.
 */
export function mcpInfoFromString(toolString: string): {
  serverName: string
  toolName: string | undefined
} | null {
  const parts = toolString.split('__')
// 这个写法的取舍值得看清：先 split 全部，再取前两段、剩下的 join 回去。
//   · 好处：tool 名里的 `__` 不会丢（这是常态，因为很多工具名带双下划线）
//   · 代价：server 名里的 `__` 一定切错（就是上面注释里的 known limitation）
//
// 两个方向不可能同时满足 —— 只能选「tool 名更可能含双下划线」这一侧。
// normalizeNameForMCP 里对 claude.ai 名字折叠连续下划线，正是为了把最常见的
// 那个来源掐掉，让这个取舍在实践中不出事。
  const [mcpPart, serverName, ...toolNameParts] = parts
  if (mcpPart !== 'mcp' || !serverName) {
    return null
  }
  // Join all parts after server name to preserve double underscores in tool names
  const toolName =
    toolNameParts.length > 0 ? toolNameParts.join('__') : undefined
  return { serverName, toolName }
}

/**
 * Generates the MCP tool/command name prefix for a given server
 * @param serverName Name of the MCP server
 * @returns The prefix string
 */
export function getMcpPrefix(serverName: string): string {
  return `mcp__${normalizeNameForMCP(serverName)}__`
}

/**
 * Builds a fully qualified MCP tool name from server and tool names.
 * Inverse of mcpInfoFromString().
 * @param serverName Name of the MCP server (unnormalized)
 * @param toolName Name of the tool (unnormalized)
 * @returns The fully qualified name, e.g., "mcp__server__tool"
 */
export function buildMcpToolName(serverName: string, toolName: string): string {
  return `${getMcpPrefix(serverName)}${normalizeNameForMCP(toolName)}`
}

/**
 * Returns the name to use for permission rule matching.
 * For MCP tools, uses the fully qualified mcp__server__tool name so that
 * deny rules targeting builtins (e.g., "Write") don't match unprefixed MCP
 * replacements that share the same display name. Falls back to `tool.name`.
 */
// 为什么权限匹配要用**全限定名**：内置工具叫 Write，MCP 里也可能有个工具
// 显示名叫 Write。两个方向都会出事：
//   · deny 规则写 `Write`，不该顺带拒掉那个同名的 MCP 工具
//   · 更要紧的反向：allow 规则写 `Write`，绝不能把同名的 MCP 工具放过去
// 所以「拿什么名字去比」本身是安全决定，不是显示问题。
export function getToolNameForPermissionCheck(tool: {
  name: string
  mcpInfo?: { serverName: string; toolName: string }
}): string {
  return tool.mcpInfo
    ? buildMcpToolName(tool.mcpInfo.serverName, tool.mcpInfo.toolName)
    : tool.name
}

/*
 * Extracts the display name from an MCP tool/command name
 * @param fullName The full MCP tool/command name (e.g., "mcp__server_name__tool_name")
 * @param serverName The server name to remove from the prefix
 * @returns The display name without the MCP prefix
 */
export function getMcpDisplayName(
  fullName: string,
  serverName: string,
): string {
  const prefix = `mcp__${normalizeNameForMCP(serverName)}__`
  return fullName.replace(prefix, '')
// 用 replace 而不是 slice/startsWith 判断：prefix 是普通字符串（不会误伤正则元字符），
// 但**如果 fullName 不以它开头，replace 什么都不做、原样返回** —— 静默失败。
//
// 这类「失败时返回入参」的写法在展示层可以接受（最坏是多显示一点前缀），
// 放在判断层就会变成「以为过滤了、其实没过滤」。
}

/**
 * Extracts just the tool/command display name from a userFacingName
 * @param userFacingName The full user-facing name (e.g., "github - Add comment to issue (MCP)")
 * @returns The display name without server prefix and (MCP) suffix
 */
export function extractMcpToolDisplayName(userFacingName: string): string {
// 注释自嘲「really ugly」，它确实是全文件最脏的一处：从**显示名**反推**工具名**，
// 数据流是反的。
//
// 根因在 Tool 类型上：只有一个 userFacingName，而 UI 在不同位置需要不同粒度
// （菜单里要短名、权限提示里要带 server 与 MCP 标记）。于是信息被编码进字符串
// （"server - tool (MCP)"），再由这里拆回来。
//
// 读这段的正确姿势：不要评价它丑，要看出「类型不够用 → 用字符串补」这个模式，
// 以及它必然带来的脆弱性（server 名里带 " - " 就拆错）。
  // This is really ugly but our current Tool type doesn't make it easy to have different display names for different purposes.

  // First, remove the (MCP) suffix if present
  let withoutSuffix = userFacingName.replace(/\s*\(MCP\)\s*$/, '')

  // Trim the result
  withoutSuffix = withoutSuffix.trim()

  // Then, remove the server prefix (everything before " - ")
  const dashIndex = withoutSuffix.indexOf(' - ')
  if (dashIndex !== -1) {
    const displayName = withoutSuffix.substring(dashIndex + 3).trim()
    return displayName
  }

  // If no dash found, return the string without (MCP)
  return withoutSuffix
}
