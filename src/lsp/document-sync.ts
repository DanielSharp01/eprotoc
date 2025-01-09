import fs from "fs";
import { TextDocumentChangeEvent } from "vscode-languageserver";
import { collectFilesWithExtension } from "../utils/fs-utils";
import { TextDocument } from "vscode-languageserver-textdocument";
import { tokenize } from "../tokenizer";
import { parse } from "../parser";
import { sendDiagnostics } from "./diagnostics";
import { LSPContext } from "../lsp";

export function initializeWorkspace(
  lspContext: LSPContext,
  uri: string | undefined
) {
  lspContext.analyzer.definitions = [];
  lspContext.diagnostics.items = [];

  console.log("[INFO]", "Initializing workspace", uri);

  if (uri) {
    for (const file of collectFilesWithExtension(
      new URL(uri).pathname,
      ".eproto"
    )) {
      fs.readFile(file, "utf-8", (error, content) => {
        const uri = `file://${file}`;
        if (error) {
          return console.error("[ERROR]", "Reading file", uri, error);
        }
        console.log("[INFO]", "Initial document load", uri);
        loadDocument(lspContext, uri, content);
      });
    }
  }
}

export function documentChanged(
  lspContext: LSPContext,
  change: TextDocumentChangeEvent<TextDocument>
) {
  console.log("[INFO]", "Document changed", change.document.uri);
  loadDocument(lspContext, change.document.uri, change.document.getText());
}

function loadDocument(lspContext: LSPContext, uri: string, content: string) {
  const { diagnostics, analyzer } = lspContext;
  console.log("[INFO]", "Analyzing file", uri);
  diagnostics.removeFileDiagnostics(uri);
  analyzer.removeDefinitionsFromFile(uri);
  const nodes = parse(tokenize(uri, content, diagnostics), diagnostics);
  analyzer.analyzeASTNodes(uri, nodes);
  analyzer.analyze();
  sendDiagnostics(
    lspContext,
    new Set(analyzer.definitions.map((d) => d.astNode.file))
  );
}
