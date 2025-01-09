import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  TextDocumentSyncKind,
  InitializeResult,
  DidChangeConfigurationNotification,
  Connection,
} from "vscode-languageserver/node";

import { TextDocument } from "vscode-languageserver-textdocument";
import { DiagnosticCollection } from "./diagnostic";
import { SemanticAnalyzer } from "./analyzer";
import {
  semanticTokenHiglighting,
  semanticTokensProvider,
} from "./lsp/semantic-tokens";
import {
  findReferences,
  gotoDefinition,
  renameSymbol,
} from "./lsp/definitions";
import { documentChanged, initializeWorkspace } from "./lsp/document-sync";

let connection = createConnection(ProposedFeatures.all);
let documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);
let diagnostics = new DiagnosticCollection(console, false);
let analyzer = new SemanticAnalyzer(diagnostics);

export interface LSPContext {
  connection: Connection;
  diagnostics: DiagnosticCollection;
  analyzer: SemanticAnalyzer;
}

const lspContext: LSPContext = {
  connection,
  analyzer,
  diagnostics,
};

let hasConfigurationCapability: boolean = false;
let hasWorkspaceFolderCapability: boolean = false;
let hasDiagnosticRelatedInformationCapability: boolean = false;

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
      textDocumentSync: TextDocumentSyncKind.Full,
      semanticTokensProvider,
      definitionProvider: true,
      referencesProvider: true,
      renameProvider: {
        prepareProvider: true,
      },
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

connection.onInitialized(() => {
  initializeWorkspace(lspContext, currentWorkspace);

  if (hasConfigurationCapability) {
    connection.client.register(
      DidChangeConfigurationNotification.type,
      undefined
    );
  }
  if (hasWorkspaceFolderCapability) {
    connection.workspace.onDidChangeWorkspaceFolders((_event) => {
      currentWorkspace = _event.added?.[0].uri;
      initializeWorkspace(lspContext, currentWorkspace);
    });
  }
});

documents.onDidChangeContent((change) => {
  documentChanged(lspContext, change);
});

semanticTokenHiglighting(lspContext);
gotoDefinition(lspContext);
findReferences(lspContext);
renameSymbol(lspContext);

documents.listen(connection);
connection.listen();
