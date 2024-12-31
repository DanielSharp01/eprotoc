import fs from "fs";
import {
  ASTNode,
  EnumNode,
  MessageNode,
  parse,
  ServiceNode,
  StringEnumNode,
  TypeNode,
} from "./parser";
import { NumberToken, StringToken, Token } from "./tokenizer";
import { atToken, DiagnosticCollection } from "./diagnostic";

export const BUILTIN_PACKAGE = Symbol("BUILTIN_PACKAGE");
export const UNKNOWN_PACKAGE = Symbol("UNKNOWN_PACKAGE");

export type UserPackageId = string | typeof UNKNOWN_PACKAGE;
export type PackageId = UserPackageId | typeof BUILTIN_PACKAGE;

export type Definition =
  | EnumDefinition
  | StringEnumDefinition
  | MessageDefinition
  | ServiceDefinition;

export interface BaseDefinition<
  TNode extends EnumNode | StringEnumNode | MessageNode | ServiceNode
> {
  packageId: PackageId;
  astNode: TNode & { file: string };
  name: string;
}

export type BuiltinType = RealType & {
  kind: "builtin";
  packageId: typeof BUILTIN_PACKAGE;
};

export type RealBuiltinType = Omit<BuiltinType, "args" | "restArgs"> & {
  args: DeepRealType[];
  restArgs: boolean;
};

interface RealType {
  typeKind: "real";
  packageId: PackageId;
  name: string;
  args: Type[];
  restArgs: boolean;
}

export interface GenericType {
  typeKind: "generic";
  name: string;
}

export type DeepRealType =
  | RealMessageDefinition
  | EnumDefinition
  | StringEnumDefinition
  | RealBuiltinType;

export type Type =
  | BuiltinType
  | EnumDefinition
  | StringEnumDefinition
  | MessageDefinition
  | GenericType;

export type GenericTypeInstance = DeepRealType[];

export type EnumDefinition = BaseDefinition<EnumNode> &
  Omit<RealType, "args" | "restArgs"> & {
    kind: "enum";
    fields: { name: string; value: number }[];
    args: [];
    restArgs: false;
  };

export type StringEnumDefinition = BaseDefinition<StringEnumNode> &
  Omit<RealType, "args" | "restArgs"> & {
    kind: "string-enum";
    fields: string[];
    args: [];
    restArgs: false;
  };

export type MessageDefinition = BaseDefinition<MessageNode> &
  Omit<RealType, "args" | "restArgs"> & {
    kind: "message";
    fields: { optional: boolean; type: Type; name: string; ordinal: number }[];
    args: GenericType[];
    restArgs: false;
    genericInstances: GenericTypeInstance[];
  };

export type RealMessageDefinition = Omit<
  MessageDefinition,
  "args" | "restArgs" | "fields"
> & {
  args: DeepRealType[];
  restArgs: false;
  fields: (Omit<MessageDefinition["fields"][number], "type"> & {
    type: DeepRealType;
  })[];
};

export interface ServiceDefinition extends BaseDefinition<ServiceNode> {
  kind: "service";
  rpcs: {
    path: string;
    request: { stream: boolean; type: DeepRealType };
    response: { stream: boolean; type: DeepRealType };
  }[];
}

export class SemanticAnalyzer {
  public definitions: Definition[] = [];
  public builtinTypes = builtinTypes();

  constructor(private diagnostics: DiagnosticCollection) {}

  analyzeASTNodes(file: string, astNodes: ASTNode[]) {
    const packageId = getCurrentPackageFromNodes(
      file,
      astNodes,
      this.diagnostics
    );
    this.definitions.push(
      ...astNodes
        .map((a) => astNodeToDefinition(file, a, packageId, this.diagnostics))
        .filter((f) => !!f)
    );

    const definedSymbols = new Map<
      string,
      { kind: ASTNode["kind"]; token: StringToken }
    >();
    for (const definition of this.definitions.filter(
      (d) => d.packageId === packageId
    )) {
      const idToken = getIdToken(definition.astNode);
      const redefinition = definedSymbols.get(definition.name);
      if (redefinition) {
        this.diagnostics.error(
          idToken,
          "global",
          `Name "${
            redefinition.token.value
          }" cannot be used for ${definition.kind.replace(
            "-",
            " "
          )} because it already exists as a ${redefinition.kind.replace(
            "-",
            " "
          )} at ${atToken(redefinition.token)}`
        );
      } else {
        definedSymbols.set(idToken.value, {
          token: idToken,
          kind: definition.astNode.kind,
        });
      }
    }
  }

  analyze() {
    for (const definition of this.definitions) {
      if (definition.kind === "message") {
        definition.genericInstances = [];
      }
      this.analyzeDefinition(definition);
    }
  }

  removeDefinitionsFromFile(file: string) {
    this.definitions = this.definitions.filter((d) => d.astNode.file !== file);
  }

  analyzeDefinition(definition: Definition) {
    switch (definition.kind) {
      case "message":
        return this.analyzeMessageFields(definition);
      case "service":
        return this.analyzeServiceRPCs(definition);
    }
  }

  analyzeMessageFields(definition: MessageDefinition) {
    let ordinal = 1;

    const definedFields = new Map<string, StringToken>();

    for (const field of definition.astNode.fields) {
      if (!field.isComplete) continue;

      const redefinition = definedFields.get((field.name as StringToken).value);
      if (redefinition) {
        this.diagnostics.error(
          field.name,
          "local",
          `Field "${redefinition.value}" in message "${
            definition.name
          }" already exists at ${atToken(redefinition)}`
        );
      } else {
        definedFields.set(
          (field.name as StringToken).value,
          field.name as StringToken
        );
      }

      if (field.ordinal) {
        const newOrdinal = (field.ordinal.value as NumberToken).value;
        if (newOrdinal < ordinal) {
          this.diagnostics.error(
            field.ordinal.value,
            "local",
            newOrdinal < 1
              ? "Message field numbers must be greater than 0."
              : "Message field numbers must be sequential."
          );
        }
      }

      const type = this.resolveType(definition, field.type);
      if (type) {
        definition.fields.push({
          name: (field.name as StringToken).value,
          ordinal,
          type,
          optional: !!field.optional,
        });
      }
      ordinal++;
    }
  }

  analyzeServiceRPCs(definition: ServiceDefinition) {
    const definedRPCs = new Map<string, StringToken>();

    for (const rpc of definition.astNode.rpcs) {
      const redefinition = definedRPCs.get((rpc.name as StringToken).value);
      if (redefinition) {
        this.diagnostics.error(
          rpc.name,
          "local",
          `RPC "${redefinition.value}" already exists in service "${
            definition.name
          }" at ${atToken(redefinition)}`
        );
      } else {
        definedRPCs.set(
          (rpc.name as StringToken).value,
          rpc.name as StringToken
        );
      }

      const requestType = this.serviceResolveType(definition, rpc.requestType);
      const responseType = this.serviceResolveType(
        definition,
        rpc.responseType
      );
      if (requestType && responseType) {
        definition.rpcs.push({
          path: (rpc.name as StringToken).value,
          request: { type: requestType, stream: !!rpc.requestStream },
          response: { type: responseType, stream: !!rpc.responseStream },
        });
      }
    }
  }

  resolveType(
    definition: MessageDefinition | ServiceDefinition,
    typeNode: TypeNode
  ): Type | undefined {
    if (!typeNode.isComplete) {
      return undefined;
    }

    const typeArgs = definition.kind === "message" ? definition.args : [];

    const name = typeNode.identifier.tokens as StringToken[];
    if (
      name.length === 1 &&
      typeArgs.some((arg) => arg.name === name[0].value)
    ) {
      if (typeNode.args.length > 0 && typeNode.args[0].identifier.isComplete) {
        this.diagnostics.error(
          typeNode.args[0].identifier.tokens[0],
          "local",
          `Generic type "${name[0]}" must not have a generic argument`
        );
        return undefined;
      }

      return {
        typeKind: "generic",
        name: name[0].value,
      };
    }

    const packageId = name
      .slice(0, -2)
      .map((n) => n.value)
      .join("");
    const typeName = name[name.length - 1].value;

    let resolvedType: RealType | undefined;
    if (!packageId) {
      resolvedType =
        this.builtinTypes.find((t) => t.name === typeName) ??
        this.definitions
          .filter((d) => d.kind !== "service")
          .find(
            (d) => d.name === typeName && d.packageId === definition.packageId
          );
    } else {
      resolvedType =
        this.definitions
          .filter((d) => d.kind !== "service")
          .find((d) => d.name === typeName && d.packageId === packageId) ??
        typeof definition.packageId === "string"
          ? this.definitions
              .filter((d) => d.kind !== "service")
              .find(
                (d) =>
                  d.name === typeName &&
                  d.packageId ===
                    `${definition.packageId as string}.${packageId}`
              )
          : undefined;
    }
    const diagnosticName = name.map((t) => t.value).join("");

    if (!resolvedType) {
      this.diagnostics.error(
        typeNode.identifier.tokens[0],
        "global",
        `Unknown type "${diagnosticName}"`
      );
      return undefined;
    }

    const returnedType = { ...resolvedType };
    returnedType.args = [];

    let idx = 0;
    for (const generic of typeNode.args ?? []) {
      if (!generic.identifier.isComplete) {
        continue;
      }
      if (!resolvedType.restArgs && idx >= resolvedType.args.length) {
        this.diagnostics.error(
          generic.identifier.tokens[0],
          "global",
          resolvedType.args.length === 0
            ? `Type "${diagnosticName}" does not have generic arguments`
            : `Type "${diagnosticName}" only has ${resolvedType.args.length} generic arguments`
        );
      }
      const verified = this.resolveType(definition, generic);
      if (!verified) {
        return undefined;
      }
      returnedType.args.push(verified);
      idx++;
    }

    return returnedType as Type | undefined;
  }

  serviceResolveType(definition: ServiceDefinition, typeNode: TypeNode) {
    const type = this.resolveType(definition, typeNode) as DeepRealType;
    this.addGenericMessageInstances(type);
    return type;
  }

  addGenericMessageInstances(type: DeepRealType) {
    if (
      type.kind === "message" &&
      !type.genericInstances.some(
        (args) =>
          args.length === type.args.length &&
          args.every((a, i) => a === type.args[i])
      )
    ) {
      type.genericInstances.push(type.args);
    }

    for (const arg of type.args) {
      this.addGenericMessageInstances(arg);
    }
  }
}

function getCurrentPackageFromNodes(
  file: string,
  ast: ASTNode[],
  diagnostics: DiagnosticCollection
) {
  const packageDefinitions = ast.filter((p) => p.kind === "package");
  if (packageDefinitions.length === 0) {
    diagnostics.error(
      {
        file,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
      },
      "local",
      "Every file requires a package definition"
    );
    return UNKNOWN_PACKAGE;
  }

  if (!packageDefinitions[0].identifier.isComplete) {
    return UNKNOWN_PACKAGE;
  }

  for (const packageDefinition of packageDefinitions.slice(1)) {
    diagnostics.error(
      packageDefinition.keyword,
      "local",
      "Multiple package definitions are not allowed."
    );
  }

  return (packageDefinitions[0].identifier.tokens as StringToken[])
    .map((n) => n.value)
    .join("");
}

function astNodeToDefinition(
  file: string,
  node: ASTNode,
  packageId: UserPackageId,
  diagnostics: DiagnosticCollection
) {
  function enumDefinition(node: EnumNode) {
    const def: EnumDefinition = {
      kind: "enum",
      typeKind: "real",
      name: (node.name as StringToken).value,
      astNode: { file, ...node },
      packageId,
      args: [],
      restArgs: false,
      fields: [],
    };

    let value = 0;

    const definedFields = new Map<string, StringToken>();

    for (const field of node.fields) {
      if (!field.isComplete) continue;

      const redefinition = definedFields.get((field.name as StringToken).value);
      if (redefinition) {
        diagnostics.error(
          field.name,
          "local",
          `Field "${redefinition.value}" in enum "${
            def.name
          }" already exists at ${atToken(redefinition)}`
        );
      } else {
        definedFields.set(
          (field.name as StringToken).value,
          field.name as StringToken
        );
      }

      if (field.value) {
        value = (field.value.value as NumberToken).value;
      }

      def.fields.push({ name: (field.name as StringToken).value, value });
      value++;
    }

    return def;
  }

  function stringEnumDefinition(node: StringEnumNode) {
    const def: StringEnumDefinition = {
      kind: "string-enum",
      typeKind: "real",
      name: (node.name as StringToken).value,
      astNode: { file, ...node },
      packageId,
      args: [],
      restArgs: false,
      fields: [],
    };

    const definedFields = new Map<string, StringToken>();

    for (const field of node.fields) {
      const redefinition = definedFields.get((field as StringToken).value);
      if (redefinition) {
        diagnostics.error(
          field,
          "local",
          `Field "${redefinition.value}" in string enum "${
            def.name
          }" already exists at ${atToken(redefinition)}`
        );
      } else {
        definedFields.set((field as StringToken).value, field as StringToken);
      }

      def.fields.push((field as StringToken).value);
    }

    return def;
  }

  function messageDefinition(node: MessageNode) {
    const def: MessageDefinition = {
      kind: "message",
      typeKind: "real",
      name: (node.type.identifier.tokens[0] as StringToken).value,
      astNode: { file, ...node },
      packageId,
      args: [],
      restArgs: false,
      fields: [],
      genericInstances: [],
    };

    for (const arg of node.type.args) {
      if (arg.args.length > 0) {
        diagnostics.error(
          arg.args[0].identifier.tokens[0],
          "local",
          "Generic arguments must be simple indentifiers and must not themselves be generic."
        );
        return undefined;
      }
      if (arg.identifier.tokens.length > 1) {
        diagnostics.error(
          arg.args[0].identifier.tokens[0],
          "local",
          "Generic arguments must be simple indentifiers and must not have package prefixes."
        );
        return undefined;
      }
      def.args.push({
        typeKind: "generic",
        name: (arg.identifier.tokens[0] as StringToken).value,
      });
    }

    return def;
  }

  function serviceDefinition(node: ServiceNode) {
    const def: ServiceDefinition = {
      kind: "service",
      name: (node.name as StringToken).value,
      astNode: { file, ...node },
      packageId,
      rpcs: [],
    };

    return def;
  }

  if (node.kind === "enum" && node.name.tokenType === "identifier") {
    return enumDefinition(node);
  } else if (
    node.kind === "string-enum" &&
    node.name.tokenType === "identifier"
  ) {
    return stringEnumDefinition(node);
  } else if (node.kind === "message" && node.type.isComplete) {
    return messageDefinition(node);
  } else if (node.kind === "service" && node.name.tokenType === "identifier") {
    return serviceDefinition(node);
  }

  return undefined;
}

export function realizeMessageDefinition(
  definition: MessageDefinition,
  args: DeepRealType[]
): RealMessageDefinition {
  const genericsMap = Object.fromEntries(
    definition.args.map((a, i) => [a.name, args[i]])
  );
  return {
    ...definition,
    fields: definition.fields.map((f) => ({
      ...f,
      type: realizeType(f.type, genericsMap),
    })),
    args,
  };
}

function realizeType(
  type: Type,
  genericsMap: Record<string, DeepRealType>
): DeepRealType {
  if (type.typeKind === "generic") {
    return genericsMap[type.name];
  }

  return {
    ...type,
    args: type.args.map((a) => realizeType(a, genericsMap)),
  } as DeepRealType;
}

function builtinTypes() {
  const ret: BuiltinType[] = [];

  for (const builtin of [
    "void",
    "int32",
    "int64",
    "uint32",
    "uint64",
    "float",
    "double",
    "sint32",
    "sint64",
    "fixed32",
    "fixed64",
    "sfixed32",
    "sfixed64",
    "bool",
    "string",
    "bytes",
    "Date",
  ]) {
    ret.push({
      kind: "builtin",
      typeKind: "real",
      packageId: BUILTIN_PACKAGE,
      name: builtin,
      args: [],
      restArgs: false,
    });
  }
  ret.push({
    kind: "builtin",
    typeKind: "real",
    packageId: BUILTIN_PACKAGE,
    name: "Array",
    args: [{ typeKind: "generic", name: "T" }],
    restArgs: false,
  });
  ret.push({
    kind: "builtin",
    typeKind: "real",
    packageId: BUILTIN_PACKAGE,
    name: "Nullable",
    args: [{ typeKind: "generic", name: "T" }],
    restArgs: false,
  });

  return ret;
}

function getIdToken(
  node: MessageNode | ServiceNode | EnumNode | StringEnumNode
) {
  if (node.kind === "message") {
    return node.type.identifier.tokens[0] as StringToken;
  } else {
    return node.name as StringToken;
  }
}