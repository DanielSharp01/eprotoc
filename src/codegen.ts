import {
  BUILTIN_PACKAGE,
  Definition,
  EnumDefinition,
  MessageDefinition,
  SemanticAnalyzer,
  ServiceDefinition,
  Type,
} from "./analyzer";
import { swapDirectory, swapExtension, writeSourceFile } from "./fs-utils";
import { Logger } from "./logger";

const BUILTIN_MAP = {
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
} as Record<string, string>;

export class TSCodeGenerator {
  constructor(private logger: Logger) {}

  generate(rootDir: string, outputDir: string, analyzer: SemanticAnalyzer) {
    const defs = analyzer.getFileDefinitions();
    for (const file of Object.keys(defs)) {
      const source: string[] = [];
      for (const def of defs[file]) {
        source.push(this.generateDefinition(def));
      }
      writeSourceFile(
        swapExtension(swapDirectory(rootDir, outputDir, file), ".ts"),
        source.filter((f) => !!f).join("\n\n") + "\n"
      );
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

    return [
      `export interface ${definition.typeDefinition.name}${typeArgs} {`,
      ...definition.fields.map(
        (f) =>
          `  ${f.name}${f.optional ? "?" : ""}: ${this.generateType(f.type)};`
      ),
      "}",
    ].join("\n");
  }

  private generateServiceDefinition(definition: ServiceDefinition): string {
    return `// TODO: service ${definition.name}`;
  }

  private generateType(type: Type): string {
    if (type.kind === "generic") {
      return type.name;
    }

    if (type.definition.package == BUILTIN_PACKAGE) {
      if (type.args.length === 0) {
        return BUILTIN_MAP[type.definition.name];
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
}

/*
interface GenericMessage<T> {
  value: T;
}

const TestServiceDefinition = {
  test: {
    path: "test",
    requestStream: false,
    responseStream: false,
    requestSerialize(value: GenericMessage<number>) {
      return GenericMessage.serialize(value);
    },
    requestDeserialize(bytes: Uint8Array): GenericMessage<number> {
      return GenericMessage.deserialize<number>(bytes);
    },
    options: {}
  },
};

const GenericMessage = {
  serialize<T>(message: GenericMessage<T>): Uint8Array {
    const buffer = new Uint8Array();
    return buffer;
  },
  deserialize<T>(bytes: Uint8Array): GenericMessage<T> {
    return {} as GenericMessage<T>;
  },
};
*/
