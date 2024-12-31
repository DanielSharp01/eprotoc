import fs from "fs";

import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  TextDocumentSyncKind,
  InitializeResult,
  Diagnostic as LspDiagnostic,
  DiagnosticSeverity,
  TextDocumentChangeEvent,
  DidChangeConfigurationNotification,
} from "vscode-languageserver/node";

import { TextDocument } from "vscode-languageserver-textdocument";
import { Diagnostic, DiagnosticCollection } from "./diagnostic";
import { parse } from "./parser";
import { tokenize } from "./tokenizer";
import { SemanticAnalyzer } from "./analyzer";
import { collectFilesWithExtension } from "./utils/fs-utils";

let connection = createConnection(ProposedFeatures.all);
let documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability: boolean = false;
let hasWorkspaceFolderCapability: boolean = false;
let hasDiagnosticRelatedInformationCapability: boolean = false;

let diagnostics = new DiagnosticCollection(console, false);
let analyzer = new SemanticAnalyzer(diagnostics);
let currentWorkspace: string | undefined;

connection.onInitialize((params: InitializeParams) => {
  let capabilities = params.capabilities;
  currentWorkspace = params.workspaceFolders?.[0].uri;

  hasConfigurationCapability = !!(
    capabilities.workspace &&
    !!capabilities.workspace.configuration &&
    !!capabilities.workspace.didChangeWatchedFiles
  );
  hasWorkspaceFolderCapability = !!(
    capabilities.workspace && !!capabilities.workspace.workspaceFolders
  );
  hasDiagnosticRelatedInformationCapability = !!(
    capabilities.textDocument &&
    capabilities.textDocument.publishDiagnostics &&
    capabilities.textDocument.publishDiagnostics.relatedInformation
  );

  const result: InitializeResult = {
    capabilities: {
      // TODO: Support incremental
      textDocumentSync: TextDocumentSyncKind.Full,
    },
  };
  if (hasWorkspaceFolderCapability) {
    result.capabilities.workspace = {
      workspaceFolders: {
        supported: true,
      },
    };
  }

  return result;
});

connection.onInitialized((params) => {
  initializeWorkspace(currentWorkspace);

  if (hasConfigurationCapability) {
    connection.client.register(
      DidChangeConfigurationNotification.type,
      undefined
    );
  }
  if (hasWorkspaceFolderCapability) {
    connection.workspace.onDidChangeWorkspaceFolders((_event) => {
      currentWorkspace = _event.added?.[0].uri;
      initializeWorkspace(currentWorkspace);
    });
  }
});

connection.onDidChangeWatchedFiles(({ changes }) => {
  console.log("onDidChangeWatchedFiles", changes);
});

documents.onDidChangeContent((change) => {
  documentChanged(change);
});

function initializeWorkspace(uri: string | undefined) {
  analyzer.definitions = [];
  diagnostics.items = [];

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
        loadDocument(uri, content);
      });
    }
  }
}

function documentChanged(change: TextDocumentChangeEvent<TextDocument>) {
  console.log("[INFO]", "Document changed", change.document.uri);
  loadDocument(change.document.uri, change.document.getText());
}

function loadDocument(uri: string, content: string) {
  console.log("[INFO]", "Analyzing file", uri);
  diagnostics.removeFileDiagnostics(uri);
  analyzer.removeDefinitionsFromFile(uri);
  const nodes = parse(tokenize(uri, content, diagnostics), diagnostics);
  analyzer.analyzeASTNodes(uri, nodes);
  analyzer.analyze();
  for (const file of new Set(analyzer.definitions.map((d) => d.astNode.file))) {
    const fileDiagnostics = diagnostics.items
      .filter((d) => d.token.file === file)
      .map((d) => createDiagnostic(d));
    console.log(
      "[DEBUG]",
      "Reporting diagnostics",
      file,
      fileDiagnostics.length
    );
    connection.sendDiagnostics({
      uri: file,
      diagnostics: fileDiagnostics,
    });
  }
}

documents.listen(connection);
connection.listen();

function createDiagnostic(diagnostic: Diagnostic): LspDiagnostic {
  return {
    severity: DiagnosticSeverity.Error,
    message: diagnostic.message,
    range: diagnostic.token.range,
  };
}
