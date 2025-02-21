export function safeIdentifier(value: string) {
  return value.replaceAll("[", "_").replaceAll("]", "").replaceAll(".", "_");
}