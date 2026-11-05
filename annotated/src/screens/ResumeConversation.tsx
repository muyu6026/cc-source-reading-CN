// 恢复会话界面：列出当前仓库（或全部项目）的历史会话，让用户挑一个继续——挑中后负责把元数据、消息、工作树全部接回
import { c as _c } from "react/compiler-runtime";
import { feature } from 'bun:bundle';
import { dirname } from 'path';
import React from 'react';
import { useTerminalSize } from 'src/hooks/useTerminalSize.js';
import { getOriginalCwd, switchSession } from '../bootstrap/state.js';
import type { Command } from '../commands.js';
import { LogSelector } from '../components/LogSelector.js';
import { Spinner } from '../components/Spinner.js';
import { restoreCostStateForSession } from '../cost-tracker.js';
import { setClipboard } from '../ink/termio/osc.js';
import { Box, Text } from '../ink.js';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from '../services/analytics/index.js';
import type { MCPServerConnection, ScopedMcpServerConfig } from '../services/mcp/types.js';
import { useAppState, useSetAppState } from '../state/AppState.js';
import type { Tool } from '../Tool.js';
import type { AgentColorName } from '../tools/AgentTool/agentColorManager.js';
import type { AgentDefinition } from '../tools/AgentTool/loadAgentsDir.js';
import { asSessionId } from '../types/ids.js';
import type { LogOption } from '../types/logs.js';
import type { Message } from '../types/message.js';
import { agenticSessionSearch } from '../utils/agenticSessionSearch.js';
import { renameRecordingForSession } from '../utils/asciicast.js';
import { updateSessionName } from '../utils/concurrentSessions.js';
import { loadConversationForResume } from '../utils/conversationRecovery.js';
import { checkCrossProjectResume } from '../utils/crossProjectResume.js';
import type { FileHistorySnapshot } from '../utils/fileHistory.js';
import { logError } from '../utils/log.js';
import { createSystemMessage } from '../utils/messages.js';
import { computeStandaloneAgentContext, restoreAgentFromSession, restoreWorktreeForResume } from '../utils/sessionRestore.js';
import { adoptResumedSessionFile, enrichLogs, isCustomTitleEnabled, loadAllProjectsMessageLogsProgressive, loadSameRepoMessageLogsProgressive, recordContentReplacement, resetSessionFilePointer, restoreSessionMetadata, type SessionLogResult } from '../utils/sessionStorage.js';
import type { ThinkingConfig } from '../utils/thinking.js';
import type { ContentReplacementRecord } from '../utils/toolResultStorage.js';
import { REPL } from './REPL.js';
// parsePrIdentifier：把用户输入解析成 PR 编号，支持纯数字或 github pull 链接两种写法
function parsePrIdentifier(value: string): number | null {
  const directNumber = parseInt(value, 10);
  if (!isNaN(directNumber) && directNumber > 0) {
    return directNumber;
  }
  const urlMatch = value.match(/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/);
  if (urlMatch?.[1]) {
    return parseInt(urlMatch[1], 10);
  }
  return null;
}
// Props：界面要的全部入参，含初始工具、MCP 配置、思考配置等
type Props = {
  commands: Command[];
  worktreePaths: string[];
  initialTools: Tool[];
  mcpClients?: MCPServerConnection[];
  dynamicMcpConfig?: Record<string, ScopedMcpServerConfig>;
  debug: boolean;
  mainThreadAgentDefinition?: AgentDefinition;
  autoConnectIdeFlag?: boolean;
  strictMcpConfig?: boolean;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  initialSearchQuery?: string;
  disableSlashCommands?: boolean;
  forkSession?: boolean;
  taskListId?: string;
  filterByPr?: boolean | number | string;
  thinkingConfig: ThinkingConfig;
  onTurnComplete?: (messages: Message[]) => void | Promise<void>;
};
// ResumeConversation 主组件：无状态逻辑，只读 Hook 与本地 useState 撑起整个选择流程
export function ResumeConversation({
  commands,
  worktreePaths,
  initialTools,
  mcpClients,
  dynamicMcpConfig,
  debug,
  mainThreadAgentDefinition,
  autoConnectIdeFlag,
  strictMcpConfig = false,
  systemPrompt,
  appendSystemPrompt,
  initialSearchQuery,
  disableSlashCommands = false,
  forkSession,
  taskListId,
  filterByPr,
  thinkingConfig,
  onTurnComplete
}: Props): React.ReactNode {
// 取终端尺寸，自适应布局
  const {
    rows
  } = useTerminalSize();
  const agentDefinitions = useAppState(s => s.agentDefinitions);
  const setAppState = useSetAppState();
// 日志列表与四种 UI 状态（加载中 / 恢复中 / 全项目开关 / 已选会话）
  const [logs, setLogs] = React.useState<LogOption[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [resuming, setResuming] = React.useState(false);
  const [showAllProjects, setShowAllProjects] = React.useState(false);
  const [resumeData, setResumeData] = React.useState<{
    messages: Message[];
    fileHistorySnapshots?: FileHistorySnapshot[];
    contentReplacements?: ContentReplacementRecord[];
    agentName?: string;
    agentColor?: AgentColorName;
    mainThreadAgentDefinition?: AgentDefinition;
  } | null>(null);
  const [crossProjectCommand, setCrossProjectCommand] = React.useState<string | null>(null);
  const sessionLogResultRef = React.useRef<SessionLogResult | null>(null);
  // Mirror of logs.length so loadMoreLogs can compute value indices outside
  // the setLogs updater (keeping it pure per React's contract).
  const logCountRef = React.useRef(0);
// filteredLogs：按 filterByPr 过滤（未指定 / 真 / 数字 / 字符串），其余原样返回
  const filteredLogs = React.useMemo(() => {
    let result = logs.filter(l => !l.isSidechain);
    if (filterByPr !== undefined) {
      if (filterByPr === true) {
        result = result.filter(l_0 => l_0.prNumber !== undefined);
      } else if (typeof filterByPr === 'number') {
        result = result.filter(l_1 => l_1.prNumber === filterByPr);
      } else if (typeof filterByPr === 'string') {
        const prNumber = parsePrIdentifier(filterByPr);
        if (prNumber !== null) {
          result = result.filter(l_2 => l_2.prNumber === prNumber);
        }
      }
    }
    return result;
  }, [logs, filterByPr]);
// 是否启用「恢复时改名」特性
  const isResumeWithRenameEnabled = isCustomTitleEnabled();
// 首屏加载：渐进式读同仓库的日志，读完后填列表
  React.useEffect(() => {
    loadSameRepoMessageLogsProgressive(worktreePaths).then(result_0 => {
      sessionLogResultRef.current = result_0;
      logCountRef.current = result_0.logs.length;
      setLogs(result_0.logs);
      setLoading(false);
    }).catch(error => {
      logError(error);
      setLoading(false);
    });
  }, [worktreePaths]);
// loadMoreLogs：分批补充日志，用 ref 镜像长度以便保持更新函数纯净
  const loadMoreLogs = React.useCallback((count: number) => {
    const ref = sessionLogResultRef.current;
    if (!ref || ref.nextIndex >= ref.allStatLogs.length) return;
    void enrichLogs(ref.allStatLogs, ref.nextIndex, count).then(result_1 => {
      ref.nextIndex = result_1.nextIndex;
      if (result_1.logs.length > 0) {
        // enrichLogs returns fresh unshared objects — safe to mutate in place.
        // Offset comes from logCountRef so the setLogs updater stays pure.
        const offset = logCountRef.current;
        result_1.logs.forEach((log, i) => {
          log.value = offset + i;
        });
        setLogs(prev => prev.concat(result_1.logs));
        logCountRef.current += result_1.logs.length;
      } else if (ref.nextIndex < ref.allStatLogs.length) {
        loadMoreLogs(count);
      }
    });
  }, []);
// loadLogs：按需读同仓库或全部项目的日志
  const loadLogs = React.useCallback((allProjects: boolean) => {
    setLoading(true);
    const promise = allProjects ? loadAllProjectsMessageLogsProgressive() : loadSameRepoMessageLogsProgressive(worktreePaths);
    promise.then(result_2 => {
      sessionLogResultRef.current = result_2;
      logCountRef.current = result_2.logs.length;
      setLogs(result_2.logs);
    }).catch(error_0 => {
      logError(error_0);
    }).finally(() => {
      setLoading(false);
    });
  }, [worktreePaths]);
// handleToggleAllProjects：切换全项目开关并重新加载
  const handleToggleAllProjects = React.useCallback(() => {
    const newValue = !showAllProjects;
    setShowAllProjects(newValue);
    loadLogs(newValue);
  }, [showAllProjects, loadLogs]);
// onCancel：直接退出进程
  function onCancel() {
    // eslint-disable-next-line custom-rules/no-process-exit
    process.exit(1);
  }
// onSelect：核心——挑中某条日志后，跨项目则复制命令返回、否则加载并接回会话全部状态
  async function onSelect(log_0: LogOption) {
    setResuming(true);
    const resumeStart = performance.now();
    const crossProjectCheck = checkCrossProjectResume(log_0, showAllProjects, worktreePaths);
    if (crossProjectCheck.isCrossProject) {
      if (!crossProjectCheck.isSameRepoWorktree) {
        const raw = await setClipboard(crossProjectCheck.command);
        if (raw) process.stdout.write(raw);
        setCrossProjectCommand(crossProjectCheck.command);
        return;
      }
    }
    try {
      const result_3 = await loadConversationForResume(log_0, undefined);
      if (!result_3) {
        throw new Error('Failed to load conversation');
      }
      if (feature('COORDINATOR_MODE')) {
        /* eslint-disable @typescript-eslint/no-require-imports */
        const coordinatorModule = require('../coordinator/coordinatorMode.js') as typeof import('../coordinator/coordinatorMode.js');
        /* eslint-enable @typescript-eslint/no-require-imports */
        const warning = coordinatorModule.matchSessionMode(result_3.mode);
        if (warning) {
          /* eslint-disable @typescript-eslint/no-require-imports */
          const {
            getAgentDefinitionsWithOverrides,
            getActiveAgentsFromList
          } = require('../tools/AgentTool/loadAgentsDir.js') as typeof import('../tools/AgentTool/loadAgentsDir.js');
          /* eslint-enable @typescript-eslint/no-require-imports */
          getAgentDefinitionsWithOverrides.cache.clear?.();
          const freshAgentDefs = await getAgentDefinitionsWithOverrides(getOriginalCwd());
          setAppState(prev_0 => ({
            ...prev_0,
            agentDefinitions: {
              ...freshAgentDefs,
              allAgents: freshAgentDefs.allAgents,
              activeAgents: getActiveAgentsFromList(freshAgentDefs.allAgents)
            }
          }));
          result_3.messages.push(createSystemMessage(warning, 'warning'));
        }
      }
      if (result_3.sessionId && !forkSession) {
        switchSession(asSessionId(result_3.sessionId), log_0.fullPath ? dirname(log_0.fullPath) : null);
        await renameRecordingForSession();
        await resetSessionFilePointer();
        restoreCostStateForSession(result_3.sessionId);
      } else if (forkSession && result_3.contentReplacements?.length) {
        await recordContentReplacement(result_3.contentReplacements);
      }
      const {
        agentDefinition: resolvedAgentDef
      } = restoreAgentFromSession(result_3.agentSetting, mainThreadAgentDefinition, agentDefinitions);
      setAppState(prev_1 => ({
        ...prev_1,
        agent: resolvedAgentDef?.agentType
      }));
      if (feature('COORDINATOR_MODE')) {
        /* eslint-disable @typescript-eslint/no-require-imports */
        const {
          saveMode
        } = require('../utils/sessionStorage.js');
        const {
          isCoordinatorMode
        } = require('../coordinator/coordinatorMode.js') as typeof import('../coordinator/coordinatorMode.js');
        /* eslint-enable @typescript-eslint/no-require-imports */
        saveMode(isCoordinatorMode() ? 'coordinator' : 'normal');
      }
      const standaloneAgentContext = computeStandaloneAgentContext(result_3.agentName, result_3.agentColor);
      if (standaloneAgentContext) {
        setAppState(prev_2 => ({
          ...prev_2,
          standaloneAgentContext
        }));
      }
      void updateSessionName(result_3.agentName);
      restoreSessionMetadata(forkSession ? {
        ...result_3,
        worktreeSession: undefined
      } : result_3);
      if (!forkSession) {
        restoreWorktreeForResume(result_3.worktreeSession);
        if (result_3.sessionId) {
          adoptResumedSessionFile();
        }
      }
      if (feature('CONTEXT_COLLAPSE')) {
        /* eslint-disable @typescript-eslint/no-require-imports */
        ;
        (require('../services/contextCollapse/persist.js') as typeof import('../services/contextCollapse/persist.js')).restoreFromEntries(result_3.contextCollapseCommits ?? [], result_3.contextCollapseSnapshot);
        /* eslint-enable @typescript-eslint/no-require-imports */
      }
      logEvent('tengu_session_resumed', {
        entrypoint: 'picker' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        success: true,
        resume_duration_ms: Math.round(performance.now() - resumeStart)
      });
      setLogs([]);
      setResumeData({
        messages: result_3.messages,
        fileHistorySnapshots: result_3.fileHistorySnapshots,
        contentReplacements: result_3.contentReplacements,
        agentName: result_3.agentName,
        agentColor: (result_3.agentColor === 'default' ? undefined : result_3.agentColor) as AgentColorName | undefined,
        mainThreadAgentDefinition: resolvedAgentDef
      });
    } catch (e) {
      logEvent('tengu_session_resumed', {
        entrypoint: 'picker' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        success: false
      });
      logError(e as Error);
      throw e;
    }
  }
// 跨项目情况：直接渲染一条提示，把切换目录的命令交给用户手动执行
  if (crossProjectCommand) {
    return <CrossProjectMessage command={crossProjectCommand} />;
  }
// 已选会话：把恢复出的消息与元数据交给 REPL 继续
  if (resumeData) {
    return <REPL debug={debug} commands={commands} initialTools={initialTools} initialMessages={resumeData.messages} initialFileHistorySnapshots={resumeData.fileHistorySnapshots} initialContentReplacements={resumeData.contentReplacements} initialAgentName={resumeData.agentName} initialAgentColor={resumeData.agentColor} mcpClients={mcpClients} dynamicMcpConfig={dynamicMcpConfig} strictMcpConfig={strictMcpConfig} systemPrompt={systemPrompt} appendSystemPrompt={appendSystemPrompt} mainThreadAgentDefinition={resumeData.mainThreadAgentDefinition} autoConnectIdeFlag={autoConnectIdeFlag} disableSlashCommands={disableSlashCommands} taskListId={taskListId} thinkingConfig={thinkingConfig} onTurnComplete={onTurnComplete} />;
  }
// 仍在加载：显示转圈
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
  if (filteredLogs.length === 0) {
    return <NoConversationsMessage />;
  }
  return <LogSelector logs={filteredLogs} maxHeight={rows} onCancel={onCancel} onSelect={onSelect} onLogsChanged={isResumeWithRenameEnabled ? () => loadLogs(showAllProjects) : undefined} onLoadMore={loadMoreLogs} initialSearchQuery={initialSearchQuery} showAllProjects={showAllProjects} onToggleAllProjects={handleToggleAllProjects} onAgenticSearch={agenticSessionSearch} />;
}
// NoConversationsMessage：没可恢复会话时的兜底提示组件
function NoConversationsMessage() {
  const $ = _c(2);
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = {
      context: "Global"
    };
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  useKeybinding("app:interrupt", _temp, t0);
  let t1;
  if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = <Box flexDirection="column"><Text>No conversations found to resume.</Text><Text dimColor={true}>Press Ctrl+C to exit and start a new conversation.</Text></Box>;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  return t1;
}
function _temp() {
  process.exit(1);
}
// CrossProjectMessage：渲染跨项目提示与需手动运行的命令
function CrossProjectMessage(t0) {
  const $ = _c(8);
  const {
    command
  } = t0;
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = [];
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  React.useEffect(_temp3, t1);
  let t2;
  if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = <Text>This conversation is from a different directory.</Text>;
    $[1] = t2;
  } else {
    t2 = $[1];
  }
  let t3;
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = <Text>To resume, run:</Text>;
    $[2] = t3;
  } else {
    t3 = $[2];
  }
  let t4;
  if ($[3] !== command) {
    t4 = <Box flexDirection="column">{t3}<Text> {command}</Text></Box>;
    $[3] = command;
    $[4] = t4;
  } else {
    t4 = $[4];
  }
  let t5;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = <Text dimColor={true}>(Command copied to clipboard)</Text>;
    $[5] = t5;
  } else {
    t5 = $[5];
  }
  let t6;
  if ($[6] !== t4) {
    t6 = <Box flexDirection="column" gap={1}>{t2}{t4}{t5}</Box>;
    $[6] = t4;
    $[7] = t6;
  } else {
    t6 = $[7];
  }
  return t6;
}
// _temp3：跨项目提示的副作用定时器，到点自动退出
function _temp3() {
  const timeout = setTimeout(_temp2, 100);
  return () => clearTimeout(timeout);
}
function _temp2() {
  process.exit(0);
}
// 原文件此处有一行 43740 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。