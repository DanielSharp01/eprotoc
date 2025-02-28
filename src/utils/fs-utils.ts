import fs from "fs";
import path from "path";
import { inspect } from "util";

export function prettyWriteJsonFile(file: string, content: unknown) {
  if (file === "stdout") {
    console.log(inspect(content, { depth: null, colors: true }));
  } else {
    ensureDirectory(path.dirname(file));
    fs.writeFileSync(file, JSON.stringify(content, null, 2), "utf-8");
    console.info(`Definitions written to ${file}`);
  }
}

export function ensureDirectory(dir: string) {
  const dirStat = fs.existsSync(dir) ? fs.statSync(dir) : undefined;
  if (!dirStat) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      console.error(`Directory cannot be created at ${dir}`);
    }
  } else if (!dirStat.isDirectory()) {
    console.error(`Directory cannot be created at ${dir}`);
    process.exit(1);
  }
}

export function writeSourceFile(file: string, source: string) {
  ensureDirectory(path.dirname(file));
  fs.writeFileSync(file, source, "utf-8");
}

export function addDotSlash(path: string) {
  if (!path.startsWith(".")) {
    return `./${path}`;
  }

  return path;
}

export function swapDirectory(from: string, to: string, file: string) {
  return to === "."
    ? addDotSlash(path.relative(from, file))
    : path.join(to, path.relative(from, file));
}

export function swapExtension(file: string, ext: string) {
  return file.slice(0, -path.extname(file).length) + ext;
}

export function collectFilesWithExtension(dir: string, ext: string): string[] {
  dir ??= dir;
  if (!fs.existsSync(dir)) {
    console.log(`Directory "${dir}" does not exist.`);
    process.exit(1);
  }
  if (!fs.statSync(dir).isDirectory()) {
    console.log(`"${dir}" is not a directory.`);
    process.exit(1);
  }
  const files: string[] = [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectFilesWithExtension(fullPath, ext));
    } else if (path.extname(entry.name) === ext) {
      files.push(fullPath);
    }
  }

  return files;
}
