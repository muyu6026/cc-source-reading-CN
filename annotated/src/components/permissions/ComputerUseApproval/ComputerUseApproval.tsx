// 本文件是「电脑操作」能力的授权弹窗，结构是两块面板二选一：系统权限缺失时显示面板一（引导用户去系统设置里打开辅助功能与屏幕录制），否则显示面板二（应用白名单与附加权限）。两块面板的交互模型完全不同——面板一只负责跳转与重试、不产生任何授权；面板二产生完整的授权结果。这种「同一个入口、两种互斥形态」的写法，注释里直接叫分派器（dispatcher），读的时候先建立这个概念，后面就顺了。
import { c as _c } from "react/compiler-runtime";
import { getSentinelCategory } from '@ant/computer-use-mcp/sentinelApps';
import type { CuPermissionRequest, CuPermissionResponse } from '@ant/computer-use-mcp/types';
import { DEFAULT_GRANT_FLAGS } from '@ant/computer-use-mcp/types';
import figures from 'figures';
import * as React from 'react';
import { useMemo, useState } from 'react';
import { Box, Text } from '../../../ink.js';
import { execFileNoThrow } from '../../../utils/execFileNoThrow.js';
import { plural } from '../../../utils/stringUtils.js';
import type { OptionWithDescription } from '../../CustomSelect/select.js';
import { Select } from '../../CustomSelect/select.js';
import { Dialog } from '../../design-system/Dialog.js';
// 属性只有两个：请求与完成回调。所有输入细节（应用清单、请求的权限位、TCC 状态、是否需要隐藏其它应用）都挂在请求对象上，组件完全无状态地从请求派生界面——这是权限类弹窗的通用形态，因为它只出现一次、生命周期极短。
type ComputerUseApprovalProps = {
  request: CuPermissionRequest;
  onDone: (response: CuPermissionResponse) => void;
};
// 「全部拒绝」的常量响应：授权清单空、拒绝清单也空、权限位用默认值。注意拒绝清单也是空的——这里没有逐条声明「拒绝了哪些」，因为调用方在收到空授权时就已经知道结论了。这个常量的存在让「取消」与「明确拒绝」两条路径能共用同一个返回值。
const DENY_ALL_RESPONSE: CuPermissionResponse = {
  granted: [],
  denied: [],
  flags: DEFAULT_GRANT_FLAGS
};

// 分派依据的注释写得很清楚：请求里带系统权限状态时，说明辅助功能或屏幕录制缺失，此时应用白名单毫无意义——用户就算逐个勾选也跑不起来。所以先修系统权限、再谈应用授权。这个顺序判断是本文件唯一的全局性决策。
/**
 * Two-panel dispatcher. When `request.tccState` is present, macOS permissions
 * (Accessibility / Screen Recording) are missing and the app list is
 * irrelevant — show a TCC panel that opens System Settings. Otherwise show the
 * app allowlist + grant-flags panel.
 */
export function ComputerUseApproval(t0) {
  const $ = _c(3);
  const {
    request,
    onDone
  } = t0;
  let t1;
  if ($[0] !== onDone || $[1] !== request) {
// 分派实现只有一行三元：有系统权限状态就渲染授权面板一，并在完成时返回全部拒绝（因为此时用户根本没做授权决定）；否则渲染应用白名单面板，把回调原样透传。
    t1 = request.tccState ? <ComputerUseTccPanel tccState={request.tccState} onDone={() => onDone(DENY_ALL_RESPONSE)} /> : <ComputerUseAppListPanel request={request} onDone={onDone} />;
    $[0] = onDone;
    $[1] = request;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  return t1;
}

// ── TCC panel ─────────────────────────────────────────────────────────────

// 面板一的三个选项：打开辅助功能设置、打开屏幕录制设置、重试。前两个是系统设置的深链，第三个是回到应用里重新检测。注意没有「取消」选项——取消由弹窗的退出键承担，见下面的取消回调。
type TccOption = 'open_accessibility' | 'open_screen_recording' | 'retry';
function ComputerUseTccPanel(t0) {
  const $ = _c(26);
  const {
    tccState,
    onDone
  } = t0;
  let opts;
// 选项数组按「缺什么给什么」拼装：缺辅助功能才给对应项、缺屏幕录制才给对应项，重试项恒在最后。这种按状态稀疏生成的选项，比固定三项加禁用标记更简洁，但也意味着用户看到的项数会变化——所以重试永远在最后，位置可预期。
  if ($[0] !== tccState.accessibility || $[1] !== tccState.screenRecording) {
    opts = [];
    if (!tccState.accessibility) {
      let t1;
      if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
        t1 = {
          label: "Open System Settings \u2192 Accessibility",
          value: "open_accessibility"
        };
        $[3] = t1;
      } else {
        t1 = $[3];
      }
      opts.push(t1);
    }
    if (!tccState.screenRecording) {
      let t1;
      if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
        t1 = {
          label: "Open System Settings \u2192 Screen Recording",
          value: "open_screen_recording"
        };
        $[4] = t1;
      } else {
        t1 = $[4];
      }
      opts.push(t1);
    }
    let t1;
    if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
      t1 = {
        label: "Try again",
        value: "retry"
      };
      $[5] = t1;
    } else {
      t1 = $[5];
    }
// 重试项无条件追加在末尾。它存在的意义是让用户从系统设置回来之后有个明确的回头路，而不是必须退出弹窗、重新发起一次请求。
    opts.push(t1);
    $[0] = tccState.accessibility;
    $[1] = tccState.screenRecording;
    $[2] = opts;
  } else {
    opts = $[2];
  }
  const options = opts;
  let t1;
  if ($[6] !== onDone) {
// 三个分支全部用自己的 return 结束，其中前两个只是打开系统设置就直接返回——注意它们不调用完成回调，因为打开设置并不等于作出决定，弹窗必须留在原地等用户回来重试。这个「不完成」是刻意设计的。
    t1 = function onChange(value) {
      switch (value) {
        case "open_accessibility":
          {
// 深链用的是系统设置的私有 URL 协议，后面挂着具体的隐私面板标识。这类链接在不同系统版本上可能失效，所以用了不抛错的执行函数——打开失败也不该让弹窗崩掉，用户仍可手动去设置里找。
            execFileNoThrow("open", ["x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"], {
              useCwd: false
            });
            return;
          }
        case "open_screen_recording":
          {
            execFileNoThrow("open", ["x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"], {
              useCwd: false
            });
            return;
          }
// 重试分支才调用完成回调，且不传参数——调用方收到后应该重新检测系统权限，若已授予就继续原流程。这是面板一唯一会「结束」的路径。
        case "retry":
          {
            onDone();
            return;
          }
      }
    };
    $[6] = onDone;
    $[7] = t1;
  } else {
    t1 = $[7];
  }
  const onChange = t1;
// 两项权限各自的状态文案：授予给对勾、未授予给叉号。这里用了图形常量而不是颜色，因为颜色在部分终端不可用，而对勾与叉号在任何终端都能看出区别。
  const t2 = tccState.accessibility ? `${figures.tick} granted` : `${figures.cross} not granted`;
  let t3;
  if ($[8] !== t2) {
    t3 = <Text>Accessibility:{" "}{t2}</Text>;
    $[8] = t2;
    $[9] = t3;
  } else {
    t3 = $[9];
  }
  const t4 = tccState.screenRecording ? `${figures.tick} granted` : `${figures.cross} not granted`;
  let t5;
  if ($[10] !== t4) {
    t5 = <Text>Screen Recording:{" "}{t4}</Text>;
    $[10] = t4;
    $[11] = t5;
  } else {
    t5 = $[11];
  }
  let t6;
  if ($[12] !== t3 || $[13] !== t5) {
    t6 = <Box flexDirection="column">{t3}{t5}</Box>;
    $[12] = t3;
    $[13] = t5;
    $[14] = t6;
  } else {
    t6 = $[14];
  }
  let t7;
  if ($[15] === Symbol.for("react.memo_cache_sentinel")) {
// 说明文案里那句「授予屏幕录制后可能需要重启」是很实在的一条提示——系统对屏幕录制权限的生效时机有额外要求，不写这句用户会以为授权没成功。这类平台特有的坑必须写进界面，写进文档没人看。
    t7 = <Text dimColor={true}>Grant the missing permissions in System Settings, then select "Try again". macOS may require you to restart Claude Code after granting Screen Recording.</Text>;
    $[15] = t7;
  } else {
    t7 = $[15];
  }
  let t8;
  if ($[16] !== onChange || $[17] !== onDone || $[18] !== options) {
    t8 = <Select options={options} onChange={onChange} onCancel={onDone} />;
    $[16] = onChange;
    $[17] = onDone;
    $[18] = options;
    $[19] = t8;
  } else {
    t8 = $[19];
  }
  let t9;
  if ($[20] !== t6 || $[21] !== t8) {
    t9 = <Box flexDirection="column" paddingX={1} paddingY={1} gap={1}>{t6}{t7}{t8}</Box>;
    $[20] = t6;
    $[21] = t8;
    $[22] = t9;
  } else {
    t9 = $[22];
  }
  let t10;
  if ($[23] !== onDone || $[24] !== t9) {
// 弹窗标题直接点明「需要系统权限」，取消回调就是完成回调——退出等于放弃本次请求，返回的仍是不授权。
    t10 = <Dialog title="Computer Use needs macOS permissions" onCancel={onDone}>{t9}</Dialog>;
    $[23] = onDone;
    $[24] = t9;
    $[25] = t10;
  } else {
    t10 = $[25];
  }
  return t10;
}

// ── App allowlist panel ───────────────────────────────────────────────────

type AppListOption = 'allow_all' | 'deny';
// 三类「哨兵应用」的警告文案：能当 shell 用、能读写任意文件、能改系统设置。这句话是授权界面里最重要的信息——用户看到的只是一个应用名，但它的能力可能等于把整台机器交出去。映射表用类别做键，说明分类是中心化维护的，不在这里临时判断。
const SENTINEL_WARNING: Record<NonNullable<ReturnType<typeof getSentinelCategory>>, string> = {
  shell: 'equivalent to shell access',
  filesystem: 'can read/write any file',
  system_settings: 'can change system settings'
};
function ComputerUseAppListPanel(t0) {
  const $ = _c(48);
  const {
    request,
    onDone
  } = t0;
  let t1;
// 勾选状态是一次性初始化的集合：把所有「已解析且尚未授权」的应用标识放进去，默认全选。用状态而不是派生值，说明这个组件原本设计了可交互的勾选——但产物里只见 Set 而不见增删，说明当前版本把勾选做成了只读展示，用默认全选代替了逐项勾选。这是一个值得注意的「半成品形态」：数据结构保留了扩展能力，界面先按全选走。
  if ($[0] !== request.apps) {
    t1 = () => new Set(request.apps.flatMap(_temp));
    $[0] = request.apps;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
// 取出集合后只读使用，没有对应的写入口。这与上一条判断互相印证——授权粒度目前是「全选或全不选」，逐项勾选是预留能力。
  const [checked] = useState(t1);
  let t2;
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = ["clipboardRead", "clipboardWrite", "systemKeyCombos"];
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  const ALL_FLAG_KEYS = t2;
  let t3;
// 请求的附加权限位按固定键序筛出真正被请求的那些，得到一份有序的键名数组。固定键序而不是遍历对象，是为了让「附加权限」列表的展示顺序稳定——对象键序在不同引擎上不保证。
  if ($[3] !== request.requestedFlags) {
    t3 = ALL_FLAG_KEYS.filter(k => request.requestedFlags[k]);
    $[3] = request.requestedFlags;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  const requestedFlagKeys = t3;
  const t4 = checked.size;
  let t5;
  if ($[5] !== checked.size) {
    t5 = plural(checked.size, "app");
    $[5] = checked.size;
    $[6] = t5;
  } else {
    t5 = $[6];
  }
// 允许项的文案里带上了应用数量，且用了复数辅助函数。数目来自上面那个集合，所以文案与实际授权范围严格一致，不会出现「说了三个其实授了五个」。
  const t6 = `Allow for this session (${t4} ${t5})`;
  let t7;
  if ($[7] !== t6) {
    t7 = {
      label: t6,
      value: "allow_all"
    };
    $[7] = t6;
    $[8] = t7;
  } else {
    t7 = $[8];
  }
  let t8;
// 拒绝项的文案里嵌了加粗的退出键提示，且标签本身是一个节点而不是字符串——这一项要让用户知道「拒绝之后还能告诉模型该怎么做」，所以文案更长、信息更多。选项标签允许是节点，是这个下拉框组件的关键能力。
  if ($[9] === Symbol.for("react.memo_cache_sentinel")) {
    t8 = {
      label: <Text>Deny, and tell Claude what to do differently <Text bold={true}>(esc)</Text></Text>,
      value: "deny"
    };
    $[9] = t8;
  } else {
    t8 = $[9];
  }
  let t9;
  if ($[10] !== t7) {
    t9 = [t7, t8];
    $[10] = t7;
    $[11] = t9;
  } else {
    t9 = $[11];
  }
  const options = t9;
  let t10;
  if ($[12] !== checked || $[13] !== onDone || $[14] !== request.apps || $[15] !== requestedFlagKeys) {
// 响应构造分两份：拒绝时直接返回共享的常量；允许时才逐项算出授权清单、拒绝清单与权限位。注意「拒绝清单」在允许路径下并不为空——里面装的是没被勾选、或压根没安装的应用，这样调用方才能知道哪些应用需要下次再问。
    t10 = function respond(allow) {
      if (!allow) {
        onDone(DENY_ALL_RESPONSE);
        return;
      }
      const now = Date.now();
// 授权清单：只收「已解析且被勾选」的应用，逐条带上标识、显示名与授权时间。时间取一次当前时刻给所有条目共用，而不是逐条取，这样同一批授权的时间戳完全一致，便于后续按批次判断。
      const granted = request.apps.flatMap(a_0 => a_0.resolved && checked.has(a_0.resolved.bundleId) ? [{
        bundleId: a_0.resolved.bundleId,
        displayName: a_0.resolved.displayName,
        grantedAt: now
      }] : []);
      const denied = request.apps.filter(a_1 => !a_1.resolved || !checked.has(a_1.resolved.bundleId)).map(_temp2);
// 权限位是默认值与「本次请求的键全置真」的合并。合并顺序很关键——默认值在前，请求的键在后，所以请求过的位被打开、没请求的位保持默认。
      const flags = {
        ...DEFAULT_GRANT_FLAGS,
        ...Object.fromEntries(requestedFlagKeys.map(_temp3))
      };
      onDone({
        granted,
        denied,
        flags
      });
    };
    $[12] = checked;
    $[13] = onDone;
    $[14] = request.apps;
    $[15] = requestedFlagKeys;
    $[16] = t10;
  } else {
    t10 = $[16];
  }
  const respond = t10;
  let t11;
  if ($[17] !== respond) {
    t11 = () => respond(false);
    $[17] = respond;
    $[18] = t11;
  } else {
    t11 = $[18];
  }
  let t12;
// 请求自带的说明文案可有可无，有就压暗显示在最上方。这是模型给出的「为什么要控制这些应用」的解释，放在列表之前而不是之后，因为用户是在读这段话的过程中做决定的。
  if ($[19] !== request.reason) {
    t12 = request.reason ? <Text dimColor={true}>{request.reason}</Text> : null;
    $[19] = request.reason;
    $[20] = t12;
  } else {
    t12 = $[20];
  }
  let t13;
  if ($[21] !== checked || $[22] !== request.apps) {
    let t14;
    if ($[24] !== checked) {
      t14 = a_3 => {
        const resolved = a_3.resolved;
        if (!resolved) {
// 没安装的应用：用空心圆点、压暗、并注明未安装。它仍然出现在列表里，是因为用户需要知道模型想用什么却用不上——这个信息对判断模型意图有帮助，直接过滤掉反而丢信息。
          return <Text key={a_3.requestedName} dimColor={true}>{"  "}{figures.circle} {a_3.requestedName}{" "}<Text dimColor={true}>(not installed)</Text></Text>;
        }
        if (a_3.alreadyGranted) {
          return <Text key={resolved.bundleId} dimColor={true}>{"  "}{figures.tick} {resolved.displayName}{" "}<Text dimColor={true}>(already granted)</Text></Text>;
        }
        const sentinel = getSentinelCategory(resolved.bundleId);
        const isChecked = checked.has(resolved.bundleId);
// 正常应用的两种状态：已勾选显示实心圆点、未勾选显示空心圆点；若该应用属于哨兵类别，再在下一行加一条加粗警告。这里用两行而不是把警告拼在同一行，是为了让警告在视觉上无法被忽略。
        return <Box key={resolved.bundleId} flexDirection="column"><Text>{"  "}{isChecked ? figures.circleFilled : figures.circle}{" "}{resolved.displayName}</Text>{sentinel ? <Text bold={true}>{"    "}{figures.warning} {SENTINEL_WARNING[sentinel]}</Text> : null}</Box>;
      };
      $[24] = checked;
      $[25] = t14;
    } else {
      t14 = $[25];
    }
    t13 = request.apps.map(t14);
    $[21] = checked;
    $[22] = request.apps;
    $[23] = t13;
  } else {
    t13 = $[23];
  }
  let t14;
  if ($[26] !== t13) {
    t14 = <Box flexDirection="column">{t13}</Box>;
    $[26] = t13;
    $[27] = t14;
  } else {
    t14 = $[27];
  }
  let t15;
// 附加权限段：只有在真的请求了附加权限时才出现，逐条以圆点列出。键名直接用英文标识而不是翻成中文，因为它们是协议字段，翻译反而让排查变难。
  if ($[28] !== requestedFlagKeys) {
    t15 = requestedFlagKeys.length > 0 ? <Box flexDirection="column"><Text dimColor={true}>Also requested:</Text>{requestedFlagKeys.map(_temp4)}</Box> : null;
    $[28] = requestedFlagKeys;
    $[29] = t15;
  } else {
    t15 = $[29];
  }
  let t16;
// 「还有几个应用会被隐藏」的提示。这是电脑操作能力的一个副作用——它工作时会把别的应用藏起来，用户有权事先知道。提示里同样用了复数辅助函数，避免出现「1 个应用」这种别扭文案。
  if ($[30] !== request.willHide) {
    t16 = request.willHide && request.willHide.length > 0 ? <Text dimColor={true}>{request.willHide.length} other{" "}{plural(request.willHide.length, "app")} will be hidden while Claude works.</Text> : null;
    $[30] = request.willHide;
    $[31] = t16;
  } else {
    t16 = $[31];
  }
  let t17;
  let t18;
  if ($[32] !== respond) {
    t17 = v => respond(v === "allow_all");
    t18 = () => respond(false);
    $[32] = respond;
    $[33] = t17;
    $[34] = t18;
  } else {
    t17 = $[33];
    t18 = $[34];
  }
  let t19;
// 下拉框的两个回调：选中把选项值翻成布尔再交给响应构造，取消恒为拒绝。注意这里没有「允许部分」的路径，与上面「勾选只读、默认全选」的判断一致。
  if ($[35] !== options || $[36] !== t17 || $[37] !== t18) {
    t19 = <Select options={options} onChange={t17} onCancel={t18} />;
    $[35] = options;
    $[36] = t17;
    $[37] = t18;
    $[38] = t19;
  } else {
    t19 = $[38];
  }
  let t20;
  if ($[39] !== t12 || $[40] !== t14 || $[41] !== t15 || $[42] !== t16 || $[43] !== t19) {
    t20 = <Box flexDirection="column" paddingX={1} paddingY={1} gap={1}>{t12}{t14}{t15}{t16}{t19}</Box>;
    $[39] = t12;
    $[40] = t14;
    $[41] = t15;
    $[42] = t16;
    $[43] = t19;
    $[44] = t20;
  } else {
    t20 = $[44];
  }
  let t21;
  if ($[45] !== t11 || $[46] !== t20) {
    t21 = <Dialog title="Computer Use wants to control these apps" onCancel={t11}>{t20}</Dialog>;
    $[45] = t11;
    $[46] = t20;
    $[47] = t21;
  } else {
    t21 = $[47];
  }
  return t21;
}
function _temp4(flag) {
  return <Text key={flag} dimColor={true}>{"  "}· {flag}</Text>;
}
function _temp3(k_0) {
  return [k_0, true] as const;
}
function _temp2(a_2) {
  return {
    bundleId: a_2.resolved?.bundleId ?? a_2.requestedName,
    reason: a_2.resolved ? "user_denied" as const : "not_installed" as const
  };
}
// 这个辅助函数是「扁平映射当过滤用」的写法：条件成立返回单元素数组、不成立返回空数组，于是外层一次扁平映射就同时完成了筛选与取值。它比「先过滤再映射」少一次遍历，代价是可读性——单看这个函数看不出它在上游是当过滤器用的。本文件末尾四个小函数都是这种为调用点服务的形态。
function _temp(a) {
  return a.resolved && !a.alreadyGranted ? [a.resolved.bundleId] : [];
}
// 原文件此处有一行 32336 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。