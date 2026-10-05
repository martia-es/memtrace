import { scimGuard, scimJson } from "@/adapters/inbound/http/scim-http";

export const dynamic = "force-dynamic";

/** Qué soporta este servidor SCIM: lo que consultan Entra ID, Okta y SailPoint al configurar la integración. */
export async function GET(request: Request) {
  return scimGuard(request, async () =>
    scimJson({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: 200 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [{ type: "oauthbearertoken", name: "Bearer token", description: "Token SCIM creado en Admin → organización → Identity" }],
    }),
  );
}
