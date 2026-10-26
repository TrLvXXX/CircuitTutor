// =============================================================
// 拓扑分析：把画布的「元件 + 导线」解析为等电位节点分组。
// 这是网表转换与界面等电位提示共用的唯一判定入口，保证
// 「导出的节点编号」与「画布上看到的等电位颜色」完全一致。
// =============================================================
import type { CircuitComponent, Point, Wire } from './types';
import { getPinOffsets, getPinPosition, pinKey } from './utils/geometry';
import { UnionFind } from './utils/unionFind';

/** 单个端子（元件的一个引脚） */
export interface Terminal {
  /** 形如 "R1:0" 的稳定键 */
  key: string;
  componentId: string;
  pinIndex: number;
  /** 引脚当前的绝对坐标 */
  point: Point;
}

/** 拓扑分析结果 */
export interface Topology {
  terminals: Terminal[];
  /** 引脚键 -> 节点 id（n0、n1 …） */
  nodeOfPin: Map<string, string>;
  /** 节点 id -> 该节点包含的引脚键列表 */
  pinsOfNode: Map<string, string[]>;
  /** 节点 id -> 节点代表坐标（组内端子平均） */
  pointOfNode: Map<string, Point>;
  /** 是否存在接地节点 */
  hasGround: boolean;
}

/** 节点 id 排序：n0、n1、n2 …（非数字兜底字典序） */
export function compareNodeId(a: string, b: string): number {
  const na = Number(a.replace(/^n/, ''));
  const nb = Number(b.replace(/^n/, ''));
  if (Number.isNaN(na) || Number.isNaN(nb)) return a.localeCompare(b);
  return na - nb;
}

/**
 * 分析电路拓扑：注册端子 → 用导线合并 → 分配节点编号。
 * 编号规则：接地端子所在分量固定为 n0；无接地时同样从 n0 开始编号。
 */
export function analyzeTopology(
  components: CircuitComponent[],
  wires: Wire[],
): Topology {
  const uf = new UnionFind();
  const terminals: Terminal[] = [];

  // 1) 注册所有端子
  for (const comp of components) {
    const offsets = getPinOffsets(comp.type);
    offsets.forEach((_, pinIndex) => {
      const key = pinKey(comp.id, pinIndex);
      uf.add(key);
      terminals.push({
        key,
        componentId: comp.id,
        pinIndex,
        point: getPinPosition(comp, pinIndex),
      });
    });
  }

  // 2) 导线两端端子合并（防御性校验：键不存在则跳过）
  for (const wire of wires) {
    const a = pinKey(wire.from.componentId, wire.from.pinIndex);
    const b = pinKey(wire.to.componentId, wire.to.pinIndex);
    if (uf.has(a) && uf.has(b)) uf.union(a, b);
  }

  // 2.5) junction 引脚与附着导线节点合并
  for (const comp of components) {
    if (comp.type === 'junction' && comp.params?.attachedWire) {
      const jKey = pinKey(comp.id, 0);
      const wire = wires.find((w) => w.id === comp.params!.attachedWire);
      if (wire && uf.has(jKey)) {
        const wKey = pinKey(wire.from.componentId, wire.from.pinIndex);
        if (uf.has(wKey)) uf.union(jKey, wKey);
      }
    }
  }

  // 3) 分配节点 id
  const rootToNodeId = new Map<string, string>();
  const groundComp = components.find((c) => c.type === 'ground');
  const hasGround = !!groundComp && uf.has(pinKey(groundComp.id, 0));
  if (hasGround && groundComp) {
    rootToNodeId.set(uf.find(pinKey(groundComp.id, 0)), 'n0');
  }

  const usedNodeIds = new Set<string>(rootToNodeId.values());
  let seq = 0;
  for (const term of terminals) {
    const root = uf.find(term.key);
    if (rootToNodeId.has(root)) continue;
    let id = `n${seq++}`;
    while (usedNodeIds.has(id)) id = `n${seq++}`;
    usedNodeIds.add(id);
    rootToNodeId.set(root, id);
  }

  // 4) 汇总每个节点的引脚与代表坐标
  const nodeOfPin = new Map<string, string>();
  const pinsOfNode = new Map<string, string[]>();
  const pointsOfNode = new Map<string, Point[]>();
  for (const term of terminals) {
    const nodeId = rootToNodeId.get(uf.find(term.key))!;
    nodeOfPin.set(term.key, nodeId);

    const pins = pinsOfNode.get(nodeId) ?? [];
    pins.push(term.key);
    pinsOfNode.set(nodeId, pins);

    const pts = pointsOfNode.get(nodeId) ?? [];
    pts.push(term.point);
    pointsOfNode.set(nodeId, pts);
  }

  const pointOfNode = new Map<string, Point>();
  for (const [nodeId, pts] of pointsOfNode) {
    const sum = pts.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), {
      x: 0,
      y: 0,
    });
    pointOfNode.set(nodeId, {
      x: Math.round(sum.x / pts.length),
      y: Math.round(sum.y / pts.length),
    });
  }

  return { terminals, nodeOfPin, pinsOfNode, pointOfNode, hasGround };
}