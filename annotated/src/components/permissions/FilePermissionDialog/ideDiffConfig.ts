import type { ToolInput } from './useFilePermissionDialog.js'

// 一条编辑的最小描述：old/new 两段文本加可选 replace_all，与 Edit 工具入参同形，避免中间层再造一套模型
export interface FileEdit {
  old_string: string
  new_string: string
  replace_all?: boolean
}

// IDE 侧需要的配置：文件路径 + 编辑数组 + 单选或多选模式，模式决定 IDE 是逐条确认还是整份提交
export interface IDEDiffConfig {
  filePath: string
  edits?: FileEdit[]
  editMode?: 'single' | 'multiple'
}

// 从 IDE 回写时的输入形状：只带 file_path 与定型后的 edits，工具名由调用方自己知道
export interface IDEDiffChangeInput {
  file_path: string
  edits: FileEdit[]
}

// 接口泛型化到具体工具入参：每种工具声明自己的取配置与回写逻辑，注册表按工具名分派
export interface IDEDiffSupport<TInput extends ToolInput> {
  getConfig(input: TInput): IDEDiffConfig
  applyChanges(input: TInput, modifiedEdits: FileEdit[]): TInput
}

// 单编辑配置工厂：把三个标量包成一条 edits 并标记 single，省掉调用方手写数组与模式
export function createSingleEditDiffConfig(
  filePath: string,
  oldString: string,
  newString: string,
  replaceAll?: boolean,
): IDEDiffConfig {
  return {
// replace_all 原样透传（可能是 undefined），默认值交给下游按 false 处理，不在这一层补默认值
    filePath,
    edits: [
      {
        old_string: oldString,
        new_string: newString,
        replace_all: replaceAll,
      },
    ],
    editMode: 'single',
  }
}
