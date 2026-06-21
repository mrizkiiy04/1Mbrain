import { NextResponse } from "next/server";
import { getTemplates } from "@/lib/templates";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(getTemplates());
}
