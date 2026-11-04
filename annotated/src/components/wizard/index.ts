// 向导出口五件：类型、hook、外壳、页脚、Provider
export type {
  WizardContextValue,
  WizardProviderProps,
  WizardStepComponent,
} from './types.js'
export { useWizard } from './useWizard.js'
export { WizardDialogLayout } from './WizardDialogLayout.js'
export { WizardNavigationFooter } from './WizardNavigationFooter.js'
// Provider 必须从入口导出：调用方要包住整棵树，只给 hook 是没法用的
export { WizardProvider } from './WizardProvider.js'
