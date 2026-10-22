import { z } from 'zod/v4'
import type { ValidationResult } from '../../Tool.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { getCwd } from '../../utils/cwd.js'
import { isENOENT } from '../../utils/errors.js'
import {
  FILE_NOT_FOUND_CWD_NOTE,
  suggestPathUnderCwd,
} from '../../utils/file.js'
import { getFsImplementation } from '../../utils/fsOperations.js'
import { glob } from '../../utils/glob.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { expandPath, toRelativePath } from '../../utils/path.js'
import { checkReadPermissionForTool } from '../../utils/permissions/filesystem.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { matchWildcardPattern } from '../../utils/permissions/shellRuleMatching.js'
import { DESCRIPTION, GLOB_TOOL_NAME } from './prompt.js'
import {
  getToolUseSummary,
  renderToolResultMessage,
  renderToolUseErrorMessage,
  renderToolUseMessage,
  userFacingName,
} from './UI.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    pattern: z.string().describe('The glob pattern to match files against'),
    path: z
      .string()
      .optional()
      .describe(
        'The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter "undefined" or "null" - simply omit it for the default behavior. Must be a valid directory path if provided.',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    durationMs: z
      .number()
      .describe('Time taken to execute the search in milliseconds'),
    numFiles: z.number().describe('Total number of files found'),
    filenames: z
      .array(z.string())
      .describe('Array of file paths that match the pattern'),
    truncated: z
      .boolean()
      .describe('Whether results were truncated (limited to 100 files)'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

export const GlobTool = buildTool({
  name: GLOB_TOOL_NAME,
  searchHint: 'find files by name pattern or wildcard',
// 只读三件套的最后定位补齐：Read 读单文件、Grep 按内容找、Glob 按「名字模式」找。底层是 utils/glob.js 的封装，返回结果按修改时间排序（新改的排前面）——这样模型拿到的前几条大概率就是刚动过的文件。
  maxResultSizeChars: 100_000,
// 结果体积上限 100,000 字符，是 GrepTool（20,000）的五倍。原因很直接：glob 结果一行一个路径、天然短小，不像 grep content 模式会带回整行代码，所以阈值可以放宽。超过上限的结果会落盘（同 Read 的机制）。
  async description() {
    return DESCRIPTION
  },
  userFacingName,
  getToolUseSummary,
  getActivityDescription(input) {
    const summary = getToolUseSummary(input)
    return summary ? `Finding ${summary}` : 'Finding files'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return true
  },
// isConcurrencySafe = true：只读、无副作用，可以和其他工具并行执行，调度器不必为它串行排队。isReadOnly 同样为 true——这两开关合在一起，决定了它不会触发权限弹窗确认以外的任何用户交互。
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return input.pattern
  },
  isSearchOrReadCommand() {
    return { isSearch: true, isRead: false }
  },
// isSearchOrReadCommand 给自动分类器打标：这是一次「搜索」而非「读取」。分类结果会影响 UI 呈现与缓存策略（搜索结果不值得像读取那样做去重桩）。
  getPath({ path }): string {
    return path ? expandPath(path) : getCwd()
  },
  async preparePermissionMatcher({ pattern }) {
    return rulePattern => matchWildcardPattern(rulePattern, pattern)
  },
// preparePermissionMatcher 把输入里的 pattern 交给 matchWildcardPattern——也就是说 Glob 的路径权限复用了 shell 通配规则那一套（如 Read(./src/**) 这类规则可以同时约束住 Glob 的搜索范围），不用为 glob 单写一套权限语义。
  async validateInput({ path }): Promise<ValidationResult> {
// validateInput 这里是有 I/O 的（stat），和 FileReadTool 的「五道零 I/O 检查」不同——因为这里的检查对象是用户给的目录参数本身，不做 stat 就没法给出「目录不存在 / 不是目录」的精确报错。UNC 检查仍然排在第一个 stat 之前。
    // If path is provided, validate that it exists and is a directory
    if (path) {
      const fs = getFsImplementation()
      const absolutePath = expandPath(path)

      // SECURITY: Skip filesystem operations for UNC paths to prevent NTLM credential leaks.
      if (absolutePath.startsWith('\\\\') || absolutePath.startsWith('//')) {
        return { result: true }
      }
// UNC 路径在任何 fs 操作之前短路——理由与 FileReadTool / FileEditTool 完全相同：Windows 上 stat 一个 \\server\share 会主动发起 SMB 认证、泄露 NTLM 哈希。这里同时覆盖 \\ 与 // 两种写法。注意短路是「直接放行」，把校验责任推给了后续 glob 执行。

      let stats
      try {
        stats = await fs.stat(absolutePath)
      } catch (e: unknown) {
        if (isENOENT(e)) {
          const cwdSuggestion = await suggestPathUnderCwd(absolutePath)
// ENOENT 时的补救与 FileReadTool 同思路：调 suggestPathUnderCwd 在 cwd 下找相近路径，拼进报错让模型自己纠正（「Did you mean …?」）。模型常见的毛病是拿绝对路径或编造目录，这句提示能省一轮重试。
          let message = `Directory does not exist: ${path}. ${FILE_NOT_FOUND_CWD_NOTE} ${getCwd()}.`
          if (cwdSuggestion) {
            message += ` Did you mean ${cwdSuggestion}?`
          }
          return {
            result: false,
            message,
            errorCode: 1,
          }
        }
        throw e
      }

      if (!stats.isDirectory()) {
        return {
          result: false,
          message: `Path is not a directory: ${path}`,
          errorCode: 2,
        }
      }
// 路径存在但不是目录 → errorCode 2。注意 GrepTool 的 validateInput 没有这一步——因为 rg 的 PATH 参数允许直接指向单个文件，而 glob 的基准必须是目录。两个孪生工具在这类细节上的分化都是有意的。
    }

    return { result: true }
  },
  async checkPermissions(input, context): Promise<PermissionDecision> {
    const appState = context.getAppState()
    return checkReadPermissionForTool(
      GlobTool,
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
  // Reuses Grep's render (UI.tsx:65) — shows filenames.join. durationMs/
  // numFiles are "Found 3 files in 12ms" chrome (under-count, fine).
  extractSearchText({ filenames }) {
    return filenames.join('\n')
  },
// extractSearchText 直接返回 filenames 换行拼接。上方英文注释说明了复用关系：Glob 的结果渲染直接用 GrepTool 的实现（UI.tsx 里一行赋值），durationMs / numFiles 属于「Found 3 files」这类装饰性统计，漏掉不算幻影计数（under-count, fine）。
  async call(input, { abortController, getAppState, globLimits }) {
    const start = Date.now()
    const appState = getAppState()
    const limit = globLimits?.maxResults ?? 100
// 默认上限 100 个文件（globLimits 可覆盖）。截断信息放进输出（truncated 字段），让模型知道该收窄 pattern 而不是以为「就这么多文件」。
    const { files, truncated } = await glob(
      input.pattern,
      GlobTool.getPath(input),
      { limit, offset: 0 },
      abortController.signal,
      appState.toolPermissionContext,
    )
    // Relativize paths under cwd to save tokens (same as GrepTool)
    const filenames = files.map(toRelativePath)
// 结果路径转相对路径省 token——注释明说「same as GrepTool」，两个搜索工具在这条省钱规矩上保持一致（cwd 下的路径去掉前缀）。
    const output: Output = {
      filenames,
      durationMs: Date.now() - start,
      numFiles: filenames.length,
      truncated,
    }
    return {
      data: output,
    }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    if (output.filenames.length === 0) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: 'No files found',
      }
    }
// 空结果是文本「No files found」而不是空串——给模型一个明确的「搜到了但没匹配」信号，和 Grep 三个模式的空结果文案保持同一措辞习惯。
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: [
        ...output.filenames,
        ...(output.truncated
          ? [
              '(Results are truncated. Consider using a more specific path or pattern.)',
            ]
          : []),
      ].join('\n'),
    }
  },
// 截断时在文件列表末尾追加一句提示：建议收窄 path 或 pattern。这句是给模型看的行动指引，不是给人看的报错——「告诉模型下一步该做什么」是工具结果设计的通用套路。
} satisfies ToolDef<InputSchema, Output>)
