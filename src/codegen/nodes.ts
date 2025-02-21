import {
  FieldGenNode,
  GenNode,
  LenGenNode,
  MapValueGenNode,
  NullableGenNode,
  PrimitiveGenNode,
  SwitchCondition,
  SwitchGenNode,
} from "./gen-ast";

export const NULL_NODE: PrimitiveGenNode = {
  type: "primitive",
  writer: () => ["writer.uint32(0);"],
  reader: (value) => [`${value} = null;`],
};

export const DATE_NODE: PrimitiveGenNode = {
  type: "primitive",
  writer: (value) => [`writer.string(${value}.toISOString());`],
  reader: (value) => [`${value} = new Date(reader.string());`],
};

export const BOOL_NODE: PrimitiveGenNode = {
  type: "primitive",
  writer: (value) => [`writer.uint32(${value ? 1 : 0});`],
  reader: (value) => [`${value} = !!reader.uint32();`],
};

export const primitiveNode = (type: string): PrimitiveGenNode => ({
  type: "primitive",
  writer: (value) => [`writer.${type}(${value});`],
  reader: (value) => [`${value} = reader.${type}();`],
});

export const nullableNode = (sub: GenNode): NullableGenNode => ({
  type: "nullable",
  sub,
});

export const lenNode = (sub: GenNode): LenGenNode => ({
  type: "len",
  sub,
});

export const arrayNode = (sub: GenNode): LenGenNode =>
  lenNode({
    type: "array",
    sub,
  });

export const fieldNode = (
  ordinal: number,
  field: (value: string) => string,
  { wireType, node }: { wireType: number; node: GenNode },
  condition?: (field: string) => string
): FieldGenNode => ({
  type: "field",
  node,
  ordinal,
  wireType,
  field,
  condition,
});

export const structNode = (
  initializeValue: (value: string) => string[],
  ...fields: FieldGenNode[]
): LenGenNode =>
  lenNode({
    type: "struct",
    initializeValue,
    fields,
  });

export const switchNode = (
  ...conditions: SwitchCondition[]
): SwitchGenNode => ({
  type: "switch",
  conditions,
});

export const mapValueNode = (
  mapSerialize: ((value: string) => string) | undefined,
  mapDeserialize: ((value: string) => string) | undefined,
  node: GenNode
): MapValueGenNode => ({
  type: "map-value",
  node,
  mapSerialize,
  mapDeserialize,
});

export const subMessageNode = (messageName: string, generics: string) =>
  lenNode({
    type: "primitive",
    writer: (value) => [
      `${messageName}[${generics ? `"serialize<${generics}>"` : `"serialize"`}](writer, ${value});`,
    ],
    reader: (value) => [
      `${value} = ${messageName}[${generics ? `"deserialize<${generics}>"` : `"deserialize"`}](reader, end);`,
    ],
  });

export const mapNode = (
  key: { node: GenNode; wireType: number },
  value: { node: GenNode; wireType: number }
) =>
  mapValueNode(
    undefined,
    (value) => `new Map(${value})`,
    arrayNode(
      structNode(
        (value) => [`${value} = [];`],
        fieldNode(1, (value) => `${value}[0]`, key),
        fieldNode(2, (value) => `${value}[1]`, value)
      )
    )
  );

export function unwrapLen(genNode: GenNode): GenNode {
  if (genNode.type === "len") {
    return unwrapLen(genNode.sub);
  } else if (genNode.type === "map-value") {
    return {
      ...genNode,
      node: unwrapLen(genNode.node),
    };
  } else {
    return genNode;
  }
}
