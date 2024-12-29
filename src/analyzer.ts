import fs from "fs";
import {
  ASTNode,
  EnumNode,
  MessageNode,
  parse,
  ServiceNode,
  TypeNode,
} from "./parser";
import { StringToken, Token, tokenize } from "./tokenizer";
import { DiagnosticCollection } from "./diagnostic";
import { promisify } from "util";

export const BUILTIN_PACKAGE = Symbol("BUILTIN_PACKAGE");
export const UNKNOWN_PACKAGE = Symbol("UNKNOWN_PACKAGE");

export type UserPackageIdentifier = string | typeof UNKNOWN_PACKAGE;
export type PackageIdentifier = UserPackageIdentifier | typeof BUILTIN_PACKAGE;

export type Definition = EnumDefinition | MessageDefinition | ServiceDefinition;

export interface TypeDefinition {
  kind: "message" | "enum" | "builtin";
  package: PackageIdentifier;
  name: string;
  args: string[];
  restArgs: boolean;
}

export type Type = RealType | GenericType;

export interface RealType {
  kind: "real";
  definition: TypeDefinition;
  args: Type[];
}

export interface GenericType {
  kind: "generic";
  name: string;
}

export interface EnumDefinition {
  kind: "enum";
  typeDefinition: TypeDefinition;
  valueType: "string" | "number" | "unknown";
  fields: { name: string; value: string | number }[];
}

export interface MessageDefinition {
  kind: "message";
  typeDefinition: TypeDefinition;
  fields: { optional: boolean; type: Type; name: string; ordinal: number }[];
}

export interface ServiceDefinition {
  kind: "service";
  name: string;
  package: UserPackageIdentifier;
  rpcs: {
    input: { stream: boolean; type: Type };
    output: { stream: boolean; type: Type };
  }[];
}

export class SemanticAnalyzer {
  public fileASTs = new Map<string, ASTNode[]>();
  public packages = new Map<UserPackageIdentifier, UserPackage>();
  public fileToPackage = new Map<string, UserPackageIdentifier>();
  public typeRepository: TypeRepository;

  constructor(private diagnostics: DiagnosticCollection) {
    this.typeRepository = new TypeRepository(diagnostics);
  }

  async parseFile(file: string): Promise<void> {
    const tokens = tokenize(
      file,
      await promisify(fs.readFile)(file, "utf-8"),
      this.diagnostics
    );
    const ast = parse(tokens, this.diagnostics);
    this.fileASTs.set(file, ast);
    const previousPkg = this.fileToPackage.get(file);
    if (previousPkg) {
      const prevUserPackage = this.packages.get(previousPkg);
      if (prevUserPackage) {
        const nodes = prevUserPackage.removeASTNodes(file);
        this.typeRepository.removeASTNodes(nodes);
      }
    }

    const newPkg = figureOutPackage(file, ast, this.diagnostics);

    const userPackage =
      this.packages.get(newPkg) ??
      new UserPackage(newPkg, this.typeRepository, this.diagnostics);

    this.packages.set(newPkg, userPackage);

    userPackage.addASTNodes(file, ast);
    this.typeRepository.addASTNodes(newPkg, ast, this.diagnostics);
  }

  analyze() {
    for (const pkg of this.packages.values()) {
      pkg.analyze();
    }
  }

  getASTs() {
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
}

export class TypeRepository {
  public astNodeToTypeName = new Map<ASTNode, [PackageIdentifier, string]>();
  public typeNamesToDefinitions = new Map<
    PackageIdentifier,
    Map<string, TypeDefinition>
  >();

  constructor(private diagnostics: DiagnosticCollection) {
    this.typeNamesToDefinitions.set(BUILTIN_PACKAGE, builtinPackageTypes());
  }

  getDefinitionForNode(node: ASTNode): TypeDefinition | undefined {
    const typeId = this.astNodeToTypeName.get(node);
    if (!typeId) return undefined;
    const [pkg, typeName] = typeId;
    return this.typeNamesToDefinitions.get(pkg)?.get(typeName);
  }

  resolveType(
    currentPackage: UserPackageIdentifier,
    typeNode: TypeNode,
    generics: string[]
  ): Type | undefined {
    if (!typeNode.isComplete) {
      return undefined;
    }

    const name = typeNode.identifier.tokens as StringToken[];
    if (name.length === 1 && generics.includes(name[0].value)) {
      if (
        typeNode.generics.length > 0 &&
        typeNode.generics[0].identifier.isComplete
      ) {
        this.diagnostics.error({
          item: typeNode.generics[0].identifier.tokens[0],
          message: `Generic type "${name[0]}" must not have a generic argument`,
        });
        return undefined;
      }

      return {
        kind: "generic",
        name: name[0].value,
      };
    }

    const packageName = name
      .slice(0, -2)
      .map((n) => n.value)
      .join("");
    const typeName = name[name.length - 1].value;

    const resolvedType: Partial<RealType> = { kind: "real" };
    if (!packageName) {
      resolvedType.definition =
        this.typeNamesToDefinitions.get(BUILTIN_PACKAGE)?.get(typeName) ??
        this.typeNamesToDefinitions.get(currentPackage)?.get(typeName);
    } else {
      resolvedType.definition =
        this.typeNamesToDefinitions.get(packageName)?.get(typeName) ??
        currentPackage !== UNKNOWN_PACKAGE
          ? this.typeNamesToDefinitions
              .get(`${currentPackage as string}.${packageName}`)
              ?.get(typeName)
          : undefined;
    }
    const diagnosticName = name.map((t) => t.value).join("");

    if (!resolvedType.definition) {
      this.diagnostics.error({
        item: typeNode.identifier.tokens[0],
        message: `Unknown type "${diagnosticName}"`,
      });
      return undefined;
    }

    resolvedType.args = [];

    let idx = 0;
    for (const generic of typeNode.generics ?? []) {
      if (!generic.identifier.isComplete) {
        continue;
      }
      if (
        !resolvedType.definition.restArgs &&
        idx >= resolvedType.definition.args.length
      ) {
        this.diagnostics.error({
          item: generic.identifier.tokens[0],
          message:
            resolvedType.definition.args.length === 0
              ? `Type "${diagnosticName}" does not have generic arguments`
              : `Type "${diagnosticName}" only has ${resolvedType.definition.args.length} generic arguments`,
        });
      }
      const verified = this.resolveType(currentPackage, generic, generics);
      if (!verified) {
        return undefined;
      }
      resolvedType.args.push(verified);
      idx++;
    }

    return resolvedType as RealType;
  }

  addASTNodes(
    nodePackage: UserPackageIdentifier,
    nodes: ASTNode[],
    diagnostics: DiagnosticCollection
  ) {
    for (const node of nodes) {
      const type = astNodeToType(nodePackage, node, diagnostics);
      if (type) {
        this.addTypeWithASTNode(type, node);
      }
    }
  }

  addTypeWithASTNode(type: TypeDefinition, node: ASTNode) {
    const packageMap =
      this.typeNamesToDefinitions.get(type.package) ??
      new Map<string, TypeDefinition>();
    packageMap.set(type.name, type);
    this.typeNamesToDefinitions.set(type.package, packageMap);
    this.astNodeToTypeName.set(node, [type.package, type.name]);
  }

  removeASTNodes(nodes: ASTNode[]) {
    for (const node of nodes) {
      const typeId = this.astNodeToTypeName.get(node);
      if (!typeId) continue;
      const [pkg, typeName] = typeId;
      const map = this.typeNamesToDefinitions.get(pkg);
      if (!map) {
        return;
      }
      map.delete(typeName);
      if (map.size === 0) {
        this.typeNamesToDefinitions.delete(pkg);
      }
    }
  }
}

export class UserPackage {
  public astNodesPerFile = new Map<string, ASTNode[]>();
  public definitionsPerFile = new Map<string, Definition[]>();

  constructor(
    public name: UserPackageIdentifier,
    private typeRepository: TypeRepository,
    private diagnostics: DiagnosticCollection
  ) {}

  addASTNodes(file: string, nodes: ASTNode[]) {
    this.astNodesPerFile.set(file, nodes);
  }

  analyze() {
    for (const file of this.astNodesPerFile.keys()) {
      const definitions: Definition[] = [];
      this.definitionsPerFile.set(file, definitions);
      for (const node of this.astNodesPerFile.get(file)!) {
        if (
          node.kind === "enum-declaration" &&
          node.name.tokenType === "identifier"
        ) {
          const def = this.analyzeEnumNode(node);
          if (def) {
            definitions.push(def);
          }
        } else if (
          node.kind === "message-declaration" &&
          node.type.isComplete
        ) {
          const def = this.analyzeMessageNode(node);
          if (def) {
            definitions.push(def);
          }
        } else if (
          node.kind === "service-declaration" &&
          node.name.tokenType === "identifier"
        ) {
          const def = this.analyzeServiceNode(node);
          if (def) {
            definitions.push(def);
          }
        }
      }
    }
  }

  private analyzeEnumNode(node: EnumNode) {
    const typeDefinition = this.typeRepository.getDefinitionForNode(node);
    if (!typeDefinition) {
      this.diagnostics.logger.error(
        "Node has no type definition and it was expected. This is a bug."
      );
      this.diagnostics.logger.error(node);
      process.exit(1);
    }
    const enumDef: EnumDefinition = {
      kind: "enum",
      valueType: "unknown",
      typeDefinition,
      fields: [],
    };
    const emptyValues: Token[] = [];
    let ordinal = 0;
    let value: string | number = 0;
    for (const field of node.fields ?? []) {
      if (!field.name) continue;
      if (field.value && field.value.value.tokenType === "string-literal") {
        value = field.value.value.value;
        if (enumDef.valueType === "number") {
          this.diagnostics.error({
            item: field.value.value,
            message: "All fields of an enum must be either number or string",
          });
        } else if (enumDef.valueType === "unknown") {
          enumDef.valueType = "string";
          if (emptyValues.length > 0) {
            for (const value of emptyValues) {
              if (enumDef.valueType === "string") {
                this.diagnostics.error({
                  item: field.value.value,
                  message: "A string enum must not have empty values",
                });
              }
            }
          }
        }
      } else if (
        field.value &&
        field.value.value.tokenType === "numeric-literal"
      ) {
        value = field.value.value.value;
        ordinal = value;
        if (enumDef.valueType === "string") {
          this.diagnostics.error({
            item: field.value.value,
            message: "All fields of an enum must be either number or string",
          });
        } else if (enumDef.valueType === "unknown") {
          enumDef.valueType = "number";
        }
      } else if (!field.value) {
        if (enumDef.valueType === "string") {
          this.diagnostics.error({
            item: field.name,
            message: "A string enum must not have empty values",
          });
        }
        emptyValues.push(field.name);
        value = ordinal;
      }
      enumDef.fields.push({
        name: (field.name as StringToken).value,
        value: value,
      });
      ordinal++;
    }
    if (enumDef.valueType === "unknown") {
      enumDef.valueType = "number";
    }
    return enumDef;
  }

  private analyzeMessageNode(node: MessageNode) {
    if (!node.type.isComplete) {
      return undefined;
    }

    const typeDefinition = this.typeRepository.getDefinitionForNode(node);
    if (!typeDefinition) {
      this.diagnostics.logger.error(
        "Node has no type definition and it was expected. This is a bug."
      );
      this.diagnostics.logger.error(node);
      process.exit(1);
    }

    const messageDef: MessageDefinition = {
      kind: "message",
      fields: [],
      typeDefinition,
    };
    let ordinal = 0;
    for (const field of node.fields ?? []) {
      if (field.ordinal) {
        const newOrdinal = Number(field.ordinal.value);
        if (ordinal >= newOrdinal) {
          this.diagnostics.error({
            item: field.ordinal.value,
            message: "Message field numbers must be sequential",
          });
        }
        ordinal = newOrdinal;
      }

      ordinal++;
      if (field.name.tokenType !== "identifier") continue;
      if (!field.type.identifier.isComplete) {
        continue;
      }

      const type = this.typeRepository.resolveType(
        this.name,
        field.type,
        typeDefinition.args
      );
      if (!type) {
        continue;
      }

      messageDef.fields.push({
        name: field.name.value,
        optional: !!field.optional,
        ordinal: ordinal - 1,
        type,
      });
    }
    return messageDef;
  }

  private analyzeServiceNode(node: ServiceNode) {
    if (node.name.tokenType !== "identifier") {
      return undefined;
    }
    const serviceDef: ServiceDefinition = {
      kind: "service",
      name: node.name.value,
      package: this.name,
      rpcs: [],
    };
    for (const rpc of node.rpcs ?? []) {
      if (
        rpc.name.tokenType !== "identifier" ||
        !rpc.inputType.isComplete ||
        !rpc.outputType.isComplete
      )
        continue;
      const inputType = this.typeRepository.resolveType(
        this.name,
        rpc.inputType,
        []
      );
      const outputType = this.typeRepository.resolveType(
        this.name,
        rpc.outputType,
        []
      );
      if (!inputType || !outputType) continue;
      serviceDef.rpcs.push({
        input: { stream: !!rpc.inputStream, type: inputType },
        output: { stream: !!rpc.outputStream, type: outputType },
      });
    }
    return serviceDef;
  }

  removeASTNodes(file: string) {
    const nodes = this.astNodesPerFile.get(file);
    this.astNodesPerFile.delete(file);
    return nodes ?? [];
  }
}

function figureOutPackage(
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

function astNodeToType(
  nodePackage: UserPackageIdentifier,
  node: ASTNode,
  diagnostics: DiagnosticCollection
): TypeDefinition | undefined {
  if (
    node.kind === "enum-declaration" &&
    node.name.tokenType === "identifier"
  ) {
    return {
      kind: "enum",
      name: node.name.value,
      package: nodePackage,
      args: [],
      restArgs: false,
    };
  } else if (
    node.kind === "message-declaration" &&
    node.type.isComplete &&
    node.type.generics.every((g) => g.isComplete)
  ) {
    for (const generic of node.type.generics) {
      if (generic.generics.length > 0) {
        diagnostics.error({
          item: generic.generics[0].identifier.tokens[0],
          message:
            "Generic arguments must be simple indentifiers and must not themselves be generic",
        });
        return undefined;
      }
      if (generic.identifier.tokens.length > 1) {
        diagnostics.error({
          item: generic.generics[0].identifier.tokens[0],
          message:
            "Generic arguments must be simple indentifiers and must not have package prefixes",
        });
        return undefined;
      }
    }

    return {
      kind: "message",
      name: (node.type.identifier.tokens as StringToken[])
        .map((t) => t.value)
        .join(""),
      package: nodePackage,
      args: node.type.generics.map(
        (g) => (g.identifier.tokens[0] as StringToken).value
      ),
      restArgs: false,
    };
  }

  return undefined;
}

function builtinPackageTypes() {
  const builtinPackageTypes = new Map<string, TypeDefinition>();

  for (const builtin of [
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
    builtinPackageTypes.set(builtin, {
      kind: "builtin",
      package: BUILTIN_PACKAGE,
      name: builtin,
      args: [],
      restArgs: false,
    });
  }
  builtinPackageTypes.set("Array", {
    kind: "builtin",
    package: BUILTIN_PACKAGE,
    name: "Array",
    args: ["T"],
    restArgs: false,
  });
  builtinPackageTypes.set("Nullable", {
    kind: "builtin",
    package: BUILTIN_PACKAGE,
    name: "Nullable",
    args: ["T"],
    restArgs: false,
  });
  builtinPackageTypes.set("OneOf", {
    kind: "builtin",
    package: BUILTIN_PACKAGE,
    name: "OneOf",
    args: [],
    restArgs: true,
  });

  return builtinPackageTypes;
}
