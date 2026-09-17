#!/usr/bin/env node
// One-command release: bumps the version in package.json, tauri.conf.json
// and Cargo.toml, commits, tags vX.Y.Z and pushes. GitHub Actions then
// builds the installer and attaches it to a draft Release.
//
//   npm run release -- 0.2.0     (or: node scripts/release.mjs 0.2.0)

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("Usage: npm run release -- 0.2.0");
  process.exit(1);
}

const run = (cmd) => execSync(cmd, { stdio: "inherit" });
const file = (rel) => new URL(`../${rel}`, import.meta.url);

const pkg = JSON.parse(readFileSync(file("package.json"), "utf8"));
pkg.version = version;
writeFileSync(file("package.json"), JSON.stringify(pkg, null, 2) + "\n");

const conf = JSON.parse(readFileSync(file("src-tauri/tauri.conf.json"), "utf8"));
conf.version = version;
writeFileSync(file("src-tauri/tauri.conf.json"), JSON.stringify(conf, null, 2) + "\n");

const cargo = readFileSync(file("src-tauri/Cargo.toml"), "utf8");
writeFileSync(
  file("src-tauri/Cargo.toml"),
  cargo.replace(/^version = ".*"$/m, `version = "${version}"`)
);

run("git add -A");
run(`git commit -m "release v${version}"`);
run(`git tag v${version}`);
run("git push");
run("git push --tags");

console.log(`\nv${version} pushed — GitHub Actions is now building the installer.`);
console.log("Publish the draft release on GitHub when the build finishes.");
