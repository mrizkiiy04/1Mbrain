import { NextRequest, NextResponse } from "next/server";
import { getRun } from "@/lib/runs";
import { stopRun } from "@/lib/executor";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const run = getRun(id);

  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  if (run.status !== "running" && run.status !== "pending") {
    return NextResponse.json(
      { error: `Cannot stop: run status is "${run.status}"` },
      { status: 400 },
    );
  }

  const stopped = await stopRun(id);
  return NextResponse.json({ ok: stopped });
}
