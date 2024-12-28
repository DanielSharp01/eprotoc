import { DiagnosticCollection } from "./diagnostic";

export interface Position {
  line: number;
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export interface DocumentItem {
  file: string;
  range: Range;
}

type TokenData =
  | {
      tokenType: "keyword";
      value: string;
    }
  | {
      tokenType: "symbol";
      value: string;
    }
  | {
      tokenType: "identifier" | "string-literal" | "comment" | "unknown";
      value: string;
    }
  | {
      tokenType: "numeric-literal";
      value: number;
    }
  | {
      tokenType: "EOF";
    };

export type TokenType = TokenData["tokenType"];

export type Token = DocumentItem & TokenData;
export type NumberToken = Token & { value: number };
export type StringToken = Token & { value: string };

export function identifierToken(value: string, at: DocumentItem) {
  return { tokenType: "identifier" as const, value, ...at };
}

export function stringLiteralToken(value: string, at: DocumentItem) {
  return { tokenType: "string-literal" as const, value, ...at };
}

export function numericLiteralToken(value: string, at: DocumentItem) {
  return { tokenType: "numeric-literal" as const, value: Number(value), ...at };
}

export function commentToken(value: string, at: DocumentItem) {
  return { tokenType: "comment" as const, value, ...at };
}

export function symbolToken(value: string, at: DocumentItem) {
  return { tokenType: "symbol" as const, value, ...at };
}

export function keywordToken(value: string, at: DocumentItem) {
  return { tokenType: "keyword" as const, value, ...at };
}

export function unknownToken(value: string, at: DocumentItem) {
  return { tokenType: "unknown" as const, value, ...at };
}

export function eofToken(at: DocumentItem) {
  return { tokenType: "EOF" as const, ...at };
}

const KEYWORDS = [
  "message",
  "enum",
  "service",
  "rpc",
  "stream",
  "returns",
  "optional",
  "package",
];

const SYMBOLS = ["<", ">", "(", ")", ";", "{", "}", "=", ",", "."];

class Tokenizer {
  private savedPosition: Position | undefined;
  private currInd: number = 0;
  private position: Position = { line: 0, character: 0 };

  constructor(private file: string, private source: string) {}

  public step(count: number = 1) {
    for (let i = 0; i < count; i++) {
      const codePoint = this.source.codePointAt(this.currInd);
      if (codePoint === "\n".codePointAt(0)) {
        this.position.line++;
        this.position.character = 0;
      } else {
        this.position.character += codePoint && codePoint > 0xffff ? 2 : 1;
      }
      this.currInd += codePoint && codePoint > 0xffff ? 2 : 1;
    }
  }

  public current(offset: number = 0) {
    let realOffset = 0;
    for (let i = 0; i < offset; i++) {
      const codePoint = this.source.codePointAt(this.currInd + realOffset);
      if (!codePoint) {
        return "\0";
      }
      realOffset += codePoint > 0xffff ? 2 : 1;
    }

    const codePoint = this.source.codePointAt(this.currInd + realOffset);
    if (!codePoint) {
      return "\0";
    }
    if (codePoint > 0xffff) {
      return this.source.slice(
        this.currInd + realOffset,
        this.currInd + realOffset + 2
      );
    } else {
      return this.source[this.currInd + realOffset];
    }
  }

  public saveAt() {
    this.savedPosition = { ...this.position };
  }

  public at(): DocumentItem {
    const savedPosition = this.savedPosition;
    this.savedPosition = undefined;
    return {
      file: this.file,
      range: {
        start: savedPosition ?? { ...this.position },
        end: { ...this.position },
      },
    };
  }

  skipWhitespace() {
    while (isWhitespace(this.current())) {
      this.step();
    }
  }

  takeUntilQuote() {
    let buffer: string = "";
    let escaping = false;
    while (this.current() !== "\0") {
      if (escaping) {
        escaping = false;
      } else if (this.current() === '"') {
        this.step();
        return buffer;
      } else if (this.current() === "\\") {
        escaping = true;
        continue;
      }

      buffer += this.current();
      this.step();
    }

    return buffer;
  }

  takeUntil(str: string) {
    let buffer: string = "";
    let matched = 0;
    while (this.current() !== "\0") {
      if (this.current() === str[matched]) {
        matched++;
      }
      buffer += this.current();
      this.step();
      if (matched === str.length) {
        return buffer.slice(0, -matched);
      }
    }

    return buffer;
  }

  takeWord() {
    let buffer: string = "";

    while (
      this.current() === "_" ||
      isLetter(this.current()) ||
      isDigit(this.current())
    ) {
      buffer += this.current();
      this.step();
    }

    return buffer;
  }

  takeNumber() {
    let buffer: string = "";

    while (isDigit(this.current())) {
      buffer += this.current();
      this.step();
    }

    return buffer;
  }
}

export function tokenize(
  file: string,
  source: string,
  diagnosticCollection: DiagnosticCollection
) {
  source = source.replaceAll("\r", "");
  const tokens: Token[] = [];

  const tokenizer = new Tokenizer(file, source);

  while (tokenizer.current() !== "\0") {
    tokenizer.skipWhitespace();
    if (tokenizer.current() === "\0") {
      break;
    }

    if (tokenizer.current() === '"') {
      tokenizer.saveAt();
      tokenizer.step();
      const value = tokenizer.takeUntilQuote();
      tokens.push(stringLiteralToken(value, tokenizer.at()));
      continue;
    } else if (isDigit(tokenizer.current())) {
      tokenizer.saveAt();
      const value = tokenizer.takeNumber();
      tokens.push(numericLiteralToken(value, tokenizer.at()));
      continue;
    } else if (tokenizer.current() === "_" || isLetter(tokenizer.current())) {
      tokenizer.saveAt();
      const value = tokenizer.takeWord();
      tokens.push(identifierToken(value, tokenizer.at()));
      continue;
    } else if (tokenizer.current() === "/") {
      if (tokenizer.current(1) === "/") {
        tokenizer.saveAt();
        tokenizer.step(2);
        const value = tokenizer.takeUntil("\n");
        tokens.push(commentToken(value, tokenizer.at()));
        continue;
      } else if (tokenizer.current(1) === "*") {
        tokenizer.saveAt();
        tokenizer.step(2);
        const value = tokenizer.takeUntil("*/");
        tokens.push(commentToken(value, tokenizer.at()));
        continue;
      }
    }

    tokens.push(unknownToken(tokenizer.current(), tokenizer.at()));
    tokenizer.step();
  }

  for (const token of tokens) {
    if (token.tokenType === "identifier" && KEYWORDS.includes(token.value)) {
      (token as Token).tokenType = "keyword";
    } else if (token.tokenType === "unknown") {
      if (SYMBOLS.includes(token.value)) {
        (token as Token).tokenType = "symbol";
      } else {
        diagnosticCollection.error({
          item: token,
          message: `Uknown symbol "${token.value}"`,
        });
      }
    }
  }

  tokens.push(eofToken(tokenizer.at()));
  return tokens;
}

function isLetter(char: string) {
  return (
    (char.charCodeAt(0) >= "A".charCodeAt(0) &&
      char.charCodeAt(0) <= "Z".charCodeAt(0)) ||
    (char.charCodeAt(0) >= "a".charCodeAt(0) &&
      char.charCodeAt(0) <= "z".charCodeAt(0))
  );
}

function isDigit(char: string) {
  return (
    char.charCodeAt(0) >= "0".charCodeAt(0) &&
    char.charCodeAt(0) <= "9".charCodeAt(0)
  );
}

function isWhitespace(char: string) {
  return char === "\n" || char === "\t" || char === " ";
}
