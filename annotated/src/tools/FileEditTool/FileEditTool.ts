import { dirname, isAbsolute, sep } from 'path'
import { logEvent } from 'src/services/analytics/index.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { diagnosticTracker } from '../../services/diagnosticTracking.js'
import { clearDeliveredDiagnosticsForFile } from '../../services/lsp/LSPDiagnosticRegistry.js'
import { getLspServerManager } from '../../services/lsp/manager.js'
import { notifyVscodeFileUpdated } from '../../services/mcp/vscodeSdkMcp.js'
import { checkTeamMemSecrets } from '../../services/teamMemorySync/teamMemSecretGuard.js'
import {
  activateConditionalSkillsForPaths,
  addSkillDirectories,
  discoverSkillDirsForPaths,
} from '../../skills/loadSkillsDir.js'
import type { ToolUseContext } from '../../Tool.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { getCwd } from '../../utils/cwd.js'
import { logForDebugging } from '../../utils/debug.js'
import { countLinesChanged } from '../../utils/diff.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { isENOENT } from '../../utils/errors.js'
import {
  FILE_NOT_FOUND_CWD_NOTE,
  findSimilarFile,
  getFileModificationTime,
  suggestPathUnderCwd,
  writeTextContent,
} from '../../utils/file.js'
import {
  fileHistoryEnabled,
  fileHistoryTrackEdit,
} from '../../utils/fileHistory.js'
import { logFileOperation } from '../../utils/fileOperationAnalytics.js'
import {
  type LineEndingType,
  readFileSyncWithMetadata,
} from '../../utils/fileRead.js'
import { formatFileSize } from '../../utils/format.js'
import { getFsImplementation } from '../../utils/fsOperations.js'
import {
  fetchSingleFileGitDiff,
  type ToolUseDiff,
} from '../../utils/gitDiff.js'
import { logError } from '../../utils/log.js'
import { expandPath } from '../../utils/path.js'
import {
  checkWritePermissionForTool,
  matchingRuleForInput,
} from '../../utils/permissions/filesystem.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { matchWildcardPattern } from '../../utils/permissions/shellRuleMatching.js'
import { validateInputForSettingsFileEdit } from '../../utils/settings/validateEditTool.js'
import { NOTEBOOK_EDIT_TOOL_NAME } from '../NotebookEditTool/constants.js'
import {
  FILE_EDIT_TOOL_NAME,
  FILE_UNEXPECTEDLY_MODIFIED_ERROR,
} from './constants.js'
import { getEditToolDescription } from './prompt.js'
import {
  type FileEditInput,
  type FileEditOutput,
  inputSchema,
  outputSchema,
} from './types.js'
import {
  getToolUseSummary,
  renderToolResultMessage,
  renderToolUseErrorMessage,
  renderToolUseMessage,
  renderToolUseRejectedMessage,
  userFacingName,
} from './UI.js'
import {
  areFileEditsInputsEquivalent,
  findActualString,
  getPatchForEdit,
  preserveQuoteStyle,
} from './utils.js'

// V8/Bun string length limit is ~2^30 characters (~1 billion). For typical
// ASCII/Latin-1 files, 1 byte on disk = 1 character, so 1 GiB in stat bytes
// ≈ 1 billion characters ≈ the runtime string limit. Multi-byte UTF-8 files
// can be larger on disk per character, but 1 GiB is a safe byte-level guard
// that prevents OOM without being unnecessarily restrictive.
// 1 GiB 这个数字的推导写在注释里：V8/Bun 的单字符串上限约 2^30 字符（约 10 亿）。对 ASCII 文件来说磁盘 1 字节 = 1 字符，所以 1 GiB 的 stat 字节数约等于字符串上限。多字节 UTF-8 文件在同样字节数下字符更少，所以按字节卡是**安全的上界**——不会误伤，又能挡住必然 OOM 的超大文件。
const MAX_EDIT_FILE_SIZE = 1024 * 1024 * 1024 // 1 GiB (stat bytes)

export const FileEditTool = buildTool({
  name: FILE_EDIT_TOOL_NAME,
  searchHint: 'modify file contents in place',
  maxResultSizeChars: 100_000,
  strict: true,
  async description() {
    return 'A tool for editing files'
  },
  async prompt() {
    return getEditToolDescription()
  },
  userFacingName,
  getToolUseSummary,
  getActivityDescription(input) {
    const summary = getToolUseSummary(input)
    return summary ? `Editing ${summary}` : 'Editing file'
  },
  get inputSchema() {
    return inputSchema()
  },
  get outputSchema() {
    return outputSchema()
  },
  toAutoClassifierInput(input) {
    return `${input.file_path}: ${input.new_string}`
  },
  getPath(input): string {
    return input.file_path
  },
  backfillObservableInput(input) {
// `backfillObservableInput` 把 `file_path` 就地展开成绝对路径，注释点明了安全含义：`hooks.mdx` 文档承诺 `file_path` 是绝对路径，而 hook 的允许列表常按绝对路径前缀匹配——如果放 `~/x` 或相对路径过去，一个写死 `~/.claude/**` 的 allow 规则就可能被绕过。**在可观察输入阶段就归一化**，是让后面所有消费者（hook、权限、日志）看到同一个值的省事做法。
    // hooks.mdx documents file_path as absolute; expand so hook allowlists
    // can't be bypassed via ~ or relative paths.
    if (typeof input.file_path === 'string') {
      input.file_path = expandPath(input.file_path)
    }
  },
  async preparePermissionMatcher({ file_path }) {
    return pattern => matchWildcardPattern(pattern, file_path)
  },
  async checkPermissions(input, context): Promise<PermissionDecision> {
    const appState = context.getAppState()
    return checkWritePermissionForTool(
      FileEditTool,
      input,
      appState.toolPermissionContext,
    )
  },
  renderToolUseMessage,
  renderToolResultMessage,
  renderToolUseRejectedMessage,
  renderToolUseErrorMessage,
  async validateInput(input: FileEditInput, toolUseContext: ToolUseContext) {
    const { file_path, old_string, new_string, replace_all = false } = input
    // Use expandPath for consistent path normalization (especially on Windows
    // where "/" vs "\" can cause readFileState lookup mismatches)
    const fullFilePath = expandPath(file_path)

    // Reject edits to team memory files that introduce secrets
    const secretError = checkTeamMemSecrets(fullFilePath, new_string)
    if (secretError) {
      return { result: false, message: secretError, errorCode: 0 }
    }
// `old_string === new_string` 时返回的是 `behavior: 'ask'` 而不是直接报错。这个细节值得注意：它不是「校验失败」，而是「**没有可做的事**」——用 `ask` 让 UI 走到「用户是否要接受这个空改动」的分支，而不是弹一条红色错误。`errorCode` 在这套工具里是稳定编号（0 是密钥拦截、1 是无改动、2 是 deny 目录……），遥测按编号聚合，不受文案改动影响。
    if (old_string === new_string) {
      return {
        result: false,
        behavior: 'ask',
        message:
          'No changes to make: old_string and new_string are exactly the same.',
        errorCode: 1,
      }
    }

    // Check if path should be ignored based on permission settings
    const appState = toolUseContext.getAppState()
    const denyRule = matchingRuleForInput(
      fullFilePath,
      appState.toolPermissionContext,
      'edit',
      'deny',
    )
    if (denyRule !== null) {
      return {
        result: false,
        behavior: 'ask',
        message:
          'File is in a directory that is denied by your permission settings.',
        errorCode: 2,
      }
    }

    // SECURITY: Skip filesystem operations for UNC paths to prevent NTLM credential leaks.
    // On Windows, fs.existsSync() on UNC paths triggers SMB authentication which could
    // leak credentials to malicious servers. Let the permission check handle UNC paths.
    if (fullFilePath.startsWith('\\\\') || fullFilePath.startsWith('//')) {
// UNC 路径的**安全短路**：Windows 上对 `\\server\share` 做任何 `stat`/`existsSync` 都会触发 SMB 认证，从而把本机 NTLM 哈希发给对面。所以这里在碰文件系统之前就返回 `result: true`，把风险判断完全交给权限层（权限层只做字符串匹配，不触网）。顺序很关键——这段必须排在 `fs.stat` 之前。
      return { result: true }
    }

    const fs = getFsImplementation()

    // Prevent OOM on multi-GB files.
    try {
      const { size } = await fs.stat(fullFilePath)
      if (size > MAX_EDIT_FILE_SIZE) {
// 编辑前的体积闸门。注意 `fs.stat` 抛 ENOENT 时不是失败：文件不存在是**合法场景**（下面会当作新建文件处理），只有非 ENOENT 才往上抛。这种「预期内错误静默、预期外错误上抛」的分工在这个文件里出现了四五次。
        return {
          result: false,
          behavior: 'ask',
          message: `File is too large to edit (${formatFileSize(size)}). Maximum editable file size is ${formatFileSize(MAX_EDIT_FILE_SIZE)}.`,
          errorCode: 10,
        }
      }
    } catch (e) {
      if (!isENOENT(e)) {
        throw e
      }
    }

    // Read the file as bytes first so we can detect encoding from the buffer
    // instead of calling detectFileEncoding (which does its own sync readSync
    // and would fail with a wasted ENOENT when the file doesn't exist).
    let fileContent: string | null
    try {
      const fileBuffer = await fs.readFileBytes(fullFilePath)
      const encoding: BufferEncoding =
        fileBuffer.length >= 2 &&
        fileBuffer[0] === 0xff &&
        fileBuffer[1] === 0xfe
          ? 'utf16le'
          : 'utf8'
      fileContent = fileBuffer.toString(encoding).replaceAll('\r\n', '\n')
// 编码检测走**先读字节再看 BOM**（`FF FE` → utf16le），而不是调 `detectFileEncoding`。注释解释了原因：那个函数内部自己会做一次 `readSync`，文件不存在时会先浪费一次 ENOENT。这里已经拿到了 buffer，顺手判 BOM 更省。`replaceAll('\r\n', '\n')` 是**统一到 LF 后再做匹配**——否则模型给的 `old_string`（几乎总是 LF）在多行匹配时必然失败。
    } catch (e) {
      if (isENOENT(e)) {
        fileContent = null
      } else {
        throw e
      }
    }

    // File doesn't exist
    if (fileContent === null) {
      // Empty old_string on nonexistent file means new file creation — valid
      if (old_string === '') {
        return { result: true }
      }
      // Try to find a similar file with a different extension
      const similarFilename = findSimilarFile(fullFilePath)
// 「文件不存在」的报错里塞了两个猜测：`suggestPathUnderCwd`（路径其实在 cwd 下面，模型多半是漏了前缀）和 `findSimilarFile`（扩展名打错了，比如 `.tsx` 写成 `.ts`）。这是**给模型的自纠错线索**——它看到「Did you mean ...」就能直接改一次重试，而不是卡在那里反复读文件。错误消息里带上 cwd 也是同一个目的（`FILE_NOT_FOUND_CWD_NOTE`）。
      const cwdSuggestion = await suggestPathUnderCwd(fullFilePath)
      let message = `File does not exist. ${FILE_NOT_FOUND_CWD_NOTE} ${getCwd()}.`

      if (cwdSuggestion) {
        message += ` Did you mean ${cwdSuggestion}?`
      } else if (similarFilename) {
        message += ` Did you mean ${similarFilename}?`
      }

      return {
        result: false,
        behavior: 'ask',
        message,
        errorCode: 4,
      }
    }

    // File exists with empty old_string — only valid if file is empty
    if (old_string === '') {
      // Only reject if the file has content (for file creation attempt)
// `old_string === ''` 在文件已存在时只允许一种情况：**文件本身是空的**。这里用 `fileContent.trim() !== ''` 判断——注意是 `trim` 后判断，所以「只有空白字符」的文件也算空，可以写入。反过来说，只要文件里有任何实质内容，空 `old_string` 就是在试图覆盖已有文件，必须拒绝并提示用 Write 工具。
      if (fileContent.trim() !== '') {
        return {
          result: false,
          behavior: 'ask',
          message: 'Cannot create new file - file already exists.',
          errorCode: 3,
        }
      }

      // Empty file with empty old_string is valid - we're replacing empty with content
      return {
        result: true,
      }
    }

// `.ipynb` 直接拒绝并**指向另一个工具**（`NOTEBOOK_EDIT_TOOL_NAME`）。原因：notebook 是 JSON 结构，按纯文本做字符串替换虽然能改但极易破坏单元格结构（转义、缩进、metadata）。这类「工具边界」的提示比单纯报错有用得多——模型知道下一步该调什么。
    if (fullFilePath.endsWith('.ipynb')) {
      return {
        result: false,
        behavior: 'ask',
        message: `File is a Jupyter Notebook. Use the ${NOTEBOOK_EDIT_TOOL_NAME} to edit this file.`,
        errorCode: 5,
      }
    }

    const readTimestamp = toolUseContext.readFileState.get(fullFilePath)
// **先读后写**的强制校验，两个条件缺一不可：`readFileState` 里没有这条记录（压根没读过）、或者 `isPartialView` 为真（只读了片段）。为什么片段读不够：`old_string` 可能落在没读到的区域，模型是在凭想象写替换串，结果就是匹配不到或者匹配到别处。错误消息里还带了 `isFilePathAbsolute` 元数据——遥测能区分「模型给的是相对路径」这类系统性问题。
    if (!readTimestamp || readTimestamp.isPartialView) {
      return {
        result: false,
        behavior: 'ask',
        message:
          'File has not been read yet. Read it first before writing to it.',
        meta: {
          isFilePathAbsolute: String(isAbsolute(file_path)),
        },
        errorCode: 6,
      }
    }

    // Check if file exists and get its last modified time
    if (readTimestamp) {
      const lastWriteTime = getFileModificationTime(fullFilePath)
      if (lastWriteTime > readTimestamp.timestamp) {
// 时间戳检查有个**平台补丁**：Windows 上云同步、杀毒软件会改 mtime 但内容没变，光看时间会频繁误报「文件已被修改」。所以时间戳变新时再比一次内容——但只在「上次是完整读」的前提下比（`offset`/`limit` 都是 undefined）。部分读的 `content` 只是片段，拿它跟全文比必然不等，所以那种情况直接按「已修改」处理。
        // Timestamp indicates modification, but on Windows timestamps can change
        // without content changes (cloud sync, antivirus, etc.). For full reads,
        // compare content as a fallback to avoid false positives.
        const isFullRead =
          readTimestamp.offset === undefined &&
          readTimestamp.limit === undefined
        if (isFullRead && fileContent === readTimestamp.content) {
          // Content unchanged, safe to proceed
        } else {
          return {
            result: false,
            behavior: 'ask',
            message:
              'File has been modified since read, either by the user or by a linter. Read it again before attempting to write it.',
            errorCode: 7,
          }
        }
      }
    }

    const file = fileContent

    // Use findActualString to handle quote normalization
    const actualOldString = findActualString(file, old_string)
    if (!actualOldString) {
      return {
        result: false,
        behavior: 'ask',
        message: `String to replace not found in file.\nString: ${old_string}`,
        meta: {
          isFilePathAbsolute: String(isAbsolute(file_path)),
        },
        errorCode: 8,
      }
    }

    const matches = file.split(actualOldString).length - 1

    // Check if we have multiple matches but replace_all is false
// 多匹配的处理是这套工具最容易被抱怨的地方，所以提示写得极具体：告诉模型**两个**可选动作——加更多上下文让它唯一，或者显式 `replace_all: true`。`matches` 用 `split(actualOldString).length - 1` 数，比正则安全（不用转义特殊字符）。注意消息里回传了 `actualOldString`，让模型看到「文件里实际的写法」（可能和它给的引号/空白不同）。
    if (matches > 1 && !replace_all) {
      return {
        result: false,
        behavior: 'ask',
        message: `Found ${matches} matches of the string to replace, but replace_all is false. To replace all occurrences, set replace_all to true. To replace only one occurrence, please provide more context to uniquely identify the instance.\nString: ${old_string}`,
        meta: {
          isFilePathAbsolute: String(isAbsolute(file_path)),
          actualOldString,
        },
        errorCode: 9,
      }
    }

    // Additional validation for Claude settings files
// settings 文件（`settings.json` 之类）多一道**语义校验**：`validateInputForSettingsFileEdit` 拿到「模拟应用后的最终内容」再检查，而不是校验 diff。传进去的是个**闭包**而不是内容，因为校验方需要按自己的需要决定何时计算（避免大文件无谓地跑两次 replace）。
    const settingsValidationResult = validateInputForSettingsFileEdit(
      fullFilePath,
      file,
      () => {
        // Simulate the edit to get the final content using the exact same logic as the tool
        return replace_all
          ? file.replaceAll(actualOldString, new_string)
          : file.replace(actualOldString, new_string)
      },
    )

    if (settingsValidationResult !== null) {
      return settingsValidationResult
    }

    return { result: true, meta: { actualOldString } }
  },
  inputsEquivalent(input1, input2) {
    return areFileEditsInputsEquivalent(
      {
        file_path: input1.file_path,
        edits: [
          {
            old_string: input1.old_string,
            new_string: input1.new_string,
            replace_all: input1.replace_all ?? false,
          },
        ],
      },
      {
        file_path: input2.file_path,
        edits: [
          {
            old_string: input2.old_string,
            new_string: input2.new_string,
            replace_all: input2.replace_all ?? false,
          },
        ],
      },
    )
  },
  async call(
    input: FileEditInput,
    {
      readFileState,
      userModified,
      updateFileHistoryState,
      dynamicSkillDirTriggers,
    },
    _,
    parentMessage,
  ) {
    const { file_path, old_string, new_string, replace_all = false } = input

    // 1. Get current state
    const fs = getFsImplementation()
    const absoluteFilePath = expandPath(file_path)

    // Discover skills from this file's path (fire-and-forget, non-blocking)
    // Skip in simple mode - no skills available
    const cwd = getCwd()
    if (!isEnvTruthy(process.env.CLAUDE_CODE_SIMPLE)) {
      const newSkillDirs = await discoverSkillDirsForPaths(
        [absoluteFilePath],
        cwd,
      )
      if (newSkillDirs.length > 0) {
        // Store discovered dirs for attachment display
        for (const dir of newSkillDirs) {
          dynamicSkillDirTriggers?.add(dir)
        }
        // Don't await - let skill loading happen in the background
        addSkillDirectories(newSkillDirs).catch(() => {})
      }

      // Activate conditional skills whose path patterns match this file
      activateConditionalSkillsForPaths([absoluteFilePath], cwd)
    }

    await diagnosticTracker.beforeFileEdited(absoluteFilePath)

    // Ensure parent directory exists before the atomic read-modify-write section.
    // These awaits must stay OUTSIDE the critical section below — a yield between
    // the staleness check and writeTextContent lets concurrent edits interleave.
// `mkdir` 必须在**临界区外面**，注释写得很硬：`These awaits must stay OUTSIDE the critical section below——a yield between the staleness check and writeTextContent lets concurrent edits interleave`。这是整个 `call()` 里唯一一处「顺序即正确性」的地方：从「检查文件没被别人改过」到「写盘」之间不能有任何 `await`，否则两个并发编辑会各自通过检查、后写的覆盖先写的。
    await fs.mkdir(dirname(absoluteFilePath))
    if (fileHistoryEnabled()) {
      // Backup captures pre-edit content — safe to call before the staleness
      // check (idempotent v1 backup keyed on content hash; if staleness fails
      // later we just have an unused backup, not corrupt state).
      await fileHistoryTrackEdit(
        updateFileHistoryState,
        absoluteFilePath,
        parentMessage.uuid,
      )
    }

    // 2. Load current state and confirm no changes since last read
    // Please avoid async operations between here and writing to disk to preserve atomicity
// 这句注释是对上一条的补充约定：**从这里到 `writeTextContent` 之间不许出现异步操作**。所以你会看到读文件用的是同步版 `readFileForEdit`（内部 `readFileSyncWithMetadata`），尽管在 async 函数里看着别扭——那是刻意的。
    const {
      content: originalFileContents,
      fileExists,
      encoding,
      lineEndings: endings,
    } = readFileForEdit(absoluteFilePath)

    if (fileExists) {
      const lastWriteTime = getFileModificationTime(absoluteFilePath)
      const lastRead = readFileState.get(absoluteFilePath)
      if (!lastRead || lastWriteTime > lastRead.timestamp) {
        // Timestamp indicates modification, but on Windows timestamps can change
        // without content changes (cloud sync, antivirus, etc.). For full reads,
        // compare content as a fallback to avoid false positives.
        const isFullRead =
          lastRead &&
          lastRead.offset === undefined &&
          lastRead.limit === undefined
        const contentUnchanged =
          isFullRead && originalFileContents === lastRead.content
        if (!contentUnchanged) {
          throw new Error(FILE_UNEXPECTEDLY_MODIFIED_ERROR)
        }
      }
    }

    // 3. Use findActualString to handle quote normalization
    const actualOldString =
      findActualString(originalFileContents, old_string) || old_string

    // Preserve curly quotes in new_string when the file uses them
    const actualNewString = preserveQuoteStyle(
      old_string,
      actualOldString,
      new_string,
    )

    // 4. Generate patch
    const { patch, updatedFile } = getPatchForEdit({
      filePath: absoluteFilePath,
      fileContents: originalFileContents,
      oldString: actualOldString,
      newString: actualNewString,
      replaceAll: replace_all,
    })

    // 5. Write to disk
    writeTextContent(absoluteFilePath, updatedFile, encoding, endings)
// `writeTextContent(path, content, encoding, lineEndings)` 四个参数缺一不可：`encoding` 沿用读到的原编码（UTF-16LE 的文件不会被写成 UTF-8）、`endings` 沿用原行尾（CRLF 文件保持 CRLF）。这和 `FileWriteTool` 的取舍**正好相反**——那边是整文覆盖、坚持用模型给的 LF（见 `FileWriteTool.ts` 第 305 行的注释）。区别的根源是：编辑是「局部补丁」，应该融入文件既有风格；写入是「作者意图」，应该尊重模型给的字节。

    // Notify LSP servers about file modification (didChange) and save (didSave)
    const lspManager = getLspServerManager()
    if (lspManager) {
      // Clear previously delivered diagnostics so new ones will be shown
      clearDeliveredDiagnosticsForFile(`file://${absoluteFilePath}`)
      // didChange: Content has been modified
      lspManager
        .changeFile(absoluteFilePath, updatedFile)
        .catch((err: Error) => {
          logForDebugging(
            `LSP: Failed to notify server of file change for ${absoluteFilePath}: ${err.message}`,
          )
          logError(err)
        })
      // didSave: File has been saved to disk (triggers diagnostics in TypeScript server)
      lspManager.saveFile(absoluteFilePath).catch((err: Error) => {
        logForDebugging(
          `LSP: Failed to notify server of file save for ${absoluteFilePath}: ${err.message}`,
        )
        logError(err)
      })
    }

    // Notify VSCode about the file change for diff view
    notifyVscodeFileUpdated(absoluteFilePath, originalFileContents, updatedFile)

    // 6. Update read timestamp, to invalidate stale writes
// 写盘后立刻更新 `readFileState`，且把 `offset`/`limit` 显式置成 `undefined`——这等于宣告「我刚完整读过这个文件」。不更新的话，紧接着的第二次编辑会拿旧的 mtime 比对，被自己的写入判成「文件已被修改」而失败。
    readFileState.set(absoluteFilePath, {
      content: updatedFile,
      timestamp: getFileModificationTime(absoluteFilePath),
      offset: undefined,
      limit: undefined,
    })

    // 7. Log events
    if (absoluteFilePath.endsWith(`${sep}CLAUDE.md`)) {
      logEvent('tengu_write_claudemd', {})
    }
    countLinesChanged(patch)

    logFileOperation({
      operation: 'edit',
      tool: 'FileEditTool',
      filePath: absoluteFilePath,
    })

    logEvent('tengu_edit_string_lengths', {
      oldStringBytes: Buffer.byteLength(old_string, 'utf8'),
      newStringBytes: Buffer.byteLength(new_string, 'utf8'),
      replaceAll: replace_all,
    })

    let gitDiff: ToolUseDiff | undefined
    if (
      isEnvTruthy(process.env.CLAUDE_CODE_REMOTE) &&
      getFeatureValue_CACHED_MAY_BE_STALE('tengu_quartz_lantern', false)
    ) {
      const startTime = Date.now()
      const diff = await fetchSingleFileGitDiff(absoluteFilePath)
      if (diff) gitDiff = diff
      logEvent('tengu_tool_use_diff_computed', {
        isEditTool: true,
        durationMs: Date.now() - startTime,
        hasDiff: !!diff,
      })
    }

    // 8. Yield result
    const data = {
      filePath: file_path,
      oldString: actualOldString,
      newString: new_string,
      originalFile: originalFileContents,
      structuredPatch: patch,
      userModified: userModified ?? false,
      replaceAll: replace_all,
      ...(gitDiff && { gitDiff }),
    }
    return {
      data,
    }
  },
  mapToolResultToToolResultBlockParam(data: FileEditOutput, toolUseID) {
    const { filePath, userModified, replaceAll } = data
    const modifiedNote = userModified
      ? '.  The user modified your proposed changes before accepting them. '
      : ''

    if (replaceAll) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: `The file ${filePath} has been updated${modifiedNote}. All occurrences were successfully replaced.`,
      }
    }

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `The file ${filePath} has been updated successfully${modifiedNote}.`,
    }
  },
} satisfies ToolDef<ReturnType<typeof inputSchema>, FileEditOutput>)

// --

// `readFileForEdit` 把「文件不存在」折成 `content: ''`、`fileExists: false`，而不是抛错。这样 `call()` 里的主流程不用写两套分支——空内容走一遍 `getPatchForEdit` 自然就是「新建文件」的 patch。`encoding`/`lineEndings` 的默认值（`utf8`/`LF`）只对新建文件生效。
function readFileForEdit(absoluteFilePath: string): {
  content: string
  fileExists: boolean
  encoding: BufferEncoding
  lineEndings: LineEndingType
} {
  try {
    // eslint-disable-next-line custom-rules/no-sync-fs
    const meta = readFileSyncWithMetadata(absoluteFilePath)
    return {
      content: meta.content,
      fileExists: true,
      encoding: meta.encoding,
      lineEndings: meta.lineEndings,
    }
  } catch (e) {
    if (isENOENT(e)) {
      return {
        content: '',
        fileExists: false,
        encoding: 'utf8',
        lineEndings: 'LF',
      }
    }
    throw e
  }
}
