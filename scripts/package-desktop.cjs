const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const releaseRoot = path.join(projectRoot, "release");
const appName = "CSV Workspace Editor";
const outputDir = path.join(releaseRoot, appName);
const electronExecutable = require("electron");
const electronDist = path.dirname(electronExecutable);

function assertInsideProject(targetPath) {
  const resolved = path.resolve(targetPath);
  const relative = path.relative(projectRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to write outside project: ${resolved}`);
  }
  return resolved;
}

function copyDirectory(source, destination) {
  fs.cpSync(source, destination, { recursive: true });
}

function writeAppBundle(appDir) {
  assertInsideProject(appDir);
  fs.mkdirSync(appDir, { recursive: true });
  fs.rmSync(path.join(appDir, "dist"), { recursive: true, force: true });
  fs.rmSync(path.join(appDir, "electron"), { recursive: true, force: true });
  copyDirectory(path.join(projectRoot, "dist"), path.join(appDir, "dist"));
  copyDirectory(path.join(projectRoot, "electron"), path.join(appDir, "electron"));
  fs.writeFileSync(
    path.join(appDir, "package.json"),
    JSON.stringify(
      {
        name: "csv-workspace-editor-desktop",
        version: require(path.join(projectRoot, "package.json")).version,
        private: true,
        type: "module",
        main: "electron/main.cjs"
      },
      null,
      2
    ),
    "utf8"
  );
}

function packageFullApp() {
  fs.rmSync(releaseRoot, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });

  copyDirectory(electronDist, outputDir);

  const sourceExe = path.join(outputDir, "electron.exe");
  const targetExe = path.join(outputDir, `${appName}.exe`);
  if (!fs.existsSync(sourceExe)) {
    throw new Error(`Electron executable not found: ${sourceExe}`);
  }
  fs.renameSync(sourceExe, targetExe);

  const appDir = path.join(outputDir, "resources", "app");
  writeAppBundle(appDir);

  console.log(`Desktop app packaged: ${targetExe}`);
}

function refreshExistingAppResources(error) {
  const appDir = path.join(outputDir, "resources", "app");
  if (!fs.existsSync(appDir)) {
    throw error;
  }
  writeAppBundle(appDir);
  console.log(`Desktop app resources refreshed: ${appDir}`);
  console.log("Existing executable was locked, so Electron runtime files were left in place.");
}

function main() {
  assertInsideProject(releaseRoot);
  try {
    packageFullApp();
  } catch (error) {
    if (error && (error.code === "EPERM" || error.code === "EBUSY")) {
      refreshExistingAppResources(error);
      return;
    }
    throw error;
  }
}

main();
