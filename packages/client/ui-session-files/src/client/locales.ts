/** `session-files` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'session-files'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'button.label': '文件',
  'button.open': '展开文件面板',
  'button.close': '收起文件面板',
  'button.count': '本会话已修改 {count} 个文件',
  'rail.title': '本会话的文件',
  'rail.changed': '已修改',
  'rail.empty': '本会话还没有改动文件。',
  'rail.writing': '正在写入 {name}',
  'rail.select': '定位到 {name} 的改动',
  'rail.readOne': '已读取 1 个文件',
  'rail.read': '已读取 {count} 个文件',
  'rail.partial': '更早的改动尚未加载',
  'rail.loadAll': '加载全部',
  'rail.resize': '拖动调整文件面板宽度',
  'segment.turn': '第 {turn} 轮 · {tool}',
  'segment.looseTurn': '{tool}',
  'segment.change': '改动',
  'segment.sourced': '{source} · {rest}',
  'delegation.changed': '{source} 改动的文件',
  'settings.expansion.title': '文件改动的对比',
  'settings.expansion.description': '回复末尾列出本回合改动的文件，展开后显示修改前后的对比。读取的文件没有对比可展开。',
  'settings.expansion.all': '全部展开',
  'settings.expansion.single': '仅单个文件时展开',
  'settings.expansion.none': '全部收起',
}

/** English dictionary (same key set). */
export const en: Record<SessionFilesKey, string> = {
  'button.label': 'Files',
  'button.open': 'Open the file panel',
  'button.close': 'Close the file panel',
  'button.count': '{count} files changed in this session',
  'rail.title': 'Files in this session',
  'rail.changed': 'Changed',
  'rail.empty': 'This session has not changed any file yet.',
  'rail.writing': 'Writing {name}',
  'rail.select': 'Go to the changes in {name}',
  'rail.readOne': 'Read 1 file',
  'rail.read': 'Read {count} files',
  'rail.partial': 'Earlier changes are not loaded',
  'rail.loadAll': 'Load all',
  'rail.resize': 'Drag to resize the file panel',
  'segment.turn': 'Turn {turn} · {tool}',
  'segment.looseTurn': '{tool}',
  'segment.change': 'Change',
  'segment.sourced': '{source} · {rest}',
  'delegation.changed': 'Files {source} changed',
  'settings.expansion.title': 'File change comparison',
  'settings.expansion.description': 'A reply ends with the files that turn changed; expanding one compares its content before and after. A file that was only read has no comparison to open.',
  'settings.expansion.all': 'Expand every file',
  'settings.expansion.single': 'Expand only a single file',
  'settings.expansion.none': 'Keep every file closed',
}

/** Union of this namespace's dictionary keys. */
export type SessionFilesKey = keyof typeof zh
