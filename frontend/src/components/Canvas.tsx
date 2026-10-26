// =============================================================
// 画布：SVG 渲染 + 缩放/平移 + 元件拖放与拖动 + 引脚连线 + 导线编辑
// 交互增强：
//   · 连线橡皮筋预览（起点引脚 → 鼠标位置，可吸附到目标引脚）
//   · 等电位引脚同色显示，悬停时同电位引脚联动高亮
//   · 悬停/连线时的等电位节点提示
//   · 拖动元件时的引脚磁吸对齐
// 坐标系统：世界坐标（画布逻辑坐标）经 viewport 变换映射到屏幕坐标。
// =============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType, Point, Wire } from '../types';
import { GRID, getPinOffsets, getPinPosition, pinKey, pathMidpointAndTangent } from '../utils/geometry';
import { snapToNearestPin } from '../utils/snap';
import { resolveWireEndpoints, useCircuitStore } from '../store';
import { computePotentials } from '../potential';
import { equivalenceMessage, findEquivalentNode } from '../equivalence';
import type { EquivalenceHit } from '../equivalence';
import { buildVoltageColorMap } from '../voltageColor';
import { computeWireCurrents } from '../currentFlow';
import { findWireSnap } from '../wireSnap';
import type { WireSnapTarget } from '../wireSnap';
import { canvasColors } from '../theme';
import { Symbol } from './Symbol';

/** 当前拖拽行为的描述 */
type DragState =
  | { kind: 'pan'; startX: number; startY: number; vx: number; vy: number }
  | { kind: 'component'; id: string; offsetX: number; offsetY: number }
  | { kind: 'waypoint'; wireId: string; index: number }
  | { kind: 'boxSelect'; startWorld: Point }
  | null;

/** 悬停中的引脚 */
interface HoveredPin {
  componentId: string;
  pinIndex: number;
}

/** 网格背景的绘制范围（世界坐标，足够大即可） */
const GRID_EXTENT = 6000;


export function Canvas() {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState>(null);

  const components = useCircuitStore((s) => s.components);
  const wires = useCircuitStore((s) => s.wires);
  const viewport = useCircuitStore((s) => s.viewport);
  const selection = useCircuitStore((s) => s.selection);
  const wiringFrom = useCircuitStore((s) => s.wiringFrom);
  const highlightedComponents = useCircuitStore((s) => s.highlightedComponents);
  const selectedComponents = useCircuitStore((s) => s.selectedComponents);
  const precision = useCircuitStore((s) => s.precision);
  const tool = useCircuitStore((s) => s.tool);
  const theme = useCircuitStore((s) => s.theme);
  /** 当前主题下的画布配色（网格 / 导线 / 元件等 SVG 内联颜色） */
  const cc = canvasColors(theme);

  /** 悬停引脚与鼠标世界坐标（用于橡皮筋与等电位提示） */
  const [hoveredPin, setHoveredPin] = useState<HoveredPin | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  /** 框选矩形（世界坐标），null 表示未在框选 */
  const boxSelectRef = useRef<{ start: Point; end: Point } | null>(null);
  const [boxSelectRect, setBoxSelectRect] = useState<{ start: Point; end: Point } | null>(null);
  /** 连线时吸附到的导线目标（折点或线段任意点，世界坐标），用于生成连接点 */
  const wireSnapRef = useRef<WireSnapTarget | null>(null);
  const [wireSnap, setWireSnap] = useState<WireSnapTarget | null>(null);
  /** 拖动元件时命中的吸附目标引脚键 */
  const [snapTarget, setSnapTarget] = useState<string | null>(null);
  /** 拖动导线折点时命中的等效节点（用于高亮与提示） */
  const [equivHit, setEquivHit] = useState<EquivalenceHit | null>(null);
  /** 拖动折点时的实时坐标（用于渲染候选点） */
  const [dragPoint, setDragPoint] = useState<Point | null>(null);
  /** 正在拖动折点的导线 id（用于判断候选点是否与该导线本节点同电位） */
  const [dragWireId, setDragWireId] = useState<string | null>(null);

  /** 等电位分组与配色：随元件/导线变化实时重算 */
  const potentials = useMemo(
    () => computePotentials(components, wires),
    [components, wires],
  );

  /** 求解后的节点电压（无求解结果时为空，用于电势着色） */
  const solveResult = useCircuitStore((s) => s.solveResult);
  /** 节点电压 → 颜色映射（分位数）；无求解结果时为 null */
  const voltageColors = useMemo(
    () =>
      solveResult ? buildVoltageColorMap(solveResult.node_voltages) : null,
    [solveResult],
  );
  /** 节点 id -> 颜色（电势着色优先于等电位调色板） */
  const solvedColorOfNode = voltageColors?.colorOfNode;

  /** 求解后每条导线的电流方向与幅值（用于流线动画） */
  const wireCurrents = useMemo(
    () => (solveResult ? computeWireCurrents(components, wires, solveResult) : []),
    [solveResult, components, wires],
  );

  // —— 屏幕坐标 → 世界坐标 ——
  const toWorld = useCallback((clientX: number, clientY: number): Point => {
    const svg = svgRef.current;
    const vp = useCircuitStore.getState().viewport;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: (clientX - rect.left - vp.x) / vp.zoom,
      y: (clientY - rect.top - vp.y) / vp.zoom,
    };
  }, []);

  // —— 全局指针事件：橡皮筋跟随 + 平移/拖动元件/拖动折点 ——
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const state = useCircuitStore.getState();
      // 连线中：记录鼠标世界坐标，并检测是否靠近导线（折点/线段）以便吸附
      if (state.wiringFrom) {
        const world = toWorld(e.clientX, e.clientY);
        setCursor(world);
        const snap = findWireSnap(world, state.wires, state.components, state.viewport.zoom);
        wireSnapRef.current = snap;
        setWireSnap(snap);
      }

      const drag = dragRef.current;
      if (!drag) return;
      const vp = state.viewport;
      if (drag.kind === 'pan') {
        state.setViewport({
          x: drag.vx + (e.clientX - drag.startX),
          y: drag.vy + (e.clientY - drag.startY),
          zoom: vp.zoom,
        });
      } else if (drag.kind === 'component') {
        const world = toWorld(e.clientX, e.clientY);
        const rawX = world.x - drag.offsetX;
        const rawY = world.y - drag.offsetY;
        // 引脚磁吸：靠近其他元件引脚时自动对齐
        const moving = state.components.find((c) => c.id === drag.id);
        const snapped = moving
          ? snapToNearestPin(
              moving.type,
              moving.rotation,
              rawX,
              rawY,
              state.components,
              drag.id,
            )
          : null;
        setSnapTarget(snapped ? snapped.targetKey : null);
        state.moveComponent(
          drag.id,
          snapped ? snapped.x : rawX,
          snapped ? snapped.y : rawY,
        );
      } else if (drag.kind === 'waypoint') {
        const world = toWorld(e.clientX, e.clientY);
        // 等效点位实时判定：候选折点是否落到既有节点上。
        // 排除该导线自身的两个端点引脚，避免把「拖到自己端点」误判为等效。
        const wire = state.wires.find((w) => w.id === drag.wireId);
        const exclude = new Set<string>(
          wire
            ? [
                pinKey(wire.from.componentId, wire.from.pinIndex),
                pinKey(wire.to.componentId, wire.to.pinIndex),
              ]
            : [],
        );
        const hit = findEquivalentNode(
          world,
          state.components,
          state.wires,
          exclude,
        );
        setEquivHit(hit);
        setDragPoint(world);
        // 命中等效节点时把折点吸附到节点中心，便于精确连接
        state.setWireWaypoint(
          drag.wireId,
          drag.index,
          hit ? hit.point : world,
        );
      } else if (drag.kind === 'boxSelect') {
        const end = toWorld(e.clientX, e.clientY);
        if (boxSelectRef.current) {
          boxSelectRef.current.end = end;
          setBoxSelectRect({ ...boxSelectRef.current });
        }
      }
    };
    const onUp = () => {
      const drag = dragRef.current;
      if (drag?.kind === 'boxSelect' && boxSelectRef.current) {
        const { start, end } = boxSelectRef.current;
        const x1 = Math.min(start.x, end.x);
        const x2 = Math.max(start.x, end.x);
        const y1 = Math.min(start.y, end.y);
        const y2 = Math.max(start.y, end.y);
        const comps = useCircuitStore.getState().components;
        const ids = comps
          .filter((c) => c.x >= x1 && c.x <= x2 && c.y >= y1 && c.y <= y2)
          .map((c) => c.id);
        useCircuitStore.getState().setSelectedComponents(ids);
      }
      boxSelectRef.current = null;
      setBoxSelectRect(null);
      dragRef.current = null;
      wireSnapRef.current = null;
      setWireSnap(null);
      setSnapTarget(null);
      setEquivHit(null);
      setDragPoint(null);
      setDragWireId(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [toWorld]);

  // —— 滚轮缩放：以鼠标位置为锚点 ——
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { viewport: vp, setViewport } = useCircuitStore.getState();
      const rect = svg.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const zoom = Math.min(3, Math.max(0.2, vp.zoom * factor));
      // 保持鼠标下的世界点位置不变
      const wx = (mx - vp.x) / vp.zoom;
      const wy = (my - vp.y) / vp.zoom;
      setViewport({ x: mx - wx * zoom, y: my - wy * zoom, zoom });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  // —— 等电位派生数据 ——
  /** 悬停引脚所属节点 id */
  const hoveredNode = hoveredPin
    ? potentials.nodeOfPin.get(pinKey(hoveredPin.componentId, hoveredPin.pinIndex))
    : undefined;
  /** 需要高亮的引脚键：等电位联动 + 磁吸目标 */
  const highlightKeys = new Set<string>();
  if (hoveredNode) {
    for (const key of potentials.pinsOfNode.get(hoveredNode) ?? []) {
      highlightKeys.add(key);
    }
  }
  if (snapTarget) highlightKeys.add(snapTarget);
  /** 悬停引脚的绝对坐标 */
  const hoveredPoint = hoveredPin
    ? (() => {
        const comp = components.find((c) => c.id === hoveredPin.componentId);
        return comp ? getPinPosition(comp, hoveredPin.pinIndex) : null;
      })()
    : null;
  /** 起点引脚坐标（橡皮筋起点） */
  const wiringStart = wiringFrom
    ? (() => {
        const comp = components.find((c) => c.id === wiringFrom.componentId);
        return comp ? getPinPosition(comp, wiringFrom.pinIndex) : null;
      })()
    : null;
  /** 连线中若目标引脚与起点已等电位，则视为冗余连接 */
  const wiringToSameNode = Boolean(
    wiringFrom &&
      hoveredPin &&
      hoveredNode &&
      hoveredNode ===
        potentials.nodeOfPin.get(
          pinKey(wiringFrom.componentId, wiringFrom.pinIndex),
        ),
  );

  /** 连线中点击（背景或其他导线）：吸附到导线则创建连接点并完成连线，否则取消连线 */
  const handleWiringClick = () => {
    const state = useCircuitStore.getState();
    state.select(null);
    const snap = wireSnapRef.current;
    if (snap) {
      const jid = state.addJunction(snap.wireId, snap.point.x, snap.point.y);
      state.completeWire({ componentId: jid, pinIndex: 0 });
    } else {
      state.cancelWire();
    }
    wireSnapRef.current = null;
    setWireSnap(null);
  };

  /** 背景按下：手型工具或中/右键→平移；选择工具左键→框选 */
  const handleBackgroundPointerDown = (e: React.PointerEvent) => {
    const state = useCircuitStore.getState();
    const vp = state.viewport;
    state.select(null);
    // 连线中点击背景：吸附到导线则创建连接点并完成连线，否则取消连线
    if (state.wiringFrom) {
      handleWiringClick();
      return;
    }
    const wantPan = state.tool === 'pan' || e.button !== 0;
    if (!wantPan) {
      // 选择工具左键：框选
      const world = toWorld(e.clientX, e.clientY);
      boxSelectRef.current = { start: world, end: world };
      setBoxSelectRect({ start: world, end: world });
      state.setSelectedComponents([]);
      dragRef.current = { kind: 'boxSelect', startWorld: world };
    } else {
      // 手型工具或中/右键：平移
      dragRef.current = {
        kind: 'pan',
        startX: e.clientX,
        startY: e.clientY,
        vx: vp.x,
        vy: vp.y,
      };
    }
  };

  /** 元件按下：选中并开始拖动 */
  const handleComponentPointerDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    const comp = components.find((c) => c.id === id);
    if (!comp) return;
    const world = toWorld(e.clientX, e.clientY);
    useCircuitStore.getState().select({ kind: 'component', id });
    dragRef.current = {
      kind: 'component',
      id,
      offsetX: world.x - comp.x,
      offsetY: world.y - comp.y,
    };
  };

  /** 点击引脚：两段式连线状态机 */
  const handlePinPointerDown = (componentId: string, pinIndex: number) => {
    const state = useCircuitStore.getState();
    const endpoint = { componentId, pinIndex };
    if (state.wiringFrom) {
      state.completeWire(endpoint);
      setCursor(null);
    } else {
      state.startWire(endpoint);
    }
  };

  /** 从元件库拖拽放下：在落点创建元件 */
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData(
      'application/x-circuit-component',
    ) as ComponentType;
    if (!type) return;
    const world = toWorld(e.clientX, e.clientY);
    useCircuitStore.getState().addComponent(type, world.x, world.y);
  };

  return (
    <svg
      ref={svgRef}
      className="canvas"
      style={{ cursor: tool === 'pan' ? 'grab' : 'default' }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      <defs>
        {/* 网格图案：随视口一起缩放平移 */}
        <pattern id="grid" width={GRID} height={GRID} patternUnits="userSpaceOnUse">
          <path
            d={`M ${GRID} 0 L 0 0 0 ${GRID}`}
            fill="none"
            stroke={cc.grid}
            strokeWidth={1}
          />
        </pattern>
      </defs>

      <g
        transform={`translate(${viewport.x}, ${viewport.y}) scale(${viewport.zoom})`}
      >
        {/* 网格背景：同时作为平移与取消选中的命中区 */}
        <rect
          x={-GRID_EXTENT}
          y={-GRID_EXTENT}
          width={GRID_EXTENT * 2}
          height={GRID_EXTENT * 2}
          fill="url(#grid)"
          onPointerDown={handleBackgroundPointerDown}
        />

        {/* 框选矩形 */}
        {boxSelectRect && (
          <rect
            x={Math.min(boxSelectRect.start.x, boxSelectRect.end.x)}
            y={Math.min(boxSelectRect.start.y, boxSelectRect.end.y)}
            width={Math.abs(boxSelectRect.end.x - boxSelectRect.start.x)}
            height={Math.abs(boxSelectRect.end.y - boxSelectRect.start.y)}
            fill="#3b82f6"
            fillOpacity={0.1}
            stroke="#3b82f6"
            strokeDasharray="4 3"
            style={{ pointerEvents: 'none' }}
          />
        )}

        {/* 导线层：先画线，保证元件覆盖其上 */}
        {wires.map((wire) => {
          const ends = resolveWireEndpoints(wire, components);
          if (!ends) return null;
          const pts = [ends.from, ...wire.waypoints, ends.to];
          const d = pts
            .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
            .join(' ');
          const isSelected =
            selection?.kind === 'wire' && selection.id === wire.id;
          // 电势着色：有求解结果时按起点引脚所属节点的电压取色
          const wireNode = potentials.nodeOfPin.get(
            pinKey(wire.from.componentId, wire.from.pinIndex),
          );
          const voltageColor = wireNode
            ? solvedColorOfNode?.get(wireNode)
            : undefined;
          return (
            <g key={wire.id}>
              <path
                d={d}
                fill="none"
                stroke={
                  isSelected ? cc.wireSelected : (voltageColor ?? cc.wire)
                }
                strokeWidth={isSelected ? 3 : 2}
              />
              {/* 透明加粗命中区，便于点击选中；双击创建连接点 */}
              <path
                d={d}
                fill="none"
                stroke="transparent"
                strokeWidth={12}
                style={{ cursor: 'pointer' }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  // 连线中点击其他导线：不进入选中状态，
                  // 走「吸附到导线创建连接点 / 取消连线」逻辑
                  if (useCircuitStore.getState().wiringFrom) {
                    handleWiringClick();
                    return;
                  }
                  useCircuitStore.getState().select({ kind: 'wire', id: wire.id });
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  const world = toWorld(e.clientX, e.clientY);
                  useCircuitStore.getState().addJunction(wire.id, world.x, world.y);
                }}
              />
              {/* 选中时的折点手柄：拖动即可移动导线走线 */}
              {isSelected && (
                <WireHandle
                  point={
                    wire.waypoints[0] ?? {
                      x: (ends.from.x + ends.to.x) / 2,
                      y: (ends.from.y + ends.to.y) / 2,
                    }
                  }
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setDragWireId(wire.id);
                    dragRef.current = { kind: 'waypoint', wireId: wire.id, index: 0 };
                  }}
                />
              )}
            </g>
          );
        })}

        {/* 电流方向动效：求解后在导线上叠加橙色虚线流 + 箭头 */}
        {wireCurrents.map((wc) => {
          const wire = wires.find((w) => w.id === wc.wireId);
          if (!wire) return null;
          const ends = resolveWireEndpoints(wire, components);
          if (!ends) return null;
          const pts = [ends.from, ...wire.waypoints, ends.to];
          const d = pts
            .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
            .join(' ');
          const { point: mid, angle } = pathMidpointAndTangent(pts);
          const arrowDeg = (angle * 180) / Math.PI + (wc.forward ? 0 : 180);
          return (
            <g key={`flow-${wc.wireId}`}>
              <path
                d={d}
                className={`current-flow${wc.forward ? '' : ' current-flow-reverse'}`}
              />
              <polygon
                points="-5,-3 5,0 -5,3"
                className="current-flow-arrow"
                transform={`translate(${mid.x} ${mid.y}) rotate(${arrowDeg})`}
              />
            </g>
          );
        })}

        {/* 元件层 */}
        {components.map((comp) => {
          const pinStyles = getPinOffsets(comp.type).map((_, i) => {
            const key = pinKey(comp.id, i);
            const node = potentials.nodeOfPin.get(key);
            // 电势着色优先：有求解结果时按节点电压取色，否则用等电位调色板
            const color =
              (node ? solvedColorOfNode?.get(node) : undefined) ??
              potentials.colorOfPin.get(key) ??
              '#0ea5e9';
            return {
              color,
              highlight: highlightKeys.has(key),
            };
          });
          return (
            <g
              key={comp.id}
              onPointerDown={(e) => handleComponentPointerDown(e, comp.id)}
            >
              {highlightedComponents.includes(comp.id) && (
                <circle
                  cx={comp.x}
                  cy={comp.y}
                  r={55}
                  fill="#f59e0b"
                  opacity={0.18}
                  style={{ pointerEvents: 'none' }}
                />
              )}
              {selectedComponents.includes(comp.id) && (
                <rect
                  x={comp.x - 50}
                  y={comp.y - 30}
                  width={100}
                  height={60}
                  fill="none"
                  stroke="#3b82f6"
                  strokeDasharray="4 3"
                  strokeWidth={2}
                  style={{ pointerEvents: 'none' }}
                />
              )}
              <Symbol
                component={comp}
                selected={selection?.kind === 'component' && selection.id === comp.id}
                pinStyles={pinStyles}
                onPinPointerDown={handlePinPointerDown}
                onPinEnter={(componentId, pinIndex) =>
                  setHoveredPin({ componentId, pinIndex })
                }
                onPinLeave={() => setHoveredPin(null)}
              />
            </g>
          );
        })}

        {/* 拖动折点命中等效节点：高亮该节点全部引脚 + 提示气泡 */}
        {equivHit && (
          <>
            {(potentials.pinsOfNode.get(equivHit.nodeId) ?? []).map((key) => {
              const [cid, idxStr] = key.split(':');
              const comp = components.find((c) => c.id === cid);
              if (!comp) return null;
              const p = getPinPosition(comp, Number(idxStr));
              return (
                <circle
                  key={`eq-${key}`}
                  cx={p.x}
                  cy={p.y}
                  r={10}
                  fill="#16a34a"
                  opacity={0.35}
                  style={{ pointerEvents: 'none' }}
                />
              );
            })}
            <circle
              cx={equivHit.point.x}
              cy={equivHit.point.y}
              r={equivHit.distance + 6}
              fill="none"
              stroke="#16a34a"
              strokeWidth={2}
              strokeDasharray="5 3"
              style={{ pointerEvents: 'none' }}
            />
            <NodeTooltip
              x={equivHit.point.x}
              y={equivHit.point.y}
              text={equivalenceMessage(
                equivHit,
                equivHit.nodeId ===
                  potentials.nodeOfPin.get(
                    (() => {
                      const w = wires.find((x) => x.id === dragWireId);
                      return w
                        ? pinKey(w.from.componentId, w.from.pinIndex)
                        : '';
                    })(),
                  ),
              )}
              warning={false}
            />
          </>
        )}

        {/* 拖动折点时的候选点标记 */}
        {dragPoint && !equivHit && (
          <circle
            cx={dragPoint.x}
            cy={dragPoint.y}
            r={4}
            fill="#64748b"
            style={{ pointerEvents: 'none' }}
          />
        )}

        {/* 连线橡皮筋预览：吸附到悬停引脚，等电位时变红提示 */}
        {wiringStart && (hoveredPoint ?? cursor) && (
          <line
            x1={wiringStart.x}
            y1={wiringStart.y}
            x2={(hoveredPoint ?? cursor)!.x}
            y2={(hoveredPoint ?? cursor)!.y}
            stroke={wiringToSameNode ? '#dc2626' : '#2563eb'}
            strokeWidth={2}
            strokeDasharray="6 4"
            style={{ pointerEvents: 'none' }}
          />
        )}

        {/* 连线吸附到导线（折点/线段任意点）：双圈高亮并提示可创建连接点 */}
        {wiringFrom && wireSnap && (
          <>
            <circle
              cx={wireSnap.point.x}
              cy={wireSnap.point.y}
              r={12}
              fill="#16a34a"
              opacity={0.3}
              style={{ pointerEvents: 'none' }}
            />
            <circle
              cx={wireSnap.point.x}
              cy={wireSnap.point.y}
              r={4}
              fill="#16a34a"
              style={{ pointerEvents: 'none' }}
            />
            <NodeTooltip
              x={wireSnap.point.x}
              y={wireSnap.point.y}
              text={
                wireSnap.onWaypoint
                  ? '吸附到折点，点击此处创建连接点'
                  : '吸附到导线，点击在此创建连接点'
              }
              warning={false}
            />
          </>
        )}

        {/* 等电位提示气泡 */}
        {hoveredNode && hoveredPoint && (
          <NodeTooltip
            x={hoveredPoint.x}
            y={hoveredPoint.y}
            text={
              wiringToSameNode
                ? `节点 ${hoveredNode}：与起点等电位，无需连线`
                : solveResult &&
                    solveResult.node_voltages[hoveredNode] !== undefined
                  ? `节点 ${hoveredNode} · V = ${solveResult.node_voltages[hoveredNode].toFixed(precision)} V`
                  : `节点 ${hoveredNode} · ${
                      (potentials.pinsOfNode.get(hoveredNode) ?? []).length
                    } 个引脚等电位`
            }
            warning={wiringToSameNode}
          />
        )}
      </g>
    </svg>
  );
}

/** 引脚上方的等电位提示气泡（世界坐标） */
function NodeTooltip({
  x,
  y,
  text,
  warning,
}: {
  x: number;
  y: number;
  text: string;
  warning: boolean;
}) {
  // 以中文字符宽度估算气泡宽度
  const width = text.length * 12 + 18;
  return (
    <g transform={`translate(${x - width / 2}, ${y - 40})`} style={{ pointerEvents: 'none' }}>
      <rect
        width={width}
        height={26}
        rx={6}
        fill={warning ? '#b91c1c' : '#0f172a'}
        opacity={0.92}
      />
      <text x={width / 2} y={17} fontSize={12} fill="#fff" textAnchor="middle">
        {text}
      </text>
    </g>
  );
}

/** 导线折点手柄 */
function WireHandle({
  point,
  onPointerDown,
}: {
  point: Point;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  return (
    <circle
      cx={point.x}
      cy={point.y}
      r={6}
      fill="#1d4ed8"
      stroke="#fff"
      strokeWidth={2}
      style={{ cursor: 'move' }}
      onPointerDown={onPointerDown}
    />
  );
}