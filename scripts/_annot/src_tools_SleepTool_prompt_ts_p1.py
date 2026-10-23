ANNOTATIONS = [
    (5, 'after', r'''DESCRIPTION 一句话：等待指定时长。'''),
    (7, 'before', r'''SLEEP_TOOL_PROMPT 大模板字符串（模型操作手册）。内部是纯文案，逐行锚点会被模板字符串保护机制外移到段尾。'''),
    (11, 'after', r'''TICK_TAG 插值：周期签到提示的 XML 标签名从 constants/xml.js 引入，不硬编码——两处必须一致，否则模型的签到提示认不出来。'''),
    (13, 'after', r'''「可与其他工具并发」：sleep 不占 shell 进程，这是它相对 Bash(sleep ...) 的核心优势。'''),
    (17, 'after', r'''代价说明写在 prompt 里：每次唤醒花一次 API 调用，而提示缓存 5 分钟不活动就过期——让模型自己权衡睡多久。'''),
]
