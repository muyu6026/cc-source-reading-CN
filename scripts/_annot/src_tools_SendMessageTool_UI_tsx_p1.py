ANNOTATIONS = [
    (6, 'before', r'''renderToolUseMessage 只对 plan_approval_response 显形（approve/reject plan from: X）——普通文本消息与关机协议的「使用中」状态全部静默，减少协作时的界面噪音。'''),
    (15, 'before', r'''renderToolResultMessage：带 routing 的（点对点/广播）与带 request_id 的（关机/审批请求）都返回 null——这两类结果的呈现由消息流本身承担（收件箱视图），工具结果位再画一次就是重复。其余走 MessageResponse 灰字。'''),
    (20, 'after', r'''content 可能是字符串（历史持久化的输出格式）——先 jsonParse 再走统一路径。新代码永远传对象，这个分支是给旧会话记录留的兼容层。'''),
]
