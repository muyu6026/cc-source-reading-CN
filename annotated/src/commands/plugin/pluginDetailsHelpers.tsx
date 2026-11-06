// React 编译器产物：常规 React 与 ink 组件混在前面，TypeScript 类型与函数在其后
import { c as _c } from "react/compiler-runtime";
/**
 * Shared helper functions and types for plugin details views
 *
 * Used by both DiscoverPlugins and BrowseMarketplace components.
 */

import * as React from 'react';
import { ConfigurableShortcutHint } from '../../components/ConfigurableShortcutHint.js';
import { Byline } from '../../components/design-system/Byline.js';
import { Box, Text } from '../../ink.js';
import type { PluginMarketplaceEntry } from '../../utils/plugins/schemas.js';

/**
 * Represents a plugin available for installation from a marketplace
 */
// 可安装插件的数据形状：市场条目 + 市场名 + 插件 id + 是否已装
export type InstallablePlugin = {
  entry: PluginMarketplaceEntry;
  marketplaceName: string;
  pluginId: string;
  isInstalled: boolean;
};

/**
 * Menu option for plugin details view
 */
// 详情视图的菜单项：label 与 action 一一对应
export type PluginDetailsMenuOption = {
  label: string;
  action: string;
};

/**
 * Extract GitHub repo info from a plugin's source
 */
// 从插件 source 里抠 GitHub 仓库信息：source 是 github 类型且带 repo 字段才返回
export function extractGitHubRepo(plugin: InstallablePlugin): string | null {
  const isGitHub = plugin.entry.source && typeof plugin.entry.source === 'object' && 'source' in plugin.entry.source && plugin.entry.source.source === 'github';
  if (isGitHub && typeof plugin.entry.source === 'object' && 'repo' in plugin.entry.source) {
    return plugin.entry.source.repo;
  }
  return null;
}

/**
 * Build menu options for plugin details view with scoped installation options
 */
// 按作用域拼安装菜单：用户级 / 项目级 / 本地级三选一，再根据有无主页和仓库追加选项
export function buildPluginDetailsMenuOptions(hasHomepage: string | undefined, githubRepo: string | null): PluginDetailsMenuOption[] {
  const options: PluginDetailsMenuOption[] = [{
    label: 'Install for you (user scope)',
    action: 'install-user'
  }, {
    label: 'Install for all collaborators on this repository (project scope)',
    action: 'install-project'
  }, {
    label: 'Install for you, in this repo only (local scope)',
    action: 'install-local'
  }];
// 有主页才加打开主页；有仓库才加在 GitHub 查看
  if (hasHomepage) {
    options.push({
      label: 'Open homepage',
      action: 'homepage'
    });
  }
  if (githubRepo) {
    options.push({
      label: 'View on GitHub',
      action: 'github'
    });
  }
// 菜单在此收尾，back 选项已无条件追加到末尾
  options.push({
    label: 'Back to plugin list',
    action: 'back'
  });
  return options;
}

// 插件选择屏的快捷键提示组件
/**
 * Key hint component for plugin selection screens
 */
// 编译器产物：三个 ConfigurableShortcutHint 记忆化，依赖变了才重建那一行的 Byline
export function PluginSelectionKeyHint(t0) {
  const $ = _c(7);
  const {
    hasSelection
  } = t0;
  let t1;
  if ($[0] !== hasSelection) {
    t1 = hasSelection && <ConfigurableShortcutHint action="plugin:install" context="Plugin" fallback="i" description="install" bold={true} />;
    $[0] = hasSelection;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  let t2;
  let t3;
  let t4;
// 首次构建三个静态快捷键提示；之后缓存复用，不重复创建
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = <ConfigurableShortcutHint action="plugin:toggle" context="Plugin" fallback="Space" description="toggle" />;
    t3 = <ConfigurableShortcutHint action="select:accept" context="Select" fallback="Enter" description="details" />;
    t4 = <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="back" />;
    $[2] = t2;
    $[3] = t3;
    $[4] = t4;
  } else {
    t2 = $[2];
    t3 = $[3];
    t4 = $[4];
  }
  let t5;
  if ($[5] !== t1) {
    t5 = <Box marginTop={1}><Text dimColor={true} italic={true}><Byline>{t1}{t2}{t3}{t4}</Byline></Text></Box>;
    $[5] = t1;
    $[6] = t5;
  } else {
    t5 = $[6];
  }
  return t5;
}
// 原文件此处有一行 9084 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。