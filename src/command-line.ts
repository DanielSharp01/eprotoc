import path from "path";
import { collectFilesWithExtension } from "./fs-utils";

const GEN_OPTS = ["native", "extended", "skip"] as const;

function parseOptionValue(argv: string[]): string | undefined {
  if (
    argv.length === 0 ||
    argv[0].startsWith("-") ||
    argv[0].startsWith("--")
  ) {
    return undefined;
  }

  const ret = argv[0];
  argv.splice(0, 1);
  return ret;
}

export function parseCommandLine() {
  const argv = process.argv.slice(2);
  const opts = {
    printDefinitions: undefined as string | undefined,
    printAST: undefined as string | undefined,
    outputDir: ".",
    codeGen: "native" as (typeof GEN_OPTS)[number],
  };
  while (
    argv.length > 0 &&
    (argv[0].startsWith("--") || argv[0].startsWith("-"))
  ) {
    if (argv[0] === "--help") {
      printUsage();
      process.exit(0);
    } else if (argv[0] === "-d" || argv[0] === "--definitions") {
      argv.splice(0, 1);
      opts.printDefinitions = parseOptionValue(argv) ?? "stdout";
    } else if (argv[0] === "-a" || argv[0] === "--ast") {
      argv.splice(0, 1);
      opts.printAST = parseOptionValue(argv) ?? "stdout";
    } else if (argv[0] === "-o" || argv[0] === "--output") {
      argv.splice(0, 1);
      const value = parseOptionValue(argv);
      if (!value) {
        console.error(`Value required for option "output".`);
        forMoreInfo();
      }
      opts.outputDir = value;
    } else if (argv[0] === "-g" || argv[0] === "--gen") {
      argv.splice(0, 1);
      const value = parseOptionValue(argv);
      if (!value) {
        console.error(
          `Value required for option "gen". Valid options ${GEN_OPTS.map(
            (s) => `"${s}"`
          ).join(", ")}.`
        );
        forMoreInfo();
      }
      if (!(GEN_OPTS as readonly string[]).includes(value)) {
        argv.splice(0, 1);
        console.error(
          `Unrecognized gen option "gen". Valid options ${GEN_OPTS.map(
            (s) => `"${s}"`
          ).join(", ")}.`
        );
        forMoreInfo();
      }
      opts.codeGen = value as "native" | "extended" | "skip";
    } else {
      argv.splice(0, 1);
    }
  }

  if (argv.length === 0) {
    console.error("No source provided.");
    forMoreInfo();
  }

  return {
    ...opts,
    files: collectFilesWithExtension(argv[0], ".eproto"),
    printAST: prefixOutputDir(opts.outputDir, opts.printAST),
    printDefinitions: prefixOutputDir(opts.outputDir, opts.printDefinitions),
    rootDir: argv[0],
  };
}

function printUsage() {
  console.error("Usage: eproto [options] sourceDir");
  console.error("Options:");
  console.error(
    "  -d/--definitions <filename>       Write definitions discovered by the compiler to a json file"
  );
  console.error(
    "  -o/--output <dirname>             Write definitions discovered by the compiler to a json file"
  );
  console.error(
    "  -g/--gen {native|extended|skip}   Write definitions discovered by the compiler to a json file"
  );
}

function forMoreInfo(): never {
  console.error("For more information use eprotoc --help");
  process.exit(1);
}

function prefixOutputDir(
  outputDir: string,
  file: string | undefined
): string | undefined {
  if (file === "stdout" || !file) {
    return file;
  }

  return path.join(outputDir, file);
}
