import path from "path";
import {
  BuiltinTypeDefinition,
  Definition,
  EnumDefinition,
  GenericType,
  MessageDefinition,
  realizeMessageDefinition,
  MessageDefinitionInstance,
  ServiceDefinition,
  StringEnumDefinition,
  TypeDefinition,
  DeepRealTypeInstance,
  KnownTypeInstance,
} from "./analyzer";
import {
  swapDirectory,
  swapExtension,
  writeSourceFile,
} from "./utils/fs-utils";
import { Console } from "./logger";

const BUILTIN_TS_TYPE = {
  int32: "number",
  int64: "number",
  uint32: "number",
  uint64: "number",
  float: "number",
  double: "number",
  sint32: "number",
  sint64: "number",
  fixed32: "number",
  fixed64: "number",
  sfixed32: "number",
  sfixed64: "number",
  bool: "boolean",
  string: "string",
  bytes: "Uint8Array",
  Date: "Date",
  void: "void",
} as Record<string, string>;

const BUILTIN_WIRE_TYPE = {
  int32: 0,
  int64: 0,
  uint32: 0,
  uint64: 0,
  float: 5,
  double: 1,
  sint32: 0,
  sint64: 0,
  fixed32: 5,
  fixed64: 1,
  sfixed32: 5,
  sfixed64: 1,
  bool: 0,
  string: 2,
  bytes: 2,
  Date: 2,
} as Record<string, number>;

interface CodeGenContext {
  currentFile: string;
  currentPackage: string;
  typeImports: Map<string, Set<string>>;
  packageImports: Map<string, string>;
}

function addTypeToImports(
  context: CodeGenContext,
  type: Exclude<TypeDefinition, GenericType | BuiltinTypeDefinition>
): string | undefined {
  if (type.astNode.file && type.astNode.file !== context.currentFile) {
    if (type.packageId === context.currentPackage) {
      const set = context.typeImports.get(type.astNode.file) ?? new Set();
      set.add(type.name);
      context.typeImports.set(type.astNode.file, set);
    } else {
      const packageAlias = importPackageIdentifier(type.packageId as string);
      context.packageImports.set(type.astNode.file, packageAlias);
      return packageAlias;
    }
  }

  return undefined;
}

export class TSCodeGenerator {
  constructor(private logger: Console) {}

  generate(rootDir: string, outputDir: string, definitions: Definition[]) {
    for (const file of new Set(definitions.map((d) => d.astNode.file))) {
      const defs = definitions.filter((d) => d.astNode.file === file);
      const context: CodeGenContext = {
        currentFile: file,
        currentPackage: defs[0].packageId as string,
        typeImports: new Map(),
        packageImports: new Map(),
      };

      const source: string[] = [
        "/* eslint-disable */",
        'import _m0 from "protobufjs/minimal";',
      ];
      for (const def of defs) {
        source.push(this.generateDefinition(context, def));
      }

      source.splice(
        2,
        0,
        ...[...context.typeImports.entries()].map(
          ([importFile, types]) =>
            `import { ${[...types].join(", ")} } from '${swapExtension(
              swapDirectory(path.dirname(file), ".", importFile),
              ""
            )}';`
        ),
        ...[...context.packageImports.entries()].map(
          ([importFile, packageAlias]) =>
            `import * as ${packageAlias} from '${swapExtension(
              swapDirectory(path.dirname(file), ".", importFile),
              ""
            )}';`
        )
      );

      const newFile = swapExtension(
        swapDirectory(rootDir, outputDir, file),
        ".ts"
      );
      writeSourceFile(newFile, source.filter((f) => !!f).join("\n\n") + "\n");
      this.logger.info(`Generated ${newFile}`);
    }
  }

  private generateDefinition(
    context: CodeGenContext,
    definition: Definition
  ): string {
    if (definition.kind === "enum") {
      return this.generateEnumDefinition(definition);
    } else if (definition.kind === "string-enum") {
      return this.generateStringEnumDefinition(definition);
    } else if (definition.kind === "message") {
      return this.generateMessageDefinition(context, definition);
    } else if (definition.kind === "service") {
      return this.generateServiceDefinition(context, definition);
    }

    return "";
  }

  private generateEnumDefinition(definition: EnumDefinition): string {
    return [
      `export enum ${definition.name} {`,
      ...definition.fields.map((f) => `  ${f.name} = ${f.value},`),
      "}",
    ].join("\n");
  }

  private generateStringEnumDefinition(
    definition: StringEnumDefinition
  ): string {
    return (
      [
        `export type ${definition.name} =`,
        ...definition.fields.map((f) => `"${f}"`),
      ].join("\n | ") + ";"
    );
  }

  private generateMessageDefinition(
    context: CodeGenContext,
    definition: MessageDefinition
  ): string {
    const typeArgs =
      definition.args.length === 0
        ? ""
        : `<${definition.args
            .map((a) => this.generateType(context, a))
            .join(", ")}>`;

    const interfaceSource = [
      `export interface ${definition.name}${typeArgs} {`,
      ...definition.fields.map(
        (f) =>
          `  ${f.name}${f.optional ? "?" : ""}: ${this.generateType(
            context,
            f.type as KnownTypeInstance
          )};`
      ),
      "}",
    ].join("\n");

    const realDefinitions = definition.instances.map((args) =>
      realizeMessageDefinition(definition, args)
    );
    const objectSource = [
      `export const ${definition.name} = {`,
      ...realDefinitions.flatMap((def) =>
        this.generateMessageObjectMethods(context, def)
      ),
      "}",
    ].join("\n");

    return [interfaceSource, objectSource].join("\n\n");
  }

  private generateMessageObjectMethods(
    context: CodeGenContext,
    definition: MessageDefinitionInstance
  ) {
    const typeArgsForValue =
      definition.args.length === 0
        ? ""
        : `<${definition.args
            .map((a) => this.generateType(context, a))
            .join(", ")}>`;
    const serializeKey =
      definition.args.length === 0
        ? "serialize"
        : `"serialize${typeArgsForValue}"`;
    const deserializeKey =
      definition.args.length === 0
        ? "deserialize"
        : `"deserialize${typeArgsForValue}"`;

    return [
      `  ${serializeKey}(writer: _m0.Writer, value: ${definition.name}${typeArgsForValue}) {`,
      "    writer.fork();",
      ...definition.fields.map((f) => this.serializeMessageField(context, f)),
      "    writer.ldelim();",
      "  },",
      `  ${deserializeKey}(reader: _m0.Reader): ${definition.name}${typeArgsForValue} {`,
      "    let value: any = {};",
      "    const end = reader.uint32() + reader.pos;",
      "",
      "    while (reader.pos < end) {",
      "      const tag = reader.uint32();",
      "      switch (tag >> 3) {",
      ...definition.fields.map((f) => this.deserializeMessageField(context, f)),
      "        default:",
      "          reader.skipType(tag & 7);",
      "          break;",
      "      }",
      "    }",
      "",
      "    return value;",
      "  },",
    ];
  }

  private serializeMessageField(
    context: CodeGenContext,
    field: MessageDefinitionInstance["fields"][number]
  ): string {
    const source: string[] = [];
    const optionalIndent = field.optional ? "  " : "";

    if (field.optional) {
      source.push(`    if (value.${field.name} !== undefined) {`);
    }

    source.push(
      `    ${optionalIndent}writer.uint32(${
        (field.ordinal << 3) + this.wireTypeForType(field.type)
      });`
    );
    source.push(
      ...this.serializerForType(context, field.type, `value.${field.name}`).map(
        (s) => `    ${optionalIndent}${s}`
      )
    );
    if (field.optional) {
      source.push(`    }`);
    }

    return source.join("\n");
  }

  private deserializeMessageField(
    context: CodeGenContext,
    field: MessageDefinitionInstance["fields"][number]
  ): string {
    return [
      `          case ${field.ordinal}:`,
      ...this.deserializerForType(
        context,
        field.type,
        `value.${field.name}`
      ).map((s) => `            ${s}`),
      "          break;",
    ].join("\n");
  }

  private generateServiceDefinition(
    context: CodeGenContext,
    definition: ServiceDefinition
  ): string {
    return [
      `export const ${definition.name}Definition = {`,
      ...definition.rpcs.map((r) => this.generateRPCDefinition(context, r)),
      "};",
    ].join("\n");
  }

  private generateRPCDefinition(
    context: CodeGenContext,
    definition: ServiceDefinition["rpcs"][number]
  ): string {
    return [
      `  ${definition.path}: {`,
      `    path: "${definition.path}",`,
      `    requestStream: ${definition.request.stream ? "true" : "false"},`,
      `    responseStream: ${definition.response.stream ? "true" : "false"},`,
      `    requestSerialize(value: ${this.generateType(
        context,
        definition.request.type as KnownTypeInstance
      )}): Uint8Array {`,
      definition.request.type.kind === "real" &&
      definition.request.type.definition.name !== "void"
        ? [
            "      const writer = _m0.Writer.create();",
            this.serializerForType(
              context,
              definition.request.type as DeepRealTypeInstance,
              "value"
            )
              .map((s) => `      ${s}`)
              .join("\n"),
            "      return writer.finish();",
          ].join("\n")
        : "      return new Uint8Array();",
      `    },`,
      `    requestDeserialize(bytes: Uint8Array): ${this.generateType(
        context,
        definition.request.type as KnownTypeInstance
      )} {`,
      definition.request.type.kind === "real" &&
      definition.request.type.definition.name !== "void"
        ? [
            "      const reader = _m0.Reader.create(bytes);",
            "      let value: any;",
            this.deserializerForType(
              context,
              definition.request.type as DeepRealTypeInstance,
              "value"
            )
              .map((s) => `      ${s}`)
              .join("\n"),
            "      return value;",
          ].join("\n")
        : "      // Empty due to void return type",
      `    },`,
      `    responseSerialize(value: ${this.generateType(
        context,
        definition.response.type as DeepRealTypeInstance
      )}): Uint8Array {`,
      definition.response.type.kind === "real" &&
      definition.response.type.definition.name !== "void"
        ? [
            "      const writer = _m0.Writer.create();",
            this.serializerForType(
              context,
              definition.response.type as DeepRealTypeInstance,
              "value"
            )
              .map((s) => `      ${s}`)
              .join("\n"),
            "      return writer.finish();",
          ].join("\n")
        : "      return new Uint8Array();",
      `    },`,
      `    responseDeserialize(bytes: Uint8Array): ${this.generateType(
        context,
        definition.response.type as DeepRealTypeInstance
      )} {`,
      definition.response.type.kind === "real" &&
      definition.response.type.definition.name !== "void"
        ? [
            "      const reader = _m0.Reader.create(bytes);",
            "      let value: any;",
            this.deserializerForType(
              context,
              definition.response.type as DeepRealTypeInstance,
              "value"
            )
              .map((s) => `      ${s}`)
              .join("\n"),
            "      return value;",
          ].join("\n")
        : "      // Empty due to void return type",
      `    },`,
      "    options: {},",
      `  },`,
    ].join("\n");
  }

  private generateType(
    context: CodeGenContext,
    type: KnownTypeInstance
  ): string {
    if (type.kind === "generic") {
      return type.name;
    }

    const typeArgs =
      type.args.length === 0
        ? ""
        : `<${type.args.map((a) => this.generateType(context, a)).join(", ")}>`;

    if (type.definition.kind === "builtin") {
      if (type.args.length === 0) {
        return BUILTIN_TS_TYPE[type.definition.name];
      } else if (type.definition.name === "Nullable") {
        return `${this.generateType(context, type.args[0])} | null`;
      } else {
        return `${type.definition.name}${typeArgs}`;
      }
    }

    const packageAlias = addTypeToImports(context, type.definition);
    return [packageAlias, `${type.definition.name}${typeArgs}`]
      .filter((f) => !!f)
      .join(".");
  }

  private wireTypeForType(type: DeepRealTypeInstance): number {
    if (type.definition.kind === "builtin") {
      if (type.args.length === 0) {
        return BUILTIN_WIRE_TYPE[type.definition.name];
      }
    }

    return 2;
  }

  private serializerForType(
    context: CodeGenContext,
    type: DeepRealTypeInstance,
    value: string
  ): string[] {
    const idSafeVal = safeIdentifier(value);

    if (type.definition.kind === "builtin") {
      if (type.args.length === 0) {
        if (type.definition.name === "bool") {
          return [`writer.uint32(${value} ? 1 : 0);`];
        } else if (type.definition.name === "Date") {
          return [`writer.string(${value}.toISOString());`];
        } else {
          return [`writer.${type.definition.name}(${value});`];
        }
      } else if (type.definition.name === "Array") {
        return [
          `writer.fork();`,
          `for (const ${idSafeVal}_item of ${value}) {`,
          ...this.serializerForType(
            context,
            type.args[0],
            `${idSafeVal}_item`
          ).map((s) => `  ${s}`),
          "}",
          "writer.ldelim();",
        ];
      } else if (type.definition.name === "Nullable") {
        return [
          `writer.fork();`,
          `writer.uint32(${value} === null ? 0 : 1);`,
          `if (${value} !== null) {`,
          ...this.serializerForType(context, type.args[0], `${value}`).map(
            (s) => `  ${s}`
          ),
          "}",
          "writer.ldelim();",
        ];
      } else {
        this.logger.error(
          `Generation failed due to missing implementation for type ${type.definition.name}`
        );
        process.exit(1);
      }
    } else if (type.definition.kind === "enum") {
      return [`writer.uint32(${value} as number);`];
    } else if (type.definition.kind === "string-enum") {
      return [`writer.string(${value});`];
    } else if (type.definition.kind === "message") {
      if (type.args.length > 0) {
        return [
          `${type.definition.name}["serialize<${type.args
            .map((a) => this.generateType(context, a))
            .join(", ")}>"](writer, ${value});`,
        ];
      } else {
        return [`${type.definition.name}.serialize(writer, ${value});`];
      }
    }

    return [];
  }

  private deserializerForType(
    context: CodeGenContext,
    type: DeepRealTypeInstance,
    value: string = "value"
  ): string[] {
    const idSafeVal = safeIdentifier(value);

    if (type.definition.kind == "builtin") {
      if (type.args.length === 0) {
        if (type.definition.name === "bool") {
          return [`${value} = !!reader.uint32();`];
        } else if (type.definition.name === "Date") {
          return [`${value} = new Date(reader.string());`];
        } else {
          return [`${value} = reader.${type.definition.name}();`];
        }
      } else if (type.definition.name === "Array") {
        return [
          `${value} = [];`,
          `let ${idSafeVal}_i = 0;`,
          `const ${idSafeVal}_end = reader.pos + reader.uint32();`,
          `while (reader.pos < ${idSafeVal}_end) {`,
          ...this.deserializerForType(
            context,
            type.args[0],
            `${value}[${idSafeVal}_i]`
          ).map((s) => `  ${s}`),
          `  ${idSafeVal}_i++;`,
          "}",
        ];
      } else if (type.definition.name === "Nullable") {
        return [
          `reader.uint32();`,
          `if (reader.uint32() === 0) {`,
          `  ${value} = null;`,
          `}`,
          `else {`,
          "",
          ...this.deserializerForType(context, type.args[0], `${value}`),
          "}",
        ];
      } else {
        this.logger.error(
          `Generation failed due to missing implementation for type ${type.definition.name}`
        );
        process.exit(1);
      }
    } else if (type.definition.kind === "string-enum") {
      return [`${value} = reader.string();`];
    } else if (type.definition.kind === "enum") {
      return [`${value} = reader.uint32() as ${type.definition.name};`];
    } else if (type.definition.kind === "message") {
      if (type.args.length > 0) {
        return [
          `${value} = ${type.definition.name}["deserialize<${type.args
            .map((a) => this.generateType(context, a))
            .join(", ")}>"](reader);`,
        ];
      } else {
        return [`${type.definition.name}.deserialize(reader);`];
      }
    }

    return [];
  }
}

function safeIdentifier(value: string) {
  return value.replaceAll("[", "_").replaceAll("]", "").replaceAll(".", "_");
}

function importPackageIdentifier(value: string) {
  return value.replaceAll("_", "__").replaceAll(".", "_");
}
