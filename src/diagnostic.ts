import { Logger } from "./logger";
import { DocumentItem } from "./tokenizer";

export interface Diagnostic {
  item: DocumentItem;
  severity: "error"; // ? We don't support anything but errors
  message: string;
}

export function afterItem(item: DocumentItem) {
  return {
    file: item.file,
    range: { start: item.range.end, end: item.range.end },
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
    this.items = this.items.filter((i) => i.item.file === file);
  }

  public print() {
    if (this.trace) return;

    for (const item of this.items) {
      this.logger.error(formatDiagnostic(item));
    }
  }
}

function formatDiagnostic(diagnostic: Diagnostic): string {
  return `${diagnostic.item.file}:${diagnostic.item.range.start.line + 1}:${
    diagnostic.item.range.start.character + 1
  } - ${diagnostic.severity}: ${diagnostic.message}`;
}
