# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (2, 'after', '''// 块注释：命令行 keybinding 处理器——从 keybinding 配置读 command:* 动作，触发时提交对应 slash 命令（如 command:commit → /commit）；经 keybinding 视为「立即」执行且不清除用户输入（区别于普通输入）。'''),
    (37, 'after', '''// React Compiler 产物：函数名保留但参数被抹平成单参数 t0，39-42 行在内部解构出 onSubmit / isActive；t1 是 isActive 的可选解构（缺省 true）。'''),
    (44, 'after', '''// 两个 context 依赖：useOptionalKeybindingContext（可选，缺失则整 hook 无 keybinding 可用）与 useIsModalOverlayActive（对话框覆盖态）；二者都要求组件渲染在 KeybindingSetup 之内才有 context。'''),
    (60, 'after', '''// bb0 是 React Compiler 生成的 basic block 标签；处理 keybindingContext 缺失的兜底分支——返回空 Set（$[0] 缓存），不注册任何 command handler。'''),
    (77, 'after', '''// memo 化：仅当 commandActions 或 onSubmit 变化（$[3]/$[4] 缓存）才重建 handlers map；每个 action 生成 `onSubmit('/'+commandName, NOOP_HELPERS, undefined, {fromKeybinding:true})`，slice(8) 去掉 command: 前缀。'''),
    (94, 'after', '''// 门控：t3 = isActive && !isModalOverlayActive——对话框打开或 hook 非激活时不注册 keybinding，避免模态里误触 command 快捷键。'''),
    (105, 'after', '''// useKeybindings 把 handlers map 注册进全局 keybinding 系统（context: Chat）；组件自身返回 null，纯副作用。'''),
]
