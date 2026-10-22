import { type StructuredPatchHunk, structuredPatch } from 'diff'
import { logError } from 'src/utils/log.js'
import { expandPath } from 'src/utils/path.js'
import { countCharInString } from 'src/utils/stringUtils.js'
import {
  DIFF_TIMEOUT_MS,
  getPatchForDisplay,
  getPatchFromContents,
} from '../../utils/diff.js'
import { errorMessage, isENOENT } from '../../utils/errors.js'
import {
  addLineNumbers,
  convertLeadingTabsToSpaces,
  readFileSyncCached,
} from '../../utils/file.js'
import type { EditInput, FileEdit } from './types.js'

// Claude can't output curly quotes, so we define them as constants here for Claude to use
// in the code. We do this because we normalize curly quotes to straight quotes
// when applying edits.
export const LEFT_SINGLE_CURLY_QUOTE = '‘'
// 这四行常量解释了一个反直觉的事实：**模型根本打不出弯引号**（curly quotes，U+2018/2019/201C/201D）——API 层会把它们规范化成直引号。可是真实代码库里遍地都是弯引号（尤其 markdown、法语文案、从别处粘来的注释）。所以策略是「双向翻译」：匹配前把两边的弯引号都归一成直引号，写回时再把 `new_string` 的风格还原成文件原本的样子。这四个常量存在的意义是让 Claude **在代码里显式引用**弯引号字符——比如它要写一个替换弯引号的正则，只能靠这些导出。
export const RIGHT_SINGLE_CURLY_QUOTE = '’'
export const LEFT_DOUBLE_CURLY_QUOTE = '“'
export const RIGHT_DOUBLE_CURLY_QUOTE = '”'

/**
 * Normalizes quotes in a string by converting curly quotes to straight quotes
 * @param str The string to normalize
 * @returns The string with all curly quotes replaced by straight quotes
 */
export function normalizeQuotes(str: string): string {
  return str
    .replaceAll(LEFT_SINGLE_CURLY_QUOTE, "'")
    .replaceAll(RIGHT_SINGLE_CURLY_QUOTE, "'")
    .replaceAll(LEFT_DOUBLE_CURLY_QUOTE, '"')
    .replaceAll(RIGHT_DOUBLE_CURLY_QUOTE, '"')
}

/**
 * Strips trailing whitespace from each line in a string while preserving line endings
 * @param str The string to process
 * @returns The string with trailing whitespace removed from each line
 */
export function stripTrailingWhitespace(str: string): string {
  // Handle different line endings: CRLF, LF, CR
  // Use a regex that matches line endings and captures them
  const lines = str.split(/(\r\n|\n|\r)/)
// `split` 带**捕获组**是这里的关键手法：正则里有括号，切分结果会把分隔符本身也留在数组里，于是数组变成「内容、换行、内容、换行……」交替。偶数下标是行内容（去掉尾部空白），奇数下标是换行符（原样保留）。这样 CRLF、LF、CR 三种行尾都不会被破坏——如果用 `split('\n')` 再 `join`，CRLF 文件的 `\r` 会被抹掉，整个文件的换行风格就被悄悄改了。

  let result = ''
  for (let i = 0; i < lines.length; i++) {
    const part = lines[i]
    if (part !== undefined) {
      if (i % 2 === 0) {
        // Even indices are line content
        result += part.replace(/\s+$/, '')
      } else {
        // Odd indices are line endings
        result += part
      }
    }
  }

  return result
}

/**
 * Finds the actual string in the file content that matches the search string,
 * accounting for quote normalization
 * @param fileContent The file content to search in
 * @param searchString The string to search for
 * @returns The actual string found in the file, or null if not found
 */
export function findActualString(
  fileContent: string,
  searchString: string,
): string | null {
  // First try exact match
  if (fileContent.includes(searchString)) {
    return searchString
  }

  // Try with normalized quotes
  const normalizedSearch = normalizeQuotes(searchString)
  const normalizedFile = normalizeQuotes(fileContent)

  const searchIndex = normalizedFile.indexOf(normalizedSearch)
  if (searchIndex !== -1) {
    // Find the actual string in the file that matches
    return fileContent.substring(searchIndex, searchIndex + searchString.length)
// 注意返回的是 `fileContent.substring(...)` —— **文件里的原文片段，不是传进来的 `searchString`**。这是整个模块成立的基石：后面所有替换都用这个「实际字符串」，而不是模型给的那份。因为两份可能在引号、空白上不同，用模型的版本去 `replace` 会匹配不上（或匹配到别处）。
  }

  return null
}

/**
 * When old_string matched via quote normalization (curly quotes in file,
 * straight quotes from model), apply the same curly quote style to new_string
 * so the edit preserves the file's typography.
 *
 * Uses a simple open/close heuristic: a quote character preceded by whitespace,
 * start of string, or opening punctuation is treated as an opening quote;
 * otherwise it's a closing quote.
 */
// `preserveQuoteStyle` 回答的问题是：**文件用弯引号、模型用直引号时，改完那块要不要保持弯引号？** 答案是保持——否则同一个句子里前后两半的引号风格会不一致，diff 里看起来像被故意改坏了。做法很朴素：先看 `actualOldString`（文件里的实际片段）里有哪种弯引号，再把 `new_string` 里的直引号按同风格转换。
export function preserveQuoteStyle(
  oldString: string,
  actualOldString: string,
  newString: string,
): string {
  // If they're the same, no normalization happened
  if (oldString === actualOldString) {
    return newString
  }

  // Detect which curly quote types were in the file
  const hasDoubleQuotes =
    actualOldString.includes(LEFT_DOUBLE_CURLY_QUOTE) ||
    actualOldString.includes(RIGHT_DOUBLE_CURLY_QUOTE)
  const hasSingleQuotes =
    actualOldString.includes(LEFT_SINGLE_CURLY_QUOTE) ||
    actualOldString.includes(RIGHT_SINGLE_CURLY_QUOTE)

  if (!hasDoubleQuotes && !hasSingleQuotes) {
    return newString
  }

  let result = newString

  if (hasDoubleQuotes) {
    result = applyCurlyDoubleQuotes(result)
  }
  if (hasSingleQuotes) {
    result = applyCurlySingleQuotes(result)
  }

  return result
}

function isOpeningContext(chars: string[], index: number): boolean {
// 开引号/闭引号的判定是个**启发式**：字符串开头、或者前一个字符是空白 / 左括号 / 左方括号 / 左花括号 / 破折号 → 开引号，否则闭引号。够用的原因：英文排版里引号前面几乎总是这几类字符。注意它只看**前一个**字符，不看后一个——所以「引号出现在词中间」这种病态情况会被判成闭引号，但那本来也不是正常排版。
  if (index === 0) {
    return true
  }
  const prev = chars[index - 1]
  return (
    prev === ' ' ||
    prev === '\t' ||
    prev === '\n' ||
    prev === '\r' ||
    prev === '(' ||
    prev === '[' ||
    prev === '{' ||
    prev === '\u2014' || // em dash
    prev === '\u2013' // en dash
  )
}

function applyCurlyDoubleQuotes(str: string): string {
  const chars = [...str]
  const result: string[] = []
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === '"') {
      result.push(
        isOpeningContext(chars, i)
          ? LEFT_DOUBLE_CURLY_QUOTE
          : RIGHT_DOUBLE_CURLY_QUOTE,
      )
    } else {
      result.push(chars[i]!)
    }
  }
  return result.join('')
}

function applyCurlySingleQuotes(str: string): string {
  const chars = [...str]
  const result: string[] = []
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === "'") {
// 单引号比双引号多一条规则：**缩写里的撇号**（`don't`、`it's`）不是引号，但要转成 `RIGHT_SINGLE_CURLY_QUOTE`（右单弯引号）而不是左。判据是「前后都是字母」（`\p{L}` 带 `u` 标志，所以非 ASCII 字母也算）。这条规则不加的话，`don't` 会被改成 `don‘t`——开引号，视觉上完全错。
      // Don't convert apostrophes in contractions (e.g., "don't", "it's")
      // An apostrophe between two letters is a contraction, not a quote
      const prev = i > 0 ? chars[i - 1] : undefined
      const next = i < chars.length - 1 ? chars[i + 1] : undefined
      const prevIsLetter = prev !== undefined && /\p{L}/u.test(prev)
      const nextIsLetter = next !== undefined && /\p{L}/u.test(next)
      if (prevIsLetter && nextIsLetter) {
        // Apostrophe in a contraction — use right single curly quote
        result.push(RIGHT_SINGLE_CURLY_QUOTE)
      } else {
        result.push(
          isOpeningContext(chars, i)
            ? LEFT_SINGLE_CURLY_QUOTE
            : RIGHT_SINGLE_CURLY_QUOTE,
        )
      }
    } else {
      result.push(chars[i]!)
    }
  }
  return result.join('')
}

/**
 * Transform edits to ensure replace_all always has a boolean value
 * @param edits Array of edits with optional replace_all
 * @returns Array of edits with replace_all guaranteed to be boolean
 */
export function applyEditToFile(
  originalContent: string,
  oldString: string,
  newString: string,
  replaceAll: boolean = false,
): string {
// `f` 里那个 `() => replace` **不是多余的包装**。`String.prototype.replace` 的第二个参数若是字符串，`$&`、`$1`、`$$` 会被当成反向引用解释——而模型给的 `new_string` 里完全可能包含 `$&`（比如它在改一段 shell 脚本或正则）。传函数就没有这个解释过程，返回值原样插入。这也是整个仓反复出现的同一个坑（参见 `MagicDocs/prompts.ts` 的 `substituteVariables`）。
  const f = replaceAll
    ? (content: string, search: string, replace: string) =>
        content.replaceAll(search, () => replace)
    : (content: string, search: string, replace: string) =>
        content.replace(search, () => replace)

  if (newString !== '') {
    return f(originalContent, oldString, newString)
  }

// 这个特殊分支专门处理「**删除整行**」：`old_string` 不带结尾换行、但文件里那一行后面有换行。直接替换会留下一个空行（行的内容没了、换行还在）。所以先探测「`old_string + '\n'` 是否在文件里」，在的话连换行一起删。注意只在 `new_string === ''` 时才走这个逻辑——非空替换不需要，多余的换行删除反而会吃掉后面的结构。
  const stripTrailingNewline =
    !oldString.endsWith('\n') && originalContent.includes(oldString + '\n')

  return stripTrailingNewline
    ? f(originalContent, oldString + '\n', newString)
    : f(originalContent, oldString, newString)
}

/**
 * Applies an edit to a file and returns the patch and updated file.
 * Does not write the file to disk.
 */
export function getPatchForEdit({
  filePath,
  fileContents,
  oldString,
  newString,
  replaceAll = false,
}: {
  filePath: string
  fileContents: string
  oldString: string
  newString: string
  replaceAll?: boolean
}): { patch: StructuredPatchHunk[]; updatedFile: string } {
  return getPatchForEdits({
    filePath,
    fileContents,
    edits: [
      { old_string: oldString, new_string: newString, replace_all: replaceAll },
    ],
  })
}

/**
 * Applies a list of edits to a file and returns the patch and updated file.
 * Does not write the file to disk.
 *
 * NOTE: The returned patch is to be used for display purposes only - it has spaces instead of tabs
 */
export function getPatchForEdits({
  filePath,
  fileContents,
  edits,
}: {
  filePath: string
  fileContents: string
  edits: FileEdit[]
}): { patch: StructuredPatchHunk[]; updatedFile: string } {
  let updatedFile = fileContents
  const appliedNewStrings: string[] = []

  // Special case for empty files.
  if (
    !fileContents &&
    edits.length === 1 &&
    edits[0] &&
    edits[0].old_string === '' &&
    edits[0].new_string === ''
  ) {
    const patch = getPatchForDisplay({
      filePath,
      fileContents,
      edits: [
        {
          old_string: fileContents,
          new_string: updatedFile,
          replace_all: false,
        },
      ],
    })
    return { patch, updatedFile: '' }
  }

  // Apply each edit and check if it actually changes the file
  for (const edit of edits) {
    // Strip trailing newlines from old_string before checking
    const oldStringToCheck = edit.old_string.replace(/\n+$/, '')
// 做「旧串是否落在上一条新串里」这个检查之前，先把 `old_string` 的**尾部换行剥掉**。原因：多行 `old_string` 通常带结尾换行，而 `new_string` 里嵌的内容往往不带，不剥就会漏判——漏判的后果是允许了一组会自我吞噬的编辑（第二条把第一条刚写进去的东西又改回去）。

    // Check if old_string is a substring of any previously applied new_string
    for (const previousNewString of appliedNewStrings) {
      if (
        oldStringToCheck !== '' &&
        previousNewString.includes(oldStringToCheck)
      ) {
        throw new Error(
          'Cannot edit file: old_string is a substring of a new_string from a previous edit.',
        )
      }
    }

    const previousContent = updatedFile
    updatedFile =
      edit.old_string === ''
        ? edit.new_string
        : applyEditToFile(
            updatedFile,
            edit.old_string,
            edit.new_string,
            edit.replace_all,
          )

    // If this edit didn't change anything, throw an error
    if (updatedFile === previousContent) {
      throw new Error('String not found in file. Failed to apply edit.')
    }

    // Track the new string that was applied
    appliedNewStrings.push(edit.new_string)
  }

  if (updatedFile === fileContents) {
    throw new Error(
      'Original and edited file match exactly. Failed to apply edit.',
    )
  }

// 这段注释是一次**性能回归的记录**：早期这里走 `getPatchForDisplay({edits:[{old: 全文, new: 全文}]})`，那条路径会把 `fileContents` 处理两遍（一次当 `preparedFileContents`，一次当 `escapedOldString` 进 reduce），还跑一次无意义的全文 `replace`。改成直接调 `getPatchFromContents` 后大文件省约 20%。注意传进去之前都过了 `convertLeadingTabsToSpaces`——**patch 只用于展示**，所以 tab 统一成空格不影响真正写盘的内容。
  // We already have before/after content, so call getPatchFromContents directly.
  // Previously this went through getPatchForDisplay with edits=[{old:fileContents,new:updatedFile}],
  // which transforms fileContents twice (once as preparedFileContents, again as escapedOldString
  // inside the reduce) and runs a no-op full-content .replace(). This saves ~20% on large files.
  const patch = getPatchFromContents({
    filePath,
    oldContent: convertLeadingTabsToSpaces(fileContents),
    newContent: convertLeadingTabsToSpaces(updatedFile),
  })

  return { patch, updatedFile }
}

// Cap on edited_text_file attachment snippets. Format-on-save of a large file
// previously injected the entire file per turn (observed max 16.1KB, ~14K
// tokens/session). 8KB preserves meaningful context while bounding worst case.
const DIFF_SNIPPET_MAX_BYTES = 8192
// 8KB 这个上限是**观测出来的**，不是拍的：注释说曾经见过「保存时格式化大文件」导致每轮注入整个文件，实测最大 16.1KB、约 14K token/会话。截到 8KB 既保留有意义的上下文，又给最坏情况封顶。这类常量最值得学的是**写清楚它是怎么来的**——否则后人只能猜。

/**
 * Used for attachments, to show snippets when files change.
 *
 * TODO: Unify this with the other snippet logic.
 */
export function getSnippetForTwoFileDiff(
  fileAContents: string,
  fileBContents: string,
): string {
  const patch = structuredPatch(
    'file.txt',
    'file.txt',
    fileAContents,
    fileBContents,
    undefined,
    undefined,
    {
      context: 8,
      timeout: DIFF_TIMEOUT_MS,
    },
  )

  if (!patch) {
    return ''
  }

  const full = patch.hunks
    .map(_ => ({
      startLine: _.oldStart,
      content: _.lines
        // Filter out deleted lines AND diff metadata lines
        .filter(_ => !_.startsWith('-') && !_.startsWith('\\'))
        .map(_ => _.slice(1))
        .join('\n'),
    }))
    .map(addLineNumbers)
    .join('\n...\n')

  if (full.length <= DIFF_SNIPPET_MAX_BYTES) {
    return full
  }

  // Truncate at the last line boundary that fits within the cap.
  // Marker format matches BashTool/utils.ts.
  const cutoff = full.lastIndexOf('\n', DIFF_SNIPPET_MAX_BYTES)
// 截断位置取**最后一个完整行边界**（`lastIndexOf('\n', 上限)`），而不是硬切在第 8192 个字符。硬切会把一行代码砍成两半，模型看到的片段语法不完整、容易误判。`remaining` 的算法是「保留部分里有多少个换行 + 1」——直接用 `countCharInString` 数，不 split 整个字符串（大文件下省一次数组分配）。省略号的格式和 `BashTool/utils.ts` 对齐，是为了让 UI 层能用同一套正则识别。
  const kept =
    cutoff > 0 ? full.slice(0, cutoff) : full.slice(0, DIFF_SNIPPET_MAX_BYTES)
  const remaining = countCharInString(full, '\n', kept.length) + 1
  return `${kept}\n\n... [${remaining} lines truncated] ...`
}

const CONTEXT_LINES = 4

/**
 * Gets a snippet from a file showing the context around a patch with line numbers.
 * @param originalFile The original file content before applying the patch
 * @param patch The diff hunks to use for determining snippet location
 * @param newFile The file content after applying the patch
 * @returns The snippet text with line numbers and the starting line number
 */
export function getSnippetForPatch(
  patch: StructuredPatchHunk[],
  newFile: string,
): { formattedSnippet: string; startLine: number } {
  if (patch.length === 0) {
    // No changes, return empty snippet
    return { formattedSnippet: '', startLine: 1 }
  }

  // Find the first and last changed lines across all hunks
  let minLine = Infinity
  let maxLine = -Infinity

  for (const hunk of patch) {
    if (hunk.oldStart < minLine) {
      minLine = hunk.oldStart
    }
    // For the end line, we need to consider the new lines count since we're showing the new file
    const hunkEnd = hunk.oldStart + (hunk.newLines || 0) - 1
    if (hunkEnd > maxLine) {
      maxLine = hunkEnd
    }
  }

  // Calculate the range with context
  const startLine = Math.max(1, minLine - CONTEXT_LINES)
  const endLine = maxLine + CONTEXT_LINES

  // Split the new file into lines and get the snippet
  const fileLines = newFile.split(/\r?\n/)
  const snippetLines = fileLines.slice(startLine - 1, endLine)
  const snippet = snippetLines.join('\n')

  // Add line numbers
  const formattedSnippet = addLineNumbers({
    content: snippet,
    startLine,
  })

  return { formattedSnippet, startLine }
}

/**
 * Gets a snippet from a file showing the context around a single edit.
 * This is a convenience function that uses the original algorithm.
 * @param originalFile The original file content
 * @param oldString The text to replace
 * @param newString The text to replace it with
 * @param contextLines The number of lines to show before and after the change
 * @returns The snippet and the starting line number
 */
export function getSnippet(
  originalFile: string,
  oldString: string,
  newString: string,
  contextLines: number = 4,
): { snippet: string; startLine: number } {
  // Use the original algorithm from FileEditTool.tsx
  const before = originalFile.split(oldString)[0] ?? ''
  const replacementLine = before.split(/\r?\n/).length - 1
  const newFileLines = applyEditToFile(
    originalFile,
    oldString,
    newString,
  ).split(/\r?\n/)

  // Calculate the start and end line numbers for the snippet
  const startLine = Math.max(0, replacementLine - contextLines)
  const endLine =
    replacementLine + contextLines + newString.split(/\r?\n/).length

  // Get snippet
  const snippetLines = newFileLines.slice(startLine, endLine)
  const snippet = snippetLines.join('\n')

  return { snippet, startLine: startLine + 1 }
}

export function getEditsForPatch(patch: StructuredPatchHunk[]): FileEdit[] {
  return patch.map(hunk => {
    // Extract the changes from this hunk
    const contextLines: string[] = []
    const oldLines: string[] = []
    const newLines: string[] = []

    // Parse each line and categorize it
    for (const line of hunk.lines) {
      if (line.startsWith(' ')) {
        // Context line - appears in both versions
        contextLines.push(line.slice(1))
        oldLines.push(line.slice(1))
        newLines.push(line.slice(1))
      } else if (line.startsWith('-')) {
        // Deleted line - only in old version
        oldLines.push(line.slice(1))
      } else if (line.startsWith('+')) {
        // Added line - only in new version
        newLines.push(line.slice(1))
      }
    }

    return {
      old_string: oldLines.join('\n'),
      new_string: newLines.join('\n'),
      replace_all: false,
    }
  })
}

/**
 * Contains replacements to de-sanitize strings from Claude
 * Since Claude can't see any of these strings (sanitized in the API)
 * It'll output the sanitized versions in the edit response
 */
// 这张表的来历很不直观：**API 会在把内容发给模型之前做 sanitize**，把 `<function_results>` 之类的标签压成 `<fnr>`、把 `Human:`/`Assistant:` 压成 `H:`/`A:`（防注入）。模型从没见过原文，所以它要编辑包含这些标签的文件时，`old_string` 里写的必然是**压缩后的形式**——而磁盘上是原始形式。`normalizeFileEditInput` 就靠这张表把模型给的压缩形式还原回去，再去文件里找。表里的 `< META_START >`（带空格）这类写法是压缩产物本身带空格，不是笔误。
const DESANITIZATIONS: Record<string, string> = {
  '<fnr>': '<function_results>',
  '<n>': '<name>',
  '</n>': '</name>',
  '<o>': '<output>',
  '</o>': '</output>',
  '<e>': '<error>',
  '</e>': '</error>',
  '<s>': '<system>',
  '</s>': '</system>',
  '<r>': '<result>',
  '</r>': '</result>',
  '< META_START >': '<META_START>',
  '< META_END >': '<META_END>',
  '< EOT >': '<EOT>',
  '< META >': '<META>',
  '< SOS >': '<SOS>',
  '\n\nH:': '\n\nHuman:',
  '\n\nA:': '\n\nAssistant:',
}

/**
 * Normalizes a match string by applying specific replacements
 * This helps handle when exact matches fail due to formatting differences
 * @returns The normalized string and which replacements were applied
 */
function desanitizeMatchString(matchString: string): {
  result: string
  appliedReplacements: Array<{ from: string; to: string }>
} {
  let result = matchString
  const appliedReplacements: Array<{ from: string; to: string }> = []

  for (const [from, to] of Object.entries(DESANITIZATIONS)) {
    const beforeReplace = result
    result = result.replaceAll(from, to)

    if (beforeReplace !== result) {
      appliedReplacements.push({ from, to })
    }
  }

  return { result, appliedReplacements }
}

/**
 * Normalize the input for the FileEditTool
 * If the string to replace is not found in the file, try with a normalized version
 * Returns the normalized input if successful, or the original input if not
 */
export function normalizeFileEditInput({
  file_path,
  edits,
}: {
  file_path: string
  edits: EditInput[]
}): {
  file_path: string
  edits: EditInput[]
} {
  if (edits.length === 0) {
    return { file_path, edits }
  }

  // Markdown uses two trailing spaces as a hard line break — stripping would
  // silently change semantics. Skip stripTrailingWhitespace for .md/.mdx.
  const isMarkdown = /\.(md|mdx)$/i.test(file_path)
// markdown 文件**跳过** `stripTrailingWhitespace`，注释给了理由：md 里行尾两个空格是**硬换行**语义，剥掉就静默改变了渲染结果。这是个典型的「格式化会改语义」案例——同类还有 Makefile（tab 有意义）、Python（缩进有意义）。所以这里只按扩展名白名单排除。

  try {
    const fullPath = expandPath(file_path)

    // Use cached file read to avoid redundant I/O operations.
    // If the file doesn't exist, readFileSyncCached throws ENOENT which the
    // catch below handles by returning the original input (no TOCTOU pre-check).
    const fileContent = readFileSyncCached(fullPath)

    return {
      file_path,
      edits: edits.map(({ old_string, new_string, replace_all }) => {
        const normalizedNewString = isMarkdown
          ? new_string
          : stripTrailingWhitespace(new_string)

        // If exact string match works, keep it as is
        if (fileContent.includes(old_string)) {
          return {
            old_string,
            new_string: normalizedNewString,
            replace_all,
          }
        }

        // Try de-sanitize string if exact match fails
        const { result: desanitizedOldString, appliedReplacements } =
          desanitizeMatchString(old_string)

        if (fileContent.includes(desanitizedOldString)) {
          // Apply the same exact replacements to new_string
          let desanitizedNewString = normalizedNewString
          for (const { from, to } of appliedReplacements) {
            desanitizedNewString = desanitizedNewString.replaceAll(from, to)
          }

          return {
            old_string: desanitizedOldString,
            new_string: desanitizedNewString,
            replace_all,
          }
        }

        return {
          old_string,
          new_string: normalizedNewString,
          replace_all,
        }
      }),
    }
  } catch (error) {
    // If there's any error reading the file, just return original input.
    // ENOENT is expected when the file doesn't exist yet (e.g., new file).
    if (!isENOENT(error)) {
      logError(error)
    }
  }

  return { file_path, edits }
}

/**
 * Compare two sets of edits to determine if they are equivalent
 * by applying both sets to the original content and comparing results.
 * This handles cases where edits might be different but produce the same outcome.
 */
// `areFileEditsEquivalent` 的判据不是「两组编辑长得一样」，而是「**应用到同一份内容后结果一样**」。为什么要语义比较：模型重试时经常把 `old_string` 的上下文加长或缩短（多带/少带几行），字面完全不同但效果相同。如果不做语义判等，这类重试会被当成「改了主意」而重新走一遍权限询问。实现上有快路径（字面相等直接 true），慢路径要跑两次 `getPatchForEdits` 并比较最终内容——两边都抛错时只有**错误消息相同**才算等价。
export function areFileEditsEquivalent(
  edits1: FileEdit[],
  edits2: FileEdit[],
  originalContent: string,
): boolean {
  // Fast path: check if edits are literally identical
  if (
    edits1.length === edits2.length &&
    edits1.every((edit1, index) => {
      const edit2 = edits2[index]
      return (
        edit2 !== undefined &&
        edit1.old_string === edit2.old_string &&
        edit1.new_string === edit2.new_string &&
        edit1.replace_all === edit2.replace_all
      )
    })
  ) {
    return true
  }

  // Try applying both sets of edits
  let result1: { patch: StructuredPatchHunk[]; updatedFile: string } | null =
    null
  let error1: string | null = null
  let result2: { patch: StructuredPatchHunk[]; updatedFile: string } | null =
    null
  let error2: string | null = null

  try {
    result1 = getPatchForEdits({
      filePath: 'temp',
      fileContents: originalContent,
      edits: edits1,
    })
  } catch (e) {
    error1 = errorMessage(e)
  }

  try {
    result2 = getPatchForEdits({
      filePath: 'temp',
      fileContents: originalContent,
      edits: edits2,
    })
  } catch (e) {
    error2 = errorMessage(e)
  }

  // If both threw errors, they're equal only if the errors are the same
  if (error1 !== null && error2 !== null) {
    // Normalize error messages for comparison
    return error1 === error2
  }

  // If one threw an error and the other didn't, they're not equal
  if (error1 !== null || error2 !== null) {
    return false
  }

  // Both succeeded - compare the results
  return result1!.updatedFile === result2!.updatedFile
}

/**
 * Unified function to check if two file edit inputs are equivalent.
 * Handles file edits (FileEditTool).
 */
export function areFileEditsInputsEquivalent(
  input1: {
    file_path: string
    edits: FileEdit[]
  },
  input2: {
    file_path: string
    edits: FileEdit[]
  },
): boolean {
  // Fast path: different files
  if (input1.file_path !== input2.file_path) {
    return false
  }

  // Fast path: literal equality
  if (
    input1.edits.length === input2.edits.length &&
    input1.edits.every((edit1, index) => {
      const edit2 = input2.edits[index]
      return (
        edit2 !== undefined &&
        edit1.old_string === edit2.old_string &&
        edit1.new_string === edit2.new_string &&
        edit1.replace_all === edit2.replace_all
      )
    })
  ) {
    return true
  }

  // Semantic comparison (requires file read). If the file doesn't exist,
  // compare against empty content (no TOCTOU pre-check).
  let fileContent = ''
  try {
    fileContent = readFileSyncCached(input1.file_path)
  } catch (error) {
    if (!isENOENT(error)) {
      throw error
    }
  }

  return areFileEditsEquivalent(input1.edits, input2.edits, fileContent)
}
