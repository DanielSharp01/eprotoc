import { Definition, MessageDefinition, TypeInstance } from "../analyzer";
import {
  swapDirectory,
  swapExtension,
  writeSourceFile,
} from "../utils/fs-utils";
import { groupByMultiple } from "../utils/group-by";

const typeToZodType = {
  int32: "z.number().int()",
  int64: "z.number().int()",
  uint32: "z.number().int()",
  uint64: "z.number().int()",
  float: "z.number()",
  double: "z.number()",
  sint32: "z.number().int()",
  sint64: "z.number().int()",
  fixed32: "z.number().int()",
  fixed64: "z.number().int()",
  sfixed32: "z.number().int()",
  sfixed64: "z.number().int()",
  bool: "z.boolean()",
  string: "z.string()",
  bytes: "z.string()",
  Date: "z.date()",
  any: "z.any()",
} as Record<string, string>;

export function generateZodFromMessageDefinitions(
  rootDir: string,
  outputDir: string,
  definitions: Definition[]
) {
  const fileDefinitionMap = groupByMultiple(
    definitions.filter((f) => f.kind === "message"),
    (x) => x.astNode.file
  );

  for (const [file, definitions] of fileDefinitionMap) {
    const newFile = swapExtension(
      swapDirectory(rootDir, outputDir, file),
      ".schema.ts"
    );
    const source = definitions.map((d) => messageDefinitionToZod(d));
    writeSourceFile(
      newFile,
      ['import { z } from "zod";', ...source.filter((f) => !!f)].join("\n\n") +
        "\n"
    );
  }
}

export function messageDefinitionToZod(messageDefinition: MessageDefinition) {
  const args = messageDefinition.args
    .map((a) => `${a.name.toLowerCase()} : ${a.name}`)
    .join(",");
  const typeArgs = messageDefinition.args.map((a) => a.name).join(",");
  const source = [];
  source.push(
    `export const ${schemaName(messageDefinition.name)} = ${args ? `<${typeArgs}>(${args}) => ` : ""}z.object({`
  );
  for (const field of messageDefinition.fields) {
    source.push(
      `  ${field.name}: ${typeToZod(field.type)}${field.optional ? ".optional()" : ""},`
    );
  }
  source.push("});");
  return source.join("\n");
}

export function typeToZod(type: TypeInstance): string {
  if (type.kind === "real") {
    if (type.definition.kind === "builtin") {
      if (type.definition.name === "Array") {
        return `${typeToZod(type.args[0])}.array()`;
      } else if (type.definition.name === "Map") {
        return `z.map(${typeToZod(type.args[0])}, ${typeToZod(type.args[1])})`;
      } else if (type.definition.name === "Nullable") {
        return `${typeToZod(type.args[0])}.nullable()`;
      } else {
        return typeToZodType[type.definition.name];
      }
    } else if (type.definition.kind === "message") {
      return schemaName(type.definition.name);
    } else if (type.definition.kind === "enum") {
      return `z.nativeEnum(${type.definition.name})`;
    } else if (type.definition.kind === "string-enum") {
      return `z.enum([${type.definition.fields.map((s) => `"${s}"`).join(", ")}])`;
    }
  }

  return "z.unknown()";
}

function toLowerFirst(str: string) {
  return str[0].toLocaleLowerCase() + str.slice(1);
}

function schemaName(name: string) {
  name = toLowerFirst(name);
  if (
    name.endsWith("Request") ||
    name.endsWith("Schema") ||
    name.endsWith("Response")
  ) {
    return name;
  }

  return `${name}Schema`;
}
