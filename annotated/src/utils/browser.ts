// 本文件负责用系统默认处理器打开文件/文件夹，以及用系统默认浏览器打开 URL。内部依赖 `execFileNoThrow` 调用平台命令。
import { execFileNoThrow } from './execFileNoThrow.js'

// `validateUrl` 校验 URL 字符串是否合法：先尝试 `new URL` 解析，再强制协议只能是 `http:` 或 `https:`，否则抛错。
function validateUrl(url: string): void {
  let parsedUrl: URL

  try {
    parsedUrl = new URL(url)
  } catch (_error) {
    throw new Error(`Invalid URL format: ${url}`)
  }

  // Validate URL protocol for security
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error(
      `Invalid URL protocol: must use http:// or https://, got ${parsedUrl.protocol}`,
    )
  }
}

/**
 * Open a file or folder path using the system's default handler.
 * Uses `open` on macOS, `explorer` on Windows, `xdg-open` on Linux.
 */
// `openPath` 用系统默认程序打开本地路径：Windows 调 `explorer`，macOS 调 `open`，Linux 调 `xdg-open`；任一命令失败或被异常拦截都返回 `false`。
export async function openPath(path: string): Promise<boolean> {
  try {
    const platform = process.platform
    if (platform === 'win32') {
      const { code } = await execFileNoThrow('explorer', [path])
      return code === 0
    }
    const command = platform === 'darwin' ? 'open' : 'xdg-open'
    const { code } = await execFileNoThrow(command, [path])
    return code === 0
  } catch (_) {
    return false
  }
}

// `openBrowser` 在已校验 URL 后用默认浏览器打开：Windows 优先用 `BROWSER` 环境变量（需经 shell 否则被当成 `file:///` 路径），否则回退 `rundll32`；其余平台用 `BROWSER` 或 `open`/`xdg-open`。
export async function openBrowser(url: string): Promise<boolean> {
  try {
    // Parse and validate the URL
    validateUrl(url)

    const browserEnv = process.env.BROWSER
    const platform = process.platform

    if (platform === 'win32') {
      if (browserEnv) {
        // browsers require shell, else they will treat this as a file:/// handle
        const { code } = await execFileNoThrow(browserEnv, [`"${url}"`])
        return code === 0
      }
      const { code } = await execFileNoThrow(
        'rundll32',
        ['url,OpenURL', url],
        {},
      )
      return code === 0
    } else {
      const command =
        browserEnv || (platform === 'darwin' ? 'open' : 'xdg-open')
      const { code } = await execFileNoThrow(command, [url])
      return code === 0
    }
  } catch (_) {
    return false
  }
}
