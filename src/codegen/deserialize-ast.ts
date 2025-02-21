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

export function deserializePrimitiveGenNode(
  genNode: PrimitiveGenNode,
  value: string
): string[] {
  return genNode.reader(value);
}

export function deserializeArrayGenNode(
  genNode: ArrayGenNode,
  value: string
): string[] {
  const idSafeVal = safeIdentifier(value);
  const source = [];
  source.push(`${value} = [];`);
  source.push(`let ${idSafeVal}_i = 0;`);
  source.push("while (reader.pos < end) {");
  source.push(
    ...deserializeGenNode(genNode.sub, `${value}[${idSafeVal}_i]`).map(
      (s) => `  ${s}`
    )
  );
  source.push(`  ${idSafeVal}_i++;`);
  source.push("}");
  return source;
}

export function deserializeLenNode(
  genNode: LenGenNode,
  value: string
): string[] {
  const source = [];
  source.push("const end = reader.uint32() + reader.pos;");
  source.push(...deserializeGenNode(genNode.sub, value));
  return source;
}

export function deserializeNullable(
  genNode: NullableGenNode,
  value: string
): string[] {
  const source = [];
  source.push(`if (reader.uint32() === 0) {`);
  source.push(`  ${value} = null;`);
  source.push("} else {");
  source.push(...deserializeGenNode(genNode.sub, value).map((s) => `  ${s}`));
  source.push("}");
  return source;
}

export function deserializeStructGenNode(
  genNode: StructGenNode,
  value: string
): string[] {
  const source = [];
  source.push(...genNode.initializeValue(value));
  source.push("while (reader.pos < end) {");
  source.push("  const tag = reader.uint32();");
  if (genNode.fields.length === 0) {
    source.push("  reader.skipType(tag & 7);");
  } else {
    source.push("  const idx = tag >>> 3;");
    for (let i = 0; i < genNode.fields.length; i++) {
      source.push(
        ...deserializeFieldGenNode(genNode.fields[i], value).map(
          (s, idx) => `  ${i > 0 && idx === 0 ? "} else " : ""}${s}`
        )
      );
    }
    source.push(`  } else {`);
    source.push("    reader.skipType(tag & 7);");
    source.push("  }");
  }
  source.push("}");
  return source;
}

export function deserializeFieldGenNode(
  genNode: FieldGenNode,
  value: string
): string[] {
  const source = [];
  source.push(`if (idx === ${genNode.ordinal}) {`);
  source.push(
    ...deserializeGenNode(genNode.node, genNode.field(value)).map(
      (s) => `  ${s}`
    )
  );
  return source;
}

export function deserializeSwitchGenNode(
  genNode: SwitchGenNode,
  value: string
): string[] {
  return deserializeStructGenNode(
    {
      type: "struct",
      initializeValue: () => [],
      fields: genNode.conditions.map((c) => c.node),
    },
    value
  );
}

export function deserializeMapValueGenNode(
  genNode: MapValueGenNode,
  value: string
): string[] {
  const source = deserializeGenNode(genNode.node, value);
  if (genNode.mapDeserialize) {
    source.push(`${value} = ${genNode.mapDeserialize(value)};`);
  }
  return source;
}

export function deserializeGenNode(genNode: GenNode, value: string) {
  if (genNode.type === "primitive") {
    return deserializePrimitiveGenNode(genNode, value);
  } else if (genNode.type === "array") {
    return deserializeArrayGenNode(genNode, value);
  } else if (genNode.type === "len") {
    return deserializeLenNode(genNode, value);
  } else if (genNode.type === "nullable") {
    return deserializeNullable(genNode, value);
  } else if (genNode.type === "struct") {
    return deserializeStructGenNode(genNode, value);
  } else if (genNode.type === "field") {
    return deserializeFieldGenNode(genNode, value);
  } else if (genNode.type === "switch") {
    return deserializeSwitchGenNode(genNode, value);
  } else if (genNode.type === "map-value") {
    return deserializeMapValueGenNode(genNode, value);
  } else {
    throw new Error("Unreachable");
  }
}
