import "server-only";

import { contractSha256 } from "@/lib/integrations/contracts/canonical";
import {
  BoundedIdentifierSchema,
  BoundedLabelSchema
} from "@/lib/integrations/contracts/primitives";
import type { AuthorizedProviderEntityVerifier } from "@/lib/integrations/credentials/broker";
import { minimizeQboSourceRecord } from "@/lib/integrations/providers/qbo/minimizers";
import {
  QboProviderEnvironmentSchema,
  type QboProviderEnvironment,
  type QboReadOnlyClient,
  type QboSandboxReadOnlyClient
} from "@/lib/integrations/provider-runtime/qbo/client";

export const QBO_COMPANY_VERIFICATION_VERSION =
  "qbo_sandbox_company_verification_v1" as const;
export const QBO_PRODUCTION_COMPANY_VERIFICATION_VERSION =
  "qbo_production_company_verification_v1" as const;

export class QboCompanyVerifier
  implements AuthorizedProviderEntityVerifier
{
  readonly #providerEnvironment: QboProviderEnvironment;
  readonly #clientForRealm: (realmId: string) => QboReadOnlyClient;

  constructor(input: {
    providerEnvironment: QboProviderEnvironment;
    clientForRealm: (realmId: string) => QboReadOnlyClient;
  }) {
    this.#providerEnvironment = QboProviderEnvironmentSchema.parse(
      input.providerEnvironment
    );
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
      if (client.providerEnvironment !== this.#providerEnvironment) {
        throw new Error("qbo_company_verification_environment_substitution");
      }
      const raw = await client.fetchCompanyInfo({ accessToken });
      return minimizeQboSourceRecord({
        recordType: "CompanyInfo",
        raw,
        provider: {
          providerKey: "quickbooks_online",
          realmId,
          sourceEnvironment: this.#providerEnvironment
        }
      });
    });
    const safeDisplayName = BoundedLabelSchema.parse(
      company.displayName ?? "QuickBooks Online Company"
    );
    const verificationContract = this.#providerEnvironment === "sandbox"
      ? {
          purpose: "qbo_sandbox_company_verification",
          version: QBO_COMPANY_VERIFICATION_VERSION
        }
      : {
          purpose: "qbo_production_company_verification",
          version: QBO_PRODUCTION_COMPANY_VERIFICATION_VERSION
        };
    return {
      externalAuthorizedEntityReference: realmId,
      providerEntityType: "company",
      safeDisplayName,
      verificationFingerprint: contractSha256({
        fingerprintPurpose: verificationContract.purpose,
        fingerprintVersion: verificationContract.version,
        providerKey: "quickbooks_online",
        providerEnvironment: this.#providerEnvironment,
        realmId,
        companyId: company.id,
        providerUpdatedAt: company.metadata.providerUpdatedAt,
        syncToken: company.metadata.syncToken,
        safeDisplayName
      })
    } as const;
  }
}

export class QboSandboxCompanyVerifier extends QboCompanyVerifier {
  constructor(input: {
    clientForRealm: (realmId: string) => QboSandboxReadOnlyClient;
  }) {
    super({ providerEnvironment: "sandbox", clientForRealm: input.clientForRealm });
  }
}
