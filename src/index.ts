#!/usr/bin/env node
import { parseCommandLine } from "./command-line";
import { DiagnosticCollection } from "./diagnostic";
import { Logger } from "./logger";
import { SemanticaAnalyzer } from "./analyzer";
import fs from "fs";

async function main() {
  const logger = new Logger("debug");
  const diagnostics = new DiagnosticCollection(logger);
  const opts = parseCommandLine();
  logger.debug("Parsed opts", opts);
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
    prettyWriteJsonFile(
      "output/definitions.json",
      semanticAnalyzer.getDefinitions()
    );
  }
}

main();

function prettyWriteJsonFile(file: string, content: unknown) {
  fs.writeFileSync(file, JSON.stringify(content, null, 2), "utf-8");
}