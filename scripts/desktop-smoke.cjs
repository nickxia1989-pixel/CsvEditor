const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const args = { exe: "" };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--exe") {
      args.exe = argv[index + 1] ?? "";
      index += 1;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "csv-editor-desktop-"));
  const resultPath = path.join(tempRoot, "result.json");
  const csvPath = path.join(tempRoot, "smoke.csv");
  fs.writeFileSync(csvPath, Buffer.from("\uFEFFA,B\r\n1,2\r\n", "utf8"));
  for (let index = 0; index < 12; index += 1) {
    const padded = String(index).padStart(2, "0");
    fs.writeFileSync(path.join(tempRoot, `smoke-tab-${padded}.csv`), `A,B\r\n${index},${index + 1}\r\n`, "utf8");
  }

  const electronExecutable = args.exe || require("electron");
  const childArgs = args.exe ? [] : [projectRoot];
  const child = spawn(electronExecutable, childArgs, {
    cwd: projectRoot,
    env: {
      ...process.env,
      CSV_EDITOR_SMOKE_TEST: "1",
      CSV_EDITOR_SMOKE_DIR: tempRoot,
      CSV_EDITOR_SMOKE_RESULT: resultPath
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const exitCode = await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.kill();
      resolve(124);
    }, 60000);
    child.on("exit", (code) => {
      clearTimeout(timeout);
      resolve(code ?? 1);
    });
  });

  const result = fs.existsSync(resultPath) ? JSON.parse(fs.readFileSync(resultPath, "utf8")) : null;
  const saved = fs.readFileSync(csvPath);
  const savedText = saved.toString("utf8");
  const hasUtf8Bom = saved.length >= 3 && saved[0] === 0xef && saved[1] === 0xbb && saved[2] === 0xbf;

  if (exitCode !== 0 || !result || result.error || !hasUtf8Bom || !savedText.includes("3,4")) {
    console.error(JSON.stringify({ exitCode, result, hasUtf8Bom, savedText, stdout, stderr }, null, 2));
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        status: "passed",
        executable: electronExecutable,
        tempRoot,
        entries: result.entries,
        savedVersion: result.savedVersion,
        hasUtf8Bom,
        windowControls: result.windowControls,
        regions: result.regions,
        layout: result.layout
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
