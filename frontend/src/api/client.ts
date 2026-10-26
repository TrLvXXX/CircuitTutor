// =============================================================
// 后端求解服务客户端
// 职责：把画布网表 POST 到后端 /solve_dc，并把统一响应包裹
// {"ok","data","error"} 解包为前端易用的结果类型。
// 本模块不含任何求解逻辑，仅负责网络通信与错误归一化。
// =============================================================
import type { Netlist } from '../types';

/** 后端求解成功时的返回数据 */
export interface SolveResult {
  /** 各节点电压（对地），键为节点 id，如 n0、n1 */
  node_voltages: Record<string, number>;
  /** 各元件支路电流（正方向：pins[0] 流入元件） */
  branch_currents: Record<string, number>;
  /** 各元件吸收功率（吸收为正，单位 W） */
  powers: Record<string, number>;
  /** 未知量名称，顺序与矩阵下标一致 */
  unknowns: string[];
  /** 节点电压法方程的可读字符串 */
  equations: string[];
  /** 参考节点 id（兼容旧字段，等同 reference） */
  ground: string;
  /** 参考节点 id */
  reference: string;
  /** 参考节点是否为真实接地（false 表示无地时自动选取的参考点） */
  is_reference_ground: boolean;
  /** 组装出的 MNA 矩阵（调试/展示用） */
  matrix: { size: number; A: number[][]; b: number[] };
}

/** 后端业务错误（ok=false 或网络异常时抛出） */
export class SolveError extends Error {
  /** 机器可读错误码，如 NO_GROUND / SINGULAR_MATRIX */
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'SolveError';
    this.code = code;
  }
}

/** 后端统一响应包裹结构 */
interface Envelope<T> {
  ok: boolean;
  data: T | null;
  error: { code: string; message: string } | null;
}

/** 求解服务基地址，可通过 Vite 环境变量覆盖 */
const BASE_URL: string =
  (import.meta.env?.VITE_API_BASE as string | undefined) ??
  'http://127.0.0.1:8000';

/**
 * 调用后端求解直流工作点。
 * @param netlist 画布导出的网表（IR）
 * @returns 求解成功时的结果数据
 * @throws {SolveError} 后端返回业务错误或网络异常时
 */
export async function solveDc(netlist: Netlist): Promise<SolveResult> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/solve_dc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(netlist),
    });
  } catch {
    // 网络层失败通常意味着后端未启动
    throw new SolveError('NETWORK_ERROR', '无法连接求解服务，请确认后端已启动');
  }

  if (!res.ok) {
    throw new SolveError('HTTP_ERROR', `求解服务返回异常状态：HTTP ${res.status}`);
  }

  const envelope = (await res.json()) as Envelope<SolveResult>;
  if (!envelope.ok || !envelope.data) {
    throw new SolveError(
      envelope.error?.code ?? 'UNKNOWN',
      envelope.error?.message ?? '求解失败',
    );
  }
  return envelope.data;
}
/** 自动简化单步 */
export interface SimplifyStep {
  type: 'series' | 'parallel';
  title: string;
  detail: string;
  components: string[];
  merged_value: number;
  nodes: string[];
}

/** 自动简化结果 */
export interface SimplifyResult {
  steps: SimplifyStep[];
}

/** 戴维南等效结果 */
export interface TheveninResult {
  port: string[];
  vth: number;
  rth: number;
  description: string;
}

/** 通用 POST 请求封装，解包 {ok,data,error} 包裹 */
async function postJson<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new SolveError('NETWORK_ERROR', '无法连接求解服务，请确认后端已启动');
  }
  if (!res.ok) {
    throw new SolveError('HTTP_ERROR', `求解服务返回异常状态：HTTP ${res.status}`);
  }
  const envelope = (await res.json()) as Envelope<T>;
  if (!envelope.ok || !envelope.data) {
    throw new SolveError(
      envelope.error?.code ?? 'UNKNOWN',
      envelope.error?.message ?? '操作失败',
    );
  }
  return envelope.data;
}

/** 调用后端自动简化（串/并联识别） */
export async function simplifyCircuit(netlist: Netlist): Promise<SimplifyResult> {
  return postJson<SimplifyResult>('/simplify', netlist);
}

/** 调用后端计算戴维南等效参数 */
export async function thevenin(
  netlist: Netlist,
  portA: string,
  portB: string,
): Promise<TheveninResult> {
  return postJson<TheveninResult>('/thevenin', {
    netlist,
    port_a: portA,
    port_b: portB,
  });
}
/** 未知量反解结果 */
export interface SolveUnknownsResult {
  /** 已唯一确定的元件 id -> 参数值 */
  solved: Record<string, number>;
  /** 条件不足、无法唯一确定的元件 id */
  undetermined: string[];
  /** 是否全部未知量都已确定 */
  resolved: boolean;
  reference: string;
  is_reference_ground: boolean;
}

/** 用户提供的已知测量值 */
export interface Measurement {
  type: 'current' | 'voltage' | 'voltage_diff';
  value: number;
  /** voltage：节点 id */
  node_id?: string;
  /** current / voltage_diff：节点 A、节点 B（current 表示从 A 到 B 的电流） */
  node_a?: string;
  node_b?: string;
}

/** 调用后端反解标记为未知量的元件参数 */
export async function solveUnknowns(
  netlist: Netlist,
  measurements: Measurement[] = [],
): Promise<SolveUnknownsResult> {
  return postJson<SolveUnknownsResult>('/solve_unknowns', { netlist, measurements });
}