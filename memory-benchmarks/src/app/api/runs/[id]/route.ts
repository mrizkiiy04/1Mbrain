import { NextRequest, NextResponse } from "next/server";
import { getRun } from "@/lib/runs";
import { getProgress } from "@/lib/executor";

export const dynamic = "force-dynamic";

export function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return params.then(({ id }) => {
    const run = getRun(id);
    if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const isActive = run.status === "running" || run.status === "pending";
    const progress =
      isActive && run.log_file
        ? getProgress(run.log_file, run.started_at)
        : null;

    return NextResponse.json({ ...run, progress });
  });
}
