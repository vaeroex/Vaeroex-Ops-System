import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json(
    { error: "Scheduled report generation is no longer available." },
    { status: 410 }
  );
}
