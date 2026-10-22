import { feature } from 'bun:bundle'
import { extname, isAbsolute, resolve } from 'path'
import {
  fileHistoryEnabled,
  fileHistoryTrackEdit,
} from 'src/utils/fileHistory.js'
import { z } from 'zod/v4'
import { buildTool, type ToolDef, type ToolUseContext } from '../../Tool.js'
import type { NotebookCell, NotebookContent } from '../../types/notebook.js'
import { getCwd } from '../../utils/cwd.js'
import { isENOENT } from '../../utils/errors.js'
import { getFileModificationTime, writeTextContent } from '../../utils/file.js'
import { readFileSyncWithMetadata } from '../../utils/fileRead.js'
import { safeParseJSON } from '../../utils/json.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { parseCellId } from '../../utils/notebook.js'
import { checkWritePermissionForTool } from '../../utils/permissions/filesystem.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { jsonParse, jsonStringify } from '../../utils/slowOperations.js'
import { NOTEBOOK_EDIT_TOOL_NAME } from './constants.js'
import { DESCRIPTION, PROMPT } from './prompt.js'
import {
  getToolUseSummary,
  renderToolResultMessage,
  renderToolUseErrorMessage,
  renderToolUseMessage,
  renderToolUseRejectedMessage,
} from './UI.js'

export const inputSchema = lazySchema(() =>
  z.strictObject({
    notebook_path: z
      .string()
      .describe(
        'The absolute path to the Jupyter notebook file to edit (must be absolute, not relative)',
      ),
    cell_id: z
      .string()
      .optional()
      .describe(
        'The ID of the cell to edit. When inserting a new cell, the new cell will be inserted after the cell with this ID, or at the beginning if not specified.',
      ),
    new_source: z.string().describe('The new source for the cell'),
    cell_type: z
      .enum(['code', 'markdown'])
      .optional()
      .describe(
        'The type of the cell (code or markdown). If not specified, it defaults to the current cell type. If using edit_mode=insert, this is required.',
      ),
    edit_mode: z
      .enum(['replace', 'insert', 'delete'])
      .optional()
      .describe(
        'The type of edit to make (replace, insert, delete). Defaults to replace.',
      ),
  }),
)
// 输入 schema（strictObject）：notebook_path 必须绝对路径；cell_id 定位目标单元格
// （插入时作为「插在其后」的锚点，缺省插到开头）；new_source 新内容；cell_type 只在
// insert 时必填；edit_mode 三态 replace/insert/delete，默认 replace。
type InputSchema = ReturnType<typeof inputSchema>

export const outputSchema = lazySchema(() =>
  z.object({
    new_source: z
      .string()
      .describe('The new source code that was written to the cell'),
    cell_id: z
      .string()
      .optional()
      .describe('The ID of the cell that was edited'),
    cell_type: z.enum(['code', 'markdown']).describe('The type of the cell'),
    language: z.string().describe('The programming language of the notebook'),
    edit_mode: z.string().describe('The edit mode that was used'),
    error: z
      .string()
      .optional()
      .describe('Error message if the operation failed'),
    // Fields for attribution tracking
    notebook_path: z.string().describe('The path to the notebook file'),
    original_file: z
      .string()
      .describe('The original notebook content before modification'),
    updated_file: z
      .string()
      .describe('The updated notebook content after modification'),
  }),
)
// 输出 schema 带归因字段：original_file / updated_file 保存改动前后完整内容
// （供 attribution/回滚追踪），error 为空字符串表示成功。
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

export const NotebookEditTool = buildTool({
  name: NOTEBOOK_EDIT_TOOL_NAME,
  searchHint: 'edit Jupyter notebook cells (.ipynb)',
  maxResultSizeChars: 100_000,
  shouldDefer: true,
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return PROMPT
  },
  userFacingName() {
    return 'Edit Notebook'
  },
  getToolUseSummary,
  getActivityDescription(input) {
    const summary = getToolUseSummary(input)
    return summary ? `Editing notebook ${summary}` : 'Editing notebook'
  },
// getActivityDescription：活动流里显示「Editing notebook <路径>」。
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  toAutoClassifierInput(input) {
    if (feature('TRANSCRIPT_CLASSIFIER')) {
      const mode = input.edit_mode ?? 'replace'
      return `${input.notebook_path} ${mode}: ${input.new_source}`
    }
    return ''
  },
// toAutoClassifierInput：TRANSCRIPT_CLASSIFIER 特性开启时用「路径 模式: 新内容」
// 作为分类器输入；否则返回空串（不参与分类）。
  getPath(input): string {
    return input.notebook_path
  },
  async checkPermissions(input, context): Promise<PermissionDecision> {
    const appState = context.getAppState()
    return checkWritePermissionForTool(
      NotebookEditTool,
      input,
      appState.toolPermissionContext,
    )
  },
// 权限检查直接复用文件写入权限链（checkWritePermissionForTool），
// 与 FileEditTool/FileWriteTool 共用同一套 allowlist 规则。
  mapToolResultToToolResultBlockParam(
    { cell_id, edit_mode, new_source, error },
    toolUseID,
  ) {
    if (error) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: error,
        is_error: true,
      }
    }
    switch (edit_mode) {
      case 'replace':
        return {
          tool_use_id: toolUseID,
          type: 'tool_result',
          content: `Updated cell ${cell_id} with ${new_source}`,
        }
      case 'insert':
        return {
          tool_use_id: toolUseID,
          type: 'tool_result',
          content: `Inserted cell ${cell_id} with ${new_source}`,
        }
      case 'delete':
        return {
          tool_use_id: toolUseID,
          type: 'tool_result',
          content: `Deleted cell ${cell_id}`,
        }
      default:
        return {
          tool_use_id: toolUseID,
          type: 'tool_result',
          content: 'Unknown edit mode',
        }
    }
  },
// 工具结果文本按 edit_mode 分三种措辞（Updated/Inserted/Deleted cell）；
// error 非空时标记 is_error 回传。
  renderToolUseMessage,
  renderToolUseRejectedMessage,
  renderToolUseErrorMessage,
  renderToolResultMessage,
  async validateInput(
    { notebook_path, cell_type, cell_id, edit_mode = 'replace' },
    toolUseContext: ToolUseContext,
  ) {
    const fullPath = isAbsolute(notebook_path)
      ? notebook_path
      : resolve(getCwd(), notebook_path)

    // SECURITY: Skip filesystem operations for UNC paths to prevent NTLM credential leaks.
    if (fullPath.startsWith('\\\\') || fullPath.startsWith('//')) {
      return { result: true }
    }
// SECURITY：UNC 路径（\\ 或 // 开头）直接短路跳过所有文件系统操作——
// 防止 SMB 访问触发 NTLM 凭据泄露。与 FileEditTool/FileWriteTool 同款防护。

    if (extname(fullPath) !== '.ipynb') {
      return {
        result: false,
        message:
          'File must be a Jupyter notebook (.ipynb file). For editing other file types, use the FileEdit tool.',
        errorCode: 2,
      }
    }
// 错误码 2：扩展名必须是 .ipynb；改其他文件请用 FileEdit。

    if (
      edit_mode !== 'replace' &&
      edit_mode !== 'insert' &&
      edit_mode !== 'delete'
    ) {
      return {
        result: false,
        message: 'Edit mode must be replace, insert, or delete.',
        errorCode: 4,
      }
    }
// 错误码 4：edit_mode 三值校验。zod schema 已限枚举，这里是纵深防御
// （Schema 可能被绕过或旧调用方传入任意字符串）。

    if (edit_mode === 'insert' && !cell_type) {
      return {
        result: false,
        message: 'Cell type is required when using edit_mode=insert.',
        errorCode: 5,
      }
    }
// 错误码 5：insert 模式必须显式给 cell_type——新单元格没有「当前类型」可继承。

    // Require Read-before-Edit (matches FileEditTool/FileWriteTool). Without
    // this, the model could edit a notebook it never saw, or edit against a
    // stale view after an external change — silent data loss.
    const readTimestamp = toolUseContext.readFileState.get(fullPath)
    if (!readTimestamp) {
      return {
        result: false,
        message:
          'File has not been read yet. Read it first before writing to it.',
        errorCode: 9,
      }
    }
// 错误码 9：强制 Read-before-Edit（与 FileEditTool/FileWriteTool 一致）。
// 没有这条，模型可能改一个从没看过的 notebook，或对着过期视图编辑——静默丢数据。
    if (getFileModificationTime(fullPath) > readTimestamp.timestamp) {
      return {
        result: false,
        message:
          'File has been modified since read, either by the user or by a linter. Read it again before attempting to write it.',
        errorCode: 10,
      }
    }
// 错误码 10：mtime 新鲜度检查——文件在读取后被用户或 linter 改过，必须重读再写。

    let content: string
    try {
      content = readFileSyncWithMetadata(fullPath).content
    } catch (e) {
      if (isENOENT(e)) {
        return {
          result: false,
          message: 'Notebook file does not exist.',
          errorCode: 1,
        }
      }
      throw e
    }
// 错误码 1：文件不存在（ENOENT）；其他读取异常原样上抛。
    const notebook = safeParseJSON(content) as NotebookContent | null
    if (!notebook) {
      return {
        result: false,
        message: 'Notebook is not valid JSON.',
        errorCode: 6,
      }
    }
// 错误码 6：notebook 不是合法 JSON。safeParseJSON 返回 null 即打回。
    if (!cell_id) {
      if (edit_mode !== 'insert') {
        return {
          result: false,
          message: 'Cell ID must be specified when not inserting a new cell.',
          errorCode: 7,
        }
      }
// 错误码 7（上）：非 insert 模式必须指定 cell_id——替换/删除不能没有目标。
    } else {
      // First try to find the cell by its actual ID
      const cellIndex = notebook.cells.findIndex(cell => cell.id === cell_id)

      if (cellIndex === -1) {
        // If not found, try to parse as a numeric index (cell-N format)
        const parsedCellIndex = parseCellId(cell_id)
        if (parsedCellIndex !== undefined) {
          if (!notebook.cells[parsedCellIndex]) {
            return {
              result: false,
              message: `Cell with index ${parsedCellIndex} does not exist in notebook.`,
              errorCode: 7,
            }
          }
        } else {
          return {
            result: false,
            message: `Cell with ID "${cell_id}" not found in notebook.`,
            errorCode: 8,
          }
        }
      }
    }
// cell 定位两段式：先按真实 id 精确匹配；找不到再按 cell-N 格式解析为数字下标
// （旧版 notebook 没有 id 字段时的兼容路径），下标越界或解析失败均报错误码 7/8。

    return { result: true }
  },
  async call(
    {
      notebook_path,
      new_source,
      cell_id,
      cell_type,
      edit_mode: originalEditMode,
    },
    { readFileState, updateFileHistoryState },
    _,
    parentMessage,
  ) {
    const fullPath = isAbsolute(notebook_path)
      ? notebook_path
      : resolve(getCwd(), notebook_path)

    if (fileHistoryEnabled()) {
      await fileHistoryTrackEdit(
        updateFileHistoryState,
        fullPath,
        parentMessage.uuid,
      )
    }
// 文件历史开启时先记录编辑快照（fileHistoryTrackEdit），支持回滚到改动前。

    try {
      // readFileSyncWithMetadata gives content + encoding + line endings in
      // one safeResolvePath + readFileSync pass, replacing the previous
      // detectFileEncoding + readFile + detectLineEndings chain (each of
      // which redid safeResolvePath and/or a 4KB readSync).
      const { content, encoding, lineEndings } =
        readFileSyncWithMetadata(fullPath)
// readFileSyncWithMetadata 一次 pass 拿到 content + encoding + lineEndings，
// 取代旧的 detectFileEncoding + readFile + detectLineEndings 三连
// （每步都要重做 safeResolvePath 或 4KB readSync）。
      // Must use non-memoized jsonParse here: safeParseJSON caches by content
      // string and returns a shared object reference, but we mutate the
      // notebook in place below (cells.splice, targetCell.source = ...).
      // Using the memoized version poisons the cache for validateInput() and
      // any subsequent call() with the same file content.
// 必须用非记忆化 jsonParse：safeParseJSON 按内容字符串缓存并返回共享引用，
// 而下面会原地改 notebook（cells.splice、targetCell.source=...）。
// 用记忆化版本会毒化缓存，污染 validateInput 和同内容的后续 call()。
      let notebook: NotebookContent
      try {
        notebook = jsonParse(content) as NotebookContent
      } catch {
        return {
          data: {
            new_source,
            cell_type: cell_type ?? 'code',
            language: 'python',
            edit_mode: 'replace',
            error: 'Notebook is not valid JSON.',
            cell_id,
            notebook_path: fullPath,
            original_file: '',
            updated_file: '',
          },
        }
      }
// call 阶段 JSON 解析失败（validate 之后文件又变坏的竞态）：返回带 error 的结果，
// original/updated 置空串。

      let cellIndex
      if (!cell_id) {
        cellIndex = 0 // Default to inserting at the beginning if no cell_id is provided
      } else {
        // First try to find the cell by its actual ID
        cellIndex = notebook.cells.findIndex(cell => cell.id === cell_id)

        // If not found, try to parse as a numeric index (cell-N format)
        if (cellIndex === -1) {
          const parsedCellIndex = parseCellId(cell_id)
          if (parsedCellIndex !== undefined) {
            cellIndex = parsedCellIndex
          }
        }

        if (originalEditMode === 'insert') {
          cellIndex += 1 // Insert after the cell with this ID
        }
      }
// cellIndex 解析与 validateInput 同款两段式；与 validateInput 的差异：
// insert 模式下 cellIndex += 1——语义是「插到该单元格之后」。

      // Convert replace to insert if trying to replace one past the end
      let edit_mode = originalEditMode
      if (edit_mode === 'replace' && cellIndex === notebook.cells.length) {
        edit_mode = 'insert'
        if (!cell_type) {
          cell_type = 'code' // Default to code if no cell_type specified
        }
      }
// replace→insert 自动转换：想替换「末尾+1」位置的单元格 = 追加新单元格，
// 此时若未指定 cell_type 默认 code。

      const language = notebook.metadata.language_info?.name ?? 'python'
// 语言取 notebook 元数据 language_info.name，缺省 python。
      let new_cell_id = undefined
      if (
        notebook.nbformat > 4 ||
        (notebook.nbformat === 4 && notebook.nbformat_minor >= 5)
      ) {
        if (edit_mode === 'insert') {
          new_cell_id = Math.random().toString(36).substring(2, 15)
        } else if (cell_id !== null) {
          new_cell_id = cell_id
        }
      }
// nbformat >= 4.5 才有单元格 id：insert 生成随机短 id（base36）；
// replace/delete 沿用原 id。旧格式 notebook 不写 id 字段。

      if (edit_mode === 'delete') {
        // Delete the specified cell
        notebook.cells.splice(cellIndex, 1)
// delete：splice 删掉目标单元格。
      } else if (edit_mode === 'insert') {
        let new_cell: NotebookCell
        if (cell_type === 'markdown') {
          new_cell = {
            cell_type: 'markdown',
            id: new_cell_id,
            source: new_source,
            metadata: {},
          }
        } else {
          new_cell = {
            cell_type: 'code',
            id: new_cell_id,
            source: new_source,
            metadata: {},
            execution_count: null,
            outputs: [],
          }
        }
        // Insert the new cell
        notebook.cells.splice(cellIndex, 0, new_cell)
// insert：按 cell_type 构造新单元格——code 型带 execution_count/outputs 空值，
// markdown 型只要 source 与 metadata；splice 插入到 cellIndex。
      } else {
        // Find the specified cell
        const targetCell = notebook.cells[cellIndex]! // validateInput ensures cell_number is in bounds
        targetCell.source = new_source
        if (targetCell.cell_type === 'code') {
          // Reset execution count and clear outputs since cell was modified
          targetCell.execution_count = null
          targetCell.outputs = []
        }
        if (cell_type && cell_type !== targetCell.cell_type) {
          targetCell.cell_type = cell_type
        }
      }
// replace：覆盖 source；code 单元格同时清空 execution_count 与 outputs
// （源码变了旧输出已无意义）；显式给了不同 cell_type 就地改型。
      // Write back to file
      const IPYNB_INDENT = 1
      const updatedContent = jsonStringify(notebook, null, IPYNB_INDENT)
// Jupyter 官方工具链用 1 空格缩进序列化 .ipynb——保持与其一致，diff 最小。
      writeTextContent(fullPath, updatedContent, encoding, lineEndings)
      // Update readFileState with post-write mtime (matches FileEditTool/
      // FileWriteTool). offset:undefined breaks FileReadTool's dedup match —
      // without this, Read→NotebookEdit→Read in the same millisecond would
      // return the file_unchanged stub against stale in-context content.
      readFileState.set(fullPath, {
        content: updatedContent,
        timestamp: getFileModificationTime(fullPath),
        offset: undefined,
        limit: undefined,
      })
// 写后更新 readFileState（记录 post-write mtime，与 FileEditTool/FileWriteTool 一致）。
// offset:undefined 会打断 FileReadTool 的去重匹配——没有这步，
// 同一毫秒内 Read→NotebookEdit→Read 会拿 file_unchanged 桩顶替过期内容。
      const data = {
        new_source,
        cell_type: cell_type ?? 'code',
        language,
        edit_mode: edit_mode ?? 'replace',
        cell_id: new_cell_id || undefined,
        error: '',
        notebook_path: fullPath,
        original_file: content,
        updated_file: updatedContent,
      }
// 成功结果带 original_file/updated_file 全文（归因用）与 new_cell_id。
      return {
        data,
      }
    } catch (error) {
      if (error instanceof Error) {
        const data = {
          new_source,
          cell_type: cell_type ?? 'code',
          language: 'python',
          edit_mode: 'replace',
          error: error.message,
          cell_id,
          notebook_path: fullPath,
          original_file: '',
          updated_file: '',
        }
        return {
          data,
        }
      }
      const data = {
        new_source,
        cell_type: cell_type ?? 'code',
        language: 'python',
        edit_mode: 'replace',
        error: 'Unknown error occurred while editing notebook',
        cell_id,
        notebook_path: fullPath,
        original_file: '',
        updated_file: '',
      }
      return {
        data,
      }
    }
// 异常兜底：Error 实例带 message，非 Error 一律「Unknown error」；
// 两种都返回带 error 字段的结构化结果而不是抛出——让模型看到可读失败信息。
  },
} satisfies ToolDef<InputSchema, Output>)
