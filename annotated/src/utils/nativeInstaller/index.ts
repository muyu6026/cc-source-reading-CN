// 这是原生安装器的「桶文件」（barrel），只重新导出外部模块真正会用到的函数与类型，外部模块应当只从这个文件导入，而不碰实现文件。
/**
 * Native Installer - Public API
 *
 * This is the barrel file that exports only the functions actually used by external modules.
 * External modules should only import from this file.
 */

// Re-export only the functions that are actually used
export {
  checkInstall,
  cleanupNpmInstallations,
  cleanupOldVersions,
  cleanupShellAliases,
  installLatest,
  lockCurrentVersion,
  removeInstalledSymlink,
  type SetupMessage,
} from './installer.js'
// 重新导出的内容——checkInstall、各类 cleanup、installLatest、lockCurrentVersion、removeInstalledSymlink 以及类型 SetupMessage——全部来自真正的实现文件 installer.js。
