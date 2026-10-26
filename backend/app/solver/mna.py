# =============================================================
# 改进节点分析法（MNA）直流线性求解器
# -------------------------------------------------------------
# 未知量向量 x = [非地节点电压 v1..vn | 需额外电流未知量的支路电流 i1..im]
# 矩阵规模为 (n+m) x (n+m)，地节点为参考点（不入方程）。
#
# 支路电流正方向约定：从 pins[0] 端流入元件、由 pins[1] 端流出元件。
# KCL 约定：节点处「流出为正」，独立源移到方程右端，形式为 A·x = b。
#
# 需要扩展电流未知量的元件：独立电压源、VCVS、CCVS、理想运放、闭合开关；
# CCVS/CCCS 的控制量为其 (c,d) 引脚间插入的 0V 电流探头。
# =============================================================
import re

import numpy as np

from ..schema.netlist import Netlist, NetlistComponent
from .errors import CircuitError

# 判定矩阵元素是否为零的阈值
_ZERO = 1e-15


class MNASolver:
    """直流线性电路求解器。无状态，可重复调用。"""

    # ---------------------------------------------------------
    # 对外入口
    # ---------------------------------------------------------
    def solve_dc(self, netlist: Netlist) -> dict:
        """求解直流工作点，返回节点电压、支路电流、功率、方程等。"""
        components = netlist.components

        # —— 1. 校验并建立节点索引（地 -> None，其余 -> 0..n-1） ——
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

        # —— 3. 组装 A 与 b ——
        A = np.zeros((size, size), dtype=float)
        b = np.zeros(size, dtype=float)

        def sv(row: int | None, col: int | None, val: float) -> None:
            """向矩阵 A 叠加一个元素（跳过地节点所在行列）。"""
            if row is not None and col is not None:
                A[row, col] += val

        def sb(row: int | None, val: float) -> None:
            """向向量 b 叠加一个元素（跳过地节点所在行）。"""
            if row is not None:
                b[row] += val

        for comp in components:
            self._stamp_component(comp, node_slot, i_slot, sv, sb)

        # —— 4. 求解线性方程组 ——
        x = self._solve_linear(A, b, size)

        # —— 5. 整理结果 ——
        node_voltages = {node.id: 0.0 for node in netlist.nodes}
        for node_id, slot in node_slot.items():
            if slot is not None:
                node_voltages[node_id] = float(x[slot])

        branch_currents = {
            comp.id: self._branch_current(comp, x, node_voltages, i_slot)
            for comp in components
        }
        powers = self._component_powers(components, node_voltages, branch_currents)

        unknowns = self._unknown_names(slot_to_node, i_slot)
        equations = self._format_equations(A, b, slot_to_node, i_slot)

        reference_id = sorted(reference_ids)[0]
        return {
            "node_voltages": node_voltages,
            "branch_currents": branch_currents,
            "powers": powers,
            "unknowns": unknowns,
            "equations": equations,
            "ground": reference_id,  # 兼容旧字段，等同 reference
            "reference": reference_id,
            "is_reference_ground": is_ground,
            "matrix": {"size": size, "A": A.tolist(), "b": b.tolist()},
        }

    # ---------------------------------------------------------
    # 校验与索引
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
    def _collect_grounds(netlist: Netlist) -> set[str]:
        """收集所有地节点：节点 isGround 标记 + ground 元件所连节点。"""
        grounds = {node.id for node in netlist.nodes if node.isGround}
        for comp in netlist.components:
            if comp.type == "ground" and comp.pins:
                grounds.add(comp.pins[0])
        return grounds

    @staticmethod
    def _select_reference(netlist: Netlist) -> tuple[set[str], bool]:
        """选择参考节点：优先接地；无地时取编号最小的节点。

        与符号版 SymbolicMNASolver._select_reference 保持一致，
        保证数值解与符号解采用同一参考点。

        :returns: (参考节点 id 集合, 参考是否为真实接地)
        """
        grounds = MNASolver._collect_grounds(netlist)
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
        """为需要电流未知量的支路分配矩阵下标。"""
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
                # 输出支路电流 + 控制探头电流
                i_slot[(comp.id, "i")] = nxt
                nxt += 1
                i_slot[(comp.id, "ictrl")] = nxt
                nxt += 1
            elif comp.type == "cccs":
                # 仅控制探头电流（输出为受控电流源）
                i_slot[(comp.id, "ictrl")] = nxt
                nxt += 1
            elif comp.type == "opamp_ideal":
                i_slot[(comp.id, "iout")] = nxt
                nxt += 1
            elif comp.type == "switch" and MNASolver._is_closed(comp):
                i_slot[(comp.id, "i")] = nxt
                nxt += 1
        return i_slot

    # ---------------------------------------------------------
    # 元件 stamp
    # ---------------------------------------------------------
    def _stamp_component(
        self,
        comp: NetlistComponent,
        node_slot: dict[str, int | None],
        i_slot: dict[tuple[str, str], int],
        sv,
        sb,
    ) -> None:
        """把单个元件 stamp 进 MNA 矩阵。"""
        t = comp.type

        if t == "ground":
            return  # 接地只作为参考点标记，不产生方程

        # —— 电阻：电导 stamp ——
        if t == "resistor":
            a, b = self._pins(comp, 2)
            r = self._value(comp)
            if r == 0:
                raise CircuitError("INVALID_VALUE", f"电阻 {comp.id} 的阻值不能为 0")
            g = 1.0 / r
            ra, rb = node_slot[a], node_slot[b]
            sv(ra, ra, g)
            sv(rb, rb, g)
            sv(ra, rb, -g)
            sv(rb, ra, -g)
            return

        # —— 独立电流源：内部电流方向 pins[0] -> pins[1] ——
        if t == "current_source":
            a, b = self._pins(comp, 2)
            i = self._value(comp)
            sb(node_slot[a], -i)
            sb(node_slot[b], i)
            return

        # —— 独立电压源：引入支路电流未知量 ——
        if t == "voltage_source":
            a, b = self._pins(comp, 2)
            self._stamp_branch_source(
                a, b, i_slot[(comp.id, "i")], self._value(comp), node_slot, sv, sb
            )
            return

        # —— VCVS：输出为电压源，约束叠加控制电压项 ——
        if t == "vcvs":
            a, b, c, d = self._pins(comp, 4)
            mu = self._value(comp)
            k = i_slot[(comp.id, "i")]
            self._stamp_branch_source(a, b, k, 0.0, node_slot, sv, sb)
            # v_a - v_b - mu*(v_c - v_d) = 0
            sv(k, node_slot[c], -mu)
            sv(k, node_slot[d], mu)
            return

        # —— VCCS：输出电流 = gm*(v_c - v_d) ——
        if t == "vccs":
            a, b, c, d = self._pins(comp, 4)
            gm = self._value(comp)
            ra, rb, rc, rd = node_slot[a], node_slot[b], node_slot[c], node_slot[d]
            sv(ra, rc, gm)
            sv(ra, rd, -gm)
            sv(rb, rc, -gm)
            sv(rb, rd, gm)
            return

        # —— CCVS：控制探头 + 受控电压源 ——
        if t == "ccvs":
            a, b, c, d = self._pins(comp, 4)
            r = self._value(comp)
            k_out = i_slot[(comp.id, "i")]
            k_ctrl = i_slot[(comp.id, "ictrl")]
            # (c,d) 间 0V 探头（v_c = v_d）
            self._stamp_branch_source(c, d, k_ctrl, 0.0, node_slot, sv, sb)
            # 输出支路
            self._stamp_branch_source(a, b, k_out, 0.0, node_slot, sv, sb)
            # v_a - v_b - r*i_ctrl = 0
            sv(k_out, k_ctrl, -r)
            return

        # —— CCCS：控制探头 + 受控电流源 ——
        if t == "cccs":
            a, b, c, d = self._pins(comp, 4)
            beta = self._value(comp)
            k_ctrl = i_slot[(comp.id, "ictrl")]
            self._stamp_branch_source(c, d, k_ctrl, 0.0, node_slot, sv, sb)
            # 输出电流 a->b = beta * i_ctrl
            sv(node_slot[a], k_ctrl, beta)
            sv(node_slot[b], k_ctrl, -beta)
            return

        # —— 理想运放：虚短 + 虚断 + 输出电流未知量 ——
        if t == "opamp_ideal":
            pin_plus, pin_minus, out = self._pins(comp, 3)
            k = i_slot[(comp.id, "iout")]
            # 输出端 KCL：i_out 为从运放流入 out 节点的电流
            sv(node_slot[out], k, -1.0)
            # 虚短约束 v_+ - v_- = 0（虚断 => 输入节点无额外电流项）
            sv(k, node_slot[pin_plus], 1.0)
            sv(k, node_slot[pin_minus], -1.0)
            sb(k, 0.0)
            return

        # —— 开关（闭合等效 0V 电压源；断开不 stamp） ——
        if t == "switch":
            if self._is_closed(comp):
                a, b = self._pins(comp, 2)
                self._stamp_branch_source(
                    a, b, i_slot[(comp.id, "i")], 0.0, node_slot, sv, sb
                )
            return

        raise CircuitError("UNSUPPORTED_COMPONENT", f"暂不支持的元件类型：{t}")

    def _stamp_branch_source(
        self,
        a: str,
        b: str,
        k: int,
        rhs: float,
        node_slot: dict[str, int | None],
        sv,
        sb,
    ) -> None:
        """stamp 一条「引入电流未知量」的电压型支路（电压源/VCVS/开关/探头）。"""
        ra, rb = node_slot[a], node_slot[b]
        # KCL 列：支路电流 i 自 a 端流入元件、由 b 端流出
        sv(ra, k, 1.0)
        sv(rb, k, -1.0)
        # 约束行：v_a - v_b = rhs（受控源的附加控制项由调用方叠加）
        sv(k, ra, 1.0)
        sv(k, rb, -1.0)
        sb(k, rhs)

    # ---------------------------------------------------------
    # 线性求解与奇异性判定
    # ---------------------------------------------------------
    @staticmethod
    def _solve_linear(A: np.ndarray, b: np.ndarray, size: int) -> np.ndarray:
        """求解 A·x = b；矩阵奇异时抛出明确的中文错误。"""
        try:
            if np.linalg.matrix_rank(A) < size:
                raise CircuitError(
                    "SINGULAR_MATRIX", "电路缺少参考地或存在电压源环路"
                )
            return np.linalg.solve(A, b)
        except np.linalg.LinAlgError as exc:  # pragma: no cover - 由 rank 检查兜底
            raise CircuitError(
                "SINGULAR_MATRIX", "电路缺少参考地或存在电压源环路"
            ) from exc

    # ---------------------------------------------------------
    # 结果派生
    # ---------------------------------------------------------
    def _branch_current(
        self,
        comp: NetlistComponent,
        x: np.ndarray,
        voltages: dict[str, float],
        i_slot: dict[tuple[str, str], int],
    ) -> float:
        """计算元件支路电流（正方向：pins[0] 流入元件）。"""
        t = comp.type
        if t == "resistor":
            a, b = comp.pins[0], comp.pins[1]
            return (voltages[a] - voltages[b]) / float(comp.value)
        if t == "current_source":
            return float(comp.value)
        if t in ("voltage_source", "vcvs", "ccvs"):
            return float(x[i_slot[(comp.id, "i")]])
        if t == "switch":
            key = (comp.id, "i")
            return float(x[i_slot[key]]) if key in i_slot else 0.0
        if t == "opamp_ideal":
            return float(x[i_slot[(comp.id, "iout")]])
        if t == "vccs":
            _, _, c, d = comp.pins
            return float(comp.value) * (voltages[c] - voltages[d])
        if t == "cccs":
            return float(comp.value) * float(x[i_slot[(comp.id, "ictrl")]])
        return 0.0

    @staticmethod
    def _component_powers(
        components: list[NetlistComponent],
        voltages: dict[str, float],
        currents: dict[str, float],
    ) -> dict[str, float]:
        """计算元件吸收功率 P = (v_a - v_b) * i（吸收为正）。"""
        powers: dict[str, float] = {}
        for comp in components:
            # 接地无功率；运放为三端器件，其端电压无单一含义，跳过
            if comp.type == "ground" or comp.type == "opamp_ideal":
                continue
            if len(comp.pins) < 2:
                continue
            a, b = comp.pins[0], comp.pins[1]
            v = voltages[a] - voltages[b]
            powers[comp.id] = v * currents[comp.id]
        return powers

    # ---------------------------------------------------------
    # 方程与未知量命名
    # ---------------------------------------------------------
    @staticmethod
    def _unknown_names(
        slot_to_node: list[str], i_slot: dict[tuple[str, str], int]
    ) -> list[str]:
        """按矩阵下标顺序给出未知量名称。"""
        names = [f"v({node})" for node in slot_to_node]
        by_slot = {slot: name for name, slot in _slot_label_map(i_slot).items()}
        for slot in range(len(slot_to_node), len(slot_to_node) + len(i_slot)):
            names.append(by_slot.get(slot, f"i{slot}"))
        return names

    def _format_equations(
        self,
        A: np.ndarray,
        b: np.ndarray,
        slot_to_node: list[str],
        i_slot: dict[tuple[str, str], int],
    ) -> list[str]:
        """把矩阵行格式化为可读的节点电压法方程字符串。"""
        label_by_slot = _slot_label_map(i_slot)
        n_nodes = len(slot_to_node)

        def var_name(j: int) -> str:
            if j < n_nodes:
                return f"v({slot_to_node[j]})"
            return label_by_slot.get(j, f"i{j}")

        lines: list[str] = []
        for row in range(A.shape[0]):
            terms = [
                f"{_fmt(A[row, j])}·{var_name(j)}"
                for j in range(A.shape[1])
                if abs(A[row, j]) > _ZERO
            ]
            lhs = " + ".join(terms) if terms else "0"
            if row < n_nodes:
                title = f"节点 KCL {slot_to_node[row]}"
            else:
                title = f"支路约束 {label_by_slot.get(row, '')}".rstrip()
            lines.append(f"{title}: {lhs} = {_fmt(b[row])}")
        return lines

    # ---------------------------------------------------------
    # 小工具
    # ---------------------------------------------------------
    @staticmethod
    def _pins(comp: NetlistComponent, expected: int) -> list[str]:
        """校验并返回引脚列表。"""
        if len(comp.pins) != expected:
            raise CircuitError(
                "INVALID_PINS",
                f"元件 {comp.id}（{comp.type}）需要 {expected} 个引脚，实际 {len(comp.pins)} 个",
            )
        return comp.pins

    @staticmethod
    def _value(comp: NetlistComponent) -> float:
        """读取并校验元件数值。"""
        if comp.value is None:
            raise CircuitError(
                "INVALID_VALUE", f"元件 {comp.id}（{comp.type}）缺少数值 value"
            )
        return float(comp.value)

    @staticmethod
    def _is_closed(comp: NetlistComponent) -> bool:
        """开关是否闭合。"""
        return bool(comp.params.get("closed", False))


def _slot_label_map(i_slot: dict[tuple[str, str], int]) -> dict[str, int]:
    """把 (元件id, 标签) -> 下标 映射转为 名称 -> 下标，用于方程可读化。"""
    labels: dict[str, int] = {}
    for (comp_id, tag), slot in i_slot.items():
        if tag == "i":
            labels[f"I({comp_id})"] = slot
        elif tag == "ictrl":
            labels[f"Ictrl({comp_id})"] = slot
        elif tag == "iout":
            labels[f"Iout({comp_id})"] = slot
    return labels


def _fmt(value: float) -> str:
    """数值格式化：保留 6 位有效数字，整数不带小数点。"""
    if value == 0:
        return "0"
    return f"{value:.6g}"

def _node_sort_key(node_id: str):
    """节点 id 排序键：n1 < n2 < … < na（非数字后缀按字典序靠后）。"""
    matched = re.match(r"^([A-Za-z_]*)(\d+)$", node_id)
    if matched:
        return (0, matched.group(1), int(matched.group(2)))
    return (1, node_id, 0)