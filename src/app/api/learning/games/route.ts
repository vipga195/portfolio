import { submitGame } from "@/lib/snake-learning/api";
import { withLearning } from "@/lib/snake-learning/server-deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return withLearning((deps) => submitGame(request, deps));
}
