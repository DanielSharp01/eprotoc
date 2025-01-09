import { Location, TextEdit } from "vscode-languageserver";
import {
  EnumDefinition,
  GenericType,
  MessageDefinition,
  PackageDefinition,
  SemanticAnalyzer,
  ServiceDefinition,
  StringEnumDefinition,
  TypeInstance,
} from "../analyzer";
import { DocumentItem, joinTokens } from "../tokenizer";
import { LSPContext } from "../lsp";
import { groupByMultiple } from "../utils/group-by";

type TokenReference = {
  definitionToken: DocumentItem;
  referenceToken: DocumentItem;
};

export function gotoDefinition({ connection, analyzer }: LSPContext) {
  connection.onDefinition((request) => {
    const references = getAllTokenReferences(analyzer);

    const reference = references.find(
      (t) =>
        !tokenEquals(t.definitionToken, t.referenceToken) &&
        t.referenceToken.file === request.textDocument.uri &&
        t.referenceToken.range.start.line == request.position.line &&
        request.position.character >= t.referenceToken.range.start.character &&
        request.position.character <= t.referenceToken.range.end.character
    );

    return reference
      ? ({
          range: reference.definitionToken.range,
          uri: reference.definitionToken.file,
        } as Location)
      : null;
  });
}

export function findReferences({ connection, analyzer }: LSPContext) {
  connection.onReferences((request) => {
    const references = getAllTokenReferences(analyzer);

    const definitionToken = references.find(
      (t) =>
        t.referenceToken.file === request.textDocument.uri &&
        t.referenceToken.range.start.line == request.position.line &&
        request.position.character >= t.referenceToken.range.start.character &&
        request.position.character <= t.referenceToken.range.end.character
    )?.definitionToken;

    if (!definitionToken) {
      return [];
    }

    const foundReferences = references
      .filter(
        (t) =>
          tokenEquals(t.definitionToken, definitionToken) &&
          (request.context.includeDeclaration ||
            !tokenEquals(t.referenceToken, definitionToken))
      )
      .map((t) => t.referenceToken);

    return foundReferences.map((r) => ({
      uri: r.file,
      range: r.range,
    }));
  });
}

export function renameSymbol({ connection, analyzer }: LSPContext) {
  connection.onRenameRequest((request) => {
    const references = getAllTokenReferences(analyzer);

    const definitionToken = references.find(
      (t) =>
        t.referenceToken.file === request.textDocument.uri &&
        t.referenceToken.range.start.line == request.position.line &&
        request.position.character >= t.referenceToken.range.start.character &&
        request.position.character <= t.referenceToken.range.end.character
    )?.definitionToken;

    if (!definitionToken) {
      return {};
    }

    const foundReferences = references.filter((t) =>
      tokenEquals(t.definitionToken, definitionToken)
    );

    return {
      changes: Object.fromEntries(
        groupByMultiple(
          foundReferences,
          (r) => r.referenceToken.file,
          (arr) =>
            arr.map((r) => ({
              range: r.referenceToken.range,
              newText: request.newName,
            }))
        ).entries()
      ),
    };
  });

  connection.onPrepareRename((request) => {
    const references = getAllTokenReferences(analyzer, false);

    const reference = references.find(
      (t) =>
        t.referenceToken.file === request.textDocument.uri &&
        t.referenceToken.range.start.line == request.position.line &&
        request.position.character >= t.referenceToken.range.start.character &&
        request.position.character <= t.referenceToken.range.end.character
    );

    if (reference) {
      return { defaultBehavior: true };
    }

    return null;
  });
}

function tokenEquals(a: DocumentItem, b: DocumentItem) {
  return (
    a.file === b.file &&
    a.range.start.character === b.range.start.character &&
    a.range.end.character === b.range.end.character &&
    a.range.start.line === b.range.start.line &&
    a.range.end.line === b.range.end.line
  );
}

function getAllTokenReferences(
  analyzer: SemanticAnalyzer,
  includePackageTokens: boolean = true
) {
  const references: TokenReference[] = [];
  for (const definition of analyzer.definitions) {
    switch (definition.kind) {
      case "package":
        if (includePackageTokens) {
          references.push(...packageTokenReferences(definition));
        }
        break;
      case "enum":
      case "string-enum":
        references.push(...enumTokenReferences(definition));
        break;
      case "message":
        references.push(
          ...messageTokenReferences(analyzer, definition, includePackageTokens)
        );
        break;
      case "service":
        references.push(
          ...serviceTokenReferences(analyzer, definition, includePackageTokens)
        );
        break;
    }
  }
  return references;
}

function packageTokenReferences(definition: PackageDefinition) {
  const jointIdToken = joinTokens(definition.astNode.identifier.tokens);
  return [
    {
      definitionToken: jointIdToken,
      referenceToken: jointIdToken,
    },
  ];
}

function enumTokenReferences(
  definition: EnumDefinition | StringEnumDefinition
): TokenReference[] {
  return [
    {
      definitionToken: definition.astNode.name,
      referenceToken: definition.astNode.name,
    },
  ];
}

function messageTokenReferences(
  analyzer: SemanticAnalyzer,
  definition: MessageDefinition,
  includePackageTokens: boolean
): TokenReference[] {
  const references: TokenReference[] = [];

  references.push({
    definitionToken: definition.astNode.type.identifier.tokens[0],
    referenceToken: definition.astNode.type.identifier.tokens[0],
  });
  for (const arg of definition.astNode.type.args) {
    references.push({
      definitionToken: arg.identifier.tokens[0],
      referenceToken: arg.identifier.tokens[0],
    });
  }

  for (const field of definition.fields) {
    references.push(
      ...typeTokenReferences(
        analyzer,
        field.type,
        includePackageTokens,
        definition.args
      )
    );
  }
  return references;
}

function typeTokenReferences(
  analyzer: SemanticAnalyzer,
  type: TypeInstance,
  includePackageTokens: boolean,
  generics?: GenericType[]
): TokenReference[] {
  const references: TokenReference[] = [];
  if (type.kind === "unknown") {
    return references;
  }

  if (type.kind === "generic") {
    const generic = generics?.find((g) => g.name === type.name);
    if (generic) {
      references.push({
        definitionToken: generic.token,
        referenceToken: type.token,
      });
    }
    return references;
  }

  if (type.definition.kind === "message") {
    const targetToken =
      type.definition.astNode.type.identifier.tokens[
        type.definition.astNode.type.identifier.tokens.length - 1
      ];
    if (targetToken) {
      references.push({
        definitionToken: targetToken,
        referenceToken: type.nameToken,
      });
    }
  } else if (type.definition.kind !== "builtin") {
    references.push({
      definitionToken: type.definition.astNode.name,
      referenceToken: type.nameToken,
    });
  }

  if (type.packageIdTokens.length > 0 && includePackageTokens) {
    const packageDef = analyzer.definitions.find(
      (d) => d.kind === "package" && d.packageId === type.packageId
    ) as PackageDefinition | undefined;
    if (packageDef) {
      references.push({
        referenceToken: joinTokens(type.packageIdTokens),
        definitionToken: joinTokens(packageDef.astNode.identifier.tokens),
      });
    }
  }

  references.push(
    ...type.args.flatMap((t) =>
      typeTokenReferences(analyzer, t, includePackageTokens, generics)
    )
  );

  return references;
}

function serviceTokenReferences(
  analyzer: SemanticAnalyzer,
  definition: ServiceDefinition,
  includePackageTokens: boolean
): TokenReference[] {
  const references: TokenReference[] = [];
  references.push({
    definitionToken: definition.astNode.name,
    referenceToken: definition.astNode.name,
  });
  for (const field of definition.rpcs) {
    references.push(
      ...typeTokenReferences(analyzer, field.request.type, includePackageTokens)
    );
    references.push(
      ...typeTokenReferences(
        analyzer,
        field.response.type,
        includePackageTokens
      )
    );
  }
  return references;
}
