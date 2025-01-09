import { Console } from "./logger";
import { DocumentItem } from "./tokenizer";

export interface Diagnostic {
  token: DocumentItem;
  scope: "local" | "global";
  severity: "error"; // ? We don't support anything but errors
  message: DiagnosticMessage;
}

export type DiagnosticMessage =
  | RawDiagnosticMessage
  | RedefinitionDiagnosticMessage;

export interface RawDiagnosticMessage {
  kind: "raw";
  message: string;
}

export interface RedefinitionDiagnosticMessage {
  kind: "redefinition";
  message: string;
  at: DocumentItem;
}

export function afterToken(token: DocumentItem) {
  return {
    file: token.file,
    range: { start: token.range.end, end: token.range.end },
  };
}

export class DiagnosticCollection {
  public items: Diagnostic[] = [];

  constructor(public logger: Console, private trace: boolean) {}

  public error(
    token: DocumentItem,
    scope: "local" | "global",
    message: string | DiagnosticMessage
  ) {
    if (typeof message === "string") {
      message = { kind: "raw", message };
    }
    const diagnostic = { severity: "error" as const, token, scope, message };
    if (this.trace) {
      console.trace(formatCompilerDiagnostic(diagnostic));
    }

    this.items.push(diagnostic);
  }

  public removeFileDiagnostics(file: string) {
    this.items = this.items.filter(
      (i) => i.token.file !== file && i.scope === "local"
    );
  }

  public print() {
    if (this.trace) return;

    for (const item of this.items) {
      this.logger.error(formatCompilerDiagnostic(item));
    }
  }
}

export function atToken(token: DocumentItem): string {
  return `${token.file}:${token.range.start.line + 1}:${
    token.range.start.character + 1
  }`;
}

export const diagnosticMessages = {
  redefinitionAt(
    message: string,
    at: DocumentItem
  ): RedefinitionDiagnosticMessage {
    return { kind: "redefinition", message, at };
  },
};

function formatCompilerMessage(
  token: DocumentItem,
  severity: Diagnostic["severity"],
  rawMessage: string
): string {
  return `${atToken(token)} - ${severity}: ${rawMessage}`;
}

function formatCompilerDiagnostic({ message, severity, token }: Diagnostic) {
  switch (message.kind) {
    case "raw":
      return formatCompilerMessage(token, severity, message.message);
    case "redefinition":
      return formatCompilerMessage(
        token,
        severity,
        `${message.message} at ${atToken(message.at)}`
      );
  }
}