import { open } from 'fs/promises'
import * as path from 'path'
import { pathToFileURL } from 'url'
import type {
  CallHierarchyIncomingCall,
  CallHierarchyItem,
  CallHierarchyOutgoingCall,
  DocumentSymbol,
  Hover,
  Location,
  LocationLink,
  SymbolInformation,
} from 'vscode-languageserver-types'
import { z } from 'zod/v4'
import {
  getInitializationStatus,
  getLspServerManager,
  isLspConnected,
  waitForInitialization,
} from '../../services/lsp/manager.js'
import type { ValidationResult } from '../../Tool.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { uniq } from '../../utils/array.js'
import { getCwd } from '../../utils/cwd.js'
import { logForDebugging } from '../../utils/debug.js'
import { isENOENT, toError } from '../../utils/errors.js'
import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
import { getFsImplementation } from '../../utils/fsOperations.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { logError } from '../../utils/log.js'
import { expandPath } from '../../utils/path.js'
import { checkReadPermissionForTool } from '../../utils/permissions/filesystem.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import {
  formatDocumentSymbolResult,
  formatFindReferencesResult,
  formatGoToDefinitionResult,
  formatHoverResult,
  formatIncomingCallsResult,
  formatOutgoingCallsResult,
  formatPrepareCallHierarchyResult,
  formatWorkspaceSymbolResult,
} from './formatters.js'
import { DESCRIPTION, LSP_TOOL_NAME } from './prompt.js'
import { lspToolInputSchema } from './schemas.js'
import {
  renderToolResultMessage,
  renderToolUseErrorMessage,
  renderToolUseMessage,
  userFacingName,
} from './UI.js'

const MAX_LSP_FILE_SIZE_BYTES = 10_000_000
// 10MB 上限：LSP 服务器解析超大文件会拖垮内存，在打开文件之前就拒绝，错误信息里直接带上实际大小。

/**
 * Tool-compatible input schema (regular ZodObject instead of discriminated union)
 * We validate against the discriminated union in validateInput for better error messages
 */
// 双 schema 设计：这里的普通 strictObject 只是工具框架的兼容壳（框架不支持判别联合）；真正的校验在 validateInput 里用 schemas.ts 的判别联合重跑一遍，换取按 operation 分化的精确错误信息。
const inputSchema = lazySchema(() =>
  z.strictObject({
    operation: z
      .enum([
        'goToDefinition',
        'findReferences',
        'hover',
        'documentSymbol',
        'workspaceSymbol',
        'goToImplementation',
        'prepareCallHierarchy',
        'incomingCalls',
        'outgoingCalls',
      ])
      .describe('The LSP operation to perform'),
    filePath: z.string().describe('The absolute or relative path to the file'),
    line: z
      .number()
      .int()
      .positive()
      .describe('The line number (1-based, as shown in editors)'),
    character: z
      .number()
      .int()
      .positive()
      .describe('The character offset (1-based, as shown in editors)'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    operation: z
      .enum([
        'goToDefinition',
        'findReferences',
        'hover',
        'documentSymbol',
        'workspaceSymbol',
        'goToImplementation',
        'prepareCallHierarchy',
        'incomingCalls',
        'outgoingCalls',
      ])
      .describe('The LSP operation that was performed'),
    result: z.string().describe('The formatted result of the LSP operation'),
    filePath: z
      .string()
      .describe('The file path the operation was performed on'),
    resultCount: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('Number of results (definitions, references, symbols)'),
    fileCount: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('Number of files containing results'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>
export type Input = z.infer<InputSchema>

export const LSPTool = buildTool({
  name: LSP_TOOL_NAME,
  searchHint: 'code intelligence (definitions, references, symbols, hover)',
  maxResultSizeChars: 100_000,
  isLsp: true,
  async description() {
    return DESCRIPTION
  },
  userFacingName,
  shouldDefer: true,
// shouldDefer 为真：LSP 服务器首次调用可能要等初始化，标记为可延迟让调度器把它排进非紧急批次，避免空转等待卡住主流程。
  isEnabled() {
    return isLspConnected()
  },
// isEnabled 跟着 LSP 连接状态走——没配置任何服务器时这个工具从工具列表里整个消失，而不是让模型调用后吃报错。
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  getPath({ filePath }): string {
    return expandPath(filePath)
  },
  async validateInput(input: Input): Promise<ValidationResult> {
    // First validate against the discriminated union for better type safety
    const parseResult = lspToolInputSchema().safeParse(input)
    if (!parseResult.success) {
      return {
        result: false,
        message: `Invalid input: ${parseResult.error.message}`,
        errorCode: 3,
      }
    }

    // Validate file exists and is a regular file
    const fs = getFsImplementation()
    const absolutePath = expandPath(input.filePath)

    // SECURITY: Skip filesystem operations for UNC paths to prevent NTLM credential leaks.
    if (absolutePath.startsWith('\\\\') || absolutePath.startsWith('//')) {
      return { result: true }
    }
// 与 FileEditTool 同款的安全短路：UNC 路径（双反斜杠或双正斜杠开头的网络共享）跳过一切 fs 操作，防止 stat 触发 SMB NTLM 凭据外泄；这里直接放行，留给 call 阶段处理。

    let stats
    try {
      stats = await fs.stat(absolutePath)
    } catch (error) {
      if (isENOENT(error)) {
        return {
          result: false,
          message: `File does not exist: ${input.filePath}`,
          errorCode: 1,
        }
      }
      const err = toError(error)
      // Log filesystem access errors for tracking
      logError(
        new Error(
          `Failed to access file stats for LSP operation on ${input.filePath}: ${err.message}`,
        ),
      )
      return {
        result: false,
        message: `Cannot access file: ${input.filePath}. ${err.message}`,
        errorCode: 4,
      }
    }

    if (!stats.isFile()) {
      return {
        result: false,
        message: `Path is not a file: ${input.filePath}`,
        errorCode: 2,
      }
    }

    return { result: true }
  },
  async checkPermissions(input, context): Promise<PermissionDecision> {
    const appState = context.getAppState()
    return checkReadPermissionForTool(
      LSPTool,
      input,
      appState.toolPermissionContext,
    )
  },
  async prompt() {
    return DESCRIPTION
  },
  renderToolUseMessage,
  renderToolUseErrorMessage,
  renderToolResultMessage,
  async call(input: Input, _context) {
    const absolutePath = expandPath(input.filePath)
    const cwd = getCwd()

    // Wait for initialization if it's still pending
    // This prevents returning "no server available" before init completes
    const status = getInitializationStatus()
    if (status.status === 'pending') {
      await waitForInitialization()
    }
// 调用前先等初始化完成——否则 LSP 服务器还在启动时会得到「无可用服务器」的假阴性结果，模型可能据此错误地放弃代码智能查询。

    // Get the LSP server manager
    const manager = getLspServerManager()
    if (!manager) {
      // Log this system-level failure for tracking
      logError(
        new Error('LSP server manager not initialized when tool was called'),
      )

      const output: Output = {
        operation: input.operation,
        result:
          'LSP server manager not initialized. This may indicate a startup issue.',
        filePath: input.filePath,
      }
      return {
        data: output,
      }
    }

    // Map operation to LSP method and prepare params
    const { method, params } = getMethodAndParams(input, absolutePath)

    try {
      // Ensure file is open in LSP server before making requests
      // Most LSP servers require textDocument/didOpen before operations
      // Only read the file if it's not already open to avoid unnecessary I/O
      if (!manager.isFileOpen(absolutePath)) {
        const handle = await open(absolutePath, 'r')
        try {
          const stats = await handle.stat()
          if (stats.size > MAX_LSP_FILE_SIZE_BYTES) {
            const output: Output = {
              operation: input.operation,
              result: `File too large for LSP analysis (${Math.ceil(stats.size / 1_000_000)}MB exceeds 10MB limit)`,
              filePath: input.filePath,
            }
            return { data: output }
          }
          const fileContent = await handle.readFile({ encoding: 'utf-8' })
          await manager.openFile(absolutePath, fileContent)
        } finally {
          await handle.close()
        }
      }
// 大多数 LSP 服务器要求先 didOpen 才能查询。文件未打开才读盘（避免无谓 I/O），读完立即 close 句柄；超过 10MB 的文件在这里被拦下。

      // Send request to LSP server
      let result = await manager.sendRequest(absolutePath, method, params)

      if (result === undefined) {
        // Log for diagnostic purposes - helps track usage patterns and potential bugs
        logForDebugging(
          `No LSP server available for file type ${path.extname(absolutePath)} for operation ${input.operation} on file ${input.filePath}`,
        )

        const output: Output = {
          operation: input.operation,
          result: `No LSP server available for file type: ${path.extname(absolutePath)}`,
          filePath: input.filePath,
        }
        return {
          data: output,
        }
      }
// sendRequest 返回 undefined 说明该文件类型没有对应的 LSP 服务器——记 debug 日志后返回带扩展名的提示，让模型知道要配置服务器，而不是把空结果当成「没有定义」。

      // For incomingCalls and outgoingCalls, we need a two-step process:
      // 1. First get CallHierarchyItem(s) from prepareCallHierarchy
      // 2. Then request the actual calls using that item
      if (
        input.operation === 'incomingCalls' ||
        input.operation === 'outgoingCalls'
      ) {
        const callItems = result as CallHierarchyItem[]
        if (!callItems || callItems.length === 0) {
          const output: Output = {
            operation: input.operation,
            result: 'No call hierarchy item found at this position',
            filePath: input.filePath,
            resultCount: 0,
            fileCount: 0,
          }
          return { data: output }
        }

        // Use the first call hierarchy item to request calls
        const callMethod =
          input.operation === 'incomingCalls'
            ? 'callHierarchy/incomingCalls'
            : 'callHierarchy/outgoingCalls'

        result = await manager.sendRequest(absolutePath, callMethod, {
          item: callItems[0],
        })

        if (result === undefined) {
          logForDebugging(
            `LSP server returned undefined for ${callMethod} on ${input.filePath}`,
          )
          // Continue to formatter which will handle empty/null gracefully
        }
      }
// incoming/outgoing 是两段式：先用 prepareCallHierarchy 拿 CallHierarchyItem，再拿第一个 item 请求真正的调用列表——LSP 协议把这两步拆成两个方法，工具在这里替模型串起来。第二步 undefined 时不报错，交给格式化层优雅处理空值。

      // Filter out gitignored files from location-based results
      if (
        result &&
        Array.isArray(result) &&
        (input.operation === 'findReferences' ||
          input.operation === 'goToDefinition' ||
          input.operation === 'goToImplementation' ||
          input.operation === 'workspaceSymbol')
      ) {
        if (input.operation === 'workspaceSymbol') {
          // SymbolInformation has location.uri — filter by extracting locations
          const symbols = result as SymbolInformation[]
          const locations = symbols
            .filter(s => s?.location?.uri)
            .map(s => s.location)
          const filteredLocations = await filterGitIgnoredLocations(
            locations,
            cwd,
          )
          const filteredUris = new Set(filteredLocations.map(l => l.uri))
          result = symbols.filter(
            s => !s?.location?.uri || filteredUris.has(s.location.uri),
          )
        } else {
          // Location[] or (Location | LocationLink)[]
          const locations = (result as (Location | LocationLink)[]).map(
            toLocation,
          )
          const filteredLocations = await filterGitIgnoredLocations(
            locations,
            cwd,
          )
          const filteredUris = new Set(filteredLocations.map(l => l.uri))
          result = (result as (Location | LocationLink)[]).filter(item => {
            const loc = toLocation(item)
            return !loc.uri || filteredUris.has(loc.uri)
          })
        }
      }
// findReferences/goToDefinition/goToImplementation/workspaceSymbol 四种位置结果统一过一道 git check-ignore 过滤——node_modules 这类被忽略目录里的第三方定义与引用不该出现在结果里。

      // Format the result based on operation type
      const { formatted, resultCount, fileCount } = formatResult(
        input.operation,
        result,
        cwd,
      )

      const output: Output = {
        operation: input.operation,
        result: formatted,
        filePath: input.filePath,
        resultCount,
        fileCount,
      }

      return {
        data: output,
      }
    } catch (error) {
      const err = toError(error)
      const errorMessage = err.message

      // Log error for tracking
      logError(
        new Error(
          `LSP tool request failed for ${input.operation} on ${input.filePath}: ${errorMessage}`,
        ),
      )

      const output: Output = {
        operation: input.operation,
        result: `Error performing ${input.operation}: ${errorMessage}`,
        filePath: input.filePath,
      }
      return {
        data: output,
      }
    }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: output.result,
    }
  },
} satisfies ToolDef<InputSchema, Output>)

/**
 * Maps LSPTool operation to LSP method and params
 */
function getMethodAndParams(
  input: Input,
  absolutePath: string,
): { method: string; params: unknown } {
  const uri = pathToFileURL(absolutePath).href
  // Convert from 1-based (user-friendly) to 0-based (LSP protocol)
  const position = {
    line: input.line - 1,
    character: input.character - 1,
  }

  switch (input.operation) {
    case 'goToDefinition':
      return {
        method: 'textDocument/definition',
        params: {
          textDocument: { uri },
          position,
        },
      }
    case 'findReferences':
      return {
        method: 'textDocument/references',
        params: {
          textDocument: { uri },
          position,
          context: { includeDeclaration: true },
        },
      }
    case 'hover':
      return {
        method: 'textDocument/hover',
        params: {
          textDocument: { uri },
          position,
        },
      }
    case 'documentSymbol':
      return {
        method: 'textDocument/documentSymbol',
        params: {
          textDocument: { uri },
        },
      }
    case 'workspaceSymbol':
      return {
        method: 'workspace/symbol',
        params: {
          query: '', // Empty query returns all symbols
        },
      }
    case 'goToImplementation':
      return {
        method: 'textDocument/implementation',
        params: {
          textDocument: { uri },
          position,
        },
      }
    case 'prepareCallHierarchy':
      return {
        method: 'textDocument/prepareCallHierarchy',
        params: {
          textDocument: { uri },
          position,
        },
      }
    case 'incomingCalls':
      // For incoming/outgoing calls, we first need to prepare the call hierarchy
      // The LSP server will return CallHierarchyItem(s) that we pass to the calls request
      return {
        method: 'textDocument/prepareCallHierarchy',
        params: {
          textDocument: { uri },
          position,
        },
      }
    case 'outgoingCalls':
      return {
        method: 'textDocument/prepareCallHierarchy',
        params: {
          textDocument: { uri },
          position,
        },
      }
  }
}

/**
 * Counts the total number of symbols including nested children
 */
function countSymbols(symbols: DocumentSymbol[]): number {
  let count = symbols.length
  for (const symbol of symbols) {
    if (symbol.children && symbol.children.length > 0) {
      count += countSymbols(symbol.children)
    }
  }
  return count
}

/**
 * Counts unique files from an array of locations
 */
function countUniqueFiles(locations: Location[]): number {
  return new Set(locations.map(loc => loc.uri)).size
}

/**
 * Extracts a file path from a file:// URI, decoding percent-encoded characters.
 */
function uriToFilePath(uri: string): string {
  let filePath = uri.replace(/^file:\/\//, '')
  // On Windows, file:///C:/path becomes /C:/path — strip the leading slash
  if (/^\/[A-Za-z]:/.test(filePath)) {
    filePath = filePath.slice(1)
  }
  try {
    filePath = decodeURIComponent(filePath)
  } catch {
    // Use un-decoded path if malformed
  }
  return filePath
}

/**
 * Filters out locations whose file paths are gitignored.
 * Uses `git check-ignore` with batched path arguments for efficiency.
 */
async function filterGitIgnoredLocations<T extends Location>(
  locations: T[],
  cwd: string,
): Promise<T[]> {
  if (locations.length === 0) {
    return locations
  }

  // Collect unique file paths from URIs
  const uriToPath = new Map<string, string>()
  for (const loc of locations) {
    if (loc.uri && !uriToPath.has(loc.uri)) {
      uriToPath.set(loc.uri, uriToFilePath(loc.uri))
    }
  }

  const uniquePaths = uniq(uriToPath.values())
  if (uniquePaths.length === 0) {
    return locations
  }

  // Batch check paths with git check-ignore
  // Exit code 0 = at least one path is ignored, 1 = none ignored, 128 = not a git repo
  const ignoredPaths = new Set<string>()
  const BATCH_SIZE = 50
  for (let i = 0; i < uniquePaths.length; i += BATCH_SIZE) {
    const batch = uniquePaths.slice(i, i + BATCH_SIZE)
    const result = await execFileNoThrowWithCwd(
      'git',
      ['check-ignore', ...batch],
      {
        cwd,
        preserveOutputOnError: false,
        timeout: 5_000,
      },
    )

    if (result.code === 0 && result.stdout) {
      for (const line of result.stdout.split('\n')) {
        const trimmed = line.trim()
        if (trimmed) {
          ignoredPaths.add(trimmed)
        }
      }
    }
  }
// git check-ignore 按 50 路径一批跑（防命令行超长），5 秒超时。退出码语义：0=至少一个被忽略，1=无忽略，128=不是 git 仓库——非仓库环境静默跳过过滤，不报错。

  if (ignoredPaths.size === 0) {
    return locations
  }

  return locations.filter(loc => {
    const filePath = uriToPath.get(loc.uri)
    return !filePath || !ignoredPaths.has(filePath)
  })
}

/**
 * Checks if item is LocationLink (has targetUri) vs Location (has uri)
 */
function isLocationLink(item: Location | LocationLink): item is LocationLink {
  return 'targetUri' in item
}

/**
 * Converts LocationLink to Location format for uniform handling
 */
function toLocation(item: Location | LocationLink): Location {
  if (isLocationLink(item)) {
    return {
      uri: item.targetUri,
      range: item.targetSelectionRange || item.targetRange,
    }
  }
  return item
}
// LocationLink 与 Location 的判别只看有没有 targetUri 字段；转换时优先 targetSelectionRange（符号实际被选中处），退化到 targetRange。

/**
 * Formats LSP result based on operation type and extracts summary counts
 */
function formatResult(
  operation: Input['operation'],
  result: unknown,
  cwd: string,
): { formatted: string; resultCount: number; fileCount: number } {
  switch (operation) {
    case 'goToDefinition': {
      // Handle both Location and LocationLink formats
      const rawResults = Array.isArray(result)
        ? result
        : result
          ? [result as Location | LocationLink]
          : []

      // Convert LocationLinks to Locations for uniform handling
      const locations = rawResults.map(toLocation)

      // Log and filter out locations with undefined uris
      const invalidLocations = locations.filter(loc => !loc || !loc.uri)
      if (invalidLocations.length > 0) {
        logError(
          new Error(
            `LSP server returned ${invalidLocations.length} location(s) with undefined URI for goToDefinition on ${cwd}. ` +
              `This indicates malformed data from the LSP server.`,
          ),
        )
      }

      const validLocations = locations.filter(loc => loc && loc.uri)
      return {
        formatted: formatGoToDefinitionResult(
          result as
            | Location
            | Location[]
            | LocationLink
            | LocationLink[]
            | null,
          cwd,
        ),
        resultCount: validLocations.length,
        fileCount: countUniqueFiles(validLocations),
      }
    }
    case 'findReferences': {
      const locations = (result as Location[]) || []

      // Log and filter out locations with undefined uris
      const invalidLocations = locations.filter(loc => !loc || !loc.uri)
      if (invalidLocations.length > 0) {
        logError(
          new Error(
            `LSP server returned ${invalidLocations.length} location(s) with undefined URI for findReferences on ${cwd}. ` +
              `This indicates malformed data from the LSP server.`,
          ),
        )
      }

      const validLocations = locations.filter(loc => loc && loc.uri)
      return {
        formatted: formatFindReferencesResult(result as Location[] | null, cwd),
        resultCount: validLocations.length,
        fileCount: countUniqueFiles(validLocations),
      }
    }
    case 'hover': {
      return {
        formatted: formatHoverResult(result as Hover | null, cwd),
        resultCount: result ? 1 : 0,
        fileCount: result ? 1 : 0,
      }
    }
    case 'documentSymbol': {
      // LSP allows documentSymbol to return either DocumentSymbol[] or SymbolInformation[]
      const symbols = (result as (DocumentSymbol | SymbolInformation)[]) || []
      // Detect format: DocumentSymbol has 'range', SymbolInformation has 'location'
      const isDocumentSymbol =
        symbols.length > 0 && symbols[0] && 'range' in symbols[0]
// LSP 允许 documentSymbol 返回两种格式：层级 DocumentSymbol[]（带 range 和 children）或扁平 SymbolInformation[]（带 location）。用「第一个元素有没有 range 字段」探测——计数随之分叉：层级要递归数 children，扁平直接取 length。
      // Count symbols - DocumentSymbol can have nested children, SymbolInformation is flat
      const count = isDocumentSymbol
        ? countSymbols(symbols as DocumentSymbol[])
        : symbols.length
      return {
        formatted: formatDocumentSymbolResult(
          result as (DocumentSymbol[] | SymbolInformation[]) | null,
          cwd,
        ),
        resultCount: count,
        fileCount: symbols.length > 0 ? 1 : 0,
      }
    }
    case 'workspaceSymbol': {
      const symbols = (result as SymbolInformation[]) || []

      // Log and filter out symbols with undefined location.uri
      const invalidSymbols = symbols.filter(
        sym => !sym || !sym.location || !sym.location.uri,
      )
      if (invalidSymbols.length > 0) {
        logError(
          new Error(
            `LSP server returned ${invalidSymbols.length} symbol(s) with undefined location URI for workspaceSymbol on ${cwd}. ` +
              `This indicates malformed data from the LSP server.`,
          ),
        )
      }

      const validSymbols = symbols.filter(
        sym => sym && sym.location && sym.location.uri,
      )
      const locations = validSymbols.map(s => s.location)
      return {
        formatted: formatWorkspaceSymbolResult(
          result as SymbolInformation[] | null,
          cwd,
        ),
        resultCount: validSymbols.length,
        fileCount: countUniqueFiles(locations),
      }
    }
    case 'goToImplementation': {
      // Handle both Location and LocationLink formats (same as goToDefinition)
      const rawResults = Array.isArray(result)
        ? result
        : result
          ? [result as Location | LocationLink]
          : []

      // Convert LocationLinks to Locations for uniform handling
      const locations = rawResults.map(toLocation)

      // Log and filter out locations with undefined uris
      const invalidLocations = locations.filter(loc => !loc || !loc.uri)
      if (invalidLocations.length > 0) {
        logError(
          new Error(
            `LSP server returned ${invalidLocations.length} location(s) with undefined URI for goToImplementation on ${cwd}. ` +
              `This indicates malformed data from the LSP server.`,
          ),
        )
      }

      const validLocations = locations.filter(loc => loc && loc.uri)
      return {
        // Reuse goToDefinition formatter since the result format is identical
        formatted: formatGoToDefinitionResult(
          result as
            | Location
            | Location[]
            | LocationLink
            | LocationLink[]
            | null,
          cwd,
        ),
        resultCount: validLocations.length,
        fileCount: countUniqueFiles(validLocations),
      }
    }
    case 'prepareCallHierarchy': {
      const items = (result as CallHierarchyItem[]) || []
      return {
        formatted: formatPrepareCallHierarchyResult(
          result as CallHierarchyItem[] | null,
          cwd,
        ),
        resultCount: items.length,
        fileCount: items.length > 0 ? countUniqueFilesFromCallItems(items) : 0,
      }
    }
    case 'incomingCalls': {
      const calls = (result as CallHierarchyIncomingCall[]) || []
      return {
        formatted: formatIncomingCallsResult(
          result as CallHierarchyIncomingCall[] | null,
          cwd,
        ),
        resultCount: calls.length,
        fileCount:
          calls.length > 0 ? countUniqueFilesFromIncomingCalls(calls) : 0,
      }
    }
    case 'outgoingCalls': {
      const calls = (result as CallHierarchyOutgoingCall[]) || []
      return {
        formatted: formatOutgoingCallsResult(
          result as CallHierarchyOutgoingCall[] | null,
          cwd,
        ),
        resultCount: calls.length,
        fileCount:
          calls.length > 0 ? countUniqueFilesFromOutgoingCalls(calls) : 0,
      }
    }
  }
}

/**
 * Counts unique files from CallHierarchyItem array
 * Filters out items with undefined URIs
 */
function countUniqueFilesFromCallItems(items: CallHierarchyItem[]): number {
  const validUris = items.map(item => item.uri).filter(uri => uri)
  return new Set(validUris).size
}

/**
 * Counts unique files from CallHierarchyIncomingCall array
 * Filters out calls with undefined URIs
 */
function countUniqueFilesFromIncomingCalls(
  calls: CallHierarchyIncomingCall[],
): number {
  const validUris = calls.map(call => call.from?.uri).filter(uri => uri)
  return new Set(validUris).size
}

/**
 * Counts unique files from CallHierarchyOutgoingCall array
 * Filters out calls with undefined URIs
 */
function countUniqueFilesFromOutgoingCalls(
  calls: CallHierarchyOutgoingCall[],
): number {
  const validUris = calls.map(call => call.to?.uri).filter(uri => uri)
  return new Set(validUris).size
}
// 三个 countUniqueFiles 变体分别处理三种调用层级结构的 URI 位置差异（item.uri / from.uri / to.uri），都先过滤 undefined 再用 Set 去重——同一逻辑三种形状，没有强行抽象。
