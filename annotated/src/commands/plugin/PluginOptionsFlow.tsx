// 安装或启用之后追问配置：插件装上了但必填项没填，用一个走完就完的向导补齐，而不是让用户去翻文档
/**
 * Post-install/post-enable config prompt.
 *
 * Given a LoadedPlugin, checks both the top-level manifest.userConfig and the
 * channel-specific userConfig. Walks PluginOptionsDialog through each
 * unconfigured item, saving via the appropriate storage function. Calls
 * onDone('skipped') immediately if nothing needs filling.
 */

// 这份是手写 React，没有编译器运行时导入：惰性初始化被特意用来让步骤表只建一次
import * as React from 'react';
import type { LoadedPlugin } from '../../types/plugin.js';
import { errorMessage } from '../../utils/errors.js';
import { loadMcpServerUserConfig, saveMcpServerUserConfig } from '../../utils/plugins/mcpbHandler.js';
import { getUnconfiguredChannels, type UnconfiguredChannel } from '../../utils/plugins/mcpPluginIntegration.js';
import { loadAllPlugins } from '../../utils/plugins/pluginLoader.js';
import { getUnconfiguredOptions, loadPluginOptions, type PluginOptionSchema, type PluginOptionValues, savePluginOptions } from '../../utils/plugins/pluginOptionsStorage.js';
import { PluginOptionsDialog } from './PluginOptionsDialog.js';

/**
 * Post-install lookup: return the LoadedPlugin for the just-installed
 * pluginId so the caller can divert to PluginOptionsFlow. Returns undefined
 * if the plugin somehow didn't make it into the fresh load — callers treat
 * undefined as "carry on closing."
 *
 * Install should have cleared caches already; loadAllPlugins reads fresh.
 */
// 装完再查一次插件列表：安装过程已清缓存，这里读到的是最新状态；查不到就当「继续关闭」，不阻塞收尾
export async function findPluginOptionsTarget(pluginId: string): Promise<LoadedPlugin | undefined> {
  const {
    enabled,
    disabled
  } = await loadAllPlugins();
// 两种 id 都要匹配：市场来源的插件记在仓库字段，本地来源记在来源字段
  return [...enabled, ...disabled].find(p => p.repository === pluginId || p.source === pluginId);
}

/**
 * A single dialog step in the walk. Top-level options and channels both
 * collapse to this shape — the only difference is which save function runs.
 */
// 顶层选项与频道配置收敛成同一种步骤：两者只差用哪个函数落盘，走同一套对话框
type ConfigStep = {
  key: string;
  title: string;
  subtitle: string;
  schema: PluginOptionSchema;
  /** Returns any already-saved values so PluginOptionsDialog can pre-fill and
   *  skip unchanged sensitive fields on reconfigure. */
  load: () => PluginOptionValues | undefined;
  save: (values: PluginOptionValues) => void;
};
type Props = {
  plugin: LoadedPlugin;
  /** `name@marketplace` — the savePluginOptions / saveMcpServerUserConfig key. */
  pluginId: string;
  /**
   * `configured` = user filled all fields. `skipped` = nothing needed
   * configuring, or user hit cancel. `error` = save threw.
   */
// 三种结局：填完、跳过、保存抛错。调用方按结局决定提示文案，所以错误信息要一起带出去
  onDone: (outcome: 'configured' | 'skipped' | 'error', detail?: string) => void;
};
export function PluginOptionsFlow({
  plugin,
  pluginId,
  onDone
}: Props): React.ReactNode {
  // Build the step list once at mount. Re-calling after a save would drop the
  // item we just configured.
// 步骤表只建一次：保存后重建会把刚填完的那项又当成未配置，向导会原地打转
  const [steps] = React.useState<ConfigStep[]>(() => {
    const result: ConfigStep[] = [];

    // Top-level manifest.userConfig
// 顶层未配置项先入列：用户先看到插件自己的设置，再看到频道的
    const unconfigured = getUnconfiguredOptions(plugin);
    if (Object.keys(unconfigured).length > 0) {
      result.push({
        key: 'top-level',
        title: `Configure ${plugin.name}`,
        subtitle: 'Plugin options',
        schema: unconfigured,
        load: () => loadPluginOptions(pluginId),
        save: values => savePluginOptions(pluginId, values, plugin.manifest.userConfig!)
      });
    }

    // Per-channel userConfig (assistant-mode channels)
// 频道配置来自助手模式的多个服务端，每个服务端一套 schema
    const channels: UnconfiguredChannel[] = getUnconfiguredChannels(plugin);
    for (const channel of channels) {
      result.push({
// 步骤键带上服务端名：同名频道在不同服务端下是两项，不能合并成一步
        key: `channel:${channel.server}`,
        title: `Configure ${channel.displayName}`,
        subtitle: `Plugin: ${plugin.name}`,
        schema: channel.configSchema,
// 读不出来时传 undefined 而不是空对象：对话框据此区分「从没配过」与「配过但被清空」
        load: () => loadMcpServerUserConfig(pluginId, channel.server) ?? undefined,
        save: values_0 => saveMcpServerUserConfig(pluginId, channel.server, values_0, channel.configSchema)
      });
    }
    return result;
  });
// 索引是向导游标；步骤表不可变，所以只需要这一个整数
  const [index, setIndex] = React.useState(0);

  // Latest-ref: lets the effect close over the current onDone without
  // re-running when the parent re-renders.
// 最新回调存进 ref：让下面的副作用只依赖步骤数，父组件重渲染不会重跑它
  const onDoneRef = React.useRef(onDone);
  onDoneRef.current = onDone;

  // Nothing to configure → tell the caller and render nothing. Effect,
  // not inline call: calling setState in the parent during our render
  // is a React rules-of-hooks violation.
// 没有要配的项时在副作用里通知：在渲染期间调父组件的 setState 会违反 Hook 规则
  React.useEffect(() => {
    if (steps.length === 0) {
      onDoneRef.current('skipped');
    }
  }, [steps.length]);
  if (steps.length === 0) {
    return null;
  }
// 每步一个对话框：保存成功后前进，最后一步完成才报「已配置」
  const current = steps[index]!;
  function handleSave(values_1: PluginOptionValues): void {
    try {
      current.save(values_1);
    } catch (err) {
// 保存抛错立刻中止整个向导：继续走下一步只会让用户以为前面那些都成功了
      onDone('error', errorMessage(err));
      return;
    }
    const next = index + 1;
    if (next < steps.length) {
      setIndex(next);
    } else {
      onDone('configured');
    }
  }

  // key forces a remount when advancing to the next step — React would
  // otherwise reuse the instance and carry PluginOptionsDialog's
  // internal useState (field index, typed values) over.
// 重挂载的代价是每步重建一次对话框，换来的是字段值与游标不串场——这里选正确性
  return <PluginOptionsDialog key={current.key} title={current.title} subtitle={current.subtitle} configSchema={current.schema} initialValues={current.load()} onSave={handleSave} onCancel={() => onDone('skipped')} />;
}
// 原文件此处有一行 13508 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。