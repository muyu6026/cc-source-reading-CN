// 文件级：本文件处理从剪贴板读取图片——macOS 优先用原生 NSPasteboard 读取器（快），否则回退 osascript；Linux 用 xclip/wl-paste；Windows 用 PowerShell——并把粘贴的图片文件路径清洗、读取、缩放（压到 5MB API 上限）后转成 base64 返回。
import { feature } from 'bun:bundle'
import { randomBytes } from 'crypto'
import { execa } from 'execa'
import { basename, extname, isAbsolute, join } from 'path'
import {
  IMAGE_MAX_HEIGHT,
  IMAGE_MAX_WIDTH,
  IMAGE_TARGET_RAW_SIZE,
} from '../constants/apiLimits.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { getImageProcessor } from '../tools/FileReadTool/imageProcessor.js'
import { logForDebugging } from './debug.js'
import { execFileNoThrowWithCwd } from './execFileNoThrow.js'
import { getFsImplementation } from './fsOperations.js'
import {
  detectImageFormatFromBase64,
  type ImageDimensions,
  maybeResizeAndDownsampleImageBuffer,
} from './imageResizer.js'
import { logError } from './log.js'

// Native NSPasteboard reader. GrowthBook gate tengu_collage_kaleidoscope is
// a kill switch (default on). Falls through to osascript when off.
// The gate string is inlined at each callsite INSIDE the feature() condition
// — module-scope helpers are NOT tree-shaken (see docs/feature-gating.md).
// 原生 NSPasteboard 读取器由 GrowthBook 开关控制（默认开），关闭时回退 osascript；特性门字符串内联在每个调用点、不抽成模块级辅助，以免被打包工具误保留。

type SupportedPlatform = 'darwin' | 'linux' | 'win32'
// `SupportedPlatform`：支持的平台枚举，darwin / linux / win32。

// Threshold in characters for when to consider text a "large paste"
export const PASTE_THRESHOLD = 800
// `PASTE_THRESHOLD`：把文本判定为「大段粘贴」的字符阈值，超过走特殊处理。
// `getClipboardCommands`：按平台拼出临时截图路径与四组剪贴板命令（检查图片 / 保存图片 / 取路径 / 删文件），无对应平台时回退 Linux。
function getClipboardCommands() {
  const platform = process.platform as SupportedPlatform

  // Platform-specific temporary file paths
  // Use CLAUDE_CODE_TMPDIR if set, otherwise fall back to platform defaults
  const baseTmpDir =
    process.env.CLAUDE_CODE_TMPDIR ||
    (platform === 'win32' ? process.env.TEMP || 'C:\\Temp' : '/tmp')
// 临时目录取 `CLAUDE_CODE_TMPDIR`，未设则按平台回退（Windows 用 `TEMP` 或 `C:/Temp`，其他用 `/tmp`）。
  const screenshotFilename = 'claude_cli_latest_screenshot.png'
  const tempPaths: Record<SupportedPlatform, string> = {
    darwin: join(baseTmpDir, screenshotFilename),
    linux: join(baseTmpDir, screenshotFilename),
    win32: join(baseTmpDir, screenshotFilename),
  }

  const screenshotPath = tempPaths[platform] || tempPaths.linux
// 截图文件名统一为 `claude_cli_latest_screenshot.png`，按平台定位。

  // Platform-specific clipboard commands
  const commands: Record<
    SupportedPlatform,
    {
      checkImage: string
      saveImage: string
      getPath: string
      deleteFile: string
    }
  > = {
    darwin: {
      checkImage: `osascript -e 'the clipboard as «class PNGf»'`,
      saveImage: `osascript -e 'set png_data to (the clipboard as «class PNGf»)' -e 'set fp to open for access POSIX file "${screenshotPath}" with write permission' -e 'write png_data to fp' -e 'close access fp'`,
      getPath: `osascript -e 'get POSIX path of (the clipboard as «class furl»)'`,
      deleteFile: `rm -f "${screenshotPath}"`,
    },
// macOS 用 osascript 把剪贴板的 PNG 类数据写出到临时文件。
    linux: {
      checkImage:
        'xclip -selection clipboard -t TARGETS -o 2>/dev/null | grep -E "image/(png|jpeg|jpg|gif|webp|bmp)" || wl-paste -l 2>/dev/null | grep -E "image/(png|jpeg|jpg|gif|webp|bmp)"',
      saveImage: `xclip -selection clipboard -t image/png -o > "${screenshotPath}" 2>/dev/null || wl-paste --type image/png > "${screenshotPath}" 2>/dev/null || xclip -selection clipboard -t image/bmp -o > "${screenshotPath}" 2>/dev/null || wl-paste --type image/bmp > "${screenshotPath}"`,
      getPath:
        'xclip -selection clipboard -t text/plain -o 2>/dev/null || wl-paste 2>/dev/null',
      deleteFile: `rm -f "${screenshotPath}"`,
    },
// Linux 用 xclip 或 wl-paste，按 png/bmp 依次尝试保存。
    win32: {
      checkImage:
        'powershell -NoProfile -Command "(Get-Clipboard -Format Image) -ne $null"',
      saveImage: `powershell -NoProfile -Command "$img = Get-Clipboard -Format Image; if ($img) { $img.Save('${screenshotPath.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png) }"`,
      getPath: 'powershell -NoProfile -Command "Get-Clipboard"',
      deleteFile: `del /f "${screenshotPath}"`,
    },
// Windows 用 PowerShell 的 `Get-Clipboard -Format Image` 取图并存成 PNG。
  }

  return {
    commands: commands[platform] || commands.linux,
    screenshotPath,
  }
}

export type ImageWithDimensions = {
// `ImageWithDimensions`：图片数据形态，含 base64、媒体类型与可选尺寸信息。
  base64: string
  mediaType: string
  dimensions?: ImageDimensions
}

/**
 * Check if clipboard contains an image without retrieving it.
 */
// `hasImageInClipboard`：不取图只判断剪贴板是否有图片；非 macOS 直接返回否，macOS 先试原生快速检查再回退 osascript。
export async function hasImageInClipboard(): Promise<boolean> {
  if (process.platform !== 'darwin') {
    return false
  }
  if (
    feature('NATIVE_CLIPBOARD_IMAGE') &&
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_collage_kaleidoscope', true)
  ) {
// 原生 NSPasteboard 检查约 0.03ms，模块缺失或抛错时回退 osascript。
    // Native NSPasteboard check (~0.03ms warm). Fall through to osascript
    // when the module/export is missing. Catch a throw too: it would surface
    // as an unhandled rejection in useClipboardImageHint's setTimeout.
    try {
      const { getNativeModule } = await import('image-processor-napi')
      const hasImage = getNativeModule()?.hasClipboardImage
      if (hasImage) {
        return hasImage()
      }
    } catch (e) {
      logError(e as Error)
    }
  }
  const result = await execFileNoThrowWithCwd('osascript', [
// osascript 回退：直接询问剪贴板是否含 PNG 类数据，退出码 0 即视为有图。
    '-e',
    'the clipboard as «class PNGf»',
  ])
  return result.code === 0
}

// `getImageFromClipboard`：从剪贴板取图片，macOS 走原生快速路径（进程内读 PNG 字节、超尺寸时由 CoreGraphics 下采样），不可用时回退 osascript 保存再读。
export async function getImageFromClipboard(): Promise<ImageWithDimensions | null> {
  // Fast path: native NSPasteboard reader (macOS only). Reads PNG bytes
  // directly in-process and downsamples via CoreGraphics if over the
  // dimension cap. ~5ms cold, sub-ms warm — vs. ~1.5s for the osascript
  // path below. Throws if the native module is unavailable, in which case
  // the catch block falls through to osascript. A `null` return from the
  // native call is authoritative (clipboard has no image).
  if (
    feature('NATIVE_CLIPBOARD_IMAGE') &&
    process.platform === 'darwin' &&
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_collage_kaleidoscope', true)
  ) {
// 原生路径开关：需特性开启、平台为 macOS 且开关为真才走原生读取。
    try {
      const { getNativeModule } = await import('image-processor-napi')
      const readClipboard = getNativeModule()?.readClipboardImage
      if (!readClipboard) {
        throw new Error('native clipboard reader unavailable')
      }
      const native = readClipboard(IMAGE_MAX_WIDTH, IMAGE_MAX_HEIGHT)
// 原生读取按最大宽高取图，返回的 PNG 可能仍超尺寸上限，需二次处理。
      if (!native) {
        return null
      }
      // The native path caps dimensions but not file size. A complex
      // 2000×2000 PNG can still exceed the 3.75MB raw / 5MB base64 API
      // limit — for that edge case, run through the same size-cap that
      // the osascript path uses (degrades to JPEG if needed). Cheap if
      // already under: just a sharp metadata read.
      const buffer: Buffer = native.png
      if (buffer.length > IMAGE_TARGET_RAW_SIZE) {
// 原生路径只限尺寸不限大小，超大 PNG 再走 osascript 同款的缩放兜底（必要时降级成 JPEG）。
        const resized = await maybeResizeAndDownsampleImageBuffer(
          buffer,
          buffer.length,
          'png',
        )
        return {
          base64: resized.buffer.toString('base64'),
          mediaType: `image/${resized.mediaType}`,
          // resized.dimensions sees the already-downsampled buffer; native knows the true originals.
          dimensions: {
            originalWidth: native.originalWidth,
            originalHeight: native.originalHeight,
            displayWidth: resized.dimensions?.displayWidth ?? native.width,
            displayHeight: resized.dimensions?.displayHeight ?? native.height,
          },
        }
      }
      return {
        base64: buffer.toString('base64'),
        mediaType: 'image/png',
        dimensions: {
          originalWidth: native.originalWidth,
          originalHeight: native.originalHeight,
          displayWidth: native.width,
          displayHeight: native.height,
        },
      }
// 未超尺寸时直接返回原图 base64，并记录原始与显示尺寸。
    } catch (e) {
      logError(e as Error)
      // Fall through to osascript fallback.
    }
  }

  const { commands, screenshotPath } = getClipboardCommands()
// 回退路径：取出平台命令与临时截图路径，走命令行读图。
  try {
    // Check if clipboard has image
    const checkResult = await execa(commands.checkImage, {
      shell: true,
      reject: false,
    })
// 先查剪贴板是否含图片，退出码非 0 直接返回空。
    if (checkResult.exitCode !== 0) {
      return null
    }

    // Save the image
    const saveResult = await execa(commands.saveImage, {
      shell: true,
      reject: false,
    })
// 把剪贴板图片保存到临时文件，保存失败返回空。
    if (saveResult.exitCode !== 0) {
      return null
    }

    // Read the image and convert to base64
    let imageBuffer = getFsImplementation().readFileBytesSync(screenshotPath)
// 从临时文件读图片字节。

    // BMP is not supported by the API — convert to PNG via Sharp.
    // This handles WSL2 where Windows copies images as BMP by default.
    if (
      imageBuffer.length >= 2 &&
      imageBuffer[0] === 0x42 &&
      imageBuffer[1] === 0x4d
    ) {
      const sharp = await getImageProcessor()
      imageBuffer = await sharp(imageBuffer).png().toBuffer()
    }
// BMP 不被 API 支持，用 Sharp 转成 PNG（覆盖 WSL2 里 Windows 默认复制 BMP 的情形）。

    // Resize if needed to stay under 5MB API limit
    const resized = await maybeResizeAndDownsampleImageBuffer(
// 按需缩放/下采样，把图片压到 5MB API 上限以下。
      imageBuffer,
      imageBuffer.length,
      'png',
    )
    const base64Image = resized.buffer.toString('base64')

    // Detect format from magic bytes
    const mediaType = detectImageFormatFromBase64(base64Image)
// 用 magic bytes 探测真实媒体类型，再即发即弃地删掉临时文件。

    // Cleanup (fire-and-forget, don't await)
    void execa(commands.deleteFile, { shell: true, reject: false })

    return {
      base64: base64Image,
      mediaType,
      dimensions: resized.dimensions,
    }
  } catch {
    return null
  }
}

// `getImagePathFromClipboard`：从剪贴板取文本路径（如拖入文件时的路径），失败返回空。
export async function getImagePathFromClipboard(): Promise<string | null> {
  const { commands } = getClipboardCommands()

  try {
    // Try to get text from clipboard
    const result = await execa(commands.getPath, {
      shell: true,
      reject: false,
    })
// 用平台取路径命令拿剪贴板文本，清空或失败返回空。
    if (result.exitCode !== 0 || !result.stdout) {
      return null
    }
    return result.stdout.trim()
  } catch (e) {
    logError(e as Error)
    return null
  }
}

/**
 * Regex pattern to match supported image file extensions. Kept in sync with
 * MIME_BY_EXT in BriefTool/upload.ts — attachments.ts uses this to set isImage
 * on the wire, and remote viewers fetch /preview iff isImage is true. An ext
 * here but not in MIME_BY_EXT (e.g. bmp) uploads as octet-stream and has no
 * /preview variant → broken thumbnail.
 */
export const IMAGE_EXTENSION_REGEX = /\.(png|jpe?g|gif|webp)$/i
// `IMAGE_EXTENSION_REGEX`：匹配受支持图片扩展名的正则（png/jpg/gif/webp），需与上传处的 MIME 表保持一致，否则缩略图会断。

/**
 * Remove outer single or double quotes from a string
 * @param text Text to clean
 * @returns Text without outer quotes
 */
// `removeOuterQuotes`：去掉字符串首尾的成对单引号或双引号。
function removeOuterQuotes(text: string): string {
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1)
  }
  return text
}

/**
 * Remove shell escape backslashes from a path (for macOS/Linux/WSL)
 * On Windows systems, this function returns the path unchanged
 * @param path Path that might contain shell-escaped characters
 * @returns Path with escape backslashes removed (on macOS/Linux/WSL only)
 */
// `stripBackslashEscapes`：去掉路径里的 shell 转义反斜杠（macOS/Linux/WSL）；Windows 上反斜杠是路径一部分，原样返回。
function stripBackslashEscapes(path: string): string {
  const platform = process.platform as SupportedPlatform

  // On Windows, don't remove backslashes as they're part of the path
  if (platform === 'win32') {
// Windows 不处理反斜杠，避免误删路径分隔符。
    return path
  }

  // On macOS/Linux/WSL, handle shell-escaped paths
  // Double-backslashes (\\) represent actual backslashes in the filename
  // Single backslashes followed by special chars are shell escapes

  // First, temporarily replace double backslashes with a placeholder
  // Use random salt to prevent injection attacks where path contains literal placeholder
  const salt = randomBytes(8).toString('hex')
// 用随机盐生成占位符，防止路径里恰含占位串而被注入。
  const placeholder = `__DOUBLE_BACKSLASH_${salt}__`
  const withPlaceholder = path.replace(/\\\\/g, placeholder)
// 先把双反斜杠暂存成占位符，再去掉单反斜杠的 shell 转义，最后把占位符还原成单反斜杠。

  // Remove single backslashes that are shell escapes
  // This handles cases like "name\ \(15\).png" -> "name (15).png"
  const withoutEscapes = withPlaceholder.replace(/\\(.)/g, '$1')

  // Replace placeholders back to single backslashes
  return withoutEscapes.replace(new RegExp(placeholder, 'g'), '\\')
}

/**
 * Check if a given text represents an image file path
 * @param text Text to check
 * @returns Boolean indicating if text is an image path
 */
// `isImageFilePath`：清洗引号与转义后，用扩展名正则判断文本是否为图片路径。
export function isImageFilePath(text: string): boolean {
  const cleaned = removeOuterQuotes(text.trim())
  const unescaped = stripBackslashEscapes(cleaned)
  return IMAGE_EXTENSION_REGEX.test(unescaped)
}

/**
 * Clean and normalize a text string that might be an image file path
 * @param text Text to process
 * @returns Cleaned text with quotes removed, whitespace trimmed, and shell escapes removed, or null if not an image path
 */
// `asImageFilePath`：同上的清洗，但只在确为图片路径时返回规范化路径，否则返回 `null`。
export function asImageFilePath(text: string): string | null {
  const cleaned = removeOuterQuotes(text.trim())
  const unescaped = stripBackslashEscapes(cleaned)

  if (IMAGE_EXTENSION_REGEX.test(unescaped)) {
    return unescaped
  }

  return null
}

/**
 * Try to find and read an image file, falling back to clipboard search
 * @param text Pasted text that might be an image filename or path
 * @returns Object containing the image path and base64 data, or null if not found
 */
// `tryReadImageFromPath`：把粘贴文本当图片文件名/路径去读图，读不到再回退查剪贴板里的图片路径。
export async function tryReadImageFromPath(
  text: string,
): Promise<(ImageWithDimensions & { path: string }) | null> {
  // Strip terminal added spaces or quotes to dragged in paths
  const cleanedPath = asImageFilePath(text)
// 先清洗出可能的图片路径，清洗后仍非图片扩展名就返回空。

  if (!cleanedPath) {
    return null
  }

  const imagePath = cleanedPath
  let imageBuffer

  try {
    if (isAbsolute(imagePath)) {
// 绝对路径直接读；相对路径时（VSCode 终端只给文件名）比对剪贴板图片文件名，命中就读剪贴板那张。
      imageBuffer = getFsImplementation().readFileBytesSync(imagePath)
    } else {
      // VSCode Terminal just grabs the text content which is the filename
      // instead of getting the full path of the file pasted with cmd-v. So
      // we check if it matches the filename of the image in the clipboard.
      const clipboardPath = await getImagePathFromClipboard()
      if (clipboardPath && imagePath === basename(clipboardPath)) {
        imageBuffer = getFsImplementation().readFileBytesSync(clipboardPath)
      }
    }
  } catch (e) {
    logError(e as Error)
    return null
  }
  if (!imageBuffer) {
    return null
  }
  if (imageBuffer.length === 0) {
// 读到的图片为空时记警告并返回空。
    logForDebugging(`Image file is empty: ${imagePath}`, { level: 'warn' })
    return null
  }

  // BMP is not supported by the API — convert to PNG via Sharp.
  if (
    imageBuffer.length >= 2 &&
    imageBuffer[0] === 0x42 &&
    imageBuffer[1] === 0x4d
  ) {
    const sharp = await getImageProcessor()
    imageBuffer = await sharp(imageBuffer).png().toBuffer()
  }
// 同样是 BMP 转 PNG 的兜底处理。

  // Resize if needed to stay under 5MB API limit
  // Extract extension from path for format hint
  const ext = extname(imagePath).slice(1).toLowerCase() || 'png'
// 从路径取扩展名作为格式提示（缺省 png），再缩放并压到 API 上限。
  const resized = await maybeResizeAndDownsampleImageBuffer(
    imageBuffer,
    imageBuffer.length,
    ext,
  )
  const base64Image = resized.buffer.toString('base64')

  // Detect format from the actual file contents using magic bytes
  const mediaType = detectImageFormatFromBase64(base64Image)
// 用 magic bytes 探测真实媒体类型后返回路径、base64 与尺寸。
  return {
    path: imagePath,
    base64: base64Image,
    mediaType,
    dimensions: resized.dimensions,
  }
}
