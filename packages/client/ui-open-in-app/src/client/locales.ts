/** `open-in-app` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'open-in-app'

/**
 * The non-application menu entry: keep file clicks inside the product, in
 * the right Sidebar's text preview. Not a catalog id; the host never sees it.
 */
export const SIDEBAR_CHOICE = 'sidebar'

/** Application labels shared verbatim by both dictionaries (product names). */
const PRODUCT_NAMES = {
  'app.cursor': 'Cursor',
  'app.vscode': 'VS Code',
  'app.vscodeinsiders': 'VS Code Insiders',
  'app.windsurf': 'Windsurf',
  'app.zed': 'Zed',
  'app.sublimetext': 'Sublime Text',
  'app.xcode': 'Xcode',
  'app.androidstudio': 'Android Studio',
  'app.intellij': 'IntelliJ IDEA',
  'app.pycharm': 'PyCharm',
  'app.webstorm': 'WebStorm',
  'app.phpstorm': 'PhpStorm',
  'app.goland': 'GoLand',
  'app.rider': 'Rider',
  'app.rustrover': 'RustRover',
  'app.fork': 'Fork',
  'app.sourcetree': 'Sourcetree',
  'app.github': 'GitHub Desktop',
  'app.tower': 'Tower',
  'app.gitkraken': 'GitKraken',
  'app.smartgit': 'SmartGit',
  'app.sublimemerge': 'Sublime Merge',
  'app.ghostty': 'Ghostty',
  'app.warp': 'Warp',
  'app.iterm': 'iTerm2',
  'app.kitty': 'kitty',
  'app.windowsterminal': 'Windows Terminal',
  'app.gitbash': 'Git Bash',
  'app.gnometerminal': 'GNOME Terminal',
  'app.konsole': 'Konsole',
} as const

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'open.title': '在 {app} 中打开工作目录',
  'open.tooltip': '在本地打开',
  'open.error': '打开失败',
  'open.sidebar.title': '在侧栏中浏览工作目录',
  'open.sidebar.tooltip': '在侧栏中打开',
  'file.notInstalled': '{app} 未安装，无法打开文件。请在会话头部的“打开方式”中选择其他应用。',
  'file.failed': '无法用 {app} 打开文件。',
  'file.unavailable': '当前主机没有可用的本地打开方式。',
  'menu.toggle': '选择打开方式',
  'menu.aria': '打开方式',
  'menu.sidebar': '侧栏预览',
  ...PRODUCT_NAMES,
  'app.finder': '访达',
  'app.explorer': '文件资源管理器',
  'app.filemanager': '文件管理器',
  'app.terminal': '终端',
} as const

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<OpenInAppKey, string> = {
  'open.title': 'Open workspace in {app}',
  'open.tooltip': 'Open locally',
  'open.error': 'Failed to open',
  'open.sidebar.title': 'Browse workspace in the sidebar',
  'open.sidebar.tooltip': 'Open in sidebar',
  'file.notInstalled': '{app} is not installed, so the file could not be opened. Pick another app under “Open in” in the session header.',
  'file.failed': 'Couldn’t open the file with {app}.',
  'file.unavailable': 'This host has no local way to open files.',
  'menu.toggle': 'Choose an app to open in',
  'menu.aria': 'Open in',
  'menu.sidebar': 'Sidebar preview',
  ...PRODUCT_NAMES,
  'app.finder': 'Finder',
  'app.explorer': 'File Explorer',
  'app.filemanager': 'Files',
  'app.terminal': 'Terminal',
}

/** Key domain of the `open-in-app` namespace (zh is the source of truth). */
export type OpenInAppKey = keyof typeof zh

/**
 * Label keys per catalog id: the browser renders only ids it can name, so a
 * host catalog extension without a matching dictionary entry stays invisible
 * instead of showing a raw id.
 */
export const APP_LABEL_KEY: Record<string, OpenInAppKey | undefined> = {
  finder: 'app.finder',
  explorer: 'app.explorer',
  filemanager: 'app.filemanager',
  cursor: 'app.cursor',
  vscode: 'app.vscode',
  vscodeinsiders: 'app.vscodeinsiders',
  windsurf: 'app.windsurf',
  zed: 'app.zed',
  sublimetext: 'app.sublimetext',
  xcode: 'app.xcode',
  androidstudio: 'app.androidstudio',
  intellij: 'app.intellij',
  pycharm: 'app.pycharm',
  webstorm: 'app.webstorm',
  phpstorm: 'app.phpstorm',
  goland: 'app.goland',
  rider: 'app.rider',
  rustrover: 'app.rustrover',
  fork: 'app.fork',
  sourcetree: 'app.sourcetree',
  github: 'app.github',
  tower: 'app.tower',
  gitkraken: 'app.gitkraken',
  smartgit: 'app.smartgit',
  sublimemerge: 'app.sublimemerge',
  ghostty: 'app.ghostty',
  warp: 'app.warp',
  iterm: 'app.iterm',
  kitty: 'app.kitty',
  terminal: 'app.terminal',
  windowsterminal: 'app.windowsterminal',
  gitbash: 'app.gitbash',
  gnometerminal: 'app.gnometerminal',
  konsole: 'app.konsole',
}
