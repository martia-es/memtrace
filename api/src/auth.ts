import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import PostgresAdapter from "@auth/pg-adapter";
import { createPool, configFromEnv } from "@/adapters/outbound/postgres/client";
import { getIdentity } from "@/dependency-container";

const pool = createPool(configFromEnv());

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PostgresAdapter(pool),
  session: { strategy: "database" },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
    MicrosoftEntraID({
      id: "microsoft",
      clientId: process.env.MICROSOFT_APPLICATION_ID,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
      issuer: `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/v2.0`,
    }),
  ],
  events: {
    // Primer login de esta persona: aplica cualquier invitación pendiente a su email (ADR-014).
    async createUser({ user }) {
      if (!user.id || !user.email) return;
      await getIdentity().identityRepository.applyPendingInvitations(user.id, user.email);
    },
  },
});
