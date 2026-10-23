import { c as _c } from "react/compiler-runtime";
import { feature } from 'bun:bundle';
import { APIUserAbortError } from '@anthropic-ai/sdk';
import * as React from 'react';
import { useCallback } from 'react';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from 'src/services/analytics/index.js';
import { sanitizeToolNameForAnalytics } from 'src/services/analytics/metadata.js';
import type { ToolUseConfirm } from '../components/permissions/PermissionRequest.js';
import { Text } from '../ink.js';
import type { ToolPermissionContext, Tool as ToolType, ToolUseContext } from '../Tool.js';
import { consumeSpeculativeClassifierCheck, peekSpeculativeClassifierCheck } from '../tools/BashTool/bashPermissions.js';
import { BASH_TOOL_NAME } from '../tools/BashTool/toolName.js';
import type { AssistantMessage } from '../types/message.js';
import { recordAutoModeDenial } from '../utils/autoModeDenials.js';
import { clearClassifierChecking, setClassifierApproval, setYoloClassifierApproval } from '../utils/classifierApprovals.js';
import { logForDebugging } from '../utils/debug.js';
import { AbortError } from '../utils/errors.js';
import { logError } from '../utils/log.js';
import type { PermissionDecision } from '../utils/permissions/PermissionResult.js';
import { hasPermissionsToUseTool } from '../utils/permissions/permissions.js';
import { jsonStringify } from '../utils/slowOperations.js';
import { handleCoordinatorPermission } from './toolPermission/handlers/coordinatorHandler.js';
import { handleInteractivePermission } from './toolPermission/handlers/interactiveHandler.js';
import { handleSwarmWorkerPermission } from './toolPermission/handlers/swarmWorkerHandler.js';
import { createPermissionContext, createPermissionQueueOps } from './toolPermission/PermissionContext.js';
import { logPermissionDecision } from './toolPermission/permissionLogging.js';
export type CanUseToolFn<Input extends Record<string, unknown> = Record<string, unknown>> = (tool: ToolType, input: Input, toolUseContext: ToolUseContext, assistantMessage: AssistantMessage, toolUseID: string, forceDecision?: PermissionDecision<Input>) => Promise<PermissionDecision<Input>>;
// 权限判定函数的公开类型：forceDecision 可跳过整套计算直接给定结果
//（回放、外部注入决定的场景）。
function useCanUseTool(setToolUseConfirmQueue, setToolPermissionContext) {
  const $ = _c(3);
// 以下是 React Compiler 产物形态：$ 是 memo 缓存槽数组，
// _c(3) 声明 3 个槽；t0 就是原源码里的 useCallback 返回值。
  let t0;
  if ($[0] !== setToolPermissionContext || $[1] !== setToolUseConfirmQueue) {
// 缓存判据：两个 setter props 身份不变就复用旧的 t0——
// 编译后 useCallback 的依赖数组被物化成这段手写比较。
    t0 = async (tool, input, toolUseContext, assistantMessage, toolUseID, forceDecision) => new Promise(resolve => {
      const ctx = createPermissionContext(tool, input, toolUseContext, assistantMessage, toolUseID, setToolPermissionContext, createPermissionQueueOps(setToolUseConfirmQueue));
      if (ctx.resolveIfAborted(resolve)) {
// 中止优先：用户可能在权限计算期间按了 Esc，
// resolveIfAborted 已 resolve 过的 Promise 直接返回，
// 不再走后续分支。
        return;
      }
      const decisionPromise = forceDecision !== undefined ? Promise.resolve(forceDecision) : hasPermissionsToUseTool(tool, input, toolUseContext, assistantMessage, toolUseID);
// forceDecision 优先：给了就用，不给才调 hasPermissionsToUseTool
//（本地规则 + 配置 + classifier 的合流出口）。
      return decisionPromise.then(async result => {
        if (result.behavior === "allow") {
          if (ctx.resolveIfAborted(resolve)) {
            return;
          }
          if (feature("TRANSCRIPT_CLASSIFIER") && result.decisionReason?.type === "classifier" && result.decisionReason.classifier === "auto-mode") {
// auto-mode（分类器代批）的批准要留痕：把规则命中原因存进
// setYoloClassifierApproval，供事后审计与 UI 展示。
            setYoloClassifierApproval(toolUseID, result.decisionReason.reason);
          }
          ctx.logDecision({
            decision: "accept",
            source: "config"
          });
          resolve(ctx.buildAllow(result.updatedInput ?? input, {
// buildAllow 统一构造 allow 决定：updatedInput（规则可能改过参数）
// 与 decisionReason 一起带上。
            decisionReason: result.decisionReason
          }));
          return;
// allow 分支收尾：埋点 decision:accept / source:config，然后 resolve。
// 中间两次 resolveIfAborted 是编译期保留的异步中止检查点。
        }
        const appState = toolUseContext.getAppState();
        const description = await tool.description(input as never, {
// description 在这里统一求值（await）：deny 通知和 ask 弹窗都要用，
// 且它可能读远程数据，必须放在分支前。
          isNonInteractiveSession: toolUseContext.options.isNonInteractiveSession,
          toolPermissionContext: appState.toolPermissionContext,
          tools: toolUseContext.options.tools
        });
        if (ctx.resolveIfAborted(resolve)) {
// await 后的二次中止检查：求值期间用户可能已取消。
          return;
        }
        switch (result.behavior) {
          case "deny":
            {
              logPermissionDecision({
                tool,
                input,
                toolUseContext,
                messageId: ctx.messageId,
                toolUseID
              }, {
                decision: "reject",
                source: "config"
              });
              if (feature("TRANSCRIPT_CLASSIFIER") && result.decisionReason?.type === "classifier" && result.decisionReason.classifier === "auto-mode") {
// deny 侧的记账同样只认 classifier/auto-mode：普通规则拒绝不进
// autoModeDenials 账本（那是专为「自动模式误杀」立的案）。
                recordAutoModeDenial({
                  toolName: tool.name,
                  display: description,
                  reason: result.decisionReason.reason ?? "",
                  timestamp: Date.now()
                });
                toolUseContext.addNotification?.({
                  key: "auto-mode-denied",
                  priority: "immediate",
                  jsx: <><Text color="error">{tool.userFacingName(input).toLowerCase()} denied by auto mode</Text><Text dimColor={true}> · /permissions</Text></>
// 通知三行：工具名小写化 + denied by auto mode + /permissions 指引，
// priority:immediate 抢在普通通知前面。
                });
              }
              resolve(result);
              return;
// deny 分支只 resolve(result)：不回传 updatedInput，
// 拒绝的调用不该带修改过的参数。
            }
          case "ask":
            {
              if (appState.toolPermissionContext.awaitAutomatedChecksBeforeDialog) {
                const coordinatorDecision = await handleCoordinatorPermission({
// ask 分支三岔第一口：awaitAutomatedChecksBeforeDialog 开启时
// 先让 coordinator（自动化检查编排器）过一遍——它可能直接给决定。
                  ctx,
                  ...(feature("BASH_CLASSIFIER") ? {
                    pendingClassifierCheck: result.pendingClassifierCheck
                  } : {}),
                  updatedInput: result.updatedInput,
                  suggestions: result.suggestions,
                  permissionMode: appState.toolPermissionContext.mode
                });
                if (coordinatorDecision) {
                  resolve(coordinatorDecision);
                  return;
                }
              }
// coordinator 给出决定就短路：后面的 swarm/交互都不走。
              if (ctx.resolveIfAborted(resolve)) {
                return;
              }
              const swarmDecision = await handleSwarmWorkerPermission({
// 第二口：swarm worker（队友进程）有自己的权限代理人，
// 能代答就直接 resolve。
                ctx,
                description,
                ...(feature("BASH_CLASSIFIER") ? {
                  pendingClassifierCheck: result.pendingClassifierCheck
                } : {}),
                updatedInput: result.updatedInput,
                suggestions: result.suggestions
              });
              if (swarmDecision) {
                resolve(swarmDecision);
                return;
              }
// 第三口：speculative classifier 竞速——权限计算期间分类器可能
// 已经预跑过一版（BASH_CLASSIFIER 门下、仅 Bash、且未开启
// awaitAutomatedChecksBeforeDialog 才走这条）。
              if (feature("BASH_CLASSIFIER") && result.pendingClassifierCheck && tool.name === BASH_TOOL_NAME && !appState.toolPermissionContext.awaitAutomatedChecksBeforeDialog) {
                const speculativePromise = peekSpeculativeClassifierCheck((input as {
                  command: string;
                }).command);
                if (speculativePromise) {
                  const raceResult = await Promise.race([speculativePromise.then(_temp), new Promise(_temp2)]);
// 竞速两端：speculative 结果（then 包成 result 形态）
// 与 2 秒超时（_temp2）。慢的一方作废。
                  if (ctx.resolveIfAborted(resolve)) {
                    return;
                  }
                  if (raceResult.type === "result" && raceResult.result.matches && raceResult.result.confidence === "high" && feature("BASH_CLASSIFIER")) {
// 三条件全中才免弹窗：有结果 + 命中规则 + 高置信。
// 命中后 consume 掉这次预跑结果，并把规则描述存进
// setClassifierApproval 供弹窗外展示。
                    consumeSpeculativeClassifierCheck((input as {
                      command: string;
                    }).command);
                    const matchedRule = raceResult.result.matchedDescription ?? undefined;
                    if (matchedRule) {
                      setClassifierApproval(toolUseID, matchedRule);
                    }
                    ctx.logDecision({
                      decision: "accept",
                      source: {
                        type: "classifier"
                      }
                    });
                    resolve(ctx.buildAllow(result.updatedInput ?? input as Record<string, unknown>, {
                      decisionReason: {
                        type: "classifier" as const,
                        classifier: "bash_allow" as const,
                        reason: `Allowed by prompt rule: "${raceResult.result.matchedDescription}"`
                      }
                    }));
                    return;
                  }
                }
              }
// 竞速未命中或没预跑：落到交互弹窗。bridge/channel 回调按
// feature 注入——远程/频道会话的权限由对端回答。
              handleInteractivePermission({
                ctx,
                description,
                result,
                awaitAutomatedChecksBeforeDialog: appState.toolPermissionContext.awaitAutomatedChecksBeforeDialog,
                bridgeCallbacks: feature("BRIDGE_MODE") ? appState.replBridgePermissionCallbacks : undefined,
                channelCallbacks: feature("KAIROS") || feature("KAIROS_CHANNELS") ? appState.channelPermissionCallbacks : undefined
              }, resolve);
              return;
// ask 分支收尾：handleInteractivePermission 内部会创建弹窗并把
// resolve 交出去，由用户操作最终触发。
            }
        }
      }).catch(error => {
        if (error instanceof AbortError || error instanceof APIUserAbortError) {
// 错误分类处理：AbortError 与 APIUserAbortError 是用户主动取消，
// 只记调试日志；其余错误进 logError。两者都走 cancelAndAbort——
// 不向调用方抛异常，权限判定永远以 resolve 收场。
          logForDebugging(`Permission check threw ${error.constructor.name} for tool=${tool.name}: ${error.message}`);
          ctx.logCancelled();
          resolve(ctx.cancelAndAbort(undefined, true));
        } else {
          logError(error);
          resolve(ctx.cancelAndAbort(undefined, true));
        }
// 统一兜底：任何异常都不能让 Promise 悬挂，
// 否则工具调用会永远卡在等待权限。
      }).finally(() => {
        clearClassifierChecking(toolUseID);
      });
// finally 清 classifier checking：无论哪条路径，
//「正在分类器检查中」的 UI 状态都要灭掉。
    });
    $[0] = setToolPermissionContext;
    $[1] = setToolUseConfirmQueue;
    $[2] = t0;
// 缓存槽写回：下次渲染两个 props 没变就直接取槽位里的旧值。
  } else {
    t0 = $[2];
  }
  return t0;
}
function _temp2(res) {
// 编译期拆出的辅助函数：setTimeout(res, 2000, 超时标记)——
// 注意 setTimeout 的第三参是给回调传值，省一个闭包。
  return setTimeout(res, 2000, {
    type: "timeout" as const
  });
}
function _temp(r) {
  return {
    type: "result" as const,
    result: r
  };
// 另一端辅助：把 speculative 结果包成 result 形态，
// 与超时标记形状对齐，竞速代码才能统一判 type。
}
export default useCanUseTool;
// 原文件此处有一行 30548 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。