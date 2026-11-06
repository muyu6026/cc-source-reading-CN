// 编译器产物：上面的错误提示组件与下面的命令入口在同一个文件里，前者只管一行报错
import { c as _c } from "react/compiler-runtime";
import chalk from 'chalk';
import figures from 'figures';
import React, { useEffect } from 'react';
import { getAdditionalDirectoriesForClaudeMd, setAdditionalDirectoriesForClaudeMd } from '../../bootstrap/state.js';
import type { LocalJSXCommandContext } from '../../commands.js';
import { MessageResponse } from '../../components/MessageResponse.js';
import { AddWorkspaceDirectory } from '../../components/permissions/rules/AddWorkspaceDirectory.js';
import { Box, Text } from '../../ink.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { applyPermissionUpdate, persistPermissionUpdate } from '../../utils/permissions/PermissionUpdate.js';
import type { PermissionUpdateDestination } from '../../utils/permissions/PermissionUpdateSchema.js';
import { SandboxManager } from '../../utils/sandbox/sandbox-adapter.js';
import { addDirHelpMessage, validateDirectoryForWorkspace } from './validation.js';
// 错误提示用零延时定时器回调：渲染完成后才能通知关闭，直接在渲染里调会违反 Hook 规则
function AddDirError(t0) {
  const $ = _c(10);
  const {
    message,
    args,
    onDone
  } = t0;
  let t1;
  let t2;
  if ($[0] !== onDone) {
    t1 = () => {
// 零延时而不是立即调用：把回调推到下一轮事件循环，避开当前渲染
      const timer = setTimeout(onDone, 0);
// 定时器要在卸载时清掉：快速连续触发时不清会关两次
      return () => clearTimeout(timer);
    };
    t2 = [onDone];
    $[0] = onDone;
    $[1] = t1;
    $[2] = t2;
  } else {
    t1 = $[1];
    t2 = $[2];
  }
  useEffect(t1, t2);
  let t3;
  if ($[3] !== args) {
    t3 = <Text dimColor={true}>{figures.pointer} /add-dir {args}</Text>;
    $[3] = args;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  let t4;
  if ($[5] !== message) {
    t4 = <MessageResponse><Text>{message}</Text></MessageResponse>;
    $[5] = message;
    $[6] = t4;
  } else {
    t4 = $[6];
  }
  let t5;
  if ($[7] !== t3 || $[8] !== t4) {
    t5 = <Box flexDirection="column">{t3}{t4}</Box>;
    $[7] = t3;
    $[8] = t4;
    $[9] = t5;
  } else {
    t5 = $[9];
  }
  return t5;
}
// 三个入参：关闭回调、命令上下文、原始参数串。参数可能为空，空就是「弹出输入框」
export async function call(onDone: LocalJSXCommandOnDone, context: LocalJSXCommandContext, args?: string): Promise<React.ReactNode> {
// 先 trim 再判空：只敲了空格的参数等同于没给
  const directoryPath = (args ?? '').trim();
  const appState = context.getAppState();

  // Helper to handle adding a directory (shared by both with-path and no-path cases)
// 记住与不记住的差别只是一个落盘来源：会话级与本地设置，其余逻辑完全一致
  const handleAddDirectory = async (path: string, remember = false) => {
    const destination: PermissionUpdateDestination = remember ? 'localSettings' : 'session';
    const permissionUpdate = {
      type: 'addDirectories' as const,
      directories: [path],
      destination
    };

    // Apply to session context
// 重新取一次应用状态：上面的校验是异步的，等待期间状态可能已经变了
    const latestAppState = context.getAppState();
    const updatedContext = applyPermissionUpdate(latestAppState.toolPermissionContext, permissionUpdate);
    context.setAppState(prev => ({
      ...prev,
      toolPermissionContext: updatedContext
    }));

    // Update sandbox config so Bash commands can access the new directory.
    // Bootstrap state is the source of truth for session-only dirs; persisted
    // dirs are picked up via the settings subscription, but we refresh
    // eagerly here to avoid a race when the user acts immediately.
// 引导状态是会话级目录的唯一真源：持久化的那些靠设置订阅进来，这里主动刷一次是为了避开竞态
    const currentDirs = getAdditionalDirectoriesForClaudeMd();
    if (!currentDirs.includes(path)) {
      setAdditionalDirectoriesForClaudeMd([...currentDirs, path]);
    }
// 改完目录必须刷新沙箱配置：否则命令仍被旧白名单挡着，用户会以为没生效
    SandboxManager.refreshConfig();
    let message: string;
// 落盘失败不影响本次生效：目录已加进会话，只是没记住，所以提示要说清是哪种
    if (remember) {
      try {
        persistPermissionUpdate(permissionUpdate);
        message = `Added ${chalk.bold(path)} as a working directory and saved to local settings`;
      } catch (error) {
        message = `Added ${chalk.bold(path)} as a working directory. Failed to save to local settings: ${error instanceof Error ? error.message : 'Unknown error'}`;
      }
    } else {
      message = `Added ${chalk.bold(path)} as a working directory for this session`;
    }
// 消息末尾统一挂一句引导：用户加完目录后最常问的就是「以后怎么管」
    const messageWithHint = `${message} ${chalk.dim('· /permissions to manage')}`;
    onDone(messageWithHint);
  };

  // When no path is provided, show AddWorkspaceDirectory input form directly
  // and return to REPL after confirmation
// 没给路径就弹输入框：这一步不做任何猜测，也不去猜当前目录
  if (!directoryPath) {
    return <AddWorkspaceDirectory permissionContext={appState.toolPermissionContext} onAddDirectory={handleAddDirectory} onCancel={() => {
      onDone('Did not add a working directory.');
    }} />;
  }
// 有路径就先校验：非法路径要把原因翻译成可读提示，而不是抛异常
  const result = await validateDirectoryForWorkspace(directoryPath, appState.toolPermissionContext);
  if (result.resultType !== 'success') {
    const message = addDirHelpMessage(result);
    return <AddDirError message={message} args={args ?? ''} onDone={() => onDone(message)} />;
  }
// 校验通过后把绝对路径回填进输入框：用户能看到最终会加哪个目录
  return <AddWorkspaceDirectory directoryPath={result.absolutePath} permissionContext={appState.toolPermissionContext} onAddDirectory={handleAddDirectory} onCancel={() => {
    onDone(`Did not add ${chalk.bold(result.absolutePath)} as a working directory.`);
  }} />;
}
// 原文件此处有一行 13192 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。