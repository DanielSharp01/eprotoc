import path from "path";

export function parseCommandLine() {
  const fileNames = process.argv.slice(1);
  if (fileNames.length === 0) {
    console.error("Usage eproto <filename> [<filename>...]");
    process.exit(1);
  }

  return {
    files: fileNames.filter((f) => path.extname(f) === ".eproto"),
  };
}
