// React Compiler 运行时，提供 `$` 记忆化缓存数组。
import { c as _c } from "react/compiler-runtime";
// 模块说明：本文件被 LogoV2.tsx 在 KAIROS 特性标志下按需 require，整文件在标志都为假时被 tree-shake；不要在未守卫的代码里静态引入。
// Conditionally require()'d in LogoV2.tsx behind feature('KAIROS') ||
// feature('KAIROS_CHANNELS'). No feature() guard here — the whole file
// tree-shakes via the require pattern when both flags are false (see
// docs/feature-gating.md). Do NOT import this module statically from
// unguarded code.

import * as React from 'react';
// 引入 useState 与频道、通道白名单、订阅类型、插件与设置相关的工具。
import { useState } from 'react';
import { type ChannelEntry, getAllowedChannels, getHasDevChannels } from '../../bootstrap/state.js';
import { Box, Text } from '../../ink.js';
import { isChannelsEnabled } from '../../services/mcp/channelAllowlist.js';
import { getEffectiveChannelAllowlist } from '../../services/mcp/channelNotification.js';
import { getMcpConfigsByScope } from '../../services/mcp/config.js';
import { getClaudeAIOAuthTokens, getSubscriptionType } from '../../utils/auth.js';
import { loadInstalledPluginsV2 } from '../../utils/plugins/installedPluginsManager.js';
import { getSettingsForSource } from '../../utils/settings/settings.js';
// ChannelsNotice：展示当前会话正在监听的频道（channel）来源与状态。无频道时返回 null。
export function ChannelsNotice() {
  const $ = _c(32);
  const [t0] = useState(_temp);
  const {
    channels,
    disabled,
    noAuth,
    policyBlocked,
    list,
    unmatched
  } = t0;
// 无频道则直接返回 null。
  if (channels.length === 0) {
    return null;
  }
// hasNonDev：是否存在非开发态频道；flag 文案根据是否有开发频道与命令行标志变化。
  const hasNonDev = channels.some(_temp2);
  const flag = getHasDevChannels() && hasNonDev ? "Channels" : getHasDevChannels() ? "--dangerously-load-development-channels" : "--channels";
// disabled 分支：频道功能被关闭时，提示 `flag ignored` 并说明不可用。
  if (disabled) {
    let t1;
    if ($[0] !== flag || $[1] !== list) {
      t1 = <Text color="error">{flag} ignored ({list})</Text>;
      $[0] = flag;
      $[1] = list;
      $[2] = t1;
    } else {
      t1 = $[2];
    }
    let t2;
    if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
      t2 = <Text dimColor={true}>Channels are not currently available</Text>;
      $[3] = t2;
    } else {
      t2 = $[3];
    }
    let t3;
    if ($[4] !== t1) {
      t3 = <Box paddingLeft={2} flexDirection="column">{t1}{t2}</Box>;
      $[4] = t1;
      $[5] = t3;
    } else {
      t3 = $[5];
    }
    return t3;
  }
// noAuth 分支：需要 claude.ai 鉴权但未登录时，提示运行 /login 并重启。
  if (noAuth) {
    let t1;
    if ($[6] !== flag || $[7] !== list) {
      t1 = <Text color="error">{flag} ignored ({list})</Text>;
      $[6] = flag;
      $[7] = list;
      $[8] = t1;
    } else {
      t1 = $[8];
    }
    let t2;
    if ($[9] === Symbol.for("react.memo_cache_sentinel")) {
      t2 = <Text dimColor={true}>Channels require claude.ai authentication · run /login, then restart</Text>;
      $[9] = t2;
    } else {
      t2 = $[9];
    }
    let t3;
    if ($[10] !== t1) {
      t3 = <Box paddingLeft={2} flexDirection="column">{t1}{t2}</Box>;
      $[10] = t1;
      $[11] = t3;
    } else {
      t3 = $[11];
    }
    return t3;
  }
// policyBlocked 分支：被组织策略禁用时，提示入站消息会被静默丢弃，并建议管理员在受管设置开启。
  if (policyBlocked) {
    let t1;
    if ($[12] !== flag || $[13] !== list) {
      t1 = <Text color="error">{flag} blocked by org policy ({list})</Text>;
      $[12] = flag;
      $[13] = list;
      $[14] = t1;
    } else {
      t1 = $[14];
    }
    let t2;
    let t3;
    if ($[15] === Symbol.for("react.memo_cache_sentinel")) {
      t2 = <Text dimColor={true}>Inbound messages will be silently dropped</Text>;
      t3 = <Text dimColor={true}>Have an administrator set channelsEnabled: true in managed settings to enable</Text>;
      $[15] = t2;
      $[16] = t3;
    } else {
      t2 = $[15];
      t3 = $[16];
    }
    let t4;
    if ($[17] !== unmatched) {
      t4 = unmatched.map(_temp3);
      $[17] = unmatched;
      $[18] = t4;
    } else {
      t4 = $[18];
    }
    let t5;
    if ($[19] !== t1 || $[20] !== t4) {
      t5 = <Box paddingLeft={2} flexDirection="column">{t1}{t2}{t3}{t4}</Box>;
      $[19] = t1;
      $[20] = t4;
      $[21] = t5;
    } else {
      t5 = $[21];
    }
    return t5;
  }
// 正常分支：列出正在监听的频道来源，并附实验性风险提示；提供重启时去掉 flag 即可关闭。
  let t1;
  if ($[22] !== list) {
    t1 = <Text color="error">Listening for channel messages from: {list}</Text>;
    $[22] = list;
    $[23] = t1;
  } else {
    t1 = $[23];
  }
  let t2;
  if ($[24] !== flag) {
    t2 = <Text dimColor={true}>Experimental · inbound messages will be pushed into this session, this carries prompt injection risks. Restart Claude Code without {flag} to disable.</Text>;
    $[24] = flag;
    $[25] = t2;
  } else {
    t2 = $[25];
  }
  let t3;
  if ($[26] !== unmatched) {
    t3 = unmatched.map(_temp4);
    $[26] = unmatched;
    $[27] = t3;
  } else {
    t3 = $[27];
  }
  let t4;
  if ($[28] !== t1 || $[29] !== t2 || $[30] !== t3) {
    t4 = <Box paddingLeft={2} flexDirection="column">{t1}{t2}{t3}</Box>;
    $[28] = t1;
    $[29] = t2;
    $[30] = t3;
    $[31] = t4;
  } else {
    t4 = $[31];
  }
  return t4;
}
// 两个渲染未匹配项的助手：把未匹配的频道条目格式化为「条目 · 原因」的警告文本。
function _temp4(u_0) {
  return <Text key={`${formatEntry(u_0.entry)}:${u_0.why}`} color="warning">{formatEntry(u_0.entry)} · {u_0.why}</Text>;
}
function _temp3(u) {
  return <Text key={`${formatEntry(u.entry)}:${u.why}`} color="warning">{formatEntry(u.entry)} · {u.why}</Text>;
}
function _temp2(c) {
  return !c.dev;
}
// _temp：读取允许频道并汇总成展示状态——是否禁用、是否未鉴权、是否被策略拦截、列表字符串、未匹配项。
function _temp() {
  const ch = getAllowedChannels();
  if (ch.length === 0) {
    return {
      channels: ch,
      disabled: false,
      noAuth: false,
      policyBlocked: false,
      list: "",
      unmatched: [] as Unmatched[]
    };
  }
  const l = ch.map(formatEntry).join(", ");
  const sub = getSubscriptionType();
  const managed = sub === "team" || sub === "enterprise";
  const policy = getSettingsForSource("policySettings");
  const allowlist = getEffectiveChannelAllowlist(sub, policy?.allowedChannelPlugins);
  return {
    channels: ch,
    disabled: !isChannelsEnabled(),
    noAuth: !getClaudeAIOAuthTokens()?.accessToken,
    policyBlocked: managed && policy?.channelsEnabled !== true,
    list: l,
    unmatched: findUnmatched(ch, allowlist)
  };
}
// formatEntry：把频道条目格式化为 `plugin:名称@市场` 或 `server:名称`。
function formatEntry(c: ChannelEntry): string {
  return c.kind === 'plugin' ? `plugin:${c.name}@${c.marketplace}` : `server:${c.name}`;
}
type Unmatched = {
  entry: ChannelEntry;
  why: string;
};
// findUnmatched：找出未被满足的频道来源——server 类检查是否配置了同名 MCP server 且非开发态需危险标志；plugin 类检查是否安装且在白名单上。
function findUnmatched(entries: readonly ChannelEntry[], allowlist: ReturnType<typeof getEffectiveChannelAllowlist>): Unmatched[] {
  // Server-kind: build one Set from all scopes up front. getMcpConfigsByScope
  // is not cached (project scope walks the dir tree); getMcpConfigByName would
  // redo that walk per entry.
  const scopes = ['enterprise', 'user', 'project', 'local'] as const;
  const configured = new Set<string>();
  for (const scope of scopes) {
    for (const name of Object.keys(getMcpConfigsByScope(scope).servers)) {
      configured.add(name);
    }
  }

  // Plugin-kind installed check: installed_plugins.json keys are
  // `name@marketplace`. loadInstalledPluginsV2 is cached.
  const installedPluginIds = new Set(Object.keys(loadInstalledPluginsV2().plugins));

  // Plugin-kind allowlist check: same {marketplace, plugin} test as the
  // gate at channelNotification.ts. entry.dev bypasses (dev flag opts out
  // of the allowlist). Org list replaces ledger when set (team/enterprise).
  // GrowthBook _CACHED_MAY_BE_STALE — cold cache yields [] so every plugin
  // entry warns; same tradeoff the gate already accepts.
  const {
    entries: allowed,
    source
  } = allowlist;

  // Independent ifs — a plugin entry that's both uninstalled AND
  // unlisted shows two lines. Server kind checks config + dev flag.
  const out: Unmatched[] = [];
  for (const entry of entries) {
    if (entry.kind === 'server') {
      if (!configured.has(entry.name)) {
        out.push({
          entry,
          why: 'no MCP server configured with that name'
        });
      }
      if (!entry.dev) {
        out.push({
          entry,
          why: 'server: entries need --dangerously-load-development-channels'
        });
      }
      continue;
    }
    if (!installedPluginIds.has(`${entry.name}@${entry.marketplace}`)) {
      out.push({
        entry,
        why: 'plugin not installed'
      });
    }
    if (!entry.dev && !allowed.some(e => e.plugin === entry.name && e.marketplace === entry.marketplace)) {
      out.push({
        entry,
        why: source === 'org' ? "not on your org's approved channels list" : 'not on the approved channels allowlist'
      });
    }
  }
  return out;
}
// 原文件此处有一行 21336 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。