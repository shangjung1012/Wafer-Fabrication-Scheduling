/**
 * app/api/docs/spec/route.ts
 *
 * GET /api/docs/spec
 *
 * Serves the OpenAPI spec (api_spec.yml) as YAML.
 * Swagger UI can consume YAML directly — no parsing needed here.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { NextResponse } from "next/server";

export async function GET() {
  const specPath = join(process.cwd(), "api_spec.yml");

  let yaml: string;
  try {
    yaml = readFileSync(specPath, "utf-8");
  } catch {
    return NextResponse.json(
      { error: "api_spec.yml not found" },
      { status: 404 }
    );
  }

  return new Response(yaml, {
    headers: {
      "Content-Type": "application/yaml; charset=utf-8",
      // Allow Swagger UI (same origin) to fetch this
      "Access-Control-Allow-Origin": "*",
      // Don't cache during development
      "Cache-Control": "no-store",
    },
  });
}
