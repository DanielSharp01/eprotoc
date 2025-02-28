import path from "path";
import {
  Definition,
  EnumDefinition,
  MessageDefinition,
  realizeMessageDefinition,
  MessageDefinitionInstance,
  ServiceDefinition,
  StringEnumDefinition,
  DeepRealTypeInstance,
  KnownTypeInstance,
} from "../analyzer";
import {
  addDotSlash,
  swapDirectory,
  swapExtension,
  writeSourceFile,
} from "../utils/fs-utils";
import { CodeGenContext } from "./context";
import { generateType } from "./type";
import { fieldNode, structNode, unwrapLen } from "./nodes";
import { typeToGenNode } from "./type-node";
import { deserializeGenNode } from "./deserialize-ast";
import { serializeGenNode } from "./serialize-ast";
import { generateAnyDefinition } from "./builtin";

export function generateTsProto(
  rootDir: string,
  outputDir: string,
  definitions: Definition[],
  strategy: "native" | "evolved"
) {
  const builtinFile = path.join(rootDir, "builtin.eproto");
  for (const file of [
    ...new Set([...definitions.map((d) => d.astNode.file), builtinFile]),
  ]) {
    const defs = definitions.filter((d) => d.astNode.file === file);

    const source: string[] = [
      "/* eslint-disable */",
      'import _m0 from "protobufjs/minimal";',
    ];

    if (file === builtinFile) {
      source.push(generateAnyDefinition());
    } else {
      const context: CodeGenContext = {
        strategy,
        currentFile: file,
        currentPackage: defs[0].packageId as string,
        typeImports: new Map(),
      };

      for (const def of defs) {
        source.push(generateDefinition(context, def));
      }

      source.splice(
        2,
        0,
        ...[...context.typeImports.entries()].map(
          ([importFile, types]) =>
            `import { ${[
              ...types.entries().map(([alias, type]) => `${type} as ${alias}`),
            ].join(", ")} } from '${swapExtension(
              addDotSlash(
                path.relative(
                  path.dirname(file),
                  addDotSlash(importFile).startsWith(rootDir)
                    ? importFile
                    : path.join(rootDir, importFile)
                )
              ),
              ""
            )}';`
        )
      );
    }

    const newFile = swapExtension(
      swapDirectory(rootDir, outputDir, file),
      ".ts"
    );
    writeSourceFile(newFile, source.filter((f) => !!f).join("\n\n") + "\n");
    console.info(`Generated ${newFile}`);
  }
}

function generateDefinition(
  context: CodeGenContext,
  definition: Definition
): string {
  if (definition.kind === "enum") {
    return generateEnumDefinition(definition);
  } else if (definition.kind === "string-enum") {
    return generateStringEnumDefinition(definition);
  } else if (definition.kind === "message") {
    return generateMessageDefinition(context, definition);
  } else if (definition.kind === "service") {
    return generateServiceDefinition(context, definition);
  }

  return "";
}

function generateEnumDefinition(definition: EnumDefinition): string {
  return [
    `export enum ${definition.name} {`,
    ...definition.fields.map((f) => `  ${f.name} = ${f.value},`),
    "}",
  ].join("\n");
}

function generateStringEnumDefinition(
  definition: StringEnumDefinition
): string {
  return (
    [
      `export type ${definition.name} =`,
      ...definition.fields.map((f) => `"${f}"`),
    ].join("\n | ") + ";"
  );
}

function generateMessageDefinition(
  context: CodeGenContext,
  definition: MessageDefinition
): string {
  const typeArgs =
    definition.args.length === 0
      ? ""
      : `<${definition.args.map((a) => generateType(context, a)).join(", ")}>`;

  const interfaceSource = [
    `export interface ${definition.name}${typeArgs} {`,
    ...definition.fields.map(
      (f) =>
        `  ${f.name}${f.optional ? "?" : ""}: ${generateType(
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
    ...realDefinitions
      .flatMap((def) => generateMessageObjectMethods(context, def))
      .map((s) => `  ${s}`),
    "}",
  ].join("\n");

  return [interfaceSource, objectSource].join("\n\n");
}

function generateMessageObjectMethods(
  context: CodeGenContext,
  definition: MessageDefinitionInstance
) {
  const typeArgsForValue =
    definition.args.length === 0
      ? ""
      : `<${definition.args.map((a) => generateType(context, a)).join(", ")}>`;
  const serializeKey =
    definition.args.length === 0
      ? "serialize"
      : `"serialize${typeArgsForValue}"`;
  const deserializeKey =
    definition.args.length === 0
      ? "deserialize"
      : `"deserialize${typeArgsForValue}"`;

  const genNode = unwrapLen(
    structNode(
      () => [],
      ...definition.fields.map((f) =>
        fieldNode(
          f.ordinal,
          (value) => `${value}.${f.name}`,
          typeToGenNode(context, f.type),
          f.optional ? (field) => `${field} !== undefined` : undefined
        )
      )
    )
  );

  return [
    `${serializeKey}(writer: _m0.Writer, value: ${definition.name}${typeArgsForValue}) {`,
    ...serializeGenNode(genNode, "value").map((s) => `  ${s}`),
    "},",
    `${deserializeKey}(reader: _m0.Reader, end: number): ${definition.name}${typeArgsForValue} {`,
    "  let value: any = {};",
    "",
    ...deserializeGenNode(genNode, "value").map((s) => `  ${s}`),
    "",
    "  return value;",
    "},",
  ];
}

function generateServiceDefinition(
  context: CodeGenContext,
  definition: ServiceDefinition
): string {
  return [
    `export type ${definition.name}Definition = typeof ${definition.name}Definition;`,
    `export const ${definition.name}Definition = {`,
    ...definition.rpcs.map((r) =>
      generateRPCDefinition(context, definition.name, r)
    ),
    "} as const;",
  ].join("\n");
}

function generateRPCDefinition(
  context: CodeGenContext,
  serviceName: string,
  definition: ServiceDefinition["rpcs"][number]
): string {
  let requestGenNode = unwrapLen(
    typeToGenNode(context, definition.request.type as DeepRealTypeInstance).node
  );
  let responseGenNode = unwrapLen(
    typeToGenNode(context, definition.response.type as DeepRealTypeInstance)
      .node
  );

  return [
    `  ${definition.path}: {`,
    `    path: "/${serviceName}/${definition.path}",`,
    `    requestStream: ${definition.request.stream ? "true" : "false"},`,
    `    responseStream: ${definition.response.stream ? "true" : "false"},`,
    `    requestSerialize(value: ${generateType(
      context,
      definition.request.type as KnownTypeInstance
    )}): Uint8Array {`,
    definition.request.type.kind === "real" &&
    definition.request.type.definition.name !== "void"
      ? [
          "      const writer = _m0.Writer.create();",
          serializeGenNode(requestGenNode, "value")
            .map((s) => `      ${s}`)
            .join("\n"),
          "      return writer.finish();",
        ].join("\n")
      : "      return new Uint8Array();",
    `    },`,
    `    requestDeserialize(bytes: Uint8Array): ${generateType(
      context,
      definition.request.type as KnownTypeInstance
    )} {`,
    definition.request.type.kind === "real" &&
    definition.request.type.definition.name !== "void"
      ? [
          "      const reader = _m0.Reader.create(bytes);",
          "      let value: any;",
          "      const end = reader.len;",
          deserializeGenNode(requestGenNode, "value")
            .map((s) => `      ${s}`)
            .join("\n"),
          "      return value;",
        ].join("\n")
      : ["      // Due to void return type", "      return {} as any;"].join(
          "\n"
        ),
    `    },`,
    `    responseSerialize(value: ${generateType(
      context,
      definition.response.type as DeepRealTypeInstance
    )}): Uint8Array {`,
    definition.response.type.kind === "real" &&
    definition.response.type.definition.name !== "void"
      ? [
          "      const writer = _m0.Writer.create();",
          serializeGenNode(responseGenNode, "value")
            .map((s) => `      ${s}`)
            .join("\n"),
          "      return writer.finish();",
        ].join("\n")
      : "      return new Uint8Array();",
    `    },`,
    `    responseDeserialize(bytes: Uint8Array): ${generateType(
      context,
      definition.response.type as DeepRealTypeInstance
    )} {`,
    definition.response.type.kind === "real" &&
    definition.response.type.definition.name !== "void"
      ? [
          "      const reader = _m0.Reader.create(bytes);",
          "      let value: any;",
          "      const end = reader.len;",
          deserializeGenNode(responseGenNode, "value")
            .map((s) => `      ${s}`)
            .join("\n"),
          "      return value;",
        ].join("\n")
      : ["      // Due to void return type", "      return {} as any;"].join(
          "\n"
        ),
    `    },`,
    "    options: {},",
    `  },`,
  ].join("\n");
}
