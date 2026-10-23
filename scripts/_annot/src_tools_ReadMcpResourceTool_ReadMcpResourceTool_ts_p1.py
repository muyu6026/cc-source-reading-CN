ANNOTATIONS = [
    (22, 'before', '''inputSchema：server + uri 双必填——MCP 资源寻址是「哪台服务器的哪个 URI」，少一个都定位不了。'''),
    (49, 'before', '''ReadMcpResourceTool：按 URI 读一个资源。与 ListMcpResourcesTool 成对（先列举后读取），同样双只读标志。'''),
    (55, 'after', '''这两个方法标志本工具**可并行、纯只读**——读资源不碰本地状态，多个读取调用可以同时跑。'''),
    (75, 'before', '''call() 主流程。'''),
    (78, 'before', '''三步前置检查之一：服务器存在吗。不存在就抛错附名单（同 List 工具的自纠式报错）。'''),
    (86, 'before', '''之二：连上了吗。'''),
    (90, 'before', '''之三：这台服务器声明了 resources 能力吗—— capabilities?.resources 是 MCP 握手时服务器自报的能力位，没报就是没有，读了也白读。'''),
    (105, 'after', '''blob 拦截的设计动机：base64 原样进 context 是灾难——一张图的 base64 能烧掉几万 token。这里解码后把原始字节按 mime 推断扩展名落盘，content 里只留路径。'''),
    (106, 'before', '''逐条 content 分流：text 原样带回；blob 落盘换路径；两者都不是就只回 uri+mimeType 空壳。'''),
    (114, 'before', '''persistId 用时间戳 + 索引 + 随机串拼，保证同一批次多条 blob 不互相覆盖。'''),
    (148, 'before', '''截断判定与 List 工具同一套口径：序列化后按行数判断是否超限。'''),
    (151, 'before', '''tool_result 直接序列化 contents——落盘后的 content 已经是「路径 + 一句说明」的轻量形态，可以安全进 context。'''),
]
