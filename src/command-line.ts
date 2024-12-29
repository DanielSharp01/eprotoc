import path from "path";

export function parseCommandLine() {
  let idx = 2;
  const opts = {
    printDefinitions: undefined as string | undefined,
  };
  while (idx < process.argv.length && process.argv[idx].startsWith("--")) {
    if (process.argv[idx] === "--help") {
      printUsage();
      process.exit(0);
    }
    if (process.argv[idx] === "--definitions") {
      opts.printDefinitions = process.argv[++idx];
    }
    idx++;
  }

  const fileNames = process.argv.slice(idx);
  if (fileNames.length === 0) {
    printUsage();
    process.exit(1);
  }

  return {
    ...opts,
    files: fileNames.filter((f) => path.extname(f) === ".eproto"),
  };
}

function printUsage() {
  console.error("Usage: eproto [options] file...");
  console.error("Options:");
  console.error(
    "  --definitions <filename>    Write definitions discovered by the compiler to a json file"
  );
}
