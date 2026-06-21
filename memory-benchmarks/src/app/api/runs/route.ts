import { NextRequest, NextResponse } from "next/server";
import { createRun, listRuns, deleteRuns } from "@/lib/runs";
import { getTemplate } from "@/lib/templates";
import { startRun } from "@/lib/executor";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status") ?? undefined;
  const template_id =
    req.nextUrl.searchParams.get("template_id") ?? undefined;
  return NextResponse.json(listRuns({ status, template_id }));
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { template_id, project_name, config, env_overrides } = body;

  if (!template_id || !project_name) {
    return NextResponse.json(
      { error: "template_id and project_name are required" },
      { status: 400 },
    );
  }

  const template = getTemplate(template_id);
  if (!template) {
    return NextResponse.json(
      { error: `Template not found: ${template_id}` },
      { status: 404 },
    );
  }

  const run = createRun({
    template_id,
    project_name,
    config: config ?? {},
    env_overrides: env_overrides ?? {},
  });

  startRun(run.id, template, project_name, {
    config: config ?? {},
    env_overrides: env_overrides ?? {},
  });

  return NextResponse.json(run);
}

export async function DELETE(req: NextRequest) {
  const body = await req.json();
  const { ids } = body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json(
      { error: "ids array is required" },
      { status: 400 },
    );
  }
  deleteRuns(ids);
  return NextResponse.json({ deleted: ids.length });
}
