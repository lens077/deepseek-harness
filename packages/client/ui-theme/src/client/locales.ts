/** `settings.theme` namespace dictionaries (the Appearance and font-size rows' copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'appearance.title': '外观',
  'appearance.light': '浅色',
  'appearance.dark': '深色',
  'appearance.system': '跟随系统',
  'fontSize.title': '字号大小',
  'fontSize.description': '仅影响会话内容的字号',
  'fontSize.unit': 'px',
  'fontSize.increase': '增大字号',
  'fontSize.decrease': '减小字号',
  'mobile.title': '手机显示',
  'mobile.description': '仅影响手机端，不改变桌面端设置。',
  'mobile.layout': '布局大小',
  'mobile.layout.large': '大布局',
  'mobile.layout.large.description': '按钮和标题更清晰，任务列表保持紧凑。',
  'mobile.layout.medium': '中等',
  'mobile.layout.medium.description': '紧凑均衡，适合日常使用。',
  'mobile.layout.small': '小布局',
  'mobile.layout.small.description': '显示更多内容，底部导航仅显示图标。',
  'mobile.fontSize': '手机字号',
  'mobile.fontSize.description': '调整手机文字大小；切换布局不会重置字号。',
  'mobile.fontSize.increase': '增大手机字号',
  'mobile.fontSize.decrease': '减小手机字号',
  'mobile.fontSize.value': '{size} px',
} satisfies Record<string, string>

/** The settings.theme namespace key union. */
export type ThemeKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'appearance.title': 'Appearance',
  'appearance.light': 'Light',
  'appearance.dark': 'Dark',
  'appearance.system': 'System',
  'fontSize.title': 'Font size',
  'fontSize.description': 'Only affects conversation content',
  'fontSize.unit': 'px',
  'fontSize.increase': 'Increase font size',
  'fontSize.decrease': 'Decrease font size',
  'mobile.title': 'Mobile display',
  'mobile.description': 'Only affects phones. Desktop settings stay unchanged.',
  'mobile.layout': 'Layout size',
  'mobile.layout.large': 'Large',
  'mobile.layout.large.description': 'Clearer controls and titles, with compact task lists.',
  'mobile.layout.medium': 'Medium',
  'mobile.layout.medium.description': 'Compact and balanced for everyday use.',
  'mobile.layout.small': 'Small',
  'mobile.layout.small.description': 'More content, with icon-only bottom navigation.',
  'mobile.fontSize': 'Mobile font size',
  'mobile.fontSize.description': 'Adjust phone text size. Switching layouts keeps this size.',
  'mobile.fontSize.increase': 'Increase mobile font size',
  'mobile.fontSize.decrease': 'Decrease mobile font size',
  'mobile.fontSize.value': '{size} px',
} satisfies Record<ThemeKey, string>
