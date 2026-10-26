// =============================================================
// 应用根组件：三栏布局（元件库 / 画布 / 属性）+ 底部工具栏
// 工具栏提供：导出网表（求解用 IR）、保存/打开工程（继续编辑用）
// =============================================================
import { useEffect, useRef, useState } from 'react';
import { Canvas } from './components/Canvas';
import { ComponentPanel } from './components/ComponentPanel';
import { PropertiesPanel } from './components/PropertiesPanel';
import { VoltageColorMap } from './components/VoltageColorMap';
import { buildNetlist } from './netlist';
import { parseProject, serializeProject } from './project';
import { useCircuitStore } from './store';
import { simplifyCircuit } from './api/client';
import type { SimplifyResult, Measurement } from './api/client';

export default function App() {
  const components = useCircuitStore((s) => s.components);
  const wires = useCircuitStore((s) => s.wires);
  const viewport = useCircuitStore((s) => s.viewport);
  const wiringFrom = useCircuitStore((s) => s.wiringFrom);
  const deleteSelection = useCircuitStore((s) => s.deleteSelection);
  const cancelWire = useCircuitStore((s) => s.cancelWire);
  const loadProject = useCircuitStore((s) => s.loadProject);
  const solveCircuit = useCircuitStore((s) => s.solveCircuit);
  const solving = useCircuitStore((s) => s.solving);
  const solveResult = useCircuitStore((s) => s.solveResult);
  const solveError = useCircuitStore((s) => s.solveError);
  const precision = useCircuitStore((s) => s.precision);
  const setPrecision = useCircuitStore((s) => s.setPrecision);
  const highlightedComponents = useCircuitStore((s) => s.highlightedComponents);
  const setHighlightedComponents = useCircuitStore((s) => s.setHighlightedComponents);
  const selectedComponents = useCircuitStore((s) => s.selectedComponents);
  const deleteSelectedComponents = useCircuitStore((s) => s.deleteSelectedComponents);
  const tool = useCircuitStore((s) => s.tool);
  const setTool = useCircuitStore((s) => s.setTool);
  const measurements = useCircuitStore((s) => s.measurements);
  const addMeasurement = useCircuitStore((s) => s.addMeasurement);
  const removeMeasurement = useCircuitStore((s) => s.removeMeasurement);
  const theme = useCircuitStore((s) => s.theme);
  const toggleTheme = useCircuitStore((s) => s.toggleTheme);

  const [toast, setToast] = useState<string>('');
  const [toastError, setToastError] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** 清空画布按钮旁边的临时提示 */
  const [clearHint, setClearHint] = useState('');
  const clearHintTimerRef = useRef<number | undefined>(undefined);
  /** 求解结果抽屉是否展开 */
  const [showSolution, setShowSolution] = useState(false);
  /** 测量值输入表单状态 */
  const [mType, setMType] = useState<'current' | 'voltage' | 'voltage_diff'>('current');

  const [mNodeId, setMNodeId] = useState('');
  const [mNodeA, setMNodeA] = useState('');
  const [mNodeB, setMNodeB] = useState('');
  const [mValue, setMValue] = useState('');

  /** 自动简化结果 */
  const [simplifyResult, setSimplifyResult] = useState<SimplifyResult | null>(null);
  const [simplifying, setSimplifying] = useState(false);

  /** 显示一条 3 秒后自动消失的提示 */
  const showToast = (text: string, isError = false) => {
    setToast(text);
    setToastError(isError);
    window.setTimeout(() => setToast(''), 3000);
  };

  // —— 主题：把当前主题同步到 <html data-theme>，驱动 CSS 变量与画布配色 ——
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // —— 键盘快捷键：Delete 删除选中，Esc 取消连线 ——
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // 输入框内不响应快捷键
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (useCircuitStore.getState().selectedComponents.length > 0) {
          deleteSelectedComponents();
        } else {
          deleteSelection();
        }
      } else if (e.key === 'Escape') {
        cancelWire();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [deleteSelection, deleteSelectedComponents, cancelWire]);

  /** 触发浏览器下载的通用工具 */
  const downloadJson = (data: unknown, filename: string) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  /** 导出网表 JSON：求解使用的中间表示 */
  const handleExport = () => {
    const netlist = buildNetlist(components, wires);
    downloadJson(netlist, 'circuit-netlist.json');
    // 便于调试：同时打印到控制台
    console.log('[CircuitTutor] 导出网表：', netlist);
    showToast(`已导出网表：${netlist.nodes.length} 个节点，${netlist.components.length} 个元件`);
  };

  /** 保存工程文件：可继续编辑的画布状态 */
  const handleSaveProject = () => {
    downloadJson(serializeProject(components, wires, viewport), 'circuit-project.json');
    showToast(`已保存工程：${components.length} 个元件，${wires.length} 条导线`);
  };

  /** 打开工程文件：整体恢复画布 */
  const handleOpenProject = (e: React.ChangeEvent<HTMLInputElement>) => {    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const project = parseProject(String(reader.result));
        loadProject(project.components, project.wires, project.viewport);
        showToast(`已打开工程：${project.components.length} 个元件`);
      } catch (err) {
        showToast(`打开失败：${(err as Error).message}`, true);
      }
    };
    reader.readAsText(file);
    // 允许重复选择同一文件
    e.target.value = '';
  };

  /** 求解：调用后端求解直流工作点，并展开结果抽屉 */
  const handleSolve = async () => {
    setShowSolution(true);
    await solveCircuit();
  };

  const clearCanvas = useCircuitStore((s) => s.clearCanvas);

  /** 清空画布：移除全部元件与导线，并重置新建元件编号 */
  const handleClearCanvas = () => {
    if (components.length === 0 && wires.length === 0) return;
    clearCanvas();
    setClearHint('画布已清空');
    window.clearTimeout(clearHintTimerRef.current);
    clearHintTimerRef.current = window.setTimeout(() => setClearHint(''), 3000);
  };

  /** 自动简化：识别串/并联电阻 */
  const handleSimplify = async () => {
    if (components.length === 0) return;
    setSimplifying(true);
    try {
      const result = await simplifyCircuit(buildNetlist(components, wires));
      setSimplifyResult(result);
    } catch {
      setSimplifyResult(null);
    }
    setSimplifying(false);
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>CircuitTutor 电路编辑器</h1>
        <span className="app-subtitle">P0 基础元件 · 拖拽建模 · 导出网表</span>
        <button
          type="button"
          className="theme-toggle"
          onClick={toggleTheme}
          title="切换浅色 / 深色主题"
        >
          {theme === 'dark' ? '☀ 浅色' : '🌙 深色'}
        </button>
      </header>

      <div className="app-body">
        <ComponentPanel />
        <main className="canvas-wrap">
          <Canvas />
          {/* 画布工具条：选择/框选 与 手型拖拽 */}
          <div className="canvas-toolbar">
            <button
              type="button"
              className={`tool-btn${tool === 'select' ? ' tool-btn-active' : ''}`}
              onClick={() => setTool('select')}
              title="选择 / 框选"
            >
              ✥
            </button>
            <button
              type="button"
              className={`tool-btn${tool === 'pan' ? ' tool-btn-active' : ''}`}
              onClick={() => setTool('pan')}
              title="拖拽平移画布"
            >
              ✋
            </button>
          </div>
          {/* 交互提示层 */}
          <div className="canvas-hint">
            {wiringFrom
              ? '连线中：点击引脚完成连接 · 靠近导线可创建连接点 · Esc 取消'
              : '拖拽左侧元件到画布 · 点击引脚连线 · 连线时靠近导线可创建连接点 · 滚轮缩放'}
          </div>
          {/* 等电位配色图例 */}
          <div className="legend">
            <span className="legend-item">
              <i className="legend-dot" style={{ background: '#475569' }} />接地节点 n0
            </span>
            <span className="legend-item">
              <i className="legend-dot" style={{ background: '#2563eb' }} />
              <i className="legend-dot" style={{ background: '#dc2626' }} />
              <i className="legend-dot" style={{ background: '#16a34a' }} />
              同色引脚=等电位
            </span>
          </div>
          {/* 电势颜色图例：仅在有求解结果时显示，按节点电压着色 */}
          {solveResult && (
            <div className="voltage-legend-overlay">
              <VoltageColorMap nodeVoltages={solveResult.node_voltages} />
            </div>
          )}
        </main>
        <PropertiesPanel />
      </div>

      {/* 已知测量值面板：仅当存在未知量元件时显示 */}
      {components.some((c) => c.unknown) && (
        <section className="measurement-panel">
          <h2 className="panel-subtitle">已知测量值（辅助求解未知量）</h2>
          <div className="measurement-form">
            <select value={mType} onChange={(e) => setMType(e.target.value as 'current' | 'voltage' | 'voltage_diff')}>
              <option value="current">节点间电流</option>
              <option value="voltage">节点电势</option>
              <option value="voltage_diff">电势差</option>
            </select>
            {mType === 'current' && (
              <>
                <input
                  type="text"
                  placeholder="从节点 A（如 n1）"
                  value={mNodeA}
                  onChange={(e) => setMNodeA(e.target.value)}
                />
                <span>→</span>
                <input
                  type="text"
                  placeholder="到节点 B（如 n0）"
                  value={mNodeB}
                  onChange={(e) => setMNodeB(e.target.value)}
                />
              </>
            )}
            {mType === 'voltage' && (
              <input
                type="text"
                placeholder="节点 id（如 n1）"
                value={mNodeId}
                onChange={(e) => setMNodeId(e.target.value)}
              />
            )}
            {mType === 'voltage_diff' && (
              <>
                <input
                  type="text"
                  placeholder="节点 A"
                  value={mNodeA}
                  onChange={(e) => setMNodeA(e.target.value)}
                />
                <span>-</span>
                <input
                  type="text"
                  placeholder="节点 B"
                  value={mNodeB}
                  onChange={(e) => setMNodeB(e.target.value)}
                />
              </>
            )}
            <span>=</span>
            <input
              type="number"
              placeholder="数值"
              value={mValue}
              onChange={(e) => setMValue(e.target.value)}
            />
            <span>{mType === 'current' ? 'A' : 'V'}</span>
            <button
              className="btn"
              onClick={() => {
                const val = parseFloat(mValue);
                if (isNaN(val)) return;
                const m: Measurement = { type: mType, value: val };
                if (mType === 'current' && mNodeA && mNodeB) {
                  m.node_a = mNodeA;
                  m.node_b = mNodeB;
                }
                if (mType === 'voltage' && mNodeId) m.node_id = mNodeId;
                if (mType === 'voltage_diff' && mNodeA && mNodeB) {
                  m.node_a = mNodeA;
                  m.node_b = mNodeB;
                }
                addMeasurement(m);
                setMValue('');
              }}
            >
              添加
            </button>
          </div>
          {measurements.length > 0 && (
            <ul className="measurement-list">
              {measurements.map((m, i) => (
                <li key={i}>
                  <span>
                    {m.type === 'current' && `I(${m.node_a}→${m.node_b})`}
                    {m.type === 'voltage' && `V(${m.node_id})`}
                    {m.type === 'voltage_diff' && `V(${m.node_a})-V(${m.node_b})`}
                    {' = '}
                    {m.value}
                    {m.type === 'current' ? ' A' : ' V'}
                  </span>
                  <button className="btn btn-ghost" onClick={() => removeMeasurement(i)}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* 求解结果抽屉：展示节点电压法方程与错误信息 */}
      {showSolution && (
        <section className="solution-drawer">
          <div className="solution-head">
            <h2 className="panel-subtitle">
              求解结果{solveResult ? `（矩阵规模 ${solveResult.matrix.size}×${solveResult.matrix.size}）` : ''}
            </h2>
            <div className="solution-head-right">
              <label className="precision-select">
                精度
                <select value={precision} onChange={(e) => setPrecision(Number(e.target.value))}>
                  <option value={2}>2 位</option>
                  <option value={4}>4 位</option>
                  <option value={6}>6 位</option>
                </select>
              </label>
              <button className="btn btn-ghost" onClick={() => setShowSolution(false)}>
                收起
              </button>
            </div>
          </div>

          {solving && <p className="panel-hint">正在求解…</p>}

          {!solving && solveError && (
            <p className="solve-error">求解失败：{solveError}</p>
          )}

          {!solving && solveResult && (
            <>
              <h3 className="panel-subtitle">节点电压</h3>
              <ul className="solve-list">
                {Object.entries(solveResult.node_voltages).map(([id, v]) => (
                  <li key={id}>
                    <span>v({id}{id === solveResult.reference && solveResult.is_reference_ground ? '，地' : ''})</span>
                    <span>{v.toFixed(precision)} V</span>
                  </li>
                ))}
              </ul>

              <h3 className="panel-subtitle">支路电流 / 吸收功率</h3>
              <ul className="solve-list">
                {Object.entries(solveResult.branch_currents).map(([id, i]) => (
                  <li key={id}>
                    <span>i({id})</span>
                    <span>
                      {i.toFixed(precision)} A
                      {solveResult.powers[id] !== undefined
                        ? ` · ${solveResult.powers[id].toFixed(precision)} W`
                        : ''}
                    </span>
                  </li>
                ))}
              </ul>

              <h3 className="panel-subtitle">节点电压法方程</h3>
              <ol className="solve-equations">
                {solveResult.equations.map((eq, idx) => (
                  <li key={idx}>{eq}</li>
                ))}
              </ol>

              <div className="solution-head">
                <h3 className="panel-subtitle">自动简化</h3>
                <button className="btn" onClick={handleSimplify} disabled={simplifying}>
                  {simplifying ? '分析中…' : '识别串/并联'}
                </button>
              </div>
              {simplifyResult && (
                <ul className="simplify-steps">
                  {simplifyResult.steps.length === 0 && (
                    <li className="simplify-step">
                      <span className="simplify-step-detail">未发现可简化的串/并联结构</span>
                    </li>
                  )}
                  {simplifyResult.steps.map((step, idx) => {
                    const isActive =
                      highlightedComponents.length === step.components.length &&
                      step.components.every((id) => highlightedComponents.includes(id));
                    return (
                      <li
                        key={idx}
                        className={`simplify-step${isActive ? ' simplify-step-active' : ''}`}
                        onClick={() =>
                          setHighlightedComponents(isActive ? [] : step.components)
                        }
                      >
                        <div className="simplify-step-title">{step.title}</div>
                        <div className="simplify-step-detail">{step.detail}</div>
                        <div className="simplify-step-preview">
                          → 合并为 {step.merged_value.toFixed(precision)}Ω
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </section>
      )}

      <footer className="app-footer">
        <span className="stat">元件 {components.length}</span>
        <span className="stat">导线 {wires.length}</span>
        <button className="btn" onClick={handleSaveProject}>
          保存工程
        </button>
        <button className="btn" onClick={() => fileInputRef.current?.click()}>
          打开工程
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={handleOpenProject}
        />
        <button className="btn btn-primary" onClick={handleExport}>
          导出网表 JSON
        </button>
        <button className="btn btn-danger" onClick={handleClearCanvas}>
          清空画布
        </button>
        {clearHint && <span className="clear-hint">{clearHint}</span>}
        <button className="btn btn-solve" onClick={handleSolve} disabled={solving}>
          {solving ? '求解中…' : '求解电路'}
        </button>
        {toast && (
          <span className={toastError ? 'toast toast-error' : 'toast'}>{toast}</span>
        )}
      </footer>
    </div>
  );
}