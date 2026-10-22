/**
 * Upload BriefTool attachments to private_api so web viewers can preview them.
 *
 * When the repl bridge is active, attachment paths are meaningless to a web
 * viewer (they're on Claude's machine). We upload to /api/oauth/file_upload —
 * the same store MessageComposer/SpaceMessage render from — and stash the
 * returned file_uuid alongside the path. Web resolves file_uuid → preview;
 * desktop/local try path first.
 *
 * Best-effort: any failure (no token, bridge off, network error, 4xx) logs
 * debug and returns undefined. The attachment still carries {path, size,
 * isImage}, so local-terminal and same-machine-desktop render unaffected.
 */

// upload.ts：把 Brief 附件上传到 private_api，让 web 端查看器能预览。
// 本地路径对 web 查看器无意义（文件在 Claude 的机器上），上传后把 file_uuid
// 与 path 并存——web 用 uuid、桌面/本地优先用 path。全流程 best-effort：
// 任何失败（无令牌/桥未开/网络错/4xx）记 debug 日志返回 undefined，
// 附件仍带 {path, size, isImage}，本地渲染不受影响。
import { feature } from 'bun:bundle'
import axios from 'axios'
import { randomUUID } from 'crypto'
import { readFile } from 'fs/promises'
import { basename, extname } from 'path'
import { z } from 'zod/v4'

import {
  getBridgeAccessToken,
  getBridgeBaseUrlOverride,
} from '../../bridge/bridgeConfig.js'
import { getOauthConfig } from '../../constants/oauth.js'
import { logForDebugging } from '../../utils/debug.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { jsonStringify } from '../../utils/slowOperations.js'

// Matches the private_api backend limit
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024
// 30MB 上限，与 private_api 后端限制一致。

const UPLOAD_TIMEOUT_MS = 30_000
// 上传超时 30 秒。

// Backend dispatches on mime: image/* → upload_image_wrapped (writes
// PREVIEW/THUMBNAIL, no ORIGINAL), everything else → upload_generic_file
// (ORIGINAL only, no preview). Only whitelist raster formats the
// transcoder reliably handles — svg/bmp/ico risk a 400, and pdf routes
// to upload_pdf_file_wrapped which also skips ORIGINAL. Dispatch
// viewers use /preview for images and /contents for everything else,
// so images go image/* and the rest go octet-stream.
const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}
// MIME 白名单只留光栅图格式：后端按 mime 分流——image/* 走转码器产 PREVIEW/THUMBNAIL，
// 其他走通用文件（仅 ORIGINAL）。svg/bmp/ico 有 400 风险，pdf 另走不产 ORIGINAL 的通道；
// 查看器图片用 /preview、其余用 /contents，所以非图片一律 octet-stream。

function guessMimeType(filename: string): string {
  const ext = extname(filename).toLowerCase()
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}
// 不在白名单的扩展名统一 application/octet-stream（走通用文件通道）。

function debug(msg: string): void {
  logForDebugging(`[brief:upload] ${msg}`)
}

/**
 * Base URL for uploads. Must match the host the token is valid for.
 *
 * Subprocess hosts (cowork) pass ANTHROPIC_BASE_URL alongside
 * CLAUDE_CODE_OAUTH_TOKEN — prefer that since getOauthConfig() only
 * returns staging when USE_STAGING_OAUTH is set, which such hosts don't
 * set. Without this a staging token hits api.anthropic.com → 401 → silent
 * skip → web viewer sees inert cards with no file_uuid.
 */
function getBridgeBaseUrl(): string {
  return (
    getBridgeBaseUrlOverride() ??
    process.env.ANTHROPIC_BASE_URL ??
    getOauthConfig().BASE_API_URL
  )
}
// Base URL 三级回退：显式覆盖 > ANTHROPIC_BASE_URL 环境变量 > OAuth 配置默认值。
// 后者必须与令牌同源——子进程宿主（cowork）会同时传 ANTHROPIC_BASE_URL 与
// CLAUDE_CODE_OAUTH_TOKEN，而 getOauthConfig 只有设了 USE_STAGING_OAUTH 才返回 staging；
// 漏掉环境变量这级，staging 令牌打到 api.anthropic.com 会 401 → 静默跳过 →
// web 查看器看到没有 file_uuid 的死卡片。

// /api/oauth/file_upload returns one of ChatMessage{Image,Blob,Document}FileSchema.
// All share file_uuid; that's the only field we need.
const uploadResponseSchema = lazySchema(() =>
  z.object({ file_uuid: z.string() }),
)
// 响应 schema 只取 file_uuid——三个响应形状（Image/Blob/Document）都带它，
// 这是唯一需要的字段。

export type BriefUploadContext = {
  replBridgeEnabled: boolean
  signal?: AbortSignal
}

/**
 * Upload a single attachment. Returns file_uuid on success, undefined otherwise.
 * Every early-return is intentional graceful degradation.
 */
export async function uploadBriefAttachment(
  fullPath: string,
  size: number,
  ctx: BriefUploadContext,
): Promise<string | undefined> {
  // Positive pattern so bun:bundle eliminates the entire body from
  // non-BRIDGE_MODE builds (negative `if (!feature(...)) return` does not).
  if (feature('BRIDGE_MODE')) {
    if (!ctx.replBridgeEnabled) return undefined
// feature('BRIDGE_MODE') 正向包裹（负向 if-return 无法被 DCE 从非桥构建里剔除整段函数体）；
// 桥未开（replBridgeEnabled 为 false）直接放弃。

    if (size > MAX_UPLOAD_BYTES) {
      debug(`skip ${fullPath}: ${size} bytes exceeds ${MAX_UPLOAD_BYTES} limit`)
      return undefined
    }

    const token = getBridgeAccessToken()
    if (!token) {
      debug('skip: no oauth token')
      return undefined
    }
// 无 OAuth 令牌 → 放弃（debug 记录）。

    let content: Buffer
    try {
      content = await readFile(fullPath)
    } catch (e) {
      debug(`read failed for ${fullPath}: ${e}`)
      return undefined
    }

    const baseUrl = getBridgeBaseUrl()
    const url = `${baseUrl}/api/oauth/file_upload`
    const filename = basename(fullPath)
    const mimeType = guessMimeType(filename)
// 读文件、取文件名、按扩展名猜 mime、生成 multipart 边界。
    const boundary = `----FormBoundary${randomUUID()}`

    // Manual multipart — same pattern as filesApi.ts. The oauth endpoint takes
    // a single "file" part (no "purpose" field like the public Files API).
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
          `Content-Type: ${mimeType}\r\n\r\n`,
      ),
      content,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])
// 手工拼 multipart 体（与 filesApi.ts 同款）：oauth 端点只收单个 file part，
// 没有公共 Files API 的 purpose 字段。

    try {
      const response = await axios.post(url, body, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length.toString(),
        },
        timeout: UPLOAD_TIMEOUT_MS,
        signal: ctx.signal,
        validateStatus: () => true,
      })
// axios POST：Bearer 令牌、显式 Content-Length、30 秒超时、可中止信号；
// validateStatus 恒真——状态码自己判，不让 axios 抛异常。

      if (response.status !== 201) {
        debug(
          `upload failed for ${fullPath}: status=${response.status} body=${jsonStringify(response.data).slice(0, 200)}`,
        )
        return undefined
      }
// 201 才算成功；其他状态记前 200 字符响应体后放弃。

      const parsed = uploadResponseSchema().safeParse(response.data)
      if (!parsed.success) {
        debug(
          `unexpected response shape for ${fullPath}: ${parsed.error.message}`,
        )
        return undefined
      }

      debug(`uploaded ${fullPath} → ${parsed.data.file_uuid} (${size} bytes)`)
      return parsed.data.file_uuid
// schema 校验通过即返回 file_uuid；异常也走 catch 返回 undefined——
// 所有失败路径都归约到「无 uuid，本地照常渲染」。
    } catch (e) {
      debug(`upload threw for ${fullPath}: ${e}`)
      return undefined
    }
  }
  return undefined
}
