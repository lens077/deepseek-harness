/**
 * Pure coordinate layout for the card graph: one row per lane, columns per
 * spine node with delegated agents stacked in the column after the todo they
 * served, and branch rows placed under their anchor node.
 */
import type { FlowLane, FlowNode, FlowSnapshot } from './flow-contract.ts'

/** Card metrics in CSS pixels. */
export interface FlowLayoutMetrics {
  readonly nodeWidth: number
  readonly nodeHeight: number
  readonly gapX: number
  readonly gapY: number
  readonly rowGap: number
  readonly padding: number
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
  nodeWidth: 156, nodeHeight: 58, gapX: 24, gapY: 6, rowGap: 28, padding: 20,
}

/** A drawing column: at least one node. */
export type FlowColumn = [FlowNode, ...FlowNode[]]

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
 * Lay out the card graph.
 * @param snapshot - assembled task flow.
 * @param metrics - card metrics.
 * @returns positioned cards, connectors, and row captions.
 */
export function layoutFlow(snapshot: FlowSnapshot, metrics: FlowLayoutMetrics): FlowLayout {
  const placed = new Map<string, FlowLayoutNode>()
  const nodes: FlowLayoutNode[] = []
  const edges: FlowLayoutEdge[] = []
  const rows: FlowLayoutRow[] = []
  const stepX = metrics.nodeWidth + metrics.gapX
  const stepY = metrics.nodeHeight + metrics.gapY
  let rowTop = metrics.padding
  let width = 0

  for (const lane of snapshot.lanes) {
    const columns = columnsOf(lane, snapshot.nodes)
    const firstColumn = columns[0]
    if (firstColumn === undefined) continue
    const stack = Math.max(...columns.map(column => column.length))
    const rowHeight = stack * stepY - metrics.gapY
    const centerY = rowTop + rowHeight / 2
    const anchor = lane.anchorNodeId === undefined ? undefined : placed.get(lane.anchorNodeId)
    const originX = anchor === undefined ? metrics.padding : anchor.x + metrics.gapX
    rows.push({ lane, y: rowTop })

    let previous: FlowLayoutNode[] = []
    for (const [index, column] of columns.entries()) {
      const x = originX + index * stepX
      const top = centerY - (column.length * stepY - metrics.gapY) / 2
      const current: FlowLayoutNode[] = column.map((node, at) => ({
        id: node.id,
        node,
        x,
        y: top + at * stepY,
        width: metrics.nodeWidth,
        height: metrics.nodeHeight,
      }))
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
    const first = placed.get(firstColumn[0].id)
    if (anchor !== undefined && first !== undefined) {
      edges.push({
        id: `${anchor.id}~>${first.id}`,
        x1: anchor.x + anchor.width / 2,
        y1: anchor.y + anchor.height,
        x2: first.x,
        y2: first.y + first.height / 2,
        dashed: true,
      })
    }
    rowTop += rowHeight + metrics.rowGap
  }

  return {
    width: width + metrics.padding,
    height: rows.length === 0 ? 0 : rowTop - metrics.rowGap + metrics.padding,
    nodes,
    edges,
    rows,
  }
}
