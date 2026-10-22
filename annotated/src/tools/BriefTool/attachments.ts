/**
 * Shared attachment validation + resolution for SendUserMessage and
 * SendUserFile. Lives in BriefTool/ so the dynamic `./upload.js` import
 * inside the feature('BRIDGE_MODE') guard stays relative and upload.ts
 * (axios, crypto, auth utils) remains tree-shakeable from non-bridge builds.
 */

// attachments.ts：SendUserMessage 与 SendUserFile 共用的附件校验+解析。
// 放在 BriefTool/ 目录是为了让 feature('BRIDGE_MODE') 守卫里的动态 import('./upload.js')
// 保持相对路径——upload.ts（axios、crypto、认证工具）得以从非桥构建中 tree-shake 掉。
import { feature } from 'bun:bundle'
import { stat } from 'fs/promises'

import type { ValidationResult } from '../../Tool.js'

import { getCwd } from '../../utils/cwd.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { getErrnoCode } from '../../utils/errors.js'
import { IMAGE_EXTENSION_REGEX } from '../../utils/imagePaste.js'
import { expandPath } from '../../utils/path.js'

export type ResolvedAttachment = {
  path: string
  size: number
  isImage: boolean
  file_uuid?: string
}
// ResolvedAttachment：本地渲染所需的四元组；file_uuid 仅桥接上传成功时存在。

export async function validateAttachmentPaths(
  rawPaths: string[],
): Promise<ValidationResult> {
  const cwd = getCwd()
  for (const rawPath of rawPaths) {
    const fullPath = expandPath(rawPath)
    try {
      const stats = await stat(fullPath)
      if (!stats.isFile()) {
        return {
          result: false,
          message: `Attachment "${rawPath}" is not a regular file.`,
          errorCode: 1,
        }
      }
    } catch (e) {
      const code = getErrnoCode(e)
      if (code === 'ENOENT') {
        return {
          result: false,
          message: `Attachment "${rawPath}" does not exist. Current working directory: ${cwd}.`,
          errorCode: 1,
        }
      }
      if (code === 'EACCES' || code === 'EPERM') {
        return {
          result: false,
          message: `Attachment "${rawPath}" is not accessible (permission denied).`,
          errorCode: 1,
        }
      }
      throw e
    }
  }
  return { result: true }
}
// validateAttachmentPaths：逐个 stat 校验——非常规文件（目录等）、不存在（附当前 cwd
// 提示）、无权限（EACCES/EPERM）各给明确文案；其他 errno 原样上抛。

export async function resolveAttachments(
  rawPaths: string[],
  uploadCtx: { replBridgeEnabled: boolean; signal?: AbortSignal },
): Promise<ResolvedAttachment[]> {
  // Stat serially (local, fast) to keep ordering deterministic, then upload
  // in parallel (network, slow). Upload failures resolve undefined — the
  // attachment still carries {path, size, isImage} for local renderers.
  const stated: ResolvedAttachment[] = []
  for (const rawPath of rawPaths) {
    const fullPath = expandPath(rawPath)
    // Single stat — we need size, so this is the operation, not a guard.
    // validateInput ran before us, but the file could have moved since
    // (TOCTOU); if it did, let the error propagate so the model sees it.
    const stats = await stat(fullPath)
    stated.push({
      path: fullPath,
      size: stats.size,
      isImage: IMAGE_EXTENSION_REGEX.test(fullPath),
    })
  }
// stat 串行执行（本地快）保证顺序确定；这里 stat 是主操作不是守卫——要取 size。
// validateInput 刚跑过但文件可能已被移走（TOCTOU），错了就让错误传播给模型看。
  // Dynamic import inside the feature() guard so upload.ts (axios, crypto,
  // zod, auth utils, MIME map) is fully eliminated from non-BRIDGE_MODE
  // builds. A static import would force module-scope evaluation regardless
  // of the guard inside uploadBriefAttachment — CLAUDE.md: "helpers defined
  // outside remain in the build even if never called".
  if (feature('BRIDGE_MODE')) {
    // Headless/SDK callers never set appState.replBridgeEnabled (only the TTY
    // REPL does, at main.tsx init). CLAUDE_CODE_BRIEF_UPLOAD lets a host that
    // runs the CLI as a subprocess opt in — e.g. the cowork desktop bridge,
    // which already passes CLAUDE_CODE_OAUTH_TOKEN for auth.
    const shouldUpload =
      uploadCtx.replBridgeEnabled ||
      isEnvTruthy(process.env.CLAUDE_CODE_BRIEF_UPLOAD)
// 无头/SDK 调用方不会设 replBridgeEnabled（只有 TTY REPL 在 main.tsx 初始化时设）；
// CLAUDE_CODE_BRIEF_UPLOAD 让把 CLI 当子进程跑的宿主显式开启上传——
// 比如 cowork 桌面桥（它已传 CLAUDE_CODE_OAUTH_TOKEN 做认证）。
    const { uploadBriefAttachment } = await import('./upload.js')
// 动态 import 放在 feature() 守卫内：upload.ts（axios/crypto/zod/auth/MIME 表）
// 在非 BRIDGE_MODE 构建里被整体剔除。静态 import 会强制模块级求值，
// 守卫内的 feature 检查救不了它（CLAUDE.md：守卫外定义的 helper 即使不被调用也留在构建产物里）。
    const uuids = await Promise.all(
      stated.map(a =>
        uploadBriefAttachment(a.path, a.size, {
          replBridgeEnabled: shouldUpload,
          signal: uploadCtx.signal,
        }),
      ),
    )
    return stated.map((a, i) =>
      uuids[i] === undefined ? a : { ...a, file_uuid: uuids[i] },
    )
// 上传并行（网络慢）；失败的槽位 uuid 为 undefined，原样保留 {path, size, isImage}。
  }
  return stated
// 非桥构建：直接返回 stat 结果，无上传环节。
}
