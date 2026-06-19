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
  const globalSearchDir = path.join(tempRoot, "nested");
  fs.mkdirSync(globalSearchDir, { recursive: true });
  const globalRows = Array.from({ length: 42 }, (_value, index) => {
    const label = `GLOBAL_NEEDLE_${String(index + 1).padStart(2, "0")}`;
    if (index === 0) {
      return `${index + 1},当Trigger填为16；${label}；90时，则只有当TriggerSourceSkillID这个技能释放时，才有90%概率触发${label}这个技能。这里故意写成长文本用于检查全表搜索结果不会把排版撑乱。`;
    }
    return `${index + 1},${label}`;
  });
  fs.writeFileSync(path.join(globalSearchDir, "smoke-global.csv"), `说明,说明\r\nid,name\r\n${globalRows.join("\r\n")}\r\n`, "utf8");
  for (let index = 0; index < 12; index += 1) {
    const padded = String(index).padStart(2, "0");
    fs.writeFileSync(path.join(tempRoot, `smoke-tab-${padded}.csv`), `A,B\r\n${index},${index + 1}\r\n`, "utf8");
  }
  const longHeader = Array.from({ length: 14 }, (_value, index) => `LongCol${index + 1}`).join(",");
  const longRows = Array.from({ length: 180 }, (_value, index) =>
    Array.from({ length: 14 }, (_cell, col) => `LONG_R${index + 1}_C${col + 1}`).join(",")
  );
  fs.writeFileSync(path.join(tempRoot, "smoke-long.csv"), `${longHeader}\r\n${longRows.join("\r\n")}\r\n`, "utf8");

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
        favorites: result.favorites,
        headerDrag: result.headerDrag,
        filter: result.filter,
        visual: result.visual,
        search: result.search,
        globalSearch: result.globalSearch,
        quickOpen: result.quickOpen,
        split: result.split,
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
