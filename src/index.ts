import { Command } from "commander";
import Ajv, { type ErrorObject } from "ajv";
import addFormats from "ajv-formats";
import chalk from "chalk";
import fs from "node:fs";
import process from "node:process";

type KeyCase = "camel" | "snake" | "dash" | "unknown";

const program = new Command();

program
  .name("va-payload-lint")
  .description("Validate a VA Form 526 submission payload against the canonical JSON schema")
  .option("--schema-url <url>", "Override schema URL")
  .option(
    "--base-url <url>",
    "VA claims service base URL",
    "https://sandbox-api.va.gov/services/claims/v1"
  )
  .option(
    "--schema-cache <path>",
    "Cache schema to a file",
    ".cache/526.schema.json"
  )
  .option("--no-cache", "Do not read/write schema cache")
  .option("--json <path>", "Read payload JSON from a file (otherwise stdin)")
  .option(
    "--expect-case <case>",
    "Warn if payload keys don't match expected casing (camel|snake|dash)",
    "unknown"
  )
  .parse(process.argv);

const opts = program.opts<{
  schemaUrl?: string;
  baseUrl: string;
  schemaCache: string;
  cache: boolean;
  json?: string;
  expectCase: KeyCase;
}>();

async function readStdin(): Promise<string> {
  return await new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

function ensureDir(path: string) {
  const dir = path.split("/").slice(0, -1).join("/");
  if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.statusText}`);
  return await res.json();
}

async function loadSchema(): Promise<any> {
  const schemaUrl = opts.schemaUrl ?? `${opts.baseUrl}/forms/526`;

  if (opts.cache && fs.existsSync(opts.schemaCache)) {
    return JSON.parse(fs.readFileSync(opts.schemaCache, "utf8"));
  }

  const schema = await fetchJson(schemaUrl);

  if (opts.cache) {
    ensureDir(opts.schemaCache);
    fs.writeFileSync(opts.schemaCache, JSON.stringify(schema, null, 2), "utf8");
  }

  return schema;
}

function detectKeyCase(obj: unknown): KeyCase {
  const keys: string[] = [];

  const walk = (v: any) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) return v.forEach(walk);
    for (const k of Object.keys(v)) {
      keys.push(k);
      if (keys.length > 200) return;
      walk(v[k]);
    }
  };

  walk(obj);

  if (keys.some((k) => k.includes("-"))) return "dash";
  if (keys.some((k) => k.includes("_"))) return "snake";
  if (keys.some((k) => /[a-z][A-Z]/.test(k))) return "camel";
  return "unknown";
}

function printAjvErrors(errors?: ErrorObject[] | null) {
  if (!errors?.length) return;
  for (const e of errors) {
    console.log(
      `  ${chalk.red("✗")} ${chalk.cyan(e.instancePath || "(root)")}: ${e.message}`
    );
  }
}

async function main() {
  const payloadText = opts.json
    ? fs.readFileSync(opts.json, "utf8")
    : await readStdin();

  let payload: any;
  try {
    payload = JSON.parse(payloadText);
  } catch (e: any) {
    console.error(chalk.red("Invalid JSON:"), e.message);
    process.exit(2);
  }

  const schema = await loadSchema();

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);

  const validate = ajv.compile(schema);
  const ok = validate(payload);

  console.log(chalk.bold("\nVA Form 526 Payload Validation\n"));

  const detected = detectKeyCase(payload);
  if (opts.expectCase !== "unknown" && detected !== opts.expectCase) {
    console.log(
      chalk.yellow(
        `⚠ Key casing looks like ${detected}, but expected ${opts.expectCase}`
      )
    );
  }

  if (ok) {
    console.log(chalk.green("✓ Schema validation: PASS"));
    process.exit(0);
  } else {
    console.log(chalk.red("✗ Schema validation: FAIL"));
    printAjvErrors(validate.errors);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(chalk.red("Fatal error:"), err.message);
  process.exit(3);
});
