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

    let directResult = "not_tested";
    if (process.env.DIRECT_URL) {
      try {
        const { PrismaClient } = await import("@syncspace/db");
        const directPrisma = new PrismaClient({
          datasources: { db: { url: process.env.DIRECT_URL } },
        });
        await directPrisma.$queryRaw`SELECT 1`;
        directResult = "connected";
        await directPrisma.$disconnect();
      } catch (directErr) {
        directResult = directErr instanceof Error ? directErr.message : String(directErr);
      }
    }

    return NextResponse.json(
      {
        status: "not_ready",
        service: "@syncspace/web",
        database: "disconnected",
        details: error instanceof Error ? error.message : String(error),
        directConnectionTest: directResult,
        hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
        hasDirectUrl: Boolean(process.env.DIRECT_URL),
        dbHost: process.env.DATABASE_URL ? process.env.DATABASE_URL.split("@")[1]?.split("/")[0] : null,
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
