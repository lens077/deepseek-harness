/** Locale bundles for the model-routing switch: the Models-page row and the composer chip. */

/** Locale keys these surfaces render. */
export type ModelRoutingLocaleKey =
  | 'title' | 'description' | 'toggle' | 'onHint' | 'offHint' | 'writeFailed'
  | 'chipOn' | 'chipOff' | 'chipOnTitle' | 'chipOffTitle'

/** English copy. */
export const en: Record<ModelRoutingLocaleKey, string> = {
  title: 'Model routing',
  description: 'Let the mounted router pick a configured model and reasoning effort for each prompt.',
  toggle: 'Assign models automatically',
  onHint: 'The mounted router reads each prompt and may switch the model or reasoning effort for that reply. Turn this off to always answer with the model selected in the session.',
  offHint: 'Every prompt is answered by the model selected in the session; a session left on a routed model returns to it at its next prompt.',
  writeFailed: 'The deployment did not accept the change; the switch shows the stored value.',
  chipOn: 'Auto model',
  chipOff: 'Fixed model',
  chipOnTitle: 'Model routing is on: each prompt may be answered by another configured model or reasoning effort. Click to turn it off.',
  chipOffTitle: 'Model routing is off: every prompt is answered by the selected model. Click to turn it on.',
}

/** Chinese copy. */
export const zh: Record<ModelRoutingLocaleKey, string> = {
  title: '模型路由',
  description: '让已挂载的路由器为每条提示词挑选已配置的模型与推理强度。',
  toggle: '自动分配模型',
  onHint: '已挂载的路由器会读取每条提示词，并可能为这次回答切换模型或推理强度。关闭后始终使用会话中选定的模型作答。',
  offHint: '每条提示词都由会话中选定的模型作答；停留在被路由模型上的会话会在下一条提示词时回到它。',
  writeFailed: '本部署没有接受这次修改；开关显示的是已保存的值。',
  chipOn: '自动分配模型',
  chipOff: '固定模型',
  chipOnTitle: '模型路由已开启：每条提示词都可能由另一个已配置的模型或推理强度作答。点击关闭。',
  chipOffTitle: '模型路由已关闭：每条提示词都由选定的模型作答。点击开启。',
}
