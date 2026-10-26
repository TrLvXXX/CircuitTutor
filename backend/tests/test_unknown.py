# =============================================================
# UnknownSolver 未知量反解单元测试 + /solve_unknowns 接口测试
# =============================================================
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.schema.netlist import Netlist
from app.solver.errors import CircuitError
from app.solver.unknown_solver import UnknownSolver

TOL = 1e-6


def solve_unknowns(circuit: dict, measurements: list[dict] | None = None) -> dict:
    return UnknownSolver().solve_unknowns(Netlist(**circuit), measurements)


# -------------------------------------------------------------
# 条件不足：分压电路中电阻未知
# -------------------------------------------------------------
def test_undetermined_resistor():
    """V1 与未知电阻 R1 并联：无额外约束，R1 不可唯一确定。"""
    circuit = {
        "nodes": [{"id": "n0", "isGround": True}, {"id": "na"}],
        "components": [
            {"id": "V1", "type": "voltage_source", "pins": ["na", "n0"], "value": 10.0},
            {
                "id": "R1",
                "type": "resistor",
                "pins": ["na", "n0"],
                "value": 1000.0,
                "params": {"unknown": True},
            },
        ],
    }
    result = solve_unknowns(circuit)
    assert result["resolved"] is False
    assert "R1" in result["undetermined"]


# -------------------------------------------------------------
# 可确定：理想运放跟随器强制未知电压源的值
# -------------------------------------------------------------
def test_opamp_forces_unknown_source():
    """运放虚短：in+ 接已知 5V，in-/out 接未知电压源 V2，则 V2 = 5V。"""
    circuit = {
        "nodes": [
            {"id": "n0", "isGround": True},
            {"id": "n1"},
            {"id": "n2"},
        ],
        "components": [
            {"id": "V1", "type": "voltage_source", "pins": ["n1", "n0"], "value": 5.0},
            # 运放：in+ = n1, in- = n2, out = n2
            {"id": "A1", "type": "opamp_ideal", "pins": ["n1", "n2", "n2"], "value": 0.0},
            {
                "id": "V2",
                "type": "voltage_source",
                "pins": ["n2", "n0"],
                "value": 1.0,
                "params": {"unknown": True},
            },
        ],
    }
    result = solve_unknowns(circuit)
    assert result["resolved"] is True
    assert abs(result["solved"]["V2"] - 5.0) < TOL


# -------------------------------------------------------------
# 无未知量标记
# -------------------------------------------------------------
def test_no_unknown_marked():
    circuit = {
        "nodes": [{"id": "n0", "isGround": True}, {"id": "na"}],
        "components": [
            {"id": "V1", "type": "voltage_source", "pins": ["na", "n0"], "value": 10.0},
            {"id": "R1", "type": "resistor", "pins": ["na", "n0"], "value": 1000.0},
        ],
    }
    with pytest.raises(CircuitError) as excinfo:
        solve_unknowns(circuit)
    assert excinfo.value.code == "NO_UNKNOWN"


# -------------------------------------------------------------
# 测量值辅助求解：未知电阻 + 已知节点间电流 → 可确定
# -------------------------------------------------------------
def test_measurement_current_determines_resistor():
    """V1(10V) 与 V2(5V) 固定 R1 两端电压，测得 I(n2→n1)=0.005A → R1=1000Ω。"""
    circuit = {
        "nodes": [{"id": "n0", "isGround": True}, {"id": "n1"}, {"id": "n2"}],
        "components": [
            {"id": "V1", "type": "voltage_source", "pins": ["n2", "n0"], "value": 10.0},
            {"id": "V2", "type": "voltage_source", "pins": ["n1", "n0"], "value": 5.0},
            {
                "id": "R1",
                "type": "resistor",
                "pins": ["n2", "n1"],
                "value": 1.0,
                "params": {"unknown": True},
            },
        ],
    }
    measurements = [{"type": "current", "node_a": "n2", "node_b": "n1", "value": 0.005}]
    result = solve_unknowns(circuit, measurements)
    assert result["resolved"] is True
    assert abs(result["solved"]["R1"] - 1000.0) < TOL


def test_measurement_current_no_component():
    """节点对之间不存在元件 → INVALID_MEASUREMENT。"""
    circuit = {
        "nodes": [{"id": "n0", "isGround": True}, {"id": "na"}, {"id": "nb"}],
        "components": [
            {"id": "V1", "type": "voltage_source", "pins": ["na", "n0"], "value": 10.0},
            {
                "id": "R1",
                "type": "resistor",
                "pins": ["na", "n0"],
                "value": 1000.0,
                "params": {"unknown": True},
            },
        ],
    }
    measurements = [{"type": "current", "node_a": "na", "node_b": "nb", "value": 0.01}]
    with pytest.raises(CircuitError) as excinfo:
        solve_unknowns(circuit, measurements)
    assert excinfo.value.code == "INVALID_MEASUREMENT"


def test_measurement_current_ambiguous():
    """节点对之间存在多个元件 → INVALID_MEASUREMENT（无法唯一确定电流）。"""
    circuit = {
        "nodes": [{"id": "n0", "isGround": True}, {"id": "na"}],
        "components": [
            {"id": "V1", "type": "voltage_source", "pins": ["na", "n0"], "value": 10.0},
            {
                "id": "R1",
                "type": "resistor",
                "pins": ["na", "n0"],
                "value": 1.0,
                "params": {"unknown": True},
            },
        ],
    }
    measurements = [{"type": "current", "node_a": "na", "node_b": "n0", "value": 0.01}]
    with pytest.raises(CircuitError) as excinfo:
        solve_unknowns(circuit, measurements)
    assert excinfo.value.code == "INVALID_MEASUREMENT"


def test_measurement_voltage_determines_resistor():
    """分压电路 V1(10V)-R1(1000Ω)-R2(未知)-GND，用户测得 V(n1)=5V → R2=1000Ω。"""
    circuit = {
        "nodes": [{"id": "n0", "isGround": True}, {"id": "n1"}, {"id": "n2"}],
        "components": [
            {"id": "V1", "type": "voltage_source", "pins": ["n2", "n0"], "value": 10.0},
            {"id": "R1", "type": "resistor", "pins": ["n2", "n1"], "value": 1000.0},
            {
                "id": "R2",
                "type": "resistor",
                "pins": ["n1", "n0"],
                "value": 1.0,
                "params": {"unknown": True},
            },
        ],
    }
    measurements = [{"type": "voltage", "node_id": "n1", "value": 5.0}]
    result = solve_unknowns(circuit, measurements)
    assert result["resolved"] is True
    assert abs(result["solved"]["R2"] - 1000.0) < TOL


def test_measurement_voltage_diff_determines_resistor():
    """分压电路，用户测得 V(n2)-V(n1)=5V → R2=1000Ω。"""
    circuit = {
        "nodes": [{"id": "n0", "isGround": True}, {"id": "n1"}, {"id": "n2"}],
        "components": [
            {"id": "V1", "type": "voltage_source", "pins": ["n2", "n0"], "value": 10.0},
            {"id": "R1", "type": "resistor", "pins": ["n2", "n1"], "value": 1000.0},
            {
                "id": "R2",
                "type": "resistor",
                "pins": ["n1", "n0"],
                "value": 1.0,
                "params": {"unknown": True},
            },
        ],
    }
    measurements = [{"type": "voltage_diff", "node_a": "n2", "node_b": "n1", "value": 5.0}]
    result = solve_unknowns(circuit, measurements)
    assert result["resolved"] is True
    assert abs(result["solved"]["R2"] - 1000.0) < TOL


# -------------------------------------------------------------
# 接口集成
# -------------------------------------------------------------
def test_api_solve_unknowns_undetermined():
    client = TestClient(app)
    circuit = {
        "nodes": [{"id": "n0", "isGround": True}, {"id": "na"}],
        "components": [
            {"id": "V1", "type": "voltage_source", "pins": ["na", "n0"], "value": 10.0},
            {
                "id": "R1",
                "type": "resistor",
                "pins": ["na", "n0"],
                "value": 1000.0,
                "params": {"unknown": True},
            },
        ],
    }
    response = client.post("/solve_unknowns", json={"netlist": circuit, "measurements": []})
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["data"]["resolved"] is False


def test_api_solve_unknowns_resolved():
    client = TestClient(app)
    circuit = {
        "nodes": [{"id": "n0", "isGround": True}, {"id": "n1"}, {"id": "n2"}],
        "components": [
            {"id": "V1", "type": "voltage_source", "pins": ["n1", "n0"], "value": 5.0},
            {"id": "A1", "type": "opamp_ideal", "pins": ["n1", "n2", "n2"], "value": 0.0},
            {
                "id": "V2",
                "type": "voltage_source",
                "pins": ["n2", "n0"],
                "value": 1.0,
                "params": {"unknown": True},
            },
        ],
    }
    response = client.post("/solve_unknowns", json={"netlist": circuit, "measurements": []})
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["data"]["resolved"] is True
    assert abs(body["data"]["solved"]["V2"] - 5.0) < TOL


def test_api_solve_unknowns_with_measurement():
    """接口集成：未知电阻 + 节点间电流测量值 → 可确定。"""
    client = TestClient(app)
    circuit = {
        "nodes": [{"id": "n0", "isGround": True}, {"id": "n1"}, {"id": "n2"}],
        "components": [
            {"id": "V1", "type": "voltage_source", "pins": ["n2", "n0"], "value": 10.0},
            {"id": "V2", "type": "voltage_source", "pins": ["n1", "n0"], "value": 5.0},
            {
                "id": "R1",
                "type": "resistor",
                "pins": ["n2", "n1"],
                "value": 1.0,
                "params": {"unknown": True},
            },
        ],
    }
    response = client.post("/solve_unknowns", json={
        "netlist": circuit,
        "measurements": [{"type": "current", "node_a": "n2", "node_b": "n1", "value": 0.005}],
    })
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["data"]["resolved"] is True
    assert abs(body["data"]["solved"]["R1"] - 1000.0) < TOL