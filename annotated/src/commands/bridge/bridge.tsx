import { c as _c } from "react/compiler-runtime";
import { feature } from 'bun:bundle';
import { toString as qrToString } from 'qrcode';
import * as React from 'react';
import { useEffect, useState } from 'react';
import { getBridgeAccessToken } from '../../bridge/bridgeConfig.js';
import { checkBridgeMinVersion, getBridgeDisabledReason, isEnvLessBridgeEnabled } from '../../bridge/bridgeEnabled.js';
import { checkEnvLessBridgeMinVersion } from '../../bridge/envLessBridgeConfig.js';
import { BRIDGE_LOGIN_INSTRUCTION, REMOTE_CONTROL_DISCONNECTED_MSG } from '../../bridge/types.js';
import { Dialog } from '../../components/design-system/Dialog.js';
import { ListItem } from '../../components/design-system/ListItem.js';
import { shouldShowRemoteCallout } from '../../components/RemoteCallout.js';
import { useRegisterOverlay } from '../../context/overlayContext.js';
import { Box, Text } from '../../ink.js';
import { useKeybindings } from '../../keybindings/useKeybinding.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from '../../services/analytics/index.js';
import { useAppState, useSetAppState } from '../../state/AppState.js';
import type { ToolUseContext } from '../../Tool.js';
import type { LocalJSXCommandContext, LocalJSXCommandOnDone } from '../../types/command.js';
import { logForDebugging } from '../../utils/debug.js';
// 命令组件的入参：回调负责收尾，名字是用户给这次远程会话起的称呼，可为空
type Props = {
  onDone: LocalJSXCommandOnDone;
  name?: string;
};

/**
 * /remote-control command — manages the bidirectional bridge connection.
 *
 * When enabled, sets replBridgeEnabled in AppState, which triggers
 * useReplBridge in REPL.tsx to initialize the bridge connection.
 * The bridge registers an environment, creates a session with the current
 * conversation, polls for work, and connects an ingress WebSocket for
 * bidirectional messaging between the CLI and claude.ai.
 *
 * Running /remote-control when already connected shows a dialog with the session
 * URL and options to disconnect or continue.
 */
// 这是个不可见组件：真正的动作在挂载后的副作用里，界面只在需要断开确认时才出现
function BridgeToggle(t0) {
// 十个记忆槽：六个依赖、一个回调、一个空依赖数组、两个界面节点
  const $ = _c(10);
  const {
    onDone,
    name
  } = t0;
  const setAppState = useSetAppState();
// 三处订阅各拆成一个选择器函数，任一字段变化只重渲染本组件
  const replBridgeConnected = useAppState(_temp);
  const replBridgeEnabled = useAppState(_temp2);
  const replBridgeOutboundOnly = useAppState(_temp3);
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);
  let t1;
// 依赖比较把六个输入全列上，任一变化才重建副作用回调
  if ($[0] !== name || $[1] !== onDone || $[2] !== replBridgeConnected || $[3] !== replBridgeEnabled || $[4] !== replBridgeOutboundOnly || $[5] !== setAppState) {
    t1 = () => {
// 已连接或已启用且不是仅出站：不重连，先弹确认框让用户决定断开还是继续
      if ((replBridgeConnected || replBridgeEnabled) && !replBridgeOutboundOnly) {
        setShowDisconnectDialog(true);
        return;
      }
// 卸载标志：异步预检期间用户可能已经关掉对话框，回来时必须先看这一位
      let cancelled = false;
      (async () => {
// 预检是异步的（要等策略加载与版本探测），所以整段放在自执行异步函数里
        const error = await checkBridgePrerequisites();
// 预检返回时组件可能已卸载，此时既不能改状态也不能走收尾回调
        if (cancelled) {
          return;
        }
        if (error) {
          logEvent("tengu_bridge_command", {
            action: "preflight_failed" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
          });
          onDone(error, {
            display: "system"
          });
          return;
        }
// 首次连接前先亮远程提示条：把开关留给用户点，而不是替他打开
        if (shouldShowRemoteCallout()) {
          setAppState(prev => {
            if (prev.showRemoteCallout) {
              return prev;
            }
            return {
              ...prev,
              showRemoteCallout: true,
              replBridgeInitialName: name
            };
          });
          onDone("", {
            display: "system"
          });
          return;
        }
        logEvent("tengu_bridge_command", {
          action: "connect" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });
// 已是目标状态就直接返回原对象，避免一次无意义的重渲染
        setAppState(prev_0 => {
          if (prev_0.replBridgeEnabled && !prev_0.replBridgeOutboundOnly) {
            return prev_0;
          }
          return {
            ...prev_0,
            replBridgeEnabled: true,
            replBridgeExplicit: true,
            replBridgeOutboundOnly: false,
            replBridgeInitialName: name
          };
        });
// 文案用进行时，真实连接结果由桥接层后续以通知形式汇报
        onDone("Remote Control connecting\u2026", {
          display: "system"
        });
      })();
// 副作用返回清理函数：卸载时置位取消标志，这里没有定时器需要清
      return () => {
        cancelled = true;
      };
    };
    $[0] = name;
    $[1] = onDone;
    $[2] = replBridgeConnected;
    $[3] = replBridgeEnabled;
    $[4] = replBridgeOutboundOnly;
    $[5] = setAppState;
    $[6] = t1;
  } else {
    t1 = $[6];
  }
  let t2;
// 哨兵值表示这个空依赖数组永久缓存，跨渲染不再重建
  if ($[7] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = [];
    $[7] = t2;
  } else {
    t2 = $[7];
  }
  useEffect(t1, t2);
// 要断开就先渲染确认框并让出整个组件，主流程不再往下走
  if (showDisconnectDialog) {
    let t3;
    if ($[8] !== onDone) {
      t3 = <BridgeDisconnectDialog onDone={onDone} />;
      $[8] = onDone;
      $[9] = t3;
    } else {
      t3 = $[9];
    }
    return t3;
  }
  return null;
}

/**
 * Dialog shown when /remote-control is used while the bridge is already connected.
 * Shows the session URL and lets the user disconnect or continue.
 */
function _temp3(s_1) {
  return s_1.replBridgeOutboundOnly;
}
function _temp2(s_0) {
  return s_0.replBridgeEnabled;
}
function _temp(s) {
  return s.replBridgeConnected;
}
// 断开确认框：连接中的会话还要能出示二维码，方便手机端接管
function BridgeDisconnectDialog(t0) {
  const $ = _c(61);
  const {
    onDone
  } = t0;
// 注册为浮层，让上层知道当前有独占对话框在接管按键
  useRegisterOverlay("bridge-disconnect-dialog");
  const setAppState = useSetAppState();
  const sessionUrl = useAppState(_temp4);
  const connectUrl = useAppState(_temp5);
  const sessionActive = useAppState(_temp6);
  const [focusIndex, setFocusIndex] = useState(2);
  const [showQR, setShowQR] = useState(false);
  const [qrText, setQrText] = useState("");
// 会话还活着就给会话地址，否则给连接地址：两者语义不同不能混用
  const displayUrl = sessionActive ? sessionUrl : connectUrl;
  let t1;
  let t2;
  if ($[0] !== displayUrl || $[1] !== showQR) {
// 二维码按需生成：收起时清空文本，展开且有地址才去算
    t1 = () => {
      if (!showQR || !displayUrl) {
        setQrText("");
        return;
      }
// 纠错等级取最低档：终端字符画的密度已经很低，高纠错会把宽度撑爆
      qrToString(displayUrl, {
        type: "utf8",
        errorCorrectionLevel: "L",
        small: true
      }).then(setQrText).catch(() => setQrText(""));
    };
    t2 = [showQR, displayUrl];
    $[0] = displayUrl;
    $[1] = showQR;
    $[2] = t1;
    $[3] = t2;
  } else {
    t1 = $[2];
    t2 = $[3];
  }
  useEffect(t1, t2);
  let t3;
  if ($[4] !== onDone || $[5] !== setAppState) {
// 断开只需把三个开关一起关掉，真正的连接释放由桥接层的副作用负责
    t3 = function handleDisconnect() {
      setAppState(_temp7);
      logEvent("tengu_bridge_command", {
        action: "disconnect" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
      onDone(REMOTE_CONTROL_DISCONNECTED_MSG, {
        display: "system"
      });
    };
    $[4] = onDone;
    $[5] = setAppState;
    $[6] = t3;
  } else {
    t3 = $[6];
  }
  const handleDisconnect = t3;
  let t4;
  if ($[7] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = function handleShowQR() {
      setShowQR(_temp8);
    };
    $[7] = t4;
  } else {
    t4 = $[7];
  }
  const handleShowQR = t4;
  let t5;
  if ($[8] !== onDone) {
// 继续等于什么都不做地收尾，用跳过表示不覆盖当前界面输出
    t5 = function handleContinue() {
      onDone(undefined, {
        display: "skip"
      });
    };
    $[8] = onDone;
    $[9] = t5;
  } else {
    t5 = $[9];
  }
  const handleContinue = t5;
  let t6;
  let t7;
  if ($[10] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = () => setFocusIndex(_temp9);
// 两个方向都用取模循环：焦点在三个选项之间首尾相接
    t7 = () => setFocusIndex(_temp0);
    $[10] = t6;
    $[11] = t7;
  } else {
    t6 = $[10];
    t7 = $[11];
  }
  let t8;
// 按键表按焦点索引重建，回车按索引分派到断开、二维码、继续
  if ($[12] !== focusIndex || $[13] !== handleContinue || $[14] !== handleDisconnect) {
    t8 = {
      "select:next": t6,
      "select:previous": t7,
      "select:accept": () => {
        if (focusIndex === 0) {
          handleDisconnect();
        } else {
          if (focusIndex === 1) {
            handleShowQR();
          } else {
            handleContinue();
          }
        }
      }
    };
    $[12] = focusIndex;
    $[13] = handleContinue;
    $[14] = handleDisconnect;
    $[15] = t8;
  } else {
    t8 = $[15];
  }
  let t9;
  if ($[16] === Symbol.for("react.memo_cache_sentinel")) {
    t9 = {
      context: "Select"
    };
    $[16] = t9;
  } else {
    t9 = $[16];
  }
  useKeybindings(t8, t9);
  let T0;
  let T1;
  let t10;
  let t11;
  let t12;
  let t13;
  let t14;
  let t15;
  let t16;
  if ($[17] !== displayUrl || $[18] !== handleContinue || $[19] !== qrText || $[20] !== showQR) {
// 按换行切分二维码文本并过滤空串，否则会渲染出多余的空白行
    const qrLines = qrText ? qrText.split("\n").filter(_temp1) : [];
    T1 = Dialog;
    t14 = "Remote Control";
    t15 = handleContinue;
    t16 = true;
    T0 = Box;
    t10 = "column";
    t11 = 1;
// 地址为空时连前面的介词一起省掉，避免出现孤零零的一个介词
    const t17 = displayUrl ? ` at ${displayUrl}` : "";
    if ($[30] !== t17) {
      t12 = <Text>This session is available via Remote Control{t17}.</Text>;
      $[30] = t17;
      $[31] = t12;
    } else {
      t12 = $[31];
    }
// 二维码只在展开且确实有内容时占位，否则连外层盒子都不建
    t13 = showQR && qrLines.length > 0 && <Box flexDirection="column">{qrLines.map(_temp10)}</Box>;
    $[17] = displayUrl;
    $[18] = handleContinue;
    $[19] = qrText;
    $[20] = showQR;
    $[21] = T0;
    $[22] = T1;
    $[23] = t10;
    $[24] = t11;
    $[25] = t12;
    $[26] = t13;
    $[27] = t14;
    $[28] = t15;
    $[29] = t16;
  } else {
    T0 = $[21];
    T1 = $[22];
    t10 = $[23];
    t11 = $[24];
    t12 = $[25];
    t13 = $[26];
    t14 = $[27];
    t15 = $[28];
    t16 = $[29];
  }
// 三个焦点布尔量各算一次，供列表项与回车分派共用
  const t17 = focusIndex === 0;
  let t18;
  if ($[32] === Symbol.for("react.memo_cache_sentinel")) {
    t18 = <Text>Disconnect this session</Text>;
    $[32] = t18;
  } else {
    t18 = $[32];
  }
  let t19;
  if ($[33] !== t17) {
    t19 = <ListItem isFocused={t17}>{t18}</ListItem>;
    $[33] = t17;
    $[34] = t19;
  } else {
    t19 = $[34];
  }
  const t20 = focusIndex === 1;
  const t21 = showQR ? "Hide QR code" : "Show QR code";
  let t22;
  if ($[35] !== t21) {
    t22 = <Text>{t21}</Text>;
    $[35] = t21;
    $[36] = t22;
  } else {
    t22 = $[36];
  }
  let t23;
  if ($[37] !== t20 || $[38] !== t22) {
    t23 = <ListItem isFocused={t20}>{t22}</ListItem>;
    $[37] = t20;
    $[38] = t22;
    $[39] = t23;
  } else {
    t23 = $[39];
  }
  const t24 = focusIndex === 2;
  let t25;
  if ($[40] === Symbol.for("react.memo_cache_sentinel")) {
    t25 = <Text>Continue</Text>;
    $[40] = t25;
  } else {
    t25 = $[40];
  }
  let t26;
  if ($[41] !== t24) {
    t26 = <ListItem isFocused={t24}>{t25}</ListItem>;
    $[41] = t24;
    $[42] = t26;
  } else {
    t26 = $[42];
  }
  let t27;
  if ($[43] !== t19 || $[44] !== t23 || $[45] !== t26) {
    t27 = <Box flexDirection="column">{t19}{t23}{t26}</Box>;
    $[43] = t19;
    $[44] = t23;
    $[45] = t26;
    $[46] = t27;
  } else {
    t27 = $[46];
  }
  let t28;
  if ($[47] === Symbol.for("react.memo_cache_sentinel")) {
// 底部提示行没有依赖，用哨兵缓存成常量节点
    t28 = <Text dimColor={true}>Enter to select · Esc to continue</Text>;
    $[47] = t28;
  } else {
    t28 = $[47];
  }
  let t29;
  if ($[48] !== T0 || $[49] !== t10 || $[50] !== t11 || $[51] !== t12 || $[52] !== t13 || $[53] !== t27) {
    t29 = <T0 flexDirection={t10} gap={t11}>{t12}{t13}{t27}{t28}</T0>;
    $[48] = T0;
    $[49] = t10;
    $[50] = t11;
    $[51] = t12;
    $[52] = t13;
    $[53] = t27;
    $[54] = t29;
  } else {
    t29 = $[54];
  }
  let t30;
  if ($[55] !== T1 || $[56] !== t14 || $[57] !== t15 || $[58] !== t16 || $[59] !== t29) {
    t30 = <T1 title={t14} onCancel={t15} hideInputGuide={t16}>{t29}</T1>;
    $[55] = T1;
    $[56] = t14;
    $[57] = t15;
    $[58] = t16;
    $[59] = t29;
    $[60] = t30;
  } else {
    t30 = $[60];
  }
// 整棵树自下而上拼完，返回值就是对话框本身
  return t30;
}

/**
 * Check bridge prerequisites. Returns an error message if a precondition
 * fails, or null if all checks pass. Awaits GrowthBook init if the disk
 * cache is stale, so a user who just became entitled (e.g. upgraded to Max,
 * or the flag just launched) gets an accurate result on the first try.
 */
function _temp10(line, i_1) {
  return <Text key={i_1}>{line}</Text>;
}
function _temp1(l) {
  return l.length > 0;
}
function _temp0(i_0) {
  return (i_0 - 1 + 3) % 3;
}
function _temp9(i) {
  return (i + 1) % 3;
}
function _temp8(prev_0) {
  return !prev_0;
}
function _temp7(prev) {
  if (!prev.replBridgeEnabled) {
    return prev;
  }
  return {
    ...prev,
    replBridgeEnabled: false,
    replBridgeExplicit: false,
    replBridgeOutboundOnly: false
  };
}
function _temp6(s_1) {
  return s_1.replBridgeSessionActive;
}
function _temp5(s_0) {
  return s_0.replBridgeConnectUrl;
}
function _temp4(s) {
  return s.replBridgeSessionUrl;
}
// 预检按代价从低到高排：先问策略，再问开关，最后才做版本与凭据检查
async function checkBridgePrerequisites(): Promise<string | null> {
// 组织策略要等加载完再判：缓存未就绪时读到的是旧值，会给出误导性的拒绝
  // Check organization policy — remote control may be disabled
  const {
    waitForPolicyLimitsToLoad,
    isPolicyAllowed
  } = await import('../../services/policyLimits/index.js');
  await waitForPolicyLimitsToLoad();
  if (!isPolicyAllowed('allow_remote_control')) {
    return "Remote Control is disabled by your organization's policy.";
  }
// 禁用原因由桥接开关统一给出，企业策略、灰度未开、区域限制都在里面
  const disabledReason = await getBridgeDisabledReason();
  if (disabledReason) {
    return disabledReason;
  }

// 这里必须与连接侧的分支判断逐字一致，否则会出现预检通过但连接走另一条路
  // Mirror the v1/v2 branching logic in initReplBridge: env-less (v2) is used
  // only when the flag is on AND the session is not perpetual.  In assistant
  // mode (KAIROS) useReplBridge sets perpetual=true, which forces
  // initReplBridge onto the v1 path — so the prerequisite check must match.
  let useV2 = isEnvLessBridgeEnabled();
// 助手模式的会话是常驻的，只能走旧版路径，所以把新版的判定改回假
  if (feature('KAIROS') && useV2) {
    const {
      isAssistantMode
    } = await import('../../assistant/index.js');
    if (isAssistantMode()) {
      useV2 = false;
    }
  }
// 两条路径的最低版本要求不同，按最终选定的路径取对应的检查函数
  const versionError = useV2 ? await checkEnvLessBridgeMinVersion() : checkBridgeMinVersion();
  if (versionError) {
    return versionError;
  }
// 版本过了还要有访问令牌，缺令牌直接给登录指引而不是笼统报错
  if (!getBridgeAccessToken()) {
    return BRIDGE_LOGIN_INSTRUCTION;
  }
  logForDebugging('[bridge] Prerequisites passed, enabling bridge');
  return null;
}
// 命令入口：参数就是会话名，去掉首尾空白后为空则交给连接侧自动命名
export async function call(onDone: LocalJSXCommandOnDone, _context: ToolUseContext & LocalJSXCommandContext, args: string): Promise<React.ReactNode> {
  const name = args.trim() || undefined;
  return <BridgeToggle onDone={onDone} name={name} />;
}
// 原文件此处有一行 32980 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。