// =============================================================
// 等效点位提示：拖动导线端点（折点）时，实时判断「候选连接点」是否
// 与电路上某个等电位节点重合（即落到已存在的节点上）。
//
// 架构约定：等电位判定必须单一来源，本模块复用 topology.ts 的
// analyzeTopology（Union-Find），绝不新建第二套连通性判定逻辑。
// 本模块只做「把候选点几何位置映射到既有节点」这一件事。
// =============================================================
import type { CircuitComponent, Point, Wire } from './types';
import { analyzeTopology } from './topology';

/** 判定候选点命中节点时的距离阈值（世界坐标单位，且随缩放无关） */
export const HIT_RADIUS = 14;

/** 候选连接点的判定结果 */
export interface EquivalenceHit {
  /** 命中的节点 id（n0、n1 …） */
  nodeId: string;
  /** 该节点是否为接地（或已连到地） */
  isGround: boolean;
  /** 该节点包含的引脚键数量（用于提示文案） */
  pinCount: number;
  /** 该节点的代表坐标（用于把候选点吸附过去） */
  point: Point;
  /** 命中点到节点中心的距离 */
  distance: number;
}

/**
 * 判断一个候选坐标是否与某个已有节点等电位（即落在节点引脚附近）。
 *
 * @param candidate 候选连接点的世界坐标
 * @param components 画布元件
 * @param wires 画布导线
 * @param excludePinKeys 需要排除的引脚键（例如正在拖动的导线自身两端点，
 *        避免把「拖到自己的端点」误判为等效）
 * @returns 命中信息；未命中任何节点时返回 null
 */
export function findEquivalentNode(
  candidate: Point,
  components: CircuitComponent[],
  wires: Wire[],
  excludePinKeys: Set<string> = new Set(),
): EquivalenceHit | null {
  const topo = analyzeTopology(components, wires);

  let best: EquivalenceHit | null = null;
  for (const [pinKey, nodeId] of topo.nodeOfPin) {
    if (excludePinKeys.has(pinKey)) continue;
    const nodePoint = topo.pointOfNode.get(nodeId);
    if (!nodePoint) continue;

    const distance = Math.hypot(nodePoint.x - candidate.x, nodePoint.y - candidate.y);
    if (distance > HIT_RADIUS) continue;
    if (best && distance >= best.distance) continue;

    best = {
      nodeId,
      isGround: nodeId === 'n0' && topo.hasGround,
      pinCount: (topo.pinsOfNode.get(nodeId) ?? []).length,
      point: nodePoint,
      distance,
    };
  }

  return best;
}

/**
 * 生成等效电位提示文案。
 * @param hit 命中信息
 * @param sameAsOtherEnd 候选点是否与「另一端」属于同一节点（此时连接无意义）
 */
export function equivalenceMessage(
  hit: EquivalenceHit,
  sameAsOtherEnd = false,
): string {
  const groundTag = hit.isGround ? '（地）' : '';
  if (sameAsOtherEnd) {
    return `节点 ${hit.nodeId}${groundTag}：两端已同电位，无需连接`;
  }
  return `节点 ${hit.nodeId}${groundTag}：等效电位点，可连接（${hit.pinCount} 个引脚）`;
}