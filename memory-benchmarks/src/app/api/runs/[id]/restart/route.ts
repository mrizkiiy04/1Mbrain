import { NextRequest, NextResponse } from "next/server";
import { getRun } from "@/lib/runs";
import { getTemplate } from "@/lib/templates";
import { restartRun } from "@/lib/executor";

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

  const template = getTemplate(run.template_id);
  if (!template) {
    return NextResponse.json(
      { error: `Template not found: ${run.template_id}` },
      { status: 404 },
    );
  }

  const config = JSON.parse(run.config || "{}");
  const envOverrides = JSON.parse(run.env_overrides || "{}");

  try {
    await restartRun(id, template, run.project_name, {
      config,
      env_overrides: envOverrides,
    });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
