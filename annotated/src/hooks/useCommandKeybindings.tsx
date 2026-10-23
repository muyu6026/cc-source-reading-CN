import { c as _c } from "react/compiler-runtime";
/**
 * Component that registers keybinding handlers for command bindings.
 *
 * Must be rendered inside KeybindingSetup to have access to the keybinding context.
 * Reads "command:*" actions from the current keybinding configuration and registers
 * handlers that invoke the corresponding slash command via onSubmit.
 *
 * Commands triggered via keybinding are treated as "immediate" - they execute right
 * away and preserve the user's existing input text (the prompt is not cleared).
 */
// 块注释：命令行 keybinding 处理器——从 keybinding 配置读 command:* 动作，触发时提交对应 slash 命令（如 command:commit → /commit）；经 keybinding 视为「立即」执行且不清除用户输入（区别于普通输入）。
import { useMemo } from 'react';
import { useIsModalOverlayActive } from '../context/overlayContext.js';
import { useOptionalKeybindingContext } from '../keybindings/KeybindingContext.js';
import { useKeybindings } from '../keybindings/useKeybinding.js';
import type { PromptInputHelpers } from '../utils/handlePromptSubmit.js';
type Props = {
  // onSubmit accepts additional parameters beyond what we pass here,
  // so we use a rest parameter to allow any additional args
  onSubmit: (input: string, helpers: PromptInputHelpers, ...rest: [speculationAccept?: undefined, options?: {
    fromKeybinding?: boolean;
  }]) => void;
  /** Set to false to disable command keybindings (e.g., when a dialog is open) */
  isActive?: boolean;
};
const NOOP_HELPERS: PromptInputHelpers = {
  setCursorOffset: () => {},
  clearBuffer: () => {},
  resetHistory: () => {}
};

/**
 * Registers keybinding handlers for all "command:*" actions found in the
 * user's keybinding configuration. When triggered, each handler submits
 * the corresponding slash command (e.g., "command:commit" submits "/commit").
 */
export function CommandKeybindingHandlers(t0) {
// React Compiler 产物：函数名保留但参数被抹平成单参数 t0，39-42 行在内部解构出 onSubmit / isActive；t1 是 isActive 的可选解构（缺省 true）。
  const $ = _c(8);
  const {
    onSubmit,
    isActive: t1
  } = t0;
  const isActive = t1 === undefined ? true : t1;
  const keybindingContext = useOptionalKeybindingContext();
// 两个 context 依赖：useOptionalKeybindingContext（可选，缺失则整 hook 无 keybinding 可用）与 useIsModalOverlayActive（对话框覆盖态）；二者都要求组件渲染在 KeybindingSetup 之内才有 context。
  const isModalOverlayActive = useIsModalOverlayActive();
  let t2;
  bb0: {
    if (!keybindingContext) {
      let t3;
      if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
        t3 = new Set();
        $[0] = t3;
      } else {
        t3 = $[0];
      }
      t2 = t3;
      break bb0;
    }
    let actions;
    if ($[1] !== keybindingContext.bindings) {
// bb0 是 React Compiler 生成的 basic block 标签；处理 keybindingContext 缺失的兜底分支——返回空 Set（$[0] 缓存），不注册任何 command handler。
      actions = new Set();
      for (const binding of keybindingContext.bindings) {
        if (binding.action?.startsWith("command:")) {
          actions.add(binding.action);
        }
      }
      $[1] = keybindingContext.bindings;
      $[2] = actions;
    } else {
      actions = $[2];
    }
    t2 = actions;
  }
  const commandActions = t2;
  let map;
  if ($[3] !== commandActions || $[4] !== onSubmit) {
    map = {};
// memo 化：仅当 commandActions 或 onSubmit 变化（$[3]/$[4] 缓存）才重建 handlers map；每个 action 生成 `onSubmit('/'+commandName, NOOP_HELPERS, undefined, {fromKeybinding:true})`，slice(8) 去掉 command: 前缀。
    for (const action of commandActions) {
      const commandName = action.slice(8);
      map[action] = () => {
        onSubmit(`/${commandName}`, NOOP_HELPERS, undefined, {
          fromKeybinding: true
        });
      };
    }
    $[3] = commandActions;
    $[4] = onSubmit;
    $[5] = map;
  } else {
    map = $[5];
  }
  const handlers = map;
  const t3 = isActive && !isModalOverlayActive;
  let t4;
// 门控：t3 = isActive && !isModalOverlayActive——对话框打开或 hook 非激活时不注册 keybinding，避免模态里误触 command 快捷键。
  if ($[6] !== t3) {
    t4 = {
      context: "Chat",
      isActive: t3
    };
    $[6] = t3;
    $[7] = t4;
  } else {
    t4 = $[7];
  }
  useKeybindings(handlers, t4);
// useKeybindings 把 handlers map 注册进全局 keybinding 系统（context: Chat）；组件自身返回 null，纯副作用。
  return null;
}
// 原文件此处有一行 7756 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。