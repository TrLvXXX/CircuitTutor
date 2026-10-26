# =============================================================
# 电路自动简化：识别串/并联电阻、戴维南等效
# -------------------------------------------------------------
# 纯分析逻辑，复用既有 MNASolver 计算戴维南参数。
# 串联：两电阻共享一个仅连接它俩的中间节点。
# 并联：两电阻连接同一对节点。
# 戴维南：开路电压直接求解；等效内阻用「独立源置零 + 1A 测试源」法。
# =============================================================
from ..schema.netlist import Netlist, NetlistComponent
from .errors import CircuitError
from .mna import MNASolver


class Simplifier:
    """电路简化分析器。无状态，可重复调用。"""

    def simplify(self, netlist: Netlist) -> dict:
        """识别串/并联电阻，返回可读的简化步骤列表。"""
        steps: list[dict] = []
        steps.extend(self._find_series_resistors(netlist))
        steps.extend(self._find_parallel_resistors(netlist))
        return {"steps": steps}

    def thevenin(self, netlist: Netlist, port_a: str, port_b: str) -> dict:
        """计算指定端口的戴维南等效参数（Vth, Rth）。

        :param port_a: 端口正端节点 id
        :param port_b: 端口负端节点 id
        :returns: {"port": [a,b], "vth": float, "rth": float, "description": str}
        """
        node_ids = {n.id for n in netlist.nodes}
        if port_a not in node_ids or port_b not in node_ids:
            raise CircuitError(
                "INVALID_PORT", f"端口节点 {port_a} 或 {port_b} 不存在"
            )

        # 1. 开路电压：直接求解原电路
        result = MNASolver().solve_dc(netlist)
        vth = result["node_voltages"][port_a] - result["node_voltages"][port_b]

        # 2. 等效内阻：独立源置零 + 在端口加 1A 测试电流源
        test_nl = self._zero_sources(netlist)
        # 1A 从 port_b 流出、注入 port_a，则 V(a)-V(b) = Rth * 1A
        test_nl.components.append(
            NetlistComponent(
                id="_Itest",
                type="current_source",
                pins=[port_b, port_a],
                value=1.0,
            )
        )
        result2 = MNASolver().solve_dc(test_nl)
        rth = result2["node_voltages"][port_a] - result2["node_voltages"][port_b]

        return {
            "port": [port_a, port_b],
            "vth": vth,
            "rth": rth,
            "description": f"戴维南等效：Vth = {vth:.6g} V，Rth = {rth:.6g} Ω",
        }

    # ---------------------------------------------------------
    # 串联电阻识别（链式：R1-R2-...-Rn）
    # ---------------------------------------------------------
    @staticmethod
    def _find_series_resistors(netlist: Netlist) -> list[dict]:
        """识别串联电阻链：相邻电阻共享一个仅连接它俩的中间节点。

        构建以电阻为节点、中间节点为边的图，取连通分量（≥2 个电阻）
        作为一条串联链，合并阻值为各电阻之和。
        """
        resistors = [c for c in netlist.components if c.type == "resistor"]
        if len(resistors) < 2:
            return []

        # 节点 → 连接的元件 id 列表
        node_comps: dict[str, list[str]] = {}
        for comp in netlist.components:
            for pin in comp.pins:
                node_comps.setdefault(pin, []).append(comp.id)

        ground_ids = {n.id for n in netlist.nodes if n.isGround}
        resistor_ids = {c.id for c in resistors}

        # 中间节点：非地、仅连接两个电阻
        mid_connections: dict[str, tuple[str, str]] = {}
        for node_id, comps in node_comps.items():
            if node_id in ground_ids:
                continue
            if len(comps) != 2:
                continue
            if not all(c in resistor_ids for c in comps):
                continue
            mid_connections[node_id] = (comps[0], comps[1])

        # 构建邻接表：电阻 id → [(邻居电阻 id, 中间节点)]
        adj: dict[str, list[tuple[str, str]]] = {r.id: [] for r in resistors}
        for mid, (r1, r2) in mid_connections.items():
            adj[r1].append((r2, mid))
            adj[r2].append((r1, mid))

        # BFS 找连通分量
        visited: set[str] = set()
        steps: list[dict] = []
        comp_map = {c.id: c for c in resistors}
        for r in resistors:
            if r.id in visited:
                continue
            chain: list[str] = []
            queue = [r.id]
            visited.add(r.id)
            while queue:
                cur = queue.pop(0)
                chain.append(cur)
                for nb, _ in adj[cur]:
                    if nb not in visited:
                        visited.add(nb)
                        queue.append(nb)
            if len(chain) < 2:
                continue
            chain_comps = [comp_map[rid] for rid in chain]
            r_sum = sum(float(c.value) for c in chain_comps)
            # 收集链内中间节点
            mid_nodes = [
                mid
                for mid, (r1, r2) in mid_connections.items()
                if r1 in chain and r2 in chain
            ]
            parts = " + ".join(f"{c.id}={float(c.value):g}Ω" for c in chain_comps)
            steps.append({
                "type": "series",
                "title": f"串联电阻 {' + '.join(c.id for c in chain_comps)}",
                "detail": f"中间节点 {', '.join(sorted(mid_nodes))} 仅连接链内电阻，"
                f"可合并为 {r_sum:.6g}Ω（{parts}）",
                "components": [c.id for c in chain_comps],
                "merged_value": r_sum,
                "nodes": sorted(mid_nodes),
            })
        return steps

    # ---------------------------------------------------------
    # 并联电阻识别（整组：R1∥R2∥...∥Rn）
    # ---------------------------------------------------------
    @staticmethod
    def _find_parallel_resistors(netlist: Netlist) -> list[dict]:
        """识别并联电阻：连接同一对节点的所有电阻一起合并。"""
        resistors = [c for c in netlist.components if c.type == "resistor"]
        if len(resistors) < 2:
            return []

        # 按排序后的节点对分组
        pairs: dict[tuple[str, str], list[NetlistComponent]] = {}
        for r in resistors:
            key = tuple(sorted(r.pins))
            pairs.setdefault(key, []).append(r)

        steps: list[dict] = []
        for key, group in pairs.items():
            if len(group) < 2:
                continue
            values = [float(r.value) for r in group]
            r_parallel = 1.0 / sum(1.0 / v for v in values)
            ids = [r.id for r in group]
            parts = " ∥ ".join(f"{r.id}={float(r.value):g}Ω" for r in group)
            steps.append({
                "type": "parallel",
                "title": f"并联电阻 {' ∥ '.join(ids)}",
                "detail": f"两端节点 {key[0]}-{key[1]}，"
                f"可合并为 {r_parallel:.6g}Ω（{parts}）",
                "components": ids,
                "merged_value": r_parallel,
                "nodes": [key[0], key[1]],
            })
        return steps

    # ---------------------------------------------------------
    # 独立源置零（用于戴维南内阻计算）
    # ---------------------------------------------------------
    @staticmethod
    def _zero_sources(netlist: Netlist) -> Netlist:
        """独立源置零：电压源→0V（短路），电流源→删除（开路）。"""
        nl = netlist.model_copy(deep=True)
        new_comps: list[NetlistComponent] = []
        for comp in nl.components:
            if comp.type == "current_source":
                continue  # 开路
            if comp.type == "voltage_source":
                comp.value = 0.0  # 短路
            new_comps.append(comp)
        nl.components = new_comps
        return nl