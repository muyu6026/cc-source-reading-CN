ANNOTATIONS = [
    (27, 'after', '''// 权限判定函数的公开类型：forceDecision 可跳过整套计算直接给定结果
//（回放、外部注入决定的场景）。'''),
    (29, 'after', '''// 以下是 React Compiler 产物形态：$ 是 memo 缓存槽数组，
// _c(3) 声明 3 个槽；t0 就是原源码里的 useCallback 返回值。'''),
    (31, 'after', '''// 缓存判据：两个 setter props 身份不变就复用旧的 t0——
// 编译后 useCallback 的依赖数组被物化成这段手写比较。'''),
    (34, 'after', '''// 中止优先：用户可能在权限计算期间按了 Esc，
// resolveIfAborted 已 resolve 过的 Promise 直接返回，
// 不再走后续分支。'''),
    (37, 'after', '''// forceDecision 优先：给了就用，不给才调 hasPermissionsToUseTool
//（本地规则 + 配置 + classifier 的合流出口）。'''),
    (43, 'after', '''// auto-mode（分类器代批）的批准要留痕：把规则命中原因存进
// setYoloClassifierApproval，供事后审计与 UI 展示。'''),
    (50, 'after', '''// buildAllow 统一构造 allow 决定：updatedInput（规则可能改过参数）
// 与 decisionReason 一起带上。'''),
    (53, 'after', '''// allow 分支收尾：埋点 decision:accept / source:config，然后 resolve。
// 中间两次 resolveIfAborted 是编译期保留的异步中止检查点。'''),
    (56, 'after', '''// description 在这里统一求值（await）：deny 通知和 ask 弹窗都要用，
// 且它可能读远程数据，必须放在分支前。'''),
    (61, 'after', '''// await 后的二次中止检查：求值期间用户可能已取消。'''),
    (77, 'after', '''// deny 侧的记账同样只认 classifier/auto-mode：普通规则拒绝不进
// autoModeDenials 账本（那是专为「自动模式误杀」立的案）。'''),
    (87, 'after', '''// 通知三行：工具名小写化 + denied by auto mode + /permissions 指引，
// priority:immediate 抢在普通通知前面。'''),
    (91, 'after', '''// deny 分支只 resolve(result)：不回传 updatedInput，
// 拒绝的调用不该带修改过的参数。'''),
    (96, 'after', '''// ask 分支三岔第一口：awaitAutomatedChecksBeforeDialog 开启时
// 先让 coordinator（自动化检查编排器）过一遍——它可能直接给决定。'''),
    (109, 'after', '''// coordinator 给出决定就短路：后面的 swarm/交互都不走。'''),
    (113, 'after', '''// 第二口：swarm worker（队友进程）有自己的权限代理人，
// 能代答就直接 resolve。'''),
    (125, 'after', '''// 第三口：speculative classifier 竞速——权限计算期间分类器可能
// 已经预跑过一版（BASH_CLASSIFIER 门下、仅 Bash、且未开启
// awaitAutomatedChecksBeforeDialog 才走这条）。'''),
    (131, 'after', '''// 竞速两端：speculative 结果（then 包成 result 形态）
// 与 2 秒超时（_temp2）。慢的一方作废。'''),
    (135, 'after', '''// 三条件全中才免弹窗：有结果 + 命中规则 + 高置信。
// 命中后 consume 掉这次预跑结果，并把规则描述存进
// setClassifierApproval 供弹窗外展示。'''),
    (159, 'after', '''// 竞速未命中或没预跑：落到交互弹窗。bridge/channel 回调按
// feature 注入——远程/频道会话的权限由对端回答。'''),
    (168, 'after', '''// ask 分支收尾：handleInteractivePermission 内部会创建弹窗并把
// resolve 交出去，由用户操作最终触发。'''),
    (172, 'after', '''// 错误分类处理：AbortError 与 APIUserAbortError 是用户主动取消，
// 只记调试日志；其余错误进 logError。两者都走 cancelAndAbort——
// 不向调用方抛异常，权限判定永远以 resolve 收场。'''),
    (179, 'after', '''// 统一兜底：任何异常都不能让 Promise 悬挂，
// 否则工具调用会永远卡在等待权限。'''),
    (182, 'after', '''// finally 清 classifier checking：无论哪条路径，
//「正在分类器检查中」的 UI 状态都要灭掉。'''),
    (186, 'after', '''// 缓存槽写回：下次渲染两个 props 没变就直接取槽位里的旧值。'''),
    (192, 'after', '''// 编译期拆出的辅助函数：setTimeout(res, 2000, 超时标记)——
// 注意 setTimeout 的第三参是给回调传值，省一个闭包。'''),
    (201, 'after', '''// 另一端辅助：把 speculative 结果包成 result 形态，
// 与超时标记形状对齐，竞速代码才能统一判 type。'''),
]
