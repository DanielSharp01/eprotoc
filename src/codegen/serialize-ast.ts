import {
  PrimitiveGenNode,
  ArrayGenNode,
  LenGenNode,
  NullableGenNode,
  StructGenNode,
  FieldGenNode,
  SwitchGenNode,
  MapValueGenNode,
  GenNode,
} from "./gen-ast";
import { safeIdentifier } from "./utils";

export function serializePrimitiveGenNode(
  genNode: PrimitiveGenNode,
  value: string
): string[] {
  return genNode.writer(value);
}

export function serializeArrayGenNode(
  genNode: ArrayGenNode,
  value: string
): string[] {
  const idSafeVal = safeIdentifier(value);
  const source = [];
  source.push(`for (const ${idSafeVal}_item of ${value}) {`);
  source.push(
    ...serializeGenNode(genNode.sub, `${idSafeVal}_item`).map((s) => `  ${s}`)
  );
  source.push("}");
  return source;
}

export function serializeLenNode(genNode: LenGenNode, value: string): string[] {
  const source = [];
  source.push(`writer.fork();`),
    source.push(...serializeGenNode(genNode.sub, value));
  source.push("writer.ldelim();");
  return source;
}

export function serializeNullable(
  genNode: NullableGenNode,
  value: string
): string[] {
  const source = [];
  source.push(`writer.uint32(${value} === null ? 0 : 1);`),
    source.push(`if (${value} !== null) {`),
    source.push(...serializeGenNode(genNode.sub, value).map((s) => `  ${s}`)),
    source.push("}");
  return source;
}

export function serializeStructGenNode(
  genNode: StructGenNode,
  value: string
): string[] {
  const source = [];
  for (const node of genNode.fields) {
    source.push(...serializeGenNode(node, value));
  }
  return source;
}

export function serializeFieldGenNode(
  genNode: FieldGenNode,
  value: string
): string[] {
  const source = [];
  const optionalIndent = genNode.condition ? "  " : "";
  if (genNode.condition) {
    source.push(`if (${genNode.condition(genNode.field(value))}) {`);
  }
  source.push(
    `${optionalIndent}writer.uint32(${(genNode.ordinal << 3) + genNode.wireType});`
  );
  source.push(
    ...serializeGenNode(genNode.node, genNode.field(value)).map(
      (s) => `${optionalIndent}${s}`
    )
  );
  if (genNode.condition) {
    source.push(`}`);
  }
  return source;
}

export function serializeSwitchGenNode(
  genNode: SwitchGenNode,
  value: string
): string[] {
  const source: string[] = [];
  if (genNode.conditions.length === 0) {
    return source;
  }

  source.push(`if (${genNode.conditions[0].value(value)}) {`);
  source.push(
    ...serializeGenNode(genNode.conditions[0].node, value).map((s) => `  ${s}`)
  );
  source.push("}");
  for (const condition of genNode.conditions.slice(1)) {
    source.push(`else if (${condition.value(value)}) {`);
    source.push(
      ...serializeGenNode(condition.node, value).map((s) => `  ${s}`)
    );
    source.push("}");
  }

  return source;
}

export function serializeMapValueGenNode(
  genNode: MapValueGenNode,
  value: string
): string[] {
  const source = serializeGenNode(
    genNode.node,
    genNode.mapSerialize ? `${value}_` : value
  );
  if (genNode.mapSerialize) {
    source.unshift(`let ${value}_: any = ${genNode.mapSerialize(value)};`);
  }
  return source;
}

export function serializeGenNode(genNode: GenNode, value: string) {
  if (genNode.type === "primitive") {
    return serializePrimitiveGenNode(genNode, value);
  } else if (genNode.type === "array") {
    return serializeArrayGenNode(genNode, value);
  } else if (genNode.type === "len") {
    return serializeLenNode(genNode, value);
  } else if (genNode.type === "nullable") {
    return serializeNullable(genNode, value);
  } else if (genNode.type === "struct") {
    return serializeStructGenNode(genNode, value);
  } else if (genNode.type === "field") {
    return serializeFieldGenNode(genNode, value);
  } else if (genNode.type === "switch") {
    return serializeSwitchGenNode(genNode, value);
  } else if (genNode.type === "map-value") {
    return serializeMapValueGenNode(genNode, value);
  } else {
    throw new Error("Unreachable");
  }
}
