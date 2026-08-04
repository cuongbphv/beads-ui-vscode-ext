/**
 * The dashboard webview: a single reused panel, a strict CSP, and the
 * postMessage plumbing that connects it to the RPC router.
 */
import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';

import { isRpcRequest, type DashboardTab, type HostEvent } from '../../shared/protocol';
import { bindVisibility, type BeadsStore } from '../store';
import { handleRequest, isMutation, type RouterHost } from './router';

export class DashboardPanel implements vscode.Disposable {
  private static current: DashboardPanel | undefined;

  static show(
    context: vscode.ExtensionContext,
    store: BeadsStore,
    host: RouterHost,
    tab?: DashboardTab,
  ): DashboardPanel {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (DashboardPanel.current) {
      DashboardPanel.current.panel.reveal(column);
      if (tab) DashboardPanel.current.post({ kind: 'event', name: 'setTab', tab });
      return DashboardPanel.current;
    }

    const panel = vscode.window.createWebviewPanel('beadsDashboard.dashboard', 'Beads Dashboard', column, {
      enableScripts: true,
      // Keep the React tree alive when the user tabs away; rebuilding it means
      // another full bd fan-out.
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist'),
        vscode.Uri.joinPath(context.extensionUri, 'media')],
    });

    DashboardPanel.current = new DashboardPanel(context, panel, store, host, tab);
    return DashboardPanel.current;
  }

  static get active(): DashboardPanel | undefined {
    return DashboardPanel.current;
  }

  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    context: vscode.ExtensionContext,
    private readonly panel: vscode.WebviewPanel,
    private readonly store: BeadsStore,
    private readonly host: RouterHost,
    private readonly initialTab?: DashboardTab,
  ) {
    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'activity-bar.svg');
    panel.webview.html = this.render(context, panel.webview);

    this.disposables.push(
      panel.webview.onDidReceiveMessage((message: unknown) => void this.onMessage(message)),
      panel.onDidDispose(() => this.dispose()),
      // A dashboard in a background tab is not being watched; `retainContextWhenHidden`
      // keeps its React tree alive, so it costs nothing to stop polling for it.
      bindVisibility(store, {
        get visible() {
          return panel.visible;
        },
        onDidChange: (listener) => panel.onDidChangeViewState(() => listener()),
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('beadsDashboard.showClosed')) this.postSettings();
      }),
      // Anything that changes the snapshot — a poll, a tree action, another
      // window's mutation — is pushed straight into the open panel.
      store.onDidChange((state) => {
        if (state.snapshot) this.post({ kind: 'event', name: 'issuesChanged', snapshot: state.snapshot });
        else if (state.error) this.post({ kind: 'event', name: 'error', error: state.error });
      }),
    );
  }

  /** Focus an issue in the open dashboard (used by the tree's click handler). */
  focus(id: string): void {
    this.panel.reveal(this.panel.viewColumn);
    this.post({ kind: 'event', name: 'focusBead', id });
  }

  setTab(tab: DashboardTab): void {
    this.post({ kind: 'event', name: 'setTab', tab });
  }

  private post(event: HostEvent): void {
    void this.panel.webview.postMessage(event);
  }

  /**
   * Push the settings the webview honours. Sent on connect and on change: the
   * webview has no `vscode`, so this is the only way `beadsDashboard.showClosed`
   * can reach the board it is documented to control.
   */
  private postSettings(): void {
    const config = vscode.workspace.getConfiguration('beadsDashboard');
    this.post({
      kind: 'event',
      name: 'settings',
      settings: { showClosed: config.get<boolean>('showClosed', true) },
    });
  }

  private async onMessage(message: unknown): Promise<void> {
    if ((message as { kind?: string })?.kind === 'ready') {
      // Before the data, so the first render already knows whether closed issues
      // belong on the board.
      this.postSettings();
      const state = this.store.current.snapshot ? this.store.current : await this.store.refresh();
      if (state.snapshot) {
        this.post({ kind: 'event', name: 'issuesChanged', snapshot: state.snapshot });
      } else if (state.error) {
        this.post({ kind: 'event', name: 'error', error: state.error });
      }
      if (this.initialTab) this.post({ kind: 'event', name: 'setTab', tab: this.initialTab });
      return;
    }

    if (!isRpcRequest(message)) return;

    const response = await handleRequest(this.store, this.host, message);
    void this.panel.webview.postMessage(response);

    // A mutation already fired the store's change event via BdMutations, which
    // broadcasts the fresh snapshot; nothing more to do but surface failures.
    if (!response.ok && isMutation(message.method)) {
      void vscode.window.showErrorMessage(`bd: ${response.error.message}`);
    }
  }

  /**
   * CSP: scripts and styles are nonce-gated and same-origin only. No remote
   * fonts, no CDN — the panel must work offline.
   */
  private render(context: vscode.ExtensionContext, webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString('base64');
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview.css'),
    );

    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource} 'nonce-${nonce}'`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link href="${styleUri}" rel="stylesheet" />
    <title>Beads Dashboard</title>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }

  dispose(): void {
    DashboardPanel.current = undefined;
    for (const disposable of this.disposables) disposable.dispose();
    this.panel.dispose();
  }
}
