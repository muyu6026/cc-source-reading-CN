import figures from 'figures';
import React, { useEffect, useState } from 'react';
import { Box, Text } from '../ink.js';
import { logForDebugging } from '../utils/debug.js';
import type { GitFileStatus } from '../utils/git.js';
import { getFileStatus, stashToCleanState } from '../utils/git.js';
import { Select } from './CustomSelect/index.js';
import { Dialog } from './design-system/Dialog.js';
import { Spinner } from './Spinner.js';
// Props：teleport 要切 git 分支，工作区脏时先问用户是否 stash。两个回调分别对应「stash 完继续」与「取消退出」。
type TeleportStashProps = {
  onStashAndContinue: () => void;
  onCancel: () => void;
};
// TeleportStash：手写组件（无编译器缓存），三态状态机——loading 加载中、正常展示选择、stashing 执行中；外加 error 提前短路。
export function TeleportStash({
  onStashAndContinue,
  onCancel
}: TeleportStashProps): React.ReactNode {
  const [gitFileStatus, setGitFileStatus] = useState<GitFileStatus | null>(null);
// changedFiles 合并 tracked 与 untracked 两个列表；gitFileStatus 为 null（未加载）时给空数组，保证后续渲染分支无需判空。
  const changedFiles = gitFileStatus !== null ? [...gitFileStatus.tracked, ...gitFileStatus.untracked] : [];
  const [loading, setLoading] = useState(true);
  const [stashing, setStashing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load changed files on mount
// 挂载加载 git 状态：异步拿文件清单；失败时记调试日志并向用户展示通用错误文案（原始错误信息只进日志不进界面）；finally 复位 loading。
  useEffect(() => {
    const loadChangedFiles = async () => {
      try {
        const fileStatus = await getFileStatus();
        setGitFileStatus(fileStatus);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logForDebugging(`Error getting changed files: ${errorMessage}`, {
          level: 'error'
        });
        setError('Failed to get changed files');
      } finally {
        setLoading(false);
      }
    };
    void loadChangedFiles();
  }, []);
// handleStash：调 stashToCleanState 执行实际 stash，消息固定为 Teleport auto-stash 便于用户事后在 stash 列表里识别来源。成功才推进，失败展示错误并停在弹窗。
  const handleStash = async () => {
    setStashing(true);
    try {
      logForDebugging('Stashing changes before teleport...');
      const success = await stashToCleanState('Teleport auto-stash');
      if (success) {
        logForDebugging('Successfully stashed changes');
        onStashAndContinue();
      } else {
        setError('Failed to stash changes');
      }
    } catch (err_0) {
      const errorMessage_0 = err_0 instanceof Error ? err_0.message : String(err_0);
      logForDebugging(`Error stashing changes: ${errorMessage_0}`, {
        level: 'error'
      });
      setError('Failed to stash changes');
// finally 复位 stashing：无论成败按钮都要恢复可点——失败后用户可以重试或退出。
    } finally {
      setStashing(false);
    }
  };
// 选择分流：只有 value 为 stash 才走异步 stash，其余一律 onCancel——Select 的任何非预期值都安全地落到取消。
  const handleSelectChange = (value: string) => {
    if (value === 'stash') {
      void handleStash();
    } else {
      onCancel();
    }
  };
// loading 分支：spinner 加「检查 git 状态」文案。此分支不渲染 Dialog——弹窗框架在数据没就绪时不出现，避免空弹窗闪一下。
  if (loading) {
    return <Box flexDirection="column" padding={1}>
        <Box marginBottom={1}>
          <Spinner />
          <Text> Checking git status{figures.ellipsis}</Text>
        </Box>
      </Box>;
  }
  if (error) {
    return <Box flexDirection="column" padding={1}>
        <Text bold color="error">
          Error: {error}
        </Text>
        <Box marginTop={1}>
          <Text dimColor>Press </Text>
          <Text bold>Escape</Text>
          <Text dimColor> to cancel</Text>
        </Box>
      </Box>;
  }
// 文件多于 8 个只显示数量：列表太长会撑爆弹窗甚至溢出终端，超过阈值降级为计数摘要。8 是弹窗高度预算算出来的临界值。
  const showFileCount = changedFiles.length > 8;
  return <Dialog title="Working Directory Has Changes" onCancel={onCancel}>
      <Text>
        Teleport will switch git branches. The following changes were found:
      </Text>

      <Box flexDirection="column" paddingLeft={2}>
// 展示三分支嵌套三元：无改动显示暗色提示；有改动且超 8 个显示数量；否则逐行列出文件名（key 用下标，列表只增不减不重排）。
        {changedFiles.length > 0 ? showFileCount ? <Text>{changedFiles.length} files changed</Text> : changedFiles.map((file: string, index: number) => <Text key={index}>{file}</Text>) : <Text dimColor>No changes detected</Text>}
      </Box>

      <Text>
        Would you like to stash these changes and continue with teleport?
      </Text>

// stashing 时选项区整体替换成 spinner：执行期间不可再选，用替换而非禁用表达——终端里禁用态的视觉语义很弱。
      {stashing ? <Box>
          <Spinner />
          <Text> Stashing changes...</Text>
        </Box> : <Select options={[{
      label: 'Stash changes and continue',
      value: 'stash'
    }, {
      label: 'Exit',
      value: 'exit'
    }]} onChange={handleSelectChange} />}
    </Dialog>;
}
// 原文件此处有一行 11748 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。