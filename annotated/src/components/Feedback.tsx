// 本文件是反馈与 bug 报告对话框：四步流（输入、同意、提交、完成），提交内容带会话转录、子代理转录、脱敏后的内存错误日志与环境信息；标题由 Haiku 生成；完成态可一键拼 GitHub issue 链接。配套导出 redactSensitiveInfo 脱敏函数与 createGitHubIssueUrl 拼链函数；对自定义数据保留策略（ZDR）组织单独给出不可用提示。
import axios from 'axios';
import { readFile, stat } from 'fs/promises';
import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { getLastAPIRequest } from 'src/bootstrap/state.js';
import { logEventTo1P } from 'src/services/analytics/firstPartyEventLogger.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from 'src/services/analytics/index.js';
import { getLastAssistantMessage, normalizeMessagesForAPI } from 'src/utils/messages.js';
import type { CommandResultDisplay } from '../commands.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { Box, Text, useInput } from '../ink.js';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import { queryHaiku } from '../services/api/claude.js';
import { startsWithApiErrorPrefix } from '../services/api/errors.js';
import type { Message } from '../types/message.js';
import { checkAndRefreshOAuthTokenIfNeeded } from '../utils/auth.js';
import { openBrowser } from '../utils/browser.js';
import { logForDebugging } from '../utils/debug.js';
import { env } from '../utils/env.js';
import { type GitRepoState, getGitState, getIsGit } from '../utils/git.js';
import { getAuthHeaders, getUserAgent } from '../utils/http.js';
import { getInMemoryErrors, logError } from '../utils/log.js';
import { isEssentialTrafficOnly } from '../utils/privacyLevel.js';
import { extractTeammateTranscriptsFromTasks, getTranscriptPath, loadAllSubagentTranscriptsFromDisk, MAX_TRANSCRIPT_READ_BYTES } from '../utils/sessionStorage.js';
import { jsonStringify } from '../utils/slowOperations.js';
import { asSystemPrompt } from '../utils/systemPromptType.js';
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js';
import { Byline } from './design-system/Byline.js';
import { Dialog } from './design-system/Dialog.js';
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js';
import TextInput from './TextInput.js';

// This value was determined experimentally by testing the URL length limit
// GitHub issue 链接的 URL 总长上限是实测出来的 7250 字符；仓库地址按构建目标切换内外部。
const GITHUB_URL_LIMIT = 7250;
const GITHUB_ISSUES_REPO_URL = "external" === 'ant' ? 'https://github.com/anthropics/claude-cli-internal/issues' : 'https://github.com/anthropics/claude-code/issues';
// Props：abortSignal 中止令牌、messages 当前会话消息、initialDescription 预填描述、backgroundTasks 带上后台任务的转录（队友代理的对话也收进报告）。
type Props = {
  abortSignal: AbortSignal;
  messages: Message[];
  initialDescription?: string;
  onDone(result: string, options?: {
    display?: CommandResultDisplay;
  }): void;
  backgroundTasks?: {
    [taskId: string]: {
      type: string;
      identity?: {
        agentId: string;
      };
      messages?: Message[];
    };
  };
};
// 四步状态机：userInput 描述输入、consent 同意清单、submitting 提交中、done 完成；失败会退回 userInput 保留已输入内容。
type Step = 'userInput' | 'consent' | 'submitting' | 'done';
// 报告数据结构：最新 assistant 消息 ID 用于对齐服务端日志，transcript 是 API 归一化后的消息，subagentTranscripts 按代理 ID 分组，rawTranscriptJsonl 是原始转录文件全文。
type FeedbackData = {
  // latestAssistantMessageId is the message ID from the latest main model call
  latestAssistantMessageId: string | null;
  message_count: number;
  datetime: string;
  description: string;
  platform: string;
  gitRepo: boolean;
  version: string | null;
  transcript: Message[];
  subagentTranscripts?: {
    [agentId: string]: Message[];
  };
  rawTranscriptJsonl?: string;
};

// Utility function to redact sensitive information from strings
// 脱敏函数：逐类替换敏感串——Anthropic API key（带引号版先替换、裸串版用前后环视避免误伤）、AWS key 两种格式、GCP key 与服务账号邮箱、x-api-key 与 authorization 头的值、AWS 与 GCP 环境变量赋值、通用的 KEY TOKEN SECRET PASSWORD 赋值。每条替换保留前缀结构，日志里看不出原值但保留可读性。
export function redactSensitiveInfo(text: string): string {
  let redacted = text;

  // Anthropic API keys (sk-ant...) with or without quotes
  // First handle the case with quotes
  redacted = redacted.replace(/"(sk-ant[^\s"']{24,})"/g, '"[REDACTED_API_KEY]"');
  // Then handle the cases without quotes - more general pattern
  redacted = redacted.replace(
  // eslint-disable-next-line custom-rules/no-lookbehind-regex -- .replace(re, string) on /bug path: no-match returns same string (Object.is)
  /(?<![A-Za-z0-9"'])(sk-ant-?[A-Za-z0-9_-]{10,})(?![A-Za-z0-9"'])/g, '[REDACTED_API_KEY]');

  // AWS keys - AWSXXXX format - add the pattern we need for the test
// AWS 两式：AWS 开头大写字母数字串按「AWS key 加引号」上下文替换；AKIA 开头 16 位大写数字是 IAM 访问键 id，全局裸替换。
  redacted = redacted.replace(/AWS key: "(AWS[A-Z0-9]{20,})"/g, 'AWS key: "[REDACTED_AWS_KEY]"');

  // AWS AKIAXXX keys
  redacted = redacted.replace(/(AKIA[A-Z0-9]{16})/g, '[REDACTED_AWS_KEY]');

  // Google Cloud keys
  redacted = redacted.replace(
  // eslint-disable-next-line custom-rules/no-lookbehind-regex -- same as above
  /(?<![A-Za-z0-9])(AIza[A-Za-z0-9_-]{35})(?![A-Za-z0-9])/g, '[REDACTED_GCP_KEY]');

  // Vertex AI service account keys
  redacted = redacted.replace(
  // eslint-disable-next-line custom-rules/no-lookbehind-regex -- same as above
  /(?<![A-Za-z0-9])([a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com)(?![A-Za-z0-9])/g, '[REDACTED_GCP_SERVICE_ACCOUNT]');

  // Generic API keys in headers
// 请求头两类：x-api-key 与 authorization（可带 bearer 前缀）保留键名与冒号结构只换值——捕获组反向引用让替换后的串仍然形如原头。
  redacted = redacted.replace(/(["']?x-api-key["']?\s*[:=]\s*["']?)[^"',\s)}\]]+/gi, '$1[REDACTED_API_KEY]');

  // Authorization headers and Bearer tokens
  redacted = redacted.replace(/(["']?authorization["']?\s*[:=]\s*["']?(bearer\s+)?)[^"',\s)}\]]+/gi, '$1[REDACTED_TOKEN]');

  // AWS environment variables
  redacted = redacted.replace(/(AWS[_-][A-Za-z0-9_]+\s*[=:]\s*)["']?[^"',\s)}\]]+["']?/gi, '$1[REDACTED_AWS_VALUE]');

  // GCP environment variables
  redacted = redacted.replace(/(GOOGLE[_-][A-Za-z0-9_]+\s*[=:]\s*)["']?[^"',\s)}\]]+["']?/gi, '$1[REDACTED_GCP_VALUE]');

  // Environment variables with keys
  redacted = redacted.replace(/((API[-_]?KEY|TOKEN|SECRET|PASSWORD)\s*[=:]\s*)["']?[^"',\s)}\]]+["']?/gi, '$1[REDACTED]');
  return redacted;
}

// Get sanitized error logs with sensitive information redacted
// 内存错误收集：getInMemoryErrors 的副本逐条过脱敏——先复制再改，不动原始记录。
function getSanitizedErrorLogs(): Array<{
  error?: string;
  timestamp?: string;
}> {
  // Sanitize error logs to remove any API keys
  return getInMemoryErrors().map(errorInfo => {
    // Create a copy of the error info to avoid modifying the original
    const errorCopy = {
      ...errorInfo
    } as {
      error?: string;
      timestamp?: string;
    };

    // Sanitize error if present and is a string
    if (errorCopy && typeof errorCopy.error === 'string') {
      errorCopy.error = redactSensitiveInfo(errorCopy.error);
    }
    return errorCopy;
  });
}
// 原始转录读取：转录文件超上限就放弃（返回 null），避免把超大文件塞进报告；任何读失败静默降级。
async function loadRawTranscriptJsonl(): Promise<string | null> {
  try {
    const transcriptPath = getTranscriptPath();
    const {
      size
    } = await stat(transcriptPath);
    if (size > MAX_TRANSCRIPT_READ_BYTES) {
      logForDebugging(`Skipping raw transcript read: file too large (${size} bytes)`, {
        level: 'warn'
      });
      return null;
    }
    return await readFile(transcriptPath, 'utf-8');
  } catch {
    return null;
  }
}
// 对话框主体：Dialog 外壳（Esc 自动取消）加四步条件渲染；textInputColumns 按终端宽度减 4 预算输入框。
export function Feedback({
  abortSignal,
  messages,
  initialDescription,
  onDone,
  backgroundTasks = {}
}: Props): React.ReactNode {
// 七个 state：步骤、光标、描述、反馈 ID、错误、环境信息、标题；error 出现时退回 userInput 让用户改完重试。
  const [step, setStep] = useState<Step>('userInput');
  const [cursorOffset, setCursorOffset] = useState(0);
  const [description, setDescription] = useState(initialDescription ?? '');
  const [feedbackId, setFeedbackId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [envInfo, setEnvInfo] = useState<{
    isGit: boolean;
    gitState: GitRepoState | null;
  }>({
    isGit: false,
    gitState: null
  });
  const [title, setTitle] = useState<string | null>(null);
  const textInputColumns = useTerminalSize().columns - 4;
// 挂载时异步探测 git 环境：是否仓库、分支、commit、远端、是否干净——同意清单里会展示这些元数据。
  useEffect(() => {
    async function loadEnvInfo() {
      const isGit = await getIsGit();
      let gitState: GitRepoState | null = null;
      if (isGit) {
        gitState = await getGitState();
      }
      setEnvInfo({
        isGit,
        gitState
      });
    }
    void loadEnvInfo();
  }, []);
// submitReport 提交主流程：先收脱敏错误日志，抽最后一条 assistant 消息的 requestId；再读磁盘子代理转录与原始转录 jsonl、抽队友任务转录，三者合并（磁盘与队友任务重名时后者覆盖）。
  const submitReport = useCallback(async () => {
    setStep('submitting');
    setError(null);
    setFeedbackId(null);

    // Get sanitized errors for the report
    const sanitizedErrors = getSanitizedErrorLogs();

    // Extract last assistant message ID from messages array
    const lastAssistantMessage = getLastAssistantMessage(messages);
    const lastAssistantMessageId = lastAssistantMessage?.requestId ?? null;
    const [diskTranscripts, rawTranscriptJsonl] = await Promise.all([loadAllSubagentTranscriptsFromDisk(), loadRawTranscriptJsonl()]);
    const teammateTranscripts = extractTeammateTranscriptsFromTasks(backgroundTasks);
    const subagentTranscripts = {
      ...diskTranscripts,
      ...teammateTranscripts
    };
// reportData 组装：平台、终端、版本、是否 git 仓库、消息计数、时间戳，transcript 过 normalizeMessagesForAPI 归一化；子代理转录与原始 jsonl 只在非空时附带。
    const reportData = {
      latestAssistantMessageId: lastAssistantMessageId,
      message_count: messages.length,
      datetime: new Date().toISOString(),
      description,
      platform: env.platform,
      gitRepo: envInfo.isGit,
      terminal: env.terminal,
      version: MACRO.VERSION,
      transcript: normalizeMessagesForAPI(messages),
      errors: sanitizedErrors,
      lastApiRequest: getLastAPIRequest(),
      ...(Object.keys(subagentTranscripts).length > 0 && {
        subagentTranscripts
      }),
      ...(rawTranscriptJsonl && {
        rawTranscriptJsonl
      })
    };
// 提交与标题生成并行：submitFeedback 发报告，generateTitle 用 Haiku 从描述生成 issue 标题。
    const [result, t] = await Promise.all([submitFeedback(reportData, abortSignal), generateTitle(description, abortSignal)]);
    setTitle(t);
// 结果分支：成功则记 feedbackId 并上报 1P 事件（描述先脱敏——自由文本进数据仓按 feedback_id 关联）；失败时 ZDR 组织给专属文案、其余通用文案，退回 userInput 保留输入。
    if (result.success) {
      if (result.feedbackId) {
        setFeedbackId(result.feedbackId);
        logEvent('tengu_bug_report_submitted', {
          feedback_id: result.feedbackId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          last_assistant_message_id: lastAssistantMessageId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });
        // 1P-only: freeform text approved for BQ. Join on feedback_id.
        logEventTo1P('tengu_bug_report_description', {
          feedback_id: result.feedbackId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          description: redactSensitiveInfo(description) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });
      }
      setStep('done');
    } else {
      if (result.isZdrOrg) {
        setError('Feedback collection is not available for organizations with custom data retention policies.');
      } else {
        setError('Could not submit feedback. Please try again later.');
      }
      // Stay on userInput step so user can retry with their content preserved
      setStep('userInput');
    }
  }, [description, envInfo.isGit, messages]);

  // Handle cancel - this will be called by Dialog's automatic Esc handling
// handleCancel：done 态时把结果（成功或失败）作为命令回显交给 onDone；其余直接回「已取消」。
  const handleCancel = useCallback(() => {
    // Don't cancel when done - let other keys close the dialog
    if (step === 'done') {
      if (error) {
        onDone('Error submitting feedback / bug report', {
          display: 'system'
        });
      } else {
        onDone('Feedback / bug report submitted', {
          display: 'system'
        });
      }
      return;
    }
    onDone('Feedback / bug report cancelled', {
      display: 'system'
    });
  }, [step, error, onDone]);

  // During text input, use Settings context where only Escape (not 'n') triggers confirm:no.
  // This allows typing 'n' in the text field while still supporting Escape to cancel.
// 输入步的 confirm:no 键位挂 Settings 上下文：该上下文里只有 Esc 触发，n 键可以正常打进文本框——用上下文区分键位语义的典型用法。
  useKeybinding('confirm:no', handleCancel, {
    context: 'Settings',
    isActive: step === 'userInput'
  });
// useInput 全局键处理：done 态按 Enter 用 feedbackId、标题、脱敏描述、脱敏错误拼 GitHub issue 链接并打开浏览器，任意键关对话框；consent 态 Enter 或空格提交。
  useInput((input, key) => {
    // Allow any key press to close the dialog when done or when there's an error
    if (step === 'done') {
      if (key.return && title) {
        // Open GitHub issue URL when Enter is pressed
        const issueUrl = createGitHubIssueUrl(feedbackId ?? '', title, description, getSanitizedErrorLogs());
        void openBrowser(issueUrl);
      }
      if (error) {
        onDone('Error submitting feedback / bug report', {
          display: 'system'
        });
      } else {
        onDone('Feedback / bug report submitted', {
          display: 'system'
        });
      }
      return;
    }

    // When in userInput step with error, allow user to edit and retry
    // (don't close on any keypress - they can still press Esc to cancel)
    if (error && step !== 'userInput') {
      onDone('Error submitting feedback / bug report', {
        display: 'system'
      });
      return;
    }
    if (step === 'consent' && (key.return || input === ' ')) {
      void submitReport();
    }
  });
// Dialog 渲染：标题固定；inputGuide 按步骤给键位提示行（输入与同意两步显示 Enter 与 Esc 提示，提交中与完成不显示）。
  return <Dialog title="Submit Feedback / Bug Report" onCancel={handleCancel} isCancelActive={step !== 'userInput'} inputGuide={exitState => exitState.pending ? <Text>Press {exitState.keyName} again to exit</Text> : step === 'userInput' ? <Byline>
            <KeyboardShortcutHint shortcut="Enter" action="continue" />
            <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" />
          </Byline> : step === 'consent' ? <Byline>
            <KeyboardShortcutHint shortcut="Enter" action="submit" />
            <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" />
          </Byline> : null}>
      {step === 'userInput' && <Box flexDirection="column" gap={1}>
          <Text>Describe the issue below:</Text>
          <TextInput value={description} onChange={value => {
        setDescription(value);
        // Clear error when user starts editing to allow retry
        if (error) {
          setError(null);
        }
      }} columns={textInputColumns} onSubmit={() => setStep('consent')} onExitMessage={() => onDone('Feedback cancelled', {
        display: 'system'
      })} cursorOffset={cursorOffset} onChangeCursorOffset={setCursorOffset} showCursor />
          {error && <Box flexDirection="column" gap={1}>
              <Text color="error">{error}</Text>
              <Text dimColor>
                Edit and press Enter to retry, or Esc to cancel
              </Text>
            </Box>}
        </Box>}

// consent 清单：逐项列出将提交的内容——描述、环境信息、git 元数据（分支、短 hash、远端、未同步与本地改动标记）、会话转录。
      {step === 'consent' && <Box flexDirection="column">
          <Text>This report will include:</Text>
          <Box marginLeft={2} flexDirection="column">
            <Text>
              - Your feedback / bug description:{' '}
              <Text dimColor>{description}</Text>
            </Text>
            <Text>
              - Environment info:{' '}
              <Text dimColor>
                {env.platform}, {env.terminal}, v{MACRO.VERSION}
              </Text>
            </Text>
            {envInfo.gitState && <Text>
                - Git repo metadata:{' '}
                <Text dimColor>
                  {envInfo.gitState.branchName}
                  {envInfo.gitState.commitHash ? `, ${envInfo.gitState.commitHash.slice(0, 7)}` : ''}
                  {envInfo.gitState.remoteUrl ? ` @ ${envInfo.gitState.remoteUrl}` : ''}
                  {!envInfo.gitState.isHeadOnRemote && ', not synced'}
                  {!envInfo.gitState.isClean && ', has local changes'}
                </Text>
              </Text>}
            <Text>- Current session transcript</Text>
          </Box>
          <Box marginTop={1}>
            <Text wrap="wrap" dimColor>
              We will use your feedback to debug related issues or to improve{' '}
              Claude Code&apos;s functionality (eg. to reduce the risk of bugs
              occurring in the future).
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text>
              Press <Text bold>Enter</Text> to confirm and submit.
            </Text>
          </Box>
        </Box>}

      {step === 'submitting' && <Box flexDirection="row" gap={1}>
          <Text>Submitting report…</Text>
        </Box>}

      {step === 'done' && <Box flexDirection="column">
          {error ? <Text color="error">{error}</Text> : <Text color="success">Thank you for your report!</Text>}
          {feedbackId && <Text dimColor>Feedback ID: {feedbackId}</Text>}
          <Box marginTop={1}>
            <Text>Press </Text>
            <Text bold>Enter </Text>
            <Text>
              to open your browser and draft a GitHub issue, or any other key to
              close.
            </Text>
          </Box>
        </Box>}
    </Dialog>;
}
// GitHub issue 拼链：标题描述先脱敏再 encodeURIComponent，body 由描述、环境、错误 JSON 组成；核心是 7250 字符预算下的三段式腾挪。
export function createGitHubIssueUrl(feedbackId: string, title: string, description: string, errors: Array<{
  error?: string;
  timestamp?: string;
}>): string {
  const sanitizedTitle = redactSensitiveInfo(title);
  const sanitizedDescription = redactSensitiveInfo(description);
  const bodyPrefix = `**Bug Description**\n${sanitizedDescription}\n\n` + `**Environment Info**\n` + `- Platform: ${env.platform}\n` + `- Terminal: ${env.terminal}\n` + `- Version: ${MACRO.VERSION || 'unknown'}\n` + `- Feedback ID: ${feedbackId}\n` + `\n**Errors**\n\`\`\`json\n`;
  const errorSuffix = `\n\`\`\`\n`;
  const errorsJson = jsonStringify(errors);
  const baseUrl = `${GITHUB_ISSUES_REPO_URL}/new?title=${encodeURIComponent(sanitizedTitle)}&labels=user-reported,bug&body=`;
  const truncationNote = `\n**Note:** Content was truncated.\n`;
  const encodedPrefix = encodeURIComponent(bodyPrefix);
  const encodedSuffix = encodeURIComponent(errorSuffix);
  const encodedNote = encodeURIComponent(truncationNote);
  const encodedErrors = encodeURIComponent(errorsJson);

  // Calculate space available for errors
// 预算计算：总长减 baseUrl、前缀、后缀、截断说明的编码长度，剩下的留给错误 JSON。
  const spaceForErrors = GITHUB_URL_LIMIT - baseUrl.length - encodedPrefix.length - encodedSuffix.length - encodedNote.length;

  // If description alone exceeds limit, truncate everything
// 溢出路径：前缀本身就超预算时整体截断——描述加错误一起压进剩余空间，留 50 字符安全余量，且不把百分号转义序列切一半。
  if (spaceForErrors <= 0) {
    const ellipsis = encodeURIComponent('…');
    const buffer = 50; // Extra safety margin
    const maxEncodedLength = GITHUB_URL_LIMIT - baseUrl.length - ellipsis.length - encodedNote.length - buffer;
    const fullBody = bodyPrefix + errorsJson + errorSuffix;
    let encodedFullBody = encodeURIComponent(fullBody);
    if (encodedFullBody.length > maxEncodedLength) {
      encodedFullBody = encodedFullBody.slice(0, maxEncodedLength);
      // Don't cut in middle of %XX sequence
      const lastPercent = encodedFullBody.lastIndexOf('%');
      if (lastPercent >= encodedFullBody.length - 2) {
        encodedFullBody = encodedFullBody.slice(0, lastPercent);
      }
    }
    return baseUrl + encodedFullBody + ellipsis + encodedNote;
  }

  // If errors fit, no truncation needed
// 装得下：三段直接拼，不截断。
  if (encodedErrors.length <= spaceForErrors) {
    return baseUrl + encodedPrefix + encodedErrors + encodedSuffix;
  }

  // Truncate errors to fit (prioritize keeping description)
  // Slice encoded errors directly, then trim to avoid cutting %XX sequences
// 装不下错误但装得下描述：按剩余空间截错误 JSON，同样防转义序列半切，尾部加省略号与截断说明。
  const ellipsis = encodeURIComponent('…');
  const buffer = 50; // Extra safety margin
  let truncatedEncodedErrors = encodedErrors.slice(0, spaceForErrors - ellipsis.length - buffer);
  // If we cut in middle of %XX, back up to before the %
  const lastPercent = truncatedEncodedErrors.lastIndexOf('%');
  if (lastPercent >= truncatedEncodedErrors.length - 2) {
    truncatedEncodedErrors = truncatedEncodedErrors.slice(0, lastPercent);
  }
  return baseUrl + encodedPrefix + truncatedEncodedErrors + ellipsis + encodedSuffix + encodedNote;
}
// 标题生成：Haiku 系统提示给定规范（80 字符内、Bug 或 Feature Request 前缀、抽取关键错误而非整段消息）；标题本身以 API 错误开头时视为生成失败走兜底。
async function generateTitle(description: string, abortSignal: AbortSignal): Promise<string> {
  try {
    const response = await queryHaiku({
      systemPrompt: asSystemPrompt(['Generate a concise, technical issue title (max 80 chars) for a public GitHub issue based on this bug report for Claude Code.', 'Claude Code is an agentic coding CLI based on the Anthropic API.', 'The title should:', '- Include the type of issue [Bug] or [Feature Request] as the first thing in the title', '- Be concise, specific and descriptive of the actual problem', '- Use technical terminology appropriate for a software issue', '- For error messages, extract the key error (e.g., "Missing Tool Result Block" rather than the full message)', '- Be direct and clear for developers to understand the problem', '- If you cannot determine a clear issue, use "Bug Report: [brief description]"', '- Any LLM API errors are from the Anthropic API, not from any other model provider', 'Your response will be directly used as the title of the Github issue, and as such should not contain any other commentary or explaination', 'Examples of good titles include: "[Bug] Auto-Compact triggers to soon", "[Bug] Anthropic API Error: Missing Tool Result Block", "[Bug] Error: Invalid Model Name for Opus"']),
      userPrompt: description,
      signal: abortSignal,
      options: {
        hasAppendSystemPrompt: false,
        toolChoice: undefined,
        isNonInteractiveSession: false,
        agents: [],
        querySource: 'feedback',
        mcpTools: []
      }
    });
    const title = response.message.content[0]?.type === 'text' ? response.message.content[0].text : 'Bug Report';

    // Check if the title contains an API error message
    if (startsWithApiErrorPrefix(title)) {
      return createFallbackTitle(description);
    }
    return title;
  } catch (error) {
    // If there's any error in title generation, use a fallback title
    logError(error);
    return createFallbackTitle(description);
  }
}
// 兜底标题：取描述首行，60 字符内直接用；超长按最后一个空格的词边界截断加省略号；太短退化为 Bug Report。
function createFallbackTitle(description: string): string {
  // Create a safe fallback title based on the bug description

  // Try to extract a meaningful title from the first line
  const firstLine = description.split('\n')[0] || '';

  // If the first line is very short, use it directly
  if (firstLine.length <= 60 && firstLine.length > 5) {
    return firstLine;
  }

  // For longer descriptions, create a truncated version
  // Truncate at word boundaries when possible
  let truncated = firstLine.slice(0, 60);
  if (firstLine.length > 60) {
    // Find the last space before the 60 char limit
    const lastSpace = truncated.lastIndexOf(' ');
    if (lastSpace > 30) {
      // Only trim at word if we're not cutting too much
      truncated = truncated.slice(0, lastSpace);
    }
    truncated += '...';
  }
  return truncated.length < 10 ? 'Bug Report' : truncated;
}

// Helper function to sanitize and log errors without exposing API keys
// 错误日志包装：Error 对象的 message 与 stack 都过脱敏再进日志；非 Error 值转字符串后同样处理。
function sanitizeAndLogError(err: unknown): void {
  if (err instanceof Error) {
    // Create a copy with potentially sensitive info redacted
    const safeError = new Error(redactSensitiveInfo(err.message));

    // Also redact the stack trace if present
    if (err.stack) {
      safeError.stack = redactSensitiveInfo(err.stack);
    }
    logError(safeError);
  } else {
    // For non-Error objects, convert to string and redact sensitive info
    const errorString = redactSensitiveInfo(String(err));
    logError(new Error(errorString));
  }
}
// submitFeedback：POST 到 api.anthropic.com 的反馈端点——纯必要流量模式直接失败；30 秒超时；成功要求响应带 feedback_id；403 且错误类型含自定义保留设置时标记 isZdrOrg。
async function submitFeedback(data: FeedbackData, signal?: AbortSignal): Promise<{
  success: boolean;
  feedbackId?: string;
  isZdrOrg?: boolean;
}> {
  if (isEssentialTrafficOnly()) {
    return {
      success: false
    };
  }
  try {
    // Ensure OAuth token is fresh before getting auth headers
    // This prevents 401 errors from stale cached tokens
    await checkAndRefreshOAuthTokenIfNeeded();
// 先刷新 OAuth 令牌再取鉴权头，避免缓存的过期令牌打出 401。
    const authResult = getAuthHeaders();
    if (authResult.error) {
      return {
        success: false
      };
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': getUserAgent(),
      ...authResult.headers
    };
// content 字段是整包 JSON 字符串（服务端按字符串收）；axios 取消（abort）不算错误，静默返回。
    const response = await axios.post('https://api.anthropic.com/api/claude_cli_feedback', {
      content: jsonStringify(data)
    }, {
      headers,
      timeout: 30000,
      // 30 second timeout to prevent hanging
      signal
    });
    if (response.status === 200) {
      const result = response.data;
      if (result?.feedback_id) {
        return {
          success: true,
          feedbackId: result.feedback_id
        };
      }
      sanitizeAndLogError(new Error('Failed to submit feedback: request did not return feedback_id'));
      return {
        success: false
      };
    }
    sanitizeAndLogError(new Error('Failed to submit feedback:' + response.status));
    return {
      success: false
    };
  } catch (err) {
    // Handle cancellation/abort - don't log as error
    if (axios.isCancel(err)) {
      return {
        success: false
      };
    }
// 403 分支：响应体错误类型为 permission_error 且消息含自定义保留设置时返回 isZdrOrg——上层据此换成「该组织不可用反馈」的专属文案。
    if (axios.isAxiosError(err) && err.response?.status === 403) {
      const errorData = err.response.data;
      if (errorData?.error?.type === 'permission_error' && errorData?.error?.message?.includes('Custom data retention settings')) {
        sanitizeAndLogError(new Error('Cannot submit feedback because custom data retention settings are enabled'));
        return {
          success: false,
          isZdrOrg: true
        };
      }
    }
    // Use our safe error logging function to avoid leaking API keys
    sanitizeAndLogError(err);
    return {
      success: false
    };
  }
}
// 原文件此处有一行 63316 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。