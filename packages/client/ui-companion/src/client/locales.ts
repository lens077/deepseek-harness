/** Companion copy; the Chinese dictionary owns the key set. */
export const zh = {
  'name': '休息小助手',
  'menu': '用量速览',
  'usage.session': '本会话用量',
  'usage.tree': '会话树用量',
  'usage.all': '全部会话用量',
  'usage.unavailable': '当前界面未加载用量面板。',
  'close': '关闭',
  'hint.idle': '我在这里陪你',
  'hint.greeting': '辛苦啦，一起歇一会儿？',
  'hint.sleeping': '小憩中，点我叫醒',
  'action.idle': '和小助手打招呼',
  'action.greeting': '让小助手休息',
  'action.sleeping': '叫醒小助手',
  'collapse': '收起小助手',
  'expand': '展开小助手',
  'pause': '暂停动效',
  'resume': '开启动效',
  'sleepMark': 'z Z',
  'dock': '归位',
  'dock.aria': '将小助手放回侧栏',
  'dragHelp': '按住拖动；方向键移动，Home 键归位。',
} as const

/** Localized companion key domain. */
export type CompanionKey = keyof typeof zh

/** English copy mirrors every Chinese key. */
export const en: Record<CompanionKey, string> = {
  'name': 'Rest companion',
  'menu': 'Usage overview',
  'usage.session': 'This session usage',
  'usage.tree': 'Session tree usage',
  'usage.all': 'All sessions usage',
  'usage.unavailable': 'The usage panel is not loaded in this interface.',
  'close': 'Close',
  'hint.idle': 'Here to keep you company',
  'hint.greeting': 'Good work. Shall we take a break?',
  'hint.sleeping': 'Taking a nap. Tap to wake me',
  'action.idle': 'Say hello to your companion',
  'action.greeting': 'Let your companion rest',
  'action.sleeping': 'Wake your companion',
  'collapse': 'Minimize companion',
  'expand': 'Expand companion',
  'pause': 'Pause animation',
  'resume': 'Enable animation',
  'sleepMark': 'z Z',
  'dock': 'Dock',
  'dock.aria': 'Return companion to sidebar',
  'dragHelp': 'Drag to move; arrow keys move, Home returns to sidebar.',
}
