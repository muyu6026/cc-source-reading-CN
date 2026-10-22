import { dirname, sep } from 'path'
import { logEvent } from 'src/services/analytics/index.js'
import { z } from 'zod/v4'
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
import { countLinesChanged, getPatchForDisplay } from '../../utils/diff.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { isENOENT } from '../../utils/errors.js'
import { getFileModificationTime, writeTextContent } from '../../utils/file.js'
import {
  fileHistoryEnabled,
  fileHistoryTrackEdit,
} from '../../utils/fileHistory.js'
import { logFileOperation } from '../../utils/fileOperationAnalytics.js'
import { readFileSyncWithMetadata } from '../../utils/fileRead.js'
import { getFsImplementation } from '../../utils/fsOperations.js'
import {
  fetchSingleFileGitDiff,
  type ToolUseDiff,
} from '../../utils/gitDiff.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { logError } from '../../utils/log.js'
import { expandPath } from '../../utils/path.js'
import {
  checkWritePermissionForTool,
  matchingRuleForInput,
} from '../../utils/permissions/filesystem.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { matchWildcardPattern } from '../../utils/permissions/shellRuleMatching.js'
import { FILE_UNEXPECTEDLY_MODIFIED_ERROR } from '../FileEditTool/constants.js'
import { gitDiffSchema, hunkSchema } from '../FileEditTool/types.js'
import { FILE_WRITE_TOOL_NAME, getWriteToolDescription } from './prompt.js'
import {
  getToolUseSummary,
  isResultTruncated,
  renderToolResultMessage,
  renderToolUseErrorMessage,
  renderToolUseMessage,
  renderToolUseRejectedMessage,
  userFacingName,
} from './UI.js'

// Write 的输入只有两个字段，但 `file_path` 的 `describe` 里专门强调了 **must be absolute, not relative**——因为这个工具会**整文覆盖**，路径解析错了就是灾难（比如把 `src/x.ts` 解析到别处，覆盖掉另一个文件）。Edit 就没有这句强调，因为它对不存在的文件会走「先读后写」的校验链，而 Write 新建文件时没有任何前置校验。
const inputSchema = lazySchema(() =>
  z.strictObject({
    file_path: z
      .string()
      .describe(
        'The absolute path to the file to write (must be absolute, not relative)',
      ),
    content: z.string().describe('The content to write to the file'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    type: z
      .enum(['create', 'update'])
      .describe(
        'Whether a new file was created or an existing file was updated',
      ),
    filePath: z.string().describe('The path to the file that was written'),
    content: z.string().describe('The content that was written to the file'),
    structuredPatch: z
      .array(hunkSchema())
      .describe('Diff patch showing the changes'),
    originalFile: z
      .string()
      .nullable()
      .describe(
        'The original file content before the write (null for new files)',
      ),
    gitDiff: gitDiffSchema().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>
export type FileWriteToolInput = InputSchema

export const FileWriteTool = buildTool({
  name: FILE_WRITE_TOOL_NAME,
  searchHint: 'create or overwrite files',
  maxResultSizeChars: 100_000,
  strict: true,
  async description() {
    return 'Write a file to the local filesystem.'
  },
  userFacingName,
  getToolUseSummary,
  getActivityDescription(input) {
    const summary = getToolUseSummary(input)
    return summary ? `Writing ${summary}` : 'Writing file'
  },
  async prompt() {
    return getWriteToolDescription()
  },
  renderToolUseMessage,
  isResultTruncated,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  toAutoClassifierInput(input) {
    return `${input.file_path}: ${input.content}`
  },
  getPath(input): string {
    return input.file_path
  },
// 和 Edit 同款的 `backfillObservableInput`：把 `file_path` 就地展开成绝对路径，让 hook 的 allowlist 无法通过 `~` 或相对路径绕过。两个工具的这段代码逐字相同，但都留着——它们是各自工具契约的一部分，抽出去反而会让「这个工具到底归一化了什么」变得不直观。
  backfillObservableInput(input) {
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
      FileWriteTool,
      input,
      appState.toolPermissionContext,
    )
  },
  renderToolUseRejectedMessage,
  renderToolUseErrorMessage,
  renderToolResultMessage,
  extractSearchText() {
// `extractSearchText` 返回空串，注释解释了为什么这不是偷懒：transcript 渲染时，create 模式显示 `content`（高亮代码）、update 模式显示结构化 diff。而搜索索引的 `content` 白名单会无脑索引原始内容串——**在 update 模式下那段内容根本没显示在屏幕上**，索引它就是在制造「搜到了但看不见」的幽灵结果。宁可漏索引（tool_use 已经索引了 `file_path`），也不要假命中。
    // Transcript render shows either content (create, via HighlightedCode)
    // or a structured diff (update). The heuristic's 'content' allowlist key
    // would index the raw content string even in update mode where it's NOT
    // shown — phantom. Under-count: tool_use already indexes file_path.
    return ''
  },
  async validateInput({ file_path, content }, toolUseContext: ToolUseContext) {
    const fullFilePath = expandPath(file_path)

    // Reject writes to team memory files that contain secrets
    const secretError = checkTeamMemSecrets(fullFilePath, content)
    if (secretError) {
      return { result: false, message: secretError, errorCode: 0 }
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
        message:
          'File is in a directory that is denied by your permission settings.',
        errorCode: 1,
      }
    }

    // SECURITY: Skip filesystem operations for UNC paths to prevent NTLM credential leaks.
    // On Windows, fs.existsSync() on UNC paths triggers SMB authentication which could
    // leak credentials to malicious servers. Let the permission check handle UNC paths.
// 同样的 UNC 路径安全短路，和 `FileEditTool` 一字不差。位置同样在**任何文件系统操作之前**——`fs.stat` 一旦碰到 `\\server\share`，Windows 就会发起 SMB 连接并泄露 NTLM 哈希。这段代码之所以在两个工具里重复出现，是因为它是「顺序敏感」的安全补丁：抽成工具函数反而容易被人挪到 stat 之后。
    if (fullFilePath.startsWith('\\\\') || fullFilePath.startsWith('//')) {
      return { result: true }
    }

    const fs = getFsImplementation()
    let fileMtimeMs: number
    try {
      const fileStat = await fs.stat(fullFilePath)
      fileMtimeMs = fileStat.mtimeMs
    } catch (e) {
      if (isENOENT(e)) {
        return { result: true }
      }
      throw e
    }

    const readTimestamp = toolUseContext.readFileState.get(fullFilePath)
// 「先读后写」在这里同样强制：没读过、或者只读了片段 → 拒绝。但 Write 和 Edit 有个重要差异——**Write 允许对不存在的文件直接写**（上面 `catch ENOENT` 就 `return { result: true }` 了），所以这条校验只对已存在的文件生效。这也是为什么 prompt 里写的是「如果是既有文件，必须先 Read」。
    if (!readTimestamp || readTimestamp.isPartialView) {
      return {
        result: false,
        message:
          'File has not been read yet. Read it first before writing to it.',
        errorCode: 2,
      }
    }

    // Reuse mtime from the stat above — avoids a redundant statSync via
    // getFileModificationTime. The readTimestamp guard above ensures this
    // block is always reached when the file exists.
    const lastWriteTime = Math.floor(fileMtimeMs)
// 复用上面 `fs.stat` 拿到的 `mtimeMs`，而不是再调一次 `getFileModificationTime`（那会再 `statSync` 一遍）。`Math.floor` 是为了和 `readFileState` 里存的时间戳口径一致——那边存的是秒级/毫秒级向下取整的值，不取整会永远「比读的时候新」。注释还说明这个块的到达前提：上面已确认文件存在。
    if (lastWriteTime > readTimestamp.timestamp) {
      return {
        result: false,
        message:
          'File has been modified since read, either by the user or by a linter. Read it again before attempting to write it.',
        errorCode: 3,
      }
    }

    return { result: true }
  },
  async call(
    { file_path, content },
    { readFileState, updateFileHistoryState, dynamicSkillDirTriggers },
    _,
    parentMessage,
  ) {
    const fullFilePath = expandPath(file_path)
    const dir = dirname(fullFilePath)

    // Discover skills from this file's path (fire-and-forget, non-blocking)
    const cwd = getCwd()
    const newSkillDirs = await discoverSkillDirsForPaths([fullFilePath], cwd)
    if (newSkillDirs.length > 0) {
      // Store discovered dirs for attachment display
      for (const dir of newSkillDirs) {
        dynamicSkillDirTriggers?.add(dir)
      }
      // Don't await - let skill loading happen in the background
      addSkillDirectories(newSkillDirs).catch(() => {})
    }

    // Activate conditional skills whose path patterns match this file
    activateConditionalSkillsForPaths([fullFilePath], cwd)

    await diagnosticTracker.beforeFileEdited(fullFilePath)

    // Ensure parent directory exists before the atomic read-modify-write section.
    // Must stay OUTSIDE the critical section below (a yield between the staleness
    // check and writeTextContent lets concurrent edits interleave), and BEFORE the
    // write (lazy-mkdir-on-ENOENT would fire a spurious tengu_atomic_write_error
    // inside writeFileSyncAndFlush_DEPRECATED before ENOENT propagates back).
// 这段注释记录了**两个都踩过的坑**：① 放在临界区里会导致并发交错（和 Edit 相同）；② 更隐蔽的是「懒 mkdir」——如果等 `writeTextContent` 内部遇到 ENOENT 再建目录，那么在错误传播回来之前，`writeFileSyncAndFlush_DEPRECATED` 已经先打了一条 `tengu_atomic_write_error` 遥测，等于每次新建文件都产生一条假故障。所以 mkdir 必须**提前、且在外面**。
    await getFsImplementation().mkdir(dir)
    if (fileHistoryEnabled()) {
      // Backup captures pre-edit content — safe to call before the staleness
      // check (idempotent v1 backup keyed on content hash; if staleness fails
      // later we just have an unused backup, not corrupt state).
      await fileHistoryTrackEdit(
        updateFileHistoryState,
        fullFilePath,
        parentMessage.uuid,
      )
    }

    // Load current state and confirm no changes since last read.
    // Please avoid async operations between here and writing to disk to preserve atomicity.
    let meta: ReturnType<typeof readFileSyncWithMetadata> | null
    try {
      meta = readFileSyncWithMetadata(fullFilePath)
    } catch (e) {
      if (isENOENT(e)) {
        meta = null
      } else {
        throw e
      }
    }

    if (meta !== null) {
      const lastWriteTime = getFileModificationTime(fullFilePath)
      const lastRead = readFileState.get(fullFilePath)
      if (!lastRead || lastWriteTime > lastRead.timestamp) {
        // Timestamp indicates modification, but on Windows timestamps can change
        // without content changes (cloud sync, antivirus, etc.). For full reads,
        // compare content as a fallback to avoid false positives.
        const isFullRead =
          lastRead &&
          lastRead.offset === undefined &&
          lastRead.limit === undefined
        // meta.content is CRLF-normalized — matches readFileState's normalized form.
// 内容比较的前提写在注释里：`meta.content` 是 **CRLF 归一化后**的（`readFileSyncWithMetadata` 统一成 LF），和 `readFileState` 里存的形式一致。不归一化的话，CRLF 文件每次都会被判成「内容变了」——因为读进来是 LF、磁盘上是 CRLF。
        if (!isFullRead || meta.content !== lastRead.content) {
          throw new Error(FILE_UNEXPECTEDLY_MODIFIED_ERROR)
        }
      }
    }

    const enc = meta?.encoding ?? 'utf8'
    const oldContent = meta?.content ?? null

    // Write is a full content replacement — the model sent explicit line endings
    // in `content` and meant them. Do not rewrite them. Previously we preserved
    // the old file's line endings (or sampled the repo via ripgrep for new
    // files), which silently corrupted e.g. bash scripts with \r on Linux when
    // overwriting a CRLF file or when binaries in cwd poisoned the repo sample.
    writeTextContent(fullFilePath, content, enc, 'LF')
// 这一行是**一次真实事故的修复**，注释值得逐字读：Write 是整文覆盖，模型在 `content` 里写的换行是它**明确的意思**，不该被改写。历史实现会「沿用旧文件的行尾」或「用 ripgrep 采样仓库风格」，结果在 Linux 上覆盖 CRLF 文件时把 bash 脚本写进了 `\r`；采样还容易被 cwd 里的二进制文件污染。所以现在固定传 `'LF'`——注意这里的 `'LF'` 不是「转成 LF」，而是告诉 `writeTextContent` **不要做行尾转换**。

    // Notify LSP servers about file modification (didChange) and save (didSave)
    const lspManager = getLspServerManager()
    if (lspManager) {
      // Clear previously delivered diagnostics so new ones will be shown
      clearDeliveredDiagnosticsForFile(`file://${fullFilePath}`)
      // didChange: Content has been modified
      lspManager.changeFile(fullFilePath, content).catch((err: Error) => {
        logForDebugging(
          `LSP: Failed to notify server of file change for ${fullFilePath}: ${err.message}`,
        )
        logError(err)
      })
      // didSave: File has been saved to disk (triggers diagnostics in TypeScript server)
      lspManager.saveFile(fullFilePath).catch((err: Error) => {
        logForDebugging(
          `LSP: Failed to notify server of file save for ${fullFilePath}: ${err.message}`,
        )
        logError(err)
      })
    }

    // Notify VSCode about the file change for diff view
    notifyVscodeFileUpdated(fullFilePath, oldContent, content)

    // Update read timestamp, to invalidate stale writes
    readFileState.set(fullFilePath, {
      content,
      timestamp: getFileModificationTime(fullFilePath),
      offset: undefined,
      limit: undefined,
    })

    // Log when writing to CLAUDE.md
    if (fullFilePath.endsWith(`${sep}CLAUDE.md`)) {
      logEvent('tengu_write_claudemd', {})
    }

    let gitDiff: ToolUseDiff | undefined
    if (
      isEnvTruthy(process.env.CLAUDE_CODE_REMOTE) &&
      getFeatureValue_CACHED_MAY_BE_STALE('tengu_quartz_lantern', false)
    ) {
      const startTime = Date.now()
      const diff = await fetchSingleFileGitDiff(fullFilePath)
      if (diff) gitDiff = diff
      logEvent('tengu_tool_use_diff_computed', {
        isWriteTool: true,
        durationMs: Date.now() - startTime,
        hasDiff: !!diff,
      })
    }

// `if (oldContent)` 用**真值**判断，所以 `oldContent === ''`（已存在的空文件）会掉到下面的 create 分支，返回 `type: 'create'`、`structuredPatch: []`、`originalFile: null`。这算一个已知的粗糙处：对一个空文件写入其实算「更新」，但因为没有 diff 可展示，归到 create 反而对 UI 更友好（直接显示内容预览）。批注点出来是为了避免后来者把它当 bug「修」成 `!== null`——那样 UI 会拿到一个空 patch 的 update，渲染成一片空白。
    if (oldContent) {
      const patch = getPatchForDisplay({
        filePath: file_path,
        fileContents: oldContent,
        edits: [
          {
            old_string: oldContent,
            new_string: content,
            replace_all: false,
          },
        ],
      })

      const data = {
        type: 'update' as const,
        filePath: file_path,
        content,
        structuredPatch: patch,
        originalFile: oldContent,
        ...(gitDiff && { gitDiff }),
      }
      // Track lines added and removed for file updates, right before yielding result
      countLinesChanged(patch)

      logFileOperation({
        operation: 'write',
        tool: 'FileWriteTool',
        filePath: fullFilePath,
        type: 'update',
      })

      return {
        data,
      }
    }

    const data = {
      type: 'create' as const,
      filePath: file_path,
      content,
      structuredPatch: [],
      originalFile: null,
      ...(gitDiff && { gitDiff }),
    }

    // For creation of new files, count all lines as additions, right before yielding the result
    countLinesChanged([], content)
// 新建文件没有 diff 可算，所以 `countLinesChanged([], content)` 传空 patch + 全文，让计数逻辑把每一行都算成新增。这个调用放在 `return` 之前紧挨着，注释也强调 `right before yielding the result`——因为行数统计要计入「本轮改动」的累计，晚一步就会漏掉最后一条。

    logFileOperation({
      operation: 'write',
      tool: 'FileWriteTool',
      filePath: fullFilePath,
      type: 'create',
    })

    return {
      data,
    }
  },
  mapToolResultToToolResultBlockParam({ filePath, type }, toolUseID) {
    switch (type) {
      case 'create':
        return {
          tool_use_id: toolUseID,
          type: 'tool_result',
          content: `File created successfully at: ${filePath}`,
        }
      case 'update':
        return {
          tool_use_id: toolUseID,
          type: 'tool_result',
          content: `The file ${filePath} has been updated successfully.`,
        }
    }
  },
} satisfies ToolDef<InputSchema, Output>)
