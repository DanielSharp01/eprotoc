import {
  ASTNode,
  EnumNode,
  MessageNode,
  PackageNode,
  ServiceNode,
  StringEnumNode,
  TypeNode,
} from "./parser";
import { NumberToken, StringToken, Token } from "./tokenizer";
import { DiagnosticCollection, diagnosticMessages } from "./diagnostic";

export const BUILTIN_PACKAGE = Symbol("BUILTIN_PACKAGE");
export const UNKNOWN_PACKAGE = Symbol("UNKNOWN_PACKAGE");

export type UserPackageId = string | typeof UNKNOWN_PACKAGE;
export type PackageId = UserPackageId | typeof BUILTIN_PACKAGE;

export type Definition =
  | PackageDefinition
  | EnumDefinition
  | StringEnumDefinition
  | MessageDefinition
  | ServiceDefinition;

export interface BaseDefinition<
  TNode extends
    | PackageNode
    | EnumNode
    | StringEnumNode
    | MessageNode
    | ServiceNode
> {
  packageId: UserPackageId;
  astNode: TNode & { file: string };
  name: string;
}

export type PackageDefinition = BaseDefinition<PackageNode> & {
  kind: "package";
};

export type TypeDefinition =
  | BuiltinTypeDefinition
  | EnumDefinition
  | StringEnumDefinition
  | MessageDefinition
  | GenericType;

export type BuiltinTypeDefinition = {
  kind: "builtin";
  packageId: typeof BUILTIN_PACKAGE;
  name: string;
  args: GenericType[];
};

export interface GenericType {
  kind: "generic";
  name: string;
  token: Token;
}

export type EnumDefinition = BaseDefinition<EnumNode> & {
  kind: "enum";
  typeKind: "real";
  fields: { name: string; nameToken: Token; value: number }[];
  args: [];
};

export type StringEnumDefinition = BaseDefinition<StringEnumNode> & {
  kind: "string-enum";
  typeKind: "real";
  fields: string[];
  args: [];
};

export type MessageDefinition = BaseDefinition<MessageNode> & {
  kind: "message";
  fields: {
    optional: boolean;
    type: TypeInstance;
    name: string;
    nameToken: Token;
    ordinal: number;
  }[];
  args: GenericType[];
  instances: DeepRealTypeInstance[][];
};

export type MessageDefinitionInstance = Omit<
  MessageDefinition,
  "args" | "fields"
> & {
  args: DeepRealTypeInstance[];
  fields: (Omit<MessageDefinition["fields"][number], "type"> & {
    type: DeepRealTypeInstance;
  })[];
};

export type TypeInstance =
  | RealTypeInstance
  | GenericTypeInstance
  | UnknownTypeInstance;

export type KnownTypeInstance =
  | GenericTypeInstance
  | (Omit<RealTypeInstance, "args"> & {
      args: KnownTypeInstance[];
    });

export type GenericTypeInstance = GenericType;

export type UnknownTypeInstance = {
  kind: "unknown";
};

export interface RealTypeInstance {
  kind: "real";
  definition: Exclude<TypeDefinition, GenericType>;
  nameToken: Token;
  packageId: PackageId;
  packageIdTokens: Token[];
  args: TypeInstance[];
}

export type DeepRealTypeInstance =
  | Omit<RealTypeInstance, "args"> & {
      args: DeepRealTypeInstance[];
    };

export type RPCTypeInstance =
  | (Omit<RealTypeInstance, "args"> & {
      args: RPCTypeInstance[];
    })
  | UnknownTypeInstance;

export interface ServiceDefinition extends BaseDefinition<ServiceNode> {
  kind: "service";
  rpcs: {
    path: string;
    pathToken: Token;
    request: { stream: boolean; type: RPCTypeInstance };
    response: { stream: boolean; type: RPCTypeInstance };
  }[];
}

export class SemanticAnalyzer {
  public definitions: Definition[] = [];
  public builtinTypes = builtinTypes();

  constructor(private diagnostics: DiagnosticCollection) {}

  analyzeASTNodes(file: string, astNodes: ASTNode[]) {
    const packageId = this.getCurrentPackageFromNodes(
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
      (d): d is Exclude<Definition, PackageDefinition> =>
        d.packageId === packageId && d.kind !== "package"
    )) {
      const idToken = getIdToken(definition.astNode);
      const redefinition = definedSymbols.get(definition.name);
      if (redefinition) {
        this.diagnostics.error(
          idToken,
          "global",
          diagnosticMessages.redefinitionAt(
            `Name "${
              redefinition.token.value
            }" cannot be used for ${definition.kind.replace(
              "-",
              " "
            )} because it already exists as a ${redefinition.kind.replace(
              "-",
              " "
            )}`,
            redefinition.token
          )
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
        definition.instances = [];
        definition.fields = [];
      } else if (definition.kind === "service") {
        definition.rpcs = [];
      }
      this.analyzeDefinition(definition);
    }
  }

  removeDefinitionsFromFile(file: string) {
    this.definitions = this.definitions.filter((d) => d.astNode.file !== file);
  }

  getCurrentPackageFromNodes(
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

    if (packageDefinitions[0] !== ast[0]) {
      diagnostics.error(
        packageDefinitions[0].keyword,
        "local",
        "The package definition must be the first statement."
      );
      return UNKNOWN_PACKAGE;
    }

    const name = (packageDefinitions[0].identifier.tokens as StringToken[])
      .map((n) => n.value)
      .join("");

    this.definitions.push({
      kind: "package",
      astNode: { ...packageDefinitions[0], file },
      name,
      packageId: name,
    });

    return name;
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
          diagnosticMessages.redefinitionAt(
            `Field "${redefinition.value}" in message "${definition.name}" already exists`,
            redefinition
          )
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
      definition.fields.push({
        name: (field.name as StringToken).value,
        ordinal,
        type,
        optional: !!field.optional,
        nameToken: field.name,
      });
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
          diagnosticMessages.redefinitionAt(
            `RPC "${redefinition.value}" already exists in service "${definition.name}"`,
            redefinition
          )
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

      definition.rpcs.push({
        path: (rpc.name as StringToken).value,
        pathToken: rpc.name,
        request: { type: requestType, stream: !!rpc.requestStream },
        response: { type: responseType, stream: !!rpc.responseStream },
      });
    }
  }

  lookupType(
    currentPackageId: UserPackageId,
    packageId: string,
    typeName: string
  ):
    | Omit<RealTypeInstance, "packageIdTokens" | "nameToken">
    | UnknownTypeInstance {
    let definition: Exclude<TypeDefinition, GenericType> | undefined;
    if (!packageId) {
      definition =
        this.builtinTypes.find((t) => t.name === typeName) ??
        this.definitions
          .filter((d) => d.kind !== "service" && d.kind !== "package")
          .find((d) => d.name === typeName && d.packageId === currentPackageId);
    } else {
      definition =
        this.definitions
          .filter((d) => d.kind !== "service" && d.kind !== "package")
          .find((d) => d.name === typeName && d.packageId === packageId) ??
        (typeof currentPackageId === "string"
          ? this.definitions
              .filter((d) => d.kind !== "service" && d.kind !== "package")
              .find(
                (d) =>
                  d.name === typeName &&
                  d.packageId === `${currentPackageId as string}.${packageId}`
              )
          : undefined);
    }

    if (!definition) {
      return { kind: "unknown" };
    }

    return {
      kind: "real",
      packageId: definition.packageId,
      args: definition.args,
      definition,
    };
  }

  resolveType(
    definition: MessageDefinition | ServiceDefinition,
    typeNode: TypeNode
  ): TypeInstance {
    if (!typeNode.isComplete) {
      return { kind: "unknown" };
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
        return { kind: "unknown" };
      }

      return {
        kind: "generic",
        token: name[0],
        name: name[0].value,
      };
    }

    const packageId = name
      .slice(0, -2)
      .map((n) => n.value)
      .join("");
    const typeName = name[name.length - 1].value;

    const resolvedType = this.lookupType(
      definition.packageId,
      packageId,
      typeName
    );
    const diagnosticName = name.map((t) => t.value).join("");

    if (resolvedType.kind === "unknown") {
      this.diagnostics.error(
        name[0],
        "global",
        `Unknown type "${diagnosticName}"`
      );
      return resolvedType;
    }

    const returnedType = {
      ...resolvedType,
      nameToken: name[name.length - 1],
      packageIdTokens: name.slice(0, -1),
    };
    returnedType.args = [];

    let idx = 0;
    for (const generic of typeNode.args ?? []) {
      if (!generic.identifier.isComplete) {
        continue;
      }
      if (idx >= resolvedType.args.length) {
        this.diagnostics.error(
          generic.identifier.tokens[0],
          "global",
          resolvedType.args.length === 0
            ? `Type "${diagnosticName}" does not have generic arguments`
            : `Type "${diagnosticName}" only has ${resolvedType.args.length} generic arguments`
        );
      }
      const verified = this.resolveType(definition, generic);
      returnedType.args.push(verified);
      idx++;
    }

    return returnedType;
  }

  serviceResolveType(definition: ServiceDefinition, typeNode: TypeNode) {
    const type = this.resolveType(definition, typeNode) as RPCTypeInstance;
    if (type.kind === "unknown") {
      return type;
    }
    this.addGenericMessageInstances(type);
    return type;
  }

  addGenericMessageInstances(type: RPCTypeInstance) {
    function rpcTypeToDeepRealType(
      rpcType: RPCTypeInstance
    ): DeepRealTypeInstance | undefined {
      if (rpcType.kind === "unknown") {
        return undefined;
      }

      const args = rpcType.args.map(rpcTypeToDeepRealType);
      if (!args.every((a) => !!a)) {
        return undefined;
      }

      return {
        ...rpcType,
        args,
      };
    }

    if (type.kind === "unknown") {
      return;
    }

    if (type.definition.kind === "message") {
      if (
        !type.definition.instances.some(
          (args) =>
            args.length === type.args.length &&
            args.every(
              (a, i) =>
                a.kind === "real" &&
                type.args[i].kind === "real" &&
                a.definition.packageId === type.args[i].definition.packageId &&
                a.definition.name === type.args[i].definition.name
            )
        )
      ) {
        const args = type.args.map(rpcTypeToDeepRealType);
        if (args.every((a) => !!a)) {
          type.definition.instances.push(args);
        }
      }
    }

    for (const arg of type.args) {
      this.addGenericMessageInstances(arg);
    }
  }
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
          diagnosticMessages.redefinitionAt(
            `Field "${redefinition.value}" in enum "${def.name}" already exists`,
            redefinition
          )
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

      def.fields.push({
        name: (field.name as StringToken).value,
        value,
        nameToken: field.name,
      });
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
      fields: [],
    };

    const definedFields = new Map<string, StringToken>();

    for (const field of node.fields) {
      const redefinition = definedFields.get((field as StringToken).value);
      if (redefinition) {
        diagnostics.error(
          field,
          "local",
          diagnosticMessages.redefinitionAt(
            `Field "${redefinition.value}" in string enum "${def.name}" already exists`,
            redefinition
          )
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
      name: (node.type.identifier.tokens[0] as StringToken).value,
      astNode: { file, ...node },
      packageId,
      args: [],
      fields: [],
      instances: [],
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
        kind: "generic",
        name: (arg.identifier.tokens[0] as StringToken).value,
        token: arg.identifier.tokens[0],
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
  args: DeepRealTypeInstance[]
): MessageDefinitionInstance {
  const genericsMap = Object.fromEntries(
    definition.args.map((a, i) => [a.name, args[i]])
  );

  return {
    ...definition,
    fields: definition.fields.map((f) => ({
      ...f,
      type: realizeType(f.type as KnownTypeInstance, genericsMap),
    })),
    args,
  };
}

function realizeType(
  type: KnownTypeInstance,
  genericsMap: Record<string, DeepRealTypeInstance>
): DeepRealTypeInstance {
  if (type.kind === "generic") {
    return genericsMap[type.name];
  }

  return {
    ...type,
    args: type.args.map((a) => realizeType(a, genericsMap)),
  };
}

function builtinTypes() {
  const ret: BuiltinTypeDefinition[] = [];

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
      packageId: BUILTIN_PACKAGE,
      name: builtin,
      args: [],
    });
  }
  ret.push({
    kind: "builtin",
    packageId: BUILTIN_PACKAGE,
    name: "Array",
    args: [{ kind: "generic", name: "T", token: undefined as any }],
  });
  ret.push({
    kind: "builtin",
    packageId: BUILTIN_PACKAGE,
    name: "Nullable",
    args: [{ kind: "generic", name: "T", token: undefined as any }],
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
