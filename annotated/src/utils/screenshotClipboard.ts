import { mkdir, unlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { type AnsiToPngOptions, ansiToPng } from './ansiToPng.js'
import { execFileNoThrowWithCwd } from './execFileNoThrow.js'
import { logError } from './log.js'
import { getPlatform } from './platform.js'

// 截图写入剪贴板：把 ANSI 文本经纯 TS 管线渲染成 PNG 后复制到系统剪贴板，支持 macOS、Linux 与 Windows，无需 WASM 或系统字体。
/**
 * Copies an image (from ANSI text) to the system clipboard.
 * Supports macOS, Linux (with xclip/xsel), and Windows.
 *
 * Pure-TS pipeline: ANSI text → bitmap-font render → PNG encode. No WASM,
 * no system fonts, so this works in every build (native and JS).
 */
export async function copyAnsiToClipboard(
  ansiText: string,
  options?: AnsiToPngOptions,
): Promise<{ success: boolean; message: string }> {
// copyAnsiToClipboard 签名：把 ANSI 文本渲染为 PNG 并复制到剪贴板，返回成功与否与消息。
  try {
    const tempDir = join(tmpdir(), 'claude-code-screenshots')
    await mkdir(tempDir, { recursive: true })

    const pngPath = join(tempDir, `screenshot-${Date.now()}.png`)
    const pngBuffer = ansiToPng(ansiText, options)
    await writeFile(pngPath, pngBuffer)

    const result = await copyPngToClipboard(pngPath)

    try {
      await unlink(pngPath)
    } catch {
      // Ignore cleanup errors
    }

    return result
  } catch (error) {
    logError(error)
    return {
      success: false,
      message: `Failed to copy screenshot: ${error instanceof Error ? error.message : 'Unknown error'}`,
    }
  }
}
// copyAnsiToClipboard 收尾：先渲染写盘，再复制，最后清理临时 PNG，任何异常都记录并返回失败消息。

async function copyPngToClipboard(
  pngPath: string,
): Promise<{ success: boolean; message: string }> {
// copyPngToClipboard 签名：按运行平台选择对应的剪贴板写入方式。
  const platform = getPlatform()

  if (platform === 'macos') {
    // macOS: Use osascript to copy PNG to clipboard
    // Escape backslashes and double quotes for AppleScript string
    const escapedPath = pngPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    const script = `set the clipboard to (read (POSIX file "${escapedPath}") as «class PNGf»)`
    const result = await execFileNoThrowWithCwd('osascript', ['-e', script], {
      timeout: 5000,
    })

    if (result.code === 0) {
      return { success: true, message: 'Screenshot copied to clipboard' }
    }
    return {
      success: false,
      message: `Failed to copy to clipboard: ${result.stderr}`,
    }
  }
// macOS 分支：用 osascript 把 PNG 以 PNGf 类型读入剪贴板。

  if (platform === 'linux') {
    // Linux: Try xclip first, then xsel
    const xclipResult = await execFileNoThrowWithCwd(
      'xclip',
      ['-selection', 'clipboard', '-t', 'image/png', '-i', pngPath],
      { timeout: 5000 },
    )

    if (xclipResult.code === 0) {
      return { success: true, message: 'Screenshot copied to clipboard' }
    }

    // Try xsel as fallback
    const xselResult = await execFileNoThrowWithCwd(
      'xsel',
      ['--clipboard', '--input', '--type', 'image/png'],
      { timeout: 5000 },
    )

    if (xselResult.code === 0) {
      return { success: true, message: 'Screenshot copied to clipboard' }
    }

    return {
      success: false,
      message:
        'Failed to copy to clipboard. Please install xclip or xsel: sudo apt install xclip',
    }
  }
// Linux 分支：优先 xclip，失败再回退 xsel，二者皆失败则提示安装 xclip。

  if (platform === 'windows') {
    // Windows: Use PowerShell to copy image to clipboard
    const psScript = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::SetImage([System.Drawing.Image]::FromFile('${pngPath.replace(/'/g, "''")}'))`
    const result = await execFileNoThrowWithCwd(
      'powershell',
      ['-NoProfile', '-Command', psScript],
      { timeout: 5000 },
    )

    if (result.code === 0) {
      return { success: true, message: 'Screenshot copied to clipboard' }
    }
    return {
      success: false,
      message: `Failed to copy to clipboard: ${result.stderr}`,
    }
  }
// Windows 分支：用 PowerShell 调用 System.Windows.Forms.Clipboard 设置图片。

  return {
    success: false,
    message: `Screenshot to clipboard is not supported on ${platform}`,
  }
}
// 对不支持的平台返回失败消息，结束剪贴板复制流程。
