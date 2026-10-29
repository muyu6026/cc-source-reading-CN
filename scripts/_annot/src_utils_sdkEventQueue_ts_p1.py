# 数据文件：src/utils/sdkEventQueue.ts
# 中文批注锚点（行号以 Read 输出为准）。文本禁止英文双引号与反斜杠。
SOURCE_REL = 'src/utils/sdkEventQueue.ts'

ANNOTATIONS = [
    (4, 'after', '导入 UUID 类型与随机生成、会话/非交互态读取、SDK 工作流进度类型。'),
    (15, 'after', 'TaskStartedEvent：前台智能体开始执行时发出的系统事件，带任务 id 与描述。'),
    (34, 'after', 'TaskProgressEvent：进度事件，含用量统计与增量式工作流状态，客户端按阶段折叠重建树。'),
    (54, 'after', 'TaskNotificationSdkEvent：前台智能体结束（未转后台）时发出，直接流入输出流，不经 XML 解析也不触发 LLM 循环，用于从子智能体面板移除任务。'),
    (66, 'after', 'SessionStateChangedEvent：会话态切换（idle/running/requires_action），SDK 消费者据此判断主回合生成器是空闲还是在产出。'),
    (72, 'after', 'SdkEvent：四种系统事件的联合类型。'),
    (87, 'after', 'enqueueSdkEvent：仅在不交互/流式模式下入队；超过上限时丢弃最旧事件，防止积压无限增长。'),
    (101, 'after', 'drainSdkEvents：一次性取出并清空队列，给每条事件补上 uuid 与 session_id 后返回。'),
    (134, 'after', 'emitTaskTerminatedSdk：任务到达终态时补发一条 task_notification，供压制了 XML 通知的路径（kill/abort）也能让 SDK 消费者看到任务关闭。'),
]
