#!/usr/bin/env node
import { parseCommandLine } from "./command-line";
import { DiagnosticCollection } from "./diagnostic";
import { Logger } from "./logger";
import { SemanticAnalyzer } from "./analyzer";
import { ensureDirectory, prettyWriteJsonFile } from "./fs-utils";
import { TSCodeGenerator } from "./codegen";
import fs from "fs";

const logger = new Logger("debug");

async function main() {
  const diagnostics = new DiagnosticCollection(logger);
  const opts = parseCommandLine();
  const semanticAnalyzer = new SemanticAnalyzer(diagnostics);

  fs.rmdirSync(opts.outputDir, { recursive: true });
  ensureDirectory(logger, opts.outputDir);

  for (const file of new Set(opts.files)) {
    await semanticAnalyzer.parseFile(file);
  }

  if (opts.printAST) {
    prettyWriteJsonFile(logger, opts.printAST, semanticAnalyzer.getASTs());
  }

  semanticAnalyzer.analyze();
  if (diagnostics.items.length > 0) {
    diagnostics.print();
    logger.info(`Compilation failed with ${diagnostics.items.length} errors`);
    process.exit(1);
  }
  logger.info("Compilation successful");
  if (opts.printDefinitions) {
    prettyWriteJsonFile(
      logger,
      opts.printDefinitions,
      semanticAnalyzer.getPackageDefinitions()
    );
  }

  if (opts.codeGen === "skip") {
    return;
  }

  logger.info(`Beggining code generation using ${opts.codeGen}`);
  const generator = new TSCodeGenerator(logger);
  generator.generate(opts.rootDir, opts.outputDir, semanticAnalyzer);
}

main();