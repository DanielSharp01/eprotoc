import { Console } from "./logger";
import { DocumentItem } from "./tokenizer";

export interface Diagnostic {
  token: DocumentItem;
  scope: "local" | "global";
  severity: "error"; // ? We don't support anything but errors
  message: string;
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
    message: string
  ) {
    const diagnostic = { severity: "error" as const, token, scope, message };
    if (this.trace) {
      console.trace(formatDiagnostic(diagnostic));
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
      this.logger.error(formatDiagnostic(item));
    }
  }
}

export function atToken(token: DocumentItem): string {
  return `${token.file}:${token.range.start.line + 1}:${
    token.range.start.character + 1
  }`;
}

function formatDiagnostic(diagnostic: Diagnostic): string {
  return `${atToken(diagnostic.token)} - ${diagnostic.severity}: ${
    diagnostic.message
  }`;
}
