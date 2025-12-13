# va-payload-lint

Standalone CLI tool to validate **VA Form 526** submission payloads against the
canonical JSON Schema used by `vets-api`.

This tool helps identify malformed or invalid payloads coming from
`vets-website` **without changing either repo**.

---

## What this tool does

* Validates a Form 526 submission payload against the official JSON Schema
* Points to the **exact JSON path** that is invalid
* Helps debug why a payload is rejected by `vets-api`
* Can be run:

  * from the clipboard
  * from a file
  * in dev mode
  * fully offline

---

## Requirements

* **Node.js 18+** (Node **20 LTS recommended**)
* npm

### If you use nvm

```bash
nvm install 20
nvm use 20
node -v
```

---

## Get the tool

Clone the repo and enter it:

```bash
git clone <repo-url>
cd va-payload-lint
```

---

## Install dependencies

```bash
npm ci
```

---

## Build the tool

Compile TypeScript to JavaScript:

```bash
npm run build
```

This creates the runnable CLI at:

```
dist/index.js
```

---

## (Optional) Make the CLI available globally

```bash
npm link
```

This allows you to run `va-payload-lint` instead of `node dist/index.js`.

---

## Usage

### Option A (recommended): validate directly from clipboard

This is the **primary workflow** and matches how payloads are copied from
Chrome DevTools → Network tab.

```bash
pbpaste | node dist/index.js
```

If you ran `npm link`:

```bash
pbpaste | va-payload-lint
```

With key-casing warnings:

```bash
pbpaste | node dist/index.js --expect-case snake
```

---

### Option B: validate from a JSON file

Useful when you want to save or share a payload for repeated debugging.

Create a payload file:

```bash
pbpaste > payload.json
```

Validate it:

```bash
node dist/index.js --json payload.json
```

---

## Development usage (no build step)

Run directly from TypeScript (useful while iterating on the tool):

```bash
npm run dev
```

Then paste a payload:

```bash
pbpaste | npm run dev
```

---

## Offline / schema-controlled usage

Use a locally downloaded schema (no network calls):

```bash
node dist/index.js --json payload.json --schema-file 526.schema.json
```

Disable schema caching:

```bash
node dist/index.js --no-cache
```

---

## Exit codes

| Code | Meaning                              |
| ---- | ------------------------------------ |
| 0    | Payload is schema-valid              |
| 1    | Schema validation errors             |
| 2    | Invalid JSON or missing payload file |
| 3    | Tool/runtime error                   |

---

## Notes

* This tool validates **JSON schema correctness only**
* A payload may still fail backend **business logic**
* Treat payloads as **sensitive**
* Do **not** commit real user data

---

## TL;DR

Copy and have in your paste buffer the payload you are trying to compare.
To do this, in your browser, go to: Inspect > Network > Response > Select the Service you want the payload of.
In this case, I want 526EZ.

```bash
npm ci
npm run build
 pbpaste | python3 -c 'import sys, json; obj=json.load(sys.stdin); print(json.dumps(obj.get("formData", obj)))' \
  | node /Users/aliciaperry/VA_Code/va-payload-lint/dist/index.js \
  --schema-file ./node_modules/vets-json-schema/dist/21-526EZ-ALLCLAIMS-schema.json
```
