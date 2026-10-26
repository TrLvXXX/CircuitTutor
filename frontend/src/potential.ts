// =============================================================
// 等电位可视化信息：在拓扑分析基础上为每个节点分配显示颜色，
// 使「同一节点（等电位）的引脚」在画布上呈现相同颜色。
// =============================================================
import type { CircuitComponent, Wire } from './types';
import { analyzeTopology, compareNodeId } from './topology';

/** 等电位颜色信息 */
export interface Potentials {
  nodeOfPin: Map<string, string>;
  pinsOfNode: Map<string, string[]>;
  /** 引脚键 -> 颜色 */
  colorOfPin: Map<string, string>;
  /** 节点 id -> 颜色 */
  colorOfNode: Map<string, string>;
  hasGround: boolean;
}

/** 非接地节点调色板（色相分散，兼顾色觉可辨识） */
const PALETTE = [
  '#2563eb',
  '#dc2626',
  '#16a34a',
  '#d97706',
  '#7c3aed',
  '#0891b2',
  '#db2777',
  '#65a30d',
];

/** 接地节点固定颜色 */
const GROUND_COLOR = '#475569';

/** 计算等电位分组与配色 */
export function computePotentials(
  components: CircuitComponent[],
  wires: Wire[],
): Potentials {
  const topo = analyzeTopology(components, wires);

  const nodeIds = [...topo.pinsOfNode.keys()].sort(compareNodeId);
  const colorOfNode = new Map<string, string>();
  let paletteIndex = 0;
  for (const id of nodeIds) {
    if (id === 'n0' && topo.hasGround) {
      colorOfNode.set(id, GROUND_COLOR);
    } else {
      colorOfNode.set(id, PALETTE[paletteIndex % PALETTE.length]);
      paletteIndex += 1;
    }
  }

  const colorOfPin = new Map<string, string>();
  for (const [nodeId, pins] of topo.pinsOfNode) {
    const color = colorOfNode.get(nodeId)!;
    for (const key of pins) colorOfPin.set(key, color);
  }

  return {
    nodeOfPin: topo.nodeOfPin,
    pinsOfNode: topo.pinsOfNode,
    colorOfPin,
    colorOfNode,
    hasGround: topo.hasGround,
  };
}