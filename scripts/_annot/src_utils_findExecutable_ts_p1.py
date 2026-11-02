# source: src/utils/findExecutable.ts
ANNOTATIONS = [
    (1, 'before', '''在 PATH 里查找可执行文件，作用类似 `which`，用来替换 spawn-rx 的 findActualExecutable，从而省掉把 rxjs（约 313KB）拉进来。'''),
    (16, 'after', '''返回值：形状是 {cmd, args} 以贴合 spawn-rx 的 API；cmd 是解析到的路径，找不到就退回原名，args 则原样透传输入参数。'''),
]
