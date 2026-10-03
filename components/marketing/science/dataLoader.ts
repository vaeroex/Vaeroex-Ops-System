import type {
  ScienceSurface,
  ScientificProteinData,
  SerializedScienceSurface,
  SerializedScientificProteinData,
} from "./dataTypes";

function bytes(encoded: string) {
  const value = atob(encoded);
  return Uint8Array.from(value, (character) => character.charCodeAt(0));
}
function unpackSurface(source: SerializedScienceSurface): ScienceSurface {
  if (source.encoding !== "quantized-le-v1")
    throw new Error("Unsupported scientific surface encoding");
  const positions = bytes(source.positionData);
  const normals = bytes(source.normalData);
  const indices = bytes(source.indexData);
  if (
    positions.length % 6 ||
    normals.length !== positions.length / 2 ||
    indices.length % 6
  )
    throw new Error("Malformed scientific surface");
  const positionView = new DataView(positions.buffer);
  const indexView = new DataView(indices.buffer);
  const normalView = new DataView(normals.buffer);
  return {
    positions: Array.from(
      { length: positions.length / 2 },
      (_, index) => positionView.getInt16(index * 2, true) / 1000,
    ),
    normals: Array.from(
      { length: normals.length },
      (_, index) => normalView.getInt8(index) / 127,
    ),
    indices: Array.from({ length: indices.length / 2 }, (_, index) =>
      indexView.getUint16(index * 2, true),
    ),
    resolution: source.resolution,
    representation: source.representation,
  };
}

export function decodeScientificProteinData(
  data: SerializedScientificProteinData,
): ScientificProteinData {
  if (data.schemaVersion !== 1 || data.pdbId !== "1AZM")
    throw new Error("Unexpected scientific structure");
  return {
    ...data,
    surface: unpackSurface(data.surface),
    compactSurface: unpackSurface(data.compactSurface),
  };
}

let pending: Promise<ScientificProteinData> | undefined;
/** One local static fetch, shared by Suspense consumers; failed loads can be retried. */
export function loadScientificProteinData(): Promise<ScientificProteinData> {
  if (!pending) {
    pending = fetch("/brand/science/carbonic-anhydrase-1azm.json")
      .then((response) => {
        if (!response.ok)
          throw new Error("Scientific illustration data is unavailable");
        return response.json() as Promise<SerializedScientificProteinData>;
      })
      .then(decodeScientificProteinData)
      .catch((error: unknown) => {
        pending = undefined;
        throw error;
      });
  }
  return pending;
}
