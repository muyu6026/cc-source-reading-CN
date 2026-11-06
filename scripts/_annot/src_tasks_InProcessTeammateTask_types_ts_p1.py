# -*- coding: utf-8 -*-
"""src/tasks/InProcessTeammateTask/types.ts 批注数据（第 165 批）。"""

ANNOTATIONS = [
    (8, 'before', '''队友身份存进任务状态：形状与运行时的 TeammateContext 一致，但这里是纯数据、写进 AppState 做持久化'''),
    (13, 'before', '''队友身份三要素：agentId（如 researcher@my-team）、teamName、以及是否要求计划模式'''),
    (22, 'before', '''进程内队友任务的完整状态：在通用 TaskStateBase 上叠加身份、执行、UI、生命周期四类字段'''),
    (36, 'before', '''两个运行时专用的中止控制器：一个杀整个队友，一个只中断当前轮；都不序列化到磁盘'''),
    (51, 'before', '''放大视图用的对话历史单独存：邮箱消息走另一条路（teamContext.inProcessMailboxes），不混在这里'''),
    (56, 'before', '''查看队友对话时要投递的用户消息队列，是一直在累积的字段'''),
    (61, 'before', '''UI 用的随机旋转动词：跨重渲染保持稳定，多个组件共享同一份'''),
    (66, 'before', '''生命周期两个布尔：空闲标志和关机请求，由收尾路径负责翻转'''),
    (78, 'before', '''类型守卫：靠 type === in_process_teammate 收窄，新增字段时不会误判'''),
    (89, 'before', '''消息数组的内存成本：BQ 分析显示每个代理持有一份完整副本会吃到约 20MB RSS，所以下面要封顶'''),
    (101, 'before', '''UI 镜像里最多留 50 条：放大视图只看近期上下文，完整对话存在别处'''),
    (108, 'before', '''追加并封顶的纯函数：满了就丢最老的，永远返回新数组以保持 AppState 不可变'''),
]
