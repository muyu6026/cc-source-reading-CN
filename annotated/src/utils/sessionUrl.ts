// 本文件解析会话恢复标识符：可能是包含会话 ID 的 URL，也可能是裸 UUID，还可能是本地 JSONL 文件路径。
import { randomUUID, type UUID } from 'crypto'
import { validateUuid } from './uuid.js'

// `ParsedSessionUrl` 描述解析结果：会话 ID、入口 URL、是否 URL、JSONL 文件路径、是否 JSONL 文件。
export type ParsedSessionUrl = {
  sessionId: UUID
  ingressUrl: string | null
  isUrl: boolean
  jsonlFile: string | null
  isJsonlFile: boolean
}

/**
 * Parses a session resume identifier which can be either:
 * - A URL containing session ID (e.g., https://api.example.com/v1/session_ingress/session/550e8400-e29b-41d4-a716-446655440000)
 * - A plain session ID (UUID)
 *
 * @param resumeIdentifier - The URL or session ID to parse
 * @returns Parsed session information or null if invalid
 */
// `parseSessionIdentifier` 主解析函数：依次尝试 JSONL 文件路径、裸 UUID、URL 三种形式，全都不匹配返回 `null`。
export function parseSessionIdentifier(
  resumeIdentifier: string,
): ParsedSessionUrl | null {
  // Check for JSONL file path before URL parsing, since Windows absolute
  // paths (e.g., C:\path\file.jsonl) are parsed as valid URLs with C: as protocol
  if (resumeIdentifier.toLowerCase().endsWith('.jsonl')) {
// 先判断是否为 JSONL 文件路径：Windows 绝对路径（如 `C:` 盘下的 jsonl 文件）会被 `URL` 解析成以 `C:` 为协议的有效地址，因此必须在 URL 解析之前先处理 JSONL。匹配时随机生成会话 ID 并标记为 JSONL 文件。
    return {
      sessionId: randomUUID() as UUID,
      ingressUrl: null,
      isUrl: false,
      jsonlFile: resumeIdentifier,
      isJsonlFile: true,
    }
  }

  // Check if it's a plain UUID
  if (validateUuid(resumeIdentifier)) {
// 接着判断是否为裸 UUID：用 `validateUuid` 校验，匹配时把该 UUID 作为会话 ID，无入口 URL。
    return {
      sessionId: resumeIdentifier as UUID,
      ingressUrl: null,
      isUrl: false,
      jsonlFile: null,
      isJsonlFile: false,
    }
  }

  // Check if it's a URL
  try {
    const url = new URL(resumeIdentifier)
// 最后尝试按 URL 解析：成功时用整条 URL 作为入口地址，并随机生成会话 ID；解析失败则落入末尾返回 `null`。

    // Use the entire URL as the ingress URL
    // Always generate a random session ID
    return {
      sessionId: randomUUID() as UUID,
      ingressUrl: url.href,
      isUrl: true,
      jsonlFile: null,
      isJsonlFile: false,
    }
  } catch {
    // Not a valid URL
  }

  return null
}
