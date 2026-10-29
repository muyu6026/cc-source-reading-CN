# 数据文件：src/utils/hooks/apiQueryHookHelper.ts
# 中文批注锚点（行号以 Read 输出为准）。文本禁止英文双引号与反斜杠。
SOURCE_REL = 'src/utils/hooks/apiQueryHookHelper.ts'

ANNOTATIONS = [
    (10, 'after', '导入构建 API 查询钩子所需的依赖：随机 UUID、查询来源常量、非流式调用、消息类型等。'),
    (14, 'after', 'API 查询钩子的上下文：在 REPL 钩子上下文基础上增加已构建消息数。'),
    (38, 'after', '钩子配置：声明查询来源、是否运行、如何构建消息、如何解析与记录结果，以及惰性加载的模型。'),
    (54, 'after', '钩子执行结果：成功时带返回对象与消息 id，失败时带错误对象，两者都带 uuid 便于追踪。'),
    (59, 'after', 'createApiQueryHook：工厂函数，按配置生成一个异步钩子；先判断是否运行，再构建消息、调用模型、解析结果并记录。'),
    (108, 'after', '发起非流式 API 调用，传入消息、系统提示、关闭思考、工具与各类运行时选项（含中止信号）。'),
    (141, 'after', '无论解析成功或失败都走进 logResult，最后由外层 catch 兜底记录异常，保证钩子不抛出影响主循环。'),
]
