// 文件级批注：`officialMarketplace.ts` 定义官方 Anthropic 插件市场的常量，包括市场来源配置与显示名，供启动时自动安装与识别使用。
/**
 * Constants for the official Anthropic plugins marketplace.
 *
 * The official marketplace is hosted on GitHub and provides first-party
 * plugins developed by Anthropic. This file defines the constants needed
 * to install and identify this marketplace.
 */

import type { MarketplaceSource } from './schemas.js'

/**
 * Source configuration for the official Anthropic plugins marketplace.
 * Used when auto-installing the marketplace on startup.
 */
// 声明官方市场来源：指向 `anthropics/claude-plugins-official` 这个 GitHub 仓库，并用类型断言锁定结构。
export const OFFICIAL_MARKETPLACE_SOURCE = {
  source: 'github',
  repo: 'anthropics/claude-plugins-official',
} as const satisfies MarketplaceSource
// 收尾：以 `satisfies` 校验该对象符合 `MarketplaceSource` 形状，确保来源字段合法。

/**
 * Display name for the official marketplace.
 * This is the name under which the marketplace will be registered
 * in the known_marketplaces.json file.
 */
export const OFFICIAL_MARKETPLACE_NAME = 'claude-plugins-official'
// 收尾：导出官方市场的显示名，用于写入 `known_marketplaces.json` 时的注册键。
