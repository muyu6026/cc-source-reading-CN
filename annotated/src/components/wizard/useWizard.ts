import { useContext } from 'react'
import type { WizardContextValue } from './types.js'
import { WizardContext } from './WizardProvider.js'

// 泛型 hook：上下文里 data 的形状由调用方声明，hook 自身不做任何断言
export function useWizard<
  T extends Record<string, unknown> = Record<string, unknown>,
>(): WizardContextValue<T> {
  const context = useContext(WizardContext) as WizardContextValue<T> | null
  if (!context) {
// 缺 Provider 直接抛错：向导状态没有合理默认值，早失败好过让各处拿到 undefined 后再炸
    throw new Error('useWizard must be used within a WizardProvider')
  }
  return context
}
