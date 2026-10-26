# =============================================================
# 符号 MNA（改进节点分析）求解器
# -------------------------------------------------------------
# 与数值版 MNASolver 共用同一套 stamp 规则（引脚顺序、支路电流
# 正方向、KCL 流出为正、地/参考节点不入方程），区别仅在于：
#   · 矩阵元素为 SymPy 表达式（Symbol 或精确 Rational），而非 float；
#   · 元件值可按「半符号」白名单选择「保留符号」或「代入数值」；
#   · 解出后做分层简化，抑制表达式爆炸。
#
# 参考节点策略：优先使用接地节点；若电路无地，则自动选取编号最小的
# 节点作为参考（电压为 0），并在结果中标记 is_reference_ground=False。
#
# 本模块只做符号计算，前端绝不参与符号运算（架构约定）。
# =============================================================
import re

import sympy as sp

from ..schema.netlist import Netlist, NetlistComponent
from .errors import CircuitError
from .mna import _slot_label_map, _node_sort_key

# 全符号求解允许的最大矩阵规模：超过则表达式规模组合爆炸，
# 直接给出明确错误并建议改用半符号模式或数值求解。
_MAX_MATRIX_SIZE = 12

# 单个表达式项数（count_ops）超过该阈值时，跳过昂贵的 factor，
# 仅做 cancel/together 等廉价化简，避免卡死。
_FACTOR_OP_LIMIT = 200


class SymbolicMNASolver:
    """符号直流线性电路求解器。无状态，可重复调用。"""

    def __init__(self) -> None:
        # 本次求解中建立的符号表：元件 id -> Symbol
        self._symbols: dict[str, sp.Symbol] = {}
        # 半符号白名单（空表示全符号）：需要在求解中保留为符号的元件 id
        self._symbols_whitelist: set[str] = set()

    # ---------------------------------------------------------
    # 对外入口
    # ---------------------------------------------------------
    def solve_symbolic(self, netlist: Netlist) -> dict:
        """求解直流工作点的符号解析表达式。

        :param netlist: 网表（IR）；`symbolic` 非空时为半符号模式。
        :returns: 节点电压/支路电流的表达式字符串、符号表、方程与提示。
        """
        self._symbols = {}
        self._symbols_whitelist = set(netlist.symbolic)
        self._validate_symbolic_ids(netlist)

        components = netlist.components

        # —— 1. 参考节点：优先接地，无地则自动选最小编号节点 ——
        self._validate_nodes(netlist)
        reference_ids, is_ground = self._select_reference(netlist)

        node_slot: dict[str, int | None] = {}
        slot_to_node: list[str] = []
        for node in netlist.nodes:
            if node.id in reference_ids:
                node_slot[node.id] = None  # 参考节点不占未知量
            else:
                node_slot[node.id] = len(slot_to_node)
                slot_to_node.append(node.id)
        n_nodes = len(slot_to_node)

        # —— 2. 分配支路电流未知量 ——
        i_slot = self._allocate_current_unknowns(components, n_nodes)
        size = n_nodes + len(i_slot)

        if size == 0:
            raise CircuitError("EMPTY_CIRCUIT", "电路为空或只有接地，无法求解")
        if size > _MAX_MATRIX_SIZE:
            raise CircuitError(
                "SYMBOLIC_TOO_LARGE",
                f"符号求解矩阵规模 {size}×{size} 超出上限 {_MAX_MATRIX_SIZE}，"
                "请改用半符号模式（仅保留少数元件为符号）或数值求解 /solve_dc",
            )

        # —— 3. 组装符号矩阵 A 与 b ——
        A = sp.zeros(size, size)
        b = sp.zeros(size, 1)

        def sv(row: int | None, col: int | None, val) -> None:
            """向 A 叠加一个符号元素（跳过参考节点行列）。"""
            if row is not None and col is not None:
                A[row, col] = A[row, col] + val

        def sb(row: int | None, val) -> None:
            """向 b 叠加一个符号元素（跳过参考节点行）。"""
            if row is not None:
                b[row] = b[row] + val

        for comp in components:
            self._stamp_component(comp, node_slot, i_slot, sv, sb)

        # —— 4. 求解线性方程组 ——
        raw = self._solve_linear(A, b)

        # —— 5. 简化并整理结果 ——
        node_voltages: dict[str, str] = {}
        for node in netlist.nodes:
            slot = node_slot[node.id]
            node_voltages[node.id] = "0" if slot is None else sp.sstr(
                self._simplify_expr(raw[slot])
            )

        branch_currents: dict[str, str] = {}
        for comp in components:
            expr = self._branch_current(comp, raw, node_slot, i_slot)
            branch_currents[comp.id] = sp.sstr(self._simplify_expr(expr))

        return {
            "node_voltages": node_voltages,
            "branch_currents": branch_currents,
            "symbols": sorted(self._symbols.keys()),
            "substituted": {
                c.id: c.value
                for c in components
                if c.id not in self._symbols and c.value is not None
            },
            "reference": sorted(reference_ids)[0],
            "is_reference_ground": is_ground,
            "equations": self._format_equations(A, b, slot_to_node, i_slot),
            "notes": self._build_notes(netlist, is_ground),
        }

    # ---------------------------------------------------------
    # 校验与参考节点
    # ---------------------------------------------------------
    @staticmethod
    def _validate_nodes(netlist: Netlist) -> None:
        """检查元件引脚引用的节点均已定义。"""
        known = {node.id for node in netlist.nodes}
        for comp in netlist.components:
            for pin in comp.pins:
                if pin not in known:
                    raise CircuitError(
                        "UNKNOWN_NODE",
                        f"元件 {comp.id} 引用了未定义的节点 {pin}",
                    )

    @staticmethod
    def _validate_symbolic_ids(netlist: Netlist) -> None:
        """半符号白名单中的元件 id 必须存在于电路中。"""
        if not netlist.symbolic:
            return
        ids = {comp.id for comp in netlist.components}
        unknown = [cid for cid in netlist.symbolic if cid not in ids]
        if unknown:
            raise CircuitError(
                "UNKNOWN_SYMBOLIC",
                f"symbolic 列表引用了不存在的元件：{', '.join(unknown)}",
            )

    @staticmethod
    def _select_reference(netlist: Netlist) -> tuple[set[str], bool]:
        """选择参考节点：优先接地；无地时取编号最小的节点。

        :returns: (参考节点 id 集合, 参考是否为真实接地)
        """
        grounds = {node.id for node in netlist.nodes if node.isGround}
        for comp in netlist.components:
            if comp.type == "ground" and comp.pins:
                grounds.add(comp.pins[0])
        if grounds:
            return grounds, True
        if not netlist.nodes:
            raise CircuitError("EMPTY_CIRCUIT", "电路为空，无法求解")
        # 无接地：自动选编号最小的节点作为参考，保证解唯一
        ref = min((node.id for node in netlist.nodes), key=_node_sort_key)
        return {ref}, False

    @staticmethod
    def _allocate_current_unknowns(
        components: list[NetlistComponent], n_nodes: int
    ) -> dict[tuple[str, str], int]:
        """为需要电流未知量的支路分配矩阵下标（与数值版规则一致）。"""
        i_slot: dict[tuple[str, str], int] = {}
        nxt = n_nodes
        for comp in components:
            if comp.type == "voltage_source":
                i_slot[(comp.id, "i")] = nxt
                nxt += 1
            elif comp.type == "vcvs":
                i_slot[(comp.id, "i")] = nxt
                nxt += 1
            elif comp.type == "ccvs":
                i_slot[(comp.id, "i")] = nxt
                nxt += 1
                i_slot[(comp.id, "ictrl")] = nxt
                nxt += 1
            elif comp.type == "cccs":
                i_slot[(comp.id, "ictrl")] = nxt
                nxt += 1
            elif comp.type == "opamp_ideal":
                i_slot[(comp.id, "iout")] = nxt
                nxt += 1
            elif comp.type == "switch" and SymbolicMNASolver._is_closed(comp):
                i_slot[(comp.id, "i")] = nxt
                nxt += 1
        return i_slot

    # ---------------------------------------------------------
    # 元件 stamp（与数值版保持完全一致的规则，值改为符号/精确数）
    # ---------------------------------------------------------
    def _stamp_component(self, comp, node_slot, i_slot, sv, sb) -> None:
        t = comp.type

        if t == "ground":
            return

        if t == "resistor":
            a, b = self._pins(comp, 2)
            r = self._val(comp)
            if r == 0:
                raise CircuitError("INVALID_VALUE", f"电阻 {comp.id} 的阻值不能为 0")
            g = sp.Integer(1) / r
            ra, rb = node_slot[a], node_slot[b]
            sv(ra, ra, g)
            sv(rb, rb, g)
            sv(ra, rb, -g)
            sv(rb, ra, -g)
            return

        if t == "current_source":
            a, b = self._pins(comp, 2)
            i = self._val(comp)
            sb(node_slot[a], -i)
            sb(node_slot[b], i)
            return

        if t == "voltage_source":
            a, b = self._pins(comp, 2)
            self._stamp_branch_source(
                a, b, i_slot[(comp.id, "i")], self._val(comp), node_slot, sv, sb
            )
            return

        if t == "vcvs":
            a, b, c, d = self._pins(comp, 4)
            mu = self._val(comp)
            k = i_slot[(comp.id, "i")]
            self._stamp_branch_source(a, b, k, sp.Integer(0), node_slot, sv, sb)
            sv(k, node_slot[c], -mu)
            sv(k, node_slot[d], mu)
            return

        if t == "vccs":
            a, b, c, d = self._pins(comp, 4)
            gm = self._val(comp)
            ra, rb, rc, rd = node_slot[a], node_slot[b], node_slot[c], node_slot[d]
            sv(ra, rc, gm)
            sv(ra, rd, -gm)
            sv(rb, rc, -gm)
            sv(rb, rd, gm)
            return

        if t == "ccvs":
            a, b, c, d = self._pins(comp, 4)
            r = self._val(comp)
            k_out = i_slot[(comp.id, "i")]
            k_ctrl = i_slot[(comp.id, "ictrl")]
            self._stamp_branch_source(c, d, k_ctrl, sp.Integer(0), node_slot, sv, sb)
            self._stamp_branch_source(a, b, k_out, sp.Integer(0), node_slot, sv, sb)
            sv(k_out, k_ctrl, -r)
            return

        if t == "cccs":
            a, b, c, d = self._pins(comp, 4)
            beta = self._val(comp)
            k_ctrl = i_slot[(comp.id, "ictrl")]
            self._stamp_branch_source(c, d, k_ctrl, sp.Integer(0), node_slot, sv, sb)
            sv(node_slot[a], k_ctrl, beta)
            sv(node_slot[b], k_ctrl, -beta)
            return

        if t == "opamp_ideal":
            pin_plus, pin_minus, out = self._pins(comp, 3)
            k = i_slot[(comp.id, "iout")]
            sv(node_slot[out], k, sp.Integer(-1))
            sv(k, node_slot[pin_plus], sp.Integer(1))
            sv(k, node_slot[pin_minus], sp.Integer(-1))
            return

        if t == "switch":
            if self._is_closed(comp):
                a, b = self._pins(comp, 2)
                self._stamp_branch_source(
                    a, b, i_slot[(comp.id, "i")], sp.Integer(0), node_slot, sv, sb
                )
            return

        raise CircuitError("UNSUPPORTED_COMPONENT", f"暂不支持的元件类型：{t}")

    def _stamp_branch_source(self, a, b, k, rhs, node_slot, sv, sb) -> None:
        """stamp 一条「引入电流未知量」的电压型支路。"""
        ra, rb = node_slot[a], node_slot[b]
        sv(ra, k, sp.Integer(1))
        sv(rb, k, sp.Integer(-1))
        sv(k, ra, sp.Integer(1))
        sv(k, rb, sp.Integer(-1))
        sb(k, rhs)

    # ---------------------------------------------------------
    # 线性求解与奇异性判定
    # ---------------------------------------------------------
    @staticmethod
    def _solve_linear(A: sp.Matrix, b: sp.Matrix) -> sp.Matrix:
        """求解 A·x = b；结构奇异时抛出明确的中文错误。"""
        try:
            x = A.LUsolve(b)
        except Exception as exc:  # sympy 的不可逆异常
            raise CircuitError(
                "SYMBOLIC_SINGULAR",
                "符号矩阵奇异：电路可能存在电压源环路或缺少有效参考节点",
            ) from exc
        # LUsolve 对奇异矩阵可能返回含 zoo/nan/oo 的结果，需显式检查
        for expr in x:
            if expr.has(sp.zoo, sp.nan, sp.oo, -sp.oo):
                raise CircuitError(
                    "SYMBOLIC_SINGULAR",
                    "符号矩阵奇异：电路可能存在电压源环路或缺少有效参考节点",
                )
        return x

    # ---------------------------------------------------------
    # 结果派生
    # ---------------------------------------------------------
    def _branch_current(self, comp, raw, node_slot, i_slot):
        """符号支路电流（正方向：pins[0] 流入元件）。"""
        t = comp.type

        def v(node_id: str):
            slot = node_slot[node_id]
            return sp.Integer(0) if slot is None else raw[slot]

        if t == "resistor":
            return (v(comp.pins[0]) - v(comp.pins[1])) / self._val(comp)
        if t == "current_source":
            return self._val(comp)
        if t in ("voltage_source", "vcvs", "ccvs"):
            return raw[i_slot[(comp.id, "i")]]
        if t == "switch":
            key = (comp.id, "i")
            return raw[i_slot[key]] if key in i_slot else sp.Integer(0)
        if t == "opamp_ideal":
            return raw[i_slot[(comp.id, "iout")]]
        if t == "vccs":
            _, _, c, d = comp.pins
            return self._val(comp) * (v(c) - v(d))
        if t == "cccs":
            return self._val(comp) * raw[i_slot[(comp.id, "ictrl")]]
        return sp.Integer(0)

    # ---------------------------------------------------------
    # 简化：分层，先廉价后昂贵
    # ---------------------------------------------------------
    def _simplify_expr(self, expr):
        """对解析解做分层简化，避免表达式爆炸。

        顺序：together/cancel（合并有理式）→ 分子分母分别 factor
        → 仅当规模较小时才杀 simplify 兜底。
        """
        if expr.is_number:
            return sp.nsimplify(expr)

        # 第 1 层：合并为单一有理式（廉价、快速）
        e = sp.cancel(sp.together(expr))

        # 第 2 层：分子分母分别因式分解（分压类能化到最简）
        num, den = sp.fraction(e)
        if sp.count_ops(num) + sp.count_ops(den) <= _FACTOR_OP_LIMIT:
            e = sp.factor(num) / sp.factor(den)

        # 第 3 层：仍较简单时才用最贵的 simplify 兜底
        if sp.count_ops(e) <= _FACTOR_OP_LIMIT:
            e = sp.simplify(e)
        return e

    # ---------------------------------------------------------
    # 方程与提示
    # ---------------------------------------------------------
    @staticmethod
    def _format_equations(A, b, slot_to_node, i_slot) -> list[str]:
        """把符号矩阵行格式化为可读的节点电压法方程。"""
        label_by_slot = _slot_label_map(i_slot)
        n_nodes = len(slot_to_node)

        def var_name(j: int) -> str:
            if j < n_nodes:
                return f"v({slot_to_node[j]})"
            return label_by_slot.get(j, f"i{j}")

        lines: list[str] = []
        for row in range(A.rows):
            terms = [
                f"({sp.sstr(A[row, j])})·{var_name(j)}"
                for j in range(A.cols)
                if A[row, j] != 0
            ]
            lhs = " + ".join(terms) if terms else "0"
            if row < n_nodes:
                title = f"节点 KCL {slot_to_node[row]}"
            else:
                title = f"支路约束 {label_by_slot.get(row, '')}".rstrip()
            lines.append(f"{title}: {lhs} = {sp.sstr(b[row])}")
        return lines

    def _build_notes(self, netlist: Netlist, is_ground: bool) -> list[str]:
        notes: list[str] = []
        if not is_ground:
            notes.append(
                "电路未接地：已自动选取编号最小的节点作为参考点（电压记为 0），"
                "所求电压为相对该参考点的相对值。"
            )
        if self._symbols:
            names = ", ".join(sorted(self._symbols.keys()))
            notes.append(f"解析解在符号取值不导致矩阵奇异时有效（例如分母不为 0）。保留符号：{names}")
        return notes

    # ---------------------------------------------------------
    # 小工具
    # ---------------------------------------------------------
    def _val(self, comp):
        """取元件值：命中半符号白名单则返回 Symbol，否则返回精确数值。"""
        keep = not self._symbols_whitelist or comp.id in self._symbols_whitelist
        if keep:
            sym = self._symbols.get(comp.id)
            if sym is None:
                name = str(comp.params.get("symbol") or comp.id)
                sym = sp.Symbol(name)
                self._symbols[comp.id] = sym
            return sym
        if comp.value is None:
            raise CircuitError(
                "INVALID_VALUE", f"元件 {comp.id}（{comp.type}）缺少数值 value"
            )
        return _to_rational(comp.value)

    @staticmethod
    def _pins(comp, expected: int) -> list[str]:
        if len(comp.pins) != expected:
            raise CircuitError(
                "INVALID_PINS",
                f"元件 {comp.id}（{comp.type}）需要 {expected} 个引脚，实际 {len(comp.pins)}",
            )
        return comp.pins

    @staticmethod
    def _is_closed(comp) -> bool:
        return bool(comp.params.get("closed", False))



def _to_rational(value) -> sp.Expr:
    """把数值精确转为 SymPy 有理数（用字符串避免二进制浮点误差）。"""
    try:
        return sp.Rational(str(value))
    except Exception:
        return sp.nsimplify(value)
