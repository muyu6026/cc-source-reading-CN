import { isPDFSupported } from '../../utils/pdfUtils.js'
import { BASH_TOOL_NAME } from '../BashTool/toolName.js'

// Use a string constant for tool names to avoid circular dependencies
export const FILE_READ_TOOL_NAME = 'Read'

export const FILE_UNCHANGED_STUB =
  'File unchanged since last read. The content from the earlier Read tool_result in this conversation is still current — refer to that instead of re-reading.'
// 去重命中的那句桩文案，写得很讲究：三句话分别回答模型的三个疑问 —— 发生了什么（内容是上次读的）、可信吗（仍然是最新的）、该怎么办（引用之前那次的结果，别再读）。少了第三句，模型往往会「保险起见」再读一遍，去重就白做了。

export const MAX_LINES_TO_READ = 2000
// 默认读 2,000 行。这个数和 `limits.ts` 的 25,000 token 是**两道独立的闸**：2,000 行是行数闸（防长文件一次吃满），25,000 token 是 token 闸（防压缩率低的文件）。一个 2,000 行的压缩 JS 可能远超 25,000 token，所以两道都要有。

export const DESCRIPTION = 'Read a file from the local filesystem.'

// `DESCRIPTION` 只有一句话，和下面 `renderPromptTemplate` 拼出来的长模板是**两套东西**：这个短描述用于工具列表 / 展示层，长模板才是喂给模型的完整说明。两者都叫 description 容易混，看代码时注意 `async description()` 返回的是这个短句，`async prompt()` 返回的才是长模板。
export const LINE_FORMAT_INSTRUCTION =
  '- Results are returned using cat -n format, with line numbers starting at 1'

export const OFFSET_INSTRUCTION_DEFAULT =
  "- You can optionally specify a line offset and limit (especially handy for long files), but it's recommended to read the whole file by not providing these parameters"

export const OFFSET_INSTRUCTION_TARGETED =
  '- When you already know which part of the file you need, only read that part. This can be important for larger files.'
// offset 指令的**两套文案**之一（targeted 版）。默认版说的是「建议整读，别传 offset」，这版反过来说「已知要哪段就只读那段」。为什么值得做成开关：整读的好处是模型拿到完整上下文（少犯「没看到那一段」的错），坏处是大文件白烧 token。哪个更好取决于用户实际在干什么 —— 所以交给 GrowthBook 按用户行为分。这是「用实验调 prompt」而不是「拍脑袋写死」。

/**
 * Renders the Read tool prompt template.  The caller (FileReadTool) supplies
 * the runtime-computed parts.
 */
export function renderPromptTemplate(
  lineFormat: string,
  maxSizeInstruction: string,
  offsetInstruction: string,
): string {
// 模板本体。三个插值位分别对应上面的三段：行数 + 可选的大小提示、offset 指令、行号格式。还有一处**运行时条件**：`isPDFSupported()` 为假时，PDF 那一段整句消失（不支持的模型不该被告知有这个能力，否则它会去试然后拿到错误）。最后两条是硬规矩的来源 —— 「必须先 Read 才能 Edit」写在这里，`FileEditTool` 的校验只是执行它。
  return `Reads a file from the local filesystem. You can access any file directly by using this tool.
Assume this tool is able to read all files on the machine. If the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.

Usage:
- The file_path parameter must be an absolute path, not a relative path
- By default, it reads up to ${MAX_LINES_TO_READ} lines starting from the beginning of the file${maxSizeInstruction}
${offsetInstruction}
${lineFormat}
- This tool allows Claude Code to read images (eg PNG, JPG, etc). When reading an image file the contents are presented visually as Claude Code is a multimodal LLM.${
    isPDFSupported()
      ? '\n- This tool can read PDF files (.pdf). For large PDFs (more than 10 pages), you MUST provide the pages parameter to read specific page ranges (e.g., pages: "1-5"). Reading a large PDF without the pages parameter will fail. Maximum 20 pages per request.'
      : ''
  }
- This tool can read Jupyter notebooks (.ipynb files) and returns all cells with their outputs, combining code, text, and visualizations.
- This tool can only read files, not directories. To read a directory, use an ls command via the ${BASH_TOOL_NAME} tool.
- You will regularly be asked to read screenshots. If the user provides a path to a screenshot, ALWAYS use this tool to view the file at the path. This tool will work with all temporary file paths.
- If you read a file that exists but has empty contents you will receive a system reminder warning in place of file contents.`
}
