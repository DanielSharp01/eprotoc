#!/usr/bin/env node
import { parseCommandLine } from "./command-line";
import { DiagnosticCollection } from "./diagnostic";
import { Logger } from "./logger";
import { SemanticaAnalyzer } from "./analyzer";
import fs from "fs";
import { inspect } from "util";

const logger = new Logger("debug");

async function main() {
  const diagnostics = new DiagnosticCollection(logger);
  const opts = parseCommandLine();
  const semanticAnalyzer = new SemanticaAnalyzer(diagnostics);

  for (const file of new Set(opts.files)) {
    await semanticAnalyzer.parseFile(file);
  }
  semanticAnalyzer.analyze();
  if (diagnostics.items.length > 0) {
    diagnostics.print();
    logger.info(`Compilation failed with ${diagnostics.items.length} errors`);
  } else {
    logger.info("Compilation successful");
    if (opts.printDefinitions) {
      prettyWriteJsonFile(
        opts.printDefinitions,
        semanticAnalyzer.getDefinitions()
      );
    }
  }
}

main();

function prettyWriteJsonFile(file: string, content: unknown) {
  if (file === "stdout") {
    console.log(inspect(content, { depth: null, colors: true }));
  } else {
    fs.writeFileSync(file, JSON.stringify(content, null, 2), "utf-8");
    logger.info(`Definitions written to ${file}`);
  }
}