# source: src/utils/jsonRead.ts
ANNOTATIONS = [
    (1, 'before', '''从 json.ts 抽出来的叶子模块 stripBOM，目的是打断 settings → json → log → types/logs → … → settings 的循环依赖；同时处理 PowerShell 5.x 默认写出带 BOM 的 UTF-8 文件。'''),
    (16, 'after', '''函数逻辑：若内容以 U+FEFF 开头就把首字符去掉再返回，否则原样返回，避免 JSON.parse 因为 BOM 报出「Unexpected token」错误。'''),
]
