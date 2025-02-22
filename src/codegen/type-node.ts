import { DeepRealTypeInstance } from "../analyzer";
import {
  arrayNode,
  BOOL_NODE,
  DATE_NODE,
  fieldNode,
  lenNode,
  mapNode,
  mapValueNode,
  nullableNode,
  primitiveNode,
  structNode,
  subMessageNode,
} from "./nodes";
import {
  addBuiltinImport,
  CodeGenContext,
  fqBuiltinName,
  fqTypeName,
} from "./context";
import { GenNode } from "./gen-ast";
import { generateType } from "./type";

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

export function typeToGenNode(
  context: CodeGenContext,
  type: DeepRealTypeInstance
): { node: GenNode; wireType: number } {
  if (type.definition.kind === "builtin") {
    if (type.args.length === 0) {
      if (type.definition.name === "bool") {
        return { node: BOOL_NODE, wireType: 0 };
      } else if (type.definition.name === "Date") {
        return { node: DATE_NODE, wireType: 2 };
      } else if (type.definition.name === "any") {
        addBuiltinImport(context, "Any");
        return { node: subMessageNode(fqBuiltinName("Any"), ""), wireType: 2 };
      } else {
        return {
          node: primitiveNode(type.definition.name),
          wireType: BUILTIN_WIRE_TYPE[type.definition.name],
        };
      }
    } else if (type.definition.name === "Array") {
      const sub = typeToGenNode(context, type.args[0]).node;
      if (sub.type === "array" && context.strategy === "native") {
        return {
          node: arrayNode(
            structNode(
              () => [],
              fieldNode(1, (value) => value, {
                wireType: 2,
                node: arrayNode(sub),
              })
            )
          ),
          wireType: 2,
        };
      }
      return { node: arrayNode(sub), wireType: 2 };
    } else if (type.definition.name === "Map") {
      const key = typeToGenNode(context, type.args[0]);
      const value = typeToGenNode(context, type.args[1]);
      return { node: mapNode(key, value), wireType: 2 };
    } else if (type.definition.name === "Nullable") {
      const sub = typeToGenNode(context, type.args[0]);
      if (context.strategy === "native") {
        return {
          node: structNode(
            (value) => [`${value} = null;`],
            fieldNode(
              1,
              (value) => value,
              sub,
              (field) => `${field} !== null`
            )
          ),
          wireType: 2,
        };
      } else {
        return { node: nullableNode(sub.node), wireType: 2 };
      }
    } else {
      throw new Error(
        `Generation failed due to missing implementation for type ${type.definition.name}`
      );
    }
  } else if (type.definition.kind === "enum") {
    return {
      node: mapValueNode(
        (value) => `${value} as number`,
        undefined,
        primitiveNode("uint32")
      ),
      wireType: 0,
    };
  } else if (type.definition.kind === "string-enum") {
    return { node: primitiveNode("string"), wireType: 2 };
  } else if (type.definition.kind === "message") {
    return {
      node: subMessageNode(
        fqTypeName(context, type.definition),
        type.args.map((a) => generateType(context, a)).join(", ")
      ),
      wireType: 2,
    };
  } else {
    throw new Error("Unreachable");
  }
}
