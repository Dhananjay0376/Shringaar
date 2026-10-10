"""GLB construction and inspection.

Two jobs, both real:

* `build_textured_quad_glb` writes an actual, spec-conformant binary glTF 2.0 file containing one
  textured quad. It is **not a reconstruction** — it is the cutout on a flat card. It exists so the
  GLB validation stage and the existing Three.js renderer can be exercised end-to-end against real
  bytes instead of a fixture. Every result that carries one is labelled as such.
* `inspect_glb` decides whether a GLB is usable before it is ever offered to the viewer. This is
  the server-side counterpart of the frontend's `inspectGlbBytes`; the two must agree, because the
  browser will re-check and reject anything this lets through.

Nothing here reads a model file from disk or downloads weights.
"""

from __future__ import annotations

import json
import struct
from dataclasses import dataclass, field
from typing import Any

GLB_MAGIC = 0x46546C67
CHUNK_JSON = 0x4E4F534A
CHUNK_BIN = 0x004E4942
GLB_HEADER_SIZE = 12
CHUNK_HEADER_SIZE = 8


@dataclass
class GlbInspection:
    ok: bool
    reason: str | None = None
    stats: dict[str, Any] = field(default_factory=dict)


def _pad_to_4(data: bytes, fill: bytes = b"\x00") -> bytes:
    over = len(data) % 4
    return data + fill * (4 - over) if over else data


def build_textured_quad_glb(
    png_bytes: bytes,
    *,
    aspect: float = 1.0,
    name: str = "try-on-asset",
) -> bytes:
    """A valid GLB holding one double-sided, alpha-blended textured quad.

    The quad's height is 1 unit and its width is `aspect`, so the caller's cutout proportions
    survive into the model.

    **This is a billboard, not inferred geometry.** No backside is invented, no thickness is
    implied, and no material property is measured from the photograph.
    """
    if not png_bytes:
        raise ValueError("png_bytes must not be empty")

    half_w = max(1e-6, float(aspect)) / 2.0
    half_h = 0.5

    # Bottom-left, bottom-right, top-right, top-left (counter-clockwise, front face toward +Z).
    positions = [
        (-half_w, -half_h, 0.0),
        (half_w, -half_h, 0.0),
        (half_w, half_h, 0.0),
        (-half_w, half_h, 0.0),
    ]
    # glTF UV origin is top-left, so the bottom vertices take v=1.
    uvs = [(0.0, 1.0), (1.0, 1.0), (1.0, 0.0), (0.0, 0.0)]
    indices = [0, 1, 2, 0, 2, 3]

    position_bytes = b"".join(struct.pack("<3f", *p) for p in positions)
    uv_bytes = b"".join(struct.pack("<2f", *t) for t in uvs)
    index_bytes = b"".join(struct.pack("<H", i) for i in indices)

    offset_positions = 0
    offset_uvs = offset_positions + len(position_bytes)
    offset_indices = offset_uvs + len(uv_bytes)
    offset_image = offset_indices + len(index_bytes)
    # The image bufferView must start on a 4-byte boundary.
    padding = (-offset_image) % 4
    offset_image += padding

    binary = position_bytes + uv_bytes + index_bytes + (b"\x00" * padding) + png_bytes
    binary_padded = _pad_to_4(binary)

    min_pos = [-half_w, -half_h, 0.0]
    max_pos = [half_w, half_h, 0.0]

    gltf: dict[str, Any] = {
        "asset": {"version": "2.0", "generator": "shringaar-baseline-billboard"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": name}],
        "meshes": [
            {
                "name": name,
                "primitives": [
                    {
                        "attributes": {"POSITION": 0, "TEXCOORD_0": 1},
                        "indices": 2,
                        "material": 0,
                    }
                ],
            }
        ],
        "materials": [
            {
                "name": f"{name}-material",
                "pbrMetallicRoughness": {
                    "baseColorTexture": {"index": 0},
                    "metallicFactor": 0.0,
                    "roughnessFactor": 1.0,
                },
                "doubleSided": True,
                "alphaMode": "BLEND",
            }
        ],
        "textures": [{"source": 0, "sampler": 0}],
        "images": [{"bufferView": 3, "mimeType": "image/png"}],
        "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}],
        "accessors": [
            {
                "bufferView": 0,
                "componentType": 5126,  # FLOAT
                "count": len(positions),
                "type": "VEC3",
                "min": min_pos,
                "max": max_pos,
            },
            {
                "bufferView": 1,
                "componentType": 5126,
                "count": len(uvs),
                "type": "VEC2",
            },
            {
                "bufferView": 2,
                "componentType": 5123,  # UNSIGNED_SHORT
                "count": len(indices),
                "type": "SCALAR",
            },
        ],
        "bufferViews": [
            {"buffer": 0, "byteOffset": offset_positions, "byteLength": len(position_bytes), "target": 34962},
            {"buffer": 0, "byteOffset": offset_uvs, "byteLength": len(uv_bytes), "target": 34962},
            {"buffer": 0, "byteOffset": offset_indices, "byteLength": len(index_bytes), "target": 34963},
            {"buffer": 0, "byteOffset": offset_image, "byteLength": len(png_bytes)},
        ],
        "buffers": [{"byteLength": len(binary_padded)}],
    }

    json_bytes = _pad_to_4(json.dumps(gltf, separators=(",", ":")).encode("utf-8"), b" ")

    total = GLB_HEADER_SIZE + CHUNK_HEADER_SIZE + len(json_bytes) + CHUNK_HEADER_SIZE + len(binary_padded)
    out = bytearray()
    out += struct.pack("<III", GLB_MAGIC, 2, total)
    out += struct.pack("<II", len(json_bytes), CHUNK_JSON)
    out += json_bytes
    out += struct.pack("<II", len(binary_padded), CHUNK_BIN)
    out += binary_padded

    written = bytes(out)
    if len(written) != total:
        raise AssertionError(f"GLB length mismatch: wrote {len(written)}, declared {total}")
    return written


def _accessor_floats(gltf: dict, binary: bytes, accessor_index: int, components: int) -> list[tuple[float, ...]] | None:
    """Read a FLOAT accessor as a list of tuples. Returns None when the accessor is unusable.

    Only the tightly-packed, single-bufferView, float case is handled — which is what a GLB of
    this shape contains and all that is needed to answer "is the geometry finite and non-empty".
    """
    try:
        accessor = gltf["accessors"][accessor_index]
    except (KeyError, IndexError, TypeError):
        return None
    if accessor.get("componentType") != 5126:
        return None
    count = accessor.get("count")
    bv_index = accessor.get("bufferView")
    if not isinstance(count, int) or count <= 0 or not isinstance(bv_index, int):
        return None
    try:
        view = gltf["bufferViews"][bv_index]
    except (KeyError, IndexError, TypeError):
        return None

    stride = accessor.get("byteStride") or components * 4
    start = int(view.get("byteOffset", 0)) + int(accessor.get("byteOffset", 0))
    out: list[tuple[float, ...]] = []
    for i in range(count):
        base = start + i * stride
        end = base + components * 4
        if end > len(binary):
            return None
        out.append(struct.unpack_from(f"<{components}f", binary, base))
    return out


def inspect_glb(data: bytes, *, max_bytes: int = 25 * 1024 * 1024) -> GlbInspection:
    """Validate a GLB container and its geometry. Each failure gets its own reason.

    Deliberately stricter than "it parsed": a GLB describing nothing, or describing geometry made
    of NaN, reaches the viewer as a blank stage that is indistinguishable from a render failure.
    """
    stats: dict[str, Any] = {"size_bytes": len(data)}

    if len(data) > max_bytes:
        return GlbInspection(
            False,
            f"The generated model is {len(data) / (1024 * 1024):.1f} MB, over the "
            f"{max_bytes / (1024 * 1024):.0f} MB limit.",
            stats,
        )
    if len(data) < GLB_HEADER_SIZE:
        return GlbInspection(False, "The file is shorter than a GLB header.", stats)

    magic, version, declared = struct.unpack_from("<III", data, 0)
    stats.update(declared_length=declared, version=version)
    if magic != GLB_MAGIC:
        return GlbInspection(False, "The file does not start with the glTF signature.", stats)
    if version != 2:
        return GlbInspection(False, f"glTF version {version} is not supported; only 2 is.", stats)
    if declared > len(data):
        return GlbInspection(
            False,
            f"The file declares {declared} bytes but only {len(data)} were received — the "
            "download was truncated.",
            stats,
        )
    if declared < GLB_HEADER_SIZE + CHUNK_HEADER_SIZE:
        return GlbInspection(False, "The declared length is too small to hold a chunk.", stats)

    offset = GLB_HEADER_SIZE
    json_chunk: bytes | None = None
    binary_chunk = b""
    first = True
    while offset + CHUNK_HEADER_SIZE <= declared:
        chunk_len, chunk_type = struct.unpack_from("<II", data, offset)
        body_start = offset + CHUNK_HEADER_SIZE
        body_end = body_start + chunk_len
        if body_end > len(data):
            return GlbInspection(False, "A chunk runs past the end of the file.", stats)
        body = data[body_start:body_end]
        if first and chunk_type != CHUNK_JSON:
            return GlbInspection(False, "The first chunk is not the JSON chunk.", stats)
        if chunk_type == CHUNK_JSON:
            json_chunk = body
        elif chunk_type == CHUNK_BIN:
            binary_chunk = body
        first = False
        offset = body_end

    if json_chunk is None:
        return GlbInspection(False, "The file has no JSON chunk.", stats)

    try:
        gltf = json.loads(json_chunk.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        return GlbInspection(False, f"The JSON chunk could not be parsed ({exc}).", stats)

    if not isinstance(gltf, dict):
        return GlbInspection(False, "The JSON chunk is not an object.", stats)

    asset = gltf.get("asset")
    if not isinstance(asset, dict) or not asset.get("version"):
        return GlbInspection(False, "The file has no glTF asset version.", stats)
    stats["generator"] = asset.get("generator")

    meshes = gltf.get("meshes")
    if not isinstance(meshes, list) or not meshes:
        return GlbInspection(
            False,
            "The model contains no meshes, so it would render as an empty scene.",
            stats,
        )

    total_vertices = 0
    all_points: list[tuple[float, ...]] = []
    for mesh in meshes:
        primitives = mesh.get("primitives") if isinstance(mesh, dict) else None
        if not isinstance(primitives, list) or not primitives:
            return GlbInspection(False, "A mesh in the model has no primitives.", stats)
        for primitive in primitives:
            attributes = primitive.get("attributes") if isinstance(primitive, dict) else None
            if not isinstance(attributes, dict) or "POSITION" not in attributes:
                return GlbInspection(False, "A primitive has no POSITION attribute.", stats)
            points = _accessor_floats(gltf, binary_chunk, int(attributes["POSITION"]), 3)
            if points is None:
                return GlbInspection(False, "The POSITION accessor could not be read.", stats)
            if not points:
                return GlbInspection(False, "The mesh has no vertices.", stats)
            for point in points:
                for value in point:
                    if value != value or value in (float("inf"), float("-inf")):
                        return GlbInspection(
                            False,
                            "The mesh contains non-finite vertex positions.",
                            stats,
                        )
            total_vertices += len(points)
            all_points.extend(points)

    stats["vertices"] = total_vertices
    if total_vertices < 3:
        return GlbInspection(False, "The mesh has too few vertices to form a surface.", stats)

    xs = [p[0] for p in all_points]
    ys = [p[1] for p in all_points]
    zs = [p[2] for p in all_points]
    stats["bbox"] = {
        "min": [min(xs), min(ys), min(zs)],
        "max": [max(xs), max(ys), max(zs)],
    }
    if max(xs) - min(xs) <= 0 and max(ys) - min(ys) <= 0 and max(zs) - min(zs) <= 0:
        return GlbInspection(False, "The mesh has zero extent in every axis.", stats)

    materials = gltf.get("materials")
    if not isinstance(materials, list) or not materials:
        return GlbInspection(False, "The model has no materials, so it would render untextured.", stats)
    stats["materials"] = len(materials)

    textures = gltf.get("textures")
    stats["textures"] = len(textures) if isinstance(textures, list) else 0

    # A material must give the renderer *something* to shade with.
    shaded = False
    for material in materials:
        if not isinstance(material, dict):
            continue
        pbr = material.get("pbrMetallicRoughness")
        if isinstance(pbr, dict):
            if "baseColorTexture" in pbr or "baseColorFactor" in pbr:
                shaded = True
                break
        if "extensions" in material or "emissiveFactor" in material:
            shaded = True
            break
    if not shaded:
        return GlbInspection(False, "No material in the model defines a base colour or texture.", stats)

    return GlbInspection(True, None, stats)
