import { getRunBrain } from "@/lib/training/api";
import { withTraining } from "@/lib/training/server-deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  return withTraining((deps) => getRunBrain(request, id, deps));
}
