import { z } from 'zod/v4'
import { lazySchema } from '../../utils/lazySchema.js'
import { semanticBoolean } from '../../utils/semanticBoolean.js'

// The input schema with optional replace_all
// schema 全部用 `lazySchema` 包一层，而不是直接 `z.object(...)`。原因：zod 的 schema 构造在模块加载时就执行，工具多达几十个、每个又有嵌套结构，会在启动时白花几十毫秒；`lazySchema` 把构造推迟到**第一次取 schema**（真正需要校验参数时）。`localSchema`/`lazySchema` 这层薄壳在仓里到处可见，就是为启动速度。这里还用 `strictObject`——多传字段直接报错，而不是静默丢弃，能逼模型改正参数形状。
const inputSchema = lazySchema(() =>
  z.strictObject({
    file_path: z.string().describe('The absolute path to the file to modify'),
    old_string: z.string().describe('The text to replace'),
    new_string: z
      .string()
      .describe(
        'The text to replace it with (must be different from old_string)',
      ),
// `replace_all` 是 `semanticBoolean(...)` 而不是裸 `z.boolean()`。因为这个字段模型经常传字符串（`true` / `false` / `yes`「是」）。`semanticBoolean` 在 `preprocess` 阶段把这些都转成布尔，同时**对外仍声明为 boolean**——所以 `describe` 里写的语义和实际接受范围不完全一致，是故意的宽容。`.default(false).optional()` 两者都要写：`default` 管缺省值，`optional` 管类型上允许不传。
    replace_all: semanticBoolean(
      z.boolean().default(false).optional(),
    ).describe('Replace all occurrences of old_string (default false)'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

// Parsed output — what call() receives. z.output not z.input: with
// semanticBoolean the input side is unknown (preprocess accepts anything).
export type FileEditInput = z.output<InputSchema>
// 类型用的是 `z.output` 而不是 `z.input`。注释解释了为什么必须区分：有了 `semanticBoolean` 这层 `preprocess`，输入侧类型是 `unknown`（预处理函数接受任何东西），输出侧才是干净的 `boolean`。工具内部拿到的永远是解析后的值，所以 `FileEditInput` 必须取 `output`——否则 `replace_all` 的类型会变成 `unknown`，到处都是断言。

// Individual edit without file_path
export type EditInput = Omit<FileEditInput, 'file_path'>

// Runtime version where replace_all is always defined
// `FileEdit` 是**运行时**类型，和 `FileEditInput` 的区别只有一点：`replace_all` 在这里是必填的 `boolean`。为什么要单独一个类型——下游（patch 计算、沙箱判断、等价比较）拿到的编辑对象都已经过归一化，不该再为「可能没传」做分支。类型系统在这里扮演的是「归一化完成」的凭证。
export type FileEdit = {
  old_string: string
  new_string: string
  replace_all: boolean
}

export const hunkSchema = lazySchema(() =>
  z.object({
    oldStart: z.number(),
    oldLines: z.number(),
    newStart: z.number(),
    newLines: z.number(),
    lines: z.array(z.string()),
  }),
)

export const gitDiffSchema = lazySchema(() =>
  z.object({
    filename: z.string(),
    status: z.enum(['modified', 'added']),
    additions: z.number(),
    deletions: z.number(),
    changes: z.number(),
    patch: z.string(),
    repository: z
      .string()
      .nullable()
      .optional()
      .describe('GitHub owner/repo when available'),
  }),
)

// Output schema for FileEditTool
const outputSchema = lazySchema(() =>
  z.object({
    filePath: z.string().describe('The file path that was edited'),
    oldString: z.string().describe('The original string that was replaced'),
    newString: z.string().describe('The new string that replaced it'),
    originalFile: z
      .string()
      .describe('The original file contents before editing'),
    structuredPatch: z
      .array(hunkSchema())
      .describe('Diff patch showing the changes'),
    userModified: z
      .boolean()
      .describe('Whether the user modified the proposed changes'),
    replaceAll: z.boolean().describe('Whether all occurrences were replaced'),
    gitDiff: gitDiffSchema().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type FileEditOutput = z.infer<OutputSchema>

export { inputSchema, outputSchema }
