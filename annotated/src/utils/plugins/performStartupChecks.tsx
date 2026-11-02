import { performBackgroundPluginInstallations } from '../../services/plugins/PluginInstallationManager.js';
import type { AppState } from '../../state/AppState.js';
import { checkHasTrustDialogAccepted } from '../config.js';
import { logForDebugging } from '../debug.js';
import { clearMarketplacesCache, registerSeedMarketplaces } from './marketplaceManager.js';
import { clearPluginCache } from './pluginLoader.js';
type SetAppState = (f: (prevState: AppState) => AppState) => void;
// AppState 更新函数类型：接收一个以旧状态算出新状态的函数，由 REPL 侧的状态管理提供。

/**
 * Perform plugin startup checks and initiate background installations
 *
 * This function starts background installation of marketplaces and plugins
 * from trusted sources (repository and user settings) without blocking startup.
 * Installation progress and errors are tracked in AppState and shown via notifications.
 *
 * SECURITY: This function is only called from REPL.tsx after the "trust this folder"
 * dialog has been confirmed. The trust dialog in cli.tsx blocks all execution until
 * the user explicitly trusts the current working directory, ensuring that plugin
 * installations only happen with user consent. This prevents malicious repositories
 * from automatically installing plugins without user approval.
 *
 * @param setAppState Function to update app state with installation progress
 */
// 插件启动检查入口：在不阻塞启动的前提下，从受信任来源（仓库与用户设置）后台安装市场与插件，并把进度与错误写进 AppState 经通知展示。仅在用户确认「信任此目录」后由 REPL 调用，避免恶意仓库自动装插件。
// 主函数体：先确认当前目录已被信任，否则直接跳过安装；信任后才注册种子市场并触发后台安装。
export async function performStartupChecks(setAppState: SetAppState): Promise<void> {
  logForDebugging('performStartupChecks called');

  // Check if the current directory has been trusted
  if (!checkHasTrustDialogAccepted()) {
    logForDebugging('Trust not accepted for current directory - skipping plugin installations');
    return;
  }
  try {
    logForDebugging('Starting background plugin installations');

    // Register seed marketplaces (CLAUDE_CODE_PLUGIN_SEED_DIR) before diffing.
    // Idempotent; no-op if seed not configured. Without this, background install
    // would see seed marketplaces as missing → clone → defeats seed's purpose.
    //
    // If registration changed state, clear caches so earlier plugin-load passes
    // (e.g. getAllMcpConfigs during REPL init) don't keep stale "marketplace
    // not found" results.
    const seedChanged = await registerSeedMarketplaces();
// 先注册种子市场（CLAUDE_CODE_PLUGIN_SEED_DIR），幂等；若注册改变了状态再清缓存，否则后台安装会把种子市场当成缺失去克隆，违背种子机制的本意。
    if (seedChanged) {
      clearMarketplacesCache();
      clearPluginCache('performStartupChecks: seed marketplaces changed');
      // Set needsRefresh so useManagePlugins notifies the user to run
      // /reload-plugins. Without this signal, the initial plugin-load
      // (which raced and cached "marketplace not found") would persist
      // until the user manually reloads.
      setAppState(prev => {
        if (prev.plugins.needsRefresh) return prev;
        return {
          ...prev,
          plugins: {
            ...prev.plugins,
            needsRefresh: true
          }
        };
      });
// 若种子注册改了状态，置 needsRefresh 提示用户跑 /reload-plugins，避免早期插件加载缓存的「市场未找到」结果残留到手动刷新之前。
    }

    // Start background installations without waiting
    // This will update AppState as installations progress
    await performBackgroundPluginInstallations(setAppState);
// 真正触发后台安装：不等待其完成，安装进度会随 AppState 更新回显。
  } catch (error) {
    // Even if something fails here, don't block startup
    logForDebugging(`Error initiating background plugin installations: ${error}`);
  }
}
// 函数收尾：即便后台安装中途抛错也只记日志、不阻断启动，保证 REPL 始终能起来。
// 原文件此处有一行 6420 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。