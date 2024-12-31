// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import path from "path";
import { workspace, ExtensionContext } from "vscode";
import {
  LanguageClient,
  TransportKind,
  ServerOptions,
  LanguageClientOptions,
} from "vscode-languageclient/node";

let client: LanguageClient;

export function activate(context: ExtensionContext) {
  const module = context.asAbsolutePath(
    path.join("..", "..", "dist", "lsp.js")
  );

  const serverOpts: ServerOptions = {
    run: { module, transport: TransportKind.ipc },
    debug: {
      module,
      transport: TransportKind.ipc,
    },
  };

  const clientOpts: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", language: "eproto" }],
    synchronize: {
      fileEvents: workspace.createFileSystemWatcher("**/.eproto"),
    },
    workspaceFolder: workspace.workspaceFolders?.[0],
  };

  client = new LanguageClient(
    "eproto-lsp",
    "EProto LSP",
    serverOpts,
    clientOpts
  );

  client.start();
}

export function deactivate() {
  if (!client) {
    return;
  }
  return client.stop();
}
