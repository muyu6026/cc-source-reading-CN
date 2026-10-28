import type {
  ImageBlockParam,
  TextBlockParam,
  ToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/index.mjs'
import { BASH_TOOL_NAME } from '../tools/BashTool/toolName.js'
import { formatOutput } from '../tools/BashTool/utils.js'
import type {
  NotebookCell,
  NotebookCellOutput,
  NotebookCellSource,
  NotebookCellSourceOutput,
  NotebookContent,
  NotebookOutputImage,
} from '../types/notebook.js'
import { getFsImplementation } from './fsOperations.js'
import { expandPath } from './path.js'
import { jsonParse } from './slowOperations.js'

// 大输出阈值：单个 cell 的输出累计超过 1 万字符就视为「过大」，转成提示用 Bash 自行查看。
const LARGE_OUTPUT_THRESHOLD = 10000

function isLargeOutputs(
  outputs: (NotebookCellSourceOutput | undefined)[],
): boolean {
  let size = 0
  for (const o of outputs) {
    if (!o) continue
    size += (o.text?.length ?? 0) + (o.image?.image_data.length ?? 0)
    if (size > LARGE_OUTPUT_THRESHOLD) return true
  }
  return false
}
// 判断一组输出是否过大：累加文本与图片字节，超过阈值即返回真。

function processOutputText(text: string | string[] | undefined): string {
  if (!text) return ''
  const rawText = Array.isArray(text) ? text.join('') : text
  const { truncatedContent } = formatOutput(rawText)
  return truncatedContent
}
// 把输出文本统一截断（经 formatOutput），数组形式先拼接再处理。

function extractImage(
  data: Record<string, unknown>,
): NotebookOutputImage | undefined {
  if (typeof data['image/png'] === 'string') {
    return {
      image_data: data['image/png'].replace(/\s/g, ''),
      media_type: 'image/png',
    }
  }
  if (typeof data['image/jpeg'] === 'string') {
    return {
      image_data: data['image/jpeg'].replace(/\s/g, ''),
      media_type: 'image/jpeg',
    }
  }
  return undefined
}
// 从输出 data 里抽取 png 或 jpeg 图片并去掉空白，转成统一图片结构。

function processOutput(output: NotebookCellOutput) {
  switch (output.output_type) {
    case 'stream':
      return {
        output_type: output.output_type,
        text: processOutputText(output.text),
      }
    case 'execute_result':
    case 'display_data':
      return {
        output_type: output.output_type,
        text: processOutputText(output.data?.['text/plain']),
        image: output.data && extractImage(output.data),
      }
    case 'error':
      return {
        output_type: output.output_type,
        text: processOutputText(
          `${output.ename}: ${output.evalue}\n${output.traceback.join('\n')}`,
        ),
      }
  }
}
// 按 output_type 分派处理：stream、execute_result、display_data、error 四种。

function processCell(
  cell: NotebookCell,
  index: number,
  codeLanguage: string,
  includeLargeOutputs: boolean,
): NotebookCellSource {
  const cellId = cell.id ?? `cell-${index}`
  const cellData: NotebookCellSource = {
    cellType: cell.cell_type,
    source: Array.isArray(cell.source) ? cell.source.join('') : cell.source,
    execution_count:
      cell.cell_type === 'code' ? cell.execution_count || undefined : undefined,
    cell_id: cellId,
  }
  // Avoid giving text cells the code language.
  if (cell.cell_type === 'code') {
    cellData.language = codeLanguage
  }

  if (cell.cell_type === 'code' && cell.outputs?.length) {
    const outputs = cell.outputs.map(processOutput)
    if (!includeLargeOutputs && isLargeOutputs(outputs)) {
      cellData.outputs = [
        {
          output_type: 'stream',
          text: `Outputs are too large to include. Use ${BASH_TOOL_NAME} with: cat <notebook_path> | jq '.cells[${index}].outputs'`,
        },
      ]
    } else {
      cellData.outputs = outputs
    }
  }

  return cellData
}
// 把单个 cell 处理成 NotebookCellSource：文本 cell 不戴代码语言；代码 cell 有输出且过大时只留提示。

function cellContentToToolResult(cell: NotebookCellSource): TextBlockParam {
  const metadata = []
  if (cell.cellType !== 'code') {
    metadata.push(`<cell_type>${cell.cellType}</cell_type>`)
  }
  if (cell.language !== 'python' && cell.cellType === 'code') {
    metadata.push(`<language>${cell.language}</language>`)
  }
  const cellContent = `<cell id="${cell.cell_id}">${metadata.join('')}${cell.source}</cell id="${cell.cell_id}">`
  return {
    text: cellContent,
    type: 'text',
  }
}
// 把 cell 内容包成文本块，附带 cell_type 与 language 元信息（非 Python 才标语言）。

function cellOutputToToolResult(output: NotebookCellSourceOutput) {
  const outputs: (TextBlockParam | ImageBlockParam)[] = []
  if (output.text) {
    outputs.push({
      text: `\n${output.text}`,
      type: 'text',
    })
  }
  if (output.image) {
    outputs.push({
      type: 'image',
      source: {
        data: output.image.image_data,
        media_type: output.image.media_type,
        type: 'base64',
      },
    })
  }
  return outputs
}
// 把 cell 输出转成文本块与图片块（图片走 base64）。

function getToolResultFromCell(cell: NotebookCellSource) {
  const contentResult = cellContentToToolResult(cell)
  const outputResults = cell.outputs?.flatMap(cellOutputToToolResult)
  return [contentResult, ...(outputResults ?? [])]
}
// 组合一个 cell 的内容块与其输出块，得到该 cell 的工具结果片段列表。

/**
 * Reads and parses a Jupyter notebook file into processed cell data
 */
export async function readNotebook(
  notebookPath: string,
  cellId?: string,
): Promise<NotebookCellSource[]> {
  const fullPath = expandPath(notebookPath)
  const buffer = await getFsImplementation().readFileBytes(fullPath)
  const content = buffer.toString('utf-8')
  const notebook = jsonParse(content) as NotebookContent
  const language = notebook.metadata.language_info?.name ?? 'python'
  if (cellId) {
    const cell = notebook.cells.find(c => c.id === cellId)
    if (!cell) {
      throw new Error(`Cell with ID "${cellId}" not found in notebook`)
    }
    return [processCell(cell, notebook.cells.indexOf(cell), language, true)]
  }
  return notebook.cells.map((cell, index) =>
    processCell(cell, index, language, false),
  )
}
// 读取并解析 ipynb 为处理后的 cell 数据；指定 cellId 时只返回那一个 cell。

/**
 * Maps notebook cell data to tool result block parameters with sophisticated text block merging
 */
export function mapNotebookCellsToToolResult(
  data: NotebookCellSource[],
  toolUseID: string,
): ToolResultBlockParam {
  const allResults = data.flatMap(getToolResultFromCell)

  // Merge adjacent text blocks
  return {
    tool_use_id: toolUseID,
    type: 'tool_result' as const,
    content: allResults.reduce<(TextBlockParam | ImageBlockParam)[]>(
      (acc, curr) => {
        if (acc.length === 0) return [curr]

        const prev = acc[acc.length - 1]
        if (prev && prev.type === 'text' && curr.type === 'text') {
          // Merge the text blocks
          prev.text += '\n' + curr.text
          return acc
        }

        acc.push(curr)
        return acc
      },
      [],
    ),
  }
}
// 把全部 cell 映射成工具结果块，并合并相邻的文本块以减少块数量。

export function parseCellId(cellId: string): number | undefined {
  const match = cellId.match(/^cell-(\d+)$/)
  if (match && match[1]) {
    const index = parseInt(match[1], 10)
    return isNaN(index) ? undefined : index
  }
  return undefined
}
// 把 cell-N 形式的 cellId 解析成数字下标，解析失败返回 undefined。
