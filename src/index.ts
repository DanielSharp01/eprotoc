#!/usr/bin/env node
import fs from "fs";
import { parseCommandLine } from "./command-line";
import { DiagnosticCollection } from "./diagnostic";
import { Logger } from "./logger";
import { SemanticAnalyzer } from "./analyzer";
import { ensureDirectory, prettyWriteJsonFile } from "./utils/fs-utils";
import { TSCodeGenerator } from "./codegen";
import { ASTNode, parse } from "./parser";
import { tokenize } from "./tokenizer";
import { groupByMultiple } from "./utils/group-by";

const logger = new Logger("debug");

function generator(opts: ReturnType<typeof parseCommandLine>) {
  const diagnostics = new DiagnosticCollection(logger, true);
  const semanticAnalyzer = new SemanticAnalyzer(diagnostics);
  const generator = new TSCodeGenerator(logger);

  ensureDirectory(logger, opts.outputDir);

  const fileASTs: Record<string, ASTNode[]> = {};
  for (const file of new Set(opts.files)) {
    const ast = parse(
      tokenize(file, fs.readFileSync(file, "utf-8"), diagnostics),
      diagnostics
    );
    fileASTs[file] = ast;
  }

  if (opts.printAST) {
    prettyWriteJsonFile(logger, opts.printAST, fileASTs);
  }

  for (const [file, ast] of Object.entries(fileASTs)) {
    semanticAnalyzer.analyzeASTNodes(file, ast);
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
      Object.fromEntries(
        groupByMultiple(
          semanticAnalyzer.definitions,
          (d) => d.packageId
        ).entries()
      )
    );
  }

  if (opts.codeGen === "skip") {
    return;
  }

  logger.info(`Beggining code generation using ${opts.codeGen}`);
  generator.generate(
    opts.rootDir,
    opts.outputDir,
    semanticAnalyzer.definitions,
    opts.codeGen === "native"
  );
  logger.info("Generation successful!");
}

const opts = parseCommandLine();
generator(opts);
