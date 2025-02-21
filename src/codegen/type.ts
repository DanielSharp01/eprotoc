import { KnownTypeInstance } from "../analyzer";
import { addTypeToImports, CodeGenContext, fqTypeName } from "./context";

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
  any: "any",
} as Record<string, string>;

export function generateType(
  context: CodeGenContext,
  type: KnownTypeInstance
): string {
  if (type.kind === "generic") {
    return type.name;
  }

  const typeArgs =
    type.args.length === 0
      ? ""
      : `<${type.args.map((a) => generateType(context, a)).join(", ")}>`;

  if (type.definition.kind === "builtin") {
    if (type.args.length === 0) {
      return BUILTIN_TS_TYPE[type.definition.name];
    } else if (type.definition.name === "Nullable") {
      return `${generateType(context, type.args[0])} | null`;
    } else {
      return `${type.definition.name}${typeArgs}`;
    }
  }

  addTypeToImports(context, type.definition);
  return `${fqTypeName(context, type.definition)}${typeArgs}`;
}
