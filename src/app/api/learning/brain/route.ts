import { getBrain } from "@/lib/snake-learning/api";
import { withLearning } from "@/lib/snake-learning/server-deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withLearning((deps) => getBrain(request, deps));
}
