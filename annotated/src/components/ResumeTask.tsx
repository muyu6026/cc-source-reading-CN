// ResumeTask：恢复会话的终端界面组件。从 Sessions API 拉取可恢复的 Claude Code 会话列表，按当前仓库过滤并排序，用户选中后回调 onSelect。
import React, { useCallback, useState } from 'react';
import { useTerminalSize } from 'src/hooks/useTerminalSize.js';
import { type CodeSession, fetchCodeSessionsFromSessionsAPI } from 'src/utils/teleport/api.js';
// eslint 禁用注释：这里故意用原生 j/k/方向键做列表导航，绕开统一的 useKeybindings 规则。
// eslint-disable-next-line custom-rules/prefer-use-keybindings -- raw j/k/arrow list navigation
import { Box, Text, useInput } from '../ink.js';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import { useShortcutDisplay } from '../keybindings/useShortcutDisplay.js';
import { logForDebugging } from '../utils/debug.js';
import { detectCurrentRepository } from '../utils/detectRepository.js';
import { formatRelativeTime } from '../utils/format.js';
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js';
import { Select } from './CustomSelect/index.js';
import { Byline } from './design-system/Byline.js';
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js';
import { Spinner } from './Spinner.js';
import { TeleportError } from './TeleportError.js';
// Props：onSelect（选中会话回调）、onCancel（取消回调）、isEmbedded（是否内嵌而非全屏）。
type Props = {
  onSelect: (session: CodeSession) => void;
  onCancel: () => void;
  isEmbedded?: boolean;
};
// 错误类型与常量化字符串：网络、鉴权、API、其他四类错误；列间用两个空格分隔。
type LoadErrorType = 'network' | 'auth' | 'api' | 'other';
const UPDATED_STRING = 'Updated';
const SPACE_BETWEEN_TABLE_COLUMNS = '  ';
// 组件主体：声明大量状态——会话列表、当前仓库、加载中、错误类型、重试中、是否完成遥测错误流、聚焦索引。
export function ResumeTask({
  onSelect,
  onCancel,
  isEmbedded = false
}: Props): React.ReactNode {
  const {
    rows
  } = useTerminalSize();
  const [sessions, setSessions] = useState<CodeSession[]>([]);
  const [currentRepo, setCurrentRepo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErrorType, setLoadErrorType] = useState<LoadErrorType | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [hasCompletedTeleportErrorFlow, setHasCompletedTeleportErrorFlow] = useState(false);

  // Track focused index for scroll position display in title
  const [focusedIndex, setFocusedIndex] = useState(1);
  const escKey = useShortcutDisplay('confirm:no', 'Confirmation', 'Esc');
// loadSessions：拉取会话的核心异步函数。先探测当前仓库，再按仓库过滤、按更新时间倒序排列，异常时按信息归类错误类型。
  const loadSessions = useCallback(async () => {
    try {
      setLoading(true);
      setLoadErrorType(null);

      // Detect current repository
// 若探测到当前仓库则只保留该仓库的会话，否则展示全部；过滤与排序都基于 updated_at。
      const detectedRepo = await detectCurrentRepository();
      setCurrentRepo(detectedRepo);
      logForDebugging(`Current repository: ${detectedRepo || 'not detected'}`);
      const codeSessions = await fetchCodeSessionsFromSessionsAPI();

      // Filter sessions by current repository if detected
      let filteredSessions = codeSessions;
      if (detectedRepo) {
        filteredSessions = codeSessions.filter(session => {
          if (!session.repo) return false;
          const sessionRepo = `${session.repo.owner.login}/${session.repo.name}`;
          return sessionRepo === detectedRepo;
        });
        logForDebugging(`Filtered ${filteredSessions.length} sessions for repo ${detectedRepo} from ${codeSessions.length} total`);
      }

      // Sort by updated_at (newest first)
      const sortedSessions = [...filteredSessions].sort((a, b) => {
        const dateA = new Date(a.updated_at);
        const dateB = new Date(b.updated_at);
        return dateB.getTime() - dateA.getTime();
      });
      setSessions(sortedSessions);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logForDebugging(`Error loading code sessions: ${errorMessage}`);
      setLoadErrorType(determineErrorType(errorMessage));
    } finally {
      setLoading(false);
      setRetrying(false);
    }
  }, []);
// handleRetry：进入重试态并重新拉取会话。
  const handleRetry = () => {
    setRetrying(true);
    void loadSessions();
  };

  // Handle escape via keybinding
// 绑定 Esc 为取消（confirm:no），上下文为 Confirmation。
  useKeybinding('confirm:no', onCancel, {
    context: 'Confirmation'
  });
// 原生键盘处理：Ctrl+C 取消；错误态下 Ctrl+R 重试；错误态下回车则放弃回到常规 teleport 流程。
  useInput((input, key) => {
    // We need to handle ctrl+c in case we don't render a <Select>
    if (key.ctrl && input === 'c') {
      onCancel();
      return;
    }

    // Handle retry in error state with 'ctrl+r'
    if (key.ctrl && input === 'r' && loadErrorType) {
      handleRetry();
      return;
    }

    // Handle enter key for error states to allow continuation with regular teleport
    if (loadErrorType !== null && key.return) {
      onCancel(); // This will continue with regular teleport flow
      return;
    }
  });
// handleErrorComplete：完成遥测错误流后重新拉取会话。
  const handleErrorComplete = useCallback(() => {
    setHasCompletedTeleportErrorFlow(true);
    void loadSessions();
  }, [setHasCompletedTeleportErrorFlow, loadSessions]);

  // Show error dialog if needed
// 渲染分支：未完成错误流时先弹 TeleportError；加载中显示 Spinner；有错误显示对应引导；无会话显示空态。
  if (!hasCompletedTeleportErrorFlow) {
    return <TeleportError onComplete={handleErrorComplete} />;
  }
  if (loading) {
    return <Box flexDirection="column" padding={1}>
        <Box flexDirection="row">
          <Spinner />
          <Text bold>Loading Claude Code sessions…</Text>
        </Box>
        <Text dimColor>
          {retrying ? 'Retrying…' : 'Fetching your Claude Code sessions…'}
        </Text>
      </Box>;
  }
  if (loadErrorType) {
    return <Box flexDirection="column" padding={1}>
        <Text bold color="error">
          Error loading Claude Code sessions
        </Text>

        {renderErrorSpecificGuidance(loadErrorType)}

        <Text dimColor>
          Press <Text bold>Ctrl+R</Text> to retry · Press{' '}
          <Text bold>{escKey}</Text> to cancel
        </Text>
      </Box>;
  }
  if (sessions.length === 0) {
    return <Box flexDirection="column" padding={1}>
        <Text bold>
          No Claude Code sessions found
          {currentRepo && <Text> for {currentRepo}</Text>}
        </Text>
        <Box marginTop={1}>
          <Text dimColor>
            Press <Text bold>{escKey}</Text> to cancel
          </Text>
        </Box>
      </Box>;
  }
// 把会话映射成带相对时间的元数据，并计算时间列的最大宽度用于对齐。
  const sessionMetadata = sessions.map(session_0 => ({
    ...session_0,
    timeString: formatRelativeTime(new Date(session_0.updated_at))
  }));
  const maxTimeStringLength = Math.max(UPDATED_STRING.length, ...sessionMetadata.map(meta => meta.timeString.length));
// 构造 Select 选项：时间右补空格对齐，后接会话标题。
  const options = sessionMetadata.map(({
    timeString,
    title,
    id
  }) => {
    const paddedTime = timeString.padEnd(maxTimeStringLength, ' ');

    // TODO: include branch name when API returns it
    return {
      label: `${paddedTime}  ${title}`,
      value: id
    };
  });

// 布局开销与可见数量：根据是否内嵌、终端行数、固定开销计算最多可见选项数与总高度。
  // Adjust layout for embedded vs full-screen rendering
  // Overhead: padding (2) + title (1) + marginY (2) + header (1) + footer (1) = 7
  const layoutOverhead = 7;
  const maxVisibleOptions = Math.max(1, isEmbedded ? Math.min(sessions.length, 5, rows - 6 - layoutOverhead) : Math.min(sessions.length, rows - 1 - layoutOverhead));
  const maxHeight = maxVisibleOptions + layoutOverhead;

  // Show scroll position in title when list needs scrolling
  const showScrollPosition = sessions.length > maxVisibleOptions;
  return <Box flexDirection="column" padding={1} height={maxHeight}>
      <Text bold>
        Select a session to resume
        {showScrollPosition && <Text dimColor>
            {' '}
            ({focusedIndex} of {sessions.length})
          </Text>}
        {currentRepo && <Text dimColor> ({currentRepo})</Text>}:
      </Text>
      <Box flexDirection="column" marginTop={1} flexGrow={1}>
        <Box marginLeft={2}>
          <Text bold>
            {UPDATED_STRING.padEnd(maxTimeStringLength, ' ')}
            {SPACE_BETWEEN_TABLE_COLUMNS}
            {'Session Title'}
          </Text>
        </Box>
// 渲染选择列表：表头 Updated / Session Title 加 Select，onChange 时按 id 找到会话并 onSelect。
        <Select visibleOptionCount={maxVisibleOptions} options={options} onChange={value => {
        const session_1 = sessions.find(s => s.id === value);
        if (session_1) {
          onSelect(session_1);
        }
      }} onFocus={value_0 => {
        const index = options.findIndex(o => o.value === value_0);
        if (index >= 0) {
          setFocusedIndex(index + 1);
        }
      }} />
      </Box>
      <Box flexDirection="row">
        <Text dimColor>
          <Byline>
            <KeyboardShortcutHint shortcut="↑/↓" action="select" />
            <KeyboardShortcutHint shortcut="Enter" action="confirm" />
            <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" />
          </Byline>
        </Text>
      </Box>
    </Box>;
}

/**
 * Determines the type of error based on the error message
 */
function determineErrorType(errorMessage: string): LoadErrorType {
  const message = errorMessage.toLowerCase();
  if (message.includes('fetch') || message.includes('network') || message.includes('timeout')) {
    return 'network';
  }
  if (message.includes('auth') || message.includes('token') || message.includes('permission') || message.includes('oauth') || message.includes('not authenticated') || message.includes('/login') || message.includes('console account') || message.includes('403')) {
    return 'auth';
  }
  if (message.includes('api') || message.includes('rate limit') || message.includes('500') || message.includes('529')) {
    return 'api';
  }
  return 'other';
}

/**
 * Renders error-specific troubleshooting guidance
 */
function renderErrorSpecificGuidance(errorType: LoadErrorType): React.ReactNode {
  switch (errorType) {
    case 'network':
      return <Box marginY={1} flexDirection="column">
          <Text dimColor>Check your internet connection</Text>
        </Box>;
    case 'auth':
      return <Box marginY={1} flexDirection="column">
          <Text dimColor>Teleport requires a Claude account</Text>
          <Text dimColor>
            Run <Text bold>/login</Text> and select &quot;Claude account with
            subscription&quot;
          </Text>
        </Box>;
    case 'api':
      return <Box marginY={1} flexDirection="column">
          <Text dimColor>Sorry, Claude encountered an error</Text>
        </Box>;
    case 'other':
      return <Box marginY={1} flexDirection="row">
          <Text dimColor>Sorry, Claude Code encountered an error</Text>
        </Box>;
  }
}
// 原文件此处有一行 28648 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。