export type SpatialQualityTier = "full" | "balanced" | "light" | "reduced_motion";
export type SpatialViewportProfile = "wide" | "tablet_landscape" | "tablet_portrait" | "phone";
export type SpatialCapabilityReason = "reduced_motion" | "low_power" | "webgl_unavailable";
export type SpatialCapability = Readonly<{
  ready: boolean;
  available: boolean;
  specializedAvailable: boolean;
  quality: SpatialQualityTier | null;
  profile: SpatialViewportProfile;
  reason: SpatialCapabilityReason | null;
}>;

export type SpatialCapabilitySnapshot = Readonly<{
  width: number;
  height: number;
  coarsePointer: boolean;
  reducedMotion: boolean;
  hardwareConcurrency?: number;
  deviceMemory?: number;
  maxTextureSize?: number;
  webglAvailable: boolean;
}>;

export function classifySpatialViewport(width: number, height: number, coarsePointer = false): SpatialViewportProfile {
  const shortSide = Math.min(width, height);
  const longSide = Math.max(width, height);
  if (shortSide <= 600 && longSide <= 950) return "phone";
  if (width <= 900 && height > width) return "tablet_portrait";
  if (coarsePointer && width <= 1366 && width >= height && height >= 700) return "tablet_landscape";
  if (width <= 1180 && width >= height) return "tablet_landscape";
  if (width <= 1024 && height > width) return "tablet_portrait";
  return "wide";
}

export function classifySpatialCapability(snapshot: SpatialCapabilitySnapshot): SpatialCapability {
  const profile = classifySpatialViewport(snapshot.width, snapshot.height, snapshot.coarsePointer);
  if (!snapshot.webglAvailable) {
    return {
      ready: true,
      available: false,
      specializedAvailable: false,
      quality: null,
      profile,
      reason: "webgl_unavailable"
    };
  }

  if (snapshot.reducedMotion) {
    return {
      ready: true,
      available: true,
      specializedAvailable: false,
      quality: "reduced_motion",
      profile,
      reason: "reduced_motion"
    };
  }

  const constrainedHardware = Boolean(
    (snapshot.hardwareConcurrency && snapshot.hardwareConcurrency <= 4)
    || (snapshot.deviceMemory && snapshot.deviceMemory <= 4)
    || (snapshot.maxTextureSize && snapshot.maxTextureSize < 4096)
  );

  if (constrainedHardware) {
    return {
      ready: true,
      available: true,
      specializedAvailable: false,
      quality: "light",
      profile,
      reason: "low_power"
    };
  }

  const adaptiveViewport = profile !== "wide" || (snapshot.coarsePointer && snapshot.width < 1280);
  const highCapabilityTablet = adaptiveViewport
    && profile !== "phone"
    && (snapshot.hardwareConcurrency ?? 8) >= 8
    && (snapshot.deviceMemory ?? 8) >= 8
    && (snapshot.maxTextureSize ?? 8192) >= 8192;
  const quality: SpatialQualityTier = !adaptiveViewport || highCapabilityTablet ? "full" : "balanced";

  return {
    ready: true,
    available: true,
    specializedAvailable: quality === "full",
    quality,
    profile,
    reason: null
  };
}
