# -*- coding: utf-8 -*-
# MCPTool/UI.tsx 批注数据
ANNOTATIONS = [
    (21, 'after', '''1 万 token 的警告阈值：MCP 服务器不受本地沙箱约束，一个大响应能瞬间吃掉上下文的相当比例，所以 UI 层单独设这道闸。'''),
    (26, 'after', '''80 字符截断与 BashTool 同一哲学：header 里给足以识别调用的信息，不把整包参数倒进终端。'''),
    (30, 'after', '''超过 12 个顶层键，平铺 k:v 列表反而比原始 JSON 更吵，退回 pretty-print 路径——「紧凑展示」有自己的收益递减点。'''),
    (36, 'after', '''20 万字符的解析上限是纯性能护栏：jsonParse 在 slowOperations 名单里，大 blob 不值得为渲染付解析成本。'''),
    (40, 'after', '''200 字符或含换行即「主载荷」：这是为 Slack 的 {"messages":"line1\\nline2..."} 形态定制的判据——pretty-print 会把换行转义成字面 \\n，用户看到的是一团反斜杠。'''),
    (56, 'after', '''非交互模式下超长输入值截到 80 字符；MCP_RICH_OUTPUT 特性开关关掉时完全不截断，保持旧行为。'''),
    (90, 'after', '''进度三分支：无数据或无 progress 显示一行 Running；有 total 且大于 0 显示进度条加百分比；只有 progress 显示消息或计数。MCP 的进度上报是可选的，progress 与 total 不保证成对出现，UI 必须每个缺口都有退路。'''),
    (100, 'after', '''Slack 发消息结果被特判成一行带超链接的 Sent a message to #channel——放在 token 估算之前，最高频的写操作不该吃大响应警告。'''),
    (112, 'after', '''警告文案直接说「this can fill up context quickly」：这是说给人听的，不是给模型的——模型那份由 maxResultSizeChars 在别处管。'''),
    (125, 'after', '''image 块只渲染占位符 [Image]（终端不显图）；文本块按 MCP_RICH_OUTPUT 开关走富渲染或普通 OutputLine。'''),
    (159, 'after', '''React Compiler 产物：_c(18) 申请 18 个 memo 槽位，$[i] 依赖没变就直接复用；early_return_sentinel 用来在编译后的线性代码里模拟「提前 return」。可读性差，但语义就是上面注释里的三条策略级联。'''),
    (276, 'after', '''五连守卫：空串、超长、非左花括号开头、解析失败、非对象、键数越界，全部返回 null。三条渲染策略共用这一个入口，保证下游拿到的必是合法 entries。'''),
    (345, 'after', '''两个大字符串无法判定谁是主载荷——宁可整体退回 pretty-print 也不猜。'''),
    (349, 'after', '''兄弟键超过 150 字符也放弃：说明这不是「主载荷加小提示」的形态。trimEnd 在判定前执行——分页提示尾部一个换行不该让它被误判成主载荷。'''),
    (363, 'after', '''archives URL 格式固定为 /archives/<频道ID>/p<时间戳>，这个正则同时承担两个职责：确认确实是 Slack 链接，以及从 URL 里抠出频道 ID 作兜底标签。'''),
    (381, 'before', '''先做字符串包含快检再尝试解析：绝大多数非 Slack 输出在这里零成本退出，JSON 解析只对含 message_link 的文本发生。'''),
    (396, 'after', '''频道标签优先取工具输入（可能是 #foo 这样的名字，也可能是 C09EVDAN1NK 这样的 ID），输入没有才从 URL 兜底抠——用户视角的名字比内部 ID 可读。'''),
]
