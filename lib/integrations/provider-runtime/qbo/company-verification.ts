import "server-only";

import { contractSha256 } from "@/lib/integrations/contracts/canonical";
import {
  BoundedIdentifierSchema,
  BoundedLabelSchema
} from "@/lib/integrations/contracts/primitives";
import type { AuthorizedProviderEntityVerifier } from "@/lib/integrations/credentials/broker";
import { minimizeQboSourceRecord } from "@/lib/integrations/providers/qbo/minimizers";
import type { QboSandboxReadOnlyClient } from "@/lib/integrations/provider-runtime/qbo/client";

export const QBO_COMPANY_VERIFICATION_VERSION =
  "qbo_sandbox_company_verification_v1" as const;

export class QboSandboxCompanyVerifier
  implements AuthorizedProviderEntityVerifier
{
  readonly #clientForRealm: (realmId: string) => QboSandboxReadOnlyClient;

  constructor(input: {
    clientForRealm: (realmId: string) => QboSandboxReadOnlyClient;
  }) {
    this.#clientForRealm = input.clientForRealm;
  }

  async verify(input: Parameters<AuthorizedProviderEntityVerifier["verify"]>[0]) {
    const realmId = BoundedIdentifierSchema.parse(
      input.externalAuthorizedEntityReference
    );
    const company = await input.credential.use(async ({ accessToken }) => {
      const client = this.#clientForRealm(realmId);
      if (client.realmId !== realmId) {
        throw new Error("qbo_company_verification_realm_substitution");
      }
      const raw = await client.fetchCompanyInfo({ accessToken });
      return minimizeQboSourceRecord({
        recordType: "CompanyInfo",
        raw,
        provider: {
          providerKey: "quickbooks_online",
          realmId,
          sourceEnvironment: "sandbox"
        }
      });
    });
    const safeDisplayName = BoundedLabelSchema.parse(
      company.displayName ?? "QuickBooks Online Sandbox Company"
    );
    return {
      externalAuthorizedEntityReference: realmId,
      providerEntityType: "company",
      safeDisplayName,
      verificationFingerprint: contractSha256({
        fingerprintPurpose: "qbo_sandbox_company_verification",
        fingerprintVersion: QBO_COMPANY_VERIFICATION_VERSION,
        providerKey: "quickbooks_online",
        providerEnvironment: "sandbox",
        realmId,
        companyId: company.id,
        providerUpdatedAt: company.metadata.providerUpdatedAt,
        syncToken: company.metadata.syncToken,
        safeDisplayName
      })
    } as const;
  }
}
