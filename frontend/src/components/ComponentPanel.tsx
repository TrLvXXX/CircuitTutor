// =============================================================
// 左侧元件面板：列出可拖拽的元件，通过 HTML5 拖放向画布发起放置
// =============================================================
import type { ComponentType } from '../types';

interface PaletteItem {
  type: ComponentType;
  label: string;
  /** 拖拽数据使用 dataTransfer 的 MIME），画布读取后放置元件 */
  glyph: string;
}

/** 支持的元件（与后端 ComponentType 对齐） */
const PALETTE: PaletteItem[] = [
  { type: 'resistor', label: '电阻', glyph: '▭' },
  { type: 'voltage_source', label: '电压源', glyph: '⏻' },
  { type: 'current_source', label: '电流源', glyph: '↺' },
  { type: 'vcvs', label: '压控压源', glyph: '◇' },
  { type: 'vccs', label: '压控流源', glyph: '◇' },
  { type: 'ccvs', label: '流控压源', glyph: '◇' },
  { type: 'cccs', label: '流控流源', glyph: '◇' },
  { type: 'opamp_ideal', label: '理想运放', glyph: '▷' },
  { type: 'switch', label: '开关', glyph: '⇋' },
  { type: 'ground', label: '接地', glyph: '⏚' },
];

export function ComponentPanel() {
  /** 拖拽开始时写入元件类型，供画布 drop 读取 */
  const handleDragStart = (e: React.DragEvent, type: ComponentType) => {
    e.dataTransfer.setData('application/x-circuit-component', type);
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <aside className="panel panel-left">
      <h2 className="panel-title">元件库</h2>
      <p className="panel-hint">拖拽到画布放置</p>
      <div className="palette">
        {PALETTE.map((item) => (
          <div
            key={item.type}
            className="palette-item"
            draggable
            onDragStart={(e) => handleDragStart(e, item.type)}
          >
            <span className="palette-glyph">{item.glyph}</span>
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}