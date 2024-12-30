import {
  DeepRealType,
  Definition,
  EnumDefinition,
  getRealMessageDefinition,
  MessageDefinition,
  RealMessageDefinition,
  SemanticAnalyzer,
  ServiceDefinition,
  Type,
  UserPackageIdentifier,
} from "./analyzer";
import { swapDirectory, swapExtension, writeSourceFile } from "./fs-utils";
import { Logger } from "./logger";

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

export class TSCodeGenerator {
  constructor(private logger: Logger, private analyzer: SemanticAnalyzer) {}

  generate(rootDir: string, outputDir: string) {
    const defs = this.analyzer.getFileDefinitions();
    for (const file of Object.keys(defs)) {
      const source: string[] = [
        "/* eslint-disable */",
        'import _m0 from "protobufjs/minimal";',
        "",
      ];
      for (const def of defs[file]) {
        source.push(this.generateDefinition(def));
      }
      const newFile = swapExtension(
        swapDirectory(rootDir, outputDir, file),
        ".ts"
      );
      writeSourceFile(newFile, source.filter((f) => !!f).join("\n\n") + "\n");
      this.logger.info(`Generated ${newFile}`);
    }
  }

  private generateDefinition(definition: Definition): string {
    if (definition.kind === "enum") {
      return this.generateEnumDefinition(definition);
    } else if (definition.kind === "message") {
      return this.generateMessageDefinition(definition);
    } else if (definition.kind === "service") {
      return this.generateServiceDefinition(definition);
    }

    return "";
  }

  private generateEnumDefinition(definition: EnumDefinition): string {
    if (definition.valueType === "string") {
      return (
        [
          `export type ${definition.typeDefinition.name} =`,
          ...definition.fields.map((f) => `"${f.value}"`),
        ].join("\n | ") + ";"
      );
    }

    return [
      `export enum ${definition.typeDefinition.name} {`,
      ...definition.fields.map((f) => `  ${f.name} = ${f.value},`),
      "}",
    ].join("\n");
  }

  private generateMessageDefinition(definition: MessageDefinition): string {
    const typeArgs =
      definition.typeDefinition.args.length === 0
        ? ""
        : `<${definition.typeDefinition.args.join(", ")}>`;

    const interfaceSource = [
      `export interface ${definition.typeDefinition.name}${typeArgs} {`,
      ...definition.fields.map(
        (f) =>
          `  ${f.name}${f.optional ? "?" : ""}: ${this.generateType(f.type)};`
      ),
      "}",
    ].join("\n");

    const realDefinitions =
      definition.typeDefinition.args.length === 0
        ? [{ ...definition, args: [] } as RealMessageDefinition]
        : definition.genericInstances.map((typeArgs) =>
            getRealMessageDefinition(definition, typeArgs)
          );
    const objectSource = [
      `export const ${definition.typeDefinition.name} = {`,
      ...realDefinitions.flatMap((def) =>
        this.generateMessageObjectMethods(def)
      ),
      "}",
    ].join("\n");

    return [interfaceSource, objectSource].join("\n\n");
  }

  private generateMessageObjectMethods(definition: RealMessageDefinition) {
    const typeArgsForValue =
      definition.args.length === 0
        ? ""
        : `<${definition.args.map((a) => this.generateType(a)).join(", ")}>`;
    const serializeKey =
      definition.args.length === 0
        ? "serialize"
        : `"serialize${typeArgsForValue}"`;
    const deserializeKey =
      definition.args.length === 0
        ? "deserialize"
        : `"deserialize${typeArgsForValue}"`;

    return [
      `  ${serializeKey}(writer: _m0.Writer, value: ${definition.typeDefinition.name}${typeArgsForValue}) {`,
      "    writer.fork();",
      ...definition.fields.map((f) => this.serializeMessageField(f)),
      "    writer.ldelim();",
      "  },",
      `  ${deserializeKey}(reader: _m0.Reader): ${definition.typeDefinition.name}${typeArgsForValue} {`,
      "    let value: any = {};",
      "    const end = reader.uint32() + reader.pos;",
      "",
      "    while (reader.pos < end) {",
      "      const tag = reader.uint32();",
      "      switch (tag >> 3) {",
      ...definition.fields.map((f) => this.deserializeMessageField(f)),
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
    field: RealMessageDefinition["fields"][number]
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
      ...this.serializerForType(field.type, `value.${field.name}`).map(
        (s) => `    ${optionalIndent}${s}`
      )
    );
    if (field.optional) {
      source.push(`    }`);
    }

    return source.join("\n");
  }

  private deserializeMessageField(
    field: RealMessageDefinition["fields"][number]
  ): string {
    return [
      `          case ${field.ordinal}:`,
      ...this.deserializerForType(field.type, `value.${field.name}`).map(
        (s) => `            ${s}`
      ),
      "          break;",
    ].join("\n");
  }

  private generateServiceDefinition(definition: ServiceDefinition): string {
    return [
      `export const ${definition.name}Definition = {`,
      ...definition.rpcs.map((r) => this.generateRPCDefinition(r)),
      "};",
    ].join("\n");
  }

  private generateRPCDefinition(
    definition: ServiceDefinition["rpcs"][number]
  ): string {
    return [
      `  ${definition.path}: {`,
      `    path: "${definition.path}",`,
      `    requestStream: ${definition.input.stream ? "true" : "false"},`,
      `    responseStream: ${definition.output.stream ? "true" : "false"},`,
      `    requestSerialize(value: ${this.generateType(
        definition.input.type
      )}): Uint8Array {`,
      definition.input.type.kind === "real" &&
      definition.input.type.definition.name !== "void"
        ? [
            "      const writer = _m0.Writer.create();",
            this.serializerForType(definition.input.type, "value")
              .map((s) => `      ${s}`)
              .join("\n"),
            "      return writer.finish();",
          ].join("\n")
        : "      return new Uint8Array();",
      `    },`,
      `    requestDeserialize(bytes: Uint8Array): ${this.generateType(
        definition.input.type
      )} {`,
      definition.input.type.kind === "real" &&
      definition.input.type.definition.name !== "void"
        ? [
            "      const reader = _m0.Reader.create(bytes);",
            "      let value: any;",
            this.deserializerForType(definition.input.type, "value")
              .map((s) => `      ${s}`)
              .join("\n"),
            "      return value;",
          ].join("\n")
        : "      // Empty due to void return type",
      `    },`,
      `    responseSerialize(value: ${this.generateType(
        definition.output.type
      )}): Uint8Array {`,
      definition.output.type.kind === "real" &&
      definition.output.type.definition.name !== "void"
        ? [
            "      const writer = _m0.Writer.create();",
            this.serializerForType(definition.output.type, "value")
              .map((s) => `      ${s}`)
              .join("\n"),
            "      return writer.finish();",
          ].join("\n")
        : "      return new Uint8Array();",
      `    },`,
      `    responseDeserialize(bytes: Uint8Array): ${this.generateType(
        definition.output.type
      )} {`,
      definition.output.type.kind === "real" &&
      definition.output.type.definition.name !== "void"
        ? [
            "      const reader = _m0.Reader.create(bytes);",
            "      let value: any;",
            this.deserializerForType(definition.output.type, "value")
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

  private generateType(type: Type): string {
    if (type.kind === "generic") {
      return type.name;
    }

    if (type.definition.kind == "builtin") {
      if (type.args.length === 0) {
        return BUILTIN_TS_TYPE[type.definition.name];
      } else if (type.definition.name === "OneOf") {
        return [...new Set(type.args.map((a) => this.generateType(a)))].join(
          " | "
        );
      } else if (type.definition.name === "Nullable") {
        return `${this.generateType(type.args[0])} | null`;
      }
    }

    const typeArgs =
      type.args.length === 0
        ? ""
        : `<${type.args.map((a) => this.generateType(a)).join(", ")}>`;
    return `${type.definition.name}${typeArgs}`;
  }

  private wireTypeForType(type: DeepRealType): number {
    if (type.definition.kind == "builtin") {
      if (type.args.length === 0) {
        return BUILTIN_WIRE_TYPE[type.definition.name];
      }
    }

    return 2;
  }

  private serializerForType(type: DeepRealType, value: string): string[] {
    const idSafeVal = safeIdentifier(value);

    if (type.definition.kind == "builtin") {
      if (type.args.length === 0) {
        if (type.definition.name === "bool") {
          return [`writer.uint32(${value} ? 1 : 0);`];
        } else if (type.definition.name === "Date") {
          return [`writer.string(${value}.toISOString());`];
        } else {
          return [`writer.${type.definition.name}(${value});`];
        }
      } else if (type.definition.name === "OneOf") {
        return ["// TODO: I don't know how to implement this"];
      } else if (type.definition.name === "Array") {
        return [
          `writer.fork();`,
          `for (const ${idSafeVal}_item of ${value}) {`,
          ...this.serializerForType(type.args[0], `${idSafeVal}_item`).map(
            (s) => `  ${s}`
          ),
          "}",
          "writer.ldelim();",
        ];
      } else if (type.definition.name === "Nullable") {
        return [
          `writer.fork();`,
          `writer.uint32(${value} === null ? 0 : 1);`,
          `if (${value} !== null) {`,
          ...this.serializerForType(type.args[0], `${value}`).map(
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
      const enumDef = this.analyzer.findTypeDefinition(
        "enum",
        type.definition.package as UserPackageIdentifier,
        type.definition.name
      );
      if (!enumDef) {
        this.logger.error(
          `Generation failed due to missing definition for enum ${type.definition.name}. This is a bug.`
        );
        process.exit(1);
      }
      if (enumDef.valueType === "string") {
        return [`writer.string(${value});`];
      } else {
        return [`writer.uint32(${value} as number);`];
      }
    } else if (type.definition.kind === "message") {
      if (type.args.length > 0) {
        return [
          `${type.definition.name}["serialize<${type.args
            .map((a) => this.generateType(a))
            .join(", ")}>"](writer, ${value});`,
        ];
      } else {
        return [`${type.definition.name}.serialize(writer, ${value});`];
      }
    }

    return [];
  }

  private deserializerForType(
    type: DeepRealType,
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
      } else if (type.definition.name === "OneOf") {
        return ["// TODO: I don't know how to implement this"];
      } else if (type.definition.name === "Array") {
        return [
          `${value} = [];`,
          `let ${idSafeVal}_i = 0;`,
          `const ${idSafeVal}_end = reader.pos + reader.uint32();`,
          `while (reader.pos < ${idSafeVal}_end) {`,
          ...this.deserializerForType(
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
          ...this.deserializerForType(type.args[0], `${value}`),
          "}",
        ];
      } else {
        this.logger.error(
          `Generation failed due to missing implementation for type ${type.definition.name}`
        );
        process.exit(1);
      }
    } else if (type.definition.kind === "enum") {
      const enumDef = this.analyzer.findTypeDefinition(
        "enum",
        type.definition.package as UserPackageIdentifier,
        type.definition.name
      );
      if (!enumDef) {
        this.logger.error(
          `Generation failed due to missing definition for enum ${type.definition.name}. This is a bug.`
        );
        process.exit(1);
      }
      if (enumDef.valueType === "string") {
        return [`${value} = reader.string();`];
      } else {
        return [
          `${value} = reader.uint32() as ${enumDef.typeDefinition.name};`,
        ];
      }
    } else if (type.definition.kind === "message") {
      if (type.args.length > 0) {
        return [
          `${value} = ${type.definition.name}["deserialize<${type.args
            .map((a) => this.generateType(a))
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
  return value.replaceAll("[", "_").replaceAll("]", "").replace(".", "_");
}