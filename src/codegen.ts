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
  isNative: boolean;
  currentFile: string;
  currentPackage: string;
  typeImports: Map<string, Map<string, string>>;
}

function fqTypeName(
  context: CodeGenContext,
  type: Exclude<TypeDefinition, GenericType | BuiltinTypeDefinition>
) {
  return context.currentFile !== type.astNode.file
    ? `${type.packageId as string}__${type.name}`
    : type.name;
}

function addTypeToImports(
  context: CodeGenContext,
  type: Exclude<TypeDefinition, GenericType | BuiltinTypeDefinition>
) {
  if (type.astNode.file && type.astNode.file !== context.currentFile) {
    const aliasMap = context.typeImports.get(type.astNode.file) ?? new Map();
    aliasMap.set(fqTypeName(context, type), type.name);
    context.typeImports.set(type.astNode.file, aliasMap);
  }
}

export class TSCodeGenerator {
  constructor(private logger: Console) {}

  generate(
    rootDir: string,
    outputDir: string,
    definitions: Definition[],
    isNative: boolean
  ) {
    for (const file of new Set(definitions.map((d) => d.astNode.file))) {
      const defs = definitions.filter((d) => d.astNode.file === file);
      const context: CodeGenContext = {
        isNative,
        currentFile: file,
        currentPackage: defs[0].packageId as string,
        typeImports: new Map(),
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
            `import { ${[
              ...types.entries().map(([alias, type]) => `${type} as ${alias}`),
            ].join(", ")} } from '${swapExtension(
              swapDirectory(path.dirname(file), ".", importFile),
              ""
            )}';`
        )
      );

      const newFile = swapExtension(
        swapDirectory(rootDir, outputDir, file),
        ".ts"
      );
      writeSourceFile(
        this.logger,
        newFile,
        source.filter((f) => !!f).join("\n\n") + "\n"
      );
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

    const realDefinitions = definition.instances
      .values()
      .map((args) => realizeMessageDefinition(definition, args));
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
      ...definition.fields.map((f) => this.serializeMessageField(context, f)),
      "  },",
      `  ${deserializeKey}(reader: _m0.Reader, end: number): ${definition.name}${typeArgsForValue} {`,
      "    let value: any = {};",
      "",
      "    while (reader.pos < end) {",
      "      const tag = reader.uint32();",
      "      const idx = tag >>> 3;",
      ...definition.fields.map((f) => this.deserializeMessageField(context, f)),
      "      else {",
      "        reader.skipType(tag & 7);",
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

    const needsSeparateMessage =
      field.optional &&
      typeDefinitionIsNativelyArrayLike(field.type.definition);

    source.push(
      ...this.serializerForType(
        context,
        field.type,
        `value.${field.name}`,
        true,
        needsSeparateMessage
      ).map((s) => `    ${optionalIndent}${s}`)
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
    const needsSeparateMessage =
      field.optional &&
      typeDefinitionIsNativelyArrayLike(field.type.definition);
    return [
      `      ${field.ordinal > 1 ? "else " : ""}if (idx === ${
        field.ordinal
      }) {`,
      ...this.deserializerForType(
        context,
        field.type,
        `value.${field.name}`,
        true,
        needsSeparateMessage
      ).map((s) => `        ${s}`),
      "      }",
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
              "value",
              false,
              true
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
            "      const end = reader.len;",
            this.deserializerForType(
              context,
              definition.request.type as DeepRealTypeInstance,
              "value",
              false,
              true
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
              "value",
              false,
              true
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
            "      const end = reader.len;",
            this.deserializerForType(
              context,
              definition.response.type as DeepRealTypeInstance,
              "value",
              false,
              true
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

    addTypeToImports(context, type.definition);
    return `${fqTypeName(context, type.definition)}${typeArgs}`;
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
    value: string,
    needsFork: boolean,
    needsSeparateMessage: boolean
  ): string[] {
    const idSafeVal = safeIdentifier(value);

    if (context.isNative && needsSeparateMessage) {
      if (!typeDefinitionIsNativelyMessage(type.definition)) {
        const source = [];
        if (needsFork) {
          source.push("writer.fork();");
        }
        source.push(
          ...this.serializerForDummyMessage(context, [type], [value], [""])
        );
        if (needsFork) {
          source.push("writer.ldelim();");
        }
        return source;
      }
    }

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
        const source = [];

        if (needsFork) {
          source.push("writer.fork();");
        }

        source.push(`for (const ${idSafeVal}_item of ${value}) {`);
        source.push(
          ...this.serializerForType(
            context,
            type.args[0],
            `${idSafeVal}_item`,
            true,
            typeDefinitionIsNativelyArrayLike(type.args[0].definition)
          ).map((s) => `  ${s}`)
        );
        source.push("}");

        if (needsFork) {
          source.push("writer.ldelim();");
        }

        return source;
      } else if (type.definition.name === "Nullable") {
        if (context.isNative) {
          const source = [];
          if (needsFork) {
            source.push("writer.fork();");
          }
          source.push(
            ...this.serializerForDummyMessage(
              context,
              [type.args[0]],
              [value],
              [`${value} !== null`]
            )
          );
          if (needsFork) {
            source.push("writer.ldelim();");
          }
          return source;
        } else {
          return [
            `writer.uint32(${value} === null ? 0 : 1);`,
            `if (${value} !== null) {`,
            ...this.serializerForType(
              context,
              type.args[0],
              `${value}`,
              true,
              false
            ).map((s) => `  ${s}`),
            "}",
          ];
        }
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
      const source = [];
      if (needsFork) {
        source.push("writer.fork();");
      }
      if (type.args.length > 0) {
        source.push(
          `${fqTypeName(context, type.definition)}["serialize<${type.args
            .map((a) => this.generateType(context, a))
            .join(", ")}>"](writer, ${value});`
        );
      } else {
        source.push(
          `${fqTypeName(context, type.definition)}.serialize(writer, ${value});`
        );
      }
      if (needsFork) {
        source.push("writer.ldelim();");
      }
      return source;
    }

    return [];
  }

  private deserializerForType(
    context: CodeGenContext,
    type: DeepRealTypeInstance,
    value: string = "value",
    needsFork: boolean,
    needsSeparateMessage: boolean
  ): string[] {
    const idSafeVal = safeIdentifier(value);

    if (context.isNative && needsSeparateMessage) {
      if (!typeDefinitionIsNativelyMessage(type.definition)) {
        const source = [];
        if (needsFork) {
          source.push("const end = reader.uint32() + reader.pos;");
        }
        source.push(
          ...this.deserializerForDummyMessage(context, [type], [value])
        );
        return source;
      }
    }

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
          needsFork ? `const end = reader.pos + reader.uint32();` : "",
          `while (reader.pos < end) {`,
          ...this.deserializerForType(
            context,
            type.args[0],
            `${value}[${idSafeVal}_i]`,
            true,
            typeDefinitionIsNativelyArrayLike(type.args[0].definition)
          ).map((s) => `  ${s}`),
          `  ${idSafeVal}_i++;`,
          "}",
        ];
      } else if (type.definition.name === "Nullable") {
        if (context.isNative) {
          const source = [];
          source.push(`${value} = null;`);
          if (needsFork) {
            source.push("const end = reader.uint32() + reader.pos;");
          }
          source.push(
            ...this.deserializerForDummyMessage(
              context,
              [type.args[0]],
              [value]
            )
          );
          return source;
        } else {
          return [
            `if (reader.uint32() === 0) {`,
            `  ${value} = null;`,
            `}`,
            `else {`,
            ...this.deserializerForType(
              context,
              type.args[0],
              `${value}`,
              true,
              false
            ).map((s) => `  ${s}`),
            "}",
          ];
        }
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
      const source = [];
      if (needsFork) {
        source.push(`const end = reader.uint32() + reader.pos;`);
      }
      if (type.args.length > 0) {
        source.push(
          `${value} = ${fqTypeName(context, type.definition)}["deserialize<${type.args
            .map((a) => this.generateType(context, a))
            .join(", ")}>"](reader, end);`
        );
      } else {
        source.push(`${fqTypeName(context, type.definition)}.deserialize(reader, end);`);
      }
      return source;
    }

    return [];
  }

  serializerForDummyMessage(
    context: CodeGenContext,
    fields: DeepRealTypeInstance[],
    values: string[],
    conditions: string[]
  ) {
    const source = [];
    for (let i = 1; i <= fields.length; i++) {
      const condition = conditions[i - 1];
      if (condition) {
        source.push(`if (${condition}) {`);
      }
      source.push(
        `${condition ? "  " : ""}writer.uint32(${
          (i << 3) + this.wireTypeForType(fields[i - 1])
        });`
      );
      source.push(
        ...this.serializerForType(
          context,
          fields[i - 1],
          values[i - 1],
          true,
          false
        ).map((s) => (condition ? `  ${s}` : s))
      );
      if (condition) {
        source.push(`}`);
      }
    }
    return source;
  }

  deserializerForDummyMessage(
    context: CodeGenContext,
    fields: DeepRealTypeInstance[],
    values: string[]
  ) {
    const source = [];
    source.push(`while (reader.pos < end) {`);
    source.push("  const tag = reader.uint32();");
    source.push("  const idx = tag >> 3;");

    for (let i = 1; i <= fields.length; i++) {
      source.push(`  ${i > 1 ? "else " : ""}if (idx === ${i}) {`);
      source.push(
        ...this.deserializerForType(
          context,
          fields[i - 1],
          values[i - 1],
          true,
          false
        ).map((s) => `    ${s}`)
      );
      source.push(`  }`);
    }
    source.push("  else {");
    source.push("    reader.skipType(tag & 7);");
    source.push("  }");
    source.push("}");

    return source;
  }
}

function typeDefinitionIsNativelyMessage(def: TypeDefinition) {
  return (
    def.kind === "message" ||
    (def.kind === "builtin" && def.name === "Nullable")
  );
}

function typeDefinitionIsNativelyArrayLike(def: TypeDefinition) {
  return def.kind === "builtin" && def.name === "Array";
}

function safeIdentifier(value: string) {
  return value.replaceAll("[", "_").replaceAll("]", "").replaceAll(".", "_");
}

function importPackageIdentifier(value: string) {
  return value.replaceAll("_", "__").replaceAll(".", "_");
}
