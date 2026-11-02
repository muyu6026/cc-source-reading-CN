import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
// 模块总述：把单轮补全事件标准化后上报到 `tengu_unary_event`，覆盖接受、拒绝、响应三种事件与四类补全类型。

// CompletionType 四类补全事件枚举：单次/多次字符串替换、单文件写入、单次工具调用。
export type CompletionType =
  | 'str_replace_single'
  | 'str_replace_multi'
  | 'write_file_single'
  | 'tool_use_single'

// LogEvent 上报载荷形状：补全类型、事件类别，以及含语言名/消息ID/平台/可选反馈的 metadata。
type LogEvent = {
  completion_type: CompletionType
  event: 'accept' | 'reject' | 'response'
  metadata: {
    language_name: string | Promise<string>
    message_id: string
    platform: string
    hasFeedback?: boolean
  }
}

// logUnaryEvent：把事件各字段逐一 cast 成遥测元数据类型后交给 `logEvent` 上报，metadata 里语言名可能是 Promise 故先 await。
export async function logUnaryEvent(event: LogEvent): Promise<void> {
  logEvent('tengu_unary_event', {
    event:
      event.event as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    completion_type:
      event.completion_type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    language_name: (await event.metadata
      .language_name) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    message_id: event.metadata
      .message_id as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    platform: event.metadata
      .platform as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    ...(event.metadata.hasFeedback !== undefined && {
      hasFeedback: event.metadata.hasFeedback,
    }),
  })
// 结束 `logEvent` 调用：最后用条件展开补上可选的 `hasFeedback` 字段，其余必填字段已显式列出。
}
