import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { useEffect, useState } from 'react';
import { getIsRemoteMode } from '../../bootstrap/state.js';
import { useNotifications } from '../../context/notifications.js';
import { Text } from '../../ink.js';
import { logForDebugging } from '../../utils/debug.js';
import { onPluginsAutoUpdated } from '../../utils/plugins/pluginAutoupdate.js';

/**
 * Hook that displays a notification when plugins have been auto-updated.
 * The notification tells the user to run /reload-plugins to apply the updates.
 */
// 插件被自动更新后提示用户运行 /reload-plugins 才会生效。
// 订阅与展示拆成两个 effect：先攒 updatedPlugins 状态，
// 再在有值时才弹通知。
export function usePluginAutoupdateNotification() {
  const $ = _c(7);
  const {
    addNotification
  } = useNotifications();
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = [];
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  const [updatedPlugins, setUpdatedPlugins] = useState(t0);
// 攒下来的已更新插件 id 列表（空 = 无事发生）。
  let t1;
  let t2;
  if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = () => {
      if (getIsRemoteMode()) {
        return;
      }
// 订阅 autoupdate 事件：事件到达只更新 state，
// 不直接弹通知（弹通知由第二个 effect 负责，见下）。
      const unsubscribe = onPluginsAutoUpdated(plugins => {
        logForDebugging(`Plugin autoupdate notification: ${plugins.length} plugin(s) updated`);
        setUpdatedPlugins(plugins);
      });
      return unsubscribe;
    };
    t2 = [];
    $[1] = t1;
    $[2] = t2;
  } else {
    t1 = $[1];
    t2 = $[2];
  }
  useEffect(t1, t2);
  let t3;
  let t4;
  if ($[3] !== addNotification || $[4] !== updatedPlugins) {
    t3 = () => {
      if (getIsRemoteMode()) {
        return;
      }
      if (updatedPlugins.length === 0) {
        return;
      }
      const pluginNames = updatedPlugins.map(_temp);
      const displayNames = pluginNames.length <= 2 ? pluginNames.join(" and ") : `${pluginNames.length} plugins`;
// 文案折叠：≤2 个插件列名字（A and B），
// 更多则只报数量（N plugins），避免长列表刷屏。
      addNotification({
        key: "plugin-autoupdate-restart",
        jsx: <><Text color="success">{pluginNames.length === 1 ? "Plugin" : "Plugins"} updated:{" "}{displayNames}</Text><Text dimColor={true}> · Run /reload-plugins to apply</Text></>,
        priority: "low",
        timeoutMs: 10000
      });
      logForDebugging(`Showing plugin autoupdate notification for: ${pluginNames.join(", ")}`);
    };
    t4 = [updatedPlugins, addNotification];
    $[3] = addNotification;
    $[4] = updatedPlugins;
    $[5] = t3;
    $[6] = t4;
  } else {
    t3 = $[5];
    t4 = $[6];
  }
  useEffect(t3, t4);
}
// 展示名去掉 @version 后缀（id 形如 name@1.2.3）。
function _temp(id) {
  const atIndex = id.indexOf("@");
  return atIndex > 0 ? id.substring(0, atIndex) : id;
}
// 原文件此处有一行 6508 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。