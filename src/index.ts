import fs from "fs";
import process from "process";
import AjvDraft04 from "ajv-draft-04";
import type { ErrorObject } from "ajv";
import addFormats from "ajv-formats";

type KeyCase = "camel" | "snake" | "dash" | "unknown";

type Options = {
  jsonPath?: string;
  schemaFile?: string;
  schemaCache?: string;
  baseUrl?: string;
  schemaUrl?: string;
  cache: boolean;
  expectCase: KeyCase;
};

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    cache: true,
    expectCase: "unknown",
    baseUrl: "https://sandbox-api.va.gov/services/claims/v1",
    schemaCache: ".cache/526.schema.json",
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];

    if (a === "--json" && next) { opts.jsonPath = next; i++; continue; }
    if (a === "--schema-file" && next) { opts.schemaFile = next; i++; continue; }
    if (a === "--schema-cache" && next) { opts.schemaCache = next; i++; continue; }
    if (a === "--base-url" && next) { opts.baseUrl = next; i++; continue; }
    if (a === "--schema-url" && next) { opts.schemaUrl = next; i++; continue; }
    if (a === "--no-cache") { opts.cache = false; continue; }
    if (a === "--expect-case" && next) { opts.expectCase = next as KeyCase; i++; continue; }
    if (a === "-h" || a === "--help") printHelpAndExit(0);
  }

  return opts;
}

function printHelpAndExit(code: number): never {
  console.log(`
va-payload-lint

Usage:
  pbpaste | node dist/index.js --schema-file <path-to-schema>
  node dist/index.js --json payload.json --schema-file <path-to-schema>

Options:
  --json <path>            Read payload from file (otherwise stdin)
  --schema-file <path>     Validate against a local schema file (offline mode)
  --schema-cache <path>    Cache fetched schema (default: .cache/526.schema.json)
  --no-cache               Disable cache usage
  --base-url <url>         Base URL for schema endpoint (default sandbox)
  --schema-url <url>       Full schema URL override
  --expect-case <case>     camel|snake|dash (warn only)
  -h, --help               Show help
`);
  process.exit(code);
}

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
  const f = (globalThis as any).fetch;
  if (typeof f !== "function") {
    throw new Error("Global fetch() not available. Use --schema-file or upgrade Node.");
  }
  const res = await f(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  return await res.json();
}

async function loadSchema(opts: Options): Promise<any> {
  // ✅ This is the key: if schemaFile is provided, we NEVER fetch.
  if (opts.schemaFile) {
    if (!fs.existsSync(opts.schemaFile)) {
      throw new Error(`Schema file not found: ${opts.schemaFile}`);
    }
    return JSON.parse(fs.readFileSync(opts.schemaFile, "utf8"));
  }

  const schemaUrl = opts.schemaUrl ?? `${opts.baseUrl}/forms/526`;

  if (opts.cache && opts.schemaCache && fs.existsSync(opts.schemaCache)) {
    try {
      return JSON.parse(fs.readFileSync(opts.schemaCache, "utf8"));
    } catch {
      // fall through
    }
  }

  const schema = await fetchJson(schemaUrl);

  if (opts.cache && opts.schemaCache) {
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
    const path = e.instancePath || "(root)";
    console.log(`  ✗ ${path}: ${e.message}`);
    if (e.params && Object.keys(e.params).length) {
      console.log(`    params: ${JSON.stringify(e.params)}`);
    }
  }
}

async function main() {
  const opts = parseArgs(process.argv);

  const payloadText = opts.jsonPath
    ? fs.readFileSync(opts.jsonPath, "utf8")
    : await readStdin();

  let payload: any;
  try {
    payload = JSON.parse(payloadText);
  } catch (e: any) {
    console.error("Invalid JSON:", e?.message ?? String(e));
    process.exit(2);
  }

  const schema = await loadSchema(opts);

  const ajv = new AjvDraft04({ allErrors: true, strict: false });
  addFormats(ajv);

  const validate = ajv.compile(schema);
  const ok = validate(payload);

  console.log("\nVA Form 526 Payload Validation\n");

  const detected = detectKeyCase(payload);
  if (opts.expectCase !== "unknown" && detected !== "unknown" && detected !== opts.expectCase) {
    console.log(`⚠ Key casing looks like ${detected}, but expected ${opts.expectCase}`);
  }

  if (ok) {
    console.log("✓ Schema validation: PASS");
    process.exit(0);
  } else {
    console.log("✗ Schema validation: FAIL");
    printAjvErrors(validate.errors);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err?.message ?? String(err));
  process.exit(3);
});
