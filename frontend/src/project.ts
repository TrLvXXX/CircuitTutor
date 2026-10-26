// =============================================================
// 工程文件的序列化与反序列化
// 工程文件保存画布状态（元件布局 + 导线连接 + 视口），
// 与导出网表（求解用的 IR）用途不同：前者用于继续编辑，后者用于求解。
// =============================================================
import type { CircuitComponent, Viewport, Wire } from './types';

/** 工程文件格式标识 */
export const PROJECT_FORMAT = 'circuittutor-project';

export interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  version: number;
  components: CircuitComponent[];
  wires: Wire[];
  viewport: Viewport;
}

/** 把当前画布状态序列化为工程文件对象 */
export function serializeProject(
  components: CircuitComponent[],
  wires: Wire[],
  viewport: Viewport,
): ProjectFile {
  return {
    format: PROJECT_FORMAT,
    version: 1,
    components,
    wires,
    viewport,
  };
}

/** 解析工程文件文本，格式不符时抛出中文错误 */
export function parseProject(text: string): ProjectFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('工程文件不是合法的 JSON');
  }

  const file = data as Partial<ProjectFile>;
  if (!file || file.format !== PROJECT_FORMAT) {
    throw new Error('不是 CircuitTutor 工程文件（format 字段不匹配）');
  }
  if (!Array.isArray(file.components) || !Array.isArray(file.wires)) {
    throw new Error('工程文件缺少 components 或 wires 字段');
  }

  return {
    format: PROJECT_FORMAT,
    version: file.version ?? 1,
    components: file.components,
    wires: file.wires,
    viewport: file.viewport ?? { x: 0, y: 0, zoom: 1 },
  };
}