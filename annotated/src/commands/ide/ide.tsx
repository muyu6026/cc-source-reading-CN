// 这一行说明整份代码是 React 编译器的产物：下面每个函数的记忆槽与临时变量都是生成出来的，不是手写
import { c as _c } from "react/compiler-runtime";
import chalk from 'chalk';
import * as path from 'path';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { logEvent } from 'src/services/analytics/index.js';
import type { CommandResultDisplay, LocalJSXCommandContext } from '../../commands.js';
import { Select } from '../../components/CustomSelect/index.js';
import { Dialog } from '../../components/design-system/Dialog.js';
import { IdeAutoConnectDialog, IdeDisableAutoConnectDialog, shouldShowAutoConnectDialog, shouldShowDisableAutoConnectDialog } from '../../components/IdeAutoConnectDialog.js';
import { Box, Text } from '../../ink.js';
import { clearServerCache } from '../../services/mcp/client.js';
import type { ScopedMcpServerConfig } from '../../services/mcp/types.js';
import { useAppState, useSetAppState } from '../../state/AppState.js';
import { getCwd } from '../../utils/cwd.js';
import { execFileNoThrow } from '../../utils/execFileNoThrow.js';
// IDE 检测的工具集合：探测、枚举运行中的实例、JetBrains 判定、终端能力判定、显示名映射
import { type DetectedIDEInfo, detectIDEs, detectRunningIDEs, type IdeType, isJetBrainsIde, isSupportedJetBrainsTerminal, isSupportedTerminal, toIDEDisplayName } from '../../utils/ide.js';
import { getCurrentWorktreeSession } from '../../utils/worktree.js';
type IDEScreenProps = {
  availableIDEs: DetectedIDEInfo[];
  unavailableIDEs: DetectedIDEInfo[];
  selectedIDE?: DetectedIDEInfo | null;
  onClose: () => void;
  onSelect: (ide?: DetectedIDEInfo) => void;
};
// 主选择屏。参数名被编译器改成了 t0，下面手工解构回属性
function IDEScreen(t0) {
  const $ = _c(39);
  const {
    availableIDEs,
    unavailableIDEs,
    selectedIDE,
    onClose,
    onSelect
  } = t0;
  let t1;
// 记忆槽的第一类是派生标量：端口转字符串只在端口变化时重算，输入与结果各占一格
  if ($[0] !== selectedIDE?.port) {
    t1 = selectedIDE?.port?.toString() ?? "None";
    $[0] = selectedIDE?.port;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
// 状态的初值取自上面那个记忆结果，所以重渲染不会把用户的选择重置掉
  const [selectedValue, setSelectedValue] = useState(t1);
  const [showAutoConnectDialog, setShowAutoConnectDialog] = useState(false);
  const [showDisableAutoConnectDialog, setShowDisableAutoConnectDialog] = useState(false);
  let t2;
// 选择回调只在可用列表或提交函数变化时重建。两个自动连接对话框的判定插在提交之前，等于给选择动作加了两道前置拦截
  if ($[2] !== availableIDEs || $[3] !== onSelect) {
    t2 = value => {
      if (value !== "None" && shouldShowAutoConnectDialog()) {
        setShowAutoConnectDialog(true);
      } else {
        if (value === "None" && shouldShowDisableAutoConnectDialog()) {
          setShowDisableAutoConnectDialog(true);
        } else {
          onSelect(availableIDEs.find(ide => ide.port === parseInt(value)));
        }
      }
    };
    $[2] = availableIDEs;
    $[3] = onSelect;
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  const handleSelectIDE = t2;
  let t3;
// 同名实例的计数用一次累加算完并记忆，后面决定要不要显示工作区路径就靠它
  if ($[5] !== availableIDEs) {
    t3 = availableIDEs.reduce(_temp, {});
    $[5] = availableIDEs;
    $[6] = t3;
  } else {
    t3 = $[6];
  }
  const ideCounts = t3;
  let t4;
  if ($[7] !== availableIDEs || $[8] !== ideCounts) {
    let t5;
    if ($[10] !== ideCounts) {
// 选项映射：只有同名实例多于一个时才补上工作区路径，否则同名项在列表里根本无法区分
      t5 = ide_1 => {
        const hasMultipleInstances = (ideCounts[ide_1.name] || 0) > 1;
        const showWorkspace = hasMultipleInstances && ide_1.workspaceFolders.length > 0;
        return {
          label: ide_1.name,
          value: ide_1.port.toString(),
          description: showWorkspace ? formatWorkspaceFolders(ide_1.workspaceFolders) : undefined
        };
      };
      $[10] = ideCounts;
      $[11] = t5;
    } else {
      t5 = $[11];
    }
// 最后追加一个 None 选项。它同时承担断开连接的语义，所以值用的是字符串而不是端口号
    t4 = availableIDEs.map(t5).concat([{
      label: "None",
      value: "None",
      description: undefined
    }]);
    $[7] = availableIDEs;
    $[8] = ideCounts;
    $[9] = t4;
  } else {
    t4 = $[9];
  }
  const options = t4;
  if (showAutoConnectDialog) {
    let t5;
    if ($[12] !== handleSelectIDE || $[13] !== selectedValue) {
      t5 = <IdeAutoConnectDialog onComplete={() => handleSelectIDE(selectedValue)} />;
      $[12] = handleSelectIDE;
      $[13] = selectedValue;
      $[14] = t5;
    } else {
      t5 = $[14];
    }
    return t5;
  }
  if (showDisableAutoConnectDialog) {
    let t5;
    if ($[15] !== onSelect) {
      t5 = <IdeDisableAutoConnectDialog onComplete={() => {
        onSelect(undefined);
      }} />;
      $[15] = onSelect;
      $[16] = t5;
    } else {
      t5 = $[16];
    }
    return t5;
  }
  let t5;
  if ($[17] !== availableIDEs.length) {
// 空态文案按终端类型分叉：JetBrains 终端里提示去装插件并给了文档地址，其余终端提示确认扩展已安装且在运行
    t5 = availableIDEs.length === 0 && <Text dimColor={true}>{isSupportedJetBrainsTerminal() ? "No available IDEs detected. Please install the plugin and restart your IDE:\nhttps://docs.claude.com/s/claude-code-jetbrains" : "No available IDEs detected. Make sure your IDE has the Claude Code extension or plugin installed and is running."}</Text>;
    $[17] = availableIDEs.length;
    $[18] = t5;
  } else {
    t5 = $[18];
  }
  let t6;
  if ($[19] !== availableIDEs.length || $[20] !== handleSelectIDE || $[21] !== options || $[22] !== selectedValue) {
    t6 = availableIDEs.length !== 0 && <Select defaultValue={selectedValue} defaultFocusValue={selectedValue} options={options} onChange={value_0 => {
      setSelectedValue(value_0);
      handleSelectIDE(value_0);
    }} />;
    $[19] = availableIDEs.length;
    $[20] = handleSelectIDE;
    $[21] = options;
    $[22] = selectedValue;
    $[23] = t6;
  } else {
    t6 = $[23];
  }
  let t7;
  if ($[24] !== availableIDEs) {
// VS Code 同时只能连一个实例，检测到多个时给一条警告而不是禁用选择
    t7 = availableIDEs.length !== 0 && availableIDEs.some(_temp2) && <Box marginTop={1}><Text color="warning">Note: Only one Claude Code instance can be connected to VS Code at a time.</Text></Box>;
    $[24] = availableIDEs;
    $[25] = t7;
  } else {
    t7 = $[25];
  }
  let t8;
  if ($[26] !== availableIDEs.length) {
    t8 = availableIDEs.length !== 0 && !isSupportedTerminal() && <Box marginTop={1}><Text dimColor={true}>Tip: You can enable auto-connect to IDE in /config or with the --ide flag</Text></Box>;
    $[26] = availableIDEs.length;
    $[27] = t8;
  } else {
    t8 = $[27];
  }
  let t9;
  if ($[28] !== unavailableIDEs) {
// 另一类是工作区不匹配的 IDE：能探测到在运行，但项目目录与当前工作目录不同，于是单独列在下面并附上路径
    t9 = unavailableIDEs.length > 0 && <Box marginTop={1} flexDirection="column"><Text dimColor={true}>Found {unavailableIDEs.length} other running IDE(s). However, their workspace/project directories do not match the current cwd.</Text><Box marginTop={1} flexDirection="column">{unavailableIDEs.map(_temp3)}</Box></Box>;
    $[28] = unavailableIDEs;
    $[29] = t9;
  } else {
    t9 = $[29];
  }
  let t10;
  if ($[30] !== t5 || $[31] !== t6 || $[32] !== t7 || $[33] !== t8 || $[34] !== t9) {
    t10 = <Box flexDirection="column">{t5}{t6}{t7}{t8}{t9}</Box>;
    $[30] = t5;
    $[31] = t6;
    $[32] = t7;
    $[33] = t8;
    $[34] = t9;
    $[35] = t10;
  } else {
    t10 = $[35];
  }
  let t11;
  if ($[36] !== onClose || $[37] !== t10) {
    t11 = <Dialog title="Select IDE" subtitle="Connect to an IDE for integrated development features." onCancel={onClose} color="ide">{t10}</Dialog>;
    $[36] = onClose;
    $[37] = t10;
    $[38] = t11;
  } else {
    t11 = $[38];
  }
  return t11;
}
function _temp3(ide_3, index) {
  return <Box key={index} paddingLeft={3}><Text dimColor={true}>• {ide_3.name}: {formatWorkspaceFolders(ide_3.workspaceFolders)}</Text></Box>;
}
function _temp2(ide_2) {
  return ide_2.name === "VS Code" || ide_2.name === "Visual Studio Code";
}
function _temp(acc, ide_0) {
  acc[ide_0.name] = (acc[ide_0.name] || 0) + 1;
  return acc;
}
// 从动态配置里反查当前连的是哪个 IDE：只认两种类型，再按地址精确匹配
async function findCurrentIDE(availableIDEs: DetectedIDEInfo[], dynamicMcpConfig?: Record<string, ScopedMcpServerConfig>): Promise<DetectedIDEInfo | null> {
  const currentConfig = dynamicMcpConfig?.ide;
  if (!currentConfig || currentConfig.type !== 'sse-ide' && currentConfig.type !== 'ws-ide') {
    return null;
  }
  for (const ide of availableIDEs) {
    if (ide.url === currentConfig.url) {
      return ide;
    }
  }
  return null;
}
type IDEOpenSelectionProps = {
  availableIDEs: DetectedIDEInfo[];
  onSelectIDE: (ide?: DetectedIDEInfo) => void;
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
};
// 打开项目的选择屏：比主屏简单，没有自动连接对话框，也不列不可用项
function IDEOpenSelection(t0) {
  const $ = _c(18);
  const {
    availableIDEs,
    onSelectIDE,
    onDone
  } = t0;
  let t1;
// 默认值取第一个实例的端口，和主屏一样走记忆槽
  if ($[0] !== availableIDEs[0]?.port) {
    t1 = availableIDEs[0]?.port?.toString() ?? "";
    $[0] = availableIDEs[0]?.port;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const [selectedValue, setSelectedValue] = useState(t1);
  let t2;
// 这里的选择直接回调上去，不做对话框拦截：打开项目不涉及连接状态变更
  if ($[2] !== availableIDEs || $[3] !== onSelectIDE) {
    t2 = value => {
      const selectedIDE = availableIDEs.find(ide => ide.port === parseInt(value));
      onSelectIDE(selectedIDE);
    };
    $[2] = availableIDEs;
    $[3] = onSelectIDE;
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  const handleSelectIDE = t2;
  let t3;
  if ($[5] !== availableIDEs) {
    t3 = availableIDEs.map(_temp4);
    $[5] = availableIDEs;
    $[6] = t3;
  } else {
    t3 = $[6];
  }
  const options = t3;
  let t4;
  if ($[7] !== onDone) {
    t4 = function handleCancel() {
      onDone("IDE selection cancelled", {
        display: "system"
      });
    };
    $[7] = onDone;
    $[8] = t4;
  } else {
    t4 = $[8];
  }
  const handleCancel = t4;
  let t5;
  if ($[9] !== handleSelectIDE) {
    t5 = value_0 => {
      setSelectedValue(value_0);
      handleSelectIDE(value_0);
    };
    $[9] = handleSelectIDE;
    $[10] = t5;
  } else {
    t5 = $[10];
  }
  let t6;
  if ($[11] !== options || $[12] !== selectedValue || $[13] !== t5) {
    t6 = <Select defaultValue={selectedValue} defaultFocusValue={selectedValue} options={options} onChange={t5} />;
    $[11] = options;
    $[12] = selectedValue;
    $[13] = t5;
    $[14] = t6;
  } else {
    t6 = $[14];
  }
  let t7;
  if ($[15] !== handleCancel || $[16] !== t6) {
    t7 = <Dialog title="Select an IDE to open the project" onCancel={handleCancel} color="ide">{t6}</Dialog>;
    $[15] = handleCancel;
    $[16] = t6;
    $[17] = t7;
  } else {
    t7 = $[17];
  }
  return t7;
}
function _temp4(ide_0) {
  return {
    label: ide_0.name,
    value: ide_0.port.toString()
  };
}
// 安装扩展时的 IDE 选择：输入是 IDE 类型而不是探测结果，因为此时扩展还没装，探测不到
function RunningIDESelector(t0) {
  const $ = _c(15);
  const {
    runningIDEs,
    onSelectIDE,
    onDone
  } = t0;
  const [selectedValue, setSelectedValue] = useState(runningIDEs[0] ?? "");
  let t1;
  if ($[0] !== onSelectIDE) {
    t1 = value => {
      onSelectIDE(value as IdeType);
    };
    $[0] = onSelectIDE;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const handleSelectIDE = t1;
  let t2;
  if ($[2] !== runningIDEs) {
    t2 = runningIDEs.map(_temp5);
    $[2] = runningIDEs;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  const options = t2;
  let t3;
  if ($[4] !== onDone) {
    t3 = function handleCancel() {
      onDone("IDE selection cancelled", {
        display: "system"
      });
    };
    $[4] = onDone;
    $[5] = t3;
  } else {
    t3 = $[5];
  }
  const handleCancel = t3;
  let t4;
  if ($[6] !== handleSelectIDE) {
    t4 = value_0 => {
      setSelectedValue(value_0);
      handleSelectIDE(value_0);
    };
    $[6] = handleSelectIDE;
    $[7] = t4;
  } else {
    t4 = $[7];
  }
  let t5;
  if ($[8] !== options || $[9] !== selectedValue || $[10] !== t4) {
    t5 = <Select defaultFocusValue={selectedValue} options={options} onChange={t4} />;
    $[8] = options;
    $[9] = selectedValue;
    $[10] = t4;
    $[11] = t5;
  } else {
    t5 = $[11];
  }
  let t6;
  if ($[12] !== handleCancel || $[13] !== t5) {
    t6 = <Dialog title="Select IDE to install extension" onCancel={handleCancel} color="ide">{t5}</Dialog>;
    $[12] = handleCancel;
    $[13] = t5;
    $[14] = t6;
  } else {
    t6 = $[14];
  }
  return t6;
}
function _temp5(ide) {
  return {
    label: toIDEDisplayName(ide),
    value: ide
  };
}
// 挂载即安装：一个只有副作用的组件，渲染输出是空
function InstallOnMount(t0) {
  const $ = _c(4);
  const {
    ide,
    onInstall
  } = t0;
  let t1;
  let t2;
  if ($[0] !== ide || $[1] !== onInstall) {
    t1 = () => {
      onInstall(ide);
    };
    t2 = [ide, onInstall];
    $[0] = ide;
    $[1] = onInstall;
    $[2] = t1;
    $[3] = t2;
  } else {
    t1 = $[2];
    t2 = $[3];
  }
  useEffect(t1, t2);
  return null;
}
// 命令入口。第一个参数是结束回调，第三个是斜杠命令后面的原始参数
export async function call(onDone: (result?: string, options?: {
  display?: CommandResultDisplay;
}) => void, context: LocalJSXCommandContext, args: string): Promise<React.ReactNode | null> {
  logEvent('tengu_ext_ide_command', {});
  const {
    options: {
      dynamicMcpConfig
    },
    onChangeDynamicMcpConfig
  } = context;

  // Handle 'open' argument
// 打开子命令：在当前项目目录（若在工作树里则用工作树路径）打开 IDE
  if (args?.trim() === 'open') {
    const worktreeSession = getCurrentWorktreeSession();
    const targetPath = worktreeSession ? worktreeSession.worktreePath : getCwd();

    // Detect available IDEs
// 探测时传真值表示要返回无效项，后面按有效性一分为二
    const detectedIDEs = await detectIDEs(true);
    const availableIDEs = detectedIDEs.filter(ide => ide.isValid);
    if (availableIDEs.length === 0) {
      onDone('No IDEs with Claude Code extension detected.');
      return null;
    }

    // Return IDE selection component
// 打开动作交给选择屏；回调里按 IDE 名字分派，因为此时还没建立连接，拿不到更强的判别信息
    return <IDEOpenSelection availableIDEs={availableIDEs} onSelectIDE={async (selectedIDE?: DetectedIDEInfo) => {
      if (!selectedIDE) {
        onDone('No IDE selected.');
        return;
      }

      // Try to open the project in the selected IDE
// VS Code 系三家共用 code 命令：名字里含代码编辑器、光标编辑器或风帆编辑器的都走这条
      if (selectedIDE.name.toLowerCase().includes('vscode') || selectedIDE.name.toLowerCase().includes('cursor') || selectedIDE.name.toLowerCase().includes('windsurf')) {
        // VS Code-based IDEs
        const {
          code
        } = await execFileNoThrow('code', [targetPath]);
        if (code === 0) {
          onDone(`Opened ${worktreeSession ? 'worktree' : 'project'} in ${chalk.bold(selectedIDE.name)}`);
        } else {
          onDone(`Failed to open in ${selectedIDE.name}. Try opening manually: ${targetPath}`);
        }
// JetBrains 与其余分支的文案完全一样，实际是两个空分支：它们通常没有可从命令行调用的打开入口，只能让用户手动开
      } else if (isSupportedJetBrainsTerminal()) {
        // JetBrains IDEs - they usually open via their CLI tools
        onDone(`Please open the ${worktreeSession ? 'worktree' : 'project'} manually in ${chalk.bold(selectedIDE.name)}: ${targetPath}`);
      } else {
        onDone(`Please open the ${worktreeSession ? 'worktree' : 'project'} manually in ${chalk.bold(selectedIDE.name)}: ${targetPath}`);
      }
    }} onDone={() => {
      onDone('Exited without opening IDE', {
        display: 'system'
      });
    }} />;
  }
  const detectedIDEs = await detectIDEs(true);

  // If no IDEs with extensions detected, check for running IDEs and offer to install
// 没装扩展但检测到有 IDE 在跑时，转成安装引导；不支持的终端里不做这件事，因为没有可靠的安装通道
  if (detectedIDEs.length === 0 && context.onInstallIDEExtension && !isSupportedTerminal()) {
    const runningIDEs = await detectRunningIDEs();
    const onInstall = (ide: IdeType) => {
      if (context.onInstallIDEExtension) {
        context.onInstallIDEExtension(ide);
        // The completion message will be shown after installation
        if (isJetBrainsIde(ide)) {
          onDone(`Installed plugin to ${chalk.bold(toIDEDisplayName(ide))}\n` + `Please ${chalk.bold('restart your IDE')} completely for it to take effect`);
        } else {
          onDone(`Installed extension to ${chalk.bold(toIDEDisplayName(ide))}`);
        }
      }
    };
    if (runningIDEs.length > 1) {
      // Show selector when multiple IDEs are running
      return <RunningIDESelector runningIDEs={runningIDEs} onSelectIDE={onInstall} onDone={() => {
        onDone('No IDE selected.', {
          display: 'system'
        });
      }} />;
// 只探测到一个在跑的 IDE 就不必再选，直接挂载安装组件
    } else if (runningIDEs.length === 1) {
      return <InstallOnMount ide={runningIDEs[0]!} onInstall={onInstall} />;
    }
  }
// 按有效性拆成两组：可连接的进主流程，不可连接的只用于展示
  const availableIDEs = detectedIDEs.filter(ide => ide.isValid);
  const unavailableIDEs = detectedIDEs.filter(ide => !ide.isValid);
// 反查当前连接要读动态配置，这里把配置一并传下去
  const currentIDE = await findCurrentIDE(availableIDEs, dynamicMcpConfig);
  return <IDECommandFlow availableIDEs={availableIDEs} unavailableIDEs={unavailableIDEs} currentIDE={currentIDE} dynamicMcpConfig={dynamicMcpConfig} onChangeDynamicMcpConfig={onChangeDynamicMcpConfig} onDone={onDone} />;
}

// Connection timeout slightly longer than the 30s MCP connection timeout
// 连接超时比 MCP 自身的三十秒略长，留出握手与状态回写的时间
const IDE_CONNECTION_TIMEOUT_MS = 35000;
type IDECommandFlowProps = {
  availableIDEs: DetectedIDEInfo[];
  unavailableIDEs: DetectedIDEInfo[];
  currentIDE: DetectedIDEInfo | null;
  dynamicMcpConfig?: Record<string, ScopedMcpServerConfig>;
  onChangeDynamicMcpConfig?: (config: Record<string, ScopedMcpServerConfig>) => void;
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
};
function IDECommandFlow({
  availableIDEs,
  unavailableIDEs,
  currentIDE,
  dynamicMcpConfig,
  onChangeDynamicMcpConfig,
  onDone
}: IDECommandFlowProps): React.ReactNode {
// 正在连接的 IDE 是本地状态：连接期间界面被替换成一行提示，不再显示选择列表
  const [connectingIDE, setConnectingIDE] = useState<DetectedIDEInfo | null>(null);
// 从全局状态里取 ide 这个 MCP 客户端，用名字匹配
  const ideClient = useAppState(s => s.mcp.clients.find(c => c.name === 'ide'));
  const setAppState = useSetAppState();
// 这个引用用来跳过第一次检查：效果首次运行时读到的还是配置变更之前的旧状态
  const isFirstCheckRef = useRef(true);

  // Watch for connection result
  useEffect(() => {
    if (!connectingIDE) return;
    // Skip the first check — it reflects stale state from before the
    // config change was dispatched
// 跳过首次之后，后续每次客户端状态变化才被当作真实结果处理
    if (isFirstCheckRef.current) {
      isFirstCheckRef.current = false;
      return;
    }
// 还没有客户端或仍在待连就继续等，只有连上或失败才收尾
    if (!ideClient || ideClient.type === 'pending') return;
    if (ideClient.type === 'connected') {
      onDone(`Connected to ${connectingIDE.name}.`);
    } else if (ideClient.type === 'failed') {
      onDone(`Failed to connect to ${connectingIDE.name}.`);
    }
  }, [ideClient, connectingIDE, onDone]);

  // Timeout fallback
// 兜底计时器：状态回调可能因为各种原因不来，超时后同样结束流程，避免界面永远停在连接中
  useEffect(() => {
    if (!connectingIDE) return;
    const timer = setTimeout(onDone, IDE_CONNECTION_TIMEOUT_MS, `Connection to ${connectingIDE.name} timed out.`);
    return () => clearTimeout(timer);
  }, [connectingIDE, onDone]);
// 真正的连接动作：改动态配置，让 MCP 层去建连接
  const handleSelectIDE = useCallback((selectedIDE?: DetectedIDEInfo) => {
    if (!onChangeDynamicMcpConfig) {
      onDone('Error connecting to IDE.');
      return;
    }
    const newConfig = {
      ...(dynamicMcpConfig || {})
    };
// 先删掉旧配置再写新的，否则同一份配置里会同时存在两个 ide 键
    if (currentIDE) {
      delete newConfig.ide;
    }
// 选 None 就是断开：这条路径要同时处理传输层与全局状态
    if (!selectedIDE) {
      // Close the MCP transport and remove the client from state
      if (ideClient && ideClient.type === 'connected' && currentIDE) {
        // Null out onclose to prevent auto-reconnection
// 先把关闭回调置空再关：直接关会触发客户端的自动重连逻辑，等于刚断就重连
        ideClient.client.onclose = () => {};
// 清掉服务端缓存，否则下一次连接可能复用已经失效的能力列表
        void clearServerCache('ide', ideClient.config);
// 三处一起清：客户端本身、以 ide 前缀的工具、同前缀的命令。少清一处就会留下幽灵条目
        setAppState(prev => ({
          ...prev,
          mcp: {
            ...prev.mcp,
            clients: prev.mcp.clients.filter(c_0 => c_0.name !== 'ide'),
            tools: prev.mcp.tools.filter(t => !t.name?.startsWith('mcp__ide__')),
            commands: prev.mcp.commands.filter(c_1 => !c_1.name?.startsWith('mcp__ide__'))
          }
        }));
      }
      onChangeDynamicMcpConfig(newConfig);
      onDone(currentIDE ? `Disconnected from ${currentIDE.name}.` : 'No IDE selected.');
      return;
    }
    const url = selectedIDE.url;
// 按地址协议决定类型：ws 开头走 WebSocket，其余按 SSE 处理
    newConfig.ide = {
      type: url.startsWith('ws:') ? 'ws-ide' : 'sse-ide',
      url: url,
      ideName: selectedIDE.name,
      authToken: selectedIDE.authToken,
      ideRunningInWindows: selectedIDE.ideRunningInWindows,
      scope: 'dynamic' as const
    } as ScopedMcpServerConfig;
// 把跳过标志复位，新的连接周期要重新跳过一次陈旧状态
    isFirstCheckRef.current = true;
    setConnectingIDE(selectedIDE);
    onChangeDynamicMcpConfig(newConfig);
  }, [dynamicMcpConfig, currentIDE, ideClient, setAppState, onChangeDynamicMcpConfig, onDone]);
  if (connectingIDE) {
    return <Text dimColor>Connecting to {connectingIDE.name}…</Text>;
  }
// 还没开始连接就渲染选择屏，把当前连接作为初始选中项传进去
  return <IDEScreen availableIDEs={availableIDEs} unavailableIDEs={unavailableIDEs} selectedIDE={currentIDE} onClose={() => onDone('IDE selection cancelled', {
    display: 'system'
  })} onSelect={handleSelectIDE} />;
}

/**
 * Formats workspace folders for display, stripping cwd and showing tail end of paths
 * @param folders Array of folder paths
 * @param maxLength Maximum total length of the formatted string
 * @returns Formatted string with folder paths
 */
// 路径展示函数：把绝对路径压成相对当前目录的短形式，超长时保留尾部
export function formatWorkspaceFolders(folders: string[], maxLength: number = 100): string {
  if (folders.length === 0) return '';
  const cwd = getCwd();

  // Only show first 2 workspaces
// 最多显示两个工作区，多的用省略号收尾——选择器只有一行高度
  const foldersToShow = folders.slice(0, 2);
  const hasMore = folders.length > 2;

  // Account for ", …" if there are more folders
// 省略号本身占三个字符，先把它从总预算里扣掉
  const ellipsisOverhead = hasMore ? 3 : 0; // ", …"

  // Account for commas and spaces between paths (", " = 2 chars per separator)
  const separatorOverhead = (foldersToShow.length - 1) * 2;
  const availableLength = maxLength - separatorOverhead - ellipsisOverhead;
// 剩下的宽度平均分给每个要显示的路径，得出单个路径的上限
  const maxLengthPerPath = Math.floor(availableLength / foldersToShow.length);
// 统一成同一套 Unicode 规范化形式再比较：macOS 上路径常是分解形式，直接比前缀会漏掉
  const cwdNFC = cwd.normalize('NFC');
  const formattedFolders = foldersToShow.map(folder => {
    // Strip cwd from the beginning if present
    // Normalize both to NFC for consistent comparison (macOS uses NFD paths)
    const folderNFC = folder.normalize('NFC');
// 剥掉当前目录前缀让路径更短；只剥带分隔符的完整前缀，避免把同名前缀的兄弟目录也削掉
    if (folderNFC.startsWith(cwdNFC + path.sep)) {
      folder = folderNFC.slice(cwdNFC.length + 1);
    }
    if (folder.length <= maxLengthPerPath) {
      return folder;
    }
// 截尾而不是截头：路径尾部才是能区分的信息，前面加省略号表示被削过
    return '…' + folder.slice(-(maxLengthPerPath - 1));
  });
  let result = formattedFolders.join(', ');
  if (hasMore) {
    result += ', …';
  }
  return result;
}
// 原文件此处有一行 56048 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。