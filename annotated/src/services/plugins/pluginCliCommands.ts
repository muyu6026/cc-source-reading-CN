/**
 * CLI command wrappers for plugin operations
 *
 * This module provides thin wrappers around the core plugin operations
 * that handle CLI-specific concerns like console output and process exit.
 *
 * For the core operations (without CLI side effects), see pluginOperations.ts
 */
import figures from 'figures'
import { errorMessage } from '../../utils/errors.js'
import { gracefulShutdown } from '../../utils/gracefulShutdown.js'
import { logError } from '../../utils/log.js'
import { getManagedPluginNames } from '../../utils/plugins/managedPlugins.js'
import { parsePluginIdentifier } from '../../utils/plugins/pluginIdentifier.js'
import type { PluginScope } from '../../utils/plugins/schemas.js'
import { writeToStdout } from '../../utils/process.js'
import {
  buildPluginTelemetryFields,
  classifyPluginCommandError,
} from '../../utils/telemetry/pluginTelemetry.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
  logEvent,
} from '../analytics/index.js'
import {
  disableAllPluginsOp,
  disablePluginOp,
  enablePluginOp,
  type InstallableScope,
  installPluginOp,
  uninstallPluginOp,
  updatePluginOp,
  VALID_INSTALLABLE_SCOPES,
  VALID_UPDATE_SCOPES,
} from './pluginOperations.js'

export { VALID_INSTALLABLE_SCOPES, VALID_UPDATE_SCOPES }

type PluginCliCommand =
  | 'install'
  | 'uninstall'
  | 'enable'
  | 'disable'
  | 'disable-all'
  | 'update'

/**
 * Generic error handler for plugin CLI commands. Emits
 * tengu_plugin_command_failed before exit so dashboards can compute a
 * success rate against the corresponding success events.
 */
function handlePluginCommandError(
  error: unknown,
  command: PluginCliCommand,
  plugin?: string,
): never {
// handlePluginCommandError：所有插件 CLI 命令的统一错误出口。关键设计是「先发遥测再退出」——emit tengu_plugin_command_failed，dashboard 才能拿它和对应的成功事件算出成功率；否则失败是静默的，监控里只有成功没有失败。函数返回 never，结尾必 process.exit(1)。
  logError(error)
  const operation = plugin
    ? `${command} plugin "${plugin}"`
    : command === 'disable-all'
      ? 'disable all plugins'
      : `${command} plugins`
  // biome-ignore lint/suspicious/noConsole:: intentional console output
  console.error(
    `${figures.cross} Failed to ${operation}: ${errorMessage(error)}`,
  )
  const telemetryFields = plugin
    ? (() => {
        const { name, marketplace } = parsePluginIdentifier(plugin)
        return {
          _PROTO_plugin_name:
            name as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
          ...(marketplace && {
            _PROTO_marketplace_name:
              marketplace as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
          }),
          ...buildPluginTelemetryFields(
            name,
            marketplace,
            getManagedPluginNames(),
          ),
        }
      })()
    : {}
  logEvent('tengu_plugin_command_failed', {
    command:
      command as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    error_category: classifyPluginCommandError(
      error,
    ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    ...telemetryFields,
  })
  // eslint-disable-next-line custom-rules/no-process-exit
  process.exit(1)
}

/**
 * CLI command: Install a plugin non-interactively
 * @param plugin Plugin identifier (name or plugin@marketplace)
 * @param scope Installation scope: user, project, or local (defaults to 'user')
 */
export async function installPlugin(
  plugin: string,
  scope: InstallableScope = 'user',
): Promise<void> {
// CLI 包装层的老套路：调 Op（纯逻辑）→ !success 就 throw 把 message 变成 Error → 打 tick → 发遥测 → process.exit(0)。六个命令（install/uninstall/enable/disable/disable-all/update）全是这个形状，差别只在遥测事件名和字段。本模块只管 CLI 副作用（console + exit），业务全在 pluginOperations.ts。
  try {
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(`Installing plugin "${plugin}"...`)

    const result = await installPluginOp(plugin, scope)

    if (!result.success) {
      throw new Error(result.message)
    }

    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(`${figures.tick} ${result.message}`)

    // _PROTO_* routes to PII-tagged plugin_name/marketplace_name BQ columns.
    // Unredacted plugin_id was previously logged to general-access
    // additional_metadata for all users — dropped in favor of the privileged
    // column route.
    const { name, marketplace } = parsePluginIdentifier(
      result.pluginId || plugin,
    )
    logEvent('tengu_plugin_installed_cli', {
      _PROTO_plugin_name:
        name as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
      ...(marketplace && {
        _PROTO_marketplace_name:
          marketplace as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
      }),
      scope: (result.scope ||
        scope) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      install_source:
        'cli-explicit' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...buildPluginTelemetryFields(name, marketplace, getManagedPluginNames()),
    })
// 遥测的 PII 路由约定：插件名 / 市场名走 _PROTO_ 前缀，落到带 PII 标签的 BQ 特权列；未脱敏的 plugin_id 以前会进 general-access 的 additional_metadata（所有用户可见），已废弃。命令名、scope 这类非敏感字段则用 AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS 断言「这不是代码也不是文件路径」，与 api/logging.ts 那套命名约束同源。

    // eslint-disable-next-line custom-rules/no-process-exit
    process.exit(0)
  } catch (error) {
    handlePluginCommandError(error, 'install', plugin)
  }
}

/**
 * CLI command: Uninstall a plugin non-interactively
 * @param plugin Plugin name or plugin@marketplace identifier
 * @param scope Uninstall from scope: user, project, or local (defaults to 'user')
 */
export async function uninstallPlugin(
  plugin: string,
  scope: InstallableScope = 'user',
  keepData = false,
): Promise<void> {
  try {
    const result = await uninstallPluginOp(plugin, scope, !keepData)

    if (!result.success) {
      throw new Error(result.message)
    }

    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(`${figures.tick} ${result.message}`)

    const { name, marketplace } = parsePluginIdentifier(
      result.pluginId || plugin,
    )
    logEvent('tengu_plugin_uninstalled_cli', {
      _PROTO_plugin_name:
        name as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
      ...(marketplace && {
        _PROTO_marketplace_name:
          marketplace as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
      }),
      scope: (result.scope ||
        scope) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...buildPluginTelemetryFields(name, marketplace, getManagedPluginNames()),
    })

    // eslint-disable-next-line custom-rules/no-process-exit
    process.exit(0)
  } catch (error) {
    handlePluginCommandError(error, 'uninstall', plugin)
  }
}

/**
 * CLI command: Enable a plugin non-interactively
 * @param plugin Plugin name or plugin@marketplace identifier
 * @param scope Optional scope. If not provided, finds the most specific scope for the current project.
 */
export async function enablePlugin(
  plugin: string,
  scope?: InstallableScope,
): Promise<void> {
  try {
    const result = await enablePluginOp(plugin, scope)

    if (!result.success) {
      throw new Error(result.message)
    }

    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(`${figures.tick} ${result.message}`)

    const { name, marketplace } = parsePluginIdentifier(
      result.pluginId || plugin,
    )
    logEvent('tengu_plugin_enabled_cli', {
      _PROTO_plugin_name:
        name as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
      ...(marketplace && {
        _PROTO_marketplace_name:
          marketplace as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
      }),
      scope:
        result.scope as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...buildPluginTelemetryFields(name, marketplace, getManagedPluginNames()),
    })

    // eslint-disable-next-line custom-rules/no-process-exit
    process.exit(0)
  } catch (error) {
    handlePluginCommandError(error, 'enable', plugin)
  }
}

/**
 * CLI command: Disable a plugin non-interactively
 * @param plugin Plugin name or plugin@marketplace identifier
 * @param scope Optional scope. If not provided, finds the most specific scope for the current project.
 */
export async function disablePlugin(
  plugin: string,
  scope?: InstallableScope,
): Promise<void> {
  try {
    const result = await disablePluginOp(plugin, scope)

    if (!result.success) {
      throw new Error(result.message)
    }

    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(`${figures.tick} ${result.message}`)

    const { name, marketplace } = parsePluginIdentifier(
      result.pluginId || plugin,
    )
    logEvent('tengu_plugin_disabled_cli', {
      _PROTO_plugin_name:
        name as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
      ...(marketplace && {
        _PROTO_marketplace_name:
          marketplace as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
      }),
      scope:
        result.scope as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...buildPluginTelemetryFields(name, marketplace, getManagedPluginNames()),
    })

    // eslint-disable-next-line custom-rules/no-process-exit
    process.exit(0)
  } catch (error) {
    handlePluginCommandError(error, 'disable', plugin)
  }
}

/**
 * CLI command: Disable all enabled plugins non-interactively
 */
export async function disableAllPlugins(): Promise<void> {
  try {
    const result = await disableAllPluginsOp()

    if (!result.success) {
      throw new Error(result.message)
    }

    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(`${figures.tick} ${result.message}`)

    logEvent('tengu_plugin_disabled_all_cli', {})
// disable-all 没有单个 plugin 参数，遥测事件 tengu_plugin_disabled_all_cli 也就不带 _PROTO_plugin_name 等字段——发个空对象即可。

    // eslint-disable-next-line custom-rules/no-process-exit
    process.exit(0)
  } catch (error) {
    handlePluginCommandError(error, 'disable-all')
  }
}

/**
 * CLI command: Update a plugin non-interactively
 * @param plugin Plugin name or plugin@marketplace identifier
 * @param scope Scope to update
 */
export async function updatePluginCli(
  plugin: string,
  scope: PluginScope,
): Promise<void> {
// updatePluginCli 与其他命令的退出方式不同：用 writeToStdout 而非 console.log，用 gracefulShutdown(0) 而非 process.exit(0)。更新可能已经改动了磁盘状态，需要走优雅关闭（flush 日志、有序收尾）而不是硬退。
  try {
    writeToStdout(
      `Checking for updates for plugin "${plugin}" at ${scope} scope…\n`,
    )

    const result = await updatePluginOp(plugin, scope)

    if (!result.success) {
      throw new Error(result.message)
    }

    writeToStdout(`${figures.tick} ${result.message}\n`)

    if (!result.alreadyUpToDate) {
      const { name, marketplace } = parsePluginIdentifier(
        result.pluginId || plugin,
      )
      logEvent('tengu_plugin_updated_cli', {
        _PROTO_plugin_name:
          name as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
        ...(marketplace && {
          _PROTO_marketplace_name:
            marketplace as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
        }),
        old_version: (result.oldVersion ||
          'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        new_version: (result.newVersion ||
          'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        ...buildPluginTelemetryFields(
          name,
          marketplace,
          getManagedPluginNames(),
        ),
      })
    }

    await gracefulShutdown(0)
// alreadyUpToDate 时不发 tengu_plugin_updated_cli——没有发生真实更新，发出去会污染「更新频率」指标。
  } catch (error) {
    handlePluginCommandError(error, 'update', plugin)
  }
}
