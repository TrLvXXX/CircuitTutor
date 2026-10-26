// =============================================================
// 右侧属性面板：修改选中元件的数值、标记已知量、旋转/删除；
// 选中导线时可删除导线。
// =============================================================
import { useCircuitStore } from '../store';

/** 把数值格式化为指定小数位，去掉末尾多余 0 */
function fmt(n: number, precision: number = 2): string {
  return Number.isFinite(n) ? n.toFixed(precision).replace(/\.?0+$/, '') || '0' : '—';
}

/** 元件类型的中文名 */
const TYPE_LABEL: Record<string, string> = {
  resistor: '电阻',
  voltage_source: '独立电压源',
  current_source: '独立电流源',
  vcvs: '压控电压源',
  vccs: '压控电流源',
  ccvs: '流控电压源',
  cccs: '流控电流源',
  opamp_ideal: '理想运放',
  switch: '开关',
  ground: '接地',
  junction: '连接点',
};

/** 不同类型数值的单位 */
const VALUE_UNIT: Record<string, string> = {
  resistor: 'Ω',
  voltage_source: 'V',
  current_source: 'A',
  vcvs: '倍',
  vccs: 'S',
  ccvs: 'Ω',
  cccs: '倍',
  opamp_ideal: '',
  switch: '',
  ground: '',
  junction: '',
};

export function PropertiesPanel() {
  const selection = useCircuitStore((s) => s.selection);
  const components = useCircuitStore((s) => s.components);
  const wires = useCircuitStore((s) => s.wires);
  const updateComponentValue = useCircuitStore((s) => s.updateComponentValue);
  const toggleUnknown = useCircuitStore((s) => s.toggleUnknown);
  const rotateComponent = useCircuitStore((s) => s.rotateComponent);
  const deleteSelection = useCircuitStore((s) => s.deleteSelection);
  const solveResult = useCircuitStore((s) => s.solveResult);
  const precision = useCircuitStore((s) => s.precision);
  const updateComponentParams = useCircuitStore((s) => s.updateComponentParams);
  const selectedComponents = useCircuitStore((s) => s.selectedComponents);
  const deleteSelectedComponents = useCircuitStore((s) => s.deleteSelectedComponents);

  if (!selection) {
    // 框选状态：显示框选个数与批量删除按钮
    if (selectedComponents.length > 0) {
      return (
        <aside className="panel panel-right">
          <h2 className="panel-title">框选零件</h2>
          <p className="panel-hint">
            已框选 {selectedComponents.length} 个零件
          </p>
          <button className="btn btn-danger" onClick={() => deleteSelectedComponents()}>
            批量删除
          </button>
        </aside>
      );
    }
    return (
      <aside className="panel panel-right">
        <h2 className="panel-title">属性</h2>
        <p className="panel-hint">未选中任何对象</p>
      </aside>
    );
  }

  // —— 选中导线 ——
  if (selection.kind === 'wire') {
    const wire = wires.find((w) => w.id === selection.id);
    if (!wire) return null;
    return (
      <aside className="panel panel-right">
        <h2 className="panel-title">导线属性</h2>
        <div className="field">
          <label>编号</label>
          <span className="value-readonly">{wire.id}</span>
        </div>
        <div className="field">
          <label>连接</label>
          <span className="value-readonly">
            {wire.from.componentId}·pin{wire.from.pinIndex} →{' '}
            {wire.to.componentId}·pin{wire.to.pinIndex}
          </span>
        </div>
        <button className="btn btn-danger" onClick={() => deleteSelection()}>
          删除导线
        </button>
      </aside>
    );
  }

  // —— 选中元件 ——
  const comp = components.find((c) => c.id === selection.id);
  if (!comp) return null;
  const isGround = comp.type === 'ground';

  return (
    <aside className="panel panel-right">
      <h2 className="panel-title">元件属性</h2>
      <div className="field">
        <label>编号</label>
        <span className="value-readonly">{comp.id}</span>
      </div>
      <div className="field">
        <label>类型</label>
        <span className="value-readonly">{TYPE_LABEL[comp.type] ?? comp.type}</span>
      </div>

      {!isGround && !!VALUE_UNIT[comp.type] && (
        <div className="field">
          <label>数值 ({VALUE_UNIT[comp.type]})</label>
          {comp.unknown ? (
            <span className="value-readonly value-unknown">?</span>
          ) : (
            <input
              type="number"
              value={comp.value}
              step="any"
              onChange={(e) => {
                const v = Number(e.target.value);
                // 非法输入（NaN）忽略，保留原值
                if (!Number.isNaN(v)) updateComponentValue(comp.id, v);
              }}
            />
          )}
        </div>
      )}

      {comp.type === 'switch' && (
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={!!comp.params?.closed}
            onChange={() => updateComponentParams(comp.id, { closed: !comp.params?.closed })}
          />
          开关闭合
        </label>
      )}

      {!isGround && comp.type !== 'switch' && comp.type !== 'junction' && (
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={comp.unknown}
            onChange={() => toggleUnknown(comp.id)}
          />
          标记为未知量
        </label>
      )}

      <div className="field">
        <label>旋转</label>
        <span className="value-readonly">{comp.rotation}°</span>
      </div>

      {/* —— 求解结果：选中元件的支路电流/功率 —— */}
      {solveResult && (
        <div className="field">
          <label>支路电流 (A)</label>
          <span className="value-readonly">
            {fmt(solveResult.branch_currents[comp.id] ?? 0, precision)}
          </span>
        </div>
      )}
      {solveResult && comp.type !== 'ground' && (
        <div className="field">
          <label>吸收功率 (W)</label>
          <span className="value-readonly">
            {fmt(solveResult.powers[comp.id] ?? 0, precision)}
          </span>
        </div>
      )}

      <div className="btn-row">
        <button className="btn" onClick={() => rotateComponent(comp.id)}>
          旋转 90°
        </button>
        <button className="btn btn-danger" onClick={() => deleteSelection()}>
          删除
        </button>
      </div>

      {/* —— 求解结果：全电路节点电压表 —— */}
      {solveResult && (
        <div className="solve-nodes">
          <h3 className="panel-subtitle">节点电压（对地）</h3>
          {Object.entries(solveResult.node_voltages).map(([id, v]) => (
            <div className="field" key={id}>
              <label>{id === solveResult.reference && solveResult.is_reference_ground ? `${id}（地）` : id}</label>
              <span className="value-readonly">{fmt(v, precision)} V</span>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}