import { relative } from 'path'
import type {
  CallHierarchyIncomingCall,
  CallHierarchyItem,
  CallHierarchyOutgoingCall,
  DocumentSymbol,
  Hover,
  Location,
  LocationLink,
  MarkedString,
  MarkupContent,
  SymbolInformation,
  SymbolKind,
} from 'vscode-languageserver-types'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import { plural } from '../../utils/stringUtils.js'

/**
 * Formats a URI by converting it to a relative path if possible.
 * Handles URI decoding and gracefully falls back to un-decoded path if malformed.
 * Only uses relative paths when shorter and not starting with ../../
 */
// formatUri 是所有格式化器的公共出口：剥 file:// 协议、修 Windows 盘符斜杠、URI 解码容错、转相对路径。转相对路径有双条件：必须更短、且不能以多级向上（三个点以上）开头——跨目录的相对引用反而更难读。
function formatUri(uri: string | undefined, cwd?: string): string {
  // Handle undefined/null URIs - this indicates malformed LSP data
  if (!uri) {
    // NOTE: This should ideally be caught earlier with proper error logging
    // This is a defensive backstop in the formatting layer
    logForDebugging(
      'formatUri called with undefined URI - indicates malformed LSP server response',
      { level: 'warn' },
    )
    return '<unknown location>'
  }
// undefined URI 说明 LSP 服务器返回了畸形数据——格式化层兜底显示占位符而不是崩掉，同时 warn 日志留痕。这一层的防御性检查是「应该更早被拦」的第三道保险。

  // Remove file:// protocol if present
  // On Windows, file:///C:/path becomes /C:/path after replacing file://
  // We need to strip the leading slash for Windows drive-letter paths
  let filePath = uri.replace(/^file:\/\//, '')
  if (/^\/[A-Za-z]:/.test(filePath)) {
    filePath = filePath.slice(1)
  }

  // Decode URI encoding - handle malformed URIs gracefully
  try {
    filePath = decodeURIComponent(filePath)
  } catch (error) {
    // Log for debugging but continue with un-decoded path
    const errorMsg = errorMessage(error)
    logForDebugging(
      `Failed to decode LSP URI '${uri}': ${errorMsg}. Using un-decoded path: ${filePath}`,
      { level: 'warn' },
    )
    // filePath already contains the un-decoded path, which is still usable
  }

  // Convert to relative path if cwd is provided
  if (cwd) {
    // Normalize separators to forward slashes for consistent display output
    const relativePath = relative(cwd, filePath).replaceAll('\\', '/')
    // Only use relative path if it's shorter and doesn't start with ../..
    if (
      relativePath.length < filePath.length &&
      !relativePath.startsWith('../../')
    ) {
      return relativePath
    }
  }

  // Normalize separators to forward slashes for consistent display output
  return filePath.replaceAll('\\', '/')
}

/**
 * Groups items by their file URI.
 * Generic helper that works with both Location[] and SymbolInformation[]
 */
function groupByFile<T extends { uri: string } | { location: { uri: string } }>(
  items: T[],
  cwd?: string,
): Map<string, T[]> {
  const byFile = new Map<string, T[]>()
  for (const item of items) {
    const uri = 'uri' in item ? item.uri : item.location.uri
    const filePath = formatUri(uri, cwd)
    const existingItems = byFile.get(filePath)
    if (existingItems) {
      existingItems.push(item)
    } else {
      byFile.set(filePath, [item])
    }
  }
  return byFile
}
// groupByFile 用「有没有 uri 字段」同时吃 Location[] 与 SymbolInformation[] 两种形态——泛型加 in 判别，不需要继承体系。

/**
 * Formats a Location with file path and line/character position
 */
function formatLocation(location: Location, cwd?: string): string {
  const filePath = formatUri(location.uri, cwd)
  const line = location.range.start.line + 1 // Convert to 1-based
  const character = location.range.start.character + 1 // Convert to 1-based
  return `${filePath}:${line}:${character}`
}

/**
 * Converts LocationLink to Location format for consistent handling
 */
function locationLinkToLocation(link: LocationLink): Location {
  return {
    uri: link.targetUri,
    range: link.targetSelectionRange || link.targetRange,
  }
}

/**
 * Checks if an object is a LocationLink (has targetUri) vs Location (has uri)
 */
function isLocationLink(item: Location | LocationLink): item is LocationLink {
  return 'targetUri' in item
}
// 与 LSPTool.ts 里同名的 isLocationLink 在此重复定义——格式化层与工具层各自独立做判别，不共享。本地五行的复制比跨模块耦合便宜。

/**
 * Formats goToDefinition result
 * Can return Location, LocationLink, or arrays of either
 */
export function formatGoToDefinitionResult(
  result: Location | Location[] | LocationLink | LocationLink[] | null,
  cwd?: string,
): string {
  if (!result) {
    return 'No definition found. This may occur if the cursor is not on a symbol, or if the definition is in an external library not indexed by the LSP server.'
  }
// 所有「空结果」消息都解释可能原因（光标不在符号上、外部库未被索引）——模型拿到这种消息能自行决定换位置重试，而不是当成工具故障上报。

  if (Array.isArray(result)) {
    // Convert LocationLinks to Locations for uniform handling
    const locations: Location[] = result.map(item =>
      isLocationLink(item) ? locationLinkToLocation(item) : item,
    )

    // Log and filter out any locations with undefined uris
    const invalidLocations = locations.filter(loc => !loc || !loc.uri)
    if (invalidLocations.length > 0) {
      logForDebugging(
        `formatGoToDefinitionResult: Filtering out ${invalidLocations.length} invalid location(s) - this should have been caught earlier`,
        { level: 'warn' },
      )
    }

    const validLocations = locations.filter(loc => loc && loc.uri)

    if (validLocations.length === 0) {
      return 'No definition found. This may occur if the cursor is not on a symbol, or if the definition is in an external library not indexed by the LSP server.'
    }
    if (validLocations.length === 1) {
      return `Defined in ${formatLocation(validLocations[0]!, cwd)}`
    }
    const locationList = validLocations
      .map(loc => `  ${formatLocation(loc, cwd)}`)
      .join('\n')
    return `Found ${validLocations.length} definitions:\n${locationList}`
  }

  // Single result - convert LocationLink if needed
  const location = isLocationLink(result)
    ? locationLinkToLocation(result)
    : result
  return `Defined in ${formatLocation(location, cwd)}`
}

/**
 * Formats findReferences result
 */
export function formatFindReferencesResult(
  result: Location[] | null,
  cwd?: string,
): string {
  if (!result || result.length === 0) {
    return 'No references found. This may occur if the symbol has no usages, or if the LSP server has not fully indexed the workspace.'
  }

  // Log and filter out any locations with undefined uris
  const invalidLocations = result.filter(loc => !loc || !loc.uri)
  if (invalidLocations.length > 0) {
    logForDebugging(
      `formatFindReferencesResult: Filtering out ${invalidLocations.length} invalid location(s) - this should have been caught earlier`,
      { level: 'warn' },
    )
  }

  const validLocations = result.filter(loc => loc && loc.uri)

  if (validLocations.length === 0) {
    return 'No references found. This may occur if the symbol has no usages, or if the LSP server has not fully indexed the workspace.'
  }

  if (validLocations.length === 1) {
    return `Found 1 reference:\n  ${formatLocation(validLocations[0]!, cwd)}`
  }

  // Group references by file
  const byFile = groupByFile(validLocations, cwd)

  const lines: string[] = [
    `Found ${validLocations.length} references across ${byFile.size} files:`,
  ]

  for (const [filePath, locations] of byFile) {
    lines.push(`\n${filePath}:`)
    for (const loc of locations) {
      const line = loc.range.start.line + 1
      const character = loc.range.start.character + 1
      lines.push(`  Line ${line}:${character}`)
    }
  }

  return lines.join('\n')
// 多文件引用按文件分组渲染：文件名一行、行号缩进列表——避免同文件路径重复刷屏，模型按文件跳转也更自然。
}

/**
 * Extracts text content from MarkupContent or MarkedString
 */
function extractMarkupText(
  contents: MarkupContent | MarkedString | MarkedString[],
): string {
  if (Array.isArray(contents)) {
    return contents
      .map(item => {
        if (typeof item === 'string') {
          return item
        }
        return item.value
      })
      .join('\n\n')
  }

  if (typeof contents === 'string') {
    return contents
  }

  if ('kind' in contents) {
    // MarkupContent
    return contents.value
  }
// hover 内容有三种形态：字符串数组、纯字符串、MarkupContent 或 MarkedString 对象——LSP 规范的历史包袱，extractMarkupText 一一拆包后拼接。

  // MarkedString object
  return contents.value
}

/**
 * Formats hover result
 */
export function formatHoverResult(result: Hover | null, _cwd?: string): string {
  if (!result) {
    return 'No hover information available. This may occur if the cursor is not on a symbol, or if the LSP server has not fully indexed the file.'
  }

  const content = extractMarkupText(result.contents)

  if (result.range) {
    const line = result.range.start.line + 1
    const character = result.range.start.character + 1
    return `Hover info at ${line}:${character}:\n\n${content}`
  }

  return content
}

/**
 * Maps SymbolKind enum to readable string
 */
function symbolKindToString(kind: SymbolKind): string {
  const kinds: Record<SymbolKind, string> = {
    [1]: 'File',
    [2]: 'Module',
    [3]: 'Namespace',
    [4]: 'Package',
    [5]: 'Class',
    [6]: 'Method',
    [7]: 'Property',
    [8]: 'Field',
    [9]: 'Constructor',
    [10]: 'Enum',
    [11]: 'Interface',
    [12]: 'Function',
    [13]: 'Variable',
    [14]: 'Constant',
    [15]: 'String',
    [16]: 'Number',
    [17]: 'Boolean',
    [18]: 'Array',
    [19]: 'Object',
    [20]: 'Key',
    [21]: 'Null',
    [22]: 'EnumMember',
    [23]: 'Struct',
    [24]: 'Event',
    [25]: 'Operator',
    [26]: 'TypeParameter',
  }
  return kinds[kind] || 'Unknown'
}
// 26 种 SymbolKind 手工映射成可读名——LSP 用数字枚举，直出数字对模型毫无信息量。

/**
 * Formats a single DocumentSymbol with indentation
 */
function formatDocumentSymbolNode(
  symbol: DocumentSymbol,
  indent: number = 0,
): string[] {
  const lines: string[] = []
  const prefix = '  '.repeat(indent)
  const kind = symbolKindToString(symbol.kind)

  let line = `${prefix}${symbol.name} (${kind})`
  if (symbol.detail) {
    line += ` ${symbol.detail}`
  }

  const symbolLine = symbol.range.start.line + 1
  line += ` - Line ${symbolLine}`

  lines.push(line)

  // Recursively format children
  if (symbol.children && symbol.children.length > 0) {
    for (const child of symbol.children) {
      lines.push(...formatDocumentSymbolNode(child, indent + 1))
    }
  }

  return lines
}

/**
 * Formats documentSymbol result (hierarchical outline)
 * Handles both DocumentSymbol[] (hierarchical, with range) and SymbolInformation[] (flat, with location.range)
 * per LSP spec which allows textDocument/documentSymbol to return either format
 */
export function formatDocumentSymbolResult(
  result: DocumentSymbol[] | SymbolInformation[] | null,
  cwd?: string,
): string {
  if (!result || result.length === 0) {
    return 'No symbols found in document. This may occur if the file is empty, not supported by the LSP server, or if the server has not fully indexed the file.'
  }

  // Detect format: DocumentSymbol has 'range' directly, SymbolInformation has 'location.range'
  // Check the first valid element to determine format
  const firstSymbol = result[0]
  const isSymbolInformation = firstSymbol && 'location' in firstSymbol

  if (isSymbolInformation) {
    // Delegate to workspace symbol formatter which handles SymbolInformation[]
    return formatWorkspaceSymbolResult(result as SymbolInformation[], cwd)
  }
// documentSymbol 若返回扁平格式，直接复用 workspaceSymbol 的格式化器——同一种数据形态只写一份渲染逻辑。

  // Handle DocumentSymbol[] format (hierarchical)
  const lines: string[] = ['Document symbols:']

  for (const symbol of result as DocumentSymbol[]) {
    lines.push(...formatDocumentSymbolNode(symbol))
  }

  return lines.join('\n')
}

/**
 * Formats workspaceSymbol result (flat list of symbols)
 */
export function formatWorkspaceSymbolResult(
  result: SymbolInformation[] | null,
  cwd?: string,
): string {
  if (!result || result.length === 0) {
    return 'No symbols found in workspace. This may occur if the workspace is empty, or if the LSP server has not finished indexing the project.'
  }

  // Log and filter out any symbols with undefined location.uri
  const invalidSymbols = result.filter(
    sym => !sym || !sym.location || !sym.location.uri,
  )
  if (invalidSymbols.length > 0) {
    logForDebugging(
      `formatWorkspaceSymbolResult: Filtering out ${invalidSymbols.length} invalid symbol(s) - this should have been caught earlier`,
      { level: 'warn' },
    )
  }

  const validSymbols = result.filter(
    sym => sym && sym.location && sym.location.uri,
  )

  if (validSymbols.length === 0) {
    return 'No symbols found in workspace. This may occur if the workspace is empty, or if the LSP server has not finished indexing the project.'
  }

  const lines: string[] = [
    `Found ${validSymbols.length} ${plural(validSymbols.length, 'symbol')} in workspace:`,
  ]

  // Group by file
  const byFile = groupByFile(validSymbols, cwd)

  for (const [filePath, symbols] of byFile) {
    lines.push(`\n${filePath}:`)
    for (const symbol of symbols) {
      const kind = symbolKindToString(symbol.kind)
      const line = symbol.location.range.start.line + 1
      let symbolLine = `  ${symbol.name} (${kind}) - Line ${line}`

      // Add container name if available
      if (symbol.containerName) {
        symbolLine += ` in ${symbol.containerName}`
      }

      lines.push(symbolLine)
    }
  }

  return lines.join('\n')
}

/**
 * Formats a CallHierarchyItem with its location
 * Validates URI before formatting to handle malformed LSP data
 */
function formatCallHierarchyItem(
  item: CallHierarchyItem,
  cwd?: string,
): string {
  // Validate URI - handle undefined/null gracefully
  if (!item.uri) {
    logForDebugging(
      'formatCallHierarchyItem: CallHierarchyItem has undefined URI',
      { level: 'warn' },
    )
    return `${item.name} (${symbolKindToString(item.kind)}) - <unknown location>`
  }

  const filePath = formatUri(item.uri, cwd)
  const line = item.range.start.line + 1
  const kind = symbolKindToString(item.kind)
  let result = `${item.name} (${kind}) - ${filePath}:${line}`
  if (item.detail) {
    result += ` [${item.detail}]`
  }
  return result
// CallHierarchyItem 的 URI 也要校验——畸形数据下显示名字与类型、位置用占位符，不丢整条记录。
}

/**
 * Formats prepareCallHierarchy result
 * Returns the call hierarchy item(s) at the given position
 */
export function formatPrepareCallHierarchyResult(
  result: CallHierarchyItem[] | null,
  cwd?: string,
): string {
  if (!result || result.length === 0) {
    return 'No call hierarchy item found at this position'
  }

  if (result.length === 1) {
    return `Call hierarchy item: ${formatCallHierarchyItem(result[0]!, cwd)}`
  }

  const lines = [`Found ${result.length} call hierarchy items:`]
  for (const item of result) {
    lines.push(`  ${formatCallHierarchyItem(item, cwd)}`)
  }
  return lines.join('\n')
}

/**
 * Formats incomingCalls result
 * Shows all functions/methods that call the target
 */
export function formatIncomingCallsResult(
  result: CallHierarchyIncomingCall[] | null,
  cwd?: string,
): string {
  if (!result || result.length === 0) {
    return 'No incoming calls found (nothing calls this function)'
  }

  const lines = [
    `Found ${result.length} incoming ${plural(result.length, 'call')}:`,
  ]

  // Group by file
  const byFile = new Map<string, CallHierarchyIncomingCall[]>()
  for (const call of result) {
    if (!call.from) {
      logForDebugging(
        'formatIncomingCallsResult: CallHierarchyIncomingCall has undefined from field',
        { level: 'warn' },
      )
      continue
    }
    const filePath = formatUri(call.from.uri, cwd)
    const existing = byFile.get(filePath)
    if (existing) {
      existing.push(call)
    } else {
      byFile.set(filePath, [call])
    }
  }

  for (const [filePath, calls] of byFile) {
    lines.push(`\n${filePath}:`)
    for (const call of calls) {
      if (!call.from) {
        continue // Already logged above
      }
      const kind = symbolKindToString(call.from.kind)
      const line = call.from.range.start.line + 1
      let callLine = `  ${call.from.name} (${kind}) - Line ${line}`

      // Show call sites within the caller
      if (call.fromRanges && call.fromRanges.length > 0) {
        const callSites = call.fromRanges
          .map(r => `${r.start.line + 1}:${r.start.character + 1}`)
          .join(', ')
        callLine += ` [calls at: ${callSites}]`
      }
// fromRanges 显示调用点坐标——「谁调用了它」之外还给「在哪里调用」，模型能直接跳到调用现场。incoming 用 calls at、outgoing 用 called from，方向措辞跟着语义走。

      lines.push(callLine)
    }
  }

  return lines.join('\n')
}

/**
 * Formats outgoingCalls result
 * Shows all functions/methods called by the target
 */
export function formatOutgoingCallsResult(
  result: CallHierarchyOutgoingCall[] | null,
  cwd?: string,
): string {
  if (!result || result.length === 0) {
    return 'No outgoing calls found (this function calls nothing)'
  }

  const lines = [
    `Found ${result.length} outgoing ${plural(result.length, 'call')}:`,
  ]

  // Group by file
  const byFile = new Map<string, CallHierarchyOutgoingCall[]>()
  for (const call of result) {
    if (!call.to) {
      logForDebugging(
        'formatOutgoingCallsResult: CallHierarchyOutgoingCall has undefined to field',
        { level: 'warn' },
      )
      continue
    }
    const filePath = formatUri(call.to.uri, cwd)
    const existing = byFile.get(filePath)
    if (existing) {
      existing.push(call)
    } else {
      byFile.set(filePath, [call])
    }
  }

  for (const [filePath, calls] of byFile) {
    lines.push(`\n${filePath}:`)
    for (const call of calls) {
      if (!call.to) {
        continue // Already logged above
      }
      const kind = symbolKindToString(call.to.kind)
      const line = call.to.range.start.line + 1
      let callLine = `  ${call.to.name} (${kind}) - Line ${line}`

      // Show call sites within the current function
      if (call.fromRanges && call.fromRanges.length > 0) {
        const callSites = call.fromRanges
          .map(r => `${r.start.line + 1}:${r.start.character + 1}`)
          .join(', ')
        callLine += ` [called from: ${callSites}]`
      }

      lines.push(callLine)
    }
  }

  return lines.join('\n')
}
