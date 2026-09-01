/**
 * The two capability fields a pi-ai model row edits beyond its capacities:
 * `input` (request modalities) and `reasoningEfforts` (selectable thinking
 * levels). Both are claims about the endpoint the adapter cannot check, and
 * both default to "whatever the installed catalog records", which for a
 * hand-entered model is text-only and non-reasoning — so a vision or thinking
 * model on a custom provider is unusable until a row declares it.
 *
 * The values written here are the adapter's own field values, so a row stays
 * one `settings.yaml` entry: `input: [text, image]`, `reasoningEfforts: false`,
 * or a dict of `level: wire spelling`. Only the canonical spelling
 * (`high: high`, `off` with no value) is written; a renamed spelling or a
 * modality outside the two known ones is preserved as read and reported to the
 * user as such rather than rewritten.
 */

/** Request modalities the adapter accepts in `input`. */
const MODALITIES = ['text', 'image'] as const

/** pi-ai's ordered thinking levels, the keys `reasoningEfforts` may name. */
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/** One pi-ai thinking level. */
export type ThinkingLevel = typeof THINKING_LEVELS[number]

/** What the image-input select shows for one row's `input`. */
export type InputChoice = 'inherit' | 'multimodal' | 'text' | 'custom'

/** What the reasoning select shows for one row's `reasoningEfforts`. */
export type ReasoningChoice = 'inherit' | 'none' | 'levels'

/** A plain object value, as opposed to `null` or an array. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Classify a row's `input` for the select.
 * @param input - the row's `input` field as stored.
 * @returns `inherit` when absent or empty (both mean "keep the catalog's"),
 * `multimodal` for text plus image, `text` for text alone, and `custom` for any
 * other value, which the select shows without offering to keep it.
 */
export function inputChoice(input: unknown): InputChoice {
  if (input === undefined || (Array.isArray(input) && input.length === 0)) return 'inherit'
  if (!Array.isArray(input)) return 'custom'
  const set = new Set(input)
  if (set.size !== input.length || ![...set].every(entry => (MODALITIES as readonly unknown[]).includes(entry))) {
    return 'custom'
  }
  if (set.has('image')) return set.has('text') ? 'multimodal' : 'custom'
  return 'text'
}

/**
 * The `input` value one select choice writes.
 * @param choice - a choice the select offers; `custom` is display-only.
 * @returns the field value, `undefined` to remove the field.
 */
export function inputValue(choice: Exclude<InputChoice, 'custom'>): readonly string[] | undefined {
  if (choice === 'inherit') return undefined
  return choice === 'multimodal' ? ['text', 'image'] : ['text']
}

/**
 * Classify a row's `reasoningEfforts` for the select.
 * @param efforts - the row's `reasoningEfforts` field as stored.
 * @returns `inherit` when absent, `none` for `false`, and `levels` for any
 * other value, which the level checkboxes then show.
 */
export function reasoningChoice(efforts: unknown): ReasoningChoice {
  if (efforts === undefined) return 'inherit'
  return efforts === false ? 'none' : 'levels'
}

/**
 * The levels a row's dict currently offers.
 * @param efforts - the row's `reasoningEfforts` field as stored.
 * @returns the offered levels in pi-ai order; nothing when the field is not a dict.
 */
export function offeredLevels(efforts: unknown): readonly ThinkingLevel[] {
  if (!isRecord(efforts)) return []
  return THINKING_LEVELS.filter(level => level in efforts)
}

/**
 * The dict after one level is checked or unchecked. A newly checked level is
 * written as its canonical spelling (`off` as no value: supported, send
 * nothing); levels the row already names keep whatever spelling they carry.
 * @param efforts - the row's `reasoningEfforts` field as stored.
 * @param level - the level toggled.
 * @param offered - whether the level is now offered.
 * @returns the next dict value.
 */
export function withLevel(efforts: unknown, level: ThinkingLevel, offered: boolean): Record<string, unknown> {
  const current = isRecord(efforts) ? efforts : {}
  if (!offered) {
    return Object.fromEntries(Object.entries(current).filter(([key]) => key !== level))
  }
  return { ...current, [level]: level === 'off' ? null : level }
}

/**
 * The dict written when a row switches to custom levels: the levels a
 * hand-entered thinking model most commonly serves, spelled canonically.
 * @returns a fresh dict offering `low` through `high`.
 */
export function defaultLevels(): Record<string, unknown> {
  return { low: 'low', medium: 'medium', high: 'high' }
}

/**
 * Check a row's capability fields against what the adapter accepts, in the
 * same terms the adapter refuses them: a modality list holding only known
 * modalities, and a reasoning declaration that is `false` or a dict offering
 * at least one level beyond `off` with every level but `off` spelling its
 * wire value.
 * @param model - the row as stored.
 * @returns the copy key naming the first refused field, or `undefined`.
 */
export function validateModelCapabilities(
  model: Readonly<Record<string, unknown>>,
): 'modelInputInvalid' | 'modelReasoningInvalid' | undefined {
  const input = model['input']
  if (input !== undefined
    && (!Array.isArray(input) || !input.every(entry => (MODALITIES as readonly unknown[]).includes(entry)))) {
    return 'modelInputInvalid'
  }
  const efforts = model['reasoningEfforts']
  if (efforts === undefined || efforts === false) return undefined
  if (!isRecord(efforts)) return 'modelReasoningInvalid'
  const entries = Object.entries(efforts)
  const known = entries.every(([level, wire]) =>
    (THINKING_LEVELS as readonly string[]).includes(level)
    && (typeof wire === 'string' ? wire.length > 0 : wire === null && level === 'off'))
  if (!known || !entries.some(([level]) => level !== 'off')) return 'modelReasoningInvalid'
  return undefined
}
