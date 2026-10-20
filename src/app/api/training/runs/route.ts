import { createRun, listRuns } from "@/lib/training/api";
import { withTraining } from "@/lib/training/server-deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withTraining((deps) => listRuns(request, deps));
}

export async function POST(request: Request): Promise<Response> {
  return withTraining((deps) => createRun(request, deps));
}
