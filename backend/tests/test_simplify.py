# =============================================================
# Simplifier 单元测试 + /simplify、/thevenin 接口集成测试
# =============================================================
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.schema.netlist import Netlist
from app.solver.errors import CircuitError
from app.solver.simplify import Simplifier

TOL = 1e-6


def simplify(circuit: dict) -> dict:
    return Simplifier().simplify(Netlist(**circuit))


# -------------------------------------------------------------
# 串/并联识别
# -------------------------------------------------------------
def test_series_resistors():
    """串联：R1+R2 共享仅连接它俩的中间节点。"""
    circuit = {
        "nodes": [{"id": "n0", "isGround": True}, {"id": "n1"}, {"id": "na"}],
        "components": [
            {"id": "V1", "type": "voltage_source", "pins": ["na", "n0"], "value": 5.0},
            {"id": "R1", "type": "resistor", "pins": ["na", "n1"], "value": 1000.0},
            {"id": "R2", "type": "resistor", "pins": ["n1", "n0"], "value": 1000.0},
        ],
    }
    result = simplify(circuit)
    series_steps = [s for s in result["steps"] if s["type"] == "series"]
    assert len(series_steps) >= 1
    assert abs(series_steps[0]["merged_value"] - 2000.0) < TOL


def test_parallel_resistors():
    """并联：R1∥R2 连同一对节点。"""
    circuit = {
        "nodes": [{"id": "n0", "isGround": True}, {"id": "na"}],
        "components": [
            {"id": "R1", "type": "resistor", "pins": ["na", "n0"], "value": 1000.0},
            {"id": "R2", "type": "resistor", "pins": ["na", "n0"], "value": 2000.0},
        ],
    }
    result = simplify(circuit)
    parallel_steps = [s for s in result["steps"] if s["type"] == "parallel"]
    assert len(parallel_steps) >= 1
    assert abs(parallel_steps[0]["merged_value"] - (1000 * 2000 / 3000)) < TOL


def test_no_simplification():
    """单个电阻无可简化。"""
    circuit = {
        "nodes": [{"id": "n0", "isGround": True}, {"id": "na"}],
        "components": [
            {"id": "R1", "type": "resistor", "pins": ["na", "n0"], "value": 1000.0},
        ],
    }
    result = simplify(circuit)
    assert result["steps"] == []


def test_series_not_detected_with_extra_connection():
    """中间节点连了第三个元件时不算串联。"""
    circuit = {
        "nodes": [{"id": "n0", "isGround": True}, {"id": "n1"}, {"id": "na"}],
        "components": [
            {"id": "V1", "type": "voltage_source", "pins": ["na", "n0"], "value": 5.0},
            {"id": "R1", "type": "resistor", "pins": ["na", "n1"], "value": 1000.0},
            {"id": "R2", "type": "resistor", "pins": ["n1", "n0"], "value": 1000.0},
            {"id": "R3", "type": "resistor", "pins": ["n1", "n0"], "value": 500.0},
        ],
    }
    result = simplify(circuit)
    series_steps = [s for s in result["steps"] if s["type"] == "series"]
    assert len(series_steps) == 0


def test_series_chain_three_resistors():
    """三电阻串联链 R1-R2-R3 合并为一个步骤，阻值之和。"""
    circuit = {
        "nodes": [
            {"id": "n0", "isGround": True},
            {"id": "n1"},
            {"id": "n2"},
            {"id": "na"},
        ],
        "components": [
            {"id": "V1", "type": "voltage_source", "pins": ["na", "n0"], "value": 5.0},
            {"id": "R1", "type": "resistor", "pins": ["na", "n1"], "value": 1000.0},
            {"id": "R2", "type": "resistor", "pins": ["n1", "n2"], "value": 2000.0},
            {"id": "R3", "type": "resistor", "pins": ["n2", "n0"], "value": 3000.0},
        ],
    }
    result = simplify(circuit)
    series_steps = [s for s in result["steps"] if s["type"] == "series"]
    assert len(series_steps) == 1
    step = series_steps[0]
    assert set(step["components"]) == {"R1", "R2", "R3"}
    assert abs(step["merged_value"] - 6000.0) < TOL
    assert set(step["nodes"]) == {"n1", "n2"}


def test_parallel_three_resistors():
    """三电阻并联 R1∥R2∥R3 合并为一个步骤。"""
    circuit = {
        "nodes": [{"id": "n0", "isGround": True}, {"id": "na"}],
        "components": [
            {"id": "R1", "type": "resistor", "pins": ["na", "n0"], "value": 1000.0},
            {"id": "R2", "type": "resistor", "pins": ["na", "n0"], "value": 2000.0},
            {"id": "R3", "type": "resistor", "pins": ["na", "n0"], "value": 3000.0},
        ],
    }
    result = simplify(circuit)
    parallel_steps = [s for s in result["steps"] if s["type"] == "parallel"]
    assert len(parallel_steps) == 1
    step = parallel_steps[0]
    assert set(step["components"]) == {"R1", "R2", "R3"}
    expected = 1.0 / (1.0 / 1000 + 1.0 / 2000 + 1.0 / 3000)
    assert abs(step["merged_value"] - expected) < TOL
    assert set(step["nodes"]) == {"n0", "na"}


def test_step_has_nodes_field():
    """每个步骤都应包含 nodes 字段。"""
    circuit = {
        "nodes": [{"id": "n0", "isGround": True}, {"id": "n1"}, {"id": "na"}],
        "components": [
            {"id": "R1", "type": "resistor", "pins": ["na", "n1"], "value": 1000.0},
            {"id": "R2", "type": "resistor", "pins": ["n1", "n0"], "value": 1000.0},
        ],
    }
    result = simplify(circuit)
    for step in result["steps"]:
        assert "nodes" in step
        assert isinstance(step["nodes"], list)


# -------------------------------------------------------------
# 戴维南等效
# -------------------------------------------------------------
def test_thevenin():
    """分压电路 na-n0 端口：Vth=5V, Rth=R1∥R2=500Ω。"""
    circuit = {
        "nodes": [{"id": "n0", "isGround": True}, {"id": "na"}, {"id": "nb"}],
        "components": [
            {"id": "V1", "type": "voltage_source", "pins": ["nb", "n0"], "value": 10.0},
            {"id": "R1", "type": "resistor", "pins": ["nb", "na"], "value": 1000.0},
            {"id": "R2", "type": "resistor", "pins": ["na", "n0"], "value": 1000.0},
        ],
    }
    result = Simplifier().thevenin(Netlist(**circuit), "na", "n0")
    assert abs(result["vth"] - 5.0) < TOL
    assert abs(result["rth"] - 500.0) < TOL


def test_thevenin_invalid_port():
    """端口节点不存在应报错。"""
    circuit = {
        "nodes": [{"id": "n0", "isGround": True}, {"id": "na"}],
        "components": [
            {"id": "R1", "type": "resistor", "pins": ["na", "n0"], "value": 1000.0},
        ],
    }
    with pytest.raises(CircuitError) as excinfo:
        Simplifier().thevenin(Netlist(**circuit), "nX", "n0")
    assert excinfo.value.code == "INVALID_PORT"


# -------------------------------------------------------------
# 接口集成
# -------------------------------------------------------------
def test_api_simplify():
    """POST /simplify 返回简化步骤。"""
    client = TestClient(app)
    circuit = {
        "nodes": [{"id": "n0", "isGround": True}, {"id": "na"}],
        "components": [
            {"id": "R1", "type": "resistor", "pins": ["na", "n0"], "value": 1000.0},
            {"id": "R2", "type": "resistor", "pins": ["na", "n0"], "value": 2000.0},
        ],
    }
    response = client.post("/simplify", json=circuit)
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert len(body["data"]["steps"]) >= 1


def test_api_thevenin():
    """POST /thevenin 返回戴维南参数。"""
    client = TestClient(app)
    circuit = {
        "nodes": [{"id": "n0", "isGround": True}, {"id": "na"}, {"id": "nb"}],
        "components": [
            {"id": "V1", "type": "voltage_source", "pins": ["nb", "n0"], "value": 10.0},
            {"id": "R1", "type": "resistor", "pins": ["nb", "na"], "value": 1000.0},
            {"id": "R2", "type": "resistor", "pins": ["na", "n0"], "value": 1000.0},
        ],
    }
    response = client.post(
        "/thevenin",
        json={"netlist": circuit, "port_a": "na", "port_b": "n0"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert abs(body["data"]["vth"] - 5.0) < TOL
    assert abs(body["data"]["rth"] - 500.0) < TOL