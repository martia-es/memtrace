import { requireUser } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { getAlerts } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** «Marcar todo como leído»: guarda hasta cuándo ha leído esta persona sus avisos. Es de cada persona, no hace falta ningún permiso. */
export async function POST() {
  return identityGuard(async () => {
    const user = await requireUser();
    if (user instanceof Response) return user;
    await getAlerts().markNotificationsRead(user.id);
    return new Response(null, { status: 204 });
  });
}
