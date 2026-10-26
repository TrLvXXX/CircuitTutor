# =============================================================
# SymbolicMNASolver 单元测试 + /solve_symbolic 接口集成测试
# 验收重点：分压电路 Vout = R2/(R1+R2)*Vin 的解析表达式。
# =============================================================
import sympy as sp
from fastapi.testclient import TestClient

from app.main import app
from app.schema.netlist import Netlist
from app.solver.errors import CircuitError
from app.solver.symbolic_solver import SymbolicMNASolver

client = TestClient(app)


def _sym(circuit: dict, symbolic: list[str] | None = None) -> dict:
    """便捷入口：全符号或半符号求解。"""
    return SymbolicMNASolver().solve_symbolic(
        Netlist(**circuit, symbolic=symbolic or [])
    )


def _parse(expr_str: str) -> sp.Expr:
    """把返回的表达式字符串解析回 SymPy 表达式以便断言等价。"""
    return sp.sympify(expr_str)


# -------------------------------------------------------------
# 验收核心：分压电路解析表达式
# -------------------------------------------------------------
def test_divider_symbolic_expression():
    """分压电路：Vout = R2/(R1+R2)*Vin（全符号）。"""
    circuit = {
        "nodes": [{"id": "n0", "isGround": True}, {"id": "na"}, {"id": "n1"}],
        "components": [
            {"id": "V1", "type": "voltage_source", "pins": ["na", "n0"]},
            {"id": "R1", "type": "resistor", "pins": ["na", "n1"]},
            {"id": "R2", "type": "resistor", "pins": ["n1", "n0"]},
        ],
    }
    result = _sym(circuit)

    R1, R2, V1 = sp.symbols("R1 R2 V1")
    vout = _parse(result["node_voltages"]["n1"])
    # 与标准分压公式之差化简为 0
    assert sp.simplify(vout - R2 / (R1 + R2) * V1) == 0
    # 电源节点电压即源电压
    assert sp.simplify(_parse(result["node_voltages"]["na"]) - V1) == 0
    # 回路电流 i(V1) = -Vin/(R1+R2)
    assert sp.simplify(_parse(result["branch_currents"]["V1"]) + V1 / (R1 + R2)) == 0
    assert set(result["symbols"]) == {"R1", "R2", "V1"}


def test_divider_symbolic_with_numeric_source():
    """半符号：仅保留 R1、R2 为符号，Vin 代入 5V。"""
    circuit = {
        "nodes": [{"id": "n0", "isGround": True}, {"id": "na"}, {"id": "n1"}],
        "components": [
            {"id": "V1", "type": "voltage_source", "pins": ["na", "n0"], "value": 5.0},
            {"id": "R1", "type": "resistor", "pins": ["na", "n1"]},
            {"id": "R2", "type": "resistor", "pins": ["n1", "n0"]},
        ],
    }
    result = _sym(circuit, symbolic=["R1", "R2"])

    R1, R2 = sp.symbols("R1 R2")
    vout = _parse(result["node_voltages"]["n1"])
    assert sp.simplify(vout - 5 * R2 / (R1 + R2)) == 0
    # 符号表只含 R1、R2；V1 被代入数值
    assert set(result["symbols"]) == {"R1", "R2"}
    assert result["substituted"]["V1"] == 5.0


def test_symbolic_matches_numeric_substitution():
    """符号解在代入数值后应与数值求解结果一致（Vout=2.5V）。"""
    R1, R2, V1 = sp.symbols("R1 R2 V1")
    circuit = {
        "nodes": [{"id": "n0", "isGround": True}, {"id": "na"}, {"id": "n1"}],
        "components": [
            {"id": "V1", "type": "voltage_source", "pins": ["na", "n0"]},
            {"id": "R1", "type": "resistor", "pins": ["na", "n1"]},
            {"id": "R2", "type": "resistor", "pins": ["n1", "n0"]},
        ],
    }
    vout = _parse(_sym(circuit)["node_voltages"]["n1"])
    value = float(vout.subs({R1: 1000, R2: 1000, V1: 5}))
    assert abs(value - 2.5) < 1e-9


# -------------------------------------------------------------
# 参考节点策略：无接地自动选参考
# -------------------------------------------------------------
def test_symbolic_without_ground_uses_reference():
    """无接地电路：自动选编号最小的节点作参考，结果标记非真实接地。"""
    circuit = {
        "nodes": [{"id": "n1"}, {"id": "n2"}],
        "components": [
            {"id": "V1", "type": "voltage_source", "pins": ["n1", "n2"]},
            {"id": "R1", "type": "resistor", "pins": ["n2", "n1"]},
        ],
    }
    result = _sym(circuit)
    assert result["reference"] == "n1"
    assert result["is_reference_ground"] is False
    assert result["node_voltages"]["n1"] == "0"
    # v(n2) = -V1（n1->n2 为源正方向，参考在 n1）
    V1 = sp.Symbol("V1")
    assert sp.simplify(_parse(result["node_voltages"]["n2"]) + V1) == 0
    assert any("未接地" in note for note in result["notes"])


# -------------------------------------------------------------
# 错误与边界
# -------------------------------------------------------------
def test_symbolic_reference_is_real_ground():
    """有接地时参考即真实接地，标记为 True。"""
    circuit = {
        "nodes": [{"id": "n0", "isGround": True}, {"id": "na"}],
        "components": [
            {"id": "V1", "type": "voltage_source", "pins": ["na", "n0"]},
            {"id": "R1", "type": "resistor", "pins": ["na", "n0"]},
        ],
    }
    result = _sym(circuit)
    assert result["reference"] == "n0"
    assert result["is_reference_ground"] is True


def test_symbolic_unknown_symbolic_id():
    """symbolic 白名单引用不存在的元件应报 UNKNOWN_SYMBOLIC。"""
    circuit = {
        "nodes": [{"id": "n0", "isGround": True}, {"id": "na"}],
        "components": [
            {"id": "V1", "type": "voltage_source", "pins": ["na", "n0"], "value": 5.0},
            {"id": "R1", "type": "resistor", "pins": ["na", "n0"], "value": 1000.0},
        ],
    }
    try:
        _sym(circuit, symbolic=["R404"])
    except CircuitError as exc:
        assert exc.code == "UNKNOWN_SYMBOLIC"
    else:  # pragma: no cover
        raise AssertionError("应当抛出 UNKNOWN_SYMBOLIC")


def test_symbolic_too_large():
    """矩阵规模超限时返回 SYMBOLIC_TOO_LARGE 明确错误。"""
    # 构造一条长链电阻，节点数超过上限
    n = 14
    nodes = [{"id": "n0", "isGround": True}] + [{"id": f"n{i}"} for i in range(1, n)]
    comps = [
        {"id": "V1", "type": "voltage_source", "pins": ["n1", "n0"]},
    ]
    for i in range(1, n - 1):
        comps.append({"id": f"R{i}", "type": "resistor", "pins": [f"n{i}", f"n{i+1}"]})
    try:
        _sym({"nodes": nodes, "components": comps})
    except CircuitError as exc:
        assert exc.code == "SYMBOLIC_TOO_LARGE"
    else:  # pragma: no cover
        raise AssertionError("应当抛出 SYMBOLIC_TOO_LARGE")


# -------------------------------------------------------------
# 接口集成
# -------------------------------------------------------------
def test_api_solve_symbolic_ok():
    """POST /solve_symbolic 返回 {ok,data,error} 且含解析表达式。"""
    circuit = {
        "nodes": [{"id": "n0", "isGround": True}, {"id": "na"}, {"id": "n1"}],
        "components": [
            {"id": "V1", "type": "voltage_source", "pins": ["na", "n0"]},
            {"id": "R1", "type": "resistor", "pins": ["na", "n1"]},
            {"id": "R2", "type": "resistor", "pins": ["n1", "n0"]},
        ],
        "symbolic": [],
    }
    resp = client.post("/solve_symbolic", json=circuit)
    body = resp.json()
    assert resp.status_code == 200
    assert body["ok"] is True
    assert body["error"] is None

    R1, R2, V1 = sp.symbols("R1 R2 V1")
    vout = sp.sympify(body["data"]["node_voltages"]["n1"])
    assert sp.simplify(vout - R2 / (R1 + R2) * V1) == 0


def test_api_solve_symbolic_error():
    """接口错误路径：白名单引用不存在元件返回 ok=false 与错误码。"""
    circuit = {
        "nodes": [{"id": "n0", "isGround": True}, {"id": "na"}],
        "components": [
            {"id": "V1", "type": "voltage_source", "pins": ["na", "n0"], "value": 5.0},
            {"id": "R1", "type": "resistor", "pins": ["na", "n0"], "value": 1000.0},
        ],
        "symbolic": ["R404"],
    }
    resp = client.post("/solve_symbolic", json=circuit)
    body = resp.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "UNKNOWN_SYMBOLIC"