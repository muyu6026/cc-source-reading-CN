// 用 zod v4 定义 Todo 项的 schema：content 是非空字符串，status 取自一个懒加载的枚举（pending / in_progress / completed），activeForm 也是非空字符串。
import { z } from 'zod/v4'
import { lazySchema } from '../lazySchema.js'

const TodoStatusSchema = lazySchema(() =>
  z.enum(['pending', 'in_progress', 'completed']),
)

export const TodoItemSchema = lazySchema(() =>
  z.object({
    content: z.string().min(1, 'Content cannot be empty'),
    status: TodoStatusSchema(),
    activeForm: z.string().min(1, 'Active form cannot be empty'),
  }),
)
export type TodoItem = z.infer<ReturnType<typeof TodoItemSchema>>

export const TodoListSchema = lazySchema(() => z.array(TodoItemSchema()))
export type TodoList = z.infer<ReturnType<typeof TodoListSchema>>
// 导出类型：TodoItem 与 TodoList 都通过 z.infer 从各自的懒加载 schema 推导出来，这样能把 zod 依赖隔离，避免打进所有导入方。
