import { jsonStringify } from '../utils/slowOperations.js'

// JSON.stringify emits U+2028/U+2029 raw (valid per ECMA-404). When the
// output is a single NDJSON line, any receiver that uses JavaScript
// line-terminator semantics (ECMA-262 §11.3 — \n \r U+2028 U+2029) to
// split the stream will cut the JSON mid-string. ProcessTransport now
// silently skips non-JSON lines rather than crashing (gh-28405), but
// the truncated fragment is still lost — the message is silently dropped.
//
// The \uXXXX form is equivalent JSON (parses to the same string) but
// can never be mistaken for a line terminator by ANY receiver. This is
// what ES2019's "Subsume JSON" proposal and Node's util.inspect do.
//
// Single regex with alternation: the callback's one dispatch per match
// is cheaper than two full-string scans.
// 为什么需要这个文件：JSON.stringify 会原样输出 U+2028 与 U+2029，而按行切割 NDJSON 的接收方（遵循 ECMA-262 换行语义）会把它当成换行，把一条 JSON 从字符串中间切断。改用转义序列后语义不变，但任何接收方都不会再误判为换行。
const JS_LINE_TERMINATORS = /\u2028|\u2029/g
// 匹配 U+2028 行分隔符与 U+2029 段分隔符的正则（两者在 JSON 里合法，但会被按行分割的接收方误判为换行）。

function escapeJsLineTerminators(json: string): string {
// 把这两种字符转义成对应的转义序列——与原文语义完全等价，但按行切的接收方不会再切错。用单条带 alternation 的正则，比两次全串扫描更省。
  return json.replace(JS_LINE_TERMINATORS, c =>
    c === '\u2028' ? '\\u2028' : '\\u2029',
  )
}

/**
 * JSON.stringify for one-message-per-line transports. Escapes U+2028
 * LINE SEPARATOR and U+2029 PARAGRAPH SEPARATOR so the serialized output
 * cannot be broken by a line-splitting receiver. Output is still valid
 * JSON and parses to the same value.
 */
export function ndjsonSafeStringify(value: unknown): string {
// 对外暴露的安全序列化入口：先转义行终结符再做 JSON 序列化，保证一行一条消息的传输不会被切断，且输出仍是合法 JSON。
  return escapeJsLineTerminators(jsonStringify(value))
}
