import axios from 'axios'
import { readFile, stat } from 'fs/promises'
import type { Message } from '../../types/message.js'
import { checkAndRefreshOAuthTokenIfNeeded } from '../../utils/auth.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import { getAuthHeaders, getUserAgent } from '../../utils/http.js'
import { normalizeMessagesForAPI } from '../../utils/messages.js'
import {
  extractAgentIdsFromMessages,
  getTranscriptPath,
  loadSubagentTranscripts,
  MAX_TRANSCRIPT_READ_BYTES,
} from '../../utils/sessionStorage.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { redactSensitiveInfo } from '../Feedback.js'

type TranscriptShareResult = {
  success: boolean
  transcriptId?: string
}

// TranscriptShareTrigger 四种触发来源：差评问卷、好评问卷、挫败感检测、记忆问卷——分享行为的归因字段，服务端按来源分析分享动机。
export type TranscriptShareTrigger =
  | 'bad_feedback_survey'
  | 'good_feedback_survey'
  | 'frustration'
  | 'memory_survey'

// 提交转录分享的主流程：归一化消息、收集子代理转录、读原始 JSONL、脱敏、认证、上传。任何一步失败都静默返回 success 为 false——分享是锦上添花，绝不为它打扰用户。
export async function submitTranscriptShare(
  messages: Message[],
  trigger: TranscriptShareTrigger,
  appearanceId: string,
): Promise<TranscriptShareResult> {
  try {
    logForDebugging('Collecting transcript for sharing', { level: 'info' })

// normalizeMessagesForAPI 先把会话消息转成 API 形态：剔除本地专属字段，只上传与模型交互过的内容。
    const transcript = normalizeMessagesForAPI(messages)

    // Collect subagent transcripts
// 子代理转录：从消息里提取代理 id 集合，再按 id 惰性加载各自的转录文件——主会话与子代理的对话是分开存的。
    const agentIds = extractAgentIdsFromMessages(messages)
    const subagentTranscripts = await loadSubagentTranscripts(agentIds)

    // Read raw JSONL transcript (with size guard to prevent OOM)
// 原始 JSONL 转录带大小护栏：先 stat 拿文件大小，超过 MAX_TRANSCRIPT_READ_BYTES 就跳过并记警告——防止小内存环境读超大转录导致 OOM。文件不存在也静默跳过。
    let rawTranscriptJsonl: string | undefined
    try {
      const transcriptPath = getTranscriptPath()
      const { size } = await stat(transcriptPath)
      if (size <= MAX_TRANSCRIPT_READ_BYTES) {
        rawTranscriptJsonl = await readFile(transcriptPath, 'utf-8')
      } else {
        logForDebugging(
          `Skipping raw transcript read: file too large (${size} bytes)`,
          { level: 'warn' },
        )
      }
    } catch {
      // File may not exist
    }

// payload 组装：无子代理转录时字段直接置 undefined，序列化后整个键消失，不给服务端发空对象。
    const data = {
      trigger,
      version: MACRO.VERSION,
      platform: process.platform,
      transcript,
      subagentTranscripts:
        Object.keys(subagentTranscripts).length > 0
          ? subagentTranscripts
          : undefined,
      rawTranscriptJsonl,
    }

// 脱敏在序列化之后统一做：redactSensitiveInfo 对整个 JSON 字符串跑一遍模式替换——先序列化再脱敏能覆盖所有嵌套层级，代价是无法区分字段上下文，所以模式必须保守。
    const content = redactSensitiveInfo(jsonStringify(data))

// 上传前先刷新 OAuth：30 秒超时的请求不该浪费在一个即将过期的 token 上。
    await checkAndRefreshOAuthTokenIfNeeded()

    const authResult = getAuthHeaders()
    if (authResult.error) {
      return { success: false }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': getUserAgent(),
      ...authResult.headers,
    }

// POST 到官方 API，30 秒超时。200 与 201 都算成功，返回服务端给的 transcript_id 供后续引用。
    const response = await axios.post(
      'https://api.anthropic.com/api/claude_code_shared_session_transcripts',
      { content, appearance_id: appearanceId },
      {
        headers,
        timeout: 30000,
      },
    )

    if (response.status === 200 || response.status === 201) {
      const result = response.data
      logForDebugging('Transcript shared successfully', { level: 'info' })
      return {
        success: true,
        transcriptId: result?.transcript_id,
      }
    }

    return { success: false }
  } catch (err) {
    logForDebugging(errorMessage(err), {
      level: 'error',
    })
    return { success: false }
  }
}
