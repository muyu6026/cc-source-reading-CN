import { c as _c } from "react/compiler-runtime";
// 导入 React 编译器运行时的 `_c` 缓存辅助；编译器会把组件里稳定的中间值按槽位缓存，避免每次渲染重复计算。
import React, { useMemo, useState } from 'react';
import type { CommandResultDisplay, LocalJSXCommandContext } from '../../commands.js';
import { type OptionWithDescription, Select } from '../../components/CustomSelect/select.js';
import { Dialog } from '../../components/design-system/Dialog.js';
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js';
import { logEvent } from '../../services/analytics/index.js';
import { useClaudeAiLimits } from '../../services/claudeAiLimitsHook.js';
import type { ToolUseContext } from '../../Tool.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { getOauthAccountInfo, getRateLimitTier, getSubscriptionType } from '../../utils/auth.js';
import { hasClaudeAiBillingAccess } from '../../utils/billing.js';
import { call as extraUsageCall } from '../extra-usage/extra-usage.js';
import { extraUsage } from '../extra-usage/index.js';
import upgrade from '../upgrade/index.js';
import { call as upgradeCall } from '../upgrade/upgrade.js';
type RateLimitOptionsMenuOptionType = 'upgrade' | 'extra-usage' | 'cancel';
// 菜单选项类型：升级套餐、开启超额用量、或取消并等待限额重置。
type RateLimitOptionsMenuProps = {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay | undefined;
  } | undefined) => void;
  context: ToolUseContext & LocalJSXCommandContext;
};
// 限流时弹出的选项菜单组件：根据订阅类型、超额用量开关与特性标决定是否展示升级与超额入口。
function RateLimitOptionsMenu(t0) {
  const $ = _c(25);
// `$` 是编译器生成的缓存对象；`_c(25)` 表示本组件预留 25 个缓存槽位，后续 `$` 下标与之对应。
  const {
    onDone,
    context
  } = t0;
  const [subCommandJSX, setSubCommandJSX] = useState(null);
  const claudeAiLimits = useClaudeAiLimits();
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = getSubscriptionType();
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  const subscriptionType = t1;
// 编译器缓存三件套：先用哨兵 `react.memo_cache_sentinel` 判断槽位是否首次计算，是则算并存回 `$` 下标，否则直接读缓存值。此模式贯穿整个组件。
  let t2;
  if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = getRateLimitTier();
    $[1] = t2;
  } else {
    t2 = $[1];
  }
  const rateLimitTier = t2;
  const hasExtraUsageEnabled = getOauthAccountInfo()?.hasExtraUsageEnabled === true;
// 是否开启超额用量（extra usage）功能，由 OAuth 账户信息与特性标共同决定。
  const isMax = subscriptionType === "max";
  const isMax20x = isMax && rateLimitTier === "default_claude_max_20x";
  const isTeamOrEnterprise = subscriptionType === "team" || subscriptionType === "enterprise";
  const buyFirst = getFeatureValue_CACHED_MAY_BE_STALE("tengu_jade_anvil_4", false);
  let t3;
  bb0: {
    let actionOptions;
    if ($[2] !== claudeAiLimits.overageDisabledReason || $[3] !== claudeAiLimits.overageStatus) {
      actionOptions = [];
      if (extraUsage.isEnabled()) {
// 超额用量入口：团队版需管理员审批，组织额度耗尽时走另一套提示，二者都成立才把该选项加入菜单。
        const hasBillingAccess = hasClaudeAiBillingAccess();
        const needsToRequestFromAdmin = isTeamOrEnterprise && !hasBillingAccess;
        const isOrgSpendCapDepleted = claudeAiLimits.overageDisabledReason === "out_of_credits" || claudeAiLimits.overageDisabledReason === "org_level_disabled_until" || claudeAiLimits.overageDisabledReason === "org_service_zero_credit_limit";
        if (needsToRequestFromAdmin && isOrgSpendCapDepleted) {} else {
          const isOverageState = claudeAiLimits.overageStatus === "rejected" || claudeAiLimits.overageStatus === "allowed_warning";
          let label;
          if (needsToRequestFromAdmin) {
            label = isOverageState ? "Request more" : "Request extra usage";
          } else {
            label = hasExtraUsageEnabled ? "Add funds to continue with extra usage" : "Switch to extra usage";
          }
          let t4;
          if ($[5] !== label) {
            t4 = {
              label,
              value: "extra-usage"
            };
            $[5] = label;
            $[6] = t4;
          } else {
            t4 = $[6];
          }
          actionOptions.push(t4);
        }
      }
      if (!isMax20x && !isTeamOrEnterprise && upgrade.isEnabled()) {
// 非 Max 20x、非团队或企业版且升级功能开启时，才展示「升级套餐」选项。
        let t4;
        if ($[7] === Symbol.for("react.memo_cache_sentinel")) {
          t4 = {
            label: "Upgrade your plan",
            value: "upgrade"
          };
          $[7] = t4;
        } else {
          t4 = $[7];
        }
        actionOptions.push(t4);
      }
      $[2] = claudeAiLimits.overageDisabledReason;
      $[3] = claudeAiLimits.overageStatus;
      $[4] = actionOptions;
    } else {
      actionOptions = $[4];
    }
    let t4;
    if ($[8] === Symbol.for("react.memo_cache_sentinel")) {
      t4 = {
        label: "Stop and wait for limit to reset",
        value: "cancel"
      };
      $[8] = t4;
    } else {
      t4 = $[8];
    }
    const cancelOption = t4;
    if (buyFirst) {
// `buyFirst` 特性标决定选项顺序：开启时把取消项放最后（鼓励先选升级或超额），否则取消项置顶。
      let t5;
      if ($[9] !== actionOptions) {
        t5 = [...actionOptions, cancelOption];
        $[9] = actionOptions;
        $[10] = t5;
      } else {
        t5 = $[10];
      }
      t3 = t5;
      break bb0;
    }
    let t5;
    if ($[11] !== actionOptions) {
      t5 = [cancelOption, ...actionOptions];
      $[11] = actionOptions;
      $[12] = t5;
    } else {
      t5 = $[12];
    }
    t3 = t5;
  }
  const options = t3;
  let t4;
  if ($[13] !== onDone) {
// `handleCancel`：记录取消事件并把控制权交还，显示标记用 skip。
    t4 = function handleCancel() {
      logEvent("tengu_rate_limit_options_menu_cancel", {});
      onDone(undefined, {
        display: "skip"
      });
    };
    $[13] = onDone;
    $[14] = t4;
  } else {
    t4 = $[14];
  }
  const handleCancel = t4;
  let t5;
  if ($[15] !== context || $[16] !== handleCancel || $[17] !== onDone) {
// `handleSelect`：按用户选择派发到升级、超额用量或取消三条分支，前两者会异步加载子命令界面。
    t5 = function handleSelect(value) {
      if (value === "upgrade") {
        logEvent("tengu_rate_limit_options_menu_select_upgrade", {});
        upgradeCall(onDone, context).then(jsx => {
          if (jsx) {
            setSubCommandJSX(jsx);
          }
        });
      } else {
        if (value === "extra-usage") {
          logEvent("tengu_rate_limit_options_menu_select_extra_usage", {});
          extraUsageCall(onDone, context).then(jsx_0 => {
            if (jsx_0) {
              setSubCommandJSX(jsx_0);
            }
          });
        } else {
          if (value === "cancel") {
            handleCancel();
          }
        }
      }
    };
    $[15] = context;
    $[16] = handleCancel;
    $[17] = onDone;
    $[18] = t5;
  } else {
    t5 = $[18];
  }
  const handleSelect = t5;
  if (subCommandJSX) {
// 若已切换到子命令界面（升级或超额用量），直接渲染该子界面，不再显示选项菜单。
    return subCommandJSX;
  }
  let t6;
  if ($[19] !== handleSelect || $[20] !== options) {
    t6 = <Select options={options} onChange={handleSelect} visibleOptionCount={options.length} />;
// 把选项列表渲染成下拉选择框，可见项数量等于选项总数。
    $[19] = handleSelect;
    $[20] = options;
    $[21] = t6;
  } else {
    t6 = $[21];
  }
  let t7;
  if ($[22] !== handleCancel || $[23] !== t6) {
    t7 = <Dialog title="What do you want to do?" onCancel={handleCancel} color="suggestion">{t6}</Dialog>;
// 用对话框包裹选择框，标题询问用户想做什么。
    $[22] = handleCancel;
    $[23] = t6;
    $[24] = t7;
  } else {
    t7 = $[24];
  }
  return t7;
}
// 命令入口：直接渲染选项菜单组件，把 `onDone` 与上下文透传给组件。
export async function call(onDone: LocalJSXCommandOnDone, context: ToolUseContext & LocalJSXCommandContext): Promise<React.ReactNode> {
  return <RateLimitOptionsMenu onDone={onDone} context={context} />;
}
// 原文件此处有一行 16860 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。