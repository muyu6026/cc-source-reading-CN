import { isCompactLinePrefixEnabled } from '../../utils/file.js'
import { FILE_READ_TOOL_NAME } from '../FileReadTool/prompt.js'

// 「必须先 Read 才能改」这条约束**写进了 prompt 本身**，而且用了两处强化：一处是这里单独抽成函数插进 `Usage:` 之后（位置最靠前），一处是说明「不给读就报错」。工具描述是模型唯一能看到的契约，把硬规则写进它，比在代码里拒绝之后让模型自己猜原因有效得多。
function getPreReadInstruction(): string {
  return `\n- You must use your \`${FILE_READ_TOOL_NAME}\` tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file. `
}

export function getEditToolDescription(): string {
  return getDefaultEditDescription()
}

function getDefaultEditDescription(): string {
  const prefixFormat = isCompactLinePrefixEnabled()
    ? 'line number + tab'
    : 'spaces + line number + arrow'
// 行号前缀的格式**随配置变化**（`line number + tab` 还是 `spaces + line number + arrow`），所以 prompt 里只能动态拼。这个细节是整个工具最容易出错的地方：模型要复制 Read 输出里的内容做 `old_string`，一旦把行号前缀也算进去，替换必然失败。描述里那句 `Everything after that is the actual file content to match` 就是为此写的。
// 这段「用尽量短的 `old_string`」的提示**只在内部构建里下发**（`USER_TYPE === 'ant'`），外部用户看到的是不带这条的版本。原因大概是内部模型更听话、可以要求它精确控制上下文长度；对外则保守——真删掉这条，模型会因为怕不唯一而把几十行上下文全塞进 `old_string`，反而更容易撞上「多处匹配」。
  const minimalUniquenessHint =
    process.env.USER_TYPE === 'ant'
      ? `\n- Use the smallest old_string that's clearly unique — usually 2-4 adjacent lines is sufficient. Avoid including 10+ lines of context when less uniquely identifies the target.`
      : ''
// 整个描述的核心取舍在最后两行：**唯一性失败要么加更多上下文、要么用 `replace_all`**，并且明确说 `replace_all` 适合「重命名变量」这类场景。这条把「匹配到多个」从一个错误变成了一个需要模型自己决策的分叉——比只说 `The edit will FAIL` 有用。
  return `Performs exact string replacements in files.

Usage:${getPreReadInstruction()}
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: ${prefixFormat}. Everything after that is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.
- The edit will FAIL if \`old_string\` is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use \`replace_all\` to change every instance of \`old_string\`.${minimalUniquenessHint}
- Use \`replace_all\` for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.`
}
