import { c as _c } from "react/compiler-runtime";
/**
 * Hook for LSP plugin recommendations
 *
 * Detects file edits and recommends LSP plugins when:
 * - File extension matches an LSP plugin
 * - LSP binary is already installed on the system
 * - Plugin is not already installed
 * - User hasn't disabled recommendations
 *
 * Only shows one recommendation per session.
 */
// LSP 插件推荐钩子：检测到文件编辑时，若扩展名命中某个 LSP 插件、
// 二进制已在系统装好、插件未安装、用户没关过推荐——就推一条推荐。
// 每会话只推一次（hasShownLspRecommendationThisSession）。

import { extname, join } from 'path';
import * as React from 'react';
import { hasShownLspRecommendationThisSession, setLspRecommendationShownThisSession } from '../bootstrap/state.js';
import { useNotifications } from '../context/notifications.js';
import { useAppState } from '../state/AppState.js';
import { saveGlobalConfig } from '../utils/config.js';
import { logForDebugging } from '../utils/debug.js';
import { logError } from '../utils/log.js';
import { addToNeverSuggest, getMatchingLspPlugins, incrementIgnoredCount } from '../utils/plugins/lspRecommendation.js';
import { cacheAndRegisterPlugin } from '../utils/plugins/pluginInstallationHelpers.js';
import { getSettingsForSource, updateSettingsForSource } from '../utils/settings/settings.js';
import { installPluginAndNotify, usePluginRecommendationBase } from './usePluginRecommendationBase.js';

// Threshold for detecting timeout vs explicit dismiss (ms)
// Menu auto-dismisses at 30s, so anything over 28s is likely timeout
const TIMEOUT_THRESHOLD_MS = 28_000;
// 28 秒阈值对应菜单 30 秒自动消失：超过 28 秒的「no」
// 大概率是菜单自己超时掉的，不是用户真拒绝——计入 ignored count
// 用来降温推荐频率。
export type LspRecommendationState = {
  pluginId: string;
  pluginName: string;
  pluginDescription?: string;
  fileExtension: string;
  shownAt: number; // Timestamp for timeout detection
} | null;
// 推荐状态五字段；shownAt 专为上面的超时甄别而记。
type UseLspPluginRecommendationResult = {
  recommendation: LspRecommendationState;
  handleResponse: (response: 'yes' | 'no' | 'never' | 'disable') => void;
};
// 对外两件套：当前推荐（null = 无）+ 响应用户四选一的回调。
export function useLspPluginRecommendation() {
  const $ = _c(12);
  const trackedFiles = useAppState(_temp);
// 订阅文件历史里的 trackedFiles：用户编辑过的文件集合，
// 推荐的触发源。
  const {
    addNotification
  } = useNotifications();
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
// React Compiler 形态：Symbol.for('react.memo_cache_sentinel')
// 是「本槽还没初始化」的哨兵；首次渲染建 Set，之后复用。
    t0 = new Set();
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  const checkedFilesRef = React.useRef(t0);
// checkedFilesRef 防重复检查：同一文件只送一次匹配，
// 反复编辑不重复打扰。
  const {
    recommendation,
    clearRecommendation,
    tryResolve
  } = usePluginRecommendationBase();
// usePluginRecommendationBase 是多个推荐共用的基座：
// 提供 recommendation 状态 + tryResolve 互斥解析
//（同一时刻只允许一个推荐链在跑）。
  let t1;
  let t2;
  if ($[1] !== trackedFiles || $[2] !== tryResolve) {
    t1 = () => {
      tryResolve(async () => {
// tryResolve 的入参是「解析函数」：返回推荐状态或 null。
// 互斥由基座保证，这里只管业务判断。
        if (hasShownLspRecommendationThisSession()) {
// 会话级一次性格子：本会话已推过就永远返回 null。
          return null;
        }
        const newFiles = [];
        for (const file of trackedFiles) {
          if (!checkedFilesRef.current.has(file)) {
            checkedFilesRef.current.add(file);
            newFiles.push(file);
          }
        }
        for (const filePath of newFiles) {
// 先差分出新文件（未检查过的），再逐个送匹配——
// 差分在前，避免每轮全量重查。
          ;
          try {
            const matches = await getMatchingLspPlugins(filePath);
// 匹配四条件（扩展名/二进制已装/未安装/未关推荐）都在
// getMatchingLspPlugins 里；matches[0] 取最高优先的那个。
            const match = matches[0];
            if (match) {
              logForDebugging(`[useLspPluginRecommendation] Found match: ${match.pluginName} for ${filePath}`);
              setLspRecommendationShownThisSession(true);
              return {
                pluginId: match.pluginId,
                pluginName: match.pluginName,
                pluginDescription: match.description,
                fileExtension: extname(filePath),
                shownAt: Date.now()
// 命中即返回：shownAt 记下展示时刻，
// 供 no 分支的超时甄别使用。
              };
            }
          } catch (t3) {
// 单文件匹配失败只记日志继续：一个怪扩展名不该阻断整轮推荐。
            const error = t3;
            logError(error);
          }
        }
        return null;
      });
// 全部新文件都没命中 → 返回 null，不打扰。
    };
    t2 = [trackedFiles, tryResolve];
    $[1] = trackedFiles;
    $[2] = tryResolve;
    $[3] = t1;
    $[4] = t2;
  } else {
    t1 = $[3];
    t2 = $[4];
  }
  React.useEffect(t1, t2);
// 编译后的 useEffect：依赖 trackedFiles 与 tryResolve——
// 文件集合变了才重新评估。
  let t3;
  if ($[5] !== addNotification || $[6] !== clearRecommendation || $[7] !== recommendation) {
    t3 = response => {
      if (!recommendation) {
        return;
      }
      const {
        pluginId,
        pluginName,
        shownAt
      } = recommendation;
      logForDebugging(`[useLspPluginRecommendation] User response: ${response} for ${pluginName}`);
      bb60: switch (response) {
// 带标签的 switch（bb60）：四个 case 都要跳到同一个收尾
// clearRecommendation()，用标签 break 避免写四遍。
        case "yes":
          {
            installPluginAndNotify(pluginId, pluginName, "lsp-plugin", addNotification, async pluginData => {
              logForDebugging(`[useLspPluginRecommendation] Installing plugin: ${pluginId}`);
              const localSourcePath = typeof pluginData.entry.source === "string" ? join(pluginData.marketplaceInstallLocation, pluginData.entry.source) : undefined;
// 插件源可能是 marketplace 内的相对路径：join 成绝对路径，
// string 才 join（远程源不落地）。
              await cacheAndRegisterPlugin(pluginId, pluginData.entry, "user", undefined, localSourcePath);
              const settings = getSettingsForSource("userSettings");
              updateSettingsForSource("userSettings", {
// 安装即启用：缓存注册后把 enabledPlugins 里对应项置 true，
// 用户不用再去设置里手动开。
                enabledPlugins: {
                  ...settings?.enabledPlugins,
                  [pluginId]: true
                }
              });
              logForDebugging(`[useLspPluginRecommendation] Plugin installed: ${pluginId}`);
            });
            break bb60;
// yes 分支收尾：installPluginAndNotify 内部走完缓存+注册+
// 设置+通知，然后统一清推荐。
          }
        case "no":
          {
            const elapsed = Date.now() - shownAt;
// no 分支先算 elapsed：区分「用户点的 no」和「菜单超时的 no」。
            if (elapsed >= TIMEOUT_THRESHOLD_MS) {
              logForDebugging(`[useLspPluginRecommendation] Timeout detected (${elapsed}ms), incrementing ignored count`);
              incrementIgnoredCount();
            }
            break bb60;
// 超时拒绝计 ignored count——推荐系统据此降温；
// 真拒绝不计（那是明确的负反馈，走 never 分支）。
          }
        case "never":
          {
            addToNeverSuggest(pluginId);
// never：addToNeverSuggest 把这个插件永久拉黑，
// 比 ignored count 更强。
            break bb60;
          }
        case "disable":
          {
            saveGlobalConfig(_temp2);
          }
      }
      clearRecommendation();
// 公共收尾：无论选什么都清掉当前推荐——一次推荐一条，
// 下个文件重新触发。
    };
    $[5] = addNotification;
    $[6] = clearRecommendation;
    $[7] = recommendation;
    $[8] = t3;
  } else {
    t3 = $[8];
  }
  const handleResponse = t3;
// handleResponse 编译后从缓存槽取出，身份随
// addNotification/clearRecommendation/recommendation 变化。
  let t4;
  if ($[9] !== handleResponse || $[10] !== recommendation) {
    t4 = {
      recommendation,
      handleResponse
    };
    $[9] = handleResponse;
    $[10] = recommendation;
    $[11] = t4;
  } else {
    t4 = $[11];
  }
  return t4;
// 返回对象也进缓存槽：身份稳定，
// 消费者不会因新对象重渲染。
}
function _temp2(current) {
// disable 分支的配置写入：lspRecommendationDisabled 全局开关，
// 幂等（已是 true 就原样返回）。
  if (current.lspRecommendationDisabled) {
    return current;
  }
  return {
    ...current,
    lspRecommendationDisabled: true
  };
}
function _temp(s) {
// useAppState 的选择器编译期拆成独立函数：只取
// fileHistory.trackedFiles，窄订阅避免无关 state 变化触发重算。
  return s.fileHistory.trackedFiles;
}
// 原文件此处有一行 15396 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。