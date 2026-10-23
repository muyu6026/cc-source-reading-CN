import { c as _c } from "react/compiler-runtime";
import { useEffect } from 'react';
import { useNotifications } from 'src/context/notifications.js';
import { useAppState, useSetAppState } from 'src/state/AppState.js';
import { type CooldownReason, isFastModeEnabled, onCooldownExpired, onCooldownTriggered, onFastModeOverageRejection, onOrgFastModeChanged } from 'src/utils/fastMode.js';
import { formatDuration } from 'src/utils/format.js';
import { getIsRemoteMode } from '../../bootstrap/state.js';
// 四类事件各一个通知 key，互不覆盖；冷却开始/结束用
// invalidates 互相关联（见下）。
const COOLDOWN_STARTED_KEY = 'fast-mode-cooldown-started';
const COOLDOWN_EXPIRED_KEY = 'fast-mode-cooldown-expired';
const ORG_CHANGED_KEY = 'fast-mode-org-changed';
const OVERAGE_REJECTED_KEY = 'fast-mode-overage-rejected';
export function useFastModeNotification() {
// fast mode 通知总装。三个 effect 分别订阅：组织级开关变化、
// 超额被拒、冷却开始/结束。所有 effect 都以 getIsRemoteMode 远程模式
// 静默退出——远程会话由别的渠道展示这些状态。
  const $ = _c(13);
  const {
    addNotification
  } = useNotifications();
  const isFastMode = useAppState(_temp);
  const setAppState = useSetAppState();
  let t0;
  let t1;
  if ($[0] !== addNotification || $[1] !== isFastMode || $[2] !== setAppState) {
    t0 = () => {
      if (getIsRemoteMode()) {
        return;
      }
      if (!isFastModeEnabled()) {
        return;
      }
// 组织管理员开关 fast mode：打开时提示「可用了」，
// 关闭时若本地还在用 fastMode，顺手把 appState 里的开关拨回去，
// 保持 UI 状态与服务端一致。
      return onOrgFastModeChanged(orgEnabled => {
        if (orgEnabled) {
          addNotification({
            key: ORG_CHANGED_KEY,
            color: "fastMode",
            priority: "immediate",
            text: "Fast mode is now available \xB7 /fast to turn on"
          });
        } else {
          if (isFastMode) {
            setAppState(_temp2);
            addNotification({
              key: ORG_CHANGED_KEY,
              color: "warning",
              priority: "immediate",
              text: "Fast mode has been disabled by your organization"
            });
          }
        }
      });
    };
    t1 = [addNotification, isFastMode, setAppState];
    $[0] = addNotification;
    $[1] = isFastMode;
    $[2] = setAppState;
    $[3] = t0;
    $[4] = t1;
  } else {
    t0 = $[3];
    t1 = $[4];
  }
  useEffect(t0, t1);
  let t2;
  let t3;
  if ($[5] !== addNotification || $[6] !== setAppState) {
    t2 = () => {
      if (getIsRemoteMode()) {
        return;
      }
      if (!isFastModeEnabled()) {
        return;
      }
      return onFastModeOverageRejection(message => {
        setAppState(_temp3);
        addNotification({
          key: OVERAGE_REJECTED_KEY,
          color: "warning",
          priority: "immediate",
          text: message
        });
      });
    };
    t3 = [addNotification, setAppState];
    $[5] = addNotification;
    $[6] = setAppState;
    $[7] = t2;
    $[8] = t3;
  } else {
    t2 = $[7];
    t3 = $[8];
  }
  useEffect(t2, t3);
  let t4;
  let t5;
  if ($[9] !== addNotification || $[10] !== isFastMode) {
    t4 = () => {
      if (getIsRemoteMode()) {
        return;
      }
      if (!isFastMode) {
        return;
      }
// 冷却开始：算出「还有多久恢复」，文案由 getCooldownMessage
// 按原因（过载/限流）生成。
      const unsubTriggered = onCooldownTriggered((resetAt, reason) => {
        const resetIn = formatDuration(resetAt - Date.now(), {
          hideTrailingZeros: true
        });
        const message_0 = getCooldownMessage(reason, resetIn);
        addNotification({
          key: COOLDOWN_STARTED_KEY,
// invalidates 互斥键：冷却开始通知会顶掉冷却结束通知
// （反之亦然），保证同一时刻只有一条相关通知在列。
          invalidates: [COOLDOWN_EXPIRED_KEY],
          text: message_0,
          color: "warning",
          priority: "immediate"
        });
      });
// 冷却结束：恢复文案用 fastMode 色。两个订阅在 cleanup 里
// 成对退订，防止 effect 重跑后旧回调双触发。
      const unsubExpired = onCooldownExpired(() => {
        addNotification({
          key: COOLDOWN_EXPIRED_KEY,
          invalidates: [COOLDOWN_STARTED_KEY],
          color: "fastMode",
          text: "Fast limit reset \xB7 now using fast mode",
          priority: "immediate"
        });
      });
      return () => {
        unsubTriggered();
        unsubExpired();
      };
    };
    t5 = [addNotification, isFastMode];
    $[9] = addNotification;
    $[10] = isFastMode;
    $[11] = t4;
    $[12] = t5;
  } else {
    t4 = $[11];
    t5 = $[12];
  }
  useEffect(t4, t5);
}
// 两个匿名 reducer 都是把 fastMode 置 false
// （组织关闭 / 超额被拒两条路径殊途同归）。
function _temp3(prev_0) {
  return {
    ...prev_0,
    fastMode: false
  };
}
function _temp2(prev) {
  return {
    ...prev,
    fastMode: false
  };
}
function _temp(s) {
  return s.fastMode;
}
// 冷却文案工厂：overloaded 与 rate_limit 两种原因的措辞。
// switch 无 default——CooldownReason 联合类型在编译期收口。
function getCooldownMessage(reason: CooldownReason, resetIn: string): string {
  switch (reason) {
    case 'overloaded':
      return `Fast mode overloaded and is temporarily unavailable · resets in ${resetIn}`;
    case 'rate_limit':
      return `Fast limit reached and temporarily disabled · resets in ${resetIn}`;
  }
}
// 原文件此处有一行 10520 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。