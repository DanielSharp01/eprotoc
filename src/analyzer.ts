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
import { DiagnosticCollection } from "./diagnostic";

export const BUILTIN_PACKAGE = Symbol("BUILTIN_PACKAGE");
export const UNKNOWN_PACKAGE = Symbol("UNKNOWN_PACKAGE");

export type UserPackageId = string | typeof UNKNOWN_PACKAGE;
export type PackageId = UserPackageId | typeof BUILTIN_PACKAGE;

export type Definition =
  | EnumDefinition
  | StringEnumDefinition
  | MessageDefinition
  | ServiceDefinition;

export interface BaseDefinition<TNode extends ASTNode> {
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
    // TODO: This has to be unique (so kind of a Set but that doesn't work with array)
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
    this.definitions = astNodes
      .map((a) => astNodeToDefinition(file, a, packageId, this.diagnostics))
      .filter((f) => !!f);
  }

  analyze() {
    for (const definition of this.definitions) {
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
    for (const field of definition.astNode.fields) {
      if (!field.isComplete) continue;

      if (field.ordinal) {
        const newOrdinal = (field.ordinal.value as NumberToken).value;
        if (newOrdinal < ordinal) {
          this.diagnostics.error({
            item: field.ordinal.value,
            message:
              newOrdinal < 1
                ? "Message field numbers must be greater than 0."
                : "Message field numbers must be sequential.",
          });
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
    for (const rpc of definition.astNode.rpcs) {
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
        this.diagnostics.error({
          item: typeNode.args[0].identifier.tokens[0],
          message: `Generic type "${name[0]}" must not have a generic argument`,
        });
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
      console.log(this.definitions);
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
      this.diagnostics.error({
        item: typeNode.identifier.tokens[0],
        message: `Unknown type "${diagnosticName}"`,
      });
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
        this.diagnostics.error({
          item: generic.identifier.tokens[0],
          message:
            resolvedType.args.length === 0
              ? `Type "${diagnosticName}" does not have generic arguments`
              : `Type "${diagnosticName}" only has ${resolvedType.args.length} generic arguments`,
        });
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

  /*getASTs() {
    return Object.fromEntries(this.fileASTs.entries());
  }

  getPackageDefinitions() {
    return Object.fromEntries(
      this.packages
        .entries()
        .map(([k, v]) => [k, [...v.definitionsPerFile.values()].flat()])
    );
  }

  getFileDefinitions() {
    return Object.fromEntries(
      [...this.packages.values()].flatMap((v) => [
        ...v.definitionsPerFile.entries(),
      ])
    );
  }

  getDefinitions() {
    return [...this.packages.values()].flatMap((v) =>
      [...v.definitionsPerFile.values()].flat()
    );
  }

  findTypeDefinition<T extends "enum" | "message">(
    kind: T,
    pkg: UserPackageId,
    name: string
  ): (Definition & { kind: T }) | undefined {
    const userPackage = this.packages.get(pkg);
    if (!userPackage) return undefined;

    return [...userPackage.definitionsPerFile.values()]
      .flat()
      .find((def) => def.kind === kind && def.typeDefinition.name === name) as
      | (Definition & { kind: T })
      | undefined;
  }*/
}

function getCurrentPackageFromNodes(
  file: string,
  ast: ASTNode[],
  diagnostics: DiagnosticCollection
) {
  const packageDefinitions = ast.filter((p) => p.kind === "package-definition");
  if (packageDefinitions.length === 0) {
    diagnostics.error({
      item: {
        file,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
      },
      message: "Every file requires a package definition",
    });
    return UNKNOWN_PACKAGE;
  }

  if (!packageDefinitions[0].identifier.isComplete) {
    return UNKNOWN_PACKAGE;
  }

  for (const packageDefinition of packageDefinitions.slice(1)) {
    diagnostics.error({
      item: packageDefinition.keyword,
      message: "Multiple package definitions are not allowed.",
    });
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
    for (const field of node.fields) {
      if (!field.isComplete) continue;

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
      fields: node.fields.map((field) => (field as StringToken).value),
    };

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
        diagnostics.error({
          item: arg.args[0].identifier.tokens[0],
          message:
            "Generic arguments must be simple indentifiers and must not themselves be generic.",
        });
        return undefined;
      }
      if (arg.identifier.tokens.length > 1) {
        diagnostics.error({
          item: arg.args[0].identifier.tokens[0],
          message:
            "Generic arguments must be simple indentifiers and must not have package prefixes.",
        });
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

  if (
    node.kind === "enum-declaration" &&
    node.name.tokenType === "identifier"
  ) {
    return enumDefinition(node);
  } else if (
    node.kind === "string-enum-declaration" &&
    node.name.tokenType === "identifier"
  ) {
    return stringEnumDefinition(node);
  } else if (node.kind === "message-declaration" && node.type.isComplete) {
    return messageDefinition(node);
  } else if (
    node.kind === "service-declaration" &&
    node.name.tokenType === "identifier"
  ) {
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
  ret.push({
    kind: "builtin",
    typeKind: "real",
    packageId: BUILTIN_PACKAGE,
    name: "OneOf",
    args: [],
    restArgs: true,
  });

  return ret;
}
