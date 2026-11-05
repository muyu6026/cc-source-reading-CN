// /resume 命令：列出并恢复历史会话。支持按 UUID、自定义标题、跨项目 worktree 自动检测，对跨目录的会话给出可复制的切换命令而非直接恢复。
import { c as _c } from "react/compiler-runtime";
import chalk from 'chalk';
import type { UUID } from 'crypto';
import figures from 'figures';
import * as React from 'react';
import { getOriginalCwd, getSessionId } from '../../bootstrap/state.js';
import type { CommandResultDisplay, ResumeEntrypoint } from '../../commands.js';
import { LogSelector } from '../../components/LogSelector.js';
import { MessageResponse } from '../../components/MessageResponse.js';
import { Spinner } from '../../components/Spinner.js';
import { useIsInsideModal } from '../../context/modalContext.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { setClipboard } from '../../ink/termio/osc.js';
import { Box, Text } from '../../ink.js';
import type { LocalJSXCommandCall } from '../../types/command.js';
import type { LogOption } from '../../types/logs.js';
import { agenticSessionSearch } from '../../utils/agenticSessionSearch.js';
import { checkCrossProjectResume } from '../../utils/crossProjectResume.js';
import { getWorktreePaths } from '../../utils/getWorktreePaths.js';
import { logError } from '../../utils/log.js';
import { getLastSessionLog, getSessionIdFromLog, isCustomTitleEnabled, isLiteLog, loadAllProjectsMessageLogs, loadFullLog, loadSameRepoMessageLogs, searchSessionsByCustomTitle } from '../../utils/sessionStorage.js';
import { validateUuid } from '../../utils/uuid.js';
type ResumeResult = {
  resultType: 'sessionNotFound';
  arg: string;
} | {
  resultType: 'multipleMatches';
  arg: string;
  count: number;
};
// ResumeResult：未找到会话或多匹配两种错误结果，供 help 文案复用。
function resumeHelpMessage(result: ResumeResult): string {
  switch (result.resultType) {
    case 'sessionNotFound':
      return `Session ${chalk.bold(result.arg)} was not found.`;
    case 'multipleMatches':
      return `Found ${result.count} sessions matching ${chalk.bold(result.arg)}. Please use /resume to pick a specific session.`;
  }
}
// resumeHelpMessage：把错误结果渲染成面向用户的提示串。
function ResumeError(t0) {
  const $ = _c(10);
  const {
    message,
    args,
    onDone
  } = t0;
  let t1;
  let t2;
  if ($[0] !== onDone) {
    t1 = () => {
      const timer = setTimeout(onDone, 0);
      return () => clearTimeout(timer);
    };
    t2 = [onDone];
    $[0] = onDone;
    $[1] = t1;
    $[2] = t2;
  } else {
    t1 = $[1];
    t2 = $[2];
  }
  React.useEffect(t1, t2);
  let t3;
  if ($[3] !== args) {
    t3 = <Text dimColor={true}>{figures.pointer} /resume {args}</Text>;
    $[3] = args;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  let t4;
  if ($[5] !== message) {
    t4 = <MessageResponse><Text>{message}</Text></MessageResponse>;
    $[5] = message;
    $[6] = t4;
  } else {
    t4 = $[6];
  }
  let t5;
  if ($[7] !== t3 || $[8] !== t4) {
    t5 = <Box flexDirection="column">{t3}{t4}</Box>;
    $[7] = t3;
    $[8] = t4;
    $[9] = t5;
  } else {
    t5 = $[9];
  }
  return t5;
}
// ResumeError：错误态展示组件（编译器产物，用 $ 缓存槽复用计算结果）。
function ResumeCommand({
  onDone,
  onResume
}: {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
  onResume: (sessionId: UUID, log: LogOption, entrypoint: ResumeEntrypoint) => Promise<void>;
}): React.ReactNode {
  const [logs, setLogs] = React.useState<LogOption[]>([]);
// ResumeCommand 各状态：日志列表、worktree 路径、加载中、恢复中、是否展示全部项目，以及终端尺寸与模态上下文。
  const [worktreePaths, setWorktreePaths] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [resuming, setResuming] = React.useState(false);
  const [showAllProjects, setShowAllProjects] = React.useState(false);
  const {
    rows
  } = useTerminalSize();
  const insideModal = useIsInsideModal();
  const loadLogs = React.useCallback(async (allProjects: boolean, paths: string[]) => {
    setLoading(true);
    try {
      const allLogs = allProjects ? await loadAllProjectsMessageLogs() : await loadSameRepoMessageLogs(paths);
      const resumable = filterResumableSessions(allLogs, getSessionId());
      if (resumable.length === 0) {
        onDone('No conversations found to resume');
        return;
      }
      setLogs(resumable);
    } catch (_err) {
      onDone('Failed to load conversations');
    } finally {
      setLoading(false);
    }
  }, [onDone]);
// loadLogs：按是否全部项目加载消息日志，过滤出可恢复的会话；空结果直接 onDone 结束。
  React.useEffect(() => {
    async function init() {
      const paths_0 = await getWorktreePaths(getOriginalCwd());
      setWorktreePaths(paths_0);
      void loadLogs(false, paths_0);
    }
    void init();
  }, [loadLogs]);
// 初始化：拉取 worktree 路径后加载本仓同仓会话日志。
  const handleToggleAllProjects = React.useCallback(() => {
    const newValue = !showAllProjects;
    setShowAllProjects(newValue);
    void loadLogs(newValue, worktreePaths);
  }, [showAllProjects, loadLogs, worktreePaths]);
// handleToggleAllProjects：切换全部项目开关后重新加载日志。
  async function handleSelect(log: LogOption) {
    const sessionId = validateUuid(getSessionIdFromLog(log));
    if (!sessionId) {
      onDone('Failed to resume conversation');
      return;
    }

    // Load full messages for lite logs
    const fullLog = isLiteLog(log) ? await loadFullLog(log) : log;

    // Check if this conversation is from a different directory
    const crossProjectCheck = checkCrossProjectResume(fullLog, showAllProjects, worktreePaths);
    if (crossProjectCheck.isCrossProject) {
      if (crossProjectCheck.isSameRepoWorktree) {
        // Same repo worktree - can resume directly
        setResuming(true);
        void onResume(sessionId, fullLog, 'slash_command_picker');
        return;
      }

      // Different project - show command instead of resuming
      const raw = await setClipboard(crossProjectCheck.command);
      if (raw) process.stdout.write(raw);

      // Format the output message
      const message = ['', 'This conversation is from a different directory.', '', 'To resume, run:', `  ${crossProjectCheck.command}`, '', '(Command copied to clipboard)', ''].join('\n');
      onDone(message, {
        display: 'user'
      });
      return;
    }

    // Same directory - proceed with resume
    setResuming(true);
    void onResume(sessionId, fullLog, 'slash_command_picker');
  }
// handleSelect：选定会话后做跨项目/跨目录判定——同仓 worktree 直接恢复，不同项目给出可复制命令，同目录则继续恢复。lite 日志需先补齐完整消息。
  function handleCancel() {
    onDone('Resume cancelled', {
      display: 'system'
    });
  }
// handleCancel：取消恢复，以 system 显示呈现。
  if (loading) {
    return <Box>
        <Spinner />
        <Text> Loading conversations…</Text>
      </Box>;
  }
  if (resuming) {
    return <Box>
        <Spinner />
        <Text> Resuming conversation…</Text>
      </Box>;
  }
  return <LogSelector logs={logs} maxHeight={insideModal ? Math.floor(rows / 2) : rows - 2} onCancel={handleCancel} onSelect={handleSelect} onLogsChanged={() => loadLogs(showAllProjects, worktreePaths)} showAllProjects={showAllProjects} onToggleAllProjects={handleToggleAllProjects} onAgenticSearch={agenticSessionSearch} />;
// 主渲染：加载/恢复中显示 Spinner，否则渲染 LogSelector（高度按是否模态减半），并挂载智能检索回调。
}
export function filterResumableSessions(logs: LogOption[], currentSessionId: string): LogOption[] {
  return logs.filter(l => !l.isSidechain && getSessionIdFromLog(l) !== currentSessionId);
}
// filterResumableSessions：过滤可恢复会话——排除侧链且排除当前会话自身。
export const call: LocalJSXCommandCall = async (onDone, context, args) => {
  const onResume = async (sessionId: UUID, log: LogOption, entrypoint: ResumeEntrypoint) => {
    try {
      await context.resume?.(sessionId, log, entrypoint);
      onDone(undefined, {
        display: 'skip'
      });
    } catch (error) {
      logError(error as Error);
      onDone(`Failed to resume: ${(error as Error).message}`);
    }
  };
  const arg = args?.trim();

  // No argument provided - show picker
  if (!arg) {
    return <ResumeCommand key={Date.now()} onDone={onDone} onResume={onResume} />;
// 无参数时直接渲染选择器组件。
  }

  // Load logs to search (includes same-repo worktrees)
  const worktreePaths = await getWorktreePaths(getOriginalCwd());
  const logs = await loadSameRepoMessageLogs(worktreePaths);
// 载入本仓同仓会话日志用于检索（含 worktree）。
  if (logs.length === 0) {
    const message = 'No conversations found to resume.';
    return <ResumeError message={message} args={arg} onDone={() => onDone(message)} />;
  }

  // First, check if arg is a valid UUID
  const maybeSessionId = validateUuid(arg);
  if (maybeSessionId) {
    const matchingLogs = logs.filter(l => getSessionIdFromLog(l) === maybeSessionId).sort((a, b) => b.modified.getTime() - a.modified.getTime());
// 先尝试按 UUID 过滤并按时修改时间倒序；命中即用该日志恢复。
    if (matchingLogs.length > 0) {
      const log = matchingLogs[0]!;
      const fullLog = isLiteLog(log) ? await loadFullLog(log) : log;
      void onResume(maybeSessionId, fullLog, 'slash_command_session_id');
      return null;
    }

    // Enriched logs didn't find it — try direct file lookup. This handles
    // sessions filtered out by enrichLogs (e.g., first message >16KB makes
    // firstPrompt extraction fail, causing the session to be dropped).
    const directLog = await getLastSessionLog(maybeSessionId);
    if (directLog) {
      void onResume(maybeSessionId, directLog, 'slash_command_session_id');
      return null;
    }
  }
// enriched 没命中时再走直接文件查找（处理被 enrichLogs 过滤掉的会话，比如首条消息过大导致抽取失败）。

  // Next, try exact custom title match (only if feature is enabled)
  if (isCustomTitleEnabled()) {
// 再按自定义标题精确匹配（仅当功能开启）；恰好一命中即恢复。
    const titleMatches = await searchSessionsByCustomTitle(arg, {
      exact: true
    });
    if (titleMatches.length === 1) {
      const log = titleMatches[0]!;
      const sessionId = getSessionIdFromLog(log);
      if (sessionId) {
        const fullLog = isLiteLog(log) ? await loadFullLog(log) : log;
        void onResume(sessionId, fullLog, 'slash_command_title');
        return null;
      }
    }
// 多匹配给出错误提示，单匹配失败则继续。

    // Multiple matches - show error
    if (titleMatches.length > 1) {
      const message = resumeHelpMessage({
        resultType: 'multipleMatches',
        arg,
        count: titleMatches.length
      });
      return <ResumeError message={message} args={arg} onDone={() => onDone(message)} />;
    }
  }

  // No match found - show error
  const message = resumeHelpMessage({
    resultType: 'sessionNotFound',
    arg
  });
  return <ResumeError message={message} args={arg} onDone={() => onDone(message)} />;
// 无匹配最终给出 not found 错误组件。
};
// call 命令入口收尾：封装 onResume 处理 context.resume 调用与失败回退。
// 原文件此处有一行 27428 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。