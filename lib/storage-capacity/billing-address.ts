import { z } from "zod";

const text = (max: number) => z.string().trim().max(max).refine(value => !/[\u0000-\u001f\u007f]/.test(value), "Use a valid billing address.");
export const capacityBillingAddressSchema = z.object({
  line1: text(200).refine(Boolean, "Enter a street address."),
  line2: text(200).optional(),
  city: text(100).refine(Boolean, "Enter a city."),
  state: text(100).optional(),
  postalCode: text(32).optional(),
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/)
}).strict().superRefine((address, context) => {
  if (["US", "CA"].includes(address.country) && !address.state) context.addIssue({ code: z.ZodIssueCode.custom, path: ["state"], message: "Enter a state or province." });
  if (["US", "CA", "GB"].includes(address.country) && !address.postalCode) context.addIssue({ code: z.ZodIssueCode.custom, path: ["postalCode"], message: "Enter a postal code." });
});
