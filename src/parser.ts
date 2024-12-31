import { afterToken, DiagnosticCollection } from "./diagnostic";
import { NumberToken, StringToken, Token } from "./tokenizer";

class Parser {
  private index: number = 0;
  constructor(
    private tokens: Token[],
    private diagnostics: DiagnosticCollection
  ) {}

  step() {
    if (this.tokens[this.index].tokenType === "EOF") {
      this.diagnostics.logger.error(
        "Compiler crashed due to trying to step over EOF. This is a bug."
      );
      process.exit(1);
    }
    this.index++;
  }

  current() {
    return this.tokens[this.index];
  }

  parseTopLevel(): ASTNode | undefined {
    const current = this.current() as Exclude<Token, { tokenType: "EOF" }>;
    if (current.tokenType === "keyword" && current.value === "message") {
      return this.parseMessage();
    } else if (current.tokenType === "keyword" && current.value === "enum") {
      return this.parseEnum();
    } else if (
      current.tokenType === "identifier" &&
      current.value === "string"
    ) {
      return this.parseStringEnum();
    } else if (current.tokenType === "keyword" && current.value === "service") {
      return this.parseService();
    } else if (current.tokenType === "keyword" && current.value === "package") {
      return this.parsePackageDefinition();
    }

    this.diagnostics.error({
      token: current,
      message: `Unknown top level ${current.tokenType} "${current.value}"`,
    });
    this.step();
    return undefined;
  }

  expect<T extends "keyword" | "symbol" | "identifier">(
    tokenType: T,
    tokenValue: string
  ): Token | undefined {
    const current = this.current();
    if (current.tokenType === tokenType && current.value === tokenValue) {
      this.step();
      return current;
    }
    this.diagnostics.error({
      token: afterToken(current),
      message: `Expected "${tokenValue}"`,
    });
    return undefined;
  }

  expectIdentifier(): Token | undefined {
    const current = this.current();
    if (current.tokenType === "identifier") {
      this.step();
      return current;
    }
    this.diagnostics.error({
      token: afterToken(current),
      message: `Expected identifier"`,
    });
    return undefined;
  }

  expectNumericLiteral(): NumberToken | undefined {
    const current = this.current();
    if (current.tokenType === "numeric-literal") {
      this.step();
      return current;
    }
    this.diagnostics.error({
      token: afterToken(current),
      message: `Expected number"`,
    });
    return undefined;
  }

  expectStringLiteral(): StringToken | undefined {
    const current = this.current();
    if (current.tokenType === "string-literal") {
      this.step();
      return current;
    }
    this.diagnostics.error({
      token: afterToken(current),
      message: `Expected string"`,
    });
    return undefined;
  }

  currentIs<T extends "keyword" | "symbol">(
    tokenType: T,
    tokenValue: string
  ): boolean {
    const current = this.current();
    return current.tokenType === tokenType && current.value === tokenValue;
  }

  parseComplexIdentifier(): IdentifierNode {
    const tokens: Token[] = [];
    const name = this.expectIdentifier();
    if (!name) {
      return identifierNode({ tokens });
    }
    tokens.push(name);
    while (this.currentIs("symbol", ".")) {
      tokens.push(this.current());
      this.step();
      const name = this.expectIdentifier();
      if (!name) {
        return identifierNode({ tokens, isComplete: false });
      }
      tokens.push(name);
    }

    return identifierNode({ tokens });
  }

  parsePackageDefinition(): PackageNode {
    const node: Partial<PackageNode> = {};
    node.keyword = this.expect("keyword", "package");
    node.identifier = this.parseComplexIdentifier();
    if (!node.identifier) {
      return packageNode(node);
    }
    this.expect("symbol", ";");

    return packageNode(node);
  }

  parseEnum(): EnumNode {
    const node: Partial<EnumNode> = {};
    node.keyword = this.expect("keyword", "enum");
    node.name = this.expectIdentifier();
    node.fields = [];
    if (!node.name) {
      return enumNode(node);
    }
    if (!this.expect("symbol", "{")) {
      return enumNode(node);
    }
    while (!this.currentIs("symbol", "}")) {
      const tokenBefore = this.index;
      node.fields.push(this.parseEnumField());
      if (this.index === tokenBefore) {
        this.step();
      }
    }

    this.expect("symbol", "}");
    return enumNode(node);
  }

  parseStringEnum(): StringEnumNode {
    const node: Partial<StringEnumNode> = {};
    node.stringKeyword = this.expect("identifier", "string");
    node.enumKeyword = this.expect("keyword", "enum");
    node.name = this.expectIdentifier();
    node.fields = [];
    if (!node.name) {
      return stringEnumNode(node);
    }
    if (!this.expect("symbol", "{")) {
      return stringEnumNode(node);
    }
    while (!this.currentIs("symbol", "}")) {
      const tokenBefore = this.index;
      const literal = this.expectStringLiteral();
      if (literal) {
        node.fields.push(literal as StringToken);
      } else if (!this.currentIs("symbol", ",")) {
        this.step();
      }

      // This is to skip the last , and allow } instead
      if (this.currentIs("symbol", "}")) break;

      this.expect("symbol", ",");
    }

    this.expect("symbol", "}");
    return stringEnumNode(node);
  }

  parseEnumField(): EnumFieldNode {
    const node: Partial<EnumFieldNode> = {};
    node.name = this.expectIdentifier();
    if (!node.name) {
      return enumFieldNode(node);
    }

    if (this.currentIs("symbol", "=")) {
      const value: Partial<EnumFieldNode["value"]> = {};
      value.equals = this.current();
      this.step();
      value.value = this.expectNumericLiteral();
      node.value = value as EnumFieldNode["value"];
      if (!value.value) {
        return enumFieldNode(node);
      }
    }

    if (this.currentIs("symbol", "}")) {
      return enumFieldNode(node);
    }

    this.expect("symbol", ",");
    return enumFieldNode(node);
  }

  parseType(): TypeNode {
    const node: Partial<TypeNode> = {};
    node.identifier = this.parseComplexIdentifier();
    node.args = [];
    if (!node.identifier.isComplete) {
      return typeNode(node);
    }

    if (!this.currentIs("symbol", "<")) {
      return typeNode(node);
    }

    do {
      this.step();
      node.args.push(this.parseType());
    } while (this.currentIs("symbol", ","));

    this.expect("symbol", ">");
    return typeNode(node);
  }

  parseMessage(): MessageNode {
    const node: Partial<MessageNode> = {};
    node.keyword = this.expect("keyword", "message");
    node.type = this.parseType();
    node.fields = [];

    if (!this.expect("symbol", "{")) {
      return messageNode(node);
    }
    while (!this.currentIs("symbol", "}")) {
      const tokenBefore = this.index;
      node.fields.push(this.parseMessageField());
      if (this.index === tokenBefore) {
        this.step();
      }
    }

    this.expect("symbol", "}");
    return messageNode(node);
  }

  parseMessageField(): MessageFieldNode {
    const node: Partial<MessageFieldNode> = {};
    if (this.currentIs("keyword", "optional")) {
      node.optional = this.current();
      this.step();
    }

    node.type = this.parseType();
    if (!node.type?.isComplete) {
      return messageFieldNode(node);
    }

    node.name = this.expectIdentifier();
    if (!node.name) {
      return messageFieldNode(node);
    }

    if (this.currentIs("symbol", "=")) {
      const ordinal: Partial<EnumFieldNode["value"]> = {};
      ordinal.equals = this.current();
      this.step();
      ordinal.value = this.expectNumericLiteral();
      if (!ordinal.value) {
        node.ordinal = ordinal as MessageFieldNode["ordinal"];
        return messageFieldNode(node);
      }
    }

    this.expect("symbol", ";");

    return messageFieldNode(node);
  }

  parseService(): ServiceNode {
    const node: Partial<ServiceNode> = {};
    node.keyword = this.expect("keyword", "service");
    node.name = this.expectIdentifier();
    if (!node.name) {
      return serviceNode(node);
    }
    node.rpcs = [];

    if (!this.expect("symbol", "{")) {
      return serviceNode(node);
    }
    while (!this.currentIs("symbol", "}")) {
      const tokenBefore = this.index;
      node.rpcs.push(this.parseRPC());
      if (this.index === tokenBefore) {
        this.step();
      }
    }
    this.expect("symbol", "}");
    return serviceNode(node);
  }

  parseRPC(): RPCNode {
    const node: Partial<RPCNode> = {};
    node.rpcKeyword = this.expect("keyword", "rpc");
    if (!node.rpcKeyword) {
      return rpcNode(node);
    }

    node.name = this.expectIdentifier();
    if (!node.name) {
      return rpcNode(node);
    }

    if (!this.expect("symbol", "(")) {
      return rpcNode(node);
    }
    if (this.currentIs("keyword", "stream")) {
      node.requestStream = this.current();
      this.step();
    }
    node.requestType = this.parseType();
    if (!node.requestType.isComplete) {
      return rpcNode(node);
    }
    if (!this.expect("symbol", ")")) {
      return rpcNode(node);
    }
    node.returnsKeyword = this.expect("keyword", "returns");
    if (!node.returnsKeyword) {
      return rpcNode(node);
    }
    if (!this.expect("symbol", "(")) {
      return rpcNode(node);
    }
    if (this.currentIs("keyword", "stream")) {
      node.responseStream = this.current();
      this.step();
    }
    node.responseType = this.parseType();
    if (!node.responseType.isComplete) {
      return rpcNode(node);
    }
    if (!this.expect("symbol", ")")) {
      return rpcNode(node);
    }

    this.expect("symbol", ";");
    return rpcNode(node);
  }
}

export function parse(
  tokens: Token[],
  diagnostics: DiagnosticCollection
): ASTNode[] {
  const parser = new Parser(
    tokens.filter((t) => t.tokenType !== "comment"),
    diagnostics
  );
  const nodes: ASTNode[] = [];
  while (parser.current().tokenType !== "EOF") {
    const parsed = parser.parseTopLevel();
    if (parsed) {
      nodes.push(parsed);
    }
  }

  return nodes;
}

export const ERROR_TOKEN = {
  tokenType: "unknown" as const,
  file: "",
  range: { start: { character: 0, line: 0 }, end: { character: 0, line: 0 } },
  value: "",
};

export type ASTNode =
  | MessageNode
  | ServiceNode
  | EnumNode
  | StringEnumNode
  | PackageNode
  | EOFNode;

export interface EOFNode {
  kind: "eof";
  token: Token;
}

export interface PackageNode {
  kind: "package";
  keyword: Token;
  identifier: IdentifierNode;
  isComplete: boolean;
}

export function packageNode(node: Partial<PackageNode>) {
  node.kind = "package";
  if (node.isComplete !== false) {
    node.isComplete = !!node.identifier?.isComplete;
  }
  return node as PackageNode;
}

export interface MessageNode {
  kind: "message";
  keyword: Token;
  type: TypeNode;
  fields: MessageFieldNode[];
  isComplete: boolean;
}

export function messageNode(node: Partial<MessageNode>) {
  node.kind = "message";
  node.type = node.type ?? typeNode({});
  node.fields = node.fields ?? [];
  if (node.isComplete !== false) {
    node.isComplete = node.type?.isComplete;
  }
  return node as MessageNode;
}

export interface MessageFieldNode {
  optional?: Token;
  type: TypeNode;
  name: Token;
  ordinal?: {
    equals: Token;
    value: Token;
  };
  isComplete: boolean;
}

export function messageFieldNode(node: Partial<MessageFieldNode>) {
  node.type = node.type ?? typeNode({});
  node.name = node.name ?? ERROR_TOKEN;
  if (node.ordinal) {
    node.ordinal.value = node.ordinal.value ?? ERROR_TOKEN;
  }
  if (node.isComplete !== false) {
    node.isComplete =
      node.type?.isComplete &&
      node.name!.tokenType !== "unknown" &&
      (!node.ordinal || node.ordinal.value.tokenType !== "unknown");
  }

  return node as MessageFieldNode;
}

export interface ServiceNode {
  kind: "service";
  keyword: Token;
  name: Token;
  rpcs: RPCNode[];
  isComplete: boolean;
}

export function serviceNode(node: Partial<ServiceNode>) {
  node.kind = "service";
  node.rpcs = node.rpcs ?? [];
  if (node.isComplete !== false) {
    node.isComplete = node.name && node.name.tokenType !== "unknown";
  }
  return node as ServiceNode;
}

export interface RPCNode {
  rpcKeyword: Token;
  name: Token;
  requestType: TypeNode;
  requestStream?: Token;
  returnsKeyword: Token;
  responseType: TypeNode;
  responseStream?: Token;
  isComplete: boolean;
}

export function rpcNode(node: Partial<RPCNode>) {
  node.name = node.name ?? ERROR_TOKEN;
  node.requestType = node.requestType ?? typeNode({});
  node.responseType = node.responseType ?? typeNode({});
  node.returnsKeyword = node.returnsKeyword ?? ERROR_TOKEN;
  if (node.isComplete !== false) {
    node.isComplete =
      node.name!.tokenType !== "unknown" &&
      node.requestType!.isComplete &&
      node.responseType!.isComplete;
  }
  return node as RPCNode;
}

export interface EnumNode {
  kind: "enum";
  keyword: Token;
  name: Token;
  fields: EnumFieldNode[];
  isComplete: boolean;
}

export function enumNode(node: Partial<EnumNode>) {
  node.kind = "enum";
  node.fields = node.fields ?? [];
  if (node.isComplete !== false) {
    node.isComplete = node.name && node.name.tokenType !== "unknown";
  }
  return node as EnumNode;
}

export interface EnumFieldNode {
  name: Token;
  value?: {
    equals: Token;
    value: Token;
  };
  isComplete: boolean;
}

export function enumFieldNode(node: Partial<EnumFieldNode>) {
  node.name = node.name ?? ERROR_TOKEN;
  if (node.value) {
    node.value.equals = node.value.equals ?? ERROR_TOKEN;
    node.value.value = node.value.value ?? ERROR_TOKEN;
  }
  if (node.isComplete !== false) {
    node.isComplete =
      node.name!.tokenType !== "unknown" &&
      (!node.value || node.value.value.tokenType !== "unknown");
  }

  return node as EnumFieldNode;
}

export interface StringEnumNode {
  kind: "string-enum";
  stringKeyword: Token;
  enumKeyword: Token;
  name: Token;
  fields: Token[];
  isComplete: boolean;
}

export function stringEnumNode(node: Partial<StringEnumNode>) {
  node.kind = "string-enum";
  node.enumKeyword = node.enumKeyword ?? ERROR_TOKEN;
  node.fields = node.fields ?? [];
  if (node.isComplete !== false) {
    node.isComplete = node.name && node.name.tokenType !== "unknown";
  }
  return node as StringEnumNode;
}

export interface TypeNode {
  identifier: IdentifierNode;
  args: TypeNode[];
  isComplete: boolean;
}

export function typeNode(node: Partial<TypeNode>) {
  node.identifier = node.identifier ?? identifierNode({});
  node.args = node.args ?? [];
  if (node.isComplete !== false) {
    node.isComplete =
      node.identifier?.isComplete &&
      (node.args.length === 0 || node.args?.every((g) => g.isComplete));
  }
  return node as TypeNode;
}

export interface IdentifierNode {
  tokens: Token[];
  isComplete: boolean;
}

export function identifierNode(node: Partial<IdentifierNode>) {
  node.tokens = node.tokens ?? [];
  if (node.isComplete !== false) {
    node.isComplete = !!node.tokens?.length;
  }
  return node as IdentifierNode;
}
