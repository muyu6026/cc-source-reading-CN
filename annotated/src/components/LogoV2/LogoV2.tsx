// 本文件是启动欢迎屏：三种形态按条件降级。极简版（无新版本说明、无引导、未强制完整）只显示一行标识加若干提示条；紧凑版（终端较窄）显示圆角框、吉祥物、模型与账单信息；完整版是左右分栏——左边欢迎语、吉祥物、模型与路径，右边 Feed 列（引导、最近活动、新版本说明、或两张促升级卡片）。底部还有一组公告与提示（沙箱、调试、tmux、紧急提示、语音与合并通知）。
import { c as _c } from "react/compiler-runtime";
// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import * as React from 'react';
import { Box, Text, color } from '../../ink.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { stringWidth } from '../../ink/stringWidth.js';
import { getLayoutMode, calculateLayoutDimensions, calculateOptimalLeftWidth, formatWelcomeMessage, truncatePath, getRecentActivitySync, getRecentReleaseNotesSync, getLogoDisplayData } from '../../utils/logoV2Utils.js';
import { truncate } from '../../utils/format.js';
import { getDisplayPath } from '../../utils/file.js';
import { Clawd } from './Clawd.js';
import { FeedColumn } from './FeedColumn.js';
import { createRecentActivityFeed, createWhatsNewFeed, createProjectOnboardingFeed, createGuestPassesFeed } from './feedConfigs.js';
import { getGlobalConfig, saveGlobalConfig } from 'src/utils/config.js';
import { resolveThemeSetting } from 'src/utils/systemTheme.js';
import { getInitialSettings } from 'src/utils/settings/settings.js';
import { isDebugMode, isDebugToStdErr, getDebugLogPath } from 'src/utils/debug.js';
import { useEffect, useState } from 'react';
import { getSteps, shouldShowProjectOnboarding, incrementProjectOnboardingSeenCount } from '../../projectOnboardingState.js';
import { CondensedLogo } from './CondensedLogo.js';
import { OffscreenFreeze } from '../OffscreenFreeze.js';
import { checkForReleaseNotesSync } from '../../utils/releaseNotes.js';
import { getDumpPromptsPath } from 'src/services/api/dumpPrompts.js';
import { isEnvTruthy } from 'src/utils/envUtils.js';
import { getStartupPerfLogPath, isDetailedProfilingEnabled } from 'src/utils/startupProfiler.js';
import { EmergencyTip } from './EmergencyTip.js';
import { VoiceModeNotice } from './VoiceModeNotice.js';
import { Opus1mMergeNotice } from './Opus1mMergeNotice.js';
import { feature } from 'bun:bundle';

// 条件 require 的取舍写在注释里：模块作用域内的辅助组件放在功能开关三元里不会被打包器摇掉，只有 require 这种形式能让整文件在开关关闭时被消除。语音通知用辅助组件写法但它是外部模块，所以无所谓。
// Conditional require so ChannelsNotice.tsx tree-shakes when both flags are
// false. A module-scope helper component inside a feature() ternary does NOT
// tree-shake (docs/feature-gating.md); the require pattern eliminates the
// whole file. VoiceModeNotice uses the unsafe helper pattern but VOICE_MODE
// is external: true so it's moot there.
/* eslint-disable @typescript-eslint/no-require-imports */
const ChannelsNoticeModule = feature('KAIROS') || feature('KAIROS_CHANNELS') ? require('./ChannelsNotice.js') as typeof import('./ChannelsNotice.js') : null;
/* eslint-enable @typescript-eslint/no-require-imports */
import { SandboxManager } from 'src/utils/sandbox/sandbox-adapter.js';
import { useShowGuestPassesUpsell, incrementGuestPassesSeenCount } from './GuestPassesUpsell.js';
import { useShowOverageCreditUpsell, incrementOverageCreditUpsellSeenCount, createOverageCreditFeed } from './OverageCreditUpsell.js';
import { plural } from '../../utils/stringUtils.js';
import { useAppState } from '../../state/AppState.js';
import { getEffortSuffix } from '../../utils/effort.js';
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js';
import { renderModelSetting } from '../../utils/model/model.js';
// 左侧面板最大宽度 50 列——分栏布局里左边固定上限，右边吃剩下的宽度。
const LEFT_PANEL_MAX_WIDTH = 50;
// 主组件：先收集所有「今天该显示什么」的信号（引导、沙箱、两张促升级卡、公告、新版本说明），再决定降级到哪一种形态。
export function LogoV2() {
  const $ = _c(94);
// 活动列表、用户名、终端列宽；活动列表是同步读，保证首帧就有内容。
  const activities = getRecentActivitySync();
  const username = getGlobalConfig().oauthAccount?.displayName ?? "";
  const {
    columns
  } = useTerminalSize();
// 引导显示判定只算一次（挂载时），不是每次渲染都判——它涉及读 onboarding 状态文件。
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = shouldShowProjectOnboarding();
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  const showOnboarding = t0;
// 沙箱状态同样只算一次，避免每次渲染都问一次沙箱管理器。
  let t1;
  if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = SandboxManager.isSandboxingEnabled();
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const showSandboxStatus = t1;
// 两张促升级卡各有一个钩子，内部带「是否该展示」的频率控制；两者互斥展示（完整版里优先访客通行证）。
  const showGuestPassesUpsell = useShowGuestPassesUpsell();
  const showOverageCreditUpsell = useShowOverageCreditUpsell();
  const agent = useAppState(_temp);
  const effortValue = useAppState(_temp2);
  const config = getGlobalConfig();
// 版本说明读取包了 try：读文件或解析失败就当没有新版本说明，不能因为一段 changelog 读不出来而让启动画面崩掉。
  let changelog;
  try {
    changelog = getRecentReleaseNotesSync(3);
  } catch {
    changelog = [];
  }
// 公司公告抽样：首次启动取第一条（保证新用户看到最重要的），之后每次启动随机抽一条。
  const [announcement] = useState(() => {
    const announcements = getInitialSettings().companyAnnouncements;
    if (!announcements || announcements.length === 0) {
      return;
    }
    return config.numStartups === 1 ? announcements[0] : announcements[Math.floor(Math.random() * announcements.length)];
  });
// 是否还有未读的新版本说明，用上次看到的版本号与当前版本比对。
  const {
    hasReleaseNotes
  } = checkForReleaseNotesSync(config.lastReleaseNotesSeen);
// 记录已读：若上次记录的版本已等于当前版本就直接返回（幂等）；否则写配置，并在需要显示引导时顺带把引导计数加一——两件「已展示过」的记账合并成一次副作用。
  let t2;
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = () => {
      const currentConfig = getGlobalConfig();
      if (currentConfig.lastReleaseNotesSeen === MACRO.VERSION) {
        return;
      }
      saveGlobalConfig(_temp3);
      if (showOnboarding) {
        incrementProjectOnboardingSeenCount();
      }
    };
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  let t3;
  if ($[3] !== config) {
    t3 = [config, showOnboarding];
    $[3] = config;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  useEffect(t2, t3);
// 极简模式判定：没有新版本说明、没有引导、且没有强制完整标识的环境变量。三个条件都满足才降级，保证任何「有东西要给用户看」的情况都进完整版。
  let t4;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = !hasReleaseNotes && !showOnboarding && !isEnvTruthy(process.env.CLAUDE_CODE_FORCE_FULL_LOGO);
    $[5] = t4;
  } else {
    t4 = $[5];
  }
  const isCondensedMode = t4;
// 访客通行证卡展示后立即记一次已见（仅在非引导、非极简时），控制下次不再展示。
  let t5;
  let t6;
  if ($[6] !== showGuestPassesUpsell) {
    t5 = () => {
      if (showGuestPassesUpsell && !showOnboarding && !isCondensedMode) {
        incrementGuestPassesSeenCount();
      }
    };
    t6 = [showGuestPassesUpsell, showOnboarding, isCondensedMode];
    $[6] = showGuestPassesUpsell;
    $[7] = t5;
    $[8] = t6;
  } else {
    t5 = $[7];
    t6 = $[8];
  }
  useEffect(t5, t6);
// 超额额度卡同理，且额外要求访客卡没在展示——两张卡不叠加。
  let t7;
  let t8;
  if ($[9] !== showGuestPassesUpsell || $[10] !== showOverageCreditUpsell) {
    t7 = () => {
      if (showOverageCreditUpsell && !showOnboarding && !showGuestPassesUpsell && !isCondensedMode) {
        incrementOverageCreditUpsellSeenCount();
      }
    };
    t8 = [showOverageCreditUpsell, showOnboarding, showGuestPassesUpsell, isCondensedMode];
    $[9] = showGuestPassesUpsell;
    $[10] = showOverageCreditUpsell;
    $[11] = t7;
    $[12] = t8;
  } else {
    t7 = $[11];
    t8 = $[12];
  }
  useEffect(t7, t8);
// 模型显示名加 effort 后缀：模型名走 renderModelSetting，effort 后缀由当前 effort 值决定（低中高档）。
  const model = useMainLoopModel();
  const fullModelDisplayName = renderModelSetting(model);
// 显示数据一次取齐：版本号、工作目录、账单类型、设置里的代理名。
  const {
    version,
    cwd,
    billingType,
    agentName: agentNameFromSettings
  } = getLogoDisplayData();
  const agentName = agent ?? agentNameFromSettings;
  const effortSuffix = getEffortSuffix(model, effortValue);
// 模型名截断到左栏宽度减 20（给 effort 后缀与边框留位），避免长模型名把边框顶破。
  const t9 = fullModelDisplayName + effortSuffix;
  let t10;
  if ($[13] !== t9) {
    t10 = truncate(t9, LEFT_PANEL_MAX_WIDTH - 20);
    $[13] = t9;
    $[14] = t10;
  } else {
    t10 = $[14];
  }
  const modelDisplayName = t10;
// 极简分支：只渲染一行标识加一组提示条。这组提示条（语音、合并通知、频道通知、调试、紧急提示、tmux）与完整版复用同一套组件，只是排列更紧。
  if (!hasReleaseNotes && !showOnboarding && !isEnvTruthy(process.env.CLAUDE_CODE_FORCE_FULL_LOGO)) {
    let t11;
    let t12;
    let t13;
    let t14;
    let t15;
    let t16;
    let t17;
    if ($[15] === Symbol.for("react.memo_cache_sentinel")) {
      t11 = <CondensedLogo />;
      t12 = <VoiceModeNotice />;
      t13 = <Opus1mMergeNotice />;
      t14 = ChannelsNoticeModule && <ChannelsNoticeModule.ChannelsNotice />;
      t15 = isDebugMode() && <Box paddingLeft={2} flexDirection="column"><Text color="warning">Debug mode enabled</Text><Text dimColor={true}>Logging to: {isDebugToStdErr() ? "stderr" : getDebugLogPath()}</Text></Box>;
      t16 = <EmergencyTip />;
      t17 = process.env.CLAUDE_CODE_TMUX_SESSION && <Box paddingLeft={2} flexDirection="column"><Text dimColor={true}>tmux session: {process.env.CLAUDE_CODE_TMUX_SESSION}</Text><Text dimColor={true}>{process.env.CLAUDE_CODE_TMUX_PREFIX_CONFLICTS ? `Detach: ${process.env.CLAUDE_CODE_TMUX_PREFIX} ${process.env.CLAUDE_CODE_TMUX_PREFIX} d (press prefix twice - Claude uses ${process.env.CLAUDE_CODE_TMUX_PREFIX})` : `Detach: ${process.env.CLAUDE_CODE_TMUX_PREFIX} d`}</Text></Box>;
      $[15] = t11;
      $[16] = t12;
      $[17] = t13;
      $[18] = t14;
      $[19] = t15;
      $[20] = t16;
      $[21] = t17;
    } else {
      t11 = $[15];
      t12 = $[16];
      t13 = $[17];
      t14 = $[18];
      t15 = $[19];
      t16 = $[20];
      t17 = $[21];
    }
    let t18;
    if ($[22] !== announcement || $[23] !== config) {
      t18 = announcement && <Box paddingLeft={2} flexDirection="column">{!process.env.IS_DEMO && config.oauthAccount?.organizationName && <Text dimColor={true}>Message from {config.oauthAccount.organizationName}:</Text>}<Text>{announcement}</Text></Box>;
      $[22] = announcement;
      $[23] = config;
      $[24] = t18;
    } else {
      t18 = $[24];
    }
    let t19;
    let t20;
    let t21;
    let t22;
    if ($[25] === Symbol.for("react.memo_cache_sentinel")) {
      t19 = false && !process.env.DEMO_VERSION && <Box paddingLeft={2} flexDirection="column"><Text dimColor={true}>Use /issue to report model behavior issues</Text></Box>;
      t20 = false && !process.env.DEMO_VERSION && <Box paddingLeft={2} flexDirection="column"><Text color="warning">[ANT-ONLY] Logs:</Text><Text dimColor={true}>API calls: {getDisplayPath(getDumpPromptsPath())}</Text><Text dimColor={true}>Debug logs: {getDisplayPath(getDebugLogPath())}</Text>{isDetailedProfilingEnabled() && <Text dimColor={true}>Startup Perf: {getDisplayPath(getStartupPerfLogPath())}</Text>}</Box>;
      t21 = false && <GateOverridesWarning />;
      t22 = false && <ExperimentEnrollmentNotice />;
      $[25] = t19;
      $[26] = t20;
      $[27] = t21;
      $[28] = t22;
    } else {
      t19 = $[25];
      t20 = $[26];
      t21 = $[27];
      t22 = $[28];
    }
    let t23;
    if ($[29] !== t18) {
      t23 = <>{t11}{t12}{t13}{t14}{t15}{t16}{t17}{t18}{t19}{t20}{t21}{t22}</>;
      $[29] = t18;
      $[30] = t23;
    } else {
      t23 = $[30];
    }
    return t23;
  }
// 布局模式按终端列宽决定（紧凑、水平分栏、垂直堆叠）；主题色解析一次供边框标题着色。
  const layoutMode = getLayoutMode(columns);
  const userTheme = resolveThemeSetting(getGlobalConfig().theme);
// 边框标题由「Claude Code 加版本号」拼成，用主题色分别着色产品名与版本号。
  const borderTitle = ` ${color("claude", userTheme)("Claude Code")} ${color("inactive", userTheme)(`v${version}`)} `;
  const compactBorderTitle = color("claude", userTheme)(" Claude Code ");
// 紧凑分支：窄终端下用圆角框纵向堆叠。欢迎语若超出可用宽度就退回不带用户名的通用版（缓存好的常量）。
  if (layoutMode === "compact") {
    let welcomeMessage = formatWelcomeMessage(username);
    if (stringWidth(welcomeMessage) > columns - 4) {
      let t11;
      if ($[31] === Symbol.for("react.memo_cache_sentinel")) {
        t11 = formatWelcomeMessage(null);
        $[31] = t11;
      } else {
        t11 = $[31];
      }
      welcomeMessage = t11;
    }
// 工作目录可用宽度：有代理名时还要扣掉 @代理名 加分隔符的宽度；最少给 10 列，宁可截断路径也不让布局塌掉。
    const cwdAvailableWidth = agentName ? columns - 4 - 1 - stringWidth(agentName) - 3 : columns - 4;
    const truncatedCwd = truncatePath(cwd, Math.max(cwdAvailableWidth, 10));
    let t11;
    if ($[32] !== compactBorderTitle) {
      t11 = {
        content: compactBorderTitle,
        position: "top",
        align: "start",
        offset: 1
      };
      $[32] = compactBorderTitle;
      $[33] = t11;
    } else {
      t11 = $[33];
    }
    let t12;
    if ($[34] === Symbol.for("react.memo_cache_sentinel")) {
      t12 = <Box marginY={1}><Clawd /></Box>;
      $[34] = t12;
    } else {
      t12 = $[34];
    }
    let t13;
    if ($[35] !== modelDisplayName) {
      t13 = <Text dimColor={true}>{modelDisplayName}</Text>;
      $[35] = modelDisplayName;
      $[36] = t13;
    } else {
      t13 = $[36];
    }
    let t14;
    let t15;
    let t16;
    if ($[37] === Symbol.for("react.memo_cache_sentinel")) {
      t14 = <VoiceModeNotice />;
      t15 = <Opus1mMergeNotice />;
      t16 = ChannelsNoticeModule && <ChannelsNoticeModule.ChannelsNotice />;
      $[37] = t14;
      $[38] = t15;
      $[39] = t16;
    } else {
      t14 = $[37];
      t15 = $[38];
      t16 = $[39];
    }
    let t17;
    if ($[40] !== showSandboxStatus) {
      t17 = showSandboxStatus && <Box marginTop={1} flexDirection="column"><Text color="warning">Your bash commands will be sandboxed. Disable with /sandbox.</Text></Box>;
      $[40] = showSandboxStatus;
      $[41] = t17;
    } else {
      t17 = $[41];
    }
    let t18;
    let t19;
    if ($[42] === Symbol.for("react.memo_cache_sentinel")) {
      t18 = false && <GateOverridesWarning />;
      t19 = false && <ExperimentEnrollmentNotice />;
      $[42] = t18;
      $[43] = t19;
    } else {
      t18 = $[42];
      t19 = $[43];
    }
    return <><OffscreenFreeze><Box flexDirection="column" borderStyle="round" borderColor="claude" borderText={t11} paddingX={1} paddingY={1} alignItems="center" width={columns}><Text bold={true}>{welcomeMessage}</Text>{t12}{t13}<Text dimColor={true}>{billingType}</Text><Text dimColor={true}>{agentName ? `@${agentName} · ${truncatedCwd}` : truncatedCwd}</Text></Box></OffscreenFreeze>{t14}{t15}{t16}{t17}{t18}{t19}</>;
  }
// 完整版：欢迎语、模型行（内部构建还带组织名）、工作目录行，然后算左栏最优宽度与左右分配。
  const welcomeMessage_0 = formatWelcomeMessage(username);
  const modelLine = !process.env.IS_DEMO && config.oauthAccount?.organizationName ? `${modelDisplayName} · ${billingType} · ${config.oauthAccount.organizationName}` : `${modelDisplayName} · ${billingType}`;
  const cwdAvailableWidth_0 = agentName ? LEFT_PANEL_MAX_WIDTH - 1 - stringWidth(agentName) - 3 : LEFT_PANEL_MAX_WIDTH;
  const truncatedCwd_0 = truncatePath(cwd, Math.max(cwdAvailableWidth_0, 10));
  const cwdLine = agentName ? `@${agentName} · ${truncatedCwd_0}` : truncatedCwd_0;
// 左栏宽度取三行文本里的最宽者，再交给布局函数按终端宽度与模式分配左右宽度。
  const optimalLeftWidth = calculateOptimalLeftWidth(welcomeMessage_0, cwdLine, modelLine);
  const {
    leftWidth,
    rightWidth
  } = calculateLayoutDimensions(columns, layoutMode, optimalLeftWidth);
// 渲染树：外层圆角框（边框标题带版本号）包住内层容器，内层按布局模式横排或纵排；左栏固定宽度、纵向两端对齐、最小高度 9 行；水平模式下中间插一条只画左右边框的竖线分隔。
  const T0 = OffscreenFreeze;
  const T1 = Box;
  const t11 = "column";
  const t12 = "round";
  const t13 = "claude";
  let t14;
  if ($[44] !== borderTitle) {
    t14 = {
      content: borderTitle,
      position: "top",
      align: "start",
      offset: 3
    };
    $[44] = borderTitle;
    $[45] = t14;
  } else {
    t14 = $[45];
  }
  const T2 = Box;
  const t15 = layoutMode === "horizontal" ? "row" : "column";
  const t16 = 1;
  const t17 = 1;
  let t18;
  if ($[46] !== welcomeMessage_0) {
    t18 = <Box marginTop={1}><Text bold={true}>{welcomeMessage_0}</Text></Box>;
    $[46] = welcomeMessage_0;
    $[47] = t18;
  } else {
    t18 = $[47];
  }
  let t19;
  if ($[48] === Symbol.for("react.memo_cache_sentinel")) {
    t19 = <Clawd />;
    $[48] = t19;
  } else {
    t19 = $[48];
  }
  let t20;
  if ($[49] !== modelLine) {
    t20 = <Text dimColor={true}>{modelLine}</Text>;
    $[49] = modelLine;
    $[50] = t20;
  } else {
    t20 = $[50];
  }
  let t21;
  if ($[51] !== cwdLine) {
    t21 = <Text dimColor={true}>{cwdLine}</Text>;
    $[51] = cwdLine;
    $[52] = t21;
  } else {
    t21 = $[52];
  }
  let t22;
  if ($[53] !== t20 || $[54] !== t21) {
    t22 = <Box flexDirection="column" alignItems="center">{t20}{t21}</Box>;
    $[53] = t20;
    $[54] = t21;
    $[55] = t22;
  } else {
    t22 = $[55];
  }
  let t23;
  if ($[56] !== leftWidth || $[57] !== t18 || $[58] !== t22) {
    t23 = <Box flexDirection="column" width={leftWidth} justifyContent="space-between" alignItems="center" minHeight={9}>{t18}{t19}{t22}</Box>;
    $[56] = leftWidth;
    $[57] = t18;
    $[58] = t22;
    $[59] = t23;
  } else {
    t23 = $[59];
  }
  let t24;
  if ($[60] !== layoutMode) {
    t24 = layoutMode === "horizontal" && <Box height="100%" borderStyle="single" borderColor="claude" borderDimColor={true} borderTop={false} borderBottom={false} borderLeft={false} />;
    $[60] = layoutMode;
    $[61] = t24;
  } else {
    t24 = $[61];
  }
// 右侧 Feed 列的四选一：引导步骤、最近活动加访客通行证、最近活动加超额额度、最近活动加新版本说明。优先级顺序即产品优先级。
  const t25 = layoutMode === "horizontal" && <FeedColumn feeds={showOnboarding ? [createProjectOnboardingFeed(getSteps()), createRecentActivityFeed(activities)] : showGuestPassesUpsell ? [createRecentActivityFeed(activities), createGuestPassesFeed()] : showOverageCreditUpsell ? [createRecentActivityFeed(activities), createOverageCreditFeed()] : [createRecentActivityFeed(activities), createWhatsNewFeed(changelog)]} maxWidth={rightWidth} />;
  let t26;
  if ($[62] !== T2 || $[63] !== t15 || $[64] !== t23 || $[65] !== t24 || $[66] !== t25) {
    t26 = <T2 flexDirection={t15} paddingX={t16} gap={t17}>{t23}{t24}{t25}</T2>;
    $[62] = T2;
    $[63] = t15;
    $[64] = t23;
    $[65] = t24;
    $[66] = t25;
    $[67] = t26;
  } else {
    t26 = $[67];
  }
  let t27;
  if ($[68] !== T1 || $[69] !== t14 || $[70] !== t26) {
    t27 = <T1 flexDirection={t11} borderStyle={t12} borderColor={t13} borderText={t14}>{t26}</T1>;
    $[68] = T1;
    $[69] = t14;
    $[70] = t26;
    $[71] = t27;
  } else {
    t27 = $[71];
  }
  let t28;
  if ($[72] !== T0 || $[73] !== t27) {
    t28 = <T0>{t27}</T0>;
    $[72] = T0;
    $[73] = t27;
    $[74] = t28;
  } else {
    t28 = $[74];
  }
  let t29;
  let t30;
  let t31;
  let t32;
  let t33;
  let t34;
  if ($[75] === Symbol.for("react.memo_cache_sentinel")) {
    t29 = <VoiceModeNotice />;
    t30 = <Opus1mMergeNotice />;
    t31 = ChannelsNoticeModule && <ChannelsNoticeModule.ChannelsNotice />;
    t32 = isDebugMode() && <Box paddingLeft={2} flexDirection="column"><Text color="warning">Debug mode enabled</Text><Text dimColor={true}>Logging to: {isDebugToStdErr() ? "stderr" : getDebugLogPath()}</Text></Box>;
    t33 = <EmergencyTip />;
    t34 = process.env.CLAUDE_CODE_TMUX_SESSION && <Box paddingLeft={2} flexDirection="column"><Text dimColor={true}>tmux session: {process.env.CLAUDE_CODE_TMUX_SESSION}</Text><Text dimColor={true}>{process.env.CLAUDE_CODE_TMUX_PREFIX_CONFLICTS ? `Detach: ${process.env.CLAUDE_CODE_TMUX_PREFIX} ${process.env.CLAUDE_CODE_TMUX_PREFIX} d (press prefix twice - Claude uses ${process.env.CLAUDE_CODE_TMUX_PREFIX})` : `Detach: ${process.env.CLAUDE_CODE_TMUX_PREFIX} d`}</Text></Box>;
    $[75] = t29;
    $[76] = t30;
    $[77] = t31;
    $[78] = t32;
    $[79] = t33;
    $[80] = t34;
  } else {
    t29 = $[75];
    t30 = $[76];
    t31 = $[77];
    t32 = $[78];
    t33 = $[79];
    t34 = $[80];
  }
  let t35;
  if ($[81] !== announcement || $[82] !== config) {
    t35 = announcement && <Box paddingLeft={2} flexDirection="column">{!process.env.IS_DEMO && config.oauthAccount?.organizationName && <Text dimColor={true}>Message from {config.oauthAccount.organizationName}:</Text>}<Text>{announcement}</Text></Box>;
    $[81] = announcement;
    $[82] = config;
    $[83] = t35;
  } else {
    t35 = $[83];
  }
  let t36;
  if ($[84] !== showSandboxStatus) {
    t36 = showSandboxStatus && <Box paddingLeft={2} flexDirection="column"><Text color="warning">Your bash commands will be sandboxed. Disable with /sandbox.</Text></Box>;
    $[84] = showSandboxStatus;
    $[85] = t36;
  } else {
    t36 = $[85];
  }
  let t37;
  let t38;
  let t39;
  let t40;
  if ($[86] === Symbol.for("react.memo_cache_sentinel")) {
    t37 = false && !process.env.DEMO_VERSION && <Box paddingLeft={2} flexDirection="column"><Text dimColor={true}>Use /issue to report model behavior issues</Text></Box>;
    t38 = false && !process.env.DEMO_VERSION && <Box paddingLeft={2} flexDirection="column"><Text color="warning">[ANT-ONLY] Logs:</Text><Text dimColor={true}>API calls: {getDisplayPath(getDumpPromptsPath())}</Text><Text dimColor={true}>Debug logs: {getDisplayPath(getDebugLogPath())}</Text>{isDetailedProfilingEnabled() && <Text dimColor={true}>Startup Perf: {getDisplayPath(getStartupPerfLogPath())}</Text>}</Box>;
    t39 = false && <GateOverridesWarning />;
    t40 = false && <ExperimentEnrollmentNotice />;
    $[86] = t37;
    $[87] = t38;
    $[88] = t39;
    $[89] = t40;
  } else {
    t37 = $[86];
    t38 = $[87];
    t39 = $[88];
    t40 = $[89];
  }
  let t41;
  if ($[90] !== t28 || $[91] !== t35 || $[92] !== t36) {
    t41 = <>{t28}{t29}{t30}{t31}{t32}{t33}{t34}{t35}{t36}{t37}{t38}{t39}{t40}</>;
    $[90] = t28;
    $[91] = t35;
    $[92] = t36;
    $[93] = t41;
  } else {
    t41 = $[93];
  }
  return t41;
}
// 配置更新函数：版本号没变就原样返回（避免无意义写盘），变了就展开旧配置覆盖版本字段。
function _temp3(current) {
  if (current.lastReleaseNotesSeen === MACRO.VERSION) {
    return current;
  }
  return {
    ...current,
    lastReleaseNotesSeen: MACRO.VERSION
  };
}
function _temp2(s_0) {
  return s_0.effortValue;
}
function _temp(s) {
  return s.agent;
}
// 原文件此处有一行 55096 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。