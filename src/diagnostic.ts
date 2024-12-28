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

  constructor(public logger: Logger) {}

  public error(item: Omit<Diagnostic, "severity">) {
    this.items.push({ severity: "error", ...item });
  }

  public removeFileDiagnostics(file: string) {
    this.items = this.items.filter((i) => i.item.file === file);
  }

  public print() {
    for (const item of this.items) {
      this.logger.error(
        `${item.item.file}:${item.item.range.start.line + 1}:${
          item.item.range.start.character + 1
        } - ${item.severity}: ${item.message}`
      );
    }
  }
}
