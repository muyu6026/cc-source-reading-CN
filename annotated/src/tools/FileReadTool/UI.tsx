import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import * as React from 'react';
import { extractTag } from 'src/utils/messages.js';
import { FallbackToolUseErrorMessage } from '../../components/FallbackToolUseErrorMessage.js';
import { FilePathLink } from '../../components/FilePathLink.js';
import { MessageResponse } from '../../components/MessageResponse.js';
import { Text } from '../../ink.js';
import { FILE_NOT_FOUND_CWD_NOTE, getDisplayPath } from '../../utils/file.js';
import { formatFileSize } from '../../utils/format.js';
import { getPlansDirectory } from '../../utils/plans.js';
import { getTaskOutputDir } from '../../utils/task/diskOutput.js';
import type { Input, Output } from './FileReadTool.js';

/**
 * Check if a file path is an agent output file and extract the task ID.
 * Agent output files follow the pattern: {projectTempDir}/tasks/{taskId}.output
 */
function getAgentOutputTaskId(filePath: string): string | null {
  const prefix = `${getTaskOutputDir()}/`;
  const suffix = '.output';
  if (filePath.startsWith(prefix) && filePath.endsWith(suffix)) {
    const taskId = filePath.slice(prefix.length, -suffix.length);
    // Validate it looks like a task ID (alphanumeric, reasonable length)
    if (taskId.length > 0 && taskId.length <= 20 && /^[a-zA-Z0-9_-]+$/.test(taskId)) {
      return taskId;
    }
  }
  return null;
}
// 识别「agent 输出文件」（路径形如 `{任务临时目录}/tasks/{taskId}.output`）。识别出来之后有两个专门处理：`renderToolUseMessage` 里返回空串（不显示那对括号），`renderToolUseTag` 里单独用暗淡色显示 taskId。为什么要特殊对待：子代理的输出是用户最常点的东西，把 20 位随机 taskId 塞在括号里和路径混在一起就没人能读，单独拎出来才是「可扫读」的。校验 `taskId` 只允许字母数字下划线短横且长度 ≤20 —— 因为这里是在**认路径形状**，不校验就可能把任意 `.output` 文件当成 agent 输出。
export function renderToolUseMessage({
  file_path,
  offset,
  limit,
  pages
}: Partial<Input>, {
  verbose
}: {
  verbose: boolean;
}): React.ReactNode {
  if (!file_path) {
    return null;
  }

  // For agent output files, return empty string so no parentheses are shown
  // The task ID is displayed separately by AssistantToolUseMessage
  if (getAgentOutputTaskId(file_path)) {
    return '';
  }
  const displayPath = verbose ? file_path : getDisplayPath(file_path);
// `verbose` 决定显示绝对路径还是 `getDisplayPath` 缩短版。这是 TUI 里一个反复出现的取舍：默认视图要短（路径占满一行会把工具名挤掉），但 `--verbose` 是用户主动要求「给我看全」。`pages` 和 `offset/limit` 两段只在**真的传了**时才显示，且 `offset/limit` 还要 `verbose` 才显示行号范围 —— 否则默认视图里每个 Read 都拖一条 `· lines 100-200`，噪音比信息多。
  if (pages) {
    return <>
        <FilePathLink filePath={file_path}>{displayPath}</FilePathLink>
        {` · pages ${pages}`}
      </>;
  }
  if (verbose && (offset || limit)) {
    const startLine = offset ?? 1;
    const lineRange = limit ? `lines ${startLine}-${startLine + limit - 1}` : `from line ${startLine}`;
    return <>
        <FilePathLink filePath={file_path}>{displayPath}</FilePathLink>
        {` · ${lineRange}`}
      </>;
  }
  return <FilePathLink filePath={file_path}>{displayPath}</FilePathLink>;
}
// 工具调用行的渲染收尾。三条路径都返回 `FilePathLink`（可点击跳转），区别只在后缀：无 → 只有路径；有 pages → `· pages 1-5`；verbose 且有 offset/limit → `· lines 100-200` 或 `· from line 100`。注意 `limit` 缺省时显示 `from line N` 而不是算出一个范围 —— 因为没给 limit 就不知道会读到哪，硬算一个范围等于撒谎。
export function renderToolUseTag({
  file_path
}: Partial<Input>): React.ReactNode {
  const agentTaskId = file_path ? getAgentOutputTaskId(file_path) : null;

  // Show agent task ID for Read tool when reading agent output
  if (!agentTaskId) {
    return null;
  }
  return <Text dimColor> {agentTaskId}</Text>;
}
export function renderToolResultMessage(output: Output): React.ReactNode {
  // TODO: Render recursively
  switch (output.type) {
    case 'image':
      {
        const {
          originalSize
        } = output.file;
        const formattedSize = formatFileSize(originalSize);
        return <MessageResponse height={1}>
          <Text>Read image ({formattedSize})</Text>
        </MessageResponse>;
      }
    case 'notebook':
      {
        const {
          cells
        } = output.file;
        if (!cells || cells.length < 1) {
          return <Text color="error">No cells found in notebook</Text>;
        }
        return <MessageResponse height={1}>
          <Text>
            Read <Text bold>{cells.length}</Text> cells
          </Text>
        </MessageResponse>;
      }
    case 'pdf':
      {
        const {
          originalSize
        } = output.file;
        const formattedSize = formatFileSize(originalSize);
        return <MessageResponse height={1}>
          <Text>Read PDF ({formattedSize})</Text>
        </MessageResponse>;
      }
    case 'parts':
      {
        return <MessageResponse height={1}>
          <Text>
            Read <Text bold>{output.file.count}</Text>{' '}
            {output.file.count === 1 ? 'page' : 'pages'} (
            {formatFileSize(output.file.originalSize)})
          </Text>
        </MessageResponse>;
      }
    case 'text':
      {
        const {
          numLines
        } = output.file;
        return <MessageResponse height={1}>
          <Text>
            Read <Text bold>{numLines}</Text>{' '}
            {numLines === 1 ? 'line' : 'lines'}
          </Text>
        </MessageResponse>;
      }
    case 'file_unchanged':
      {
        return <MessageResponse height={1}>
          <Text dimColor>Unchanged since last read</Text>
        </MessageResponse>;
      }
  }
}
// 结果渲染的六个分支，全都只有**一行摘要**：`Read 42 lines`、`Read image (42KB)`、`Read PDF (12KB)`、`Read 3 pages (1.2MB)`、`Read 8 cells`、`Unchanged since last read`。**一行内容都不显示**。这是 Read 工具 UI 的核心决定（`FileReadTool.ts` 里 `extractSearchText` 那段注释也在说同一件事）：文件内容只在模型侧序列化里出现，一旦渲染到终端，长文件会把历史记录冲掉，用户反而找不到自己刚问的问题。单复数还都做了处理（`1 line` / `2 lines`、`1 page` / `2 pages`）。
export function renderToolUseErrorMessage(result: ToolResultBlockParam['content'], {
  verbose
}: {
  verbose: boolean;
}): React.ReactNode {
  if (!verbose && typeof result === 'string') {
    // FileReadTool throws from call() so errors lack <tool_use_error> wrapping —
    // check the raw string directly for the cwd note marker.
    if (result.includes(FILE_NOT_FOUND_CWD_NOTE)) {
      return <MessageResponse>
          <Text color="error">File not found</Text>
        </MessageResponse>;
    }
    if (extractTag(result, 'tool_use_error')) {
      return <MessageResponse>
          <Text color="error">Error reading file</Text>
        </MessageResponse>;
    }
  }
  return <FallbackToolUseErrorMessage result={result} verbose={verbose} />;
// 错误渲染的非 verbose 分支。关键在注释那句：`FileReadTool` 是在 `call()` 里 **throw** 而不是返回错误对象，所以拿到的字符串**没有被 `<tool_use_error>` 包裹**，不能靠 `extractTag` 认。只能直接比对 `FILE_NOT_FOUND_CWD_NOTE` 这个标记串，命中就折成一句红色的 `File not found` —— 完整的长错误（含 cwd 提示、相似文件名建议）只在 verbose 或 fallback 里显示。
}
export function userFacingName(input: Partial<Input> | undefined): string {
  if (input?.file_path?.startsWith(getPlansDirectory())) {
    return 'Reading Plan';
  }
  if (input?.file_path && getAgentOutputTaskId(input.file_path)) {
    return 'Read agent output';
  }
  return 'Read';
}
// `userFacingName` 是 TUI 里那个动词。三种：读计划目录下的文件显示 `Reading Plan`（计划文件有独立语义，用户看到这个词就知道模型在读自己的方案）、读 agent 输出显示 `Read agent output`、其余一律 `Read`。`getToolUseSummary` 则决定括号里的内容 —— 读 agent 输出时只给 taskId，不显示那条又长又没信息量的临时路径。
export function getToolUseSummary(input: Partial<Input> | undefined): string | null {
  if (!input?.file_path) {
    return null;
  }
  // For agent output files, just show the task ID
  const agentTaskId = getAgentOutputTaskId(input.file_path);
  if (agentTaskId) {
    return agentTaskId;
  }
  return getDisplayPath(input.file_path);
}
// 原文件此处有一行 16580 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。