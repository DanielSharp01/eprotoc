import {
  SemanticTokensDeltaParams,
  SemanticTokensRequest,
  SemanticTokenTypes,
} from "vscode-languageserver";
import {
  Definition,
  EnumDefinition,
  MessageDefinition,
  PackageDefinition,
  ServiceDefinition,
  StringEnumDefinition,
  TypeInstance,
} from "../analyzer";
import { Token } from "../tokenizer";
import { LSPContext } from "../lsp";

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

export const semanticTokensProvider = {
  legend: {
    tokenTypes: Object.keys(tokenTypes),
    tokenModifiers: [],
  },
  full: true,
};

export function semanticTokenHiglighting({ connection, analyzer }: LSPContext) {
  connection.onRequest(
    SemanticTokensRequest.method,
    (request: SemanticTokensDeltaParams) => {
      const data = gatherEncoded(
        analyzer.definitions.filter(
          (d) => d.astNode.file === request.textDocument.uri
        )
      );
      return {
        data,
      };
    }
  );
}

type SemanticToken = {
  range: Token["range"];
  tokenType: keyof typeof tokenTypes;
};

function encode(
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

function gatherEncoded(definitions: Definition[]): number[] {
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
    encoded.push(...encode(previousToken, token));
    previousToken = token;
  }
  return encoded;
}

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
