import { readdir, readFile, stat } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import {
  type McpServerConfig,
  McpStdioServerConfigSchema,
} from '../services/mcp/types.js'
import { getErrnoCode } from './errors.js'
import { safeParseJSON } from './json.js'
import { logError } from './log.js'
import { getPlatform, SUPPORTED_PLATFORMS } from './platform.js'

// 本模块桥接 Claude Code 与 Claude Desktop 的 MCP 配置：仅在 macOS 与 WSL 上可用，负责定位并读取 claude_desktop_config.json。
export async function getClaudeDesktopConfigPath(): Promise<string> {
  const platform = getPlatform()

  if (!SUPPORTED_PLATFORMS.includes(platform)) {
    throw new Error(
      `Unsupported platform: ${platform} - Claude Desktop integration only works on macOS and WSL.`,
    )
  }

  if (platform === 'macos') {
    return join(
      homedir(),
      'Library',
      'Application Support',
      'Claude',
      'claude_desktop_config.json',
    )
  }

  // First, try using USERPROFILE environment variable if available
  const windowsHome = process.env.USERPROFILE
    ? process.env.USERPROFILE.replace(/\\/g, '/') // Convert Windows backslashes to forward slashes
    : null

  if (windowsHome) {
    // Remove drive letter and convert to WSL path format
    const wslPath = windowsHome.replace(/^[A-Z]:/, '')
    const configPath = `/mnt/c${wslPath}/AppData/Roaming/Claude/claude_desktop_config.json`
// 将 Windows 用户目录改写为 WSL 风格路径（去掉盘符、反斜杠转斜杠），拼出 /mnt/c 下的配置路径并校验存在性。

    // Check if the file exists
    try {
      await stat(configPath)
      return configPath
    } catch {
      // File doesn't exist, continue
    }
  }

  // Alternative approach - try to construct path based on typical Windows user location
  try {
    // List the /mnt/c/Users directory to find potential user directories
    const usersDir = '/mnt/c/Users'

    try {
      const userDirs = await readdir(usersDir, { withFileTypes: true })

      // Look for Claude Desktop config in each user directory
      for (const user of userDirs) {
        if (
          user.name === 'Public' ||
          user.name === 'Default' ||
          user.name === 'Default User' ||
          user.name === 'All Users'
        ) {
          continue // Skip system directories
        }
// 枚举 /mnt/c/Users 时跳过系统目录（Public、Default 等），避免误读其他用户的配置。

        const potentialConfigPath = join(
          usersDir,
          user.name,
          'AppData',
          'Roaming',
          'Claude',
          'claude_desktop_config.json',
        )

        try {
          await stat(potentialConfigPath)
          return potentialConfigPath
        } catch {
          // File doesn't exist, continue
        }
      }
    } catch {
      // usersDir doesn't exist or can't be read
    }
  } catch (dirError) {
    logError(dirError)
  }

  throw new Error(
    'Could not find Claude Desktop config file in Windows. Make sure Claude Desktop is installed on Windows.',
  )
}
// getClaudeDesktopConfigPath：按平台（macOS 库目录或 WSL 路径）定位配置，全部尝试失败则抛错提示先安装 Claude Desktop。

export async function readClaudeDesktopMcpServers(): Promise<
  Record<string, McpServerConfig>
> {
  if (!SUPPORTED_PLATFORMS.includes(getPlatform())) {
    throw new Error(
      'Unsupported platform - Claude Desktop integration only works on macOS and WSL.',
    )
  }
// readClaudeDesktopMcpServers：非支持平台直接抛错；否则读取配置并进入解析流程。
  try {
    const configPath = await getClaudeDesktopConfigPath()

    let configContent: string
    try {
      configContent = await readFile(configPath, { encoding: 'utf8' })
    } catch (e: unknown) {
      const code = getErrnoCode(e)
      if (code === 'ENOENT') {
        return {}
      }
      throw e
    }

    const config = safeParseJSON(configContent)
// 用 safeParseJSON 解析配置；若内容为 null、非对象或缺少 mcpServers 字段，则按空配置返回。

    if (!config || typeof config !== 'object') {
      return {}
    }

    const mcpServers = (config as Record<string, unknown>).mcpServers
    if (!mcpServers || typeof mcpServers !== 'object') {
      return {}
    }

    const servers: Record<string, McpServerConfig> = {}

    for (const [name, serverConfig] of Object.entries(
      mcpServers as Record<string, unknown>,
    )) {
      if (!serverConfig || typeof serverConfig !== 'object') {
        continue
      }

      const result = McpStdioServerConfigSchema().safeParse(serverConfig)

      if (result.success) {
        servers[name] = result.data
      }
    }

    return servers
  } catch (error) {
    logError(error)
    return {}
// 对每个 mcpServers 条目用 McpStdioServerConfigSchema 校验，仅收集通过校验的 stdio 服务；任何读取或解析异常都记日志并返回空对象，保证不抛错。
  }
}
// 模块收尾：导出两个函数，整体以「定位路径 + 安全解析 + 容错返回空」三段式处理 Claude Desktop 集成。
