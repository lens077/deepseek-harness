/**
 * Pure coordinate layout for the card graph: one row for the main line and its
 * sequels, columns per spine node with delegated agents stacked in the column
 * after the todo they served, and interjection rows placed under their anchor node.
 */
import type { FlowLane, FlowNode, FlowSnapshot } from './flow-contract.ts'

/** Card metrics in CSS pixels. */
export interface FlowLayoutMetrics {
  readonly nodeWidth: number
  /** Smallest card height; a card grows past it for wrapped title lines. */
  readonly nodeHeight: number
  readonly gapX: number
  readonly gapY: number
  readonly rowGap: number
  readonly padding: number
  /** The card's own horizontal and vertical padding, matching `.card` in the stylesheet. */
  readonly cardPadX: number
  readonly cardPadY: number
}

/**
 * Longest title a card draws before the stylesheet clamps it. The prompt label
 * is capped at 4 096 code units upstream, so only a pathological prompt reaches
 * this bound; the complete text stays on the tooltip.
 */
export const CARD_TITLE_MAX_LINES = 40

/** Line height ratio shared with the stylesheet's `line-height: 1.45`. */
const LINE_HEIGHT = 1.45
/** Width of one Latin glyph at 600 weight, as a fraction of the font size. */
const LATIN_EM = 0.6
/** Width of one CJK or fullwidth glyph as a fraction of the font size. */
const WIDE_EM = 1
/** Slack for word boundaries and CJK line-end prohibitions the greedy estimate cannot see; calibrated in the browser e2e. */
const WRAP_SLACK = 1.2
/** Space the prompt ordinal tag and its gap take from the first title row. */
const ORDINAL_TAG_WIDTH = 34
/** Space between the title block and the meta row, matching `.card { gap }`. */
const CARD_GAP = 2

/**
 * One East Asian wide or fullwidth glyph: Hangul Jamo, CJK and Yi, Hangul
 * syllables, compatibility forms, fullwidth forms, and the astral CJK planes.
 */
const WIDE_GLYPH = new RegExp(
  '^(?:[\\u1100-\\u115F\\u2E80-\\uA4CF\\uAC00-\\uD7A3\\uF900-\\uFAFF\\uFE30-\\uFE4F\\uFF00-\\uFF60\\uFFE0-\\uFFE6]'
  + '|[\\u{20000}-\\u{3FFFF}])$',
  'u',
)

/**
 * Estimate how many lines a title wraps to inside a card of the given metrics.
 * @param title - drawn title text.
 * @param widthPx - width available to the text.
 * @param fontSize - card font size in CSS pixels.
 * @param leadingPx - width taken from the first line by an inline tag.
 * @returns at least one line, at most {@link CARD_TITLE_MAX_LINES}.
 */
export function estimateTitleLines(title: string, widthPx: number, fontSize: number, leadingPx = 0): number {
  let width = leadingPx
  for (const char of title) width += (WIDE_GLYPH.test(char) ? WIDE_EM : LATIN_EM) * fontSize
  const lines = Math.ceil(width * WRAP_SLACK / Math.max(1, widthPx))
  return Math.min(CARD_TITLE_MAX_LINES, Math.max(1, lines))
}

/**
 * Height of one card: its padding, the wrapped title, and one meta row, never below the metric minimum.
 * @param node - drawn node.
 * @param title - the title text the card draws.
 * @param metrics - card metrics.
 * @param fontSize - card font size in CSS pixels.
 * @returns the card height in CSS pixels.
 */
export function cardHeightOf(node: FlowNode, title: string, metrics: FlowLayoutMetrics, fontSize: number): number {
  const lineHeight = Math.ceil(fontSize * LINE_HEIGHT)
  const inner = metrics.nodeWidth - 2 * metrics.cardPadX - 2
  const lines = estimateTitleLines(title, inner, fontSize, node.kind === 'prompt' ? ORDINAL_TAG_WIDTH : 0)
  return Math.max(metrics.nodeHeight, 2 * metrics.cardPadY + 2 + lines * lineHeight + CARD_GAP + lineHeight)
}

/** One positioned card. */
export interface FlowLayoutNode {
  readonly id: string
  readonly node: FlowNode
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** One connector between two card edges. */
export interface FlowLayoutEdge {
  readonly id: string
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
  /** Branch connectors are dashed; spine connectors are solid. */
  readonly dashed: boolean
}

/** One lane row caption. */
export interface FlowLayoutRow {
  readonly lane: FlowLane
  readonly y: number
}

/** Complete card-graph geometry. */
export interface FlowLayout {
  readonly width: number
  readonly height: number
  readonly nodes: readonly FlowLayoutNode[]
  readonly edges: readonly FlowLayoutEdge[]
  readonly rows: readonly FlowLayoutRow[]
}

/** Default card metrics for the resident strip. */
export const DOCK_METRICS: FlowLayoutMetrics = {
  nodeWidth: 196, nodeHeight: 54, gapX: 24, gapY: 8, rowGap: 32, padding: 20, cardPadX: 8, cardPadY: 4,
}

/** Resolve one card's height; the default is the metric minimum for every node. */
export type FlowCardHeight = (node: FlowNode) => number

/** A drawing column: at least one node. */
export type FlowColumn = [FlowNode, ...FlowNode[]]

/** Lanes kept on a history-collapsed drawing and the lanes folded away. */
export interface FlowHistorySplit {
  readonly visible: readonly FlowLane[]
  readonly hidden: readonly FlowLane[]
}

/**
 * Split lanes for a drawing that shows only the newest turn: the latest lane
 * on the line stays, with the interjections hanging off it; every earlier lane
 * is hidden. A flow with a single line lane hides nothing.
 * @param lanes - drawn lanes in order.
 * @returns visible and hidden lanes, each in the original order.
 */
export function splitHistory(lanes: readonly FlowLane[]): FlowHistorySplit {
  const line = lanes.filter(lane => lane.kind !== 'interjection')
  const latest = line.at(-1)
  if (latest === undefined || line.length < 2) return { visible: lanes, hidden: [] }
  const visibleIds = new Set([latest.id])
  for (const lane of lanes) {
    if (lane.kind === 'interjection' && lane.parentLaneId !== undefined && visibleIds.has(lane.parentLaneId)) visibleIds.add(lane.id)
  }
  return {
    visible: lanes.filter(lane => visibleIds.has(lane.id)),
    hidden: lanes.filter(lane => !visibleIds.has(lane.id)),
  }
}

function isRow(columns: readonly FlowColumn[]): columns is [FlowColumn, ...FlowColumn[]] {
  return columns.length > 0
}

/**
 * Group a lane's nodes into drawing columns: each spine node, then the agents
 * it served as one stacked column; agents without a served todo follow the prompt.
 * @param lane - drawn lane.
 * @param nodes - node table.
 * @returns non-empty columns in drawing order.
 */
export function columnsOf(lane: FlowLane, nodes: ReadonlyMap<string, FlowNode>): FlowColumn[] {
  const columns: FlowColumn[] = []
  const agentsByParent = new Map<string, FlowColumn>()
  const unparented = new Map<number, FlowColumn>()
  const spine: FlowNode[] = []
  const collect = <Key>(map: Map<Key, FlowColumn>, key: Key, node: FlowNode): void => {
    const list = map.get(key)
    if (list === undefined) map.set(key, [node])
    else list.push(node)
  }
  for (const id of lane.nodeIds) {
    const node = nodes.get(id)
    if (node === undefined) continue
    if (node.kind === 'agent') {
      if (node.parentId === undefined) collect(unparented, node.turn, node)
      else collect(agentsByParent, node.parentId, node)
      continue
    }
    spine.push(node)
  }
  const terminal = spine.find(node => node.kind === 'terminal')
  for (const node of spine) {
    if (node.kind === 'terminal') continue
    columns.push([node])
    const agents = agentsByParent.get(node.id)
    if (agents !== undefined) columns.push(agents)
    if (node.kind === 'prompt') {
      for (const list of unparented.values()) columns.push(list)
    }
  }
  if (terminal !== undefined) columns.push([terminal])
  return columns
}

/**
 * Lay out the card graph. Cards in one column stack top to bottom at their own
 * heights; a row is as tall as its tallest column and every column is centred in it.
 * @param snapshot - assembled task flow.
 * @param metrics - card metrics.
 * @param heightOf - card height per node; defaults to the metric minimum.
 * @returns positioned cards, connectors, and row captions.
 */
export function layoutFlow(
  snapshot: FlowSnapshot,
  metrics: FlowLayoutMetrics,
  heightOf: FlowCardHeight = () => metrics.nodeHeight,
): FlowLayout {
  const placed = new Map<string, FlowLayoutNode>()
  const nodes: FlowLayoutNode[] = []
  const edges: FlowLayoutEdge[] = []
  const rows: FlowLayoutRow[] = []
  const stepX = metrics.nodeWidth + metrics.gapX
  let rowTop = metrics.padding
  let width = 0
  const columnHeight = (column: FlowColumn): number =>
    column.reduce((sum, node) => sum + heightOf(node), 0) + (column.length - 1) * metrics.gapY

  /**
   * Place one row of columns from `originX`, chaining solid edges between
   * neighbouring columns; returns the left-middle point of the row's first card.
   */
  const placeRow = (lane: FlowLane, columns: readonly [FlowColumn, ...FlowColumn[]], originX: number): { x: number; y: number } => {
    const rowHeight = Math.max(...columns.map(columnHeight))
    const centerY = rowTop + rowHeight / 2
    rows.push({ lane, y: rowTop })
    const entry = { x: originX, y: centerY - columnHeight(columns[0]) / 2 + heightOf(columns[0][0]) / 2 }
    let previous: FlowLayoutNode[] = []
    for (const [index, column] of columns.entries()) {
      const x = originX + index * stepX
      let y = centerY - columnHeight(column) / 2
      const current: FlowLayoutNode[] = column.map((node) => {
        const height = heightOf(node)
        const card = { id: node.id, node, x, y, width: metrics.nodeWidth, height }
        y += height + metrics.gapY
        return card
      })
      for (const card of current) {
        placed.set(card.id, card)
        nodes.push(card)
        width = Math.max(width, card.x + card.width)
      }
      for (const from of previous) {
        for (const to of current) {
          edges.push({
            id: `${from.id}->${to.id}`,
            x1: from.x + from.width,
            y1: from.y + from.height / 2,
            x2: to.x,
            y2: to.y + to.height / 2,
            dashed: false,
          })
        }
      }
      previous = current
    }
    rowTop += rowHeight + metrics.rowGap
    return entry
  }

  // The main line and its sequels share the first row; interjections hang below their anchor.
  const line = snapshot.lanes.filter(lane => lane.kind !== 'interjection')
  const lineColumns = line.flatMap(lane => columnsOf(lane, snapshot.nodes))
  const lineLane = line[0]
  if (lineLane !== undefined && isRow(lineColumns)) placeRow(lineLane, lineColumns, metrics.padding)

  for (const lane of snapshot.lanes) {
    if (lane.kind !== 'interjection') continue
    const columns = columnsOf(lane, snapshot.nodes)
    if (!isRow(columns)) continue
    const anchor = lane.anchorNodeId === undefined ? undefined : placed.get(lane.anchorNodeId)
    const entry = placeRow(lane, columns, anchor === undefined ? metrics.padding : anchor.x + metrics.gapX)
    if (anchor !== undefined) {
      edges.push({
        id: `${anchor.id}~>${columns[0][0].id}`,
        x1: anchor.x + anchor.width / 2,
        y1: anchor.y + anchor.height,
        x2: entry.x,
        y2: entry.y,
        dashed: true,
      })
    }
  }

  return {
    width: width + metrics.padding,
    height: rows.length === 0 ? 0 : rowTop - metrics.rowGap + metrics.padding,
    nodes,
    edges,
    rows,
  }
}
