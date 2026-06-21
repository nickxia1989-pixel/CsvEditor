const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const releaseRoot = path.join(projectRoot, "release-mac");
const appName = "CSV Workspace Editor";
const outputApp = path.join(releaseRoot, `${appName}.app`);
const electronExecutable = require("electron");

function assertInsideProject(targetPath) {
  const resolved = path.resolve(targetPath);
  const relative = path.relative(projectRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to write outside project: ${resolved}`);
  }
  return resolved;
}

function copyDirectory(source, destination) {
  fs.cpSync(source, destination, { recursive: true, force: true, verbatimSymlinks: true });
}

function getElectronAppPath() {
  if (process.platform !== "darwin") {
    throw new Error("Mac desktop packaging must be run on macOS. Use npm run dist:win for Windows packaging.");
  }

  const executablePath = path.resolve(electronExecutable);
  const appPath = path.resolve(path.dirname(executablePath), "..", "..");
  const infoPlistPath = path.join(appPath, "Contents", "Info.plist");
  if (path.basename(appPath) !== "Electron.app" || !fs.existsSync(infoPlistPath)) {
    throw new Error(`Electron.app bundle not found from executable: ${executablePath}`);
  }
  return appPath;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapePlistString(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function replacePlistString(source, key, value) {
  const escapedKey = escapeRegExp(key);
  const pattern = new RegExp(`(<key>${escapedKey}</key>\\s*<string>)([^<]*)(</string>)`);
  if (pattern.test(source)) {
    return source.replace(pattern, (_match, prefix, _current, suffix) => `${prefix}${escapePlistString(value)}${suffix}`);
  }

  const insertion = `\t<key>${key}</key>\n\t<string>${escapePlistString(value)}</string>\n`;
  if (!source.includes("</dict>")) {
    throw new Error("Info.plist does not contain a closing </dict> tag.");
  }
  return source.replace("</dict>", `${insertion}</dict>`);
}

function updateInfoPlist(appDir) {
  const infoPlistPath = path.join(appDir, "Contents", "Info.plist");
  let plist = fs.readFileSync(infoPlistPath, "utf8");
  plist = replacePlistString(plist, "CFBundleDisplayName", appName);
  fs.writeFileSync(infoPlistPath, plist, "utf8");
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

function packageMacApp() {
  assertInsideProject(releaseRoot);
  const electronAppPath = getElectronAppPath();

  fs.rmSync(releaseRoot, { recursive: true, force: true });
  fs.mkdirSync(releaseRoot, { recursive: true });
  copyDirectory(electronAppPath, outputApp);

  updateInfoPlist(outputApp);
  writeAppBundle(path.join(outputApp, "Contents", "Resources", "app"));

  console.log(`Mac desktop app packaged: ${outputApp}`);
}

packageMacApp();
