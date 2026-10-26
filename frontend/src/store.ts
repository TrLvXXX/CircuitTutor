// =============================================================
// Zustand 全局状态：画布元件、导线、视口、选中与连线状态
// 所有画布操作集中在此，UI 组件只读状态、派发 action。
// =============================================================
import { create } from 'zustand';
import type {
  CircuitComponent,
  ComponentType,
  Endpoint,
  Selection,
  Viewport,
  Wire,
  Point,
} from './types';
import { getPinPosition, pinKey, snap } from './utils/geometry';
import { computePotentials } from './potential';
import { buildNetlist } from './netlist';
import { solveDc, solveUnknowns, SolveError } from './api/client';
import type { SolveResult, Measurement } from './api/client';
import { loadStoredTheme, saveStoredTheme } from './theme';
import type { Theme } from './theme';

/** 元件 id 前缀，按类型区分 */
const ID_PREFIX: Record<ComponentType, string> = {
  resistor: 'R',
  voltage_source: 'V',
  current_source: 'I',
  vcvs: 'E',
  vccs: 'Gm',
  ccvs: 'H',
  cccs: 'F',
  opamp_ideal: 'A',
  switch: 'SW',
  ground: 'G',
  junction: 'J',
};

/** 新建元件的默认数值 */
const DEFAULT_VALUE: Record<ComponentType, number> = {
  resistor: 1, // 1Ω
  voltage_source: 5, // 5V
  current_source: 0.001, // 1mA
  vcvs: 2, // 增益 2 倍
  vccs: 0.001, // 跨导 1mS
  ccvs: 1000, // 跨阻 1kΩ
  cccs: 2, // 电流增益 2 倍
  opamp_ideal: 0, // 理想运放无数值
  switch: 0, // 开关无数值
  ground: 0, // 接地无数值
  junction: 0, // 连接点无数值
};

/** 每个元件类型的自增计数，用于生成不重复 id */
type Counters = Record<ComponentType, number>;

/** 画布工具模式：select=选择/框选，pan=拖拽平移 */
export type ToolMode = 'select' | 'pan';

interface CircuitState {
  components: CircuitComponent[];
  wires: Wire[];
  viewport: Viewport;
  selection: Selection | null;
  /** 当前工具：select=选择/框选，pan=手型拖拽平移画布 */
  tool: ToolMode;
  /** 连线进行中的起点引脚；为 null 表示当前未在连线 */
  wiringFrom: Endpoint | null;
  counters: Counters;
  /** 最近一次求解结果；未求解或求解失败为 null */
  solveResult: SolveResult | null;
  /** 正在请求后端求解 */
  solving: boolean;
  /** 最近一次求解的错误信息（中文）；无错误为 null */
  solveError: string | null;
  /** 求解结果显示精度（小数位数），默认 2 */
  precision: number;
  /** 简化步骤高亮的元件 id 集合（点击步骤时设置） */
  highlightedComponents: string[];
  /** 框选选中的元件 id 集合 */
  selectedComponents: string[];
  /** 用户提供的已知测量值列表（辅助未知量反解） */
  measurements: Measurement[];
  /** 当前界面主题（浅色 / 深色），持久化到 localStorage */
  theme: Theme;

  // —— 元件操作 ——
  addComponent: (type: ComponentType, x: number, y: number) => string;
  moveComponent: (id: string, x: number, y: number) => void;
  rotateComponent: (id: string) => void;
  deleteComponent: (id: string) => void;
  updateComponentValue: (id: string, value: number) => void;
  updateComponentParams: (id: string, params: Record<string, unknown>) => void;
  toggleUnknown: (id: string) => void;
  /** 在导线上创建连接点（junction），使其他导线可连到该位置；返回新元件 id */
  addJunction: (wireId: string, x: number, y: number) => string;

  // —— 导线操作 ——
  startWire: (endpoint: Endpoint) => void;
  completeWire: (endpoint: Endpoint) => void;
  cancelWire: () => void;
  deleteWire: (id: string) => void;
  /** 移动导线折点：index 越界时视为追加新折点 */
  setWireWaypoint: (wireId: string, index: number, point: Point) => void;

  // —— 可视与选中 ——
  setViewport: (viewport: Viewport) => void;
  select: (selection: Selection | null) => void;
  /** 切换当前画布工具 */
  setTool: (tool: ToolMode) => void;
  deleteSelection: () => void;

  // —— 工程文件 ——
  /** 载入工程：整体替换画布内容，并按现有 id 重建计数器避免冲突 */
  loadProject: (
    components: CircuitComponent[],
    wires: Wire[],
    viewport: Viewport,
  ) => void;
  /** 清空画布：移除全部元件与导线，并重置新建元件编号 */
  clearCanvas: () => void;

  // —— 求解 ——
  /** 把当前画布网表提交后端求解，并写入 solveResult / solveError */
  solveCircuit: () => Promise<void>;
  /** 清除求解结果与错误（画布结构变化时调用，避免展示过期数据） */
  clearSolve: () => void;
  /** 设置结果显示精度（小数位数） */
  setPrecision: (p: number) => void;
  /** 设置简化步骤高亮的元件 id 集合 */
  setHighlightedComponents: (ids: string[]) => void;
  /** 设置框选选中的元件 id 集合 */
  setSelectedComponents: (ids: string[]) => void;
  /** 批量删除框选中的元件及其关联导线 */
  deleteSelectedComponents: () => void;

  // —— 已知测量值（辅助未知量反解） ——
  /** 添加一条已知测量值 */
  addMeasurement: (m: Measurement) => void;
  /** 移除一条已知测量值 */
  removeMeasurement: (index: number) => void;
  /** 清空所有已知测量值 */
  clearMeasurements: () => void;

  // —— 主题 ——
  /** 设置界面主题（并持久化） */
  setTheme: (theme: Theme) => void;
  /** 在浅色 / 深色之间切换（并持久化） */
  toggleTheme: () => void;
}

/** 生成下一个元件 id 并推进计数 */
function nextComponentId(counters: Counters, type: ComponentType): { id: string; counters: Counters } {
  const next = (counters[type] ?? 0) + 1;
  return {
    id: `${ID_PREFIX[type]}${next}`,
    counters: { ...counters, [type]: next },
  };
}

/** 生成导线 id（全局自增序号，避免与元件 id 冲突） */
let wireSeq = 0;
function nextWireId(): string {
  wireSeq += 1;
  return `W${wireSeq}`;
}

export const useCircuitStore = create<CircuitState>((set, get) => ({
  components: [],
  wires: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  selection: null,
  tool: 'select',
  wiringFrom: null,
  counters: { resistor: 0, voltage_source: 0, current_source: 0, vcvs: 0, vccs: 0, ccvs: 0, cccs: 0, opamp_ideal: 0, switch: 0, ground: 0, junction: 0 },
  solveResult: null,
  solving: false,
  solveError: null,
  precision: 2,
  highlightedComponents: [],
  selectedComponents: [],
  measurements: [],
  theme: loadStoredTheme(),

  /** 在指定坐标放置一个新元件，坐标自动吸附网格 */
  addComponent: (type, x, y) => {
    const { id, counters } = nextComponentId(get().counters, type);
    const comp: CircuitComponent = {
      id,
      type,
      x: snap(x),
      y: snap(y),
      rotation: 0,
      value: DEFAULT_VALUE[type],
      unknown: false,
      params: type === 'switch' ? { closed: false } : undefined,
    };
    set((state) => ({
      components: [...state.components, comp],
      counters,
      selection: { kind: 'component', id },
      solveResult: null,
      solveError: null,
    }));
    return id;
  },

  /** 移动元件（坐标吸附网格）；连接关系存于导线端点，故不受影响 */
  moveComponent: (id, x, y) =>
    set((state) => ({
      components: state.components.map((c) =>
        c.id === id ? { ...c, x: snap(x), y: snap(y) } : c,
      ),
    })),

  /** 逆时针旋转 90 度 */
  rotateComponent: (id) =>
    set((state) => ({
      components: state.components.map((c) =>
        c.id === id ? { ...c, rotation: (c.rotation + 90) % 360 } : c,
      ),
    })),

  /** 删除元件及其关联的所有导线 */
  deleteComponent: (id) =>
    set((state) => ({
      components: state.components.filter((c) => c.id !== id),
      wires: state.wires.filter(
        (w) => w.from.componentId !== id && w.to.componentId !== id,
      ),
      selection: null,
      solveResult: null,
      solveError: null,
    })),

  updateComponentValue: (id, value) =>
    set((state) => ({
      components: state.components.map((c) =>
        c.id === id ? { ...c, value } : c,
      ),
      solveResult: null,
      solveError: null,
    })),

  updateComponentParams: (id, params) =>
    set((state) => ({
      components: state.components.map((c) =>
        c.id === id ? { ...c, params: { ...c.params, ...params } } : c,
      ),
      solveResult: null,
      solveError: null,
    })),

  toggleUnknown: (id) =>
    set((state) => ({
      components: state.components.map((c) =>
        c.id === id ? { ...c, unknown: !c.unknown } : c,
      ),
    })),

  /** 在导线上创建连接点（junction），使其他导线可连到该位置 */
  addJunction: (wireId, x, y) => {
    const { id, counters } = nextComponentId(get().counters, 'junction');
    const comp: CircuitComponent = {
      id,
      type: 'junction',
      x: snap(x),
      y: snap(y),
      rotation: 0,
      value: 0,
      unknown: false,
      params: { attachedWire: wireId },
    };
    set((state) => ({
      components: [...state.components, comp],
      counters,
      solveResult: null,
      solveError: null,
    }));
    return id;
  },

  /** 点击引脚：记录连线起点 */
  startWire: (endpoint) => set({ wiringFrom: endpoint }),

  /**
   * 点击第二个引脚：校验后生成导线。
   * 校验顺序：不能连自己 → 不能重复连线 → 两端已等电位则视为冗余。
   */
  completeWire: (endpoint) => {
    const { wiringFrom, wires, components } = get();
    if (!wiringFrom) return;

    const samePin =
      wiringFrom.componentId === endpoint.componentId &&
      wiringFrom.pinIndex === endpoint.pinIndex;
    if (samePin) {
      set({ wiringFrom: null });
      return;
    }

    const duplicated = wires.some((w) => {
      const f = w.from;
      const t = w.to;
      return (
        (f.componentId === wiringFrom.componentId &&
          f.pinIndex === wiringFrom.pinIndex &&
          t.componentId === endpoint.componentId &&
          t.pinIndex === endpoint.pinIndex) ||
        (f.componentId === endpoint.componentId &&
          f.pinIndex === endpoint.pinIndex &&
          t.componentId === wiringFrom.componentId &&
          t.pinIndex === wiringFrom.pinIndex)
      );
    });
    if (duplicated) {
      set({ wiringFrom: null });
      return;
    }

    // 等电位冗余检查：两端若已属于同一节点，再连导线不改变拓扑，直接忽略
    const potentials = computePotentials(components, wires);
    const nodeFrom = potentials.nodeOfPin.get(
      pinKey(wiringFrom.componentId, wiringFrom.pinIndex),
    );
    const nodeTo = potentials.nodeOfPin.get(
      pinKey(endpoint.componentId, endpoint.pinIndex),
    );
    if (nodeFrom && nodeTo && nodeFrom === nodeTo) {
      set({ wiringFrom: null });
      return;
    }

    const wire: Wire = {
      id: nextWireId(),
      from: wiringFrom,
      to: endpoint,
      waypoints: [],
    };
    set((state) => ({
      wires: [...state.wires, wire],
      wiringFrom: null,
      solveResult: null,
      solveError: null,
    }));
  },

  cancelWire: () => set({ wiringFrom: null }),

  deleteWire: (id) =>
    set((state) => ({
      wires: state.wires.filter((w) => w.id !== id),
      selection: null,
      solveResult: null,
      solveError: null,
    })),

  setWireWaypoint: (wireId, index, point) =>
    set((state) => ({
      wires: state.wires.map((w) => {
        if (w.id !== wireId) return w;
        const waypoints = [...w.waypoints];
        if (index >= waypoints.length) {
          waypoints.push({ x: snap(point.x), y: snap(point.y) });
        } else {
          waypoints[index] = { x: snap(point.x), y: snap(point.y) };
        }
        return { ...w, waypoints };
      }),
    })),

  setViewport: (viewport) => set({ viewport }),

  select: (selection) => set({ selection }),

  setTool: (tool) => set({ tool }),

  setHighlightedComponents: (ids) => set({ highlightedComponents: ids }),

  setSelectedComponents: (ids) => set({ selectedComponents: ids }),

  deleteSelectedComponents: () => {
    const ids = get().selectedComponents;
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    set({
      components: get().components.filter((c) => !idSet.has(c.id)),
      wires: get().wires.filter(
        (w) => !idSet.has(w.from.componentId) && !idSet.has(w.to.componentId),
      ),
      selectedComponents: [],
      selection: null,
      solveResult: null,
      solveError: null,
    });
  },

  /** 删除当前选中的元件或导线（供 Delete 键调用） */
  deleteSelection: () => {
    const sel = get().selection;
    if (!sel) return;
    if (sel.kind === 'component') get().deleteComponent(sel.id);
    else get().deleteWire(sel.id);
  },

  /** 载入工程：替换画布内容，并依据现有 id 重建计数器，避免新建元件 id 冲突 */
  loadProject: (components, wires, viewport) => {
    const counters: Counters = {
      resistor: 0,
      voltage_source: 0,
      current_source: 0,
      vcvs: 0,
      vccs: 0,
      ccvs: 0,
      cccs: 0,
      opamp_ideal: 0,
      switch: 0,
      ground: 0,
      junction: 0,
    };
    for (const comp of components) {
      const prefix = ID_PREFIX[comp.type];
      const matched = new RegExp(`^${prefix}(\\d+)$`).exec(comp.id);
      if (matched) {
        counters[comp.type] = Math.max(counters[comp.type], Number(matched[1]));
      }
    }

    // 同步导线序号，保证后续新建导线 id 不重复
    let maxWireSeq = 0;
    for (const wire of wires) {
      const matched = /^W(\d+)$/.exec(wire.id);
      if (matched) maxWireSeq = Math.max(maxWireSeq, Number(matched[1]));
    }
    wireSeq = maxWireSeq;

    set({
      components,
      wires,
      viewport,
      counters,
      selection: null,
      wiringFrom: null,
      solveResult: null,
      solveError: null,
    });
  },

  /** 清空画布：移除全部元件与导线，并重置新建元件编号（counters 与导线序号） */
  clearCanvas: () => {
    wireSeq = 0;
    set({
      components: [],
      wires: [],
      selection: null,
      selectedComponents: [],
      highlightedComponents: [],
      wiringFrom: null,
      counters: {
        resistor: 0,
        voltage_source: 0,
        current_source: 0,
        vcvs: 0,
        vccs: 0,
        ccvs: 0,
        cccs: 0,
        opamp_ideal: 0,
        switch: 0,
        ground: 0,
        junction: 0,
      },
      solveResult: null,
      solveError: null,
      measurements: [],
    });
  },

  /**
   * 求解当前电路：构建网表 → 调用后端 → 写入结果或错误。
   * 求解失败不抛出，统一收敛到 solveError，便于 UI 展示与提示。
   */
  solveCircuit: async () => {
    const { components, wires } = get();
    if (components.length === 0) {
      set({ solveError: '画布为空，请先放置元件', solveResult: null });
      return;
    }
    set({ solving: true, solveError: null });

    // 存在未知量：先反解未知元件参数，成功后再做数值求解
    const hasUnknown = components.some((c) => c.unknown);
    if (hasUnknown) {
      try {
        const ures = await solveUnknowns(buildNetlist(components, wires), get().measurements);
        if (!ures.resolved) {
          const names = ures.undetermined.join('、');
          set({
            solving: false,
            solveResult: null,
            solveError: `已知条件不足，无法计算：${names}`,
          });
          return;
        }
        // 把解出的参数写回元件并清除未知标记
        set((state) => ({
          components: state.components.map((c) =>
            ures.solved[c.id] !== undefined
              ? { ...c, value: ures.solved[c.id], unknown: false }
              : c,
          ),
        }));
        const updated = get().components;
        const result = await solveDc(buildNetlist(updated, wires));
        set({ solveResult: result, solveError: null, solving: false });
      } catch (err) {
        const message =
          err instanceof SolveError ? err.message : '未知量求解失败，请稍后重试';
        set({ solveResult: null, solveError: message, solving: false });
      }
      return;
    }

    try {
      const result = await solveDc(buildNetlist(components, wires));
      set({ solveResult: result, solveError: null, solving: false });
    } catch (err) {
      const message =
        err instanceof SolveError ? err.message : '求解失败，请稍后重试';
      set({ solveResult: null, solveError: message, solving: false });
    }
  },

  clearSolve: () => set({ solveResult: null, solveError: null }),

  setPrecision: (p) => set({ precision: Math.max(0, Math.min(8, p)) }),

  addMeasurement: (m) => set((s) => ({ measurements: [...s.measurements, m] })),

  removeMeasurement: (index) =>
    set((s) => ({
      measurements: s.measurements.filter((_, i) => i !== index),
    })),

  clearMeasurements: () => set({ measurements: [] }),

  setTheme: (theme) => {
    saveStoredTheme(theme);
    set({ theme });
  },

  toggleTheme: () => {
    const theme: Theme = get().theme === 'dark' ? 'light' : 'dark';
    saveStoredTheme(theme);
    set({ theme });
  },
}));

/** 便捷派生：计算导线两个端点引脚的当前坐标（供渲染使用） */
export function resolveWireEndpoints(
  wire: Wire,
  components: CircuitComponent[],
): { from: Point; to: Point } | null {
  const fromComp = components.find((c) => c.id === wire.from.componentId);
  const toComp = components.find((c) => c.id === wire.to.componentId);
  if (!fromComp || !toComp) return null;
  return {
    from: getPinPosition(fromComp, wire.from.pinIndex),
    to: getPinPosition(toComp, wire.to.pinIndex),
  };
}