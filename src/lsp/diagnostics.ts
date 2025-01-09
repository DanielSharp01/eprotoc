import {
  DiagnosticSeverity,
  Diagnostic as LspDiagnostic,
} from "vscode-languageserver";
import { Diagnostic } from "../diagnostic";
import { LSPContext } from "../lsp";

export function sendDiagnostics(
  { connection, diagnostics }: LSPContext,
  files: Set<string>
) {
  for (const file of files) {
    const fileDiagnostics = diagnostics.items
      .filter((d) => d.token.file === file)
      .map((d) => createDiagnostic(d));

    connection.sendDiagnostics({
      uri: file,
      diagnostics: fileDiagnostics,
    });
  }
}

function createDiagnostic(diagnostic: Diagnostic): LspDiagnostic {
  return {
    severity: DiagnosticSeverity.Error,
    message: diagnostic.message.message,
    relatedInformation:
      diagnostic.message.kind === "redefinition"
        ? [
            {
              location: {
                uri: diagnostic.message.at.file,
                range: diagnostic.message.at.range,
              },
              message: "First defined at",
            },
          ]
        : undefined,
    range: diagnostic.token.range,
  };
}
