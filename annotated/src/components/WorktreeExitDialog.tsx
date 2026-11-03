import React, { useEffect, useState } from 'react';
import type { CommandResultDisplay } from 'src/commands.js';
import { logEvent } from 'src/services/analytics/index.js';
import { logForDebugging } from 'src/utils/debug.js';
import { Box, Text } from '../ink.js';
import { execFileNoThrow } from '../utils/execFileNoThrow.js';
import { getPlansDirectory } from '../utils/plans.js';
import { setCwd } from '../utils/Shell.js';
import { cleanupWorktree, getCurrentWorktreeSession, keepWorktree, killTmuxSession } from '../utils/worktree.js';
import { Select } from './CustomSelect/select.js';
import { Dialog } from './design-system/Dialog.js';
import { Spinner } from './Spinner.js';

// Inline require breaks the cycle this file would otherwise close:
// sessionStorage → commands → exit → ExitFlow → here. All call sites
// are inside callbacks, so the lazy require never sees an undefined import.
// 内联 require 打破循环依赖：sessionStorage → commands → exit → ExitFlow → 此处。
// recordWorktreeExit：惰性 require 后调用 saveWorktreeState(null) 记录退出。
function recordWorktreeExit(): void {
  /* eslint-disable @typescript-eslint/no-require-imports */
  ;
  (require('../utils/sessionStorage.js') as typeof import('../utils/sessionStorage.js')).saveWorktreeState(null);
  /* eslint-enable @typescript-eslint/no-require-imports */
}
// Props 类型：退出完成回调、取消回调。
type Props = {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
  onCancel?: () => void;
};
// WorktreeExitDialog：处理 worktree 退出时「保留还是移除」的交互。
export function WorktreeExitDialog({
  onDone,
  onCancel
}: Props): React.ReactNode {
  const [status, setStatus] = useState<'loading' | 'asking' | 'keeping' | 'removing' | 'done'>('loading');
  const [changes, setChanges] = useState<string[]>([]);
  const [commitCount, setCommitCount] = useState<number>(0);
  const [resultMessage, setResultMessage] = useState<string | undefined>();
  const worktreeSession = getCurrentWorktreeSession();
// 首个副作用：加载未提交改动与待弹出提交数。
  useEffect(() => {
    async function loadChanges() {
      let changeLines: string[] = [];
      const gitStatus = await execFileNoThrow('git', ['status', '--porcelain']);
      if (gitStatus.stdout) {
        changeLines = gitStatus.stdout.split('\n').filter(_ => _.trim() !== '');
        setChanges(changeLines);
      }

      // Check for commits to eject
      if (worktreeSession) {
        // Get commits in worktree that are not in original branch
        const {
          stdout: commitsStr
        } = await execFileNoThrow('git', ['rev-list', '--count', `${worktreeSession.originalHeadCommit}..HEAD`]);
        const count = parseInt(commitsStr.trim()) || 0;
        setCommitCount(count);

        // If no changes and no commits, clean up silently
        if (changeLines.length === 0 && count === 0) {
// 无改动也无提交时静默清理，直接移除 worktree。
          setStatus('removing');
          void cleanupWorktree().then(() => {
            process.chdir(worktreeSession.originalCwd);
            setCwd(worktreeSession.originalCwd);
            recordWorktreeExit();
            getPlansDirectory.cache.clear?.();
            setResultMessage('Worktree removed (no changes)');
          }).catch(error => {
            logForDebugging(`Failed to clean up worktree: ${error}`, {
              level: 'error'
            });
            setResultMessage('Worktree cleanup failed, exiting anyway');
          }).then(() => {
            setStatus('done');
          });
          return;
        } else {
          setStatus('asking');
        }
      }
    }
    void loadChanges();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // biome-ignore lint/correctness/useExhaustiveDependencies: intentional
  }, [worktreeSession]);
// 第二个副作用：状态变为 done 时回调 onDone 通知上层。
  useEffect(() => {
    if (status === 'done') {
      onDone(resultMessage);
    }
  }, [status, onDone, resultMessage]);
// 无有效 worktree 会话时直接回调失败。
  if (!worktreeSession) {
    onDone('No active worktree session found', {
      display: 'system'
    });
    return null;
  }
  if (status === 'loading' || status === 'done') {
    return null;
  }
// handleSelect：按用户选择执行「保留 / 移除」并切换状态。
  async function handleSelect(value: string) {
    if (!worktreeSession) return;
    const hasTmux = Boolean(worktreeSession.tmuxSessionName);
    if (value === 'keep' || value === 'keep-with-tmux') {
      setStatus('keeping');
      logEvent('tengu_worktree_kept', {
        commits: commitCount,
        changed_files: changes.length
      });
      await keepWorktree();
      process.chdir(worktreeSession.originalCwd);
      setCwd(worktreeSession.originalCwd);
      recordWorktreeExit();
      getPlansDirectory.cache.clear?.();
      if (hasTmux) {
// 保留且含 tmux 会话时，提示用户可重新 attach。
        setResultMessage(`Worktree kept. Your work is saved at ${worktreeSession.worktreePath} on branch ${worktreeSession.worktreeBranch}. Reattach to tmux session with: tmux attach -t ${worktreeSession.tmuxSessionName}`);
      } else {
        setResultMessage(`Worktree kept. Your work is saved at ${worktreeSession.worktreePath} on branch ${worktreeSession.worktreeBranch}`);
      }
      setStatus('done');
    } else if (value === 'keep-kill-tmux') {
      setStatus('keeping');
      logEvent('tengu_worktree_kept', {
        commits: commitCount,
        changed_files: changes.length
      });
      if (worktreeSession.tmuxSessionName) {
        await killTmuxSession(worktreeSession.tmuxSessionName);
      }
      await keepWorktree();
      process.chdir(worktreeSession.originalCwd);
      setCwd(worktreeSession.originalCwd);
      recordWorktreeExit();
      getPlansDirectory.cache.clear?.();
      setResultMessage(`Worktree kept at ${worktreeSession.worktreePath} on branch ${worktreeSession.worktreeBranch}. Tmux session terminated.`);
      setStatus('done');
    } else if (value === 'remove' || value === 'remove-with-tmux') {
      setStatus('removing');
      logEvent('tengu_worktree_removed', {
        commits: commitCount,
        changed_files: changes.length
      });
      if (worktreeSession.tmuxSessionName) {
        await killTmuxSession(worktreeSession.tmuxSessionName);
      }
      try {
        await cleanupWorktree();
        process.chdir(worktreeSession.originalCwd);
        setCwd(worktreeSession.originalCwd);
        recordWorktreeExit();
        getPlansDirectory.cache.clear?.();
      } catch (error) {
        logForDebugging(`Failed to clean up worktree: ${error}`, {
          level: 'error'
        });
        setResultMessage('Worktree cleanup failed, exiting anyway');
        setStatus('done');
        return;
      }
      const tmuxNote = hasTmux ? ' Tmux session terminated.' : '';
      if (commitCount > 0 && changes.length > 0) {
        setResultMessage(`Worktree removed. ${commitCount} ${commitCount === 1 ? 'commit' : 'commits'} and uncommitted changes were discarded.${tmuxNote}`);
      } else if (commitCount > 0) {
        setResultMessage(`Worktree removed. ${commitCount} ${commitCount === 1 ? 'commit' : 'commits'} on ${worktreeSession.worktreeBranch} ${commitCount === 1 ? 'was' : 'were'} discarded.${tmuxNote}`);
      } else if (changes.length > 0) {
        setResultMessage(`Worktree removed. Uncommitted changes were discarded.${tmuxNote}`);
      } else {
        setResultMessage(`Worktree removed.${tmuxNote}`);
      }
      setStatus('done');
    }
  }
  if (status === 'keeping') {
    return <Box flexDirection="row" marginY={1}>
        <Spinner />
        <Text>Keeping worktree…</Text>
      </Box>;
  }
  if (status === 'removing') {
    return <Box flexDirection="row" marginY={1}>
        <Spinner />
        <Text>Removing worktree…</Text>
      </Box>;
  }
// 根据是否未提交 / 有提交拼出不同的副标题文案。
  const branchName = worktreeSession.worktreeBranch;
  const hasUncommitted = changes.length > 0;
  const hasCommits = commitCount > 0;
  let subtitle = '';
  if (hasUncommitted && hasCommits) {
    subtitle = `You have ${changes.length} uncommitted ${changes.length === 1 ? 'file' : 'files'} and ${commitCount} ${commitCount === 1 ? 'commit' : 'commits'} on ${branchName}. All will be lost if you remove.`;
  } else if (hasUncommitted) {
    subtitle = `You have ${changes.length} uncommitted ${changes.length === 1 ? 'file' : 'files'}. These will be lost if you remove the worktree.`;
  } else if (hasCommits) {
    subtitle = `You have ${commitCount} ${commitCount === 1 ? 'commit' : 'commits'} on ${branchName}. The branch will be deleted if you remove the worktree.`;
  } else {
    subtitle = 'You are working in a worktree. Keep it to continue working there, or remove it to clean up.';
  }
  function handleCancel() {
    if (onCancel) {
      // Abort exit and return to the session
      onCancel();
      return;
    }
    // Fallback: treat Escape as "keep" if no onCancel provided
    void handleSelect('keep');
  }
  const removeDescription = hasUncommitted || hasCommits ? 'All changes and commits will be lost.' : 'Clean up the worktree directory.';
  const hasTmuxSession = Boolean(worktreeSession.tmuxSessionName);
  const options = hasTmuxSession ? [{
    label: 'Keep worktree and tmux session',
    value: 'keep-with-tmux',
    description: `Stays at ${worktreeSession.worktreePath}. Reattach with: tmux attach -t ${worktreeSession.tmuxSessionName}`
  }, {
    label: 'Keep worktree, kill tmux session',
    value: 'keep-kill-tmux',
    description: `Keeps worktree at ${worktreeSession.worktreePath}, terminates tmux session.`
  }, {
    label: 'Remove worktree and tmux session',
    value: 'remove-with-tmux',
    description: removeDescription
  }] : [{
    label: 'Keep worktree',
    value: 'keep',
    description: `Stays at ${worktreeSession.worktreePath}`
  }, {
    label: 'Remove worktree',
    value: 'remove',
    description: removeDescription
  }];
  const defaultValue = hasTmuxSession ? 'keep-with-tmux' : 'keep';
// 渲染：用 Dialog 包住选项列表；Escape 退回会话、选择项触发处理。
  return <Dialog title="Exiting worktree session" subtitle={subtitle} onCancel={handleCancel}>
      <Select defaultFocusValue={defaultValue} options={options} onChange={handleSelect} />
    </Dialog>;
}
// 原文件此处有一行 25808 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。