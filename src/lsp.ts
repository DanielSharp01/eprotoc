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
  SemanticTokenTypes,
  SemanticTokensRequest,
  SemanticTokensDeltaParams,
} from "vscode-languageserver/node";

import { TextDocument } from "vscode-languageserver-textdocument";
import { Diagnostic, DiagnosticCollection } from "./diagnostic";
import { parse } from "./parser";
import { Token, tokenize } from "./tokenizer";
import {
  Definition,
  EnumDefinition,
  MessageDefinition,
  PackageDefinition,
  SemanticAnalyzer,
  ServiceDefinition,
  StringEnumDefinition,
  TypeInstance,
} from "./analyzer";
import { collectFilesWithExtension } from "./utils/fs-utils";
import { inspect } from "util";

const tokenTypes = {
  [SemanticTokenTypes.namespace]: 0,
  [SemanticTokenTypes.type]: 1,
  [SemanticTokenTypes.typeParameter]: 2,
  [SemanticTokenTypes.enum]: 3,
  [SemanticTokenTypes.enumMember]: 4,
  [SemanticTokenTypes.struct]: 5,
  [SemanticTokenTypes.property]: 6,
  [SemanticTokenTypes.method]: 7,
} as const;

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
      textDocumentSync: TextDocumentSyncKind.Full,
      semanticTokensProvider: {
        legend: {
          tokenTypes: Object.keys(tokenTypes),
          tokenModifiers: [],
        },
        full: true,
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

connection.onRequest(
  SemanticTokensRequest.method,
  (request: SemanticTokensDeltaParams) => {
    const data = gatherEncodedSemanticTokens(
      analyzer.definitions.filter(
        (d) => d.astNode.file === request.textDocument.uri
      )
    );
    return {
      data,
    };
  }
);

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

type SemanticToken = {
  range: Token["range"];
  tokenType: keyof typeof tokenTypes;
};

function encodeSemanticToken(
  previousToken: SemanticToken | undefined,
  token: SemanticToken
) {
  const lineDelta =
    token.range.start.line - (previousToken?.range.start.line ?? 0);
  const characterDelta =
    lineDelta === 0
      ? token.range.start.character -
        (previousToken?.range.start.character ?? 0)
      : token.range.start.character;
  return [
    lineDelta,
    characterDelta,
    token.range.end.character - token.range.start.character,
    tokenTypes[token.tokenType],
    0,
  ];
}

function gatherEncodedSemanticTokens(definitions: Definition[]): number[] {
  function forPackage(definition: PackageDefinition): SemanticToken[] {
    return definition.astNode.identifier.tokens.map((t) => ({
      range: t.range,
      tokenType: SemanticTokenTypes.namespace as const,
    }));
  }

  function forEnum(definition: EnumDefinition): SemanticToken[] {
    return [
      {
        range: definition.astNode.name.range,
        tokenType: SemanticTokenTypes.enum,
      },
      ...definition.fields.map((f) => ({
        range: f.nameToken.range,
        tokenType: SemanticTokenTypes.enumMember as const,
      })),
    ];
  }

  function forStringEnum(definition: StringEnumDefinition): SemanticToken[] {
    return [
      {
        range: definition.astNode.name.range,
        tokenType: SemanticTokenTypes.enum,
      },
    ];
  }

  function forMessage(definition: MessageDefinition): SemanticToken[] {
    return [
      {
        range: definition.astNode.type.identifier.tokens[0].range,
        tokenType: SemanticTokenTypes.struct,
      },
      ...definition.args.map((t) => ({
        range: t.token.range,
        tokenType: SemanticTokenTypes.typeParameter as const,
      })),
      ...definition.fields.flatMap((f) => [
        ...forType(f.type),
        {
          range: f.nameToken.range,
          tokenType: SemanticTokenTypes.property as const,
        },
      ]),
    ];
  }

  function forService(definition: ServiceDefinition): SemanticToken[] {
    return [
      {
        range: definition.astNode.name.range,
        tokenType: SemanticTokenTypes.struct,
      },
      ...definition.rpcs.flatMap((f) => [
        {
          range: f.pathToken.range,
          tokenType: SemanticTokenTypes.method as const,
        },
        // TODO: As well
        ...forType(f.request.type),
        ...forType(f.response.type),
      ]),
    ];
  }

  function forType(type: TypeInstance): SemanticToken[] {
    if (type.kind === "unknown") {
      return [];
    }

    if (type.kind === "generic") {
      return [
        {
          range: type.token.range,
          tokenType: SemanticTokenTypes.typeParameter,
        },
      ];
    }

    if (type.definition.kind === "message") {
      return [
        ...type.packageIdTokens.map((p) => ({
          range: p.range,
          tokenType: SemanticTokenTypes.namespace as const,
        })),
        { range: type.nameToken.range, tokenType: SemanticTokenTypes.struct },
        ...type.args.flatMap((t) => forType(t)),
      ];
    } else if (
      type.definition.kind === "enum" ||
      type.definition.kind === "string-enum"
    ) {
      return [
        ...type.packageIdTokens.map((p) => ({
          range: p.range,
          tokenType: SemanticTokenTypes.namespace as const,
        })),
        { range: type.nameToken.range, tokenType: SemanticTokenTypes.enum },
      ];
    }

    return [
      { range: type.nameToken.range, tokenType: SemanticTokenTypes.type },
      ...type.args.flatMap((t) => forType(t)),
    ];
  }

  const tokens: SemanticToken[] = [];

  for (const definition of definitions) {
    switch (definition.kind) {
      case "package":
        tokens.push(...forPackage(definition));
        break;
      case "enum":
        tokens.push(...forEnum(definition));
        break;
      case "string-enum":
        tokens.push(...forStringEnum(definition));
        break;
      case "message":
        tokens.push(...forMessage(definition));
        break;
      case "service":
        tokens.push(...forService(definition));
        break;
    }
  }

  const encoded: number[] = [];
  let previousToken: SemanticToken | undefined;
  for (const token of tokens) {
    encoded.push(...encodeSemanticToken(previousToken, token));
    previousToken = token;
  }
  return encoded;
}
