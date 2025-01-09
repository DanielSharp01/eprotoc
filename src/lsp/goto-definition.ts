import { Location } from "vscode-languageserver";
import {
  GenericType,
  MessageDefinition,
  PackageDefinition,
  SemanticAnalyzer,
  ServiceDefinition,
  TypeInstance,
} from "../analyzer";
import { DocumentItem, joinTokens } from "../tokenizer";
import { LSPContext } from "../lsp";

type GotoToken = { targetToken: DocumentItem; originToken: DocumentItem };

export function gotoDefinition({ connection, analyzer }: LSPContext) {
  connection.onDefinition((request) => {
    let tokens: GotoToken[] = [];
    for (const definition of analyzer.definitions) {
      switch (definition.kind) {
        case "message":
          tokens.push(...relevantMessageTokens(analyzer, definition));
          break;
        case "service":
          tokens.push(...relevantServiceTokens(analyzer, definition));
          break;
      }
    }

    const token = tokens.find(
      (t) =>
        t.originToken.file === request.textDocument.uri &&
        t.originToken.range.start.line == request.position.line &&
        request.position.character >= t.originToken.range.start.character &&
        request.position.character <= t.originToken.range.end.character
    );

    return token
      ? ({
          range: token.targetToken.range,
          uri: token.targetToken.file,
        } as Location)
      : null;
  });
}

function relevantMessageTokens(
  analyzer: SemanticAnalyzer,
  definition: MessageDefinition
): GotoToken[] {
  const tokens: GotoToken[] = [];
  for (const field of definition.fields) {
    tokens.push(...relevantTypeTokens(analyzer, field.type, definition.args));
  }
  return tokens;
}

function relevantTypeTokens(
  analyzer: SemanticAnalyzer,
  type: TypeInstance,
  generics?: GenericType[]
): GotoToken[] {
  const tokens: GotoToken[] = [];
  if (type.kind === "unknown") {
    return tokens;
  }

  if (type.kind === "generic") {
    const generic = generics?.find((g) => g.name === type.name);
    if (generic) {
      tokens.push({
        targetToken: generic.token,
        originToken: type.token,
      });
    }
    return tokens;
  }

  if (type.definition.kind === "message") {
    const targetToken =
      type.definition.astNode.type.identifier.tokens[
        type.definition.astNode.type.identifier.tokens.length - 1
      ];
    if (targetToken) {
      tokens.push({ targetToken, originToken: type.nameToken });
    }
  } else if (type.definition.kind !== "builtin") {
    tokens.push({
      targetToken: type.definition.astNode.name,
      originToken: type.nameToken,
    });
  }

  if (type.packageIdTokens.length > 0) {
    const packageDef = analyzer.definitions.find(
      (d) => d.kind === "package" && d.packageId === type.packageId
    ) as PackageDefinition | undefined;
    if (packageDef) {
      tokens.push({
        originToken: joinTokens(type.packageIdTokens),
        targetToken: joinTokens(packageDef.astNode.identifier.tokens),
      });
    }
  }

  tokens.push(
    ...type.args.flatMap((t) => relevantTypeTokens(analyzer, t, generics))
  );

  return tokens;
}

function relevantServiceTokens(
  analyzer: SemanticAnalyzer,
  definition: ServiceDefinition
): GotoToken[] {
  const tokens: GotoToken[] = [];
  for (const field of definition.rpcs) {
    tokens.push(...relevantTypeTokens(analyzer, field.request.type));
    tokens.push(...relevantTypeTokens(analyzer, field.response.type));
  }
  return tokens;
}
