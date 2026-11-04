# IDE diff 配置契约：工具各自声明取配置与回写逻辑
ANNOTATIONS = [
    (3, 'before', '一条编辑的最小描述：old/new 两段文本加可选 replace_all，与 Edit 工具入参同形，避免中间层再造一套模型'),
    (9, 'before', 'IDE 侧需要的配置：文件路径 + 编辑数组 + 单选或多选模式，模式决定 IDE 是逐条确认还是整份提交'),
    (15, 'before', '从 IDE 回写时的输入形状：只带 file_path 与定型后的 edits，工具名由调用方自己知道'),
    (20, 'before', '接口泛型化到具体工具入参：每种工具声明自己的取配置与回写逻辑，注册表按工具名分派'),
    (25, 'before', '单编辑配置工厂：把三个标量包成一条 edits 并标记 single，省掉调用方手写数组与模式'),
    (31, 'after', 'replace_all 原样透传（可能是 undefined），默认值交给下游按 false 处理，不在这一层补默认值'),
]
