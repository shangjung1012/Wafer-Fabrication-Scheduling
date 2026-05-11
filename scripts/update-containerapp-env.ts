import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "dotenv";

type Options = {
  resourceGroup: string;
  appName: string;
  envFile: string;
  dryRun: boolean;
};

const DEFAULT_RESOURCE_GROUP = "rg-wafer-dev";
const DEFAULT_CONTAINER_APP = "waferdev-web";
const DEFAULT_ENV_FILE = ".env.publish";

function usage(): string {
  return [
    "Usage:",
    "  pnpm azure:env:update [-- --file .env.publish --resource-group rg-wafer-dev --app waferdev-web]",
    "",
    "Options:",
    `  --file <path>             Env file to read. Default: ${DEFAULT_ENV_FILE}`,
    `  --resource-group <name>   Azure resource group. Default: ${DEFAULT_RESOURCE_GROUP}`,
    `  --app <name>              Azure Container App name. Default: ${DEFAULT_CONTAINER_APP}`,
    "  --dry-run                 Print keys that would be updated without calling Azure.",
  ].join("\n");
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    resourceGroup: process.env.AZURE_RESOURCE_GROUP || DEFAULT_RESOURCE_GROUP,
    appName: process.env.AZURE_CONTAINER_APP || DEFAULT_CONTAINER_APP,
    envFile: process.env.AZURE_ENV_FILE || DEFAULT_ENV_FILE,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case "--":
        break;
      case "--file":
      case "-f":
        if (!next) throw new Error("--file requires a value");
        options.envFile = next;
        index++;
        break;
      case "--resource-group":
      case "-g":
        if (!next) throw new Error("--resource-group requires a value");
        options.resourceGroup = next;
        index++;
        break;
      case "--app":
      case "-n":
        if (!next) throw new Error("--app requires a value");
        options.appName = next;
        index++;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--help":
      case "-h":
        console.log(usage());
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function readEnvFile(path: string): Record<string, string> {
  const absolutePath = resolve(path);
  if (!existsSync(absolutePath)) {
    throw new Error(`Env file not found: ${absolutePath}`);
  }

  const parsed = parse(readFileSync(absolutePath));
  const entries = Object.entries(parsed).filter(([key]) => key.trim().length);
  if (!entries.length) {
    throw new Error(`No env vars found in ${absolutePath}`);
  }

  return Object.fromEntries(entries);
}

function mask(value: string): string {
  if (value.length <= 8) return "****";
  return `${value.slice(0, 3)}...${value.slice(-3)}`;
}

function runAz(args: string[]): Promise<void> {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn("az", args, {
      stdio: ["ignore", "inherit", "inherit"],
    });

    child.on("error", rejectCommand);
    child.on("close", (code) => {
      if (code === 0) {
        resolveCommand();
        return;
      }
      rejectCommand(new Error(`az exited with code ${code ?? "unknown"}`));
    });
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const env = readEnvFile(options.envFile);
  const setEnvVars = Object.entries(env).map(
    ([key, value]) => `${key}=${value}`,
  );

  console.log(
    `Updating ${setEnvVars.length} env vars on ${options.resourceGroup}/${options.appName}`,
  );
  for (const [key, value] of Object.entries(env)) {
    console.log(`  ${key}=${mask(value)}`);
  }

  if (options.dryRun) {
    console.log("Dry run only. Azure was not updated.");
    return;
  }

  await runAz([
    "containerapp",
    "update",
    "--resource-group",
    options.resourceGroup,
    "--name",
    options.appName,
    "--set-env-vars",
    ...setEnvVars,
    "--query",
    "{name:name,latestRevisionName:properties.latestRevisionName}",
    "--output",
    "table",
  ]);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  console.error("");
  console.error(usage());
  process.exit(1);
});
