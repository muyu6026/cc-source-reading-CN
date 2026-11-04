// 手写组件（非 React Compiler 产物），实现「导出对话」弹窗：可复制到剪贴板或存成文件。
import { join } from 'path';
import React, { useCallback, useState } from 'react';
import type { ExitState } from '../hooks/useExitOnCtrlCDWithKeybindings.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { setClipboard } from '../ink/termio/osc.js';
import { Box, Text } from '../ink.js';
import { useKeybinding } from '../keybindings/useKeybinding.js';
// `getCwd` 取当前工作目录，导出的文件就写在这里；`writeFileSync_DEPRECATED` 写文件。
import { getCwd } from '../utils/cwd.js';
import { writeFileSync_DEPRECATED } from '../utils/slowOperations.js';
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js';
import { Select } from './CustomSelect/select.js';
import { Byline } from './design-system/Byline.js';
import { Dialog } from './design-system/Dialog.js';
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js';
import TextInput from './TextInput.js';
// ExportDialogProps：要导出的 `content`、默认文件名、完成回调（返回成功与否与消息）。
type ExportDialogProps = {
  content: string;
  defaultFilename: string;
  onDone: (result: {
    success: boolean;
    message: string;
  }) => void;
};
// `ExportOption` 只有 `clipboard`（剪贴板）与 `file`（文件）两种。
type ExportOption = 'clipboard' | 'file';
// ExportDialog 是「导出对话」弹窗，分「选方式」与「填文件名」两个子屏。
export function ExportDialog({
  content,
  defaultFilename,
  onDone
}: ExportDialogProps): React.ReactNode {
// 四个 `useState`：选中方式、文件名、光标偏移、是否显示文件名输入子屏。
  const [, setSelectedOption] = useState<ExportOption | null>(null);
  const [filename, setFilename] = useState<string>(defaultFilename);
  const [cursorOffset, setCursorOffset] = useState<number>(defaultFilename.length);
  const [showFilenameInput, setShowFilenameInput] = useState(false);
  const {
    columns
  } = useTerminalSize();

  // Handle going back from filename input to option selection
// `handleGoBack`：从文件名子屏退回选方式子屏（清空选中方式）。
  const handleGoBack = useCallback(() => {
    setShowFilenameInput(false);
    setSelectedOption(null);
  }, []);
// `handleSelectOption`：选 clipboard 就立刻写入系统剪贴板并回调成功；选 file 则进入文件名输入子屏。
  const handleSelectOption = async (value: string): Promise<void> => {
    if (value === 'clipboard') {
      // Copy to clipboard immediately
      const raw = await setClipboard(content);
      if (raw) process.stdout.write(raw);
      onDone({
        success: true,
        message: 'Conversation copied to clipboard'
      });
    } else if (value === 'file') {
      setSelectedOption('file');
      setShowFilenameInput(true);
    }
  };
// `handleFilenameSubmit`：确保文件名以 `.txt` 结尾（否则替换扩展名后补上），拼成完整路径后写文件，成功/失败都回调 `onDone`。
  const handleFilenameSubmit = () => {
    const finalFilename = filename.endsWith('.txt') ? filename : filename.replace(/\.[^.]+$/, '') + '.txt';
    const filepath = join(getCwd(), finalFilename);
    try {
      writeFileSync_DEPRECATED(filepath, content, {
        encoding: 'utf-8',
        flush: true
      });
      onDone({
        success: true,
        message: `Conversation exported to: ${filepath}`
      });
    } catch (error) {
      onDone({
        success: false,
        message: `Failed to export conversation: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }
  };

// `handleCancel`：若在文件名子屏按 Esc，退回选方式；否则直接以「已取消」回调结束。
  // Dialog calls onCancel when Escape is pressed. If we are in the filename
  // input sub-screen, go back to the option list instead of closing entirely.
  const handleCancel = useCallback(() => {
    if (showFilenameInput) {
      handleGoBack();
    } else {
      onDone({
        success: false,
        message: 'Export cancelled'
      });
    }
  }, [showFilenameInput, handleGoBack, onDone]);
// options 定义两个选项：复制到剪贴板、保存到当前目录文件。
  const options = [{
    label: 'Copy to clipboard',
    value: 'clipboard',
    description: 'Copy the conversation to your system clipboard'
  }, {
    label: 'Save to file',
    value: 'file',
    description: 'Save the conversation to a file in the current directory'
  }];

// `renderInputGuide` 按当前子屏切换底部快捷键提示：文件名子屏显示 Enter 保存 / Esc 返回。
  // Custom input guide that changes based on dialog state
  function renderInputGuide(exitState: ExitState): React.ReactNode {
    if (showFilenameInput) {
      return <Byline>
          <KeyboardShortcutHint shortcut="Enter" action="save" />
          <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="go back" />
        </Byline>;
    }
    if (exitState.pending) {
      return <Text>Press {exitState.keyName} again to exit</Text>;
    }
    return <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" />;
  }

// 把 `confirm:no` 绑定到 `handleCancel`，但仅当处于文件名子屏时才激活（避免把文件名里的 n 当成取消）。
  // Use Settings context so 'n' key doesn't cancel (allows typing 'n' in filename input)
  useKeybinding('confirm:no', handleCancel, {
    context: 'Settings',
    isActive: showFilenameInput
  });
// 渲染：外层 `Dialog` 标题为「Export Conversation」；未进文件名子屏时显示选项列表，否则显示文件名输入框。
  return <Dialog title="Export Conversation" subtitle="Select export method:" color="permission" onCancel={handleCancel} inputGuide={renderInputGuide} isCancelActive={!showFilenameInput}>
      {!showFilenameInput ? <Select options={options} onChange={handleSelectOption} onCancel={handleCancel} /> : <Box flexDirection="column">
          <Text>Enter filename:</Text>
          <Box flexDirection="row" gap={1} marginTop={1}>
            <Text>&gt;</Text>
            <TextInput value={filename} onChange={setFilename} onSubmit={handleFilenameSubmit} focus={true} showCursor={true} columns={columns} cursorOffset={cursorOffset} onChangeCursorOffset={setCursorOffset} />
          </Box>
        </Box>}
    </Dialog>;
}
// 原文件此处有一行 14388 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。