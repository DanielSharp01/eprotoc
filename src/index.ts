#!/usr/bin/env node
import fs from "fs";
import { parseCommandLine } from "./command-line";
import { DiagnosticCollection } from "./diagnostic";
import { definitionJSON, SemanticAnalyzer } from "./analyzer";
import { ensureDirectory, prettyWriteJsonFile } from "./utils/fs-utils";
import { generateTsProto } from "./codegen/ts-proto-gen";
import { ASTNode, parse } from "./parser";
import { tokenize } from "./tokenizer";
import { generateZodFromMessageDefinitions } from "./codegen/zod-gen";
import { onlyForLogLevel } from "./logger";

global.console = onlyForLogLevel(global.console, "debug");

function generator(opts: ReturnType<typeof parseCommandLine>) {
  const diagnostics = new DiagnosticCollection(true);
  const semanticAnalyzer = new SemanticAnalyzer(diagnostics);

  ensureDirectory(opts.outputDir);

  const fileASTs: Record<string, ASTNode[]> = {};
  for (const file of new Set(opts.files)) {
    const ast = parse(
      tokenize(file, fs.readFileSync(file, "utf-8"), diagnostics),
      diagnostics
    );
    fileASTs[file] = ast;
  }

  if (opts.printAST) {
    prettyWriteJsonFile(opts.printAST, fileASTs);
  }

  for (const [file, ast] of Object.entries(fileASTs)) {
    semanticAnalyzer.analyzeASTNodes(file, ast);
  }
  semanticAnalyzer.analyze();

  if (diagnostics.items.length > 0) {
    diagnostics.print();
    console.info(`Compilation failed with ${diagnostics.items.length} errors`);
    process.exit(1);
  }
  console.info("Compilation successful");
  semanticAnalyzer.resolveGenericMessageInstances();
  if (opts.printDefinitions) {
    prettyWriteJsonFile(
      opts.printDefinitions,
      semanticAnalyzer.definitions.map(definitionJSON).filter((f) => !!f)
    );
  }

  if (opts.codeGen === "skip") {
    console.info("Skipping generation");
    return;
  }

  if (opts.codeGen === "zod") {
    console.info("Generating zod");
    generateZodFromMessageDefinitions(
      opts.rootDir,
      opts.outputDir,
      semanticAnalyzer.definitions
    );
    console.info("Generation successful");
    return;
  }

  console.info(`Beggining code generation using "${opts.codeGen}"`);
  generateTsProto(
    opts.rootDir,
    opts.outputDir,
    semanticAnalyzer.definitions,
    opts.codeGen
  );
  console.info("Generation successful");
}

const opts = parseCommandLine();
generator(opts);
