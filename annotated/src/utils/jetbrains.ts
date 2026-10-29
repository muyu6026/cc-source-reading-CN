// 文件总述：JetBrains 系列 IDE 插件探测。按 IDE 名映射到各平台下的插件目录，检测 claude-code-jetbrains-plugin 是否安装，并提供带缓存的同步/异步查询。
import { homedir, platform } from 'os'
import { join } from 'path'
import { getFsImplementation } from '../utils/fsOperations.js'
import type { IdeType } from './ide.js'

const PLUGIN_PREFIX = 'claude-code-jetbrains-plugin'
// PLUGIN_PREFIX：我们要寻找的插件目录名。

// Map of IDE names to their directory patterns
const ideNameToDirMap: { [key: string]: string[] } = {
  pycharm: ['PyCharm'],
  intellij: ['IntelliJIdea', 'IdeaIC'],
  webstorm: ['WebStorm'],
  phpstorm: ['PhpStorm'],
  rubymine: ['RubyMine'],
  clion: ['CLion'],
  goland: ['GoLand'],
  rider: ['Rider'],
  datagrip: ['DataGrip'],
  appcode: ['AppCode'],
  dataspell: ['DataSpell'],
  aqua: ['Aqua'],
  gateway: ['Gateway'],
  fleet: ['Fleet'],
  androidstudio: ['AndroidStudio'],
}
// ideNameToDirMap：IDE 名到其目录名前缀模式的映射（如 pycharm 对应 PyCharm）。

// Build plugin directory paths
// https://www.jetbrains.com/help/pycharm/directories-used-by-the-ide-to-store-settings-caches-plugins-and-logs.html#plugins-directory
function buildCommonPluginDirectoryPaths(ideName: string): string[] {
  const homeDir = homedir()
  const directories: string[] = []
  const idePatterns = ideNameToDirMap[ideName.toLowerCase()]
  if (!idePatterns) {
    return directories
  }

  const appData = process.env.APPDATA || join(homeDir, 'AppData', 'Roaming')
  const localAppData =
    process.env.LOCALAPPDATA || join(homeDir, 'AppData', 'Local')
// appData 与 localAppData 的兜底拼装：环境变量缺失时按用户主目录推算 AppData/Roaming 与 AppData/Local。

  switch (platform()) {
    case 'darwin':
      directories.push(
        join(homeDir, 'Library', 'Application Support', 'JetBrains'),
        join(homeDir, 'Library', 'Application Support'),
      )
      if (ideName.toLowerCase() === 'androidstudio') {
        directories.push(
          join(homeDir, 'Library', 'Application Support', 'Google'),
        )
      }
      break

    case 'win32':
      directories.push(
        join(appData, 'JetBrains'),
        join(localAppData, 'JetBrains'),
        join(appData),
      )
      if (ideName.toLowerCase() === 'androidstudio') {
        directories.push(join(localAppData, 'Google'))
      }
      break

    case 'linux':
      directories.push(
        join(homeDir, '.config', 'JetBrains'),
        join(homeDir, '.local', 'share', 'JetBrains'),
      )
      for (const pattern of idePatterns) {
        directories.push(join(homeDir, '.' + pattern))
      }
      if (ideName.toLowerCase() === 'androidstudio') {
        directories.push(join(homeDir, '.config', 'Google'))
      }
      break
    default:
      break
  }

  return directories
}
// buildCommonPluginDirectoryPaths：按平台（darwin/win32/linux）拼出候选插件根目录列表。

// Find all actual plugin directories that exist
async function detectPluginDirectories(ideName: string): Promise<string[]> {
  const foundDirectories: string[] = []
  const fs = getFsImplementation()

  const pluginDirPaths = buildCommonPluginDirectoryPaths(ideName)
  const idePatterns = ideNameToDirMap[ideName.toLowerCase()]
  if (!idePatterns) {
    return foundDirectories
  }

  // Precompile once — idePatterns is invariant across baseDirs
  const regexes = idePatterns.map(p => new RegExp('^' + p))

  for (const baseDir of pluginDirPaths) {
    try {
      const entries = await fs.readdir(baseDir)
      for (const regex of regexes) {
        for (const entry of entries) {
          if (!regex.test(entry.name)) continue
          // Accept symlinks too — dirent.isDirectory() is false for symlinks,
          // but GNU stow users symlink their JetBrains config dirs. Downstream
          // fs.stat() calls will filter out symlinks that don't point to dirs.
          if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
// 注释点：Linux 是唯一没有 plugins 子目录的操作系统，因此直接收插件根目录。
          const dir = join(baseDir, entry.name)
          // Linux is the only OS to not have a plugins directory
          if (platform() === 'linux') {
            foundDirectories.push(dir)
            continue
          }
          const pluginDir = join(dir, 'plugins')
          try {
            await fs.stat(pluginDir)
            foundDirectories.push(pluginDir)
          } catch {
            // Plugin directory doesn't exist, skip
          }
        }
      }
    } catch {
      // Ignore errors from stale IDE directories (ENOENT, EACCES, etc.)
      continue
    }
  }

  return foundDirectories.filter(
    (dir, index) => foundDirectories.indexOf(dir) === index,
  )
}
// detectPluginDirectories：枚举真实存在的插件目录，接受符号链接（GNU stow 用户常软链配置目录），最后去重。

export async function isJetBrainsPluginInstalled(
  ideType: IdeType,
): Promise<boolean> {
  const pluginDirs = await detectPluginDirectories(ideType)
  for (const dir of pluginDirs) {
    const pluginPath = join(dir, PLUGIN_PREFIX)
    try {
      await getFsImplementation().stat(pluginPath)
      return true
    } catch {
      // Plugin not found in this directory, continue
    }
  }
  return false
}
// isJetBrainsPluginInstalled：探测某个 IDE 类型是否装了该插件。

const pluginInstalledCache = new Map<IdeType, boolean>()
const pluginInstalledPromiseCache = new Map<IdeType, Promise<boolean>>()

async function isJetBrainsPluginInstalledMemoized(
  ideType: IdeType,
  forceRefresh = false,
): Promise<boolean> {
  if (!forceRefresh) {
    const existing = pluginInstalledPromiseCache.get(ideType)
    if (existing) {
      return existing
    }
  }
  const promise = isJetBrainsPluginInstalled(ideType).then(result => {
    pluginInstalledCache.set(ideType, result)
    return result
  })
  pluginInstalledPromiseCache.set(ideType, promise)
  return promise
}
// isJetBrainsPluginInstalledMemoized：带 Promise 缓存的异步探测，避免重复枚举目录。

export async function isJetBrainsPluginInstalledCached(
  ideType: IdeType,
  forceRefresh = false,
): Promise<boolean> {
  if (forceRefresh) {
    pluginInstalledCache.delete(ideType)
    pluginInstalledPromiseCache.delete(ideType)
  }
  return isJetBrainsPluginInstalledMemoized(ideType, forceRefresh)
}
// isJetBrainsPluginInstalledCached：带 forceRefresh 的缓存封装，强制刷新时清掉两层缓存。

/**
 * Returns the cached result of isJetBrainsPluginInstalled synchronously.
 * Returns false if the result hasn't been resolved yet.
 * Use this only in sync contexts (e.g., status notice isActive checks).
 */
export function isJetBrainsPluginInstalledCachedSync(
  ideType: IdeType,
): boolean {
  return pluginInstalledCache.get(ideType) ?? false
}
// isJetBrainsPluginInstalledCachedSync：同步取缓存结果（尚未解析完成时返回 false），用于状态检测等非异步场景。
