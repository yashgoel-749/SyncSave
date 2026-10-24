import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { webLogger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Validate database connection with query timeout
    await prisma.$queryRaw`SELECT 1`;

    return NextResponse.json(
      {
        status: "ready",
        service: "@syncspace/web",
        database: "connected",
        timestamp: new Date().toISOString(),
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  } catch (error) {
    webLogger.error("Readiness probe database check failed", error);

    return NextResponse.json(
      {
        status: "not_ready",
        service: "@syncspace/web",
        database: "disconnected",
        timestamp: new Date().toISOString(),
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  }
}
