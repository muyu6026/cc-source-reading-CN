ANNOTATIONS = [
    (14, 'before', r'''generatePrompt 从注册表现算 prompt——加一个配置项，模型文档自动多一行，不存在文档滞后于实现。'''),
    (23, 'after', r'''voiceEnabled 在 kill-switch 期间从 prompt 里整体消失：注册表里有（编译期），但对模型不可见——「看得见但不可用」会诱导模型反复尝试。'''),
    (41, 'after', r'''按 source 分两组输出：Global（~/.claude.json）与 Project（settings.json），模型据此知道改动的持久化范围。'''),
    (48, 'after', r'''model 单独成节：候选值是动态的（随账号可用模型变），不能并进静态列表。'''),
    (79, 'before', r'''generateModelSection 的兜底：getModelOptions 抛异常时给一段静态候选文案（sonnet/opus/haiku/best/完整模型 ID），prompt 永远生得出来。'''),
]
