/** Classification and validation of a pi-ai model row's `input` and `reasoningEfforts`. */
import { describe, expect, it } from 'vitest'
import { validateDeepSeekModels } from '../src/client/DeepSeekModelsEditor.tsx'
import {
  defaultLevels, inputChoice, inputValue, offeredLevels, reasoningChoice, validateModelCapabilities, withLevel,
} from '../src/client/model-capabilities.ts'

describe('inputChoice', () => {
  it('reads absent and empty as inherit, the two known lists as themselves, and the rest as custom', () => {
    expect(inputChoice(undefined)).toBe('inherit')
    expect(inputChoice([])).toBe('inherit')
    expect(inputChoice(['text', 'image'])).toBe('multimodal')
    expect(inputChoice(['image', 'text'])).toBe('multimodal')
    expect(inputChoice(['text'])).toBe('text')
    // Image alone, a duplicate, an unknown modality, and a non-list are all
    // shown as written rather than snapped to the nearest choice.
    expect(inputChoice(['image'])).toBe('custom')
    expect(inputChoice(['text', 'text'])).toBe('custom')
    expect(inputChoice(['text', 'audio'])).toBe('custom')
    expect(inputChoice('text')).toBe('custom')
  })

  it('writes each choice as the adapter field value', () => {
    expect(inputValue('inherit')).toBeUndefined()
    expect(inputValue('multimodal')).toEqual(['text', 'image'])
    expect(inputValue('text')).toEqual(['text'])
  })
})

describe('reasoning levels', () => {
  it('classifies the field and lists offered levels in pi-ai order', () => {
    expect(reasoningChoice(undefined)).toBe('inherit')
    expect(reasoningChoice(false)).toBe('none')
    expect(reasoningChoice({ high: 'high' })).toBe('levels')
    expect(offeredLevels({ max: 'ultra', off: null, low: 'low' })).toEqual(['off', 'low', 'max'])
    expect(offeredLevels(false)).toEqual([])
    expect(offeredLevels(undefined)).toEqual([])
  })

  it('adds a level canonically, keeps a renamed spelling, and removes by key', () => {
    expect(withLevel(undefined, 'high', true)).toEqual({ high: 'high' })
    expect(withLevel({ max: 'ultra' }, 'off', true)).toEqual({ max: 'ultra', off: null })
    expect(withLevel({ max: 'ultra', high: 'high' }, 'high', false)).toEqual({ max: 'ultra' })
    expect(defaultLevels()).toEqual({ low: 'low', medium: 'medium', high: 'high' })
  })
})

describe('validateModelCapabilities', () => {
  it('accepts what the adapter accepts', () => {
    expect(validateModelCapabilities({ id: 'm' })).toBeUndefined()
    expect(validateModelCapabilities({ input: [], reasoningEfforts: false })).toBeUndefined()
    expect(validateModelCapabilities({ input: ['image'] })).toBeUndefined()
    expect(validateModelCapabilities({ reasoningEfforts: { off: null, max: 'ultra' } })).toBeUndefined()
  })

  it('refuses an unknown modality, a non-list, and a reasoning dict the adapter would reject', () => {
    expect(validateModelCapabilities({ input: ['text', 'audio'] })).toBe('modelInputInvalid')
    expect(validateModelCapabilities({ input: 'text' })).toBe('modelInputInvalid')
    expect(validateModelCapabilities({ reasoningEfforts: null })).toBe('modelReasoningInvalid')
    expect(validateModelCapabilities({ reasoningEfforts: ['high'] })).toBe('modelReasoningInvalid')
    expect(validateModelCapabilities({ reasoningEfforts: {} })).toBe('modelReasoningInvalid')
    expect(validateModelCapabilities({ reasoningEfforts: { off: null } })).toBe('modelReasoningInvalid')
    expect(validateModelCapabilities({ reasoningEfforts: { high: null } })).toBe('modelReasoningInvalid')
    expect(validateModelCapabilities({ reasoningEfforts: { high: '' } })).toBe('modelReasoningInvalid')
    expect(validateModelCapabilities({ reasoningEfforts: { ultra: 'ultra' } })).toBe('modelReasoningInvalid')
    // The shared row checker names the row, after the fields it checks first.
    expect(validateDeepSeekModels([{ id: 'ok' }, { id: 'bad', input: ['audio'] }]))
      .toEqual({ index: 1, key: 'modelInputInvalid' })
  })
})
