#!/usr/bin/env node
// Verify a Tauri updater signature against the public key embedded in the app
// config. Run from the repository root:
//
//   node scripts/verify-signature.cjs <installer.exe> <installer.sig> [tauri.conf.json]
//
// Exits 0 only when the signature really verifies with the embedded key, which is
// what the in-app updater does after downloading an update. A mismatch (for
// example a typo when the public key was copied into tauri.conf.json) makes every
// update fail with "signature verification failed", so packaging stops here.
const fs = require("fs");
const crypto = require("crypto");

const [, , exePath, sigPath, confPath = "src-tauri/tauri.conf.json"] = process.argv;
if (!exePath || !sigPath) {
  console.error("usage: node scripts/verify-signature.cjs <installer.exe> <installer.sig> [tauri.conf.json]");
  process.exit(2);
}

/** Decode a base64-wrapped minisign public key (what tauri.conf.json stores). */
function decodePublicKey(value) {
  const text = Buffer.from(value.trim(), "base64").toString("utf8");
  const source = text.includes("untrusted comment") ? text : value;
  const line = source
    .split(/\r?\n/)
    .find((entry) => entry && !entry.startsWith("untrusted comment"));
  if (!line) throw new Error("public key has no key line");
  const blob = Buffer.from(line.trim(), "base64");
  return {
    algorithm: blob.subarray(0, 2).toString("latin1"),
    keyId: blob.subarray(2, 10).toString("hex"),
    key: blob.subarray(10, 42),
  };
}

/** Decode a base64-wrapped minisign signature file (what a `.sig` file stores). */
function decodeSignature(value) {
  const text = Buffer.from(value.trim(), "base64").toString("utf8");
  const source = text.includes("untrusted comment") ? text : value;
  const lines = source.split(/\r?\n/);
  const blob = Buffer.from(lines[1].trim(), "base64");
  return {
    algorithm: blob.subarray(0, 2).toString("latin1"),
    keyId: blob.subarray(2, 10).toString("hex"),
    signature: blob.subarray(10, 74),
    trustedComment: (lines[2] || "").trim(),
  };
}

const conf = JSON.parse(fs.readFileSync(confPath, "utf8"));
const embeddedKey = conf?.plugins?.updater?.pubkey;
if (!embeddedKey) {
  console.error(`${confPath} has no plugins.updater.pubkey`);
  process.exit(2);
}

const publicKey = decodePublicKey(embeddedKey);
const signature = decodeSignature(fs.readFileSync(sigPath, "utf8"));
const data = fs.readFileSync(exePath);

const messages = {
  // "ED" = Ed25519 over BLAKE2b-512 of the file (minisign prehashed mode).
  ED: crypto.createHash("blake2b512").update(data).digest(),
  Ed: data,
};
const message = messages[signature.algorithm];
if (!message) {
  console.error(`unsupported signature algorithm: ${signature.algorithm}`);
  process.exit(2);
}

const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), publicKey.key]);
const keyObject = crypto.createPublicKey({ key: spki, format: "der", type: "spki" });
const valid = crypto.verify(null, message, keyObject, signature.signature);

console.log(`installer : ${exePath} (${data.length} bytes)`);
console.log(`signature : alg=${signature.algorithm} keyid=${signature.keyId}`);
console.log(`embedded  : alg=${publicKey.algorithm} keyid=${publicKey.keyId}`);
console.log(`trusted   : ${signature.trustedComment}`);
if (signature.keyId !== publicKey.keyId) {
  console.error("FAIL: the signature was made by a different key than the one embedded in the app");
  process.exit(1);
}
if (!valid) {
  console.error(
    "FAIL: the signature does not verify with plugins.updater.pubkey — every in-app update would be rejected",
  );
  process.exit(1);
}
console.log("OK: the in-app updater will accept this file");
