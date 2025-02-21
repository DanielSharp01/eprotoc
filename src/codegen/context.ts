import {
  TypeDefinition,
  GenericType,
  BuiltinTypeDefinition,
} from "../analyzer";

export interface CodeGenContext {
  strategy: "native" | "evolved";
  currentFile: string;
  currentPackage: string;
  typeImports: Map<string, Map<string, string>>;
}

export function fqTypeName(
  context: CodeGenContext,
  type: Exclude<TypeDefinition, GenericType | BuiltinTypeDefinition>
) {
  return context.currentFile !== type.astNode.file
    ? `${type.packageId as string}__${type.name}`
    : type.name;
}

export function addTypeToImports(
  context: CodeGenContext,
  type: Exclude<TypeDefinition, GenericType | BuiltinTypeDefinition>
) {
  if (type.astNode.file && type.astNode.file !== context.currentFile) {
    const aliasMap = context.typeImports.get(type.astNode.file) ?? new Map();
    aliasMap.set(fqTypeName(context, type), type.name);
    context.typeImports.set(type.astNode.file, aliasMap);
  }
}

export function fqBuiltinName(name: string) {
  return `Builtin__${name}`;
}

export function addBuiltinImport(context: CodeGenContext, name: string) {
  const aliasMap = context.typeImports.get("builtin.eproto") ?? new Map();
  aliasMap.set(fqBuiltinName(name), name);
  context.typeImports.set("builtin.eproto", aliasMap);
}
