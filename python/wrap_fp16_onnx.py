"""Make an FP16 ONNX export usable by the C++ binaries: keep the model's
half-precision weights and ops, but give it the float32 input and output the
binaries read and write.

TensorRT 11 builds strongly typed networks, so an engine's precision is the
ONNX's: an FP16 export (Ultralytics `format=onnx half=True`) gives FP16
kernels, which is what the measured engines ran. That export also makes the
input and output tensors FP16, and the C++ copies float32 buffers in and
out. This adds a Cast at each end so the graph takes and returns float32
while everything in between stays FP16.

    python wrap_fp16_onnx.py <in.fp16.onnx> <out.onnx>
"""

import sys

import onnx
from onnx import TensorProto, helper

src, dst = sys.argv[1:3]
model = onnx.load(src)
graph = model.graph

for inp in graph.input:
    if inp.type.tensor_type.elem_type == TensorProto.FLOAT16:
        inner = inp.name + "_fp16"
        # Every consumer of the original input now reads the cast's output.
        for node in graph.node:
            node.input[:] = [inner if name == inp.name else name for name in node.input]
        graph.node.insert(0, helper.make_node("Cast", [inp.name], [inner], to=TensorProto.FLOAT16, name=inp.name + "_to_fp16"))
        inp.type.tensor_type.elem_type = TensorProto.FLOAT

for out in graph.output:
    if out.type.tensor_type.elem_type == TensorProto.FLOAT16:
        inner = out.name + "_fp16"
        for node in graph.node:
            node.output[:] = [inner if name == out.name else name for name in node.output]
        graph.node.append(helper.make_node("Cast", [inner], [out.name], to=TensorProto.FLOAT, name=out.name + "_to_fp32"))
        out.type.tensor_type.elem_type = TensorProto.FLOAT

onnx.checker.check_model(model)
onnx.save(model, dst)
print(f"{dst}: inputs {[(i.name, i.type.tensor_type.elem_type) for i in graph.input]} outputs {[(o.name, o.type.tensor_type.elem_type) for o in graph.output]} (1 = float32)")
