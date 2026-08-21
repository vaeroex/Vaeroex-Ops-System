import {
  canonicalFactFingerprint,
  externalSourceFingerprint
} from "@/lib/integrations/contracts/canonical";
import {
  CanonicalBusinessFactVersionSchema,
  ExternalSourceRecordVersionSchema,
  type CanonicalBusinessFactVersion,
  type ExternalSourceRecordVersion
} from "@/lib/integrations/contracts/source-facts";
import {
  canonicalFactIdentityFingerprint,
  externalSourceIdentityFingerprint
} from "@/lib/integrations/persistence/identity";

export type PreparedExternalSourceVersionCommit = Readonly<{
  sourceIdentityFingerprint: string;
  sourceFingerprint: string;
  version: ExternalSourceRecordVersion & { sourceFingerprint: string };
}>;

export type PreparedCanonicalFactVersionCommit = Readonly<{
  identityFingerprint: string;
  factFingerprint: string;
  version: CanonicalBusinessFactVersion & { factFingerprint: string };
}>;

export function prepareExternalSourceVersionCommit(
  input: unknown
): PreparedExternalSourceVersionCommit {
  const parsed = ExternalSourceRecordVersionSchema.parse(input);
  const sourceFingerprint = externalSourceFingerprint(parsed);

  if (parsed.sourceFingerprint && parsed.sourceFingerprint !== sourceFingerprint) {
    throw new Error("external_source_fingerprint_mismatch");
  }

  const version = ExternalSourceRecordVersionSchema.parse({
    ...parsed,
    sourceFingerprint
  }) as ExternalSourceRecordVersion & { sourceFingerprint: string };

  return {
    sourceIdentityFingerprint: externalSourceIdentityFingerprint(version),
    sourceFingerprint,
    version
  };
}

export function prepareCanonicalFactVersionCommit(
  input: unknown
): PreparedCanonicalFactVersionCommit {
  const parsed = CanonicalBusinessFactVersionSchema.parse(input);
  const factFingerprint = canonicalFactFingerprint(parsed);

  if (parsed.factFingerprint && parsed.factFingerprint !== factFingerprint) {
    throw new Error("canonical_fact_fingerprint_mismatch");
  }

  const version = CanonicalBusinessFactVersionSchema.parse({
    ...parsed,
    factFingerprint
  }) as CanonicalBusinessFactVersion & { factFingerprint: string };

  return {
    identityFingerprint: canonicalFactIdentityFingerprint(version),
    factFingerprint,
    version
  };
}
