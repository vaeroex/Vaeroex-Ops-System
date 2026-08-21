import { PersistedFactDecimalSchema } from "@/lib/integrations/contracts/primitives";

type DecimalParts = Readonly<{ coefficient: bigint; scale: number }>;

function parts(value: string): DecimalParts {
  const parsed = PersistedFactDecimalSchema.parse(value);
  const negative = parsed.startsWith("-");
  const unsigned = negative ? parsed.slice(1) : parsed;
  const [integer, fraction = ""] = unsigned.split(".");
  const coefficient = BigInt(`${integer}${fraction}`);
  return { coefficient: negative ? -coefficient : coefficient, scale: fraction.length };
}

function powerOfTen(exponent: number) {
  return BigInt(10) ** BigInt(exponent);
}

function canonicalFromParts(coefficient: bigint, scale: number) {
  if (coefficient === BigInt(0)) return "0";
  const negative = coefficient < BigInt(0);
  const digits = (negative ? -coefficient : coefficient).toString().padStart(scale + 1, "0");
  const integer = scale === 0 ? digits : digits.slice(0, -scale);
  const fraction = scale === 0 ? "" : digits.slice(-scale).replace(/0+$/, "");
  return PersistedFactDecimalSchema.parse(
    `${negative ? "-" : ""}${integer}${fraction ? `.${fraction}` : ""}`
  );
}

export function addCanonicalDecimals(values: readonly string[]) {
  if (values.length === 0) return "0";
  const parsed = values.map(parts);
  const scale = Math.max(...parsed.map((value) => value.scale));
  const coefficient = parsed.reduce(
    (total, value) =>
      total + value.coefficient * powerOfTen(scale - value.scale),
    BigInt(0)
  );
  return canonicalFromParts(coefficient, scale);
}

export function negateCanonicalDecimal(value: string) {
  const parsed = PersistedFactDecimalSchema.parse(value);
  if (parsed === "0") return parsed;
  return parsed.startsWith("-") ? parsed.slice(1) : `-${parsed}`;
}

export function subtractCanonicalDecimals(left: string, right: string) {
  return addCanonicalDecimals([left, negateCanonicalDecimal(right)]);
}

export function divideCanonicalDecimals({
  numerator,
  denominator,
  scale,
  rounding
}: {
  numerator: string;
  denominator: string;
  scale: number;
  rounding: "half_away_from_zero";
}) {
  if (!Number.isInteger(scale) || scale < 0 || scale > 9) {
    throw new Error("deterministic_division_scale_invalid");
  }
  if (rounding !== "half_away_from_zero") {
    throw new Error("deterministic_division_rounding_invalid");
  }

  const left = parts(numerator);
  const right = parts(denominator);
  if (right.coefficient === BigInt(0)) throw new Error("deterministic_division_by_zero");

  const negative = (left.coefficient < BigInt(0)) !== (right.coefficient < BigInt(0));
  const unsignedNumerator = (left.coefficient < BigInt(0) ? -left.coefficient : left.coefficient)
    * powerOfTen(right.scale + scale);
  const unsignedDenominator = (right.coefficient < BigInt(0) ? -right.coefficient : right.coefficient)
    * powerOfTen(left.scale);
  let quotient = unsignedNumerator / unsignedDenominator;
  const remainder = unsignedNumerator % unsignedDenominator;
  if (remainder * BigInt(2) >= unsignedDenominator) quotient += BigInt(1);
  return canonicalFromParts(negative ? -quotient : quotient, scale);
}
