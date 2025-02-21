import { deserializeGenNode } from "./deserialize-ast";
import {
  switchNode,
  fieldNode,
  NULL_NODE,
  primitiveNode,
  BOOL_NODE,
  arrayNode,
  mapNode,
  subMessageNode,
  mapValueNode,
} from "./nodes";
import { serializeGenNode } from "./serialize-ast";

export function generateAnyDefinition() {
  const source: string[] = [];

  const genNode = switchNode(
    {
      value: (value) => `${value} === null`,
      node: fieldNode(1, (value) => value, {
        wireType: 0,
        node: NULL_NODE,
      }),
    },
    {
      value: (value) => `typeof(${value}) === "number"`,
      node: fieldNode(2, (value) => value, {
        wireType: 1,
        node: primitiveNode("double"),
      }),
    },
    {
      value: (value) => `typeof(${value}) === "string"`,
      node: fieldNode(3, (value) => value, {
        wireType: 2,
        node: primitiveNode("string"),
      }),
    },
    {
      value: (value) => `typeof(${value}) === "boolean"`,
      node: fieldNode(4, (value) => value, {
        wireType: 0,
        node: BOOL_NODE,
      }),
    },
    {
      value: (value) => `Array.isArray(${value})`,
      node: fieldNode(6, (value) => value, {
        wireType: 2,
        node: arrayNode(subMessageNode("Any", "")),
      }),
    },
    {
      value: (value) => `typeof(${value}) === "object"`,
      node: fieldNode(5, (value) => value, {
        wireType: 2,
        node: mapValueNode((value) => `Object.entries(${value})`, undefined, {
          ...mapNode(
            { node: primitiveNode("string"), wireType: 2 },
            { node: subMessageNode("Any", ""), wireType: 2 }
          ),
          mapDeserialize: (value) => `Object.fromEntries(${value})`,
        }),
      }),
    }
  );

  source.push("export const Any = {");
  source.push("  serialize(writer: _m0.Writer, value: any): void {");
  source.push(...serializeGenNode(genNode, "value").map((s) => `    ${s}`));
  source.push("  },");
  source.push("");
  source.push("  deserialize(reader: _m0.Reader, end: number): any {");
  source.push("    let value: any;");
  source.push(...deserializeGenNode(genNode, "value").map((s) => `    ${s}`));
  source.push("    return value;");
  source.push("  }");
  source.push("}");

  return source.join("\n");
}
