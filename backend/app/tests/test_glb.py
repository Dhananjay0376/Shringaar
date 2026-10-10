"""GLB writing and validation.

Two things are being pinned here. First, that the writer emits a container the validator accepts —
so the 3D stage is exercised against real bytes rather than a fixture. Second, that every way a GLB
can be unusable gets its **own** reason: a validator that answers "invalid" to everything is
indistinguishable from one that is broken, and it leaves a seller with nothing to act on.
"""

from __future__ import annotations

import copy
import json
import math
import struct
from collections.abc import Callable

import pytest

from app.pipeline.glb import (
    CHUNK_BIN,
    CHUNK_JSON,
    GLB_MAGIC,
    GlbInspection,
    build_textured_quad_glb,
    inspect_glb,
)
from app.tests import images

PNG = images.png(images.single_item())


# ---------------------------------------------------------------------------------------------
# Helpers: pull a GLB apart and put it back together with a mutated JSON chunk
# ---------------------------------------------------------------------------------------------


def _split(glb: bytes) -> tuple[dict, bytes]:
    json_chunk = None
    binary_chunk = b""
    offset = 12
    while offset + 8 <= len(glb):
        length, chunk_type = struct.unpack_from("<II", glb, offset)
        body = glb[offset + 8 : offset + 8 + length]
        if chunk_type == CHUNK_JSON:
            json_chunk = json.loads(body.decode("utf-8"))
        elif chunk_type == CHUNK_BIN:
            binary_chunk = body
        offset += 8 + length
    assert json_chunk is not None
    return json_chunk, binary_chunk


def _pack(gltf: dict, binary: bytes) -> bytes:
    json_bytes = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    json_bytes += b" " * ((-len(json_bytes)) % 4)
    binary = binary + b"\x00" * ((-len(binary)) % 4)
    total = 12 + 8 + len(json_bytes) + 8 + len(binary)
    out = struct.pack("<III", GLB_MAGIC, 2, total)
    out += struct.pack("<II", len(json_bytes), CHUNK_JSON) + json_bytes
    out += struct.pack("<II", len(binary), CHUNK_BIN) + binary
    return out


@pytest.fixture(scope="module")
def valid_glb() -> bytes:
    return build_textured_quad_glb(PNG, aspect=0.75)


def _mutated(valid_glb: bytes, change: Callable[[dict], None]) -> bytes:
    gltf, binary = _split(valid_glb)
    gltf = copy.deepcopy(gltf)
    change(gltf)
    return _pack(gltf, binary)


# ---------------------------------------------------------------------------------------------
# The writer
# ---------------------------------------------------------------------------------------------


def test_writer_produces_a_file_the_validator_accepts(valid_glb):
    inspection = inspect_glb(valid_glb)
    assert inspection.ok is True, inspection.reason
    assert inspection.stats["version"] == 2
    assert inspection.stats["vertices"] == 4
    assert inspection.stats["generator"] == "shringaar-baseline-billboard"


def test_writer_declares_its_own_length_correctly(valid_glb):
    magic, version, declared = struct.unpack_from("<III", valid_glb, 0)
    assert magic == GLB_MAGIC
    assert version == 2
    assert declared == len(valid_glb), "the declared length must match the bytes written"


def test_writer_pads_chunks_to_four_byte_boundaries(valid_glb):
    offset = 12
    while offset + 8 <= len(valid_glb):
        length, _ = struct.unpack_from("<II", valid_glb, offset)
        assert length % 4 == 0, f"chunk at {offset} has length {length}, not 4-byte aligned"
        offset += 8 + length
    assert offset == len(valid_glb), "chunks must tile the file exactly"


def test_writer_preserves_the_cutout_aspect_ratio():
    wide = build_textured_quad_glb(PNG, aspect=2.0)
    stats = inspect_glb(wide).stats
    width = stats["bbox"]["max"][0] - stats["bbox"]["min"][0]
    height = stats["bbox"]["max"][1] - stats["bbox"]["min"][1]
    assert width / height == pytest.approx(2.0, rel=1e-3)


def test_writer_marks_the_quad_double_sided_and_blended(valid_glb):
    """Without both of these a cutout renders as a black rectangle from behind."""
    gltf, _ = _split(valid_glb)
    material = gltf["materials"][0]
    assert material["doubleSided"] is True
    assert material["alphaMode"] == "BLEND"
    assert material["pbrMetallicRoughness"]["baseColorTexture"]["index"] == 0


def test_writer_refuses_empty_image_data():
    with pytest.raises(ValueError):
        build_textured_quad_glb(b"")


def test_writer_embeds_the_original_png_bytes(valid_glb):
    """The texture is the seller's cutout, byte for byte — not a re-encode."""
    _, binary = _split(valid_glb)
    assert PNG in binary


# ---------------------------------------------------------------------------------------------
# The validator — container level
# ---------------------------------------------------------------------------------------------


def test_oversize_is_refused(valid_glb):
    inspection = inspect_glb(valid_glb, max_bytes=16)
    assert not inspection.ok
    assert "MB" in (inspection.reason or "")


def test_short_header_is_refused():
    inspection = inspect_glb(b"glTF")
    assert not inspection.ok
    assert "shorter" in (inspection.reason or "")


def test_bad_magic_is_refused(valid_glb):
    broken = b"XXXX" + valid_glb[4:]
    inspection = inspect_glb(broken)
    assert not inspection.ok
    assert "signature" in (inspection.reason or "")


def test_wrong_version_is_refused(valid_glb):
    broken = valid_glb[:4] + struct.pack("<I", 1) + valid_glb[8:]
    inspection = inspect_glb(broken)
    assert not inspection.ok
    assert "version 1" in (inspection.reason or "")


def test_truncated_download_is_refused(valid_glb):
    inspection = inspect_glb(valid_glb[: len(valid_glb) // 2])
    assert not inspection.ok
    assert "truncated" in (inspection.reason or "")


def test_declared_length_too_small_is_refused(valid_glb):
    broken = valid_glb[:8] + struct.pack("<I", 14) + valid_glb[12:]
    inspection = inspect_glb(broken)
    assert not inspection.ok
    assert "too small" in (inspection.reason or "")


def test_first_chunk_must_be_json(valid_glb):
    # Swap the chunk types so the binary chunk comes first.
    broken = bytearray(valid_glb)
    first_len = struct.unpack_from("<I", broken, 12)[0]
    struct.pack_into("<I", broken, 16, CHUNK_BIN)
    second_offset = 12 + 8 + first_len
    struct.pack_into("<I", broken, second_offset + 4, CHUNK_JSON)
    inspection = inspect_glb(bytes(broken))
    assert not inspection.ok
    assert "not the JSON chunk" in (inspection.reason or "")


def test_chunk_running_past_the_end_is_refused(valid_glb):
    broken = bytearray(valid_glb)
    struct.pack_into("<I", broken, 12, len(valid_glb) * 4)
    inspection = inspect_glb(bytes(broken))
    assert not inspection.ok
    assert "past the end" in (inspection.reason or "")


def test_missing_json_chunk_is_refused(valid_glb):
    size = 12 + 8 + 4
    header = struct.pack("<III", GLB_MAGIC, 2, size)
    chunk = struct.pack("<II", 4, CHUNK_BIN) + b"\x00\x00\x00\x00"
    inspection = inspect_glb(header + chunk)
    assert not inspection.ok
    assert "not the JSON chunk" in (inspection.reason or "")


def test_unparsable_json_is_refused(valid_glb):
    gltf, binary = _split(valid_glb)
    json_bytes = b"{not json at all!!!" + b" " * 3
    json_bytes += b" " * ((-len(json_bytes)) % 4)
    binary = binary + b"\x00" * ((-len(binary)) % 4)
    total = 12 + 8 + len(json_bytes) + 8 + len(binary)
    out = struct.pack("<III", GLB_MAGIC, 2, total)
    out += struct.pack("<II", len(json_bytes), CHUNK_JSON) + json_bytes
    out += struct.pack("<II", len(binary), CHUNK_BIN) + binary
    inspection = inspect_glb(out)
    assert not inspection.ok
    assert "could not be parsed" in (inspection.reason or "")


def test_json_that_is_not_an_object_is_refused():
    payload = b'["not", "an", "object"]'
    payload += b" " * ((-len(payload)) % 4)
    total = 12 + 8 + len(payload)
    out = struct.pack("<III", GLB_MAGIC, 2, total)
    out += struct.pack("<II", len(payload), CHUNK_JSON) + payload
    inspection = inspect_glb(out)
    assert not inspection.ok
    assert "not an object" in (inspection.reason or "")


# ---------------------------------------------------------------------------------------------
# The validator — content level
# ---------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("label", "change", "fragment"),
    [
        ("no asset version", lambda g: g.pop("asset"), "asset version"),
        ("empty asset", lambda g: g.update(asset={}), "asset version"),
        ("no meshes", lambda g: g.pop("meshes"), "no meshes"),
        ("empty meshes", lambda g: g.update(meshes=[]), "no meshes"),
        (
            "mesh without primitives",
            lambda g: g["meshes"][0].update(primitives=[]),
            "no primitives",
        ),
        (
            "primitive without POSITION",
            lambda g: g["meshes"][0]["primitives"][0]["attributes"].pop("POSITION"),
            "no POSITION",
        ),
        (
            "unreadable POSITION accessor",
            lambda g: g["meshes"][0]["primitives"][0]["attributes"].update(POSITION=99),
            "could not be read",
        ),
        (
            "position accessor of the wrong type",
            lambda g: g["accessors"][0].update(componentType=5123),
            "could not be read",
        ),
        (
            "accessor with zero count",
            lambda g: g["accessors"][0].update(count=0),
            "could not be read",
        ),
        (
            "no materials",
            lambda g: g.pop("materials"),
            "no materials",
        ),
        (
            "material with nothing to shade with",
            lambda g: g.update(materials=[{"name": "blank"}]),
            "base colour",
        ),
        (
            "bufferView past the end of the binary chunk",
            lambda g: g["bufferViews"][0].update(byteOffset=10_000_000),
            "could not be read",
        ),
    ],
)
def test_content_failures_each_get_their_own_reason(valid_glb, label, change, fragment):
    inspection = inspect_glb(_mutated(valid_glb, change))
    assert not inspection.ok, f"{label} was accepted"
    assert fragment in (inspection.reason or ""), f"{label}: {inspection.reason}"


def test_two_vertices_are_too_few(valid_glb):
    inspection = inspect_glb(_mutated(valid_glb, lambda g: g["accessors"][0].update(count=2)))
    assert not inspection.ok
    assert "too few vertices" in (inspection.reason or "")


def test_non_finite_positions_are_refused(valid_glb):
    """NaN reaches the viewer as a blank stage that looks identical to a render failure."""

    def poison(gltf: dict) -> None:
        gltf["accessors"][0]["count"] = 3

    gltf, binary = _split(valid_glb)
    gltf = copy.deepcopy(gltf)
    poison(gltf)
    poisoned = bytearray(binary)
    struct.pack_into("<f", poisoned, 0, math.nan)
    inspection = inspect_glb(_pack(gltf, bytes(poisoned)))
    assert not inspection.ok
    assert "non-finite" in (inspection.reason or "")


def test_zero_extent_geometry_is_refused():
    """A mesh collapsed to a point renders as nothing, so it is rejected up front."""
    positions = [(0.0, 0.0, 0.0)] * 3
    position_bytes = b"".join(struct.pack("<3f", *p) for p in positions)
    gltf = {
        "asset": {"version": "2.0"},
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}],
        "materials": [{"pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1]}}],
        "accessors": [{"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3"}],
        "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": len(position_bytes)}],
        "buffers": [{"byteLength": len(position_bytes)}],
    }
    inspection = inspect_glb(_pack(gltf, position_bytes))
    assert not inspection.ok
    assert "zero extent" in (inspection.reason or "")


# ---------------------------------------------------------------------------------------------
# Distinctness — the property that makes the reason strings worth having
# ---------------------------------------------------------------------------------------------


def test_every_rejection_reason_is_distinct(valid_glb):
    """Collect one case per failure mode and confirm no two share a message.

    This is the test that stops the validator decaying into a single catch-all "invalid file".

    The inputs are one per *mode*: a short file and an empty file are two inputs with one cause, so
    only one of them appears here.
    """
    cases = [
        inspect_glb(valid_glb, max_bytes=16),
        inspect_glb(b"glTF"),
        inspect_glb(b"XXXX" + valid_glb[4:]),
        inspect_glb(valid_glb[:4] + struct.pack("<I", 3) + valid_glb[8:]),
        inspect_glb(valid_glb[: len(valid_glb) // 2]),
        inspect_glb(valid_glb[:8] + struct.pack("<I", 14) + valid_glb[12:]),
        inspect_glb(_mutated(valid_glb, lambda g: g.pop("asset"))),
        inspect_glb(_mutated(valid_glb, lambda g: g.pop("meshes"))),
        inspect_glb(_mutated(valid_glb, lambda g: g["meshes"][0].update(primitives=[]))),
        inspect_glb(
            _mutated(
                valid_glb,
                lambda g: g["meshes"][0]["primitives"][0]["attributes"].pop("POSITION"),
            )
        ),
        inspect_glb(_mutated(valid_glb, lambda g: g["accessors"][0].update(count=1))),
        inspect_glb(_mutated(valid_glb, lambda g: g.pop("materials"))),
        inspect_glb(_mutated(valid_glb, lambda g: g.update(materials=[{"name": "blank"}]))),
    ]
    reasons = [c.reason for c in cases]
    assert all(reasons), "a rejection must always carry a reason"
    assert len(set(reasons)) == len(reasons), f"duplicate reasons: {reasons}"


def test_inspection_stats_are_reported_on_success(valid_glb):
    inspection: GlbInspection = inspect_glb(valid_glb)
    assert inspection.ok
    assert inspection.stats["size_bytes"] == len(valid_glb)
    assert inspection.stats["declared_length"] == len(valid_glb)
    assert inspection.stats["vertices"] == 4
    assert inspection.stats["materials"] == 1
    assert inspection.stats["textures"] == 1
    assert inspection.stats["bbox"]["min"][2] == 0.0
