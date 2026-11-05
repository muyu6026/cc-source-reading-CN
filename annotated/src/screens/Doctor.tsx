// 同样是编译器产物：整份诊断屏的记忆槽由这一行引入的运行时管理
import { c as _c } from "react/compiler-runtime";
import figures from 'figures';
import { join } from 'path';
import React, { Suspense, use, useCallback, useEffect, useMemo, useState } from 'react';
import { KeybindingWarnings } from 'src/components/KeybindingWarnings.js';
import { McpParsingWarnings } from 'src/components/mcp/McpParsingWarnings.js';
import { getModelMaxOutputTokens } from 'src/utils/context.js';
import { getClaudeConfigHomeDir } from 'src/utils/envUtils.js';
import type { SettingSource } from 'src/utils/settings/constants.js';
import { getOriginalCwd } from '../bootstrap/state.js';
import type { CommandResultDisplay } from '../commands.js';
import { Pane } from '../components/design-system/Pane.js';
import { PressEnterToContinue } from '../components/PressEnterToContinue.js';
import { SandboxDoctorSection } from '../components/sandbox/SandboxDoctorSection.js';
import { ValidationErrorsList } from '../components/ValidationErrorsList.js';
import { useSettingsErrors } from '../hooks/notifs/useSettingsErrors.js';
import { useExitOnCtrlCDWithKeybindings } from '../hooks/useExitOnCtrlCDWithKeybindings.js';
import { Box, Text } from '../ink.js';
import { useKeybindings } from '../keybindings/useKeybinding.js';
import { useAppState } from '../state/AppState.js';
import { getPluginErrorMessage } from '../types/plugin.js';
import { getGcsDistTags, getNpmDistTags, type NpmDistTags } from '../utils/autoUpdater.js';
import { type ContextWarnings, checkContextWarnings } from '../utils/doctorContextWarnings.js';
import { type DiagnosticInfo, getDoctorDiagnostic } from '../utils/doctorDiagnostic.js';
import { validateBoundedIntEnvVar } from '../utils/envValidation.js';
import { pathExists } from '../utils/file.js';
import { cleanupStaleLocks, getAllLockInfo, isPidBasedLockingEnabled, type LockInfo } from '../utils/nativeInstaller/pidLock.js';
import { getInitialSettings } from '../utils/settings/settings.js';
import { BASH_MAX_OUTPUT_DEFAULT, BASH_MAX_OUTPUT_UPPER_LIMIT } from '../utils/shell/outputLimits.js';
import { TASK_MAX_OUTPUT_DEFAULT, TASK_MAX_OUTPUT_UPPER_LIMIT } from '../utils/task/outputFormatting.js';
import { getXDGStateHome } from '../utils/xdg.js';
type Props = {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
};
type AgentInfo = {
  activeAgents: Array<{
    agentType: string;
    source: SettingSource | 'built-in' | 'plugin';
  }>;
  userAgentsDir: string;
  projectAgentsDir: string;
  userDirExists: boolean;
  projectDirExists: boolean;
  failedFiles?: Array<{
    path: string;
    error: string;
  }>;
};
type VersionLockInfo = {
  enabled: boolean;
  locks: LockInfo[];
  locksDir: string;
  staleLocksCleaned: number;
};
// 版本标签单独拆成一个组件，因为它要靠挂起边界等待一个在外层就已发起的请求
function DistTagsDisplay(t0) {
  const $ = _c(8);
  const {
    promise
  } = t0;
// 在渲染里直接解包承诺：外层已经有兜底边界，这里挂起是安全的
  const distTags = use(promise);
  if (!distTags.latest) {
    let t1;
// 取不到版本时连静态节点都值得缓存：哨兵让这条失败文案只创建一次
    if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
      t1 = <Text dimColor={true}>└ Failed to fetch versions</Text>;
      $[0] = t1;
    } else {
      t1 = $[0];
    }
    return t1;
  }
  let t1;
  if ($[1] !== distTags.stable) {
    t1 = distTags.stable && <Text>└ Stable version: {distTags.stable}</Text>;
    $[1] = distTags.stable;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  let t2;
  if ($[3] !== distTags.latest) {
    t2 = <Text>└ Latest version: {distTags.latest}</Text>;
    $[3] = distTags.latest;
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  let t3;
  if ($[5] !== t1 || $[6] !== t2) {
    t3 = <>{t1}{t2}</>;
    $[5] = t1;
    $[6] = t2;
    $[7] = t3;
  } else {
    t3 = $[7];
  }
  return t3;
}
// 诊断屏主体。它是斜杠命令返回的节点，整块渲染在面板容器里
export function Doctor(t0) {
// 八十四是这份组件分配到的槽位总数，分支里每个记忆表达式占一格
  const $ = _c(84);
  const {
    onDone
  } = t0;
// 四个选择器各取一块全局状态：代理定义、MCP 工具、权限上下文、插件错误
  const agentDefinitions = useAppState(_temp);
  const mcpTools = useAppState(_temp2);
  const toolPermissionContext = useAppState(_temp3);
  const pluginsErrors = useAppState(_temp4);
  useExitOnCtrlCDWithKeybindings();
  let t1;
  if ($[0] !== mcpTools) {
    t1 = mcpTools || [];
    $[0] = mcpTools;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const tools = t1;
// 四块异步结果都以空开始：界面先显示检查中，等各自的承诺落地再换
  const [diagnostic, setDiagnostic] = useState(null);
  const [agentInfo, setAgentInfo] = useState(null);
  const [contextWarnings, setContextWarnings] = useState(null);
  const [versionLockInfo, setVersionLockInfo] = useState(null);
// 设置文件的校验错误来自独立钩子，它自己处理监听与去重
  const validationErrors = useSettingsErrors();
  let t2;
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
// 诊断结果与版本标签在同一个承诺链里：先拿安装信息，再据此决定去哪个源查版本号
    t2 = getDoctorDiagnostic().then(_temp6);
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  const distTagsPromise = t2;
// 频道名从设置里读，读不到就按最新版处理
  const autoUpdatesChannel = getInitialSettings()?.autoUpdatesChannel ?? "latest";
  let t3;
  if ($[3] !== validationErrors) {
// MCP 的校验错误被滤掉：那部分有专门的组件展示，重复列出只会让报告更长
    t3 = validationErrors.filter(_temp7);
    $[3] = validationErrors;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  const errorsExcludingMcp = t3;
  let t4;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
// 三个数值环境变量的规格一次建好：两个是输出长度，第三个要按模型算
    const envVars = [{
      name: "BASH_MAX_OUTPUT_LENGTH",
      default: BASH_MAX_OUTPUT_DEFAULT,
      upperLimit: BASH_MAX_OUTPUT_UPPER_LIMIT
    }, {
      name: "TASK_MAX_OUTPUT_LENGTH",
      default: TASK_MAX_OUTPUT_DEFAULT,
      upperLimit: TASK_MAX_OUTPUT_UPPER_LIMIT
    }, {
      name: "CLAUDE_CODE_MAX_OUTPUT_TOKENS",
// 输出令牌上限复用模型的取值函数，参数写的是当前旗舰模型，目的是拿到与运行时一致的默认值与上限
      ...getModelMaxOutputTokens("claude-opus-4-6")
    }];
    t4 = envVars.map(_temp8).filter(_temp9);
    $[5] = t4;
  } else {
    t4 = $[5];
  }
// 只保留不合格的项，合格的不占版面
  const envValidationErrors = t4;
  let t5;
  let t6;
  if ($[6] !== agentDefinitions || $[7] !== toolPermissionContext || $[8] !== tools) {
// 主效果：四件事并行发起，各自完成后写回自己的状态
    t5 = () => {
      getDoctorDiagnostic().then(setDiagnostic);
      (async () => {
        const userAgentsDir = join(getClaudeConfigHomeDir(), "agents");
        const projectAgentsDir = join(getOriginalCwd(), ".claude", "agents");
        const {
          activeAgents,
          allAgents,
          failedFiles
        } = agentDefinitions;
// 两个目录的存在性并行检查，串行会白白多等一个往返
        const [userDirExists, projectDirExists] = await Promise.all([pathExists(userAgentsDir), pathExists(projectAgentsDir)]);
        const agentInfoData = {
          activeAgents: activeAgents.map(_temp0),
          userAgentsDir,
          projectAgentsDir,
          userDirExists,
          projectDirExists,
          failedFiles
        };
        setAgentInfo(agentInfoData);
// 上下文警告需要工具列表、代理定义与一个延迟取权限的函数。权限用回调形式给，避免在收集阶段就读全局
        const warnings = await checkContextWarnings(tools, {
          activeAgents,
          allAgents,
          failedFiles
        }, async () => toolPermissionContext);
        setContextWarnings(warnings);
// 版本锁只在按进程号加锁的构建里存在；开启时顺手清理失效锁，再把剩余锁列出来
        if (isPidBasedLockingEnabled()) {
          const locksDir = join(getXDGStateHome(), "claude", "locks");
          const staleLocksCleaned = cleanupStaleLocks(locksDir);
          const locks = getAllLockInfo(locksDir);
          setVersionLockInfo({
            enabled: true,
            locks,
            locksDir,
            staleLocksCleaned
          });
        } else {
// 未开启时给出同样结构但空内容：消费方不必判断这个字段有没有
          setVersionLockInfo({
            enabled: false,
            locks: [],
            locksDir: "",
            staleLocksCleaned: 0
          });
        }
      })();
    };
    t6 = [toolPermissionContext, tools, agentDefinitions];
    $[6] = agentDefinitions;
    $[7] = toolPermissionContext;
    $[8] = tools;
    $[9] = t5;
    $[10] = t6;
  } else {
    t5 = $[9];
    t6 = $[10];
  }
  useEffect(t5, t6);
  let t7;
  if ($[11] !== onDone) {
    t7 = () => {
      onDone("Claude Code diagnostics dismissed", {
        display: "system"
      });
    };
    $[11] = onDone;
    $[12] = t7;
  } else {
    t7 = $[12];
  }
  const handleDismiss = t7;
  let t8;
  if ($[13] !== handleDismiss) {
    t8 = {
      "confirm:yes": handleDismiss,
      "confirm:no": handleDismiss
    };
    $[13] = handleDismiss;
    $[14] = t8;
  } else {
    t8 = $[14];
  }
  let t9;
  if ($[15] === Symbol.for("react.memo_cache_sentinel")) {
    t9 = {
      context: "Confirmation"
    };
    $[15] = t9;
  } else {
    t9 = $[15];
  }
  useKeybindings(t8, t9);
// 诊断还没回来时显示检查中。这个分支之后的所有渲染都假定诊断已有
  if (!diagnostic) {
    let t10;
    if ($[16] === Symbol.for("react.memo_cache_sentinel")) {
      t10 = <Pane><Text dimColor={true}>Checking installation status…</Text></Pane>;
      $[16] = t10;
    } else {
      t10 = $[16];
    }
    return t10;
  }
  let t10;
  if ($[17] === Symbol.for("react.memo_cache_sentinel")) {
    t10 = <Text bold={true}>Diagnostics</Text>;
    $[17] = t10;
  } else {
    t10 = $[17];
  }
  let t11;
  if ($[18] !== diagnostic.installationType || $[19] !== diagnostic.version) {
    t11 = <Text>└ Currently running: {diagnostic.installationType} ({diagnostic.version})</Text>;
    $[18] = diagnostic.installationType;
    $[19] = diagnostic.version;
    $[20] = t11;
  } else {
    t11 = $[20];
  }
  let t12;
  if ($[21] !== diagnostic.packageManager) {
    t12 = diagnostic.packageManager && <Text>└ Package manager: {diagnostic.packageManager}</Text>;
    $[21] = diagnostic.packageManager;
    $[22] = t12;
  } else {
    t12 = $[22];
  }
  let t13;
  if ($[23] !== diagnostic.installationPath) {
    t13 = <Text>└ Path: {diagnostic.installationPath}</Text>;
    $[23] = diagnostic.installationPath;
    $[24] = t13;
  } else {
    t13 = $[24];
  }
  let t14;
  if ($[25] !== diagnostic.invokedBinary) {
    t14 = <Text>└ Invoked: {diagnostic.invokedBinary}</Text>;
    $[25] = diagnostic.invokedBinary;
    $[26] = t14;
  } else {
    t14 = $[26];
  }
  let t15;
  if ($[27] !== diagnostic.configInstallMethod) {
    t15 = <Text>└ Config install method: {diagnostic.configInstallMethod}</Text>;
    $[27] = diagnostic.configInstallMethod;
    $[28] = t15;
  } else {
    t15 = $[28];
  }
// 搜索能力的状态映射：可用性只两个词，来源按模式映射成三种说法
  const t16 = diagnostic.ripgrepStatus.working ? "OK" : "Not working";
  const t17 = diagnostic.ripgrepStatus.mode === "embedded" ? "bundled" : diagnostic.ripgrepStatus.mode === "builtin" ? "vendor" : diagnostic.ripgrepStatus.systemPath || "system";
  let t18;
  if ($[29] !== t16 || $[30] !== t17) {
    t18 = <Text>└ Search: {t16} ({t17})</Text>;
    $[29] = t16;
    $[30] = t17;
    $[31] = t18;
  } else {
    t18 = $[31];
  }
  let t19;
  if ($[32] !== diagnostic.recommendation) {
// 建议拆成两行显示：第一行是结论，第二行是补充命令，两者在同一个字符串里用换行分隔
    t19 = diagnostic.recommendation && <><Text /><Text color="warning">Recommendation: {diagnostic.recommendation.split("\n")[0]}</Text><Text dimColor={true}>{diagnostic.recommendation.split("\n")[1]}</Text></>;
    $[32] = diagnostic.recommendation;
    $[33] = t19;
  } else {
    t19 = $[33];
  }
  let t20;
  if ($[34] !== diagnostic.multipleInstallations) {
// 检测到多份安装时逐条列出位置，这类问题最常见的原因就是装了两遍
    t20 = diagnostic.multipleInstallations.length > 1 && <><Text /><Text color="warning">Warning: Multiple installations found</Text>{diagnostic.multipleInstallations.map(_temp1)}</>;
    $[34] = diagnostic.multipleInstallations;
    $[35] = t20;
  } else {
    t20 = $[35];
  }
  let t21;
  if ($[36] !== diagnostic.warnings) {
    t21 = diagnostic.warnings.length > 0 && <><Text />{diagnostic.warnings.map(_temp10)}</>;
    $[36] = diagnostic.warnings;
    $[37] = t21;
  } else {
    t21 = $[37];
  }
  let t22;
  if ($[38] !== errorsExcludingMcp) {
// 设置文件的错误单独成块，与 MCP 的解析警告分开
    t22 = errorsExcludingMcp.length > 0 && <Box flexDirection="column" marginTop={1} marginBottom={1}><Text bold={true}>Invalid Settings</Text><ValidationErrorsList errors={errorsExcludingMcp} /></Box>;
    $[38] = errorsExcludingMcp;
    $[39] = t22;
  } else {
    t22 = $[39];
  }
  let t23;
  if ($[40] !== t11 || $[41] !== t12 || $[42] !== t13 || $[43] !== t14 || $[44] !== t15 || $[45] !== t18 || $[46] !== t19 || $[47] !== t20 || $[48] !== t21 || $[49] !== t22) {
// 主诊断块：标题加五行键值，全部用树形前缀缩进
    t23 = <Box flexDirection="column">{t10}{t11}{t12}{t13}{t14}{t15}{t18}{t19}{t20}{t21}{t22}</Box>;
    $[40] = t11;
    $[41] = t12;
    $[42] = t13;
    $[43] = t14;
    $[44] = t15;
    $[45] = t18;
    $[46] = t19;
    $[47] = t20;
    $[48] = t21;
    $[49] = t22;
    $[50] = t23;
  } else {
    t23 = $[50];
  }
  let t24;
  if ($[51] === Symbol.for("react.memo_cache_sentinel")) {
    t24 = <Text bold={true}>Updates</Text>;
    $[51] = t24;
  } else {
    t24 = $[51];
  }
// 由包管理器托管时不管自动更新开关：那种安装方式下更新不由自己执行
  const t25 = diagnostic.packageManager ? "Managed by package manager" : diagnostic.autoUpdates;
  let t26;
  if ($[52] !== t25) {
    t26 = <Text>└ Auto-updates:{" "}{t25}</Text>;
    $[52] = t25;
    $[53] = t26;
  } else {
    t26 = $[53];
  }
  let t27;
  if ($[54] !== diagnostic.hasUpdatePermissions) {
// 权限字段是三态：空表示不适用，真为有权限，假为需要提权
    t27 = diagnostic.hasUpdatePermissions !== null && <Text>└ Update permissions:{" "}{diagnostic.hasUpdatePermissions ? "Yes" : "No (requires sudo)"}</Text>;
    $[54] = diagnostic.hasUpdatePermissions;
    $[55] = t27;
  } else {
    t27 = $[55];
  }
  let t28;
  if ($[56] === Symbol.for("react.memo_cache_sentinel")) {
    t28 = <Text>└ Auto-update channel: {autoUpdatesChannel}</Text>;
    $[56] = t28;
  } else {
    t28 = $[56];
  }
  let t29;
  if ($[57] === Symbol.for("react.memo_cache_sentinel")) {
// 版本标签放在挂起边界里：请求挂起时这一行不占位，其余诊断照常显示
    t29 = <Suspense fallback={null}><DistTagsDisplay promise={distTagsPromise} /></Suspense>;
    $[57] = t29;
  } else {
    t29 = $[57];
  }
  let t30;
  if ($[58] !== t26 || $[59] !== t27) {
    t30 = <Box flexDirection="column">{t24}{t26}{t27}{t28}{t29}</Box>;
    $[58] = t26;
    $[59] = t27;
    $[60] = t30;
  } else {
    t30 = $[60];
  }
  let t31;
  let t32;
  let t33;
  let t34;
  if ($[61] === Symbol.for("react.memo_cache_sentinel")) {
// 沙箱、解析警告、键位三块各自独立，都是自带数据的空壳组件
    t31 = <SandboxDoctorSection />;
    t32 = <McpParsingWarnings />;
    t33 = <KeybindingWarnings />;
    t34 = envValidationErrors.length > 0 && <Box flexDirection="column"><Text bold={true}>Environment Variables</Text>{envValidationErrors.map(_temp11)}</Box>;
    $[61] = t31;
    $[62] = t32;
    $[63] = t33;
    $[64] = t34;
  } else {
    t31 = $[61];
    t32 = $[62];
    t33 = $[63];
    t34 = $[64];
  }
  let t35;
  if ($[65] !== versionLockInfo) {
// 版本锁区块：先报清理了几条失效锁，再逐条列出仍在使用的版本与进程
    t35 = versionLockInfo?.enabled && <Box flexDirection="column"><Text bold={true}>Version Locks</Text>{versionLockInfo.staleLocksCleaned > 0 && <Text dimColor={true}>└ Cleaned {versionLockInfo.staleLocksCleaned} stale lock(s)</Text>}{versionLockInfo.locks.length === 0 ? <Text dimColor={true}>└ No active version locks</Text> : versionLockInfo.locks.map(_temp12)}</Box>;
    $[65] = versionLockInfo;
    $[66] = t35;
  } else {
    t35 = $[66];
  }
  let t36;
  if ($[67] !== agentInfo) {
// 代理文件解析失败时逐条列出路径与错误原因
    t36 = agentInfo?.failedFiles && agentInfo.failedFiles.length > 0 && <Box flexDirection="column"><Text bold={true} color="error">Agent Parse Errors</Text><Text color="error">└ Failed to parse {agentInfo.failedFiles.length} agent file(s):</Text>{agentInfo.failedFiles.map(_temp13)}</Box>;
    $[67] = agentInfo;
    $[68] = t36;
  } else {
    t36 = $[68];
  }
  let t37;
  if ($[69] !== pluginsErrors) {
// 插件错误同理，每条带上来源与所属插件名
    t37 = pluginsErrors.length > 0 && <Box flexDirection="column"><Text bold={true} color="error">Plugin Errors</Text><Text color="error">└ {pluginsErrors.length} plugin error(s) detected:</Text>{pluginsErrors.map(_temp14)}</Box>;
    $[69] = pluginsErrors;
    $[70] = t37;
  } else {
    t37 = $[70];
  }
  let t38;
  if ($[71] !== contextWarnings) {
// 不可达的权限规则单独成块：这类规则永远匹配不到，属于配置里的死代码
    t38 = contextWarnings?.unreachableRulesWarning && <Box flexDirection="column"><Text bold={true} color="warning">Unreachable Permission Rules</Text><Text>└{" "}<Text color="warning">{figures.warning}{" "}{contextWarnings.unreachableRulesWarning.message}</Text></Text>{contextWarnings.unreachableRulesWarning.details.map(_temp15)}</Box>;
    $[71] = contextWarnings;
    $[72] = t38;
  } else {
    t38 = $[72];
  }
  let t39;
  if ($[73] !== contextWarnings) {
// 上下文占用警告三选：项目说明文件、代理定义、服务端各一条，都带贡献者明细
    t39 = contextWarnings && (contextWarnings.claudeMdWarning || contextWarnings.agentWarning || contextWarnings.mcpWarning) && <Box flexDirection="column"><Text bold={true}>Context Usage Warnings</Text>{contextWarnings.claudeMdWarning && <><Text>└{" "}<Text color="warning">{figures.warning} {contextWarnings.claudeMdWarning.message}</Text></Text><Text>{"  "}└ Files:</Text>{contextWarnings.claudeMdWarning.details.map(_temp16)}</>}{contextWarnings.agentWarning && <><Text>└{" "}<Text color="warning">{figures.warning} {contextWarnings.agentWarning.message}</Text></Text><Text>{"  "}└ Top contributors:</Text>{contextWarnings.agentWarning.details.map(_temp17)}</>}{contextWarnings.mcpWarning && <><Text>└{" "}<Text color="warning">{figures.warning} {contextWarnings.mcpWarning.message}</Text></Text><Text>{"  "}└ MCP servers:</Text>{contextWarnings.mcpWarning.details.map(_temp18)}</>}</Box>;
    $[73] = contextWarnings;
    $[74] = t39;
  } else {
    t39 = $[74];
  }
  let t40;
  if ($[75] === Symbol.for("react.memo_cache_sentinel")) {
// 底部提示按回车继续，它是这个屏唯一的主动退出方式
    t40 = <Box><PressEnterToContinue /></Box>;
    $[75] = t40;
  } else {
    t40 = $[75];
  }
  let t41;
  if ($[76] !== t23 || $[77] !== t30 || $[78] !== t35 || $[79] !== t36 || $[80] !== t37 || $[81] !== t38 || $[82] !== t39) {
// 面板里依次排：主诊断、更新、三个独立警告块、版本锁、代理错误、插件错误、权限规则、占用警告、退出提示
    t41 = <Pane>{t23}{t30}{t31}{t32}{t33}{t34}{t35}{t36}{t37}{t38}{t39}{t40}</Pane>;
    $[76] = t23;
    $[77] = t30;
    $[78] = t35;
    $[79] = t36;
    $[80] = t37;
    $[81] = t38;
    $[82] = t39;
    $[83] = t41;
  } else {
    t41 = $[83];
  }
  return t41;
}
function _temp18(detail_2, i_8) {
  return <Text key={i_8} dimColor={true}>{"    "}└ {detail_2}</Text>;
}
function _temp17(detail_1, i_7) {
  return <Text key={i_7} dimColor={true}>{"    "}└ {detail_1}</Text>;
}
function _temp16(detail_0, i_6) {
  return <Text key={i_6} dimColor={true}>{"    "}└ {detail_0}</Text>;
}
function _temp15(detail, i_5) {
  return <Text key={i_5} dimColor={true}>{"  "}└ {detail}</Text>;
}
function _temp14(error_0, i_4) {
  return <Text key={i_4} dimColor={true}>{"  "}└ {error_0.source || "unknown"}{"plugin" in error_0 && error_0.plugin ? ` [${error_0.plugin}]` : ""}:{" "}{getPluginErrorMessage(error_0)}</Text>;
}
function _temp13(file, i_3) {
  return <Text key={i_3} dimColor={true}>{"  "}└ {file.path}: {file.error}</Text>;
}
function _temp12(lock, i_2) {
// 进程仍在运行与已失效用不同颜色标出：前者是占用，后者可以清理
  return <Text key={i_2}>└ {lock.version}: PID {lock.pid}{" "}{lock.isProcessRunning ? <Text>(running)</Text> : <Text color="warning">(stale)</Text>}</Text>;
}
function _temp11(validation, i_1) {
// 环境变量校验里，被截到上限与非法值是两回事，前者只是提醒
  return <Text key={i_1}>└ {validation.name}:{" "}<Text color={validation.status === "capped" ? "warning" : "error"}>{validation.message}</Text></Text>;
}
function _temp10(warning, i_0) {
  return <Box key={i_0} flexDirection="column"><Text color="warning">Warning: {warning.issue}</Text><Text>Fix: {warning.fix}</Text></Box>;
}
function _temp1(install, i) {
  return <Text key={i}>└ {install.type} at {install.path}</Text>;
}
function _temp0(a) {
  return {
    agentType: a.agentType,
    source: a.source
  };
}
function _temp9(v_0) {
  return v_0.status !== "valid";
}
function _temp8(v) {
  const value = process.env[v.name];
  const result = validateBoundedIntEnvVar(v.name, value, v.default, v.upperLimit);
  return {
    name: v.name,
    ...result
  };
}
// 滤掉服务端相关的设置错误，它们由专门的组件负责展示
function _temp7(error) {
  return error.mcpErrorMetadata === undefined;
}
function _temp6(diag) {
// 原生安装查自己的分发源，其余走包管理器源：两者的版本号可能不同步
  const fetchDistTags = diag.installationType === "native" ? getGcsDistTags : getNpmDistTags;
  return fetchDistTags().catch(_temp5);
}
// 查询失败时返回空标签而不是抛错，界面会显示取版本失败
function _temp5() {
  return {
    latest: null,
    stable: null
  };
}
function _temp4(s_2) {
  return s_2.plugins.errors;
}
function _temp3(s_1) {
  return s_1.toolPermissionContext;
}
function _temp2(s_0) {
  return s_0.mcp.tools;
}
function _temp(s) {
  return s.agentDefinitions;
}
// 原文件此处有一行 54060 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。