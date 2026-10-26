# =============================================================
# MNASolver 单元测试 + /solve_dc 接口集成测试
# 误差容限统一为 1e-6
# =============================================================
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.schema.netlist import Netlist
from app.solver.errors import CircuitError
from app.solver.mna import MNASolver
from tests import circuits

TOL = 1e-6


def solve(circuit: dict) -> dict:
    """便捷入口：直接调用求解器。"""
    return MNASolver().solve_dc(Netlist(**circuit))


# -------------------------------------------------------------
# 核心用例 a-d
# -------------------------------------------------------------
def test_divider_node_voltage():
    """用例 a：分压电路，节点 n1 应为 2.5V。"""
    result = solve(circuits.divider())
    assert abs(result["node_voltages"]["na"] - 5.0) < TOL
    assert abs(result["node_voltages"]["n1"] - 2.5) < TOL

    # 支路电流与功率
    assert abs(result["branch_currents"]["R1"] - 0.0025) < TOL
    assert abs(result["powers"]["R1"] - 0.00625) < TOL
    assert abs(result["powers"]["V1"] + 0.0125) < TOL  # 电源发出功率（吸收为负）

    # 地电压恒为 0
    assert result["node_voltages"]["n0"] == 0.0


def test_wheatstone_bridge():
    """用例 b：惠斯通电桥两桥臂中点电压。"""
    result = solve(circuits.wheatstone())
    v_a = result["node_voltages"]["nA"]
    v_b = result["node_voltages"]["nB"]
    assert abs(v_a - 5.0) < TOL
    assert abs(v_b - 10.0 * 2000.0 / 3000.0) < TOL
    # 桥臂不平衡，压差约 1.6667V
    assert abs((v_b - v_a) - (10.0 * 2.0 / 3.0 - 5.0)) < TOL


def test_vcvs():
    """用例 c：VCVS 增益 2，输出应为 10V。"""
    result = solve(circuits.vcvs())
    assert abs(result["node_voltages"]["na"] - 5.0) < TOL
    assert abs(result["node_voltages"]["nb"] - 10.0) < TOL


def test_opamp_inverting():
    """用例 d：理想运放反相放大，Vo = -10V 且虚地 vn = 0V。"""
    result = solve(circuits.opamp_inverting())
    assert abs(result["node_voltages"]["vn"]) < TOL
    assert abs(result["node_voltages"]["vo"] + 10.0) < TOL
    # 反馈电流 = (0 - (-10))/10k = 1mA
    assert abs(result["branch_currents"]["R2"] - 0.001) < TOL


# -------------------------------------------------------------
# 其余元件
# -------------------------------------------------------------
def test_vccs():
    """VCCS：gm=1mS，控制 1V，负载上得到 -1V。"""
    result = solve(circuits.vccs())
    assert abs(result["node_voltages"]["nb"] + 1.0) < TOL


def test_cccs():
    """CCCS：β=2，控制 1mA，负载上得到 -2V。"""
    result = solve(circuits.cccs())
    assert abs(result["node_voltages"]["nb"] + 2.0) < TOL


def test_ccvs():
    """CCVS：r=1kΩ，控制 1mA，输出 1V。"""
    result = solve(circuits.ccvs())
    assert abs(result["node_voltages"]["nb"] - 1.0) < TOL


def test_current_source():
    """独立电流源：1mA 流入 1kΩ，节点电压 -1V。"""
    result = solve(circuits.current_source())
    assert abs(result["node_voltages"]["na"] + 1.0) < TOL
    assert abs(result["branch_currents"]["I1"] - 0.001) < TOL


def test_switch_closed():
    """闭合开关等效短路，负载获得 5V。"""
    result = solve(circuits.switch_closed())
    assert abs(result["node_voltages"]["nb"] - 5.0) < TOL


# -------------------------------------------------------------
# 方程展示
# -------------------------------------------------------------
def test_equations_present():
    """应返回可读的节点电压法方程字符串。"""
    result = solve(circuits.divider())
    equations = result["equations"]
    assert len(equations) >= 3
    assert any("节点 KCL n1" in line for line in equations)
    assert any("v(n1)" in line for line in equations)
    # 未知量名称包含节点电压与支路电流
    assert "v(n1)" in result["unknowns"]
    assert any(name.startswith("I(V1)") for name in result["unknowns"])


# -------------------------------------------------------------
# 错误场景
# -------------------------------------------------------------
def test_no_ground_auto_reference():
    """无接地时自动选编号最小节点作参考，不再报 NO_GROUND。"""
    result = solve(circuits.no_ground())
    assert result["is_reference_ground"] is False
    assert result["reference"] == "n1"
    assert result["ground"] == "n1"  # 兼容别名
    # 纯电阻无源电路，两端相对参考点电压均为 0
    assert abs(result["node_voltages"]["n1"]) < TOL
    assert abs(result["node_voltages"]["n2"]) < TOL


def test_voltage_source_loop_raises():
    """电压源环路应抛出 SINGULAR_MATRIX。"""
    with pytest.raises(CircuitError) as excinfo:
        solve(circuits.voltage_loop())
    assert excinfo.value.code == "SINGULAR_MATRIX"
    assert "缺少参考地" in excinfo.value.message or "电压源环路" in excinfo.value.message


def test_unknown_node_raises():
    """元件引用未定义节点应报错。"""
    bad = {
        "nodes": [{"id": "n0", "isGround": True}],
        "components": [
            {"id": "R1", "type": "resistor", "pins": ["n0", "nX"], "value": 1000.0}
        ],
    }
    with pytest.raises(CircuitError) as excinfo:
        solve(bad)
    assert excinfo.value.code == "UNKNOWN_NODE"


# -------------------------------------------------------------
# 接口集成测试
# -------------------------------------------------------------
def test_api_solve_dc_success():
    """POST /solve_dc 返回结构清晰、前端可直接使用。"""
    client = TestClient(app)
    response = client.post("/solve_dc", json=circuits.divider())
    assert response.status_code == 200

    body = response.json()
    assert body["ok"] is True
    assert body["error"] is None
    data = body["data"]
    assert abs(data["node_voltages"]["n1"] - 2.5) < TOL
    assert set(data.keys()) >= {
        "node_voltages",
        "branch_currents",
        "powers",
        "equations",
        "unknowns",
        "ground",
        "reference",
        "is_reference_ground",
        "matrix",
    }
    assert data["is_reference_ground"] is True


def test_api_solve_dc_error_shape():
    """错误响应保持统一结构：ok=false + error.code。"""
    client = TestClient(app)
    response = client.post("/solve_dc", json=circuits.voltage_loop())
    assert response.status_code == 200

    body = response.json()
    assert body["ok"] is False
    assert body["data"] is None
    assert body["error"]["code"] == "SINGULAR_MATRIX"
    assert "电压源环路" in body["error"]["message"]


def test_health():
    """健康检查。"""
    client = TestClient(app)
    assert client.get("/health").json()["ok"] is True