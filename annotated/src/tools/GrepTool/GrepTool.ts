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
import { lazySchema } from '../../utils/lazySchema.js'
import { expandPath, toRelativePath } from '../../utils/path.js'
import {
  checkReadPermissionForTool,
  getFileReadIgnorePatterns,
  normalizePatternsToPath,
} from '../../utils/permissions/filesystem.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { matchWildcardPattern } from '../../utils/permissions/shellRuleMatching.js'
import { getGlobExclusionsForPluginCache } from '../../utils/plugins/orphanedPluginFilter.js'
import { ripGrep } from '../../utils/ripgrep.js'
import { semanticBoolean } from '../../utils/semanticBoolean.js'
import { semanticNumber } from '../../utils/semanticNumber.js'
import { plural } from '../../utils/stringUtils.js'
import { GREP_TOOL_NAME, getDescription } from './prompt.js'
import {
  getToolUseSummary,
  renderToolResultMessage,
  renderToolUseErrorMessage,
  renderToolUseMessage,
} from './UI.js'

// Grep 工具本体：ripgrep 的受控封装。设计上最显眼的决定是——**输入参数名直接沿用 rg 的旗标**（-B / -A / -C / -n / -i），模型只要会 rg 就会调这个工具，文档成本近乎为零。
const inputSchema = lazySchema(() =>
  z.strictObject({
    pattern: z
      .string()
      .describe(
        'The regular expression pattern to search for in file contents',
      ),
    path: z
      .string()
      .optional()
      .describe(
        'File or directory to search in (rg PATH). Defaults to current working directory.',
      ),
    glob: z
      .string()
      .optional()
      .describe(
        'Glob pattern to filter files (e.g. "*.js", "*.{ts,tsx}") - maps to rg --glob',
      ),
    output_mode: z
      .enum(['content', 'files_with_matches', 'count'])
      .optional()
      .describe(
        'Output mode: "content" shows matching lines (supports -A/-B/-C context, -n line numbers, head_limit), "files_with_matches" shows file paths (supports head_limit), "count" shows match counts (supports head_limit). Defaults to "files_with_matches".',
      ),
    '-B': semanticNumber(z.number().optional()).describe(
      'Number of lines to show before each match (rg -B). Requires output_mode: "content", ignored otherwise.',
    ),
// 参数值过 semanticNumber 而不是裸 z.number()：宽容模型把数字写成字符串（「3」也能过）。这类「语义宽容」解析是工具层的通用套路——模型的输出格式不可控，校验层负责收口。注意 -B/-A/-C 与 context 都要求 output_mode 为 content，否则被静默忽略。
    '-A': semanticNumber(z.number().optional()).describe(
      'Number of lines to show after each match (rg -A). Requires output_mode: "content", ignored otherwise.',
    ),
    '-C': semanticNumber(z.number().optional()).describe('Alias for context.'),
    context: semanticNumber(z.number().optional()).describe(
      'Number of lines to show before and after each match (rg -C). Requires output_mode: "content", ignored otherwise.',
    ),
    '-n': semanticBoolean(z.boolean().optional()).describe(
      'Show line numbers in output (rg -n). Requires output_mode: "content", ignored otherwise. Defaults to true.',
    ),
// -n 默认 true——和原生 rg 相反（rg 默认不显示行号）。工具封装在「贴近原生命令」与「对模型友好」之间选了后者：带上行号，模型后续才能用 Edit 精确定位。
    '-i': semanticBoolean(z.boolean().optional()).describe(
      'Case insensitive search (rg -i)',
    ),
    type: z
      .string()
      .optional()
      .describe(
        'File type to search (rg --type). Common types: js, py, rust, go, java, etc. More efficient than include for standard file types.',
      ),
    head_limit: semanticNumber(z.number().optional()).describe(
      'Limit output to first N lines/entries, equivalent to "| head -N". Works across all output modes: content (limits output lines), files_with_matches (limits file paths), count (limits count entries). Defaults to 250 when unspecified. Pass 0 for unlimited (use sparingly — large result sets waste context).',
    ),
// head_limit 默认 250；显式传 0 是「不设限」的逃生门。英文注释解释了 250 的由来：不限量的 content 模式 grep 能填满 20KB 的结果落盘阈值（grep 重度会话实测 6-24K token），250 对探索式搜索足够宽裕。
    offset: semanticNumber(z.number().optional()).describe(
      'Skip first N lines/entries before applying head_limit, equivalent to "| tail -n +N | head -N". Works across all output modes. Defaults to 0.',
    ),
    multiline: semanticBoolean(z.boolean().optional()).describe(
      'Enable multiline mode where . matches newlines and patterns can span lines (rg -U --multiline-dotall). Default: false.',
    ),
// multiline 对应 rg 的 -U --multiline-dotall，默认关。跨行 pattern（如 struct 开括号到 field）才需要开；默认关是因为多行匹配又慢又容易拖回一大段无关上下文。
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

// Version control system directories to exclude from searches
// These are excluded automatically because they create noise in search results
const VCS_DIRECTORIES_TO_EXCLUDE = [
  '.git',
  '.svn',
  '.hg',
  '.bzr',
  '.jj',
  '.sl',
] as const
// 六个 VCS 目录一律排除：.git / .svn / .hg / .bzr 之外还有 .jj（Jujutsu）和 .sl（Sapling）——两个新兴版本控制系统也在名单里。排除靠 --glob '!dir' 实现，因为它们只会给搜索结果添噪音。

// Default cap on grep results when head_limit is unspecified. Unbounded content-mode
// greps can fill up to the 20KB persist threshold (~6-24K tokens/grep-heavy session).
// 250 is generous enough for exploratory searches while preventing context bloat.
// Pass head_limit=0 explicitly for unlimited.
const DEFAULT_HEAD_LIMIT = 250
// DEFAULT_HEAD_LIMIT = 250，与 head_limit 的默认值呼应。这里的核心权衡写在英文注释里：不设上限的 content grep 会一路填到 20KB 落盘阈值，250 是「探索够用且不撑爆上下文」的平衡点。

function applyHeadLimit<T>(
  items: T[],
  limit: number | undefined,
  offset: number = 0,
): { items: T[]; appliedLimit: number | undefined } {
  // Explicit 0 = unlimited escape hatch
  if (limit === 0) {
    return { items: items.slice(offset), appliedLimit: undefined }
  }
// 显式传 0 = 无限。这是一个专门的逃生门：模型确信需要全量结果时可以自己选择付上下文的代价；默认路径永远是受限的。
  const effectiveLimit = limit ?? DEFAULT_HEAD_LIMIT
  const sliced = items.slice(offset, offset + effectiveLimit)
  // Only report appliedLimit when truncation actually occurred, so the model
  // knows there may be more results and can paginate with offset.
  const wasTruncated = items.length - offset > effectiveLimit
  return {
    items: sliced,
    appliedLimit: wasTruncated ? effectiveLimit : undefined,
  }
}
// appliedLimit 只在真的发生截断时才返回——这是给模型的信号：「还有更多结果，可以用 offset 翻页」。如果没截断也返回 limit 值，模型会误以为后面还有而白跑一轮。

// Format limit/offset information for display in tool results.
// appliedLimit is only set when truncation actually occurred (see applyHeadLimit),
// so it may be undefined even when appliedOffset is set — build parts conditionally
// to avoid "limit: undefined" appearing in user-visible output.
function formatLimitInfo(
  appliedLimit: number | undefined,
  appliedOffset: number | undefined,
): string {
  const parts: string[] = []
  if (appliedLimit !== undefined) parts.push(`limit: ${appliedLimit}`)
  if (appliedOffset) parts.push(`offset: ${appliedOffset}`)
  return parts.join(', ')
}
// formatLimitInfo 条件拼接，避免在用户可见输出里出现「limit: undefined」这种字样——appliedLimit 没截断时是 undefined，appliedOffset 为 0 时也不显示。工具结果的每个字段都要么有意义要么不出现。

const outputSchema = lazySchema(() =>
  z.object({
    mode: z.enum(['content', 'files_with_matches', 'count']).optional(),
    numFiles: z.number(),
    filenames: z.array(z.string()),
    content: z.string().optional(),
    numLines: z.number().optional(), // For content mode
    numMatches: z.number().optional(), // For count mode
    appliedLimit: z.number().optional(), // The limit that was applied (if any)
    appliedOffset: z.number().optional(), // The offset that was applied
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

type Output = z.infer<OutputSchema>

export const GrepTool = buildTool({
  name: GREP_TOOL_NAME,
  searchHint: 'search file contents with regex (ripgrep)',
  // 20K chars - tool result persistence threshold
  maxResultSizeChars: 20_000,
// 20,000 字符 = 工具结果落盘阈值（persist threshold）。这是刻意对齐的：超过阈值的工具结果不进上下文而是落盘让模型按需读回，Grep 的上限就设在这个临界点上。
  strict: true,
// strict: true——到目前读过的工具里只有 Grep 声明了这个。入参 schema 有十几个字段且含 -B 这类非常规键名，开严格模式让 API 按 JSON Schema 校验生成参数，减少模型手滑传错字段名的情况。
  async description() {
    return getDescription()
  },
  userFacingName() {
    return 'Search'
  },
  getToolUseSummary,
  getActivityDescription(input) {
    const summary = getToolUseSummary(input)
    return summary ? `Searching for ${summary}` : 'Searching'
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
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return input.path ? `${input.pattern} in ${input.path}` : input.pattern
  },
// toAutoClassifierInput 把 pattern 和 path 拼给自动分类器判断意图——path 有无影响分类精度，所以条件拼接而不是永远只给 pattern。
  isSearchOrReadCommand() {
    return { isSearch: true, isRead: false }
  },
  getPath({ path }): string {
    return path || getCwd()
  },
  async preparePermissionMatcher({ pattern }) {
    return rulePattern => matchWildcardPattern(rulePattern, pattern)
  },
  async validateInput({ path }): Promise<ValidationResult> {
    // If path is provided, validate that it exists
    if (path) {
      const fs = getFsImplementation()
      const absolutePath = expandPath(path)

      // SECURITY: Skip filesystem operations for UNC paths to prevent NTLM credential leaks.
      if (absolutePath.startsWith('\\\\') || absolutePath.startsWith('//')) {
        return { result: true }
      }
// UNC 短路，与 Glob/FileReadTool 同一条安全规矩：Windows 上 stat 网络路径会发起 SMB 认证泄露 NTLM。注意 Grep 的 validateInput 不检查「是不是目录」——rg 的 PATH 允许直接是文件，这是它和 Glob 的有意分化。

      try {
        await fs.stat(absolutePath)
      } catch (e: unknown) {
        if (isENOENT(e)) {
          const cwdSuggestion = await suggestPathUnderCwd(absolutePath)
// ENOENT 时同样做 suggestPathUnderCwd 补救，报错里带「Did you mean」。两个搜索工具、三个文件工具，错误提示里全都有这一手——模型拼错路径是最高频的错误，值得每层都接住。
          let message = `Path does not exist: ${path}. ${FILE_NOT_FOUND_CWD_NOTE} ${getCwd()}.`
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
    }

    return { result: true }
  },
  async checkPermissions(input, context): Promise<PermissionDecision> {
    const appState = context.getAppState()
    return checkReadPermissionForTool(
      GrepTool,
      input,
      appState.toolPermissionContext,
    )
  },
  async prompt() {
    return getDescription()
  },
  renderToolUseMessage,
  renderToolUseErrorMessage,
  renderToolResultMessage,
  // SearchResultSummary shows content (mode=content) or filenames.join.
  // numFiles/numLines/numMatches are chrome ("Found 3 files") — fine to
  // skip (under-count, not phantom). Glob reuses this via UI.tsx:65.
  extractSearchText({ mode, content, filenames }) {
    if (mode === 'content' && content) return content
    return filenames.join('\n')
  },
// extractSearchText 按模式分流：content 模式给匹配内容本身，其余给文件名列表。英文注释说明 numFiles / numLines / numMatches 是「Found 3 files」类的装饰统计，不进搜索文本（under-count 而非幻影，安全）。
  mapToolResultToToolResultBlockParam(
    {
      mode = 'files_with_matches',
      numFiles,
      filenames,
      content,
      numLines: _numLines,
      numMatches,
      appliedLimit,
      appliedOffset,
    },
    toolUseID,
  ) {
    if (mode === 'content') {
      const limitInfo = formatLimitInfo(appliedLimit, appliedOffset)
      const resultContent = content || 'No matches found'
      const finalContent = limitInfo
        ? `${resultContent}\n\n[Showing results with pagination = ${limitInfo}]`
        : resultContent
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: finalContent,
      }
    }
// content 模式的结果末尾追加翻页信息（limit: 250, offset: 20 这类）——只在真的截断/跳页时出现。模型看到这行就知道该用 offset 续读，而不是重复搜索。

    if (mode === 'count') {
      const limitInfo = formatLimitInfo(appliedLimit, appliedOffset)
      const rawContent = content || 'No matches found'
      const matches = numMatches ?? 0
      const files = numFiles ?? 0
      const summary = `\n\nFound ${matches} total ${matches === 1 ? 'occurrence' : 'occurrences'} across ${files} ${files === 1 ? 'file' : 'files'}.${limitInfo ? ` with pagination = ${limitInfo}` : ''}`
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: rawContent + summary,
      }
    }
// count 模式在原始输出后追加一行汇总：Found N occurrences across M files。原始的 filename:count 行保留，汇总行给模型一个不数行数就能引用的总量。

    // files_with_matches mode
    const limitInfo = formatLimitInfo(appliedLimit, appliedOffset)
    if (numFiles === 0) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: 'No files found',
      }
    }
// files_with_matches 模式空结果同样是「No files found」。三个模式的空结果措辞刻意统一，模型不需要为每个工具记一套空值约定。
    // head_limit has already been applied in call() method, so just show all filenames
    const result = `Found ${numFiles} ${plural(numFiles, 'file')}${limitInfo ? ` ${limitInfo}` : ''}\n${filenames.join('\n')}`
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: result,
    }
  },
  async call(
    {
      pattern,
      path,
      glob,
      type,
      output_mode = 'files_with_matches',
      '-B': context_before,
      '-A': context_after,
      '-C': context_c,
      context,
      '-n': show_line_numbers = true,
      '-i': case_insensitive = false,
      head_limit,
      offset = 0,
      multiline = false,
    },
    { abortController, getAppState },
  ) {
    const absolutePath = path ? expandPath(path) : getCwd()
    const args = ['--hidden']
// --hidden：rg 默认跳过隐藏文件，这里显式打开（.github、.env 这类正是搜索目标）。VCS 目录的排除在下一行单独做——开了 hidden 就必须手动挡住 .git 噪音，两个决定是配套的。

    // Exclude VCS directories to avoid noise from version control metadata
    for (const dir of VCS_DIRECTORIES_TO_EXCLUDE) {
      args.push('--glob', `!${dir}`)
    }

    // Limit line length to prevent base64/minified content from cluttering output
    args.push('--max-columns', '500')
// --max-columns 500：单行超长截断。防止 base64、压缩后的 JS 这类一行几万字符的内容把结果撑爆——搜索结果的行宽上限和 Read 的 2000 字符截断是同一个思路。

    // Only apply multiline flags when explicitly requested
    if (multiline) {
      args.push('-U', '--multiline-dotall')
    }
// multiline 旗标只在显式要求时加——rg 的 -U 会改变整个匹配引擎的行为（性能差一个量级），不能默认开。

    // Add optional flags
    if (case_insensitive) {
      args.push('-i')
    }

    // Add output mode flags
    if (output_mode === 'files_with_matches') {
      args.push('-l')
    } else if (output_mode === 'count') {
      args.push('-c')
    }

    // Add line numbers if requested
    if (show_line_numbers && output_mode === 'content') {
      args.push('-n')
    }
// -n 只在 content 模式下传：文件列表模式（-l）根本不输出行号，传了也是浪费。每个旗标都绑定在它有意义的那条分支上。

    // Add context flags (-C/context takes precedence over context_before/context_after)
    if (output_mode === 'content') {
      if (context !== undefined) {
        args.push('-C', context.toString())
      } else if (context_c !== undefined) {
        args.push('-C', context_c.toString())
      } else {
        if (context_before !== undefined) {
          args.push('-B', context_before.toString())
        }
        if (context_after !== undefined) {
          args.push('-A', context_after.toString())
        }
      }
    }
// 上下文参数的优先级链：context > -C > (-B + -A)。-C/context 是「对称上下文」的捷径，只配了 -B/-A 才分别生效——三层 if/else 把 rg 的参数组合逻辑收拢成一条确定性的规则。

    // If pattern starts with dash, use -e flag to specify it as a pattern
    // This prevents ripgrep from interpreting it as a command-line option
    if (pattern.startsWith('-')) {
      args.push('-e', pattern)
    } else {
      args.push(pattern)
    }
// pattern 以 - 开头时必须用 -e 传——否则 rg 会把它当成命令行选项解析（搜「--help」这个字符串就挂了）。这是所有 CLI 封装的经典坑，rg 官方推荐的做法就是显式 -e。

    // Add type filter if specified
    if (type) {
      args.push('--type', type)
    }

    if (glob) {
      // Split on commas and spaces, but preserve patterns with braces
      const globPatterns: string[] = []
      const rawPatterns = glob.split(/\s+/)

      for (const rawPattern of rawPatterns) {
        // If pattern contains braces, don't split further
        if (rawPattern.includes('{') && rawPattern.includes('}')) {
          globPatterns.push(rawPattern)
        } else {
          // Split on commas for patterns without braces
          globPatterns.push(...rawPattern.split(',').filter(Boolean))
        }
      }

      for (const globPattern of globPatterns.filter(Boolean)) {
        args.push('--glob', globPattern)
      }
    }
// glob 参数的切分规则：先按空白切，含花括号的片段不再按逗号切（*.{ts,tsx} 里的逗号是 pattern 语法的一部分）。一个不起眼但容易写错的解析器——切错一次，模型的过滤条件就全废。

    // Add ignore patterns
    const appState = getAppState()
    const ignorePatterns = normalizePatternsToPath(
      getFileReadIgnorePatterns(appState.toolPermissionContext),
      getCwd(),
    )
    for (const ignorePattern of ignorePatterns) {
      // Note: ripgrep only applies gitignore patterns relative to the working directory
      // So for non-absolute paths, we need to prefix them with '**'
      // See: https://github.com/BurntSushi/ripgrep/discussions/2156#discussioncomment-2316335
      //
      // We also need to negate the pattern with `!` to exclude it
      const rgIgnorePattern = ignorePattern.startsWith('/')
        ? `!${ignorePattern}`
        : `!**/${ignorePattern}`
      args.push('--glob', rgIgnorePattern)
    }
// ignore 规则转成 rg 的 --glob '!pattern'。关键在 '**/' 前缀：rg 的 gitignore 语义是相对工作目录的，用户配的相对路径规则必须补 '**/' 才能命中任意深度（注释里附了 ripgrep 上游讨论链接）。绝对路径规则直接加叹号。

    // Exclude orphaned plugin version directories
    for (const exclusion of await getGlobExclusionsForPluginCache(
      absolutePath,
    )) {
      args.push('--glob', exclusion)
    }
// 插件缓存的孤儿版本目录同样排除——和 Glob 底层用的是同一个 getGlobExclusionsForPluginCache。插件升级后旧版本目录还在盘上，不排除的话搜索会把同一个函数的五个旧版本全翻出来。

    // WSL has severe performance penalty for file reads (3-5x slower on WSL2)
    // The timeout is handled by ripgrep itself via execFile timeout option
    // We don't use AbortController for timeout to avoid interrupting the agent loop
    // If ripgrep times out, it throws RipgrepTimeoutError which propagates up
    // so Claude knows the search didn't complete (rather than thinking there were no matches)
    const results = await ripGrep(args, absolutePath, abortController.signal)
// 超时设计是最值得学的一处：WSL 上文件读有 3-5 倍性能惩罚，超时交给 rg 自己的 execFile timeout，而不是用 AbortController——注释解释了为什么：AbortController 会打断整个 agent 循环；rg 超时抛 RipgrepTimeoutError 向上传播，模型看到的是「搜索没完成」而不是「没有匹配」。这两种结果的语义差异巨大。

    if (output_mode === 'content') {
      // For content mode, results are the actual content lines
      // Convert absolute paths to relative paths to save tokens

      // Apply head_limit first — relativize is per-line work, so
      // avoid processing lines that will be discarded (broad patterns can
      // return 10k+ lines with head_limit keeping only ~30-100).
      const { items: limitedResults, appliedLimit } = applyHeadLimit(
        results,
        head_limit,
        offset,
      )
// content 模式先 head_limit 再转相对路径——顺序是性能优化：宽泛 pattern 可能回 10k+ 行而 limit 只留 30-100 行，先截断就省掉了对将被丢弃的行做逐行字符串处理。

      const finalLines = limitedResults.map(line => {
        // Lines have format: /absolute/path:line_content or /absolute/path:num:content
        const colonIndex = line.indexOf(':')
        if (colonIndex > 0) {
          const filePath = line.substring(0, colonIndex)
          const rest = line.substring(colonIndex)
          return toRelativePath(filePath) + rest
        }
        return line
      })
// 行级转相对路径：结果行格式是「绝对路径:内容」，用 indexOf(':') 取第一个冒号劈开。注意 count 模式用的是 lastIndexOf——见下文。
      const output = {
        mode: 'content' as const,
        numFiles: 0, // Not applicable for content mode
        filenames: [],
        content: finalLines.join('\n'),
        numLines: finalLines.length,
        ...(appliedLimit !== undefined && { appliedLimit }),
        ...(offset > 0 && { appliedOffset: offset }),
      }
      return { data: output }
    }

    if (output_mode === 'count') {
      // For count mode, pass through raw ripgrep output (filename:count format)
      // Apply head_limit first to avoid relativizing entries that will be discarded.
      const { items: limitedResults, appliedLimit } = applyHeadLimit(
        results,
        head_limit,
        offset,
      )

      // Convert absolute paths to relative paths to save tokens
      const finalCountLines = limitedResults.map(line => {
        // Lines have format: /absolute/path:count
        const colonIndex = line.lastIndexOf(':')
        if (colonIndex > 0) {
          const filePath = line.substring(0, colonIndex)
          const count = line.substring(colonIndex)
          return toRelativePath(filePath) + count
        }
        return line
      })
// count 模式转相对路径用 lastIndexOf(':')——因为行尾是数字计数、路径里也可能含冒号（Windows 盘符），从右往左取才是稳定切分点。和 content 模式的 indexOf 形成对比：两个方向的选取都取决于「哪一侧的字段更可控」。

      // Parse count output to extract total matches and file count
      let totalMatches = 0
      let fileCount = 0
      for (const line of finalCountLines) {
        const colonIndex = line.lastIndexOf(':')
        if (colonIndex > 0) {
          const countStr = line.substring(colonIndex + 1)
          const count = parseInt(countStr, 10)
          if (!isNaN(count)) {
            totalMatches += count
            fileCount += 1
          }
        }
      }

      const output = {
        mode: 'count' as const,
        numFiles: fileCount,
        filenames: [],
        content: finalCountLines.join('\n'),
        numMatches: totalMatches,
        ...(appliedLimit !== undefined && { appliedLimit }),
        ...(offset > 0 && { appliedOffset: offset }),
      }
      return { data: output }
    }

    // For files_with_matches mode (default)
    // Use allSettled so a single ENOENT (file deleted between ripgrep's scan
    // and this stat) does not reject the whole batch. Failed stats sort as mtime 0.
    const stats = await Promise.allSettled(
      results.map(_ => getFsImplementation().stat(_)),
    )
// Promise.allSettled 而不是 all：rg 扫描和 stat 之间有时间窗，文件可能在窗口里被删。单个 stat 失败不该让整批结果报废——失败的按 mtime 0 排到最后，自然沉底。
    const sortedMatches = results
      // Sort by modification time
      .map((_, i) => {
        const r = stats[i]!
        return [
          _,
          r.status === 'fulfilled' ? (r.value.mtimeMs ?? 0) : 0,
        ] as const
      })
      .sort((a, b) => {
        if (process.env.NODE_ENV === 'test') {
          // In tests, we always want to sort by filename, so that results are deterministic
          return a[0].localeCompare(b[0])
        }
        const timeComparison = b[1] - a[1]
        if (timeComparison === 0) {
          // Sort by filename as a tiebreaker
          return a[0].localeCompare(b[0])
        }
        return timeComparison
      })
      .map(_ => _[0])
// 排序规则：mtime 降序，文件名做平局裁决。测试环境（NODE_ENV=test）直接按文件名排保证确定性。这就是 Glob 描述里「sorted by modification time」承诺的真正实现处——Glob 和 Grep 的文件列表共用这套排序语义。

    // Apply head_limit to sorted file list (like "| head -N")
    const { items: finalMatches, appliedLimit } = applyHeadLimit(
      sortedMatches,
      head_limit,
      offset,
    )
// head_limit 在排序之后应用——「先按新旧排、再取前 N」保证留下的永远是最最近修改的文件，而不是随机的 N 个。这个顺序如果反了，截断就变成抽奖。

    // Convert absolute paths to relative paths to save tokens
    const relativeMatches = finalMatches.map(toRelativePath)

    const output = {
      mode: 'files_with_matches' as const,
      filenames: relativeMatches,
      numFiles: relativeMatches.length,
      ...(appliedLimit !== undefined && { appliedLimit }),
      ...(offset > 0 && { appliedOffset: offset }),
    }

    return {
      data: output,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
