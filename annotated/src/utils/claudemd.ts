/**
 * Files are loaded in the following order:
 *
 * 1. Managed memory (eg. /etc/claude-code/CLAUDE.md) - Global instructions for all users
 * 2. User memory (~/.claude/CLAUDE.md) - Private global instructions for all projects
 * 3. Project memory (CLAUDE.md, .claude/CLAUDE.md, and .claude/rules/*.md in project roots) - Instructions checked into the codebase
 * 4. Local memory (CLAUDE.local.md in project roots) - Private project-specific instructions
 *
 * Files are loaded in reverse order of priority, i.e. the latest files are highest priority
 * with the model paying more attention to them.
 *
 * File discovery:
 * - User memory is loaded from the user's home directory
 * - Project and Local files are discovered by traversing from the current directory up to root
 * - Files closer to the current directory have higher priority (loaded later)
 * - CLAUDE.md, .claude/CLAUDE.md, and all .md files in .claude/rules/ are checked in each directory for Project memory
 *
 * Memory @include directive:
 * - Memory files can include other files using @ notation
 * - Syntax: @path, @./relative/path, @~/home/path, or @/absolute/path
 * - @path (without prefix) is treated as a relative path (same as @./path)
 * - Works in leaf text nodes only (not inside code blocks or code strings)
 * - Included files are added as separate entries before the including file
 * - Circular references are prevented by tracking processed files
 * - Non-existent files are silently ignored
 */

// 文件总览：CLAUDE.md 记忆体系的**装载与语义层**。文件头注释就是完整规格，值得逐行读——四类记忆按优先级从低到高：Managed（企业策略）→ User（个人全局）→ Project（入库的项目说明）→ Local（不入库的私人项目说明），**后加载的优先级更高**，因为模型对靠近末尾的内容注意力更强。发现规则：User 只在 home，Project 与 Local 从 cwd 逐级向上走到根；另有 @include 语法（只在叶子文本节点生效，代码块里不算），被包含文件排在包含者之前，靠 processedPaths 防环。
import { feature } from 'bun:bundle'
import ignore from 'ignore'
import memoize from 'lodash-es/memoize.js'
import { Lexer } from 'marked'
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  parse,
  relative,
  sep,
} from 'path'
import picomatch from 'picomatch'
import { logEvent } from 'src/services/analytics/index.js'
import {
  getAdditionalDirectoriesForClaudeMd,
  getOriginalCwd,
} from '../bootstrap/state.js'
import { truncateEntrypointContent } from '../memdir/memdir.js'
import { getAutoMemEntrypoint, isAutoMemoryEnabled } from '../memdir/paths.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import {
  getCurrentProjectConfig,
  getManagedClaudeRulesDir,
  getMemoryPath,
  getUserClaudeRulesDir,
} from './config.js'
import { logForDebugging } from './debug.js'
import { logForDiagnosticsNoPII } from './diagLogs.js'
import { getClaudeConfigHomeDir, isEnvTruthy } from './envUtils.js'
import { getErrnoCode } from './errors.js'
import { normalizePathForComparison } from './file.js'
import { cacheKeys, type FileStateCache } from './fileStateCache.js'
import {
  parseFrontmatter,
  splitPathInFrontmatter,
} from './frontmatterParser.js'
import { getFsImplementation, safeResolvePath } from './fsOperations.js'
import { findCanonicalGitRoot, findGitRoot } from './git.js'
import {
  executeInstructionsLoadedHooks,
  hasInstructionsLoadedHook,
  type InstructionsLoadReason,
  type InstructionsMemoryType,
} from './hooks.js'
import type { MemoryType } from './memory/types.js'
import { expandPath } from './path.js'
import { pathInWorkingPath } from './permissions/filesystem.js'
import { isSettingSourceEnabled } from './settings/constants.js'
import { getInitialSettings } from './settings/settings.js'

/* eslint-disable @typescript-eslint/no-require-imports */
const teamMemPaths = feature('TEAMMEM')
  ? (require('../memdir/teamMemPaths.js') as typeof import('../memdir/teamMemPaths.js'))
  : null
/* eslint-enable @typescript-eslint/no-require-imports */

let hasLoggedInitialLoad = false

const MEMORY_INSTRUCTION_PROMPT =
  'Codebase and user instructions are shown below. Be sure to adhere to these instructions. IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.'
// Recommended max character count for a memory file
export const MAX_MEMORY_CHARACTER_COUNT = 40000

// File extensions that are allowed for @include directives
// This prevents binary files (images, PDFs, etc.) from being loaded into memory
const TEXT_FILE_EXTENSIONS = new Set([
  // Markdown and text
  '.md',
  '.txt',
  '.text',
  // Data formats
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.xml',
  '.csv',
  // Web
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.sass',
  '.less',
  // JavaScript/TypeScript
  '.js',
  '.ts',
  '.tsx',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
  // Python
  '.py',
  '.pyi',
  '.pyw',
  // Ruby
  '.rb',
  '.erb',
  '.rake',
  // Go
  '.go',
  // Rust
  '.rs',
  // Java/Kotlin/Scala
  '.java',
  '.kt',
  '.kts',
  '.scala',
  // C/C++
  '.c',
  '.cpp',
  '.cc',
  '.cxx',
  '.h',
  '.hpp',
  '.hxx',
  // C#
  '.cs',
  // Swift
  '.swift',
  // Shell
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.ps1',
  '.bat',
  '.cmd',
  // Config
  '.env',
  '.ini',
  '.cfg',
  '.conf',
  '.config',
  '.properties',
  // Database
  '.sql',
  '.graphql',
  '.gql',
  // Protocol
  '.proto',
  // Frontend frameworks
  '.vue',
  '.svelte',
  '.astro',
  // Templating
  '.ejs',
  '.hbs',
  '.pug',
  '.jade',
  // Other languages
  '.php',
  '.pl',
  '.pm',
  '.lua',
  '.r',
  '.R',
  '.dart',
  '.ex',
  '.exs',
  '.erl',
  '.hrl',
  '.clj',
  '.cljs',
  '.cljc',
  '.edn',
  '.hs',
  '.lhs',
  '.elm',
  '.ml',
  '.mli',
  '.f',
  '.f90',
  '.f95',
  '.for',
  // Build files
  '.cmake',
  '.make',
  '.makefile',
  '.gradle',
  '.sbt',
  // Documentation
  '.rst',
  '.adoc',
  '.asciidoc',
  '.org',
  '.tex',
  '.latex',
  // Lock files (often text-based)
  '.lock',
  // Misc
  '.log',
  '.diff',
  '.patch',
])
// TEXT_FILE_EXTENSIONS 是 @include 的**白名单**：只允许文本类扩展名。这不是洁癖而是硬需求——@include 的内容会直接进上下文，允许二进制就等于允许把图片/PDF 的乱码塞进 prompt，既浪费 token 也可能触发解析异常。名单长得离谱（覆盖上百种语言与配置格式），因为漏掉一种就会让用户觉得 @include 坏了；而黑名单方式永远漏。

export type MemoryFileInfo = {
  path: string
  type: MemoryType
  content: string
  parent?: string // Path of the file that included this one
  globs?: string[] // Glob patterns for file paths this rule applies to
  // True when auto-injection transformed `content` (stripped HTML comments,
  // stripped frontmatter, truncated MEMORY.md) such that it no longer matches
  // the bytes on disk. When set, `rawContent` holds the unmodified disk bytes
  // so callers can cache a `isPartialView` readFileState entry — presence in
  // cache provides dedup + change detection, but Edit/Write still require an
  // explicit Read before proceeding.
  contentDiffersFromDisk?: boolean
  rawContent?: string
}
// MemoryFileInfo 里最容易被忽略的是 contentDiffersFromDisk 与 rawContent 这对字段，注释解释了它们的存在理由：自动注入会改写内容（剥 HTML 注释、剥 frontmatter、截断 MEMORY.md），改写后 content 已不等于磁盘字节。此时保留原始字节，是为了让调用方能往 readFileState 里写一条**部分视图**缓存——命中缓存仍能去重与检测变更，但 Edit/Write 仍要求先显式 Read，避免基于截断内容做编辑。

function pathInOriginalCwd(path: string): boolean {
  return pathInWorkingPath(path, getOriginalCwd())
}
// pathInOriginalCwd 一行包装，注意用的是 getOriginalCwd 而非当前 cwd：会话中执行 cd 之后，判断「是否在项目内」仍要以启动目录为基准，否则 @include 的外部文件审批会随 cd 漂移。

/**
 * Parses raw content to extract both content and glob patterns from frontmatter
 * @param rawContent Raw file content with frontmatter
 * @returns Object with content and globs (undefined if no paths or match-all pattern)
 */
function parseFrontmatterPaths(rawContent: string): {
  content: string
  paths?: string[]
} {
  const { frontmatter, content } = parseFrontmatter(rawContent)

  if (!frontmatter.paths) {
    return { content }
  }

  const patterns = splitPathInFrontmatter(frontmatter.paths)
    .map(pattern => {
      // Remove /** suffix - ignore library treats 'path' as matching both
      // the path itself and everything inside it
      return pattern.endsWith('/**') ? pattern.slice(0, -3) : pattern
    })
    .filter((p: string) => p.length > 0)

  // If all patterns are ** (match-all), treat as no globs (undefined)
  // This means the file applies to all paths
  if (patterns.length === 0 || patterns.every((p: string) => p === '**')) {
    return { content }
  }

  return { content, paths: patterns }
}
// parseFrontmatterPaths 处理条件规则的 paths 前置元数据：① 把 path/ 后缀的星号后缀去掉——ignore 库认为写目录名本身就同时匹配目录与其内部；② 全部是 ** 时视为无条件（返回 undefined 而不是空数组），否则「匹配一切」会被下游当成「匹配不到」。

/**
 * Strip block-level HTML comments (<!-- ... -->) from markdown content.
 *
 * Uses the marked lexer to identify comments at the block level only, so
 * comments inside inline code spans and fenced code blocks are preserved.
 * Inline HTML comments inside a paragraph are also left intact; the intended
 * use case is authorial notes that occupy their own lines.
 *
 * Unclosed comments (`<!--` with no matching `-->`) are left in place so a
 * typo doesn't silently swallow the rest of the file.
 */
export function stripHtmlComments(content: string): {
  content: string
  stripped: boolean
} {
  if (!content.includes('<!--')) {
    return { content, stripped: false }
  }
// stripHtmlComments 的第一个判断是纯性能优化：不含 <!-- 就直接返回，跳过整个 lexer。这在启动路径上很关键——绝大多数 CLAUDE.md 里没有注释，不能为了可能存在的注释给每个文件都跑一次 markdown 解析。
  // gfm:false is fine here — html-block detection is a CommonMark rule.
  return stripHtmlCommentsFromTokens(new Lexer({ gfm: false }).lex(content))
}
// 为什么用 marked 的 lexer 而不是正则剥注释？注释写得很明确：只用块级 token 判断，于是**行内代码与围栏代码块里的注释被保留**（用户可能就在文档里教怎么写 HTML 注释）。行内 HTML 注释（夹在段落文字中间的）也不动，因为目标是「独占一行的作者备注」。另外未闭合的注释原样保留——一个笔误不该把文件剩下的内容全吞掉。

function stripHtmlCommentsFromTokens(tokens: ReturnType<Lexer['lex']>): {
  content: string
  stripped: boolean
} {
  let result = ''
  let stripped = false

  // A well-formed HTML comment span. Non-greedy so multiple comments on the
  // same line are matched independently; [\s\S] to span newlines.
  const commentSpan = /<!--[\s\S]*?-->/g

  for (const token of tokens) {
    if (token.type === 'html') {
      const trimmed = token.raw.trimStart()
      if (trimmed.startsWith('<!--') && trimmed.includes('-->')) {
        // Per CommonMark, a type-2 HTML block ends at the *line* containing
        // `-->`, so text after `-->` on that line is part of this token.
        // Strip only the comment spans and keep any residual content.
        const residue = token.raw.replace(commentSpan, '')
        stripped = true
        if (residue.trim().length > 0) {
          // Residual content exists (e.g. `<!-- note --> Use bun`): keep it.
          result += residue
        }
        continue
      }
    }
    result += token.raw
  }

  return { content: result, stripped }
}
// stripHtmlCommentsFromTokens 处理一个 CommonMark 细节：type-2 HTML 块结束于**包含结束符的那一整行**，所以注释后面同一行还可能有正文（如注释后接一句指令）。因此不能整块丢弃，而要只替换注释片段、保留残余内容。非贪婪匹配让同一行多个注释各自独立处理。

/**
 * Parses raw memory file content into a MemoryFileInfo. Pure function — no I/O.
 *
 * When includeBasePath is given, @include paths are resolved in the same lex
 * pass and returned alongside the parsed file (so processMemoryFile doesn't
 * need to lex the same content a second time).
 */
function parseMemoryFileContent(
  rawContent: string,
  filePath: string,
  type: MemoryType,
  includeBasePath?: string,
): { info: MemoryFileInfo | null; includePaths: string[] } {
  // Skip non-text files to prevent loading binary data (images, PDFs, etc.) into memory
  const ext = extname(filePath).toLowerCase()
  if (ext && !TEXT_FILE_EXTENSIONS.has(ext)) {
    logForDebugging(`Skipping non-text file in @include: ${filePath}`)
    return { info: null, includePaths: [] }
  }

  const { content: withoutFrontmatter, paths } =
    parseFrontmatterPaths(rawContent)

  // Lex once so strip and @include-extract share the same tokens. gfm:false
  // is required by extract (so ~/path doesn't tokenize as strikethrough) and
  // doesn't affect strip (html blocks are a CommonMark rule).
  const hasComment = withoutFrontmatter.includes('<!--')
  const tokens =
    hasComment || includeBasePath !== undefined
      ? new Lexer({ gfm: false }).lex(withoutFrontmatter)
      : undefined

  // Only rebuild via tokens when a comment actually needs stripping —
  // marked normalises \r\n during lex, so round-tripping a CRLF file
  // through token.raw would spuriously flip contentDiffersFromDisk.
  const strippedContent =
    hasComment && tokens
      ? stripHtmlCommentsFromTokens(tokens).content
      : withoutFrontmatter

  const includePaths =
    tokens && includeBasePath !== undefined
      ? extractIncludePathsFromTokens(tokens, includeBasePath)
      : []
// 这一段的注释是一条重要的工程经验：只有在**确实需要剥注释**时才走 token 往返重建。因为 marked 在 lex 时会把 CRLF 归一成 LF，一个 CRLF 文件哪怕没有任何注释，往返一次也会让 content 与磁盘字节不同，从而把 contentDiffersFromDisk 误标成真——垃圾标记会让下游缓存逻辑全部降级。

  // Truncate MEMORY.md entrypoints to the line AND byte caps
  let finalContent = strippedContent
  if (type === 'AutoMem' || type === 'TeamMem') {
    finalContent = truncateEntrypointContent(strippedContent).content
  }
// AutoMem 与 TeamMem 两类入口文件要额外截断（truncateEntrypointContent，有行数与字节双上限）。这两类是「索引文件」，会随会话不断变长，不截断就会挤爆上下文。

  // Covers frontmatter strip, HTML comment strip, and MEMORY.md truncation
  const contentDiffersFromDisk = finalContent !== rawContent
// contentDiffersFromDisk 用「最终内容 !== 原始字节」来判，一行覆盖三种改写来源：frontmatter 剥离、HTML 注释剥离、入口文件截断。把它放在解析的最后统一计算，而不是在每处改写时置位——后者容易漏。
  return {
    info: {
      path: filePath,
      type,
      content: finalContent,
      globs: paths,
      contentDiffersFromDisk,
      rawContent: contentDiffersFromDisk ? rawContent : undefined,
    },
    includePaths,
  }
}
// parseMemoryFileContent 是纯函数（无 IO），把「读」与「解析」拆开的好处是：同一份内容只需 lex 一次，剥注释与抽取 @include 共用同一组 token。includeBasePath 作为可选参数决定是否顺带抽 include —— 顶层文件与被子文件都需要，但纯展示路径（如直接读某个文件）不需要，省一次 lex。

function handleMemoryFileReadError(error: unknown, filePath: string): void {
  const code = getErrnoCode(error)
  // ENOENT = file doesn't exist, EISDIR = is a directory — both expected
  if (code === 'ENOENT' || code === 'EISDIR') {
    return
  }
  // Log permission errors (EACCES) as they're actionable
  if (code === 'EACCES') {
    // Don't log the full file path to avoid PII/security issues
    logEvent('tengu_claude_md_permission_error', {
      is_access_error: 1,
      has_home_dir: filePath.includes(getClaudeConfigHomeDir()) ? 1 : 0,
    })
  }
}
// handleMemoryFileReadError 把错误分三档：ENOENT 与 EISDIR **完全静默**（这是常态——每个目录都要试 CLAUDE.md、.claude/CLAUDE.md、.claude/rules，绝大多数不存在）；EACCES 才上报埋点，因为权限错误是用户可修的；其余错误也不打日志。埋点里刻意**不上报完整路径**，只上报「是否在配置主目录内」——路径含用户名与项目名，属 PII。

/**
 * Used by processMemoryFile → getMemoryFiles so the event loop stays
 * responsive during the directory walk (many readFile attempts, most
 * ENOENT). When includeBasePath is given, @include paths are resolved in
 * the same lex pass and returned alongside the parsed file.
 */
async function safelyReadMemoryFileAsync(
  filePath: string,
  type: MemoryType,
  includeBasePath?: string,
): Promise<{ info: MemoryFileInfo | null; includePaths: string[] }> {
  try {
    const fs = getFsImplementation()
    const rawContent = await fs.readFile(filePath, { encoding: 'utf-8' })
    return parseMemoryFileContent(rawContent, filePath, type, includeBasePath)
  } catch (error) {
    handleMemoryFileReadError(error, filePath)
    return { info: null, includePaths: [] }
  }
}
// safelyReadMemoryFileAsync 存在的理由写在注释里：目录遍历会产生大量 readFile 尝试（大多数 ENOENT），用异步读让事件循环保持响应。这一层把「读失败」折叠成 info 为 null，让上层的控制流不必到处 try。

type MarkdownToken = {
  type: string
  text?: string
  href?: string
  tokens?: MarkdownToken[]
  raw?: string
  items?: MarkdownToken[]
}
// MarkdownToken 是 marked token 的最小结构子集（只声明用到的字段），刻意不用它的完整类型：token 结构随 marked 版本变化，只依赖自己实际读的五个字段能把升级影响面压到最小。

// Extract @path include references from pre-lexed tokens and resolve to
// absolute paths. Skips html tokens so @paths inside block comments are
// ignored — the caller may pass pre-strip tokens.
function extractIncludePathsFromTokens(
  tokens: ReturnType<Lexer['lex']>,
  basePath: string,
): string[] {
  const absolutePaths = new Set<string>()

  // Extract @paths from a text string and add resolved paths to absolutePaths.
  function extractPathsFromText(textContent: string) {
    const includeRegex = /(?:^|\s)@((?:[^\s\\]|\\ )+)/g
    let match
    while ((match = includeRegex.exec(textContent)) !== null) {
      let path = match[1]
      if (!path) continue

      // Strip fragment identifiers (#heading, #section-name, etc.)
      const hashIndex = path.indexOf('#')
      if (hashIndex !== -1) {
        path = path.substring(0, hashIndex)
      }
      if (!path) continue

      // Unescape the spaces in the path
      path = path.replace(/\\ /g, ' ')

      // Accept @path, @./path, @~/path, or @/path
      if (path) {
        const isValidPath =
          path.startsWith('./') ||
          path.startsWith('~/') ||
          (path.startsWith('/') && path !== '/') ||
          (!path.startsWith('@') &&
            !path.match(/^[#%^&*()]+/) &&
            path.match(/^[a-zA-Z0-9._-]/))

        if (isValidPath) {
          const resolvedPath = expandPath(path, dirname(basePath))
          absolutePaths.add(resolvedPath)
        }
      }
    }
  }

  // Recursively process elements to find text nodes
  function processElements(elements: MarkdownToken[]) {
    for (const element of elements) {
      if (element.type === 'code' || element.type === 'codespan') {
        continue
      }

      // For html tokens that contain comments, strip the comment spans and
      // check the residual for @paths (e.g. `<!-- note --> @./file.md`).
      // Other html tokens (non-comment tags) are skipped entirely.
      if (element.type === 'html') {
        const raw = element.raw || ''
        const trimmed = raw.trimStart()
        if (trimmed.startsWith('<!--') && trimmed.includes('-->')) {
          const commentSpan = /<!--[\s\S]*?-->/g
          const residue = raw.replace(commentSpan, '')
          if (residue.trim().length > 0) {
            extractPathsFromText(residue)
          }
        }
        continue
      }

      // Process text nodes
      if (element.type === 'text') {
        extractPathsFromText(element.text || '')
      }

      // Recurse into children tokens
      if (element.tokens) {
        processElements(element.tokens)
      }

      // Special handling for list structures
      if (element.items) {
        processElements(element.items)
      }
    }
  }

  processElements(tokens as MarkdownToken[])
  return [...absolutePaths]
}
// extractIncludePathsFromTokens 是 @include 的解析器，几个细节都对应真实输入：① 正则要求 @ 前是行首或空白，避免把邮箱里的 @ 当引用；② 支持反斜杠转义的空格（路径带空格）；③ 剥掉 fragment 标识（#heading），让 @file.md#小节 指向文件本身；④ 合法形态四种（相对、./、~/、绝对），另有一条宽松分支接受「字母数字开头的裸路径」，但排除以 @ 或 markdown 强调符号开头的；⑤ 遇到 code / codespan token 直接跳过——代码里的 @ 不算引用；⑥ html token 里若剥掉注释后还有残余，也要抽（注释后同一行的 @include 有效）。递归会进 tokens 与 items 两个子结构，因为列表项挂在 items 而非 tokens 上。

const MAX_INCLUDE_DEPTH = 5
// MAX_INCLUDE_DEPTH 定 5：@include 可以嵌套，深度限制与 processedPaths 一起构成双重防环（后者防重复、前者防长链）。5 层足够覆盖「总纲 → 模块 → 子模块 → 细则 → 附录」，再深基本是误用。

/**
 * Checks whether a CLAUDE.md file path is excluded by the claudeMdExcludes setting.
 * Only applies to User, Project, and Local memory types.
 * Managed, AutoMem, and TeamMem types are never excluded.
 *
 * Matches both the original path and the realpath-resolved path to handle symlinks
 * (e.g., /tmp -> /private/tmp on macOS).
 */
function isClaudeMdExcluded(filePath: string, type: MemoryType): boolean {
  if (type !== 'User' && type !== 'Project' && type !== 'Local') {
    return false
  }

  const patterns = getInitialSettings().claudeMdExcludes
  if (!patterns || patterns.length === 0) {
    return false
  }

  const matchOpts = { dot: true }
  const normalizedPath = filePath.replaceAll('\\', '/')

  // Build an expanded pattern list that includes realpath-resolved versions of
  // absolute patterns. This handles symlinks like /tmp -> /private/tmp on macOS:
  // the user writes "/tmp/project/CLAUDE.md" in their exclude, but the system
  // resolves the CWD to "/private/tmp/project/...", so the file path uses the
  // real path. By resolving the patterns too, both sides match.
  const expandedPatterns = resolveExcludePatterns(patterns).filter(
    p => p.length > 0,
  )
  if (expandedPatterns.length === 0) {
    return false
  }

  return picomatch.isMatch(normalizedPath, expandedPatterns, matchOpts)
}
// isClaudeMdExcluded 只对 User / Project / Local 三类生效，Managed、AutoMem、TeamMem **永不可排除**——企业策略与自动记忆不受用户排除项影响。这里的核心难点是符号链接：用户在 exclude 里写 /tmp/project/CLAUDE.md，而系统解析出的 cwd 是 /private/tmp/project（macOS 上 /tmp 是指向 /private/tmp 的链接），两边字面不同。解法是**两边都做 realpath 展开**再比，而不是只展开文件路径。

/**
 * Expands exclude patterns by resolving symlinks in absolute path prefixes.
 * For each absolute pattern (starting with /), tries to resolve the longest
 * existing directory prefix via realpathSync and adds the resolved version.
 * Glob patterns (containing *) have their static prefix resolved.
 */
function resolveExcludePatterns(patterns: string[]): string[] {
  const fs = getFsImplementation()
  const expanded: string[] = patterns.map(p => p.replaceAll('\\', '/'))

  for (const normalized of expanded) {
    // Only resolve absolute patterns — glob-only patterns like "**/*.md" don't have
    // a filesystem prefix to resolve
    if (!normalized.startsWith('/')) {
      continue
    }

    // Find the static prefix before any glob characters
    const globStart = normalized.search(/[*?{[]/)
    const staticPrefix =
      globStart === -1 ? normalized : normalized.slice(0, globStart)
    const dirToResolve = dirname(staticPrefix)

    try {
      // sync IO: called from sync context (isClaudeMdExcluded -> processMemoryFile -> getMemoryFiles)
      const resolvedDir = fs.realpathSync(dirToResolve).replaceAll('\\', '/')
      if (resolvedDir !== dirToResolve) {
        const resolvedPattern =
          resolvedDir + normalized.slice(dirToResolve.length)
        expanded.push(resolvedPattern)
      }
    } catch {
      // Directory doesn't exist; skip resolution for this pattern
    }
  }

  return expanded
}
// resolveExcludePatterns 把绝对路径模式里的**静态前缀**（第一个通配符之前的部分）取目录做 realpath，再拼回剩余部分，从而得到「同一个位置的真实路径版本」。glob 型模式（如 **/*.md）没有文件系统前缀，直接跳过。realpathSync 同步调用是被迫的——整条链路（排除判断 → 单文件处理 → getMemoryFiles）都是同步语义，这里没有 await 的位置。

/**
 * Recursively processes a memory file and all its @include references
 * Returns an array of MemoryFileInfo objects with includes first, then main file
 */
export async function processMemoryFile(
  filePath: string,
  type: MemoryType,
  processedPaths: Set<string>,
  includeExternal: boolean,
  depth: number = 0,
  parent?: string,
): Promise<MemoryFileInfo[]> {
  // Skip if already processed or max depth exceeded.
  // Normalize paths for comparison to handle Windows drive letter casing
  // differences (e.g., C:\Users vs c:\Users).
  const normalizedPath = normalizePathForComparison(filePath)
  if (processedPaths.has(normalizedPath) || depth >= MAX_INCLUDE_DEPTH) {
    return []
  }

  // Skip if path is excluded by claudeMdExcludes setting
  if (isClaudeMdExcluded(filePath, type)) {
    return []
  }

  // Resolve symlink path early for @import resolution
  const { resolvedPath, isSymlink } = safeResolvePath(
    getFsImplementation(),
    filePath,
  )

  processedPaths.add(normalizedPath)
  if (isSymlink) {
    processedPaths.add(normalizePathForComparison(resolvedPath))
  }

  const { info: memoryFile, includePaths: resolvedIncludePaths } =
    await safelyReadMemoryFileAsync(filePath, type, resolvedPath)
  if (!memoryFile || !memoryFile.content.trim()) {
    return []
  }

  // Add parent information
  if (parent) {
    memoryFile.parent = parent
  }

  const result: MemoryFileInfo[] = []

  // Add the main file first (parent before children)
  result.push(memoryFile)

  for (const resolvedIncludePath of resolvedIncludePaths) {
    const isExternal = !pathInOriginalCwd(resolvedIncludePath)
    if (isExternal && !includeExternal) {
      continue
    }

    // Recursively process included files with this file as parent
    const includedFiles = await processMemoryFile(
      resolvedIncludePath,
      type,
      processedPaths,
      includeExternal,
      depth + 1,
      filePath, // Pass current file as parent
    )
    result.push(...includedFiles)
  }

  return result
}
// processMemoryFile 是递归装载单元，五个关键点：① 路径先 normalizePathForComparison 再进 processedPaths，否则 Windows 上 C:/Users 与 c:/Users 会被当成两个文件重复加载；② 深度或重复直接返回空数组（不是 null，让调用方可以无脑展开）；③ 符号链接要把**解析后的真实路径**也登记一遍，否则通过不同链接指向同一文件时会重复；④ 内容为空白的文件被丢弃（空 CLAUDE.md 不该占一个条目）；⑤ 主文件先入结果、被包含文件后入——虽然文件头注释说「被包含的排在包含者之前」，但代码实际是主文件在前，因为 prompt 里先给上下文再给引用它的说明更自然。

/**
 * Processes all .md files in the .claude/rules/ directory and its subdirectories
 * @param rulesDir The path to the rules directory
 * @param type Type of memory file (User, Project, Local)
 * @param processedPaths Set of already processed file paths
 * @param includeExternal Whether to include external files
 * @param conditionalRule If true, only include files with frontmatter paths; if false, only include files without frontmatter paths
 * @param visitedDirs Set of already visited directory real paths (for cycle detection)
 * @returns Array of MemoryFileInfo objects
 */
export async function processMdRules({
  rulesDir,
  type,
  processedPaths,
  includeExternal,
  conditionalRule,
  visitedDirs = new Set(),
}: {
  rulesDir: string
  type: MemoryType
  processedPaths: Set<string>
  includeExternal: boolean
  conditionalRule: boolean
  visitedDirs?: Set<string>
}): Promise<MemoryFileInfo[]> {
  if (visitedDirs.has(rulesDir)) {
    return []
  }
// processMdRules 的防环靠 visitedDirs（按目录而非文件），因为规则目录可以符号链接成环。

  try {
    const fs = getFsImplementation()

    const { resolvedPath: resolvedRulesDir, isSymlink } = safeResolvePath(
      fs,
      rulesDir,
    )

    visitedDirs.add(rulesDir)
    if (isSymlink) {
      visitedDirs.add(resolvedRulesDir)
    }

    const result: MemoryFileInfo[] = []
    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(resolvedRulesDir)
    } catch (e: unknown) {
      const code = getErrnoCode(e)
      if (code === 'ENOENT' || code === 'EACCES' || code === 'ENOTDIR') {
        return []
      }
      throw e
    }

    for (const entry of entries) {
      const entryPath = join(rulesDir, entry.name)
      const { resolvedPath: resolvedEntryPath, isSymlink } = safeResolvePath(
        fs,
        entryPath,
      )

      // Use Dirent methods for non-symlinks to avoid extra stat calls.
      // For symlinks, we need stat to determine what the target is.
      const stats = isSymlink ? await fs.stat(resolvedEntryPath) : null
      const isDirectory = stats ? stats.isDirectory() : entry.isDirectory()
      const isFile = stats ? stats.isFile() : entry.isFile()

      if (isDirectory) {
        result.push(
          ...(await processMdRules({
            rulesDir: resolvedEntryPath,
            type,
            processedPaths,
            includeExternal,
            conditionalRule,
            visitedDirs,
          })),
        )
      } else if (isFile && entry.name.endsWith('.md')) {
        const files = await processMemoryFile(
          resolvedEntryPath,
          type,
          processedPaths,
          includeExternal,
        )
        result.push(
          ...files.filter(f => (conditionalRule ? f.globs : !f.globs)),
        )
      }
// 遍历规则目录时只处理子目录与 .md 文件；conditionalRule 参数决定「只要带 paths 的」还是「只要不带的」——两类规则在不同时机装载：无条件的在启动时全量注入，有条件的要等具体操作目标文件出现时按 glob 匹配再注入（见文件末尾几个函数）。注释还点了一个性能细节：非符号链接用 Dirent 的 isDirectory/isFile 判断，省掉一次 stat。
    }

    return result
  } catch (error) {
    if (error instanceof Error && error.message.includes('EACCES')) {
      logEvent('tengu_claude_rules_md_permission_error', {
        is_access_error: 1,
        has_home_dir: rulesDir.includes(getClaudeConfigHomeDir()) ? 1 : 0,
      })
    }
    return []
  }
}
// processMdRules 的错误处理分两层：readdir 的 ENOENT / EACCES / ENOTDIR 静默返回空（目录不存在是常态），其余错误上抛；外层 catch 只对 EACCES 记埋点（同样不上报路径）。

export const getMemoryFiles = memoize(
  async (forceIncludeExternal: boolean = false): Promise<MemoryFileInfo[]> => {
    const startTime = Date.now()
    logForDiagnosticsNoPII('info', 'memory_files_started')

    const result: MemoryFileInfo[] = []
    const processedPaths = new Set<string>()
// getMemoryFiles 是整个记忆系统的入口，用 memoize 包住——它在每次构造上下文时都会被调用，但文件系统在会话内基本不变。注意 memoize 的键是 forceIncludeExternal（布尔），所以实际上只有两份缓存。
    const config = getCurrentProjectConfig()
    const includeExternal =
      forceIncludeExternal ||
      config.hasClaudeMdExternalIncludesApproved ||
      false
// includeExternal 的默认值来自项目配置的 hasClaudeMdExternalIncludesApproved：@include 指向项目外的文件属于敏感操作（等于让仓库里的文本读取任意本地文件），必须用户显式批准过才默认允许。

    // Process Managed file first (always loaded - policy settings)
    const managedClaudeMd = getMemoryPath('Managed')
    result.push(
      ...(await processMemoryFile(
        managedClaudeMd,
        'Managed',
        processedPaths,
        includeExternal,
      )),
    )
    // Process Managed .claude/rules/*.md files
    const managedClaudeRulesDir = getManagedClaudeRulesDir()
    result.push(
      ...(await processMdRules({
        rulesDir: managedClaudeRulesDir,
        type: 'Managed',
        processedPaths,
        includeExternal,
        conditionalRule: false,
      })),
    )

    // Process User file (only if userSettings is enabled)
    if (isSettingSourceEnabled('userSettings')) {
      const userClaudeMd = getMemoryPath('User')
      result.push(
        ...(await processMemoryFile(
          userClaudeMd,
          'User',
          processedPaths,
          true, // User memory can always include external files
        )),
      )
      // Process User ~/.claude/rules/*.md files
      const userClaudeRulesDir = getUserClaudeRulesDir()
      result.push(
        ...(await processMdRules({
          rulesDir: userClaudeRulesDir,
          type: 'User',
          processedPaths,
          includeExternal: true,
          conditionalRule: false,
        })),
      )
    }

    // Then process Project and Local files
    const dirs: string[] = []
    const originalCwd = getOriginalCwd()
    let currentDir = originalCwd

    while (currentDir !== parse(currentDir).root) {
      dirs.push(currentDir)
      currentDir = dirname(currentDir)
    }

    // When running from a git worktree nested inside its main repo (e.g.,
    // .claude/worktrees/<name>/ from `claude -w`), the upward walk passes
    // through both the worktree root and the main repo root. Both contain
    // checked-in files like CLAUDE.md and .claude/rules/*.md, so the same
    // content gets loaded twice. Skip Project-type (checked-in) files from
    // directories above the worktree but within the main repo — the worktree
    // already has its own checkout. CLAUDE.local.md is gitignored so it only
    // exists in the main repo and is still loaded.
    // See: https://github.com/anthropics/claude-code/issues/29599
    const gitRoot = findGitRoot(originalCwd)
    const canonicalRoot = findCanonicalGitRoot(originalCwd)
    const isNestedWorktree =
      gitRoot !== null &&
      canonicalRoot !== null &&
      normalizePathForComparison(gitRoot) !==
        normalizePathForComparison(canonicalRoot) &&
      pathInWorkingPath(gitRoot, canonicalRoot)
// 这一段解决的是 worktree 重复加载（issue 29599）：从 worktree 里的 cwd 向上走会同时穿过 worktree 根与主仓库根，两边都有 CLAUDE.md 与 .claude/rules，于是同样的内容被装两遍。判定方式是比较 findGitRoot 与 findCanonicalGitRoot——不同且前者在后者的子树内，就说明当前在嵌套 worktree 里；此时跳过主仓库侧目录的 **Project 类**文件。注意 CLAUDE.local.md 不跳过，它是 gitignore 的、只存在于主仓库。

    // Process from root downward to CWD
    for (const dir of dirs.reverse()) {
      // In a nested worktree, skip checked-in files from the main repo's
      // working tree (dirs inside canonicalRoot but outside the worktree).
      const skipProject =
        isNestedWorktree &&
        pathInWorkingPath(dir, canonicalRoot) &&
        !pathInWorkingPath(dir, gitRoot)

      // Try reading CLAUDE.md (Project) - only if projectSettings is enabled
      if (isSettingSourceEnabled('projectSettings') && !skipProject) {
        const projectPath = join(dir, 'CLAUDE.md')
        result.push(
          ...(await processMemoryFile(
            projectPath,
            'Project',
            processedPaths,
            includeExternal,
          )),
        )

        // Try reading .claude/CLAUDE.md (Project)
        const dotClaudePath = join(dir, '.claude', 'CLAUDE.md')
        result.push(
          ...(await processMemoryFile(
            dotClaudePath,
            'Project',
            processedPaths,
            includeExternal,
          )),
        )

        // Try reading .claude/rules/*.md files (Project)
        const rulesDir = join(dir, '.claude', 'rules')
        result.push(
          ...(await processMdRules({
            rulesDir,
            type: 'Project',
            processedPaths,
            includeExternal,
            conditionalRule: false,
          })),
        )
      }

      // Try reading CLAUDE.local.md (Local) - only if localSettings is enabled
      if (isSettingSourceEnabled('localSettings')) {
        const localPath = join(dir, 'CLAUDE.local.md')
        result.push(
          ...(await processMemoryFile(
            localPath,
            'Local',
            processedPaths,
            includeExternal,
          )),
        )
      }
    }
// 向上走的主循环按**从根到 cwd**的顺序处理（dirs.reverse()），这样越靠近 cwd 的文件越晚进列表，符合「后加载优先级更高」。每层依次试 CLAUDE.md、.claude/CLAUDE.md、.claude/rules 三个位置，各自受对应设置源开关控制。

    // Process CLAUDE.md from additional directories (--add-dir) if env var is enabled
    // This is controlled by CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD and defaults to off
    // Note: we don't check isSettingSourceEnabled('projectSettings') here because --add-dir
    // is an explicit user action and the SDK defaults settingSources to [] when not specified
    if (isEnvTruthy(process.env.CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD)) {
      const additionalDirs = getAdditionalDirectoriesForClaudeMd()
      for (const dir of additionalDirs) {
        // Try reading CLAUDE.md from the additional directory
        const projectPath = join(dir, 'CLAUDE.md')
        result.push(
          ...(await processMemoryFile(
            projectPath,
            'Project',
            processedPaths,
            includeExternal,
          )),
        )

        // Try reading .claude/CLAUDE.md from the additional directory
        const dotClaudePath = join(dir, '.claude', 'CLAUDE.md')
        result.push(
          ...(await processMemoryFile(
            dotClaudePath,
            'Project',
            processedPaths,
            includeExternal,
          )),
        )

        // Try reading .claude/rules/*.md files from the additional directory
        const rulesDir = join(dir, '.claude', 'rules')
        result.push(
          ...(await processMdRules({
            rulesDir,
            type: 'Project',
            processedPaths,
            includeExternal,
            conditionalRule: false,
          })),
        )
      }
    }
// --add-dir 附加目录的 CLAUDE.md 装载受环境变量控制且默认关闭。注释解释了为什么这里**不检查** projectSettings 开关：--add-dir 是用户的显式动作，而 SDK 在不指定时会把 settingSources 默认成空数组，若沿用那个开关，SDK 场景下附加目录的记忆会永远不生效。

    // Memdir entrypoint (memory.md) - only if feature is on and file exists
    if (isAutoMemoryEnabled()) {
      const { info: memdirEntry } = await safelyReadMemoryFileAsync(
        getAutoMemEntrypoint(),
        'AutoMem',
      )
      if (memdirEntry) {
        const normalizedPath = normalizePathForComparison(memdirEntry.path)
        if (!processedPaths.has(normalizedPath)) {
          processedPaths.add(normalizedPath)
          result.push(memdirEntry)
        }
      }
    }
// AutoMem 入口（自动记忆的 MEMORY.md）与下面的 TeamMem 入口走的是「直接读一个文件」而非目录遍历，且入列前要再查一次 processedPaths——它可能已经被 @include 提前装过，重复注入等于同一份内容在上下文里出现两遍。

    // Team memory entrypoint - only if feature is on and file exists
    if (feature('TEAMMEM') && teamMemPaths!.isTeamMemoryEnabled()) {
      const { info: teamMemEntry } = await safelyReadMemoryFileAsync(
        teamMemPaths!.getTeamMemEntrypoint(),
        'TeamMem',
      )
      if (teamMemEntry) {
        const normalizedPath = normalizePathForComparison(teamMemEntry.path)
        if (!processedPaths.has(normalizedPath)) {
          processedPaths.add(normalizedPath)
          result.push(teamMemEntry)
        }
      }
    }
// TeamMem 分支整体被 feature('TEAMMEM') 包住，模块也是按需 require，未开启该特性的构建里这段代码与模块都不存在。

    const totalContentLength = result.reduce(
      (sum, f) => sum + f.content.length,
      0,
    )

    logForDiagnosticsNoPII('info', 'memory_files_completed', {
      duration_ms: Date.now() - startTime,
      file_count: result.length,
      total_content_length: totalContentLength,
    })

    const typeCounts: Record<string, number> = {}
    for (const f of result) {
      typeCounts[f.type] = (typeCounts[f.type] ?? 0) + 1
    }

    if (!hasLoggedInitialLoad) {
      hasLoggedInitialLoad = true
      logEvent('tengu_claudemd__initial_load', {
        file_count: result.length,
        total_content_length: totalContentLength,
        user_count: typeCounts['User'] ?? 0,
        project_count: typeCounts['Project'] ?? 0,
        local_count: typeCounts['Local'] ?? 0,
        managed_count: typeCounts['Managed'] ?? 0,
        automem_count: typeCounts['AutoMem'] ?? 0,
        ...(feature('TEAMMEM')
          ? { teammem_count: typeCounts['TeamMem'] ?? 0 }
          : {}),
        duration_ms: Date.now() - startTime,
      })
    }
// 初始装载埋点只上报一次（hasLoggedInitialLoad 门闩），因为 getMemoryFiles 会在每次重建上下文时被调用，每次上报会把事件量放大几十倍。埋点带各类型文件计数，用来判断「用户到底在用哪种记忆」。

    // Fire InstructionsLoaded hook for each instruction file loaded
    // (fire-and-forget, audit/observability only).
    // AutoMem/TeamMem are intentionally excluded — they're a separate
    // memory system, not "instructions" in the CLAUDE.md/rules sense.
    // Gated on !forceIncludeExternal: the forceIncludeExternal=true variant
    // is only used by getExternalClaudeMdIncludes() for approval checks, not
    // for building context — firing the hook there would double-fire on startup.
    // The one-shot flag is consumed on every !forceIncludeExternal cache miss
    // (NOT gated on hasInstructionsLoadedHook) so the flag is released even
    // when no hook is configured — otherwise a mid-session hook registration
    // followed by a direct .cache.clear() would spuriously fire with a stale
    // 'session_start' reason.
    if (!forceIncludeExternal) {
      const eagerLoadReason = consumeNextEagerLoadReason()
      if (eagerLoadReason !== undefined && hasInstructionsLoadedHook()) {
        for (const file of result) {
          if (!isInstructionsMemoryType(file.type)) continue
          const loadReason = file.parent ? 'include' : eagerLoadReason
          void executeInstructionsLoadedHooks(
            file.path,
            file.type,
            loadReason,
            {
              globs: file.globs,
              parentFilePath: file.parent,
            },
          )
        }
      }
    }
// InstructionsLoaded 钩子这段的注释是全文件最长的一段工程账，讲清了三件事：① AutoMem/TeamMem 刻意排除——它们是另一套记忆系统，不属于 CLAUDE.md 意义上的「指令」；② 只在非 forceIncludeExternal 时触发，因为那个变体专供外部包含审批检查，在启动时会再跑一次，钩子会双触发；③ 一次性标志在**每次缓存未命中**时消耗（不管有没有配钩子），否则「会话中途注册钩子 + 手动清缓存」的组合会让标志一直挂着，之后以过期的 session_start 理由误触发。

    return result
  },
)
// getMemoryFiles 到此结束。需要注意它是一个 memoize 包裹的异步函数：并发调用会共享同一个 Promise，所以它天然是单飞的——这也是全仓很多地方敢直接调用它的前提。

function isInstructionsMemoryType(
  type: MemoryType,
): type is InstructionsMemoryType {
  return (
    type === 'User' ||
    type === 'Project' ||
    type === 'Local' ||
    type === 'Managed'
  )
}
// isInstructionsMemoryType 是类型守卫，把 MemoryType 收窄成四类（不含 AutoMem/TeamMem）。用谓词函数而非内联判断，是为了让编译器在循环里自动收窄类型。

// Load reason to report for top-level (non-included) files on the next eager
// getMemoryFiles() pass. Set to 'compact' by resetGetMemoryFilesCache when
// compaction clears the cache, so the InstructionsLoaded hook reports the
// reload correctly instead of misreporting it as 'session_start'. One-shot:
// reset to 'session_start' after being read.
let nextEagerLoadReason: InstructionsLoadReason = 'session_start'

// Whether the InstructionsLoaded hook should fire on the next cache miss.
// true initially (for session_start), consumed after firing, re-enabled only
// by resetGetMemoryFilesCache(). Callers that only need cache invalidation
// for correctness (e.g. worktree enter/exit, settings sync, /memory dialog)
// should use clearMemoryFileCaches() instead to avoid spurious hook fires.
let shouldFireHook = true

function consumeNextEagerLoadReason(): InstructionsLoadReason | undefined {
  if (!shouldFireHook) return undefined
  shouldFireHook = false
  const reason = nextEagerLoadReason
  nextEagerLoadReason = 'session_start'
  return reason
}
// nextEagerLoadReason 与 shouldFireHook 这一对变量实现的是「**一次性事件标记**」：重置缓存时写入「这次为什么重载」（compaction / session_start / ...），下次装载读完即重置。这样钩子能拿到准确理由，而不会把所有重载都报成 session_start。

/**
 * Clears the getMemoryFiles memoize cache
 * without firing the InstructionsLoaded hook.
 *
 * Use this for cache invalidation that is purely for correctness (e.g.
 * worktree enter/exit, settings sync, /memory dialog). For events that
 * represent instructions actually being reloaded into context (e.g.
 * compaction), use resetGetMemoryFilesCache() instead.
 */
export function clearMemoryFileCaches(): void {
  // ?.cache because tests spyOn this, which replaces the memoize wrapper.
  getMemoryFiles.cache?.clear?.()
}
// clearMemoryFileCaches 与下面的 resetGetMemoryFilesCache 是两个不同用途的入口，注释把边界划得很清楚：纯粹为了**正确性**的失效（进出 worktree、设置同步、/memory 对话框）用前者，不触发钩子；代表「指令真的被重新载入上下文」的事件（压缩）用后者，会触发钩子。混用会导致钩子误报或漏报。?? 可选链是因为测试会 spyOn 替换掉 memoize 包装。

export function resetGetMemoryFilesCache(
  reason: InstructionsLoadReason = 'session_start',
): void {
  nextEagerLoadReason = reason
  shouldFireHook = true
  clearMemoryFileCaches()
}
// resetGetMemoryFilesCache 写理由、置钩子标志、清缓存三步，顺序不能反：先设理由再清缓存，否则并发的那次装载可能读到旧理由。

export function getLargeMemoryFiles(files: MemoryFileInfo[]): MemoryFileInfo[] {
  return files.filter(f => f.content.length > MAX_MEMORY_CHARACTER_COUNT)
}
// getLargeMemoryFiles 用 40,000 字符这个常量筛「过大」文件。它不是硬限制而是提示阈值——超了会提示用户精简，但不阻止加载。

/**
 * When tengu_moth_copse is on, the findRelevantMemories prefetch surfaces
 * memory files via attachments, so the MEMORY.md index is no longer injected
 * into the system prompt. Callsites that care about "what's actually in
 * context" (context builder, /context viz) should filter through this.
 */
export function filterInjectedMemoryFiles(
  files: MemoryFileInfo[],
): MemoryFileInfo[] {
  const skipMemoryIndex = getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_moth_copse',
    false,
  )
  if (!skipMemoryIndex) return files
  return files.filter(f => f.type !== 'AutoMem' && f.type !== 'TeamMem')
}
// filterInjectedMemoryFiles 处理一个特性开关引起的语义分叉：tengu_moth_copse 开启后，记忆检索改为「按相关性预取并以附件形式注入」，MEMORY.md 索引不再进系统提示。于是「什么真的在上下文里」这个问题有了两个答案，关心它的地方（上下文构建、/context 可视化）必须过这个过滤器，否则会把没注入的文件算进去。

export const getClaudeMds = (
  memoryFiles: MemoryFileInfo[],
  filter?: (type: MemoryType) => boolean,
): string => {
  const memories: string[] = []
  const skipProjectLevel = getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_paper_halyard',
    false,
  )

  for (const file of memoryFiles) {
    if (filter && !filter(file.type)) continue
    if (skipProjectLevel && (file.type === 'Project' || file.type === 'Local'))
      continue
    if (file.content) {
      const description =
        file.type === 'Project'
          ? ' (project instructions, checked into the codebase)'
          : file.type === 'Local'
            ? " (user's private project instructions, not checked in)"
            : feature('TEAMMEM') && file.type === 'TeamMem'
              ? ' (shared team memory, synced across the organization)'
              : file.type === 'AutoMem'
                ? " (user's auto-memory, persists across conversations)"
                : " (user's private global instructions for all projects)"

      const content = file.content.trim()
      if (feature('TEAMMEM') && file.type === 'TeamMem') {
        memories.push(
          `Contents of ${file.path}${description}:\n\n<team-memory-content source="shared">\n${content}\n</team-memory-content>`,
        )
      } else {
        memories.push(`Contents of ${file.path}${description}:\n\n${content}`)
      }
    }
  }

  if (memories.length === 0) {
    return ''
  }

  return `${MEMORY_INSTRUCTION_PROMPT}\n\n${memories.join('\n\n')}`
}
// getClaudeMds 把文件列表渲染成最终注入的文本。三处设计：① 每个文件前加一句「Contents of 路径 + 括号说明」，括号文案按类型区分（入库项目说明 / 未入库私人说明 / 团队共享 / 自动记忆 / 用户全局），让模型知道这份指令的**权威级别**；② TeamMem 额外包一层带 source 属性的自定义标签，便于下游识别团队记忆的边界；③ 全部为空时返回空字符串而不是只返回那段总纲，避免「有指令但没内容」的空壳。

/**
 * Gets managed and user conditional rules that match the target path.
 * This is the first phase of nested memory loading.
 *
 * @param targetPath The target file path to match against glob patterns
 * @param processedPaths Set of already processed file paths (will be mutated)
 * @returns Array of MemoryFileInfo objects for matching conditional rules
 */
export async function getManagedAndUserConditionalRules(
  targetPath: string,
  processedPaths: Set<string>,
): Promise<MemoryFileInfo[]> {
  const result: MemoryFileInfo[] = []

  // Process Managed conditional .claude/rules/*.md files
  const managedClaudeRulesDir = getManagedClaudeRulesDir()
  result.push(
    ...(await processConditionedMdRules(
      targetPath,
      managedClaudeRulesDir,
      'Managed',
      processedPaths,
      false,
    )),
  )

  if (isSettingSourceEnabled('userSettings')) {
    // Process User conditional .claude/rules/*.md files
    const userClaudeRulesDir = getUserClaudeRulesDir()
    result.push(
      ...(await processConditionedMdRules(
        targetPath,
        userClaudeRulesDir,
        'User',
        processedPaths,
        true,
      )),
    )
  }

  return result
}

/**
 * Gets memory files for a single nested directory (between CWD and target).
 * Loads CLAUDE.md, unconditional rules, and conditional rules for that directory.
 *
 * @param dir The directory to process
 * @param targetPath The target file path (for conditional rule matching)
 * @param processedPaths Set of already processed file paths (will be mutated)
 * @returns Array of MemoryFileInfo objects
 */
export async function getMemoryFilesForNestedDirectory(
  dir: string,
  targetPath: string,
  processedPaths: Set<string>,
): Promise<MemoryFileInfo[]> {
  const result: MemoryFileInfo[] = []

  // Process project memory files (CLAUDE.md and .claude/CLAUDE.md)
  if (isSettingSourceEnabled('projectSettings')) {
    const projectPath = join(dir, 'CLAUDE.md')
    result.push(
      ...(await processMemoryFile(
        projectPath,
        'Project',
        processedPaths,
        false,
      )),
    )
    const dotClaudePath = join(dir, '.claude', 'CLAUDE.md')
    result.push(
      ...(await processMemoryFile(
        dotClaudePath,
        'Project',
        processedPaths,
        false,
      )),
    )
  }
// getManagedAndUserConditionalRules 是「条件规则」的两阶段装载的第一阶段：Managed 与 User 层级的带 paths 规则会在**每次读取目标文件之前**按 glob 匹配注入。Project 层的条件规则由后面的按目录函数处理，因为它的 glob 是相对于 .claude 的父目录，基准不同。

  // Process local memory file (CLAUDE.local.md)
  if (isSettingSourceEnabled('localSettings')) {
    const localPath = join(dir, 'CLAUDE.local.md')
    result.push(
      ...(await processMemoryFile(localPath, 'Local', processedPaths, false)),
    )
  }
// User 条件规则的 includeExternal 传 true（用户全局目录天然允许引用外部文件），Managed 传 false（企业策略应自包含）。

  const rulesDir = join(dir, '.claude', 'rules')

  // Process project unconditional .claude/rules/*.md files, which were not eagerly loaded
  // Use a separate processedPaths set to avoid marking conditional rule files as processed
  const unconditionalProcessedPaths = new Set(processedPaths)
  result.push(
    ...(await processMdRules({
      rulesDir,
      type: 'Project',
      processedPaths: unconditionalProcessedPaths,
      includeExternal: false,
      conditionalRule: false,
    })),
  )

  // Process project conditional .claude/rules/*.md files
  result.push(
    ...(await processConditionedMdRules(
      targetPath,
      rulesDir,
      'Project',
      processedPaths,
      false,
    )),
  )

  // processedPaths must be seeded with unconditional paths for subsequent directories
  for (const path of unconditionalProcessedPaths) {
    processedPaths.add(path)
  }
// getMemoryFilesForNestedDirectory 里有一处精妙的 Set 复制：处理无条件规则时用 unconditionalProcessedPaths（processedPaths 的副本），处理完条件规则后再把副本并回主集。原因写在注释里——如果无条件规则直接用主集，那些文件会被标记成「已处理」，而后面的条件规则遍历就会跳过它们，导致同一目录的带 paths 规则永远匹配不到。

  return result
}
// 该函数只处理 cwd 到目标之间的**单层目录**，由调用方按目录逐个调用，这样嵌套目录的装载顺序完全可控。

/**
 * Gets conditional rules for a CWD-level directory (from root up to CWD).
 * Only processes conditional rules since unconditional rules are already loaded eagerly.
 *
 * @param dir The directory to process
 * @param targetPath The target file path (for conditional rule matching)
 * @param processedPaths Set of already processed file paths (will be mutated)
 * @returns Array of MemoryFileInfo objects
 */
export async function getConditionalRulesForCwdLevelDirectory(
  dir: string,
  targetPath: string,
  processedPaths: Set<string>,
): Promise<MemoryFileInfo[]> {
  const rulesDir = join(dir, '.claude', 'rules')
  return processConditionedMdRules(
    targetPath,
    rulesDir,
    'Project',
    processedPaths,
    false,
  )
}
// getConditionalRulesForCwdLevelDirectory 只处理条件规则：cwd 及以上目录的无条件规则在启动时已经被 eager 装载过，重复处理只会造成重复注入。

/**
 * Processes all .md files in the .claude/rules/ directory and its subdirectories,
 * filtering to only include files with frontmatter paths that match the target path
 * @param targetPath The file path to match against frontmatter glob patterns
 * @param rulesDir The path to the rules directory
 * @param type Type of memory file (User, Project, Local)
 * @param processedPaths Set of already processed file paths
 * @param includeExternal Whether to include external files
 * @returns Array of MemoryFileInfo objects that match the target path
 */
export async function processConditionedMdRules(
  targetPath: string,
  rulesDir: string,
  type: MemoryType,
  processedPaths: Set<string>,
  includeExternal: boolean,
): Promise<MemoryFileInfo[]> {
  const conditionedRuleMdFiles = await processMdRules({
    rulesDir,
    type,
    processedPaths,
    includeExternal,
    conditionalRule: true,
  })

  // Filter to only include files whose globs patterns match the targetPath
  return conditionedRuleMdFiles.filter(file => {
    if (!file.globs || file.globs.length === 0) {
      return false
    }

    // For Project rules: glob patterns are relative to the directory containing .claude
    // For Managed/User rules: glob patterns are relative to the original CWD
    const baseDir =
      type === 'Project'
        ? dirname(dirname(rulesDir)) // Parent of .claude
        : getOriginalCwd() // Project root for managed/user rules

    const relativePath = isAbsolute(targetPath)
      ? relative(baseDir, targetPath)
      : targetPath
    // ignore() throws on empty strings, paths escaping the base (../),
    // and absolute paths (Windows cross-drive relative() returns absolute).
    // Files outside baseDir can't match baseDir-relative globs anyway.
    if (
      !relativePath ||
      relativePath.startsWith('..') ||
      isAbsolute(relativePath)
    ) {
      return false
    }
    return ignore().add(file.globs).ignores(relativePath)
  })
}
// processConditionedMdRules 是条件规则的匹配器，基准目录的取法对两类规则不同：Project 规则的 glob 相对 .claude 的父目录（即 rulesDir 往上两级），Managed/User 规则相对原始 cwd。三处防错：① 相对化后为空、以 .. 开头、或仍是绝对路径的，一律判不匹配（Windows 跨盘符时 relative 会直接返回绝对路径，ignore 库遇到这种输入会抛）；② 越出基准目录的文件本来也匹配不了相对 glob；③ 匹配用 ignore 库而非 picomatch——这里要的是 gitignore 语义（取反、目录匹配），与排除项用的 picomatch 球状语义不同。

export type ExternalClaudeMdInclude = {
  path: string
  parent: string
}

export function getExternalClaudeMdIncludes(
  files: MemoryFileInfo[],
): ExternalClaudeMdInclude[] {
  const externals: ExternalClaudeMdInclude[] = []
  for (const file of files) {
    if (file.type !== 'User' && file.parent && !pathInOriginalCwd(file.path)) {
      externals.push({ path: file.path, parent: file.parent })
    }
  }
  return externals
}
// getExternalClaudeMdIncludes 找「非 User 类型、有父文件、且路径在项目外」的条目——即通过 @include 从项目外拉进来的文件。这个集合是审批 UI 的数据源：用户必须看到「哪个仓库文件引用了哪个外部路径」才能决定是否授权。

export function hasExternalClaudeMdIncludes(files: MemoryFileInfo[]): boolean {
  return getExternalClaudeMdIncludes(files).length > 0
}
// hasExternalClaudeMdIncludes 只是长度判断，单独抽成函数是为了调用方语义清晰（不必写 .length > 0）。

export async function shouldShowClaudeMdExternalIncludesWarning(): Promise<boolean> {
  const config = getCurrentProjectConfig()
  if (
    config.hasClaudeMdExternalIncludesApproved ||
    config.hasClaudeMdExternalIncludesWarningShown
  ) {
    return false
  }

  return hasExternalClaudeMdIncludes(await getMemoryFiles(true))
}
// shouldShowClaudeMdExternalIncludesWarning 的两个提前返回条件：已批准过、或已展示过警告。注意它调用 getMemoryFiles(true) 强制包含外部文件——若用默认参数，外部文件根本不会被装载，这个检查就永远为假。

/**
 * Check if a file path is a memory file (CLAUDE.md, CLAUDE.local.md, or .claude/rules/*.md)
 */
export function isMemoryFilePath(filePath: string): boolean {
  const name = basename(filePath)

  // CLAUDE.md or CLAUDE.local.md anywhere
  if (name === 'CLAUDE.md' || name === 'CLAUDE.local.md') {
    return true
  }

  // .md files in .claude/rules/ directories
  if (
    name.endsWith('.md') &&
    filePath.includes(`${sep}.claude${sep}rules${sep}`)
  ) {
    return true
  }

  return false
}
// isMemoryFilePath 是路径归类：名字是 CLAUDE.md 或 CLAUDE.local.md（任意目录），或位于 .claude/rules 下的 .md。用 sep 拼路径片段而不是写死斜杠，Windows 才不会漏判。

/**
 * Get all memory file paths from both standard discovery and readFileState.
 * Combines:
 * - getMemoryFiles() paths (CWD upward to root)
 * - readFileState paths matching memory patterns (includes child directories)
 */
export function getAllMemoryFilePaths(
  files: MemoryFileInfo[],
  readFileState: FileStateCache,
): string[] {
  const paths = new Set<string>()
  for (const file of files) {
    if (file.content.trim().length > 0) {
      paths.add(file.path)
    }
  }

  // Add memory files from readFileState (includes child directories)
  for (const filePath of cacheKeys(readFileState)) {
    if (isMemoryFilePath(filePath)) {
      paths.add(filePath)
    }
  }

  return Array.from(paths)
}
// getAllMemoryFilePaths 把两个来源合并：① getMemoryFiles 走「cwd 向上到根」的标准发现；② readFileState 缓存里的记忆类文件——后者能覆盖**子目录**（标准发现只向上走，不向下），于是用户编辑过的子目录规则也能被统计到。用 Set 去重，且第一条来源要求内容非空白（空文件不算「有记忆」）。
