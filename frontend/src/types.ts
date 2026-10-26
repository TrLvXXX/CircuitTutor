// =============================================================
// CircuitTutor 前端数据模型定义
// 画布内只保存“拓扑 + 布局”，电气连接关系由导线端点（Endpoint）承载，
// 节点编号等电气语义在 netlist.ts 中派生计算，避免状态冗余。
// =============================================================

/** 二维坐标点 */
export interface Point {
  x: number;
  y: number;
}

/** 支持的元件类型（与后端 ComponentType 对齐） */
export type ComponentType =
  | 'resistor'
  | 'voltage_source'
  | 'current_source'
  | 'vcvs'
  | 'vccs'
  | 'ccvs'
  | 'cccs'
  | 'opamp_ideal'
  | 'switch'
  | 'ground'
  | 'junction';

/** 画布上的一个元件实例 */
export interface CircuitComponent {
  /** 元件唯一 id，如 R1、V1 */
  id: string;
  /** 元件类型 */
  type: ComponentType;
  /** 元件中心点的画布坐标（通常已网格吸附） */
  x: number;
  y: number;
  /** 旋转角度（度），取值 0 / 90 / 180 / 270 */
  rotation: number;
  /** 元件数值：电阻 Ω、电压源 V、电流源 A；接地忽略 */
  value: number;
  /** 是否被用户标记为未知量（勾选后该元件的数值待求） */
  unknown: boolean;
  /** 附加参数（如开关 {"closed": true}、受控源增益等） */
  params?: Record<string, unknown>;
}

/**
 * 导线端点：通过“元件 id + 引脚序号”引用一个引脚。
 * 关键设计：端点不保存坐标，因此移动元件时连接关系天然保持不变。
 */
export interface Endpoint {
  componentId: string;
  pinIndex: number;
}

/** 画布上的一条导线 */
export interface Wire {
  id: string;
  /** 起点引脚 */
  from: Endpoint;
  /** 终点引脚 */
  to: Endpoint;
  /** 可选折点（拖拽导线中段时生成），仅影响走线路径，不影响电气连接 */
  waypoints: Point[];
}

/** 视口：平移量与缩放比 */
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/** 当前选中对象 */
export interface Selection {
  kind: 'component' | 'wire';
  id: string;
}

/** 导出网表 JSON 中单个节点 */
export interface NetlistNode {
  id: string;
  x: number;
  y: number;
  isGround?: boolean;
}

/** 导出网表 JSON 中单个元件 */
export interface NetlistComponent {
  id: string;
  type: ComponentType;
  /** 元件各引脚所属的节点 id，顺序与几何引脚顺序一致 */
  pins: string[];
  value: number;
  /** 附加参数（如开关 {"closed": true}） */
  params?: Record<string, unknown>;
}

/** 导出网表 JSON（对齐系统提示词约定的唯一中间表示 IR） */
export interface Netlist {
  schemaVersion: string;
  nodes: NetlistNode[];
  components: NetlistComponent[];
  knowns: Record<string, number>;
  unknowns: string[];
}