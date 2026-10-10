/**
 * Does a `.glb` actually contain a model?
 *
 * The client spec forbids switching to 3D merely because a product has a 3D URL. `renderers/select.ts`
 * is where that rule is applied, but it can only apply it if something has *looked* at the bytes —
 * otherwise every `.glb` arrives as `unchecked` and the rule collapses into "no 3D ever". This is the
 * looking.
 *
 * It reads the container, not the model. A GLB is a small, rigid structure: a 12-byte header, then
 * length-prefixed chunks of which the first must be JSON. Five checks settle whether the file is a
 * GLB at all, and one settles whether the GLB describes anything to draw. It does not attempt to
 * interpret meshes, materials or node graphs — a model that parses but renders as a grey blob is a
 * question for the renderer, and pretending otherwise here would be claiming a validation this does
 * not perform.
 *
 * ### Why pure bytes
 *
 * Taking a `Uint8Array` rather than a URL is what makes every branch testable — including the ones
 * that are otherwise hard to produce on demand, like a file truncated mid-chunk. The fetch lives with
 * the caller, where it belongs, and this stays a function whose every answer can be pinned.
 *
 * ### Why the reasons are distinct
 *
 * Each failure returns its own sentence, and they are shown to the seller. "The model is broken" sends
 * someone to re-export a file that may be perfectly good; "the file is truncated" sends them to
 * re-upload. The distinction is the whole value of inspecting the bytes rather than trusting the
 * extension.
 */

/**
 * Every glTF binary begins with the four bytes `g l T F`.
 *
 * Read as a little-endian `uint32` those bytes are `0x46546C67`, which is the value the glTF spec
 * names as `glTF`. Comparing the integer rather than four `bytes[i]` checks keeps it a single test
 * and sidesteps `noUncheckedIndexedAccess`, which types every indexed byte as possibly `undefined`.
 */
const GLB_MAGIC = 0x46546c67

/** The chunk type for the JSON chunk, i.e. the bytes `J S O N` read little-endian. */
const GLB_CHUNK_JSON = 0x4e4f534a

/** magic + version + length. */
const HEADER_BYTES = 12
/** chunkLength + chunkType. */
const CHUNK_HEADER_BYTES = 8

/**
 * The result of reading a `.glb`'s container.
 *
 * A subset of `AssetValidation` — `unchecked` is deliberately absent, because a function whose job is
 * to look cannot return "we have not looked". Being structurally assignable to `AssetValidation` is
 * what lets the caller hand the result straight to `chooseRenderer` with no translation step to get
 * wrong.
 */
export type GlbInspection =
  | { readonly status: 'valid' }
  | { readonly status: 'invalid'; readonly reason: string }

function invalid(reason: string): GlbInspection {
  return { status: 'invalid', reason }
}

/**
 * Reads a `.glb` and reports whether it holds a model.
 *
 * Order of the checks is deliberate: the container is validated before its contents are interpreted,
 * so a file that is not a GLB at all is reported as such rather than as an unparseable JSON chunk.
 * The message says which of the six things went wrong, in words a person who cannot read the spec
 * can act on.
 */
export function inspectGlbBytes(bytes: Uint8Array): GlbInspection {
  if (bytes.byteLength < HEADER_BYTES) {
    return invalid(
      `The file is too small to be a 3D model — a GLB needs at least a ${HEADER_BYTES}-byte header and has ${bytes.byteLength}.`,
    )
  }

  /* A view over the caller's own region. `byteOffset` matters: a `Uint8Array` sliced out of a larger
     buffer is common when reading an upload in pieces, and ignoring the offset would read the wrong
     bytes entirely on the second slice. */
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  if (view.getUint32(0, true) !== GLB_MAGIC) {
    return invalid('The file does not start with the "glTF" signature, so it is not a GLB model.')
  }

  const version = view.getUint32(4, true)
  if (version !== 2) {
    return invalid(`The file is glTF version ${version}. This viewer reads version 2 only.`)
  }

  /* The header's own length field, against the bytes actually present. A download cut short leaves a
     valid-looking header promising more than it delivered, and that is worth saying precisely: it is
     a transfer problem, not a modelling one. */
  const declaredLength = view.getUint32(8, true)
  if (declaredLength > bytes.byteLength) {
    return invalid(
      `The file is incomplete — its header declares ${declaredLength} bytes but only ${bytes.byteLength} arrived.`,
    )
  }
  if (declaredLength < HEADER_BYTES + CHUNK_HEADER_BYTES) {
    return invalid(`The file declares ${declaredLength} bytes, which is too few to hold even one chunk.`)
  }

  if (bytes.byteLength < HEADER_BYTES + CHUNK_HEADER_BYTES) {
    return invalid('The file ends before its first chunk header, so there is nothing to read.')
  }

  const chunkLength = view.getUint32(HEADER_BYTES, true)
  const chunkType = view.getUint32(HEADER_BYTES + 4, true)

  if (chunkType !== GLB_CHUNK_JSON) {
    return invalid('The model\'s first chunk is not JSON, which the GLB format requires it to be.')
  }

  const jsonStart = HEADER_BYTES + CHUNK_HEADER_BYTES
  const jsonEnd = jsonStart + chunkLength

  /* Checked against the *declared* length as well as the real one. The declared figure is what a
     conforming loader would trust, so a chunk that overruns it is malformed even if the bytes happen
     to be present — and it is exactly the shape a hand-edited or concatenated file takes. */
  if (jsonEnd > bytes.byteLength || jsonEnd > declaredLength) {
    return invalid(
      `The model's JSON chunk claims ${chunkLength} bytes but the file does not contain that many.`,
    )
  }

  /* Padded to a 4-byte boundary with spaces, which `JSON.parse` treats as trailing whitespace. The
     decode is not `fatal`, so a stray byte inside the chunk surfaces as a parse error below rather
     than as a replacement character that parses into something subtly different. */
  const json = new TextDecoder().decode(bytes.subarray(jsonStart, jsonEnd))

  let document: unknown
  try {
    document = JSON.parse(json)
  } catch {
    return invalid('The model\'s JSON chunk could not be parsed, so the file is damaged.')
  }

  /* `Array.isArray` is not redundant with the `typeof` test: arrays are objects, so `[1, 2, 3]` would
     otherwise sail through and be reported as "a model with no meshes" — a wrong and unfixable-sounding
     diagnosis for a file that is simply not a glTF document. */
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    return invalid('The model\'s JSON chunk is not an object, so it does not describe a scene.')
  }

  /* The one check about the model rather than the container. A GLB with no meshes is a valid file
     describing nothing to draw — passing it to Three.js yields an empty scene that looks exactly like
     a rendering failure, which is the most confusing outcome available and the one worth preventing
     here. `meshes` is read off an `unknown` deliberately: this is external input, and a typed cast
     would be an assertion about bytes this function has no right to assume. */
  const meshes = (document as { meshes?: unknown }).meshes
  if (!Array.isArray(meshes) || meshes.length === 0) {
    return invalid('The model contains no meshes, so there is nothing to draw.')
  }

  return { status: 'valid' }
}
