import { requireUser } from "@/adapters/inbound/http/auth-context";
import { json } from "@/adapters/inbound/http/problem";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  return json({ id: user.id, email: user.email, name: user.name, image: user.image });
}
