# =============================================================
# 未知量反解求解器
# -------------------------------------------------------------
# 把「标记为未知量」的元件参数作为 SymPy 符号，与电路方程（符号 MNA）
# 联立求解，尝试唯一确定每个未知参数：
#   · 若参数被解为常数（不含其余未知符号）→ 视为已确定；
#   · 若方程不足以唯一确定 → 归入 undetermined，前端提示「已知条件不足」。
#
# 支持用户额外提供「已知测量值」（支路电流/节点电势/节点电势差），
# 作为补充约束加入方程组，帮助确定原本欠定的未知量。
#
# 复用 SymbolicMNASolver 的全部 stamp 规则，仅新增「反解参数」这一步。
# 本模块只做符号计算，前端绝不参与（架构约定）。
# =============================================================
import sympy as sp

from ..schema.netlist import Netlist
from .errors import CircuitError
from .symbolic_solver import SymbolicMNASolver


class UnknownSolver(SymbolicMNASolver):
    """未知量反解：求被标记为未知的元件参数。无状态，可重复调用。"""

    def solve_unknowns(
        self,
        netlist: Netlist,
        measurements: list[dict] | None = None,
    ) -> dict:
        """反解标记为未知量的元件参数。

        :param measurements: 用户提供的已知测量值列表，每项形如
            {"type": "current", "node_a": "n1", "node_b": "n0", "value": 0.005}
            {"type": "voltage", "node_id": "n1", "value": 2.5}
            {"type": "voltage_diff", "node_a": "n1", "node_b": "n2", "value": 1.5}
        电流测量按「节点 A → 节点 B」表达：在 A、B 之间查找唯一两端元件，
        取其电流并按 A→B 方向定符号（A 端对应元件 pin0 时取正，否则取反）；
        找不到元件或存在多个元件时返回 INVALID_MEASUREMENT。
        :returns: {solved, undetermined, resolved, reference, is_reference_ground}
        """
        self._symbols = {}
        measurements = measurements or []
        unknown_ids = [
            c.id for c in netlist.components if (c.params or {}).get("unknown")
        ]
        if not unknown_ids:
            raise CircuitError("NO_UNKNOWN", "没有标记为未知量的元件")
        # 仅未知量元件保留为符号，其余元件一律代入数值
        self._symbols_whitelist = set(unknown_ids)

        components = netlist.components
        self._validate_nodes(netlist)
        reference_ids, is_ground = self._select_reference(netlist)

        node_slot: dict[str, int | None] = {}
        slot_to_node: list[str] = []
        for node in netlist.nodes:
            if node.id in reference_ids:
                node_slot[node.id] = None
            else:
                node_slot[node.id] = len(slot_to_node)
                slot_to_node.append(node.id)
        n_nodes = len(slot_to_node)

        i_slot = self._allocate_current_unknowns(components, n_nodes)
        size = n_nodes + len(i_slot)
        if size == 0:
            raise CircuitError("EMPTY_CIRCUIT", "电路为空或只有接地，无法求解")

        # —— 组装符号矩阵 A·x = b（未知元件值以 Symbol 出现） ——
        A = sp.zeros(size, size)
        b = sp.zeros(size, 1)

        def sv(row: int | None, col: int | None, val) -> None:
            if row is not None and col is not None:
                A[row, col] = A[row, col] + val

        def sb(row: int | None, val) -> None:
            if row is not None:
                b[row] = b[row] + val

        for comp in components:
            self._stamp_component(comp, node_slot, i_slot, sv, sb)

        param_syms = list(self._symbols.values())
        if not param_syms:
            raise CircuitError("NO_UNKNOWN", "没有标记为未知量的元件")

        # —— 联立：电路未知量 x（节点电压+电流）+ 未知参数，共 size+k 个未知数 ——
        x_syms = [sp.Symbol(f"_x{i}") for i in range(size)]
        unknowns = list(x_syms) + list(param_syms)
        equations = [
            sp.expand(sum(A[i, j] * x_syms[j] for j in range(size)) - b[i])
            for i in range(size)
        ]

        # —— 追加用户提供的已知测量值方程 ——

        for m in measurements:
            mtype = m.get("type")
            mval = sp.Rational(str(m.get("value", 0)))
            if mtype == "voltage":
                nid = m.get("node_id", "")
                slot = node_slot.get(nid)
                if slot is None:
                    raise CircuitError(
                        "INVALID_MEASUREMENT",
                        f"测量值引用的节点 {nid} 不存在或为参考节点",
                    )
                equations.append(x_syms[slot] - mval)
            elif mtype == "voltage_diff":
                na, nb = m.get("node_a", ""), m.get("node_b", "")
                sa, sb_ = node_slot.get(na), node_slot.get(nb)
                if sa is None or sb_ is None:
                    raise CircuitError(
                        "INVALID_MEASUREMENT",
                        f"测量值引用的节点 {na} 或 {nb} 不存在或为参考节点",
                    )
                equations.append(x_syms[sa] - x_syms[sb_] - mval)
            elif mtype == "current":
                na, nb = m.get("node_a", ""), m.get("node_b", "")
                # 在节点 A、B 之间查找唯一的两端元件承载该电流
                matched: list[tuple[object, int]] = []
                for cand in components:
                    cpins = cand.pins
                    if len(cpins) < 2:
                        continue
                    if cpins[0] == na and cpins[1] == nb:
                        matched.append((cand, 1))
                    elif cpins[0] == nb and cpins[1] == na:
                        matched.append((cand, -1))
                if not matched:
                    raise CircuitError(
                        "INVALID_MEASUREMENT",
                        f"节点 {na} 与 {nb} 之间不存在可测量电流的两端元件",
                    )
                if len(matched) > 1:
                    raise CircuitError(
                        "INVALID_MEASUREMENT",
                        f"节点 {na} 与 {nb} 之间存在多个元件，无法唯一确定电流",
                    )
                comp, sign = matched[0]
                # 有支路电流未知量的元件（电压源等）：直接取 x[i_slot]
                cur_slot = i_slot.get((comp.id, "i"))
                if cur_slot is None:
                    cur_slot = i_slot.get((comp.id, "iout"))
                if cur_slot is not None:
                    # sign * 支路电流 = 测量值
                    equations.append(sp.expand(sign * x_syms[cur_slot] - mval))
                else:
                    # 电阻等无支路电流未知量：用欧姆定律 I = (V0 - V1) / R
                    cpins = comp.pins
                    s0, s1 = node_slot.get(cpins[0]), node_slot.get(cpins[1])
                    r_sym = self._val(comp)
                    expr = sp.Integer(0)
                    if s0 is not None:
                        expr += x_syms[s0] / r_sym
                    if s1 is not None:
                        expr -= x_syms[s1] / r_sym
                    equations.append(sp.expand(sign * expr - mval))

        try:
            sol_list = sp.solve(equations, unknowns, dict=True)
        except Exception as exc:  # 求解器内部异常
            raise CircuitError(
                "UNKNOWN_SOLVE_FAILED",
                "未知量反解失败：方程组过于复杂或无法求解",
            ) from exc

        solved: dict[str, float] = {}
        undetermined: list[str] = []
        if sol_list:
            sol = sol_list[0]
            for cid, sym in self._symbols.items():
                val = sol.get(sym)
                if (
                    val is not None
                    and getattr(val, "is_number", False)
                    and val.is_real
                    and not val.has(sp.zoo, sp.nan, sp.oo, -sp.oo)
                ):
                    solved[cid] = float(val)
                else:
                    undetermined.append(cid)
        else:
            undetermined = list(self._symbols.keys())

        return {
            "solved": solved,
            "undetermined": undetermined,
            "resolved": len(undetermined) == 0,
            "reference": sorted(reference_ids)[0],
            "is_reference_ground": is_ground,
        }