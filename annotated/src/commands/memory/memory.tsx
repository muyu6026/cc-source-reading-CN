import { mkdir, writeFile } from 'fs/promises';
// 依赖：fs/promises 的 mkdir/writeFile、React、命令结果类型、设计系统对话框、记忆文件选择器、ink 组件、记忆与编辑器工具。
import * as React from 'react';
import type { CommandResultDisplay } from '../../commands.js';
import { Dialog } from '../../components/design-system/Dialog.js';
import { MemoryFileSelector } from '../../components/memory/MemoryFileSelector.js';
import { getRelativeMemoryPath } from '../../components/memory/MemoryUpdateNotification.js';
import { Box, Link, Text } from '../../ink.js';
import type { LocalJSXCommandCall } from '../../types/command.js';
import { clearMemoryFileCaches, getMemoryFiles } from '../../utils/claudemd.js';
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js';
import { getErrnoCode } from '../../utils/errors.js';
import { logError } from '../../utils/log.js';
import { editFileInEditor } from '../../utils/promptEditor.js';
// 最后一条 import；下面 MemoryCommand 组件负责打开或新建记忆文件并拉起编辑器。
function MemoryCommand({
  onDone
}: {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
}): React.ReactNode {
// handleSelectMemoryFile：核心回调，建目录、建文件、拉编辑器、探测编辑器变量。
  const handleSelectMemoryFile = async (memoryPath: string) => {
    try {
      // Create claude directory if it doesn't exist (idempotent with recursive)
      if (memoryPath.includes(getClaudeConfigHomeDir())) {
        await mkdir(getClaudeConfigHomeDir(), {
          recursive: true
        });
      }
// 新建文件：wx 标志只在不存在时写空串，EEXIST 说明已存在就跳过保留内容。

      // Create file if it doesn't exist (wx flag fails if file exists,
      // which we catch to preserve existing content)
      try {
        await writeFile(memoryPath, '', {
          encoding: 'utf8',
          flag: 'wx'
        });
      } catch (e: unknown) {
        if (getErrnoCode(e) !== 'EEXIST') {
          throw e;
        }
      }
      await editFileInEditor(memoryPath);

      // Determine which environment variable controls the editor
      let editorSource = 'default';
      let editorValue = '';
// 结果回显：打开成功就告诉用户文件位置与用的编辑器，失败就 logError 并回显错误。
      if (process.env.VISUAL) {
        editorSource = '$VISUAL';
        editorValue = process.env.VISUAL;
      } else if (process.env.EDITOR) {
// 回调收尾：catch 兜底所有异常，保证命令不会无声崩溃。
        editorSource = '$EDITOR';
        editorValue = process.env.EDITOR;
// 取消回调：用户取消就回显「已取消记忆编辑」。
      }
      const editorInfo = editorSource !== 'default' ? `Using ${editorSource}="${editorValue}".` : '';
      const editorHint = editorInfo ? `> ${editorInfo} To change editor, set $EDITOR or $VISUAL environment variable.` : `> To use a different editor, set the $EDITOR or $VISUAL environment variable.`;
      onDone(`Opened memory file at ${getRelativeMemoryPath(memoryPath)}\n\n${editorHint}`, {
        display: 'system'
      });
    } catch (error) {
      logError(error);
      onDone(`Error opening memory file: ${error}`);
    }
  };
  const handleCancel = () => {
    onDone('Cancelled memory editing', {
      display: 'system'
    });
  };
// 组件返回：把文件选择器包在 Dialog 里，底部附上记忆文档链接。
  return <Dialog title="Memory" onCancel={handleCancel} color="remember">
      <Box flexDirection="column">
        <React.Suspense fallback={null}>
          <MemoryFileSelector onSelect={handleSelectMemoryFile} onCancel={handleCancel} />
        </React.Suspense>

// call 入口：先清缓存再预取记忆文件，避免首开时 Suspense 闪一下 fallback。
        <Box marginTop={1}>
          <Text dimColor>
            Learn more: <Link url="https://code.claude.com/docs/en/memory" />
          </Text>
        </Box>
      </Box>
    </Dialog>;
}
export const call: LocalJSXCommandCall = async onDone => {
  // Clear + prime before rendering — Suspense handles the unprimed case,
  // but awaiting here avoids a fallback flash on initial open.
  clearMemoryFileCaches();
  await getMemoryFiles();
  return <MemoryCommand onDone={onDone} />;
};
// 原文件此处有一行 9164 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。