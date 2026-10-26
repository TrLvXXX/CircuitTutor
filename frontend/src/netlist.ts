// =============================================================
// 网表转换：把画布的「元件 + 导线」转换为系统约定的网表 JSON。
// 拓扑解析（端子合并、节点编号）统一委托给 topology.ts，
// 保证导出编号与界面等电位配色完全一致。本模块不含任何求解逻辑。
// =============================================================
import type {
  CircuitComponent,
  Netlist,
  NetlistComponent,
  NetlistNode,
  Wire,
} from './types';
import { getPinOffsets, pinKey } from './utils/geometry';
import { analyzeTopology, compareNodeId } from './topology';

/**
 * 构建网表。
 * @param components 画布元件
 * @param wires 画布导线
 * @returns 符合系统约定的网表 JSON
 */
export function buildNetlist(
  components: CircuitComponent[],
  wires: Wire[],
): Netlist {
  const topo = analyzeTopology(components, wires);

  // 生成节点：按 id 顺序输出（n0、n1、n2 …），保证结果稳定
  const nodeIds = [...topo.pinsOfNode.keys()].sort(compareNodeId);
  const nodes: NetlistNode[] = nodeIds.map((id) => {
    const point = topo.pointOfNode.get(id)!;
    const isGround = topo.hasGround && id === 'n0';
    return isGround
      ? { id, x: point.x, y: point.y, isGround: true }
      : { id, x: point.x, y: point.y };
  });

  // 生成元件：把每个引脚映射到其所属节点 id（junction 不导出，仅作拓扑标记）
  const netComponents: NetlistComponent[] = components
    .filter((comp) => comp.type !== 'junction')
    .map((comp) => {
      const offsets = getPinOffsets(comp.type);
      const pins = offsets.map(
        (_, pinIndex) => topo.nodeOfPin.get(pinKey(comp.id, pinIndex))!,
      );
      // 未知量标记随 params 传给后端（后端据此反解元件参数）
      const params = { ...(comp.params ?? {}) };
      if (comp.unknown) params.unknown = true;
      return { id: comp.id, type: comp.type, pins, value: comp.value, params };
    });

  // 已知量：未被标记为未知量的元件（其数值已知）
  const knowns: Record<string, number> = {};
  for (const comp of components) {
    if (!comp.unknown && comp.type !== 'ground' && comp.type !== 'junction') {
      knowns[`${comp.id}.value`] = comp.value;
    }
  }

  // 未知量：非地节点电压 + 各元件支路电流（接地元件无电流）
  const unknowns: string[] = [];
  for (const node of nodes) {
    if (!node.isGround) unknowns.push(`${node.id}.voltage`);
  }
  for (const comp of components) {
    if (comp.type === 'ground' || comp.type === 'junction') continue;
    unknowns.push(`${comp.id}.current`);
  }

  return {
    schemaVersion: '1.0',
    nodes,
    components: netComponents,
    knowns,
    unknowns,
  };
}