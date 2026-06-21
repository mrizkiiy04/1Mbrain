import { NextRequest, NextResponse } from "next/server";
import { getRun } from "@/lib/runs";
import { loadConversations } from "@/lib/conversations";
import path from "path";
import fs from "fs";

export const dynamic = "force-dynamic";

const REPO_ROOT = process.cwd();

export function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return params.then(({ id }) => {
    const convIdx = req.nextUrl.searchParams.get("conversation");

    const run = getRun(id);
    if (!run)
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    const predictDir = findPredictDir(run.template_id, run.project_name);
    if (!predictDir) {
      return NextResponse.json(
        { error: "No predict data available" },
        { status: 404 },
      );
    }

    const evalType = run.template_id;
    const result = loadConversations(predictDir, evalType);
    if (!result) {
      return NextResponse.json(
        { error: "Could not parse conversations" },
        { status: 500 },
      );
    }

    // Optional: filter to single conversation
    if (convIdx !== null) {
      const idx = parseInt(convIdx);
      const conv = result.conversations.find(
        (c) => c.conversation_idx === idx,
      );
      if (!conv)
        return NextResponse.json(
          { error: "Conversation not found" },
          { status: 404 },
        );
      return NextResponse.json({ ...result, conversations: [conv] });
    }

    return NextResponse.json(result);
  });
}

function findPredictDir(
  templateId: string,
  projectName: string,
): string | undefined {
  const candidates = [
    path.join(
      REPO_ROOT,
      "results",
      "locomo",
      `predicted_${projectName}`,
    ),
    path.join(REPO_ROOT, "results", "longmemeval", projectName),
    path.join(
      REPO_ROOT,
      "results",
      "longmemeval",
      `predicted_${projectName}`,
    ),
    path.join(
      REPO_ROOT,
      "results",
      "beam",
      `predicted_${projectName}`,
    ),
  ];
  return candidates.find((d) => fs.existsSync(d));
}
