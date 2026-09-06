/**
 * The project todos tab: every project directory the Host scan found with a
 * todo document, its documents, and their items, read straight from the
 * files. The panel never edits a document — the actions hand the user to a
 * session in the project, to the file in its own application, or to the
 * document text inline.
 */
import { useEffect, useState } from 'react'
import clsx from 'clsx'
import type { ProjectTodoFile, ProjectTodoProject } from '@deepseek-ai/dsh-project-todos/types'
import type { DigestPanelProps } from './contract/slots.ts'
import type { ProjectDocumentResult, ProjectTodosView } from './projects-controller.ts'
import css from './DigestPanel.module.css'

/** Items shown per document before the list folds. */
const FOLD_AT = 8

/** Callbacks the projects tab needs from the panel. */
export interface ProjectTodosActions {
  rescan: () => void
  openProject: (project: ProjectTodoProject, file: ProjectTodoFile) => Promise<string | null>
  openPath: (path: string) => Promise<string | null>
  readDocument: (path: string) => Promise<ProjectDocumentResult>
}

/**
 * Render one document's items and its inline source view.
 * @param props - the document, copy, and actions.
 * @returns the document block.
 */
function DocumentBlock({ project, file, t, actions }: {
  project: ProjectTodoProject
  file: ProjectTodoFile
  t: DigestPanelProps['t']
  actions: ProjectTodosActions
}) {
  const [expanded, setExpanded] = useState(false)
  const [source, setSource] = useState<{ text: string } | { error: string } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    if (notice === null) return
    const timer = globalThis.setTimeout(() => { setNotice(null) }, 3_000)
    return () => { globalThis.clearTimeout(timer) }
  }, [notice])
  const items = expanded ? file.items : file.items.slice(0, FOLD_AT)
  const hidden = file.items.length - items.length
  const toggleSource = async (): Promise<void> => {
    if (source !== null) {
      setSource(null)
      return
    }
    const result = await actions.readDocument(file.path)
    setSource(result.ok ? { text: result.value.text } : { error: result.error.message })
  }
  const report = (message: string | null): void => { if (message !== null) setNotice(message) }
  return (
    <div className={css.projectFile} data-project-file={file.path}>
      <div className={css.projectFileHead}>
        <span className={css.projectFileName} title={file.path}>{file.relativePath}</span>
        <span className={css.projectFileCounts}>
          {file.open > 0 ? t('projects.counts', { open: file.open, done: file.done }) : t('projects.noOpen')}
        </span>
        <span className={css.spacer} />
        <button type="button" className={css.action} onClick={() => { void actions.openProject(project, file).then(report) }}>
          {t('projects.newSession')}
        </button>
        <button type="button" className={css.action} onClick={() => { void toggleSource() }}>
          {source === null ? t('projects.view') : t('projects.hide')}
        </button>
        <button type="button" className={css.action} onClick={() => { void actions.openPath(file.path).then(report) }}>
          {t('projects.openFile')}
        </button>
      </div>
      {notice !== null && <span className={css.inlineError} role="status">{notice}</span>}
      {items.length > 0 && (
        <ul className={css.projectItems}>
          {items.map(item => (
            <li
              key={item.line}
              className={clsx(css.projectItem, item.status === 'done' && css.projectItemDone)}
              style={{ paddingLeft: `${item.depth * 16}px` }}
              title={item.section === null ? t('projects.line', { line: item.line }) : `${item.section} · ${t('projects.line', { line: item.line })}`}
            >
              <span className={css.projectBox} aria-hidden="true">{item.status === 'done' ? '☑' : item.checkbox ? '☐' : '•'}</span>
              <span className={css.projectItemText}>{item.text}</span>
            </li>
          ))}
        </ul>
      )}
      {(hidden > 0 || expanded) && (
        <button type="button" className={css.linkButton} onClick={() => { setExpanded(value => !value) }}>
          {expanded ? t('projects.showLess') : t('projects.more', { count: hidden })}
        </button>
      )}
      {file.truncated && <p className={css.sectionHint}>{t('projects.truncated', { count: file.items.length })}</p>}
      {source !== null && (
        'error' in source
          ? <p className={css.inlineError}>{t('projects.readFailed', { message: source.error })}</p>
          : <pre className={css.projectSource}>{source.text}</pre>
      )}
    </div>
  )
}

/**
 * Render the projects tab.
 * @param props - the scan view, copy, and actions.
 * @returns the tab element.
 */
export function ProjectTodos({ view, t, actions }: {
  view: ProjectTodosView
  t: DigestPanelProps['t']
  actions: ProjectTodosActions
}) {
  const [onlyOpen, setOnlyOpen] = useState(false)
  const { snapshot } = view
  const projects = onlyOpen ? snapshot.projects.filter(project => project.open > 0) : snapshot.projects
  return (
    <div className={css.projectsTab}>
      <div className={css.projectsBar}>
        <span className={css.since}>
          {snapshot.scannedAt === null
            ? (view.status === 'loading' ? t('projects.loading') : '')
            : t('projects.summary', { candidates: snapshot.candidates, projects: snapshot.projects.length })}
        </span>
        {snapshot.scannedAt !== null && (
          <span className={css.since}>{t('projects.scannedAt', { time: new Date(snapshot.scannedAt).toLocaleTimeString() })}</span>
        )}
        {snapshot.warnings.length > 0 && (
          <span className={css.projectWarning} title={snapshot.warnings.map(warning => `${warning.path} — ${warning.message}`).join('\n')}>
            {t('projects.warnings', { count: snapshot.warnings.length })}
          </span>
        )}
        <span className={css.spacer} />
        <label className={css.showHandled}>
          <input type="checkbox" checked={onlyOpen} onChange={() => { setOnlyOpen(value => !value) }} />
          {t('projects.onlyOpen')}
        </label>
        <button type="button" className={css.action} disabled={view.scanning} onClick={actions.rescan}>
          {view.scanning ? t('projects.scanning') : t('projects.rescan')}
        </button>
      </div>

      {view.status === 'error' && (
        <div className={css.errorBar} role="alert">
          {t('projects.error', { message: view.error })}
          <button type="button" className={css.action} onClick={actions.rescan}>{t('panel.retry')}</button>
        </div>
      )}

      {projects.length === 0 && view.status !== 'error' && (
        <div className={css.empty}>
          <p className={css.emptyTitle}>{view.status === 'loading' && snapshot.scannedAt === null ? t('projects.loading') : t('projects.empty.title')}</p>
          {snapshot.settings.roots.length === 0 && <p className={css.emptyBody}>{t('projects.empty.noRoots')}</p>}
          <p className={css.emptyBody}>{t('projects.empty.body')}</p>
          {snapshot.settings.files.length > 0 && (
            <p className={css.emptyBody}>{t('projects.empty.patterns', { patterns: snapshot.settings.files.join(', ') })}</p>
          )}
        </div>
      )}

      {projects.map(project => (
        <section key={project.path} className={css.section} data-project={project.path}>
          <h3 className={css.sectionLabel}>
            <span className={css.projectName}>{project.name}</span>
            {project.sources.map(source => (
              <span key={source} className={css.projectTag}>{t(`projects.source.${source}`)}</span>
            ))}
            <span className={css.sectionCount}>{project.open}</span>
            {project.done > 0 && <span className={css.projectDone}>{t('projects.done', { count: project.done })}</span>}
            <span className={css.spacer} />
            <button type="button" className={css.linkButton} title={project.path} onClick={() => { void actions.openPath(project.path) }}>
              {t('projects.reveal')}
            </button>
          </h3>
          <p className={css.projectPath}>{project.path}</p>
          {project.files.map(file => (
            <DocumentBlock key={file.path} project={project} file={file} t={t} actions={actions} />
          ))}
        </section>
      ))}
    </div>
  )
}
