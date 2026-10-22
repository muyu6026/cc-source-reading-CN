import { c as _c } from "react/compiler-runtime";
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import type { StructuredPatchHunk } from 'diff';
import * as React from 'react';
import { Suspense, use, useState } from 'react';
import { FileEditToolUseRejectedMessage } from 'src/components/FileEditToolUseRejectedMessage.js';
import { MessageResponse } from 'src/components/MessageResponse.js';
import { extractTag } from 'src/utils/messages.js';
import { FallbackToolUseErrorMessage } from '../../components/FallbackToolUseErrorMessage.js';
import { FileEditToolUpdatedMessage } from '../../components/FileEditToolUpdatedMessage.js';
import { FilePathLink } from '../../components/FilePathLink.js';
import { Text } from '../../ink.js';
import type { Tools } from '../../Tool.js';
import type { Message, ProgressMessage } from '../../types/message.js';
import { adjustHunkLineNumbers, CONTEXT_LINES } from '../../utils/diff.js';
import { FILE_NOT_FOUND_CWD_NOTE, getDisplayPath } from '../../utils/file.js';
import { logError } from '../../utils/log.js';
import { getPlansDirectory } from '../../utils/plans.js';
import { readEditContext } from '../../utils/readEditContext.js';
import { firstLineOf } from '../../utils/stringUtils.js';
import type { ThemeName } from '../../utils/theme.js';
import type { FileEditOutput } from './types.js';
import { findActualString, getPatchForEdit, preserveQuoteStyle } from './utils.js';
// `userFacingName` 决定了 TUI 里工具调用的动词：规划目录里的文件是 **`Updated plan`**、`old_string === ''` 是 **`Create`**、其余是 **`Update`**。注意它接收的是 `Partial<input> | undefined`——渲染历史消息时可能只有部分参数（流式还没到齐、或者旧版本记录里没这个字段），所以每个判断都得容错。
export function userFacingName(input: Partial<{
  file_path: string;
  old_string: string;
  new_string: string;
  replace_all: boolean;
  edits: unknown[];
}> | undefined): string {
  if (!input) {
    return 'Update';
  }
  if (input.file_path?.startsWith(getPlansDirectory())) {
    return 'Updated plan';
  }
  // Hashline edits always modify an existing file (line-ref based)
  if (input.edits != null) {
    return 'Update';
  }
// `old_string === ''` 判成 `Create` 是这套工具的一个约定：**空旧串 = 从零写**。虽然 `FileWriteTool` 才是「创建文件」的正牌工具，但 Edit 在文件不存在时也允许这么用（见 `validateInput`），所以 UI 上也得把它显示成「创建」而不是「更新一个不存在的文件」。
  if (input.old_string === '') {
    return 'Create';
  }
  return 'Update';
}
export function getToolUseSummary(input: Partial<{
  file_path: string;
  old_string: string;
  new_string: string;
  replace_all: boolean;
}> | undefined): string | null {
  if (!input?.file_path) {
    return null;
  }
  return getDisplayPath(input.file_path);
}
export function renderToolUseMessage({
  file_path
}: {
  file_path?: string;
}, {
  verbose
}: {
  verbose: boolean;
}): React.ReactNode {
  if (!file_path) {
    return null;
  }
  // For plan files, path is already in userFacingName
  if (file_path.startsWith(getPlansDirectory())) {
    return '';
  }
  return <FilePathLink filePath={file_path}>
      {verbose ? file_path : getDisplayPath(file_path)}
    </FilePathLink>;
}
export function renderToolResultMessage({
  filePath,
  structuredPatch,
  originalFile
}: FileEditOutput, _progressMessagesForMessage: ProgressMessage[], {
  style,
  verbose
}: {
  style?: 'condensed';
  verbose: boolean;
}): React.ReactNode {
  // For plan files, show /plan hint above the diff
  const isPlanFile = filePath.startsWith(getPlansDirectory());
  return <FileEditToolUpdatedMessage filePath={filePath} structuredPatch={structuredPatch} firstLine={originalFile.split('\n')[0] ?? null} fileContent={originalFile} style={style} verbose={verbose} previewHint={isPlanFile ? '/plan to preview' : undefined} />;
}
export function renderToolUseRejectedMessage(input: {
  file_path: string;
  old_string?: string;
  new_string?: string;
  replace_all?: boolean;
  edits?: unknown[];
}, options: {
  columns: number;
  messages: Message[];
  progressMessagesForMessage: ProgressMessage[];
  style?: 'condensed';
  theme: ThemeName;
  tools: Tools;
  verbose: boolean;
}): React.ReactElement {
  const {
    style,
    verbose
  } = options;
  const filePath = input.file_path;
  const oldString = input.old_string ?? '';
  const newString = input.new_string ?? '';
  const replaceAll = input.replace_all ?? false;

  // Defensive: if input has an unexpected shape, show a simple rejection message
  if ('edits' in input && input.edits != null) {
    return <FileEditToolUseRejectedMessage file_path={filePath} operation="update" firstLine={null} verbose={verbose} />;
  }
  const isNewFile = oldString === '';

  // For new file creation, show content preview instead of diff
  if (isNewFile) {
    return <FileEditToolUseRejectedMessage file_path={filePath} operation="write" content={newString} firstLine={firstLineOf(newString)} verbose={verbose} />;
  }
  return <EditRejectionDiff filePath={filePath} oldString={oldString} newString={newString} replaceAll={replaceAll} style={style} verbose={verbose} />;
}
export function renderToolUseErrorMessage(result: ToolResultBlockParam['content'], options: {
  progressMessagesForMessage: ProgressMessage[];
  tools: Tools;
  verbose: boolean;
}): React.ReactElement {
  const {
    verbose
  } = options;
  if (!verbose && typeof result === 'string' && extractTag(result, 'tool_use_error')) {
    const errorMessage = extractTag(result, 'tool_use_error');
    // Show a less scary message for intended behavior
// 错误渲染做了**降级**：非 verbose 且错误里含 `File has not been read yet` 时，不显示刺眼的红字，而是灰字 `File must be read first`。理由是这样错是**预期行为**（工具在按规则办事），不是故障——把它渲染成错误会让用户以为出问题了。同理 `FILE_NOT_FOUND_CWD_NOTE` 显示成简洁的 `File not found`。verbose 模式才回落到原始错误文本。
    if (errorMessage?.includes('File has not been read yet')) {
      return <MessageResponse>
          <Text dimColor>File must be read first</Text>
        </MessageResponse>;
    }
    if (errorMessage?.includes(FILE_NOT_FOUND_CWD_NOTE)) {
      return <MessageResponse>
          <Text color="error">File not found</Text>
        </MessageResponse>;
    }
    return <MessageResponse>
        <Text color="error">Error editing file</Text>
      </MessageResponse>;
  }
  return <FallbackToolUseErrorMessage result={result} verbose={verbose} />;
}
type RejectionDiffData = {
  patch: StructuredPatchHunk[];
  firstLine: string | null;
  fileContent: string | undefined;
};
function EditRejectionDiff(t0) {
  const $ = _c(16);
  const {
    filePath,
    oldString,
    newString,
    replaceAll,
    style,
    verbose
  } = t0;
  let t1;
  if ($[0] !== filePath || $[1] !== newString || $[2] !== oldString || $[3] !== replaceAll) {
    t1 = () => loadRejectionDiff(filePath, oldString, newString, replaceAll);
    $[0] = filePath;
    $[1] = newString;
    $[2] = oldString;
    $[3] = replaceAll;
    $[4] = t1;
  } else {
    t1 = $[4];
  }
  const [dataPromise] = useState(t1);
  let t2;
  if ($[5] !== filePath || $[6] !== verbose) {
    t2 = <FileEditToolUseRejectedMessage file_path={filePath} operation="update" firstLine={null} verbose={verbose} />;
    $[5] = filePath;
    $[6] = verbose;
    $[7] = t2;
  } else {
    t2 = $[7];
  }
  let t3;
  if ($[8] !== dataPromise || $[9] !== filePath || $[10] !== style || $[11] !== verbose) {
    t3 = <EditRejectionBody promise={dataPromise} filePath={filePath} style={style} verbose={verbose} />;
    $[8] = dataPromise;
    $[9] = filePath;
    $[10] = style;
    $[11] = verbose;
    $[12] = t3;
  } else {
    t3 = $[12];
  }
  let t4;
  if ($[13] !== t2 || $[14] !== t3) {
    t4 = <Suspense fallback={t2}>{t3}</Suspense>;
    $[13] = t2;
    $[14] = t3;
    $[15] = t4;
  } else {
    t4 = $[15];
  }
  return t4;
}
function EditRejectionBody(t0) {
  const $ = _c(7);
  const {
    promise,
    filePath,
    style,
    verbose
  } = t0;
  const {
    patch,
    firstLine,
    fileContent
  } = use(promise);
  let t1;
  if ($[0] !== fileContent || $[1] !== filePath || $[2] !== firstLine || $[3] !== patch || $[4] !== style || $[5] !== verbose) {
    t1 = <FileEditToolUseRejectedMessage file_path={filePath} operation="update" patch={patch} firstLine={firstLine} fileContent={fileContent} style={style} verbose={verbose} />;
    $[0] = fileContent;
    $[1] = filePath;
    $[2] = firstLine;
    $[3] = patch;
    $[4] = style;
    $[5] = verbose;
    $[6] = t1;
  } else {
    t1 = $[6];
  }
  return t1;
}
async function loadRejectionDiff(filePath: string, oldString: string, newString: string, replaceAll: boolean): Promise<RejectionDiffData> {
  try {
    // Chunked read — context window around the first occurrence. replaceAll
    // still shows matches *within* the window via getPatchForEdit; we accept
    // losing the all-occurrences view to keep the read bounded.
    const ctx = await readEditContext(filePath, oldString, CONTEXT_LINES);
// 拒绝编辑的 diff 是**分块读**出来的：`readEditContext(filePath, oldString, CONTEXT_LINES)` 只读第一次出现位置附近的窗口，而不是整文件。注释承认了代价——`replace_all` 时窗口外的匹配看不到，只显示窗口内的——但换来了「用户拒绝一个大文件编辑时不会卡住/爆内存」。这是一个明确的取舍，不是遗漏。
    if (ctx === null || ctx.truncated || ctx.content === '') {
      // ENOENT / not found / truncated — diff just the tool inputs.
      const {
        patch
      } = getPatchForEdit({
        filePath,
        fileContents: oldString,
        oldString,
        newString
      });
      return {
        patch,
        firstLine: null,
        fileContent: undefined
      };
    }
    const actualOld = findActualString(ctx.content, oldString) || oldString;
    const actualNew = preserveQuoteStyle(oldString, actualOld, newString);
    const {
      patch
    } = getPatchForEdit({
      filePath,
      fileContents: ctx.content,
      oldString: actualOld,
      newString: actualNew,
      replaceAll
    });
    return {
      patch: adjustHunkLineNumbers(patch, ctx.lineOffset - 1),
// `adjustHunkLineNumbers(patch, ctx.lineOffset - 1)`：patch 是在**窗口内容**上算出来的，行号从 1 开始，但窗口本身是从文件的第 `lineOffset` 行开始的。差值要减 1（窗口首行对应 patch 的第 1 行，偏移量已是 1-based）。不调整的话，diff 里显示的 `@@ -12 +12 @@` 会和真实文件行号对不上，用户滚动时找不到位置。
      firstLine: ctx.lineOffset === 1 ? firstLineOf(ctx.content) : null,
      fileContent: ctx.content
    };
  } catch (e) {
    // User may have manually applied the change while the diff was shown.
    logError(e as Error);
    return {
      patch: [],
      firstLine: null,
      fileContent: undefined
    };
  }
}
// 原文件此处有一行 25556 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。