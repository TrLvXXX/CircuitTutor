# =============================================================
# 测试用电路网表构造函数
# 返回可直接传给 Netlist(**circuit) 的字典。
# =============================================================
from typing import Any


def _n(nid: str, ground: bool = False) -> dict:
    """构造节点。"""
    return {"id": nid, "isGround": ground}


def _c(cid: str, ctype: str, pins: list[str], value: float | None = None, **params: Any) -> dict:
    """构造元件。"""
    comp: dict[str, Any] = {"id": cid, "type": ctype, "pins": pins}
    if value is not None:
        comp["value"] = value
    if params:
        comp["params"] = params
    return comp


def divider() -> dict:
    """用例 a：5V 经两 1kΩ 分压，节点 n1 期望 2.5V。"""
    return {
        "nodes": [_n("n0", True), _n("na"), _n("n1")],
        "components": [
            _c("V1", "voltage_source", ["na", "n0"], 5.0),
            _c("R1", "resistor", ["na", "n1"], 1000.0),
            _c("R2", "resistor", ["n1", "n0"], 1000.0),
        ],
    }


def wheatstone() -> dict:
    """用例 b：惠斯通电桥（R1=R2=1k，R3=1k，R4=2k，电源 10V）。"""
    return {
        "nodes": [_n("n0", True), _n("na"), _n("nA"), _n("nB")],
        "components": [
            _c("V1", "voltage_source", ["na", "n0"], 10.0),
            _c("R1", "resistor", ["na", "nA"], 1000.0),
            _c("R2", "resistor", ["nA", "n0"], 1000.0),
            _c("R3", "resistor", ["na", "nB"], 1000.0),
            _c("R4", "resistor", ["nB", "n0"], 2000.0),
        ],
    }


def vcvs() -> dict:
    """用例 c：VCVS 增益 2，控制 5V，输出电压期望 10V。"""
    return {
        "nodes": [_n("n0", True), _n("na"), _n("nb")],
        "components": [
            _c("V1", "voltage_source", ["na", "n0"], 5.0),
            # E1：输出 (nb,n0)，控制 (na,n0)，增益 2
            _c("E1", "vcvs", ["nb", "n0", "na", "n0"], 2.0),
            _c("RL", "resistor", ["nb", "n0"], 1000.0),
        ],
    }


def opamp_inverting() -> dict:
    """用例 d：理想运放反相放大，R1=1k，R2=10k，Vin=1V，期望 Vo=-10V。"""
    return {
        "nodes": [_n("n0", True), _n("vin"), _n("vn"), _n("vo")],
        "components": [
            _c("V1", "voltage_source", ["vin", "n0"], 1.0),
            _c("R1", "resistor", ["vin", "vn"], 1000.0),
            _c("R2", "resistor", ["vn", "vo"], 10000.0),
            # OP1：in+ = 地，in- = vn，out = vo
            _c("OP1", "opamp_ideal", ["n0", "vn", "vo"]),
        ],
    }


def vccs() -> dict:
    """VCCS：gm=1mS，控制 1V，负载 1kΩ，期望 v(nb) = -1V。"""
    return {
        "nodes": [_n("n0", True), _n("na"), _n("nb")],
        "components": [
            _c("V1", "voltage_source", ["na", "n0"], 1.0),
            _c("G1", "vccs", ["nb", "n0", "na", "n0"], 0.001),
            _c("R1", "resistor", ["nb", "n0"], 1000.0),
        ],
    }


def cccs() -> dict:
    """CCCS：β=2，控制电流 1mA，负载 1kΩ，期望 v(nb) = -2V。"""
    return {
        "nodes": [_n("n0", True), _n("na"), _n("nm"), _n("nb")],
        "components": [
            _c("V1", "voltage_source", ["na", "n0"], 1.0),
            _c("R1", "resistor", ["na", "nm"], 1000.0),
            # F1：输出 (nb,n0)，电流探头 (nm,n0)，β=2
            _c("F1", "cccs", ["nb", "n0", "nm", "n0"], 2.0),
            _c("R2", "resistor", ["nb", "n0"], 1000.0),
        ],
    }


def ccvs() -> dict:
    """CCVS：r=1kΩ，控制电流 1mA，期望 v(nb) = 1V。"""
    return {
        "nodes": [_n("n0", True), _n("na"), _n("nm"), _n("nb")],
        "components": [
            _c("V1", "voltage_source", ["na", "n0"], 1.0),
            _c("R1", "resistor", ["na", "nm"], 1000.0),
            # H1：输出 (nb,n0)，电流探头 (nm,n0)，r=1000
            _c("H1", "ccvs", ["nb", "n0", "nm", "n0"], 1000.0),
            _c("R2", "resistor", ["nb", "n0"], 1000.0),
        ],
    }


def current_source() -> dict:
    """独立电流源 1mA 流入 1kΩ，期望 v(na) = -1V。"""
    return {
        "nodes": [_n("n0", True), _n("na")],
        "components": [
            _c("I1", "current_source", ["na", "n0"], 0.001),
            _c("R1", "resistor", ["na", "n0"], 1000.0),
        ],
    }


def switch_closed() -> dict:
    """闭合开关把 5V 送到负载，期望 v(nb) = 5V。"""
    return {
        "nodes": [_n("n0", True), _n("na"), _n("nb")],
        "components": [
            _c("V1", "voltage_source", ["na", "n0"], 5.0),
            _c("SW1", "switch", ["na", "nb"], None, closed=True),
            _c("R1", "resistor", ["nb", "n0"], 1000.0),
        ],
    }


def no_ground() -> dict:
    """缺少参考地：应报错 NO_GROUND。"""
    return {
        "nodes": [_n("n1"), _n("n2")],
        "components": [_c("R1", "resistor", ["n1", "n2"], 1000.0)],
    }


def voltage_loop() -> dict:
    """两个不同电压值的电压源并联：应报错 SINGULAR_MATRIX。"""
    return {
        "nodes": [_n("n0", True), _n("na")],
        "components": [
            _c("V1", "voltage_source", ["na", "n0"], 5.0),
            _c("V2", "voltage_source", ["na", "n0"], 3.0),
        ],
    }