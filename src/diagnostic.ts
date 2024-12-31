import { Logger } from "./logger";
import { DocumentItem } from "./tokenizer";

export interface Diagnostic {
  token: DocumentItem;
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

  constructor(public logger: Logger, private trace: boolean) {}

  public error(diagnostic: Omit<Diagnostic, "severity">) {
    if (this.trace) {
      console.trace(formatDiagnostic({ severity: "error", ...diagnostic }));
    }

    this.items.push({ severity: "error", ...diagnostic });
  }

  public removeFileDiagnostics(file: string) {
    this.items = this.items.filter((i) => i.token.file === file);
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
